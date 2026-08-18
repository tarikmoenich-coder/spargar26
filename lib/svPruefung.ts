// Gemeinsame Hilfsfunktionen für die SV-Prüfung (90-Tage-/15-Wochen-/
// SV-frei-Zeitraum-Logik) - genutzt von "Personal → Sozialversicherung"
// und "Controlling" (app/management/page.tsx), damit die Berechnung nur
// an einer Stelle steht. Siehe schema.sql (employee_sv_pruefung) für die
// serverseitige Herleitung von austrittsdatum_empfohlen.

import type { SvAbschnitt, SvPruefung } from "./types";
import { formatDatumDE } from "./format";

// Heutiges Datum als LOKALES Kalenderdatum (nicht UTC!) - wichtig, siehe
// Lehre aus dem xlsx-Datum-Timezone-Bug: new Date().toISOString() würde
// nahe Mitternacht je nach Zeitzone den falschen Tag liefern, weil es erst
// nach UTC konvertiert.
function heutigesDatumLokalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const t = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${t}`;
}

// Differenz in Tagen zwischen zwei Datums-Strings (YYYY-MM-DD) - beide auf
// UTC-Mittag verankert, um DST-Kanten bei der Differenzbildung zu
// vermeiden (reine Kalendertage-Differenz, unabhängig von Uhrzeit/Zeitzone
// des Browsers).
function tageZwischen(vonIso: string, bisIso: string): number {
  const [y1, m1, d1] = vonIso.split("-").map(Number);
  const [y2, m2, d2] = bisIso.split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1, 12);
  const t2 = Date.UTC(y2, m2 - 1, d2, 12);
  return Math.round((t2 - t1) / 86400000);
}

// Die maßgebliche Tage-Grenze für sozialversicherungsfreie
// Saisonbeschäftigung in der Landwirtschaft: 15 Wochen = 105 Kalendertage
// je Kalenderjahr. Die 90-Arbeitstage-Grenze wurde 2026-08-11 entfernt -
// sie gilt nur für Beschäftigungen an weniger als 5 Tagen pro Woche, was im
// Betrieb nicht vorkommt (Nutzer-Recherche).
export const TAGE_GRENZE = 105;

// Beschreibt, woraus sich das Gesamtbudget zusammensetzt - mit
// Vorbeschäftigung bei anderen deutschen Arbeitgebern bzw. mit mehreren
// eigenen Beschäftigungsabschnitten wird zusammengerechnet.
export function angewendeteRegel(p: SvPruefung): string {
  const teile: string[] = [];
  if (p.anzahl_abschnitte > 1) {
    // Nutzer-Vorgabe 2026-08-14: "Die verschiedenen Abschnitte müssen
    // transparent benannt und gerechnet werden" - deshalb nicht nur die
    // Anzahl, sondern auch WANN der aktuell laufende Abschnitt begonnen
    // hat (maßgeblich für die 105-Tage-Berechnung, nicht der allererste
    // Tag der Saison - siehe aktueller_abschnitt_seit in schema.sql).
    teile.push(
      `verteilt auf ${p.anzahl_abschnitte} Abschnitte, aktueller Abschnitt seit ${formatDatumDE(p.aktueller_abschnitt_seit)}`
    );
  }
  if (p.vorbeschaeftigung_deutschland_tage > 0) {
    // "abzgl." statt "+" (Nutzer-Hinweis 2026-08-11): die Vorbeschäftigung
    // wird vom Budget ABGEZOGEN, ein Pluszeichen las sich so, als käme sie
    // zu den 105 Tagen hinzu.
    teile.push(
      `abzgl. ${p.vorbeschaeftigung_deutschland_tage} Tage Vorbeschäftigung`
    );
  }
  return teile.length === 0
    ? "15 Wochen (105 Tage)"
    : `15 Wochen (105 Tage), ${teile.join(", ")}`;
}

// Resttage bis zum (bereits serverseitig korrekt zusammengeführten)
// empfohlenen Austrittsdatum - positiv = noch Tage übrig, negativ =
// bereits überschritten. austrittsdatum_empfohlen vereint bereits
// 15-Wochen-Ende, SV-frei-Ende laut Angaben UND (im Rückkehr-Fall) das
// exakte 90-Tage-kombiniert-Enddatum (siehe schema.sql).
export function svFreiheitResttage(p: SvPruefung): number | null {
  if (!p.austrittsdatum_empfohlen) return null;
  return tageZwischen(heutigesDatumLokalIso(), p.austrittsdatum_empfohlen);
}

// Farbklasse nach Nutzer-Vorgabe 2026-08-10: unter 7 Tage gelb, unter 0
// Tage (bereits überschritten) rot, sonst neutral.
export function resttageFarbeClass(tage: number): string {
  if (tage < 0) return "font-medium text-red-600";
  if (tage < 7) return "font-medium text-amber-600";
  return "";
}

// Lesbarer Text für die Resttage-Zahl.
export function resttageText(tage: number): string {
  return tage < 0
    ? `Überschritten seit ${Math.abs(tage)} Tag(en)`
    : `${tage} Tage`;
}

// Nur die SV-frei-Zeitraum-spezifischen Diskrepanzen (nicht 90-Tage-/
// 15-Wochen-Überschreitung) - Nutzer-Vorgabe 2026-08-10: für die
// nachträgliche "SV-Freiheit Diskrepanz"-Übersicht bei bereits inaktiven
// Personen relevant ("wenn die Aktiv-Zeit eines Inaktiven immer noch den
// SV-frei Zeitraum überschreitet"). Spiegelt exakt die SV-frei-Teile der
// "kritisch"-Formel in employee_sv_pruefung (schema.sql).
export function svFreiZeitraumUeberschritten(p: SvPruefung): boolean {
  // Bugfix 2026-08-15: die Lücke-Prüfung lief hier bisher clientseitig
  // gegen erster_arbeitstag/letzter_arbeitstag (Spanne über ALLE
  // Abschnitte hinweg) - dadurch schlug sie fälschlich an, sobald
  // irgendein früherer UND irgendein späterer Abschnitt existierten, egal
  // ob die Lücke selbst je bearbeitet wurde. Jetzt server-seitig korrekt
  // je EINZELNEM Abschnitt geprüft, siehe ueberschritten_sv_frei_luecke
  // in employee_sv_pruefung (schema.sql).
  return (
    p.ueberschritten_sv_frei_beginn ||
    p.ueberschritten_sv_frei_ende ||
    p.ueberschritten_sv_frei_luecke
  );
}

// Textuelle Aufschlüsselung, wie sich die 105-Tage-Zahl zusammensetzt -
// als Tooltip-Text (Nutzer-Vorgabe 2026-08-15, nach wiederholter
// Verwirrung über die Herleitung von "Rest bis 105 Tage"/"Angewendete
// Regel"): jeder Beschäftigungsabschnitt einzeln mit Zeitraum und
// Tage-Zahl, plus Vorbeschäftigung, plus die Summe. `abschnitte` ist die
// KOMPLETTE, ungefilterte Liste aus employee_sv_abschnitte - die Funktion
// filtert selbst auf diese Person/Saison.
export function tageAufschluesselung(
  p: SvPruefung,
  abschnitte: SvAbschnitt[]
): string {
  const zeilen = abschnitte
    .filter(
      (a) => a.employee_id === p.employee_id && a.saison_jahr === p.saison_jahr
    )
    .sort((a, b) => a.von.localeCompare(b.von))
    .map((a) => {
      const aktuell = a.von === p.aktueller_abschnitt_seit ? " (aktuell)" : "";
      return `${formatDatumDE(a.von)}–${formatDatumDE(a.bis)}${aktuell}: ${a.tage} Tage`;
    });
  if (p.vorbeschaeftigung_deutschland_tage > 0) {
    zeilen.push(
      `Vorbeschäftigung Deutschland: ${p.vorbeschaeftigung_deutschland_tage} Tage`
    );
  }
  zeilen.push(`Summe: ${p.kombinierte_tage} von 105 Tagen`);
  return "So setzen sich die Tage zusammen:\n" + zeilen.join("\n");
}
