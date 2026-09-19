// Wählt aus den je Saisonjahr versionierten Sätzen (verpflegungssaetze,
// ADR-007: Verpflegung/Unterkunft/Mindestlohn) den passenden für ein Jahr.
//
// Vorher nahmen mehrere Seiten schlicht "den neuesten Eintrag" - sobald für
// das Folgejahr schon ein Satz angelegt war (z.B. 2027), bekamen dadurch auch
// Personen der laufenden Saison den Mindestlohn bzw. die Tagessätze des
// Folgejahres vorgeschlagen (Nutzer-Meldung 2026-09-19).
//
// Ohne Eintrag für genau dieses Jahr gilt der jüngste frühere (die Sätze
// gelten dann weiter), sonst der früheste vorhandene.
export function satzFuerJahr<T extends { saison_jahr: number }>(
  saetze: T[],
  jahr: number
): T | null {
  const genau = saetze.find((s) => s.saison_jahr === jahr);
  if (genau) return genau;
  const frueher = saetze
    .filter((s) => s.saison_jahr < jahr)
    .sort((a, b) => b.saison_jahr - a.saison_jahr)[0];
  if (frueher) return frueher;
  return [...saetze].sort((a, b) => a.saison_jahr - b.saison_jahr)[0] ?? null;
}

// Jahr aus einem ISO-Datum ("2027-04-01"), sonst das Ausweichjahr.
export function jahrAusDatum(iso: string | null | undefined, fallback: number): number {
  const j = iso ? Number(iso.slice(0, 4)) : NaN;
  return Number.isFinite(j) && j > 1990 ? j : fallback;
}
