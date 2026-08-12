// Gemeinsame Hilfsfunktionen für die SV-Prüfung (90-Tage-/15-Wochen-/
// SV-frei-Zeitraum-Logik) - genutzt von "Personal → Sozialversicherung"
// und "Controlling" (app/management/page.tsx), damit die Berechnung nur
// an einer Stelle steht. Siehe schema.sql (employee_sv_pruefung) für die
// serverseitige Herleitung von austrittsdatum_empfohlen.

import type { SvPruefung } from "./types";

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
    teile.push(`verteilt auf ${p.anzahl_abschnitte} Abschnitte`);
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
  return (
    p.ueberschritten_sv_frei_beginn ||
    p.ueberschritten_sv_frei_ende ||
    (p.sv_frei_luecke &&
      !!p.sv_frei_luecke_von &&
      !!p.sv_frei_luecke_bis &&
      p.erster_arbeitstag <= p.sv_frei_luecke_bis &&
      p.letzter_arbeitstag >= p.sv_frei_luecke_von)
  );
}
