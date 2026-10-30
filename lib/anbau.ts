import type { FeldAnbauAbschnitt } from "@/lib/types";

// Gemeinsame kleine Hilfen für die Spargel/Grünspargel-Anbauplanung -
// gebraucht von app/anbau/spargel, app/anbau/erdbeeren, app/anbau/uebersicht
// und app/anbau/ernteplanung.

// Gleiche Formel wie die Sicht feld_anbau_abschnitt_berechnet (SQL) - hier
// als TS-Pendant, damit Anbauübersicht/Ernteplanung die rohe
// feld_anbau_abschnitt-Tabelle direkt verwenden können, ohne eine weitere
// View anzufassen oder einen zweiten Request zu brauchen.
export function abschnittLaufendeMeter(
  a: Pick<FeldAnbauAbschnitt, "laufmeter_gesamt_m" | "reihenlaenge_m" | "reihen_anzahl">
): number {
  return a.laufmeter_gesamt_m ?? (a.reihenlaenge_m ?? 0) * (a.reihen_anzahl ?? 0);
}

export function abschnittNettoHa(
  a: Pick<FeldAnbauAbschnitt, "laufmeter_gesamt_m" | "reihenlaenge_m" | "reihen_anzahl" | "reihenabstand_m">
): number {
  return (abschnittLaufendeMeter(a) * (a.reihenabstand_m ?? 0)) / 10000;
}

// Pflanzjahr ist ein fester Kalenderjahrgang (ändert sich nie) - das
// Standjahr für eine konkrete Saison wird daraus abgeleitet statt Jahr für
// Jahr von Hand hochgezählt zu werden (Migration 2026-10-31).
export function berechneStandjahr(pflanzjahr: number, saisonJahr: number): number {
  return saisonJahr - pflanzjahr + 1;
}

// Schwellwerte für die Anbauübersicht/Ernteplanung (Nutzer-Vorgabe
// 2026-10-31): 1./2. Standjahr = Junganlage, noch keine wirkliche Ernte
// möglich; ab dem 9. Standjahr i.d.R. letztes reguläres Erntejahr.
export const JUNGANLAGE_MAX_STANDJAHR = 2;
export const LETZTES_ERNTEJAHR_STANDJAHR = 9;

export type StandjahrKategorie = "junganlage" | "ertragsanlage" | "letztes_erntejahr" | "ueberstaendig";

export function standjahrKategorie(standjahr: number): StandjahrKategorie {
  if (standjahr <= JUNGANLAGE_MAX_STANDJAHR) return "junganlage";
  if (standjahr < LETZTES_ERNTEJAHR_STANDJAHR) return "ertragsanlage";
  if (standjahr === LETZTES_ERNTEJAHR_STANDJAHR) return "letztes_erntejahr";
  return "ueberstaendig";
}

export const STANDJAHR_KATEGORIE_LABELS: Record<StandjahrKategorie, string> = {
  junganlage: `Junganlage (1.-${JUNGANLAGE_MAX_STANDJAHR}. Stj.)`,
  ertragsanlage: `Ertragsanlage (${JUNGANLAGE_MAX_STANDJAHR + 1}.-${LETZTES_ERNTEJAHR_STANDJAHR - 1}. Stj.)`,
  letztes_erntejahr: `Letztes Erntejahr (${LETZTES_ERNTEJAHR_STANDJAHR}. Stj.)`,
  ueberstaendig: `Überständig (${LETZTES_ERNTEJAHR_STANDJAHR + 1}.+ Stj.)`,
};
