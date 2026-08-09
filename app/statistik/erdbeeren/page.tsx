"use client";

// Statistik Erdbeeren (Nutzer-Vorgabe 2026-08-09) - Tagesstatistik je
// Parzelle, aus der Sicht erdbeeren_statistik_tag. Kosten/Steige nutzt
// einen festen Stundenlohn von 13,90 € (wie bei Zuckermais). Zusätzlich
// eine Saison-Summe je Parzelle (Ertrag/Kosten pro Feld sind für den
// Betrieb wichtig, Nutzer-Vorgabe) - "Ertrag kg" = Summe Steigen × 5
// (1 Steige = 10 Schalen à 500g = 5 kg).

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import StatistikTabs from "@/components/StatistikTabs";
import { formatDatumDE } from "@/lib/format";
import type { ErdbeerenParzelle, ErdbeerenStatistikTag } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();
const KG_PRO_STEIGE = 5;

function fmt(n: number | null | undefined, nachkomma = 2) {
  return n === null || n === undefined ? "—" : n.toFixed(nachkomma);
}

interface ParzellenSumme {
  parzelle_id: number;
  parzelle_name: string;
  summe_steigen: number;
  summe_sut: number;
  summe_stunden: number;
  summe_praemie: number;
}

export default function StatistikErdbeerenPage() {
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [parzellen, setParzellen] = useState<ErdbeerenParzelle[]>([]);
  const [parzelleFilter, setParzelleFilter] = useState<number | "">("");
  const [zeilen, setZeilen] = useState<ErdbeerenStatistikTag[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: p }, { data }] = await Promise.all([
      supabase.from("erdbeeren_parzellen").select("*").order("name"),
      supabase
        .from("erdbeeren_statistik_tag")
        .select("*")
        .gte("datum", `${jahr}-01-01`)
        .lte("datum", `${jahr}-12-31`)
        .order("datum", { ascending: false }),
    ]);
    setParzellen((p as ErdbeerenParzelle[]) ?? []);
    setZeilen((data as ErdbeerenStatistikTag[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  const gefiltert = zeilen.filter(
    (z) => !parzelleFilter || z.parzelle_id === parzelleFilter
  );

  const summeSteigen = gefiltert.reduce((s, z) => s + Number(z.summe_steigen), 0);
  const summeSut = gefiltert.reduce((s, z) => s + Number(z.summe_sut), 0);
  const summeStunden = gefiltert.reduce((s, z) => s + Number(z.summe_stunden), 0);
  const summePraemie = gefiltert.reduce((s, z) => s + Number(z.summe_praemie), 0);
  const gesamtSteigenProStunde =
    summeStunden > 0 ? summeSteigen / summeStunden : null;
  const gesamtKostenProSteige =
    summeSteigen > 0 ? (13.9 * summeStunden + summePraemie) / summeSteigen : null;

  // Saison-Summe je Parzelle - für die Frage "wieviel Ertrag pro Feld
  // kommt runter" (Nutzer-Vorgabe), unabhängig vom Parzellen-Filter oben.
  const jeParzelle = new Map<number, ParzellenSumme>();
  zeilen.forEach((z) => {
    const bestehend = jeParzelle.get(z.parzelle_id);
    if (bestehend) {
      bestehend.summe_steigen += Number(z.summe_steigen);
      bestehend.summe_sut += Number(z.summe_sut);
      bestehend.summe_stunden += Number(z.summe_stunden);
      bestehend.summe_praemie += Number(z.summe_praemie);
    } else {
      jeParzelle.set(z.parzelle_id, {
        parzelle_id: z.parzelle_id,
        parzelle_name: z.parzelle_name,
        summe_steigen: Number(z.summe_steigen),
        summe_sut: Number(z.summe_sut),
        summe_stunden: Number(z.summe_stunden),
        summe_praemie: Number(z.summe_praemie),
      });
    }
  });
  const parzellenSummen = Array.from(jeParzelle.values()).sort((a, b) =>
    a.parzelle_name.localeCompare(b.parzelle_name)
  );

  return (
    <div className="flex flex-col gap-4">
      <StatistikTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Statistik – Erdbeeren
        </h1>
        <p className="text-sm text-neutral-500">
          Tagesstatistik je Parzelle. Kosten/Steige = (13,90 € × Summe
          Stunden + Summe Prämien) / Summe Steigen. Ertrag kg = Summe
          Steigen × {KG_PRO_STEIGE} kg (1 Steige = 10 Schalen à 500g).
        </p>
      </div>

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-3 bg-neutral-50 py-2">
        <label className="text-sm">
          Saison-Jahr{" "}
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-24"
          />
        </label>
        <label className="text-sm">
          Parzelle{" "}
          <select
            value={parzelleFilter}
            onChange={(e) =>
              setParzelleFilter(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">Alle</option>
            {parzellen.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <>
          <div>
            <h2 className="mb-2 text-base font-semibold text-emerald-800">
              Saison-Summe je Parzelle {jahr}
            </h2>
            {parzellenSummen.length === 0 ? (
              <p className="text-neutral-500">Keine Einträge für {jahr}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Parzelle</th>
                      <th>Summe Steigen</th>
                      <th>Ertrag kg</th>
                      <th>Summe Sut</th>
                      <th>Summe Stunden</th>
                      <th>Summe Prämien €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parzellenSummen.map((p) => (
                      <tr key={p.parzelle_id}>
                        <td>{p.parzelle_name}</td>
                        <td>{fmt(p.summe_steigen)}</td>
                        <td>{fmt(p.summe_steigen * KG_PRO_STEIGE)}</td>
                        <td>{fmt(p.summe_sut)}</td>
                        <td>{fmt(p.summe_stunden)}</td>
                        <td>{fmt(p.summe_praemie)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-base font-semibold text-emerald-800">
              Tagesstatistik {jahr}
            </h2>
            {gefiltert.length === 0 ? (
              <p className="text-neutral-500">Keine Einträge für {jahr}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Parzelle</th>
                      <th>Summe Steigen</th>
                      <th>Summe Sut</th>
                      <th>Summe Stunden</th>
                      <th>Summe Prämien €</th>
                      <th>Durchschnitt Steigen/Std.</th>
                      <th>Kosten/Steige €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gefiltert.map((z) => (
                      <tr key={`${z.datum}-${z.parzelle_id}`}>
                        <td>{formatDatumDE(z.datum)}</td>
                        <td>{z.parzelle_name}</td>
                        <td>{fmt(z.summe_steigen)}</td>
                        <td>{fmt(z.summe_sut)}</td>
                        <td>{fmt(z.summe_stunden)}</td>
                        <td>{fmt(z.summe_praemie)}</td>
                        <td>{fmt(z.steigen_pro_stunde)}</td>
                        <td className="font-medium">
                          {fmt(z.kosten_pro_steige, 4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td colSpan={2}>Summe/Durchschnitt</td>
                      <td>{fmt(summeSteigen)}</td>
                      <td>{fmt(summeSut)}</td>
                      <td>{fmt(summeStunden)}</td>
                      <td>{fmt(summePraemie)}</td>
                      <td>{fmt(gesamtSteigenProStunde)}</td>
                      <td>{fmt(gesamtKostenProSteige, 4)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
