"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ABRECHNUNGSART_LABELS, type SvPruefung } from "@/lib/types";
import { formatDatumDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();

export default function ManagementPage() {
  const [faelle, setFaelle] = useState<SvPruefung[]>([]);
  const [loading, setLoading] = useState(true);
  const [jahr, setJahr] = useState(CURRENT_YEAR);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("employee_sv_pruefung")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("kritisch", true)
        .order("arbeitstage_ueber0", { ascending: false });
      if (!error) setFaelle((data as SvPruefung[]) ?? []);
      setLoading(false);
    }
    load();
  }, [jahr]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Management
        </h1>
        <p className="text-sm text-neutral-500">
          90-Tage-/15-Wochen-Kontrolle: Personen, bei denen die Grenze für
          sozialversicherungsfreie kurzfristige Beschäftigung bereits
          überschritten ist. Reine Tage-/Wochen-Zählung – ersetzt nicht die
          rechtliche Prüfung der Sozialversicherungsbefreiung selbst.
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
      ) : faelle.length === 0 ? (
        <p className="text-neutral-500">
          Keine kritischen Fälle für {jahr}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Abrechnungsart</th>
                <th>1. Arbeitstag</th>
                <th>Letzter Arbeitstag</th>
                <th>Arbeitstage &gt; 0</th>
                <th>Rest bis 90 Tage</th>
                <th>Austrittsdatum (15 Wo.)</th>
                <th>Grund</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {faelle.map((f) => (
                <tr key={f.employee_id}>
                  <td>{f.personal_nr}</td>
                  <td>
                    {f.name}, {f.vorname}
                    {!f.aktiv && (
                      <span className="ml-1 text-xs text-neutral-500">
                        (inaktiv)
                      </span>
                    )}
                  </td>
                  <td>{ABRECHNUNGSART_LABELS[f.abrechnungsart]}</td>
                  <td>{formatDatumDE(f.erster_arbeitstag)}</td>
                  <td>{formatDatumDE(f.letzter_arbeitstag)}</td>
                  <td>{f.arbeitstage_ueber0}</td>
                  <td>{f.rest_bis_90_tage}</td>
                  <td>{formatDatumDE(f.austrittsdatum_15_wochen)}</td>
                  <td className="text-sm">
                    {[
                      f.ueberschritten_90_tage ? "90-Tage-Grenze" : null,
                      f.ueberschritten_15_wochen ? "15-Wochen-Grenze" : null,
                    ]
                      .filter(Boolean)
                      .join(" + ")}
                  </td>
                  <td className="font-medium text-red-600">⚠ Überschritten</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
