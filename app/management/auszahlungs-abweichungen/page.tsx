"use client";

import { useEffect, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import { findeAbweichungen, type Abweichung } from "@/lib/controlling";
import type { SeasonSummaryRow } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";

const CURRENT_YEAR = new Date().getFullYear();

export default function ControllingAbweichungenPage() {
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [abweichungen, setAbweichungen] = useState<
    { row: SeasonSummaryRow; belegnummer: string; diffs: Abweichung[] }[]
  >([]);
  const [loadingAbw, setLoadingAbw] = useState(true);

  useEffect(() => {
    async function loadAbweichungen() {
      setLoadingAbw(true);
      const supabase = getSupabaseClient();
      const [{ data: rows, error }, { data: belege }] = await Promise.all([
        supabase
          .from("season_summary")
          .select("*")
          .eq("saison_jahr", jahr)
          .not("snapshot", "is", null)
          .order("name"),
        supabase
          .from("auszahlungsbelege")
          .select("id, belegnummer")
          .eq("saison_jahr", jahr),
      ]);
      if (!error && rows) {
        const belegnummerVon = new Map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (belege ?? []).map((b: any) => [b.id, b.belegnummer as string])
        );
        const ergebnis = (rows as SeasonSummaryRow[])
          .map((r) => ({
            row: r,
            belegnummer: r.auszahlungsbeleg_id
              ? belegnummerVon.get(r.auszahlungsbeleg_id) ?? "—"
              : "—",
            diffs: findeAbweichungen(r),
          }))
          .filter((e) => e.diffs.length > 0);
        setAbweichungen(ergebnis);
      }
      setLoadingAbw(false);
    }
    loadAbweichungen();
  }, [jahr]);

  return (
    <div className="flex flex-col gap-4">
      <ControllingTabs />
      <PageHeader
        icon={GitCompareArrows}
        titel="Abweichungen bei Auszahlungen"
        beschreibung="Personen, die bereits abgerechnet wurden („Jetzt Abrechnen“), bei denen sich seither mindestens ein Wert geändert hat (z. B. ein nachträglich korrigierter Vorschuss oder ein geänderter Satz) – mit genauer Angabe, welcher Wert sich wie geändert hat. Entspricht dem „⚠“ auf der Auszahlungen-Seite."
      />

      <p className="text-sm text-neutral-600">
        Personen mit Abweichung:{" "}
        <span className="font-medium text-amber-600">
          {loadingAbw ? "…" : abweichungen.length}
        </span>
      </p>

      <label className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 block bg-sand py-2 text-sm">
        Saison-Jahr{" "}
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
          className="w-24"
        />
      </label>

      {loadingAbw ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : abweichungen.length === 0 ? (
        <p className="text-neutral-500">Keine Abweichungen für {jahr}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Beleg-Nr.</th>
                <th>Abgerechnet am</th>
                <th>Geänderte Werte</th>
              </tr>
            </thead>
            <tbody>
              {abweichungen.map(({ row, belegnummer, diffs }) => (
                <tr key={row.employee_id}>
                  <td>{row.personal_nr}</td>
                  <td>
                    {row.name}, {row.vorname}
                  </td>
                  <td>{belegnummer}</td>
                  <td>{formatDatumDE(row.abgerechnet_am)}</td>
                  <td className="text-sm">
                    <ul className="flex flex-col gap-0.5">
                      {diffs.map((d) => (
                        <li key={d.feld}>
                          <span className="font-medium">{d.feld}:</span> {d.alt}{" "}
                          <span className="text-amber-600">→</span> {d.neu}
                        </li>
                      ))}
                    </ul>
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
