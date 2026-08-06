// Gemeinsame Datumsformatierung für die Anzeige (nicht für <input>-Werte -
// die brauchen laut HTML-Standard immer "YYYY-MM-DD").

// "2026-04-23" -> "23.04.2026". Gibt den Originalwert zurück, falls er
// nicht dem erwarteten ISO-Format entspricht.
export function formatDatumDE(iso: string | null | undefined): string {
  if (!iso) return "—";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const [, jahr, monat, tag] = match;
  return `${tag}.${monat}.${jahr}`;
}

// "13.9" -> "13,90" (deutsches Format, z.B. für generierte Vertragsdokumente).
export function formatEuro(wert: number | null | undefined): string {
  if (wert === null || wert === undefined) return "";
  return wert.toFixed(2).replace(".", ",");
}
