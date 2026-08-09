"use client";

// Statistik Zuckermais (Nutzer-Vorgabe 2026-08-09) - Tagesstatistik über
// alle Mitarbeiter, aus der Sicht zuckermais_statistik_tag. Kosten/Kolben
// nutzt einen festen Stundenlohn von 13,90 € (Nutzer-Vorgabe, exakt wie
// angegeben - nicht der individuelle Stundenlohn je Person), berechnet in
// der Datenbank-Sicht.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import StatistikTabs from "@/components/StatistikTabs";
import { formatDatumDE } from "@/lib/format";
import type { ZuckermaisStatistikTag } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

function fmt(n: number | null | undefined, nachkomma = 2) {
  return n === null || n === undefined ? "—" : n.toFixed(nachkomma);
}

export default function StatistikZuckermaisPage() {
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [zeilen, setZeilen] = useState<ZuckermaisStatistikTag[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("zuckermais_statistik_tag")
      .select("*")
      .gte("datum", `${jahr}-01-01`)
      .lte("datum", `${jahr}-12-31`)
      .order("datum", { ascending: false });
    if (!error) setZeilen((data as ZuckermaisStatistikTag[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  const summeKisten = zeilen.reduce((s, z) => s + Number(z.summe_kisten), 0);
  const summeKolben = zeilen.reduce((s, z) => s + Number(z.summe_kolben), 0);
  const summeStunden = zeilen.reduce((s, z) => s + Number(z.summe_stunden), 0);
  const summePraemie = zeilen.reduce((s, z) => s + Number(z.summe_praemie), 0);
  const gesamtKolbenProStunde = summeStunden > 0 ? summeKolben / summeStunden : null;
  const gesamtKostenProKolben =
    summeKolben > 0 ? (13.9 * summeStunden + summePraemie) / summeKolben : null;

  return (
    <div className="flex flex-col gap-4">
      <StatistikTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Statistik – Zuckermais
        </h1>
        <p className="text-sm text-neutral-500">
          Tagesstatistik über alle Mitarbeiter. Kosten/Kolben ={" "}
          (13,90 € × Summe Stunden + Summe Prämien) / Summe Kolben.
        </p>
      </div>

      <label className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 block bg-neutral-50 py-2 text-sm">
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
      ) : zeilen.length === 0 ? (
        <p className="text-neutral-500">Keine Einträge für {jahr}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Summe Kisten</th>
                <th>Summe Kolben</th>
                <th>Summe Stunden</th>
                <th>Summe Prämien €</th>
                <th>Durchschnitt Kolben/Std.</th>
                <th>Kosten/Kolben €</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.datum}>
                  <td>{formatDatumDE(z.datum)}</td>
                  <td>{fmt(z.summe_kisten)}</td>
                  <td>{fmt(z.summe_kolben)}</td>
                  <td>{fmt(z.summe_stunden)}</td>
                  <td>{fmt(z.summe_praemie)}</td>
                  <td>{fmt(z.kolben_pro_stunde)}</td>
                  <td className="font-medium">{fmt(z.kosten_pro_kolben, 4)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Saison {jahr}</td>
                <td>{fmt(summeKisten)}</td>
                <td>{fmt(summeKolben)}</td>
                <td>{fmt(summeStunden)}</td>
                <td>{fmt(summePraemie)}</td>
                <td>{fmt(gesamtKolbenProStunde)}</td>
                <td>{fmt(gesamtKostenProKolben, 4)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
