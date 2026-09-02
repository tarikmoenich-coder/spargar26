// Wochen-/Kalendertag-Helfer (deutsche Wochenordnung, 0 = Montag).
// Extrahiert 2026-09-02 - dieselben Funktionen lagen bisher lokal in
// app/suche/page.tsx und app/erfassung/page.tsx. Neu genutzt vom
// Controlling-Wochenraster (app/management/arbeitstage/page.tsx).
//
// Reine String-Arithmetik auf "YYYY-MM-DD" über UTC-Millisekunden - eine
// lokale Berechnung könnte je nach Zeitzone/Sommerzeit auf den falschen
// Tag springen (gleicher Fallstrick wie beim xlsx-Datumsimport).

export const WOCHENTAGE = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

export const WOCHENTAGE_KUERZEL = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function addTageIso(iso: string, delta: number): string {
  const [j, m, t] = iso.split("-").map(Number);
  const ms = Date.UTC(j, m - 1, t) + delta * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// 0 = Montag ... 6 = Sonntag (JS selbst zählt Sonntag als 0).
export function wochentagIndex(iso: string): number {
  const [j, m, t] = iso.split("-").map(Number);
  const jsTag = new Date(Date.UTC(j, m - 1, t)).getUTCDay();
  return (jsTag + 6) % 7;
}

export function montagDerWoche(iso: string): string {
  return addTageIso(iso, -wochentagIndex(iso));
}

export function sonntagDerWoche(iso: string): string {
  return addTageIso(montagDerWoche(iso), 6);
}

export function wochentagKuerzel(iso: string): string {
  return WOCHENTAGE_KUERZEL[wochentagIndex(iso)];
}

// "18.08." statt vollem Datum - die Spaltenüberschrift nennt den Wochentag.
export function tagMonat(iso: string): string {
  const [, m, t] = iso.split("-");
  return `${t}.${m}.`;
}

export interface Wochentagzelle<T> {
  datum: string;
  entry: T | undefined;
}

export interface Wochenzeile<T> {
  montag: string;
  tage: Wochentagzelle<T>[];
  summe: number;
}

// Eine Zeile je Kalenderwoche (Mo-So) von vonMontag bis einschließlich der
// Woche von bisSonntag. entries wird nach datum indiziert; summe = Summe der
// stunden je Woche (fehlende Tage zählen 0).
export function wochenBauen<
  T extends { datum: string; stunden?: number | string | null }
>(entries: T[], vonMontag: string, bisSonntag: string): Wochenzeile<T>[] {
  const byDatum = new Map(entries.map((e) => [e.datum, e]));
  const wochen: Wochenzeile<T>[] = [];
  let montag = montagDerWoche(vonMontag);
  while (montag <= bisSonntag) {
    const tage: Wochentagzelle<T>[] = Array.from({ length: 7 }, (_, i) => {
      const datum = addTageIso(montag, i);
      return { datum, entry: byDatum.get(datum) };
    });
    const summe = tage.reduce(
      (s, tag) => s + Number(tag.entry?.stunden ?? 0),
      0
    );
    wochen.push({ montag, tage, summe });
    montag = addTageIso(montag, 7);
  }
  return wochen;
}
