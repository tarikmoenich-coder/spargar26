"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ABRECHNUNGSART_LABELS, type SeasonSummaryRow } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

export default function UebersichtPage() {
  const [rows, setRows] = useState<SeasonSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [jahr, setJahr] = useState(CURRENT_YEAR);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("season_summary")
        .select("*")
        .eq("saison_jahr", jahr)
        .order("name");
      if (!error) setRows((data as SeasonSummaryRow[]) ?? []);
      setLoading(false);
    }
    load();
  }, [jahr]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Saison-Lohnübersicht
        </h1>
        <p className="text-sm text-neutral-500">
          Automatisch aus Stunden, Prämien, Verpflegungs-/Wohnen-Abzügen und
          Vorschüssen berechnet. <strong>Erster Entwurf</strong> - vor echten
          Auszahlungen unbedingt gegen die bisherige Excel-Datei prüfen
          (siehe README, offener Punkt OI-009).
        </p>
      </div>

      <label className="text-sm">
        Saison-Jahr{" "}
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
          className="w-24"
        />
      </label>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Std.</th>
                <th>Tage</th>
                <th>Abrechnungsart</th>
                <th>Brutto €</th>
                <th>Lohnsteuer (pauschal) €</th>
                <th>Verpfl./Unterkunft €</th>
                <th>Vorschüsse €</th>
                <th>≈ Netto nach Abzügen €</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id}>
                  <td>{r.personal_nr}</td>
                  <td>
                    {r.name}, {r.vorname}
                  </td>
                  <td>{Number(r.gesamt_stunden).toFixed(2)}</td>
                  <td>{r.anwesenheitstage}</td>
                  <td>{ABRECHNUNGSART_LABELS[r.abrechnungsart]}</td>
                  <td>{Number(r.bruttolohn).toFixed(2)}</td>
                  <td>{Number(r.lohnsteuer_pauschal).toFixed(2)}</td>
                  <td>
                    {(
                      Number(r.abzug_verpflegung) + Number(r.abzug_wohnen)
                    ).toFixed(2)}
                  </td>
                  <td>{Number(r.vorschuss_summe).toFixed(2)}</td>
                  <td className="font-medium">
                    {Number(r.nettolohn).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
