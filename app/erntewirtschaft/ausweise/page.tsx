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
import { IdCard, UserRound } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import MitarbeiterFotoAufnahme from "@/components/MitarbeiterFotoAufnahme";
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
}

interface DruckAnsicht {
  mitarbeiter: MitarbeiterZeile;
  code: string;
  qrDataUrl: string;
  fotoUrl: string | null;
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
        supabase.from("ernte_ausweis").select("employee_id, suffix, erstellt_am, aktualisiert_am"),
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

  async function druckeKarte(m: MitarbeiterZeile, suffix: string) {
    const code = `P-${m.personal_nr}-${suffix}`;
    const supabase = getSupabaseClient();
    const [qrDataUrl, fotoUrl] = await Promise.all([
      QRCode.toDataURL(code, { margin: 1, width: 500 }),
      m.foto_pfad
        ? supabase.storage
            .from(FOTO_BUCKET)
            .createSignedUrl(m.foto_pfad, 60)
            .then((r) => r.data?.signedUrl ?? null)
        : Promise.resolve(null),
    ]);
    setDruck({ mitarbeiter: m, code, qrDataUrl, fotoUrl });
    setTimeout(() => window.print(), 150);
  }

  async function neuenSuffixErzeugenUndDrucken(m: MitarbeiterZeile) {
    setLaeuft(m.id);
    const suffix = neuerSuffix();
    const { error } = await getSupabaseClient()
      .from("ernte_ausweis")
      .upsert(
        { employee_id: m.id, suffix, aktualisiert_am: new Date().toISOString() },
        { onConflict: "employee_id" }
      );
    setLaeuft(null);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
    await druckeKarte(m, suffix);
  }

  function handleDrucken(m: MitarbeiterZeile) {
    const bestehend = ausweise.get(m.id);
    if (bestehend) {
      druckeKarte(m, bestehend.suffix);
    } else {
      neuenSuffixErzeugenUndDrucken(m);
    }
  }

  function handleVerlustKarte(m: MitarbeiterZeile) {
    if (
      !window.confirm(
        `Verlust-Karte für ${m.name}, ${m.vorname} drucken? Die bisherige Karte wird dadurch sofort ungültig.`
      )
    ) {
      return;
    }
    neuenSuffixErzeugenUndDrucken(m);
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
        <MitarbeiterFotoAufnahme
          key={fotoKameraFuer.id}
          employeeId={fotoKameraFuer.id}
          name={fotoKameraFuer.name}
          vorname={fotoKameraFuer.vorname}
          onFertig={() => {
            setFotoKameraFuer(null);
            laden();
          }}
          onAbbrechen={() => setFotoKameraFuer(null)}
        />
      )}

      {druck ? (
        <div className="ausweis-druck flex flex-col items-start gap-4">
          <div className="flex gap-2 print:hidden">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setDruck(null)}
            >
              ← Zurück zur Liste
            </button>
            <button type="button" className="btn text-xs" onClick={() => window.print()}>
              Drucken
            </button>
          </div>
          <div className="ausweis-karte flex flex-col gap-1 rounded border border-dashed border-neutral-400 bg-white p-3">
            <div className="min-w-0">
              <p className="text-[8px] uppercase tracking-wide text-neutral-500">
                Spargelhof Mömmel
              </p>
              <p className="truncate text-base font-semibold leading-tight">
                {druck.mitarbeiter.name}, {druck.mitarbeiter.vorname}
              </p>
            </div>
            <div className="flex flex-1 items-center gap-4">
              {druck.fotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={druck.fotoUrl}
                  alt="Mitarbeiterfoto"
                  className="ausweis-foto-platzhalter shrink-0 rounded object-cover grayscale"
                />
              ) : (
                <div className="ausweis-foto-platzhalter flex shrink-0 items-center justify-center rounded bg-neutral-200 text-neutral-400">
                  <UserRound className="h-12 w-12" strokeWidth={1.25} />
                </div>
              )}
              <div className="flex shrink-0 flex-col items-center justify-start gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={druck.qrDataUrl} alt="QR-Code" className="ausweis-qr" />
                <p className="text-base font-semibold tabular-nums">
                  {druck.mitarbeiter.personal_nr}
                </p>
              </div>
            </div>
          </div>
          <p className="text-xs text-neutral-500 print:hidden">
            Noch kein Kartendrucker vorhanden - zum Testen reicht der normale
            Drucker (Schnittrand gestrichelt).
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
                              aktiv seit {formatDatumDE(ausweis.erstellt_am)}
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
