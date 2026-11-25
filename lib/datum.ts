// Datums-Helfer in Ortszeit (Rundum-Check 2026-11-25).
//
// `new Date().toISOString().slice(0, 10)` liefert das UTC-Datum - zwischen
// 0 und 1 bzw. 2 Uhr deutscher Zeit ist das noch der Vortag. Ebenso wird ein
// Filter wie `gte("zeitpunkt", "2026-05-04T00:00:00")` von der Datenbank als
// UTC gelesen. Diese Helfer rechnen in der Zeitzone des Browsers (Betrieb:
// Europe/Berlin).

function isoLokal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// "YYYY-MM-DD" von heute (Ortszeit)
export function heuteLokalIso(): string {
  return isoLokal(new Date());
}

// "YYYY-MM-DD" heute + n Tage (Ortszeit), n darf negativ sein
export function lokalIsoPlusTage(n: number, basis: Date = new Date()): string {
  const d = new Date(basis);
  d.setDate(d.getDate() + n);
  return isoLokal(d);
}

// Reines Kalenderdatum + n Tage, ohne Zeitzonen-Verschiebung
export function datumPlusTageIso(isoDatum: string, n: number): string {
  const d = new Date(`${isoDatum.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Tagesgrenzen eines Kalendertags (Ortszeit) als echte Zeitpunkte für
// timestamptz-Filter: .gte(spalte, von).lt(spalte, bis)
export function tagesgrenzenLokal(isoDatum: string): { von: string; bis: string } {
  const von = new Date(`${isoDatum.slice(0, 10)}T00:00:00`);
  const bis = new Date(von);
  bis.setDate(bis.getDate() + 1);
  return { von: von.toISOString(), bis: bis.toISOString() };
}
