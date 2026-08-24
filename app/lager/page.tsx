"use client";

// Lager (Nutzer-Vorgabe 2026-08-25): eigene Seite unter Stundenerfassung,
// nur admin/hr ("Den Lagerbestand soll nur 'admin und hr' sehen und
// bearbeiten können. 'Stundenerfassung' macht nur die Ausgabe" - siehe
// app/arbeitskleidung/page.tsx für die Ausgabe selbst). Zeigt den
// Lagerbestand je Typ+Größe, immer live berechnet (Anfangsbestand minus
// alle nicht stornierten Ausgaben aus kleidung_ausgaben) - gleiches Prinzip
// wie kassenbestand_bis() im Kassenbuch.
//
// Zwei Wege, den Anfangsbestand zu pflegen:
// - "Anfangsbestände speichern": direkte Eingabe (z.B. zu Saisonbeginn),
//   Datumsstempel + Bearbeiter werden serverseitig gesetzt (Trigger
//   kleidung_lagerbestand_touch in schema.sql).
// - "Inventur durchführen": man trägt den tatsächlich GEZÄHLTEN aktuellen
//   Bestand ein (vorausgefüllt mit dem live berechneten Wert), die App
//   rechnet daraus rückwärts den Anfangsbestand aus (gezählt + bereits
//   ausgegeben) - damit bleiben Zukäufe während der Saison oder Schwund
//   ohne eigene Buchungsart abbildbar, wie vom Nutzer gewünscht ("muss
//   nicht immer 100% korrekt sein, aber ich kann besser nachverfolgen").

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErfassungTabs from "@/components/ErfassungTabs";
import {
  TYPEN,
  TYP_BADGE_CLASS,
  groessenFuer,
} from "@/lib/arbeitskleidung";
import type {
  KleidungLagerbestand,
  KleidungTyp,
  ProfilName,
} from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

// Nur die für die Summenbildung nötigen Felder - kein "select *".
interface AusgabeSumme {
  typ: KleidungTyp;
  groesse: string;
  anzahl: number;
  storniert: boolean;
}

export default function LagerPage() {
  const { profile } = useProfile();
  const canView = profile?.role === "admin" || profile?.role === "hr";

  const [lagerbestand, setLagerbestand] = useState<KleidungLagerbestand[]>([]);
  const [ausgaben, setAusgaben] = useState<AusgabeSumme[]>([]);
  const [namenVon, setNamenVon] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [modus, setModus] = useState<"normal" | "inventur">("normal");
  const [entwurf, setEntwurf] = useState<Record<string, string>>({});
  const [speichern, setSpeichern] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: lager }, { data: ausg }, { data: namen }] =
      await Promise.all([
        supabase
          .from("kleidung_lagerbestand")
          .select("*")
          .eq("saison_jahr", CURRENT_YEAR),
        supabase
          .from("kleidung_ausgaben")
          .select("typ, groesse, anzahl, storniert")
          .eq("saison_jahr", CURRENT_YEAR),
        supabase.from("profile_namen").select("*"),
      ]);
    setLagerbestand((lager as KleidungLagerbestand[]) ?? []);
    setAusgaben((ausg as AusgabeSumme[]) ?? []);
    const namenMap: Record<string, string> = {};
    ((namen as ProfilName[]) ?? []).forEach((p) => {
      namenMap[p.id] = p.full_name;
    });
    setNamenVon(namenMap);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const ausgegebenJeKey: Record<string, number> = {};
  ausgaben.forEach((a) => {
    if (a.storniert) return;
    const key = `${a.typ}-${a.groesse}`;
    ausgegebenJeKey[key] = (ausgegebenJeKey[key] ?? 0) + a.anzahl;
  });
  const lagerbestandJeKey: Record<string, KleidungLagerbestand> = {};
  lagerbestand.forEach((l) => {
    lagerbestandJeKey[`${l.typ}-${l.groesse}`] = l;
  });

  function eintragen(typ: KleidungTyp, groesse: string, wert: string) {
    setEntwurf((prev) => ({ ...prev, [`${typ}-${groesse}`]: wert }));
  }

  function inventurStarten() {
    const vorbefuellt: Record<string, string> = {};
    TYPEN.forEach((typ) =>
      groessenFuer(typ).forEach((groesse) => {
        const key = `${typ}-${groesse}`;
        const anfangsbestand = lagerbestandJeKey[key]?.anfangsbestand ?? 0;
        const ausgegeben = ausgegebenJeKey[key] ?? 0;
        vorbefuellt[key] = String(anfangsbestand - ausgegeben);
      })
    );
    setEntwurf(vorbefuellt);
    setModus("inventur");
    setFehler(null);
    setErfolg(null);
  }

  function inventurAbbrechen() {
    setModus("normal");
    setEntwurf({});
    setFehler(null);
    setErfolg(null);
  }

  async function anfangsbestaendeSpeichern() {
    const eintraege = Object.entries(entwurf);
    if (eintraege.length === 0) return;
    setSpeichern(true);
    setFehler(null);
    setErfolg(null);
    const supabase = getSupabaseClient();
    const rows = eintraege.map(([key, wert]) => {
      const [typ, groesse] = key.split("-") as [KleidungTyp, string];
      const n = Number(wert);
      return {
        saison_jahr: CURRENT_YEAR,
        typ,
        groesse,
        anfangsbestand: Number.isFinite(n) && n >= 0 ? n : 0,
      };
    });
    const { error } = await supabase
      .from("kleidung_lagerbestand")
      .upsert(rows, { onConflict: "saison_jahr,typ,groesse" });
    setSpeichern(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setEntwurf({});
    setErfolg(
      `${rows.length} Anfangsbestand${rows.length === 1 ? "" : "e"} gespeichert.`
    );
    load();
  }

  async function inventurSpeichern() {
    const eintraege = Object.entries(entwurf);
    if (eintraege.length === 0) return;
    setSpeichern(true);
    setFehler(null);
    setErfolg(null);
    const supabase = getSupabaseClient();
    const rows = eintraege.map(([key, wert]) => {
      const [typ, groesse] = key.split("-") as [KleidungTyp, string];
      const gezaehlt = Number(wert);
      const gezaehltSicher =
        Number.isFinite(gezaehlt) && gezaehlt >= 0 ? gezaehlt : 0;
      const ausgegeben = ausgegebenJeKey[key] ?? 0;
      return {
        saison_jahr: CURRENT_YEAR,
        typ,
        groesse,
        // Rückrechnung: der eingegebene Wert ist der GEZÄHLTE aktuelle
        // Bestand, gespeichert wird aber weiterhin nur der Anfangsbestand
        // (Aktuell bleibt immer eine live berechnete Größe, nie ein
        // gespeicherter Zwischenstand).
        anfangsbestand: gezaehltSicher + ausgegeben,
      };
    });
    const { error } = await supabase
      .from("kleidung_lagerbestand")
      .upsert(rows, { onConflict: "saison_jahr,typ,groesse" });
    setSpeichern(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setModus("normal");
    setEntwurf({});
    setErfolg("Inventur gespeichert - Lagerbestand ist jetzt auf dem neuesten Stand.");
    load();
  }

  if (!canView) {
    return (
      <div className="flex flex-col gap-4">
        <ErfassungTabs />
        <p className="text-neutral-500">
          Nur admin/hr dürfen den Lagerbestand sehen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ErfassungTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Lager {CURRENT_YEAR}
        </h1>
        <p className="text-sm text-neutral-500">
          Lagerbestand an Arbeitskleidung je Größe. „Aktueller Bestand" wird
          automatisch berechnet (Anfangsbestand − alle Ausgaben, siehe
          Stundenerfassung → Arbeitskleidung) und muss nicht 100% exakt
          sein - reicht als Orientierung. Trage unten den Anfangsbestand zu
          Saisonbeginn ein, oder nutze „Inventur durchführen", um den
          Bestand nach einem Zukauf oder bei Schwund wieder auf den
          tatsächlich gezählten Stand zu bringen.
        </p>
      </div>

      {fehler && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          ⚠ {fehler}
        </p>
      )}
      {erfolg && (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          ✓ {erfolg}
        </p>
      )}

      {modus === "normal" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            onClick={anfangsbestaendeSpeichern}
            disabled={speichern || Object.keys(entwurf).length === 0}
          >
            Anfangsbestände speichern
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={inventurStarten}
          >
            Inventur durchführen
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2">
          <span className="text-sm font-medium text-amber-800">
            Inventur-Modus: trage je Größe den tatsächlich gezählten Bestand
            ein (unten vorausgefüllt mit dem berechneten Stand).
          </span>
          <button
            type="button"
            className="btn"
            disabled={speichern}
            onClick={inventurSpeichern}
          >
            Inventur speichern
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={inventurAbbrechen}
          >
            Abbrechen
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-neutral-200 bg-white p-4">
          <table>
            <thead>
              <tr>
                <th>Typ</th>
                <th>Größe</th>
                <th>
                  {modus === "inventur" ? "Gezählter Bestand" : "Anfangsbestand"}
                </th>
                <th>Ausgegeben</th>
                <th>Aktueller Bestand</th>
              </tr>
            </thead>
            <tbody>
              {TYPEN.flatMap((typ) =>
                groessenFuer(typ).map((groesse, idx) => {
                  const key = `${typ}-${groesse}`;
                  const eintrag = lagerbestandJeKey[key];
                  const anfangsbestand = eintrag?.anfangsbestand ?? 0;
                  const ausgegeben = ausgegebenJeKey[key] ?? 0;
                  const aktuell = anfangsbestand - ausgegeben;
                  const istGruppenstart = idx === 0;
                  return (
                    <tr
                      key={key}
                      className={
                        istGruppenstart && typ !== TYPEN[0]
                          ? "border-t-4 border-neutral-400"
                          : ""
                      }
                    >
                      {istGruppenstart && (
                        <td rowSpan={groessenFuer(typ).length} className="align-top">
                          <span
                            className={`inline-block rounded px-2 py-1 text-xs font-semibold ${TYP_BADGE_CLASS[typ]}`}
                          >
                            {typ}
                          </span>
                        </td>
                      )}
                      <td>{groesse}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          className="w-20"
                          value={
                            entwurf[key] ??
                            (modus === "normal" ? String(anfangsbestand) : "")
                          }
                          onChange={(e) =>
                            eintragen(typ, groesse, e.target.value)
                          }
                        />
                        {modus === "normal" && eintrag?.updated_at && (
                          <p className="mt-0.5 text-xs text-neutral-400">
                            Stand{" "}
                            {new Date(eintrag.updated_at).toLocaleDateString(
                              "de-DE"
                            )}
                            {eintrag.updated_by &&
                            namenVon[eintrag.updated_by]
                              ? ` · ${namenVon[eintrag.updated_by]}`
                              : ""}
                          </p>
                        )}
                      </td>
                      <td>{ausgegeben}</td>
                      <td
                        className={
                          aktuell <= 0
                            ? "font-semibold text-red-600"
                            : aktuell <= 3
                              ? "font-semibold text-amber-600"
                              : "font-semibold"
                        }
                      >
                        {aktuell}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
