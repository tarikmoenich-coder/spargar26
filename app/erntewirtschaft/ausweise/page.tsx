"use client";

// Erntewirtschaft -> Ausweise: Mitarbeiter-ID-Karten mit QR-Code
// (docs/erntewirtschaft-plan.md Teil C). Der Code ist "P-<personal_nr>-
// <suffix>" - kein Anlernschritt mehr noetig (anders als die alte
// ernte_tag-Loesung), der geheime Suffix (nur im QR, nicht als Klartext auf
// der Karte) verhindert, dass jemand allein ueber die bekannte
// Personalnummer eines Kollegen eine funktionierende Karte faelschen kann.
// Nutzer-Vorgabe 2026-10-22: Drucken / Erneut drucken / Verlust-Karte
// drucken (rotiert den Suffix, macht die alte Karte sofort ungueltig).
// Mitarbeiterfoto (s/w auf der Karte) ueber den privaten Storage-Bucket
// "mitarbeiter-fotos" (migration_2026-10-22_mitarbeiter_foto.sql), gleiches
// Muster wie app/personal-dokumente/page.tsx - Anzeige ueber eine zeitlich
// begrenzte signierte URL, kein oeffentlicher Zugriff.

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { IdCard } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import DokumentKameraAufnahme from "@/components/DokumentKameraAufnahme";
import MitarbeiterAusweisKarte from "@/components/MitarbeiterAusweisKarte";
import MitarbeiterAusweisDruckbogen from "@/components/MitarbeiterAusweisDruckbogen";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";

const FOTO_BUCKET = "mitarbeiter-fotos";

interface MitarbeiterZeile {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  foto_pfad: string | null;
}

interface AusweisZeile {
  employee_id: string;
  suffix: string;
  erstellt_am: string;
  aktualisiert_am: string;
  generation: number;
  letzter_druck_nr: number;
}

interface DruckAnsicht {
  mitarbeiter: MitarbeiterZeile;
  code: string;
  qrSvg: string;
  fotoUrl: string | null;
  version: string;
}

// Nur maschinenlesbar (steckt nur im QR-Code, nie als Klartext auf der
// Karte) - kein Ambiguitaets-Alphabet noetig, 8 Hex-Zeichen aus
// kryptografisch zufaelligen Bytes.
function neuerSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export default function ErntewirtschaftAusweisePage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [mitarbeiter, setMitarbeiter] = useState<MitarbeiterZeile[]>([]);
  const [ausweise, setAusweise] = useState<Map<string, AusweisZeile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [druck, setDruck] = useState<DruckAnsicht | null>(null);
  const [druckModus, setDruckModus] = useState<"a4" | "karte">("karte");
  const [fotoKameraFuer, setFotoKameraFuer] = useState<MitarbeiterZeile | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: empData, error: empErr }, { data: ausweisData, error: ausweisErr }] =
      await Promise.all([
        supabase
          .from("employees")
          .select("id, personal_nr, name, vorname, foto_pfad")
          .eq("aktiv", true)
          .order("name"),
        supabase
          .from("ernte_ausweis")
          .select("employee_id, suffix, erstellt_am, aktualisiert_am, generation, letzter_druck_nr"),
      ]);
    setFehler(empErr?.message ?? ausweisErr?.message ?? null);
    setMitarbeiter((empData as MitarbeiterZeile[]) ?? []);
    setAusweise(
      new Map(((ausweisData as AusweisZeile[]) ?? []).map((a) => [a.employee_id, a]))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  // Wert/Generierung des Codes unverändert (P-<personal_nr>-<suffix>,
  // dieselbe "qrcode"-Bibliothek, SVG für scharfen Vektor-Druck) - zeigt
  // zusätzlich die Versionsnummer "vGeneration.DruckNr" an (Nutzer-Vorgabe
  // 2026-11-12, migration_2026-11-12_ernte_ausweis_versionierung.sql).
  async function druckAnzeigen(
    m: MitarbeiterZeile,
    suffix: string,
    generation: number,
    druckNr: number
  ) {
    const code = `P-${m.personal_nr}-${suffix}`;
    const supabase = getSupabaseClient();
    const [qrSvg, fotoUrl] = await Promise.all([
      QRCode.toString(code, { type: "svg", color: { dark: "#000000", light: "#ffffff" } }),
      m.foto_pfad
        ? supabase.storage
            .from(FOTO_BUCKET)
            .createSignedUrl(m.foto_pfad, 60)
            .then((r) => r.data?.signedUrl ?? null)
        : Promise.resolve(null),
    ]);
    setDruck({ mitarbeiter: m, code, qrSvg, fotoUrl, version: `v${generation}.${druckNr}` });
  }

  async function protokollieren(
    m: MitarbeiterZeile,
    generation: number,
    druckNr: number,
    grund: "neu" | "erneut" | "verlust"
  ) {
    const { error } = await getSupabaseClient()
      .from("ernte_ausweis_druck")
      .insert({ employee_id: m.id, generation, druck_nr: druckNr, grund });
    if (error) console.error("ernte_ausweis_druck protokollieren fehlgeschlagen", error);
  }

  async function neueKarteDrucken(m: MitarbeiterZeile) {
    setLaeuft(m.id);
    const suffix = neuerSuffix();
    const { error } = await getSupabaseClient()
      .from("ernte_ausweis")
      .upsert(
        { employee_id: m.id, suffix, generation: 1, letzter_druck_nr: 1, aktualisiert_am: new Date().toISOString() },
        { onConflict: "employee_id" }
      );
    if (!error) await protokollieren(m, 1, 1, "neu");
    setLaeuft(null);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
    await druckAnzeigen(m, suffix, 1, 1);
  }

  async function erneutDrucken(m: MitarbeiterZeile, ausweis: AusweisZeile) {
    setLaeuft(m.id);
    const druckNr = ausweis.letzter_druck_nr + 1;
    const { error } = await getSupabaseClient()
      .from("ernte_ausweis")
      .update({ letzter_druck_nr: druckNr })
      .eq("employee_id", m.id);
    if (!error) await protokollieren(m, ausweis.generation, druckNr, "erneut");
    setLaeuft(null);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
    await druckAnzeigen(m, ausweis.suffix, ausweis.generation, druckNr);
  }

  async function verlustKarteDrucken(m: MitarbeiterZeile, ausweis: AusweisZeile) {
    setLaeuft(m.id);
    const suffix = neuerSuffix();
    const generation = ausweis.generation + 1;
    const { error } = await getSupabaseClient()
      .from("ernte_ausweis")
      .update({ suffix, generation, letzter_druck_nr: 1, aktualisiert_am: new Date().toISOString() })
      .eq("employee_id", m.id);
    if (!error) await protokollieren(m, generation, 1, "verlust");
    setLaeuft(null);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
    await druckAnzeigen(m, suffix, generation, 1);
  }

  function handleDrucken(m: MitarbeiterZeile) {
    const bestehend = ausweise.get(m.id);
    if (bestehend) {
      erneutDrucken(m, bestehend);
    } else {
      neueKarteDrucken(m);
    }
  }

  function handleVerlustKarte(m: MitarbeiterZeile) {
    const bestehend = ausweise.get(m.id);
    if (!bestehend) return;
    if (
      !window.confirm(
        `Verlust-Karte für ${m.name}, ${m.vorname} drucken? Die bisherige Karte wird dadurch sofort ungültig.`
      )
    ) {
      return;
    }
    verlustKarteDrucken(m, bestehend);
  }

  if (!canEdit) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        Die Ausweis-Verwaltung ist nur für Admin/HR.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <PageHeader
          icon={IdCard}
          titel="Ausweise"
          beschreibung="QR-ID-Karten für die Erntewirtschaft-Scans - Code wird direkt aus der Personalnummer erzeugt, kein Anlernschritt nötig."
        />
      </div>

      {fotoKameraFuer && (
        <DokumentKameraAufnahme
          key={fotoKameraFuer.id}
          employeeId={fotoKameraFuer.id}
          name={fotoKameraFuer.name}
          vorname={fotoKameraFuer.vorname}
          modus="ausweis"
          dokumentKategorie="Ausweiskopie"
          onFertig={() => {
            setFotoKameraFuer(null);
            laden();
          }}
          onAbbrechen={() => setFotoKameraFuer(null)}
        />
      )}

      {druck ? (
        <div className="flex flex-col items-start gap-4">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setDruck(null)}
            >
              ← Zurück zur Liste
            </button>
            <div className="flex overflow-hidden rounded border border-neutral-300 text-xs">
              <button
                type="button"
                className={`px-2 py-1 ${druckModus === "karte" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600"}`}
                onClick={() => setDruckModus("karte")}
              >
                Kartendrucker (Evolis)
              </button>
              <button
                type="button"
                className={`px-2 py-1 ${druckModus === "a4" ? "bg-emerald-600 text-white" : "bg-white text-neutral-600"}`}
                onClick={() => setDruckModus("a4")}
              >
                DIN A4 (Schere)
              </button>
            </div>
            <button type="button" className="btn text-xs" onClick={() => window.print()}>
              Drucken
            </button>
          </div>

          <div className="ausweis2-vorschau-rahmen w-full print:hidden">
            <div className="ausweis2-vorschau-box">
              <MitarbeiterAusweisKarte
                name={druck.mitarbeiter.name}
                vorname={druck.mitarbeiter.vorname}
                personalNr={druck.mitarbeiter.personal_nr}
                fotoUrl={druck.fotoUrl}
                qrSvg={druck.qrSvg}
                version={druck.version}
                variante="vorschau"
              />
            </div>
          </div>

          <MitarbeiterAusweisDruckbogen
            name={druck.mitarbeiter.name}
            vorname={druck.mitarbeiter.vorname}
            personalNr={druck.mitarbeiter.personal_nr}
            fotoUrl={druck.fotoUrl}
            qrSvg={druck.qrSvg}
            version={druck.version}
            modus={druckModus}
          />

          <p className="text-xs text-neutral-500 print:hidden">
            {druckModus === "karte" ? (
              <>
                Druck randlos exakt im Kartenformat (85,6 × 53,98&nbsp;mm) - im
                Druckdialog als Drucker &bdquo;Evolis Zenius&ldquo; wählen,
                Skalierung 100&nbsp;%, keine zusätzlichen Ränder,
                Kopf-/Fußzeilen deaktivieren.
              </>
            ) : (
              <>
                Druck auf DIN A4 mit Schnittmarkierungen, Ausweis 20&nbsp;mm
                vom linken/oberen Blattrand. Im Druckdialog: Skalierung
                100&nbsp;%, keine zusätzlichen Ränder, Kopf-/Fußzeilen
                deaktivieren.
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          {fehler && <p className="text-sm text-beere-700">Konnte nicht laden: {fehler}</p>}

          {loading ? (
            <p className="text-neutral-500">Lädt…</p>
          ) : mitarbeiter.length === 0 ? (
            <EmptyState icon={IdCard} text="Keine aktiven Mitarbeiter gefunden." />
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Personalnr.</th>
                    <th>Name</th>
                    <th>Ausweis</th>
                    <th>Foto</th>
                    <th>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {mitarbeiter.map((m) => {
                    const ausweis = ausweise.get(m.id);
                    const inArbeit = laeuft === m.id;
                    return (
                      <tr key={m.id}>
                        <td className="tabular-nums">{m.personal_nr}</td>
                        <td>
                          {m.name}, {m.vorname}
                        </td>
                        <td className="text-sm text-neutral-600">
                          {ausweis ? (
                            <>
                              <span className="font-medium tabular-nums">
                                v{ausweis.generation}.{ausweis.letzter_druck_nr}
                              </span>{" "}
                              · aktiv seit {formatDatumDE(ausweis.erstellt_am)}
                              {ausweis.aktualisiert_am !== ausweis.erstellt_am && (
                                <>
                                  {" "}
                                  · zuletzt erneuert{" "}
                                  {formatDatumDE(ausweis.aktualisiert_am)}
                                </>
                              )}
                            </>
                          ) : (
                            <span className="text-neutral-400">noch kein Ausweis</span>
                          )}
                        </td>
                        <td className="text-xs">
                          <button
                            type="button"
                            className="text-left hover:underline"
                            disabled={inArbeit}
                            onClick={() => setFotoKameraFuer(m)}
                          >
                            {m.foto_pfad ? (
                              "Foto ändern"
                            ) : (
                              <span className="text-emerald-700">+ Foto aufnehmen</span>
                            )}
                          </button>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-3 text-xs">
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={inArbeit}
                              onClick={() => handleDrucken(m)}
                            >
                              {ausweis ? "Erneut drucken" : "Drucken"}
                            </button>
                            {ausweis && (
                              <button
                                type="button"
                                className="text-beere-600 hover:underline"
                                disabled={inArbeit}
                                onClick={() => handleVerlustKarte(m)}
                              >
                                Verlust-Karte drucken
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
