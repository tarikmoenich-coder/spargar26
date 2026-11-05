"use client";

// Beschäftigungsabschnitte-Historie (Nutzer-Vorgabe 2026-11-04/05): macht
// Anmelde-/Abmeldedatum und insbesondere Wiederbeschäftigung sichtbar, statt
// sie nur indirekt aus Arbeitsstunden-Lücken abzuleiten - siehe
// migration_2026-11-04_beschaeftigungsabschnitte.sql. Gleiches Baumuster wie
// components/AbrechnungsHistorie.tsx (Liste + kleines Nachtrag-Formular,
// admin/hr-only über canEdit), aber mit zwei Datumsfeldern (Anmeldedatum
// Pflicht, Abmeldedatum optional) statt nur einem, da hier auch neue,
// NOCH LAUFENDE Abschnitte angelegt werden können.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import type { EmployeeBeschaeftigungsabschnitt } from "@/lib/types";

const QUELLE_LABELS: Record<EmployeeBeschaeftigungsabschnitt["quelle"], string> = {
  aktivierung: "Aktivierung",
  reaktivierung: "Reaktivierung",
  statuswechsel: "Statuswechsel",
  manuell: "manuell",
  migriert: "übernommen (Altdaten)",
};

export default function BeschaeftigungsabschnitteHistorie({
  employeeId,
  canEdit,
}: {
  employeeId: string;
  canEdit: boolean;
}) {
  const [zeilen, setZeilen] = useState<EmployeeBeschaeftigungsabschnitt[]>([]);
  const [laden, setLaden] = useState(true);
  const [neuAnmeldedatum, setNeuAnmeldedatum] = useState("");
  const [neuAbmeldedatum, setNeuAbmeldedatum] = useState("");
  const [speichernLaeuft, setSpeichernLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function load() {
    setLaden(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("employee_beschaeftigungsabschnitte")
      .select("*")
      .eq("employee_id", employeeId)
      .order("anmeldedatum", { ascending: false });
    setZeilen((data as EmployeeBeschaeftigungsabschnitt[]) ?? []);
    setLaden(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function nachtragen() {
    if (!neuAnmeldedatum) return;
    setSpeichernLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("employee_beschaeftigung_anmelden", {
      p_employee_id: employeeId,
      p_anmeldedatum: neuAnmeldedatum,
      p_quelle: "manuell",
    });
    if (error) {
      setSpeichernLaeuft(false);
      setFehler(error.message);
      return;
    }
    if (neuAbmeldedatum) {
      const { error: abmeldenFehler } = await supabase.rpc(
        "employee_beschaeftigung_abmelden",
        { p_employee_id: employeeId, p_abmeldedatum: neuAbmeldedatum }
      );
      if (abmeldenFehler) {
        setSpeichernLaeuft(false);
        setFehler(abmeldenFehler.message);
        return;
      }
    }
    setSpeichernLaeuft(false);
    setNeuAnmeldedatum("");
    setNeuAbmeldedatum("");
    load();
  }

  async function entfernen(id: number) {
    if (!window.confirm("Diesen Beschäftigungsabschnitt wirklich entfernen?")) {
      return;
    }
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("employee_beschaeftigungsabschnitte")
      .delete()
      .eq("id", id);
    if (error) {
      setFehler(error.message);
      return;
    }
    load();
  }

  return (
    <div className="mt-3 rounded border border-linie bg-white p-3">
      <p className="text-sm font-medium text-neutral-700">
        Beschäftigungsabschnitte
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Jeder Abschnitt zählt für die 105-Tage-Prüfung. Mehrere Abschnitte
        bedeuten Wiederbeschäftigung (die Person war zwischenzeitlich
        abgemeldet und ist zurückgekommen).
      </p>
      {laden ? (
        <p className="mt-2 text-xs text-neutral-400">Lädt…</p>
      ) : zeilen.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-400">
          Noch kein Beschäftigungsabschnitt hinterlegt.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {zeilen.map((z) => (
            <li key={z.id} className="flex items-center gap-2">
              <span className="font-medium">
                {formatDatumDE(z.anmeldedatum)}
                {" – "}
                {z.abmeldedatum ? formatDatumDE(z.abmeldedatum) : "läuft noch"}
              </span>
              <span className="text-neutral-400">
                ({QUELLE_LABELS[z.quelle]})
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
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
            Anmeldedatum
            <input
              type="date"
              value={neuAnmeldedatum}
              onChange={(e) => setNeuAnmeldedatum(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
            Abmeldedatum (optional, leer = läuft noch)
            <input
              type="date"
              value={neuAbmeldedatum}
              onChange={(e) => setNeuAbmeldedatum(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={!neuAnmeldedatum || speichernLaeuft}
            onClick={nachtragen}
          >
            Abschnitt nachtragen
          </button>
        </div>
      )}
      {fehler && <p className="mt-1 text-xs text-beere-600">{fehler}</p>}
    </div>
  );
}
