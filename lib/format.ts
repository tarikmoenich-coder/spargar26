// Gemeinsame Anzeige-Formatierung. Zahlen werden durchgängig im deutschen
// Format ausgegeben: Punkt als 1000er-Trennzeichen, Komma als Dezimaltrenner
// (z.B. 12.345,60). NICHT für <input>-Werte (die brauchen "YYYY-MM-DD" bzw.
// "1234.56") und NICHT für maschinelle Formate wie die SEPA-XML (lib/sepa.ts).

// "2026-04-23" -> "23.04.2026". Gibt den Originalwert zurück, falls er
// nicht dem erwarteten ISO-Format entspricht.
export function formatDatumDE(iso: string | null | undefined): string {
  if (!iso) return "—";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const [, jahr, monat, tag] = match;
  return `${tag}.${monat}.${jahr}`;
}

// Geldbeträge: 13.9 -> "13,90", 12345.6 -> "12.345,60". Bei null/undefined
// ein leerer String (so verlassen sich die Vertragsdokument-Generatoren
// darauf) - für Tabellen mit "—"-Platzhalter dort selbst prüfen oder
// formatMenge() nutzen.
const euroFmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function formatEuro(wert: number | null | undefined): string {
  if (wert === null || wert === undefined || Number.isNaN(Number(wert)))
    return "";
  return euroFmt.format(Number(wert));
}

// Allgemeine Zahl mit fester Nachkommastellenzahl im deutschen Format
// (1000er-Punkt, Dezimalkomma). Für Mengen: kg, Stunden, kg/h, €-Sätze usw.
// null/undefined -> "—".
export function formatMenge(
  wert: number | null | undefined,
  nachkomma = 2
): string {
  if (wert === null || wert === undefined || Number.isNaN(Number(wert)))
    return "—";
  return Number(wert).toLocaleString("de-DE", {
    minimumFractionDigits: nachkomma,
    maximumFractionDigits: nachkomma,
  });
}

// 12345.6 -> "12.346" (deutsche 1000er-Punkte, auf ganze Zahlen gerundet -
// für Mengen wie Kolben, wo Nachkommastellen keine praktische Bedeutung
// haben, siehe components/MaisStatistikKachel.tsx).
export function formatZahlDE(wert: number | null | undefined): string {
  if (wert === null || wert === undefined) return "—";
  return Math.round(wert).toLocaleString("de-DE");
}
