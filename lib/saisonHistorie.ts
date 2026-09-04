import type { EmployeeSaisonHistorieAgg } from "./types";

// Kurzlabel für Listen, z.B. "zuletzt 2019 · erstmals 2011 · 5 Saisons".
// null, wenn keine Historie hinterlegt ist.
export function historieKurz(
  agg: EmployeeSaisonHistorieAgg | undefined | null
): string | null {
  if (!agg || agg.anzahl_saisons === 0) return null;
  if (agg.anzahl_saisons === 1) return `nur ${agg.letzte_saison}`;
  return `zuletzt ${agg.letzte_saison} · erstmals ${agg.erste_saison} · ${agg.anzahl_saisons} Saisons`;
}

// Baut aus der sortierten Jahresliste zusammenhängende Blöcke:
// [2011,2012,2013,2016,2019] -> "2011–2013, 2016, 2019".
export function saisonsKompakt(saisons: number[]): string {
  if (saisons.length === 0) return "—";
  const jahre = [...saisons].sort((a, b) => a - b);
  const teile: string[] = [];
  let start = jahre[0];
  let prev = jahre[0];
  for (let i = 1; i <= jahre.length; i++) {
    const j = jahre[i];
    if (j === prev + 1) {
      prev = j;
      continue;
    }
    teile.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = j;
    prev = j;
  }
  return teile.join(", ");
}
