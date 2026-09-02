"use client";

// Abrechnungs-("Abschnitts"-)Historie für die 15-Wochen-SV-Prüfung
// (Nutzer-Vorgabe 2026-08-13): beim App-Start waren bereits Mitarbeiter/
// Stunden importiert, aber die App kennt keine vor dem App-Start REAL
// erfolgten Abrechnungen (über das alte Excel-System) - employee_sv_pruefung
// erkennt Abschnitte ausschließlich über saison_abrechnungen-Einträge.
// Dieses Werkzeug trägt schlank NUR diesen "Uhr zurückgesetzt"-Marker
// nach, ohne Auszahlungsbeleg/Beträge/employees.aktiv anzufassen - die
// Person arbeitet ja aktuell aktiv weiter. Self-loading wie
// SvFragebogenFormular, damit die aufrufende Seite nichts vorladen muss.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import type { SaisonAbrechnung } from "@/lib/types";

export default function AbrechnungsHistorie({
  employeeId,
  saisonJahr,
  canEdit,
}: {
  employeeId: string;
  saisonJahr: number;
  canEdit: boolean;
}) {
  const [zeilen, setZeilen] = useState<SaisonAbrechnung[]>([]);
  const [laden, setLaden] = useState(true);
  const [neuesDatum, setNeuesDatum] = useState("");
  const [speichernLaeuft, setSpeichernLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function load() {
    setLaden(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("saison_abrechnungen")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("saison_jahr", saisonJahr)
      .order("abgerechnet_am");
    setZeilen((data as SaisonAbrechnung[]) ?? []);
    setLaden(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, saisonJahr]);

  async function nachtragen() {
    if (!neuesDatum) return;
    setSpeichernLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("saison_abrechnung_nachtragen", {
      p_employee_id: employeeId,
      p_saison_jahr: saisonJahr,
      p_abgerechnet_am: neuesDatum,
    });
    setSpeichernLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setNeuesDatum("");
    load();
  }

  async function entfernen(id: number) {
    if (!window.confirm("Diesen Abschnitts-Nachtrag wirklich entfernen?")) {
      return;
    }
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc(
      "saison_abrechnung_nachtrag_entfernen",
      { p_id: id }
    );
    if (error) {
      setFehler(error.message);
      return;
    }
    load();
  }

  return (
    <div className="mt-3 rounded border border-linie bg-white p-3">
      <p className="text-sm font-medium text-neutral-700">
        Abschnitts-Historie {saisonJahr}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Jeder Eintrag setzt die 105-Tage-Uhr der SV-Prüfung zurück - so wie
        eine echte "Jetzt Abrechnen"-Aktion. Für Mitarbeiter, die schon vor
        dem App-Start real abgerechnet wurden (altes System), hier das
        damalige Datum nachtragen, damit nur die Tage danach als aktueller
        Abschnitt zählen. Kein Auszahlungsbeleg, keine Beträge, kein
        Einfluss auf den Aktiv-Status.
      </p>
      {laden ? (
        <p className="mt-2 text-xs text-neutral-400">Lädt…</p>
      ) : zeilen.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-400">
          Keine Abrechnung in dieser Saison hinterlegt - ein durchgehender
          Abschnitt seit dem ersten Arbeitstag wird angenommen.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {zeilen.map((z) => (
            <li key={z.id} className="flex items-center gap-2">
              <span className="font-medium">
                {formatDatumDE(z.abgerechnet_am)}
              </span>
              {z.auszahlungsbeleg_id ? (
                <span className="text-neutral-400">
                  (echte Abrechnung in der App)
                </span>
              ) : (
                <>
                  <span className="text-amber-700">
                    (manuell nachgetragen)
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => entfernen(z.id)}
                    >
                      Entfernen
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={neuesDatum}
            onChange={(e) => setNeuesDatum(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={!neuesDatum || speichernLaeuft}
            onClick={nachtragen}
          >
            Historische Abrechnung nachtragen
          </button>
        </div>
      )}
      {fehler && <p className="mt-1 text-xs text-red-600">{fehler}</p>}
    </div>
  );
}
