// Gemeinsame Rechenregeln der Personalplanung (Nutzer-Vorgabe 2026-11-21):
// Soll je Herkunft, zugesagte Personen (Namen + Platzhalter, ohne Reserve),
// Führerschein-Quote und Anwesenheitszeitraum für den Zeitstrahl. Von der
// Namensliste, der Soll-Übersicht und dem Zeitstrahl gemeinsam genutzt,
// damit alle drei exakt gleich zählen.
import { arbeitsendeAuto } from "@/lib/planungTermine";
import type { PersonalKandidat } from "@/lib/types";

// Planungsjahr, das die Seite standardmäßig zeigt: ab September wird für die
// Folgesaison geplant (gleiche Regel wie beim Nachtragen der Migration).
export function standardPlanungsJahr(heute = new Date()): number {
  return heute.getMonth() >= 8 ? heute.getFullYear() + 1 : heute.getFullYear();
}

// Zählt für Soll/Ist, Zeitstrahl und Bettenplanung: geplant oder schon auf
// der Anreiseliste, nicht storniert, nicht Reserve.
export function istZugesagt(k: PersonalKandidat): boolean {
  return (
    (k.status === "geplant" || k.status === "anreiseliste") && !k.reserve
  );
}

// "Mit Führerschein B" = B oder höher (BE/C/CE setzen B voraus).
export function hatFuehrerscheinB(k: PersonalKandidat): boolean {
  return (k.fuehrerschein_kategorien ?? []).length > 0;
}

// Nutzer-Vorgabe: je Herkunft grob 20 % mit Führerschein B, also pro 5
// Personen einer - aufgerundet (lieber ein Fahrer mehr als einer zu wenig).
export const FUEHRERSCHEIN_ANTEIL = 0.2;
export function fuehrerscheinZiel(basis: number): number {
  return basis > 0 ? Math.ceil(basis * FUEHRERSCHEIN_ANTEIL - 1e-9) : 0;
}

// Anwesenheitszeitraum für den Zeitstrahl: ab geplanter Ankunft (sonst
// Arbeitsbeginn) bis Arbeitsende (sonst automatisch Beginn + 104 Tage).
export function anwesenheit(
  k: PersonalKandidat
): { von: string; bis: string } | null {
  const von = k.geplante_ankunft ?? k.arbeitsbeginn_datum;
  if (!von) return null;
  return { von, bis: k.arbeitsende_datum ?? arbeitsendeAuto(von) };
}

// Kategorische Farben (Referenzpalette der Diagramm-Richtlinie, feste
// Reihenfolge). Die Farbe hängt an der Herkunft (Position in der festen
// Herkünfte-Liste), nicht an der Anzahl - ab der 9. Herkunft grau.
export const HERKUNFT_FARBEN = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];
export const FARBE_WEITERE = "#8a8984";

export function herkunftFarbe(herkunftListe: string[], herkunft: string | null) {
  const i = herkunft ? herkunftListe.indexOf(herkunft) : -1;
  return i >= 0 && i < HERKUNFT_FARBEN.length ? HERKUNFT_FARBEN[i] : FARBE_WEITERE;
}

// Anzeigename einer Zeile - Platzhalter heißen "N.N.".
export function kandidatAnzeige(k: PersonalKandidat): string {
  if (k.platzhalter) return "N.N. (Platzhalter)";
  return `${k.name ?? ""}, ${k.vorname ?? ""}`;
}
