// Logik für die 10 Personalnummern-Kreise: Kreis 1 = 1-999, Kreis 2 =
// 1000-1999, Kreis 3 = 2000-2999, usw. Historisch nach Herkunft vergeben.
// Nummern werden nie neu vergeben (auch inaktive Mitarbeiter behalten ihre
// Nummer), daher zählt bei "belegt" der gesamte Personalstamm.

export const ANZAHL_PERSONALNUMMERN_KREISE = 10;

export function kreisBereich(kreis: number): [number, number] {
  if (kreis === 1) return [1, 999];
  return [(kreis - 1) * 1000, kreis * 1000 - 1];
}

// Extrahiert den führenden Zahlenanteil, z.B. "8226a" -> 8226.
// Personalnummern ohne führende Ziffer (selten) liefern null.
export function parsePersonalNrNummer(personalNr: string): number | null {
  const match = personalNr.match(/^(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

export function naechsteFreieNummer(
  belegteNummern: Set<number>,
  kreis: number
): number | null {
  const [von, bis] = kreisBereich(kreis);
  for (let n = von; n <= bis; n++) {
    if (!belegteNummern.has(n)) return n;
  }
  return null;
}
