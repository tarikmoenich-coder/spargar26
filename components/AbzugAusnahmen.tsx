"use client";

// Zeiträume OHNE Unterkunft bzw. OHNE Verpflegung je Person (Stufe 3c,
// 2026-11-25). An Anwesenheitstagen in einem solchen Zeitraum wird der
// jeweilige Abzug in der Lohnübersicht nicht berechnet (season_summary).
// Ohne Eintrag: wie bisher an jedem Anwesenheitstag. Typisch: Verkäufer,
// die nicht bei uns wohnen (Unterkunft ab Saisonbeginn, offenes Ende) oder
// ab einem Monat nicht mehr mitessen.
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import type { AbzugAusnahme } from "@/lib/types";

const ART_LABEL: Record<AbzugAusnahme["art"], string> = {
  verpflegung: "ohne Verpflegung",
  unterkunft: "ohne Unterkunft",
};

export default function AbzugAusnahmen({
  employeeId,
  canEdit,
}: {
  employeeId: string;
  canEdit: boolean;
}) {
  const [liste, setListe] = useState<AbzugAusnahme[]>([]);
  const [art, setArt] = useState<AbzugAusnahme["art"]>("verpflegung");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [notiz, setNotiz] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  async function laden() {
    const { data } = await getSupabaseClient()
      .from("employee_abzug_ausnahme")
      .select("*")
      .eq("employee_id", employeeId)
      .order("von");
    setListe((data as AbzugAusnahme[]) ?? []);
  }

  useEffect(() => {
    laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function hinzufuegen(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!von) {
      setFehler("Bitte ein Von-Datum angeben.");
      return;
    }
    const { error } = await getSupabaseClient()
      .from("employee_abzug_ausnahme")
      .insert({ employee_id: employeeId, art, von, bis: bis || null, notiz: notiz.trim() || null });
    if (error) {
      setFehler(error.message);
      return;
    }
    setVon("");
    setBis("");
    setNotiz("");
    laden();
  }

  async function entfernen(a: AbzugAusnahme) {
    if (!window.confirm(`Zeitraum „${ART_LABEL[a.art]}" ab ${formatDatumDE(a.von)} entfernen?`)) return;
    const { error } = await getSupabaseClient().from("employee_abzug_ausnahme").delete().eq("id", a.id);
    if (error) setFehler(error.message);
    laden();
  }

  return (
    <div className="flex flex-col gap-2 text-[10.5pt]">
      {liste.length === 0 ? (
        <p className="text-neutral-500">
          Keine Ausnahmen - Unterkunft und Verpflegung werden an jedem Anwesenheitstag berechnet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {liste.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{ART_LABEL[a.art]}</span>
              <span>
                ab {formatDatumDE(a.von)}
                {a.bis ? ` bis ${formatDatumDE(a.bis)}` : " (offen)"}
              </span>
              {a.notiz && <span className="text-neutral-500">· {a.notiz}</span>}
              {canEdit && (
                <button
                  type="button"
                  className="text-xs text-beere-600 underline print:hidden"
                  onClick={() => entfernen(a)}
                >
                  entfernen
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={hinzufuegen} className="flex flex-wrap items-end gap-2 text-xs print:hidden">
          <select value={art} onChange={(e) => setArt(e.target.value as AbzugAusnahme["art"])}>
            <option value="verpflegung">ohne Verpflegung</option>
            <option value="unterkunft">ohne Unterkunft</option>
          </select>
          <label className="flex flex-col">
            von
            <input type="date" value={von} onChange={(e) => setVon(e.target.value)} />
          </label>
          <label className="flex flex-col">
            bis (leer = offen)
            <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} />
          </label>
          <input placeholder="Notiz (optional)" value={notiz} onChange={(e) => setNotiz(e.target.value)} />
          <button type="submit" className="btn-secondary">Zeitraum hinzufügen</button>
          {fehler && <span className="text-beere-600">{fehler}</span>}
        </form>
      )}
    </div>
  );
}
