"use client";

// Eingabeformular für "Bestätigung für den Nachweis der doppelten
// Haushaltsführung" - manuell vom ausgefüllten/gestempelten Papierformular
// abgetippt (Gemeinde-Stempel, kein automatisches Auslesen möglich), ein
// Datensatz je Person und Saison-Jahr. Lädt/speichert selbst anhand
// employeeId + saisonJahr, gleiches Muster wie SvFragebogenFormular.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  FAMILIENSTAND_LABELS,
  WOHNSITUATION_LABELS,
  type DoppelteHaushaltsfuehrung,
  type Familienstand,
  type Wohnsituation,
} from "@/lib/types";

type Entwurf = Omit<
  DoppelteHaushaltsfuehrung,
  "id" | "employee_id" | "saison_jahr" | "erfasst_von" | "erfasst_am" | "updated_by" | "updated_at"
>;

const LEERER_ENTWURF: Entwurf = {
  familienstand: null,
  wohnsituation: null,
  antrag_gestellt: false,
  antrag_gestellt_am: null,
  ausgefuellt_am: null,
};

export default function DoppelteHaushaltsfuehrungFormular({
  employeeId,
  saisonJahr,
  canEdit,
  titel,
  onGespeichert,
  onAbbrechen,
}: {
  employeeId: string;
  saisonJahr: number;
  canEdit: boolean;
  titel?: string;
  onGespeichert: () => void;
  onAbbrechen: () => void;
}) {
  const { profile } = useProfile();
  const [laden, setLaden] = useState(true);
  const [entwurf, setEntwurf] = useState<Entwurf>(LEERER_ENTWURF);
  const [speichernLaeuft, setSpeichernLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLaden(true);
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("doppelte_haushaltsfuehrung")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("saison_jahr", saisonJahr)
        .maybeSingle();
      setEntwurf(data ? { ...(data as DoppelteHaushaltsfuehrung) } : LEERER_ENTWURF);
      setLaden(false);
    }
    load();
  }, [employeeId, saisonJahr]);

  function feld<K extends keyof Entwurf>(key: K, value: Entwurf[K]) {
    setEntwurf((prev) => ({ ...prev, [key]: value }));
  }

  async function speichern() {
    if (!profile) return;
    setSpeichernLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("doppelte_haushaltsfuehrung").upsert(
      {
        ...entwurf,
        employee_id: employeeId,
        saison_jahr: saisonJahr,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,saison_jahr" }
    );
    if (error) {
      setFehler(error.message);
      setSpeichernLaeuft(false);
      return;
    }
    setSpeichernLaeuft(false);
    onGespeichert();
  }

  if (laden) {
    return <p className="text-neutral-500">Lädt…</p>;
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-amber-300 bg-amber-50 p-4">
      <h3 className="text-sm font-semibold text-amber-900">
        {titel ?? `Doppelte Haushaltsführung ${saisonJahr}`}
      </h3>

      <label className="text-sm">
        Familienstand{" "}
        <select
          value={entwurf.familienstand ?? ""}
          onChange={(e) =>
            feld(
              "familienstand",
              (e.target.value || null) as Familienstand | null
            )
          }
          disabled={!canEdit}
        >
          <option value="">— bitte wählen —</option>
          {(Object.keys(FAMILIENSTAND_LABELS) as Familienstand[]).map((k) => (
            <option key={k} value={k}>
              {FAMILIENSTAND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      {/* Laut Formular nur relevant/abgefragt, wenn NICHT verheiratet. */}
      {entwurf.familienstand && entwurf.familienstand !== "verheiratet" && (
        <label className="text-sm">
          Weitere Angabe zum Wohnsitz (nur bei nicht verheiratet){" "}
          <select
            value={entwurf.wohnsituation ?? ""}
            onChange={(e) =>
              feld(
                "wohnsituation",
                (e.target.value || null) as Wohnsituation | null
              )
            }
            disabled={!canEdit}
          >
            <option value="">— bitte wählen —</option>
            {(Object.keys(WOHNSITUATION_LABELS) as Wohnsituation[]).map((k) => (
              <option key={k} value={k}>
                {WOHNSITUATION_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="rounded border border-neutral-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={entwurf.antrag_gestellt}
            onChange={(e) => feld("antrag_gestellt", e.target.checked)}
            disabled={!canEdit}
          />
          Antrag auf Lohnsteuerabzug (doppelte Haushaltsführung) beim
          Finanzamt gestellt
        </label>
        {entwurf.antrag_gestellt && (
          <label className="mt-2 block text-xs">
            gestellt am{" "}
            <input
              type="date"
              value={entwurf.antrag_gestellt_am ?? ""}
              onChange={(e) => feld("antrag_gestellt_am", e.target.value)}
              disabled={!canEdit}
            />
          </label>
        )}
      </div>

      <label className="text-sm">
        Ausgefüllt am (Ort/Datum auf dem Papierformular){" "}
        <input
          type="date"
          value={entwurf.ausgefuellt_am ?? ""}
          onChange={(e) => feld("ausgefuellt_am", e.target.value)}
          disabled={!canEdit}
        />
      </label>

      {fehler && <p className="text-sm text-red-600">{fehler}</p>}

      {canEdit && (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            onClick={speichern}
            disabled={speichernLaeuft}
          >
            Speichern
          </button>
          <button type="button" className="btn-secondary" onClick={onAbbrechen}>
            Abbrechen
          </button>
        </div>
      )}
    </div>
  );
}
