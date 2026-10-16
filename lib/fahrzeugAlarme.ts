// Tracker-Alarme fürs Fahrzeuge-Modul (Nutzer-Sorge 2026-10-16 bei der
// Inbetriebnahme von 100+ Trackern: bei so vielen Fahrzeugen fällt es nicht
// mehr auf, wenn ein sonst täglich aktiver Tracker plötzlich schweigt). Eine
// einzige Funktion, von der Stammdaten- UND der Übersicht-Seite genutzt, damit
// beide exakt dieselbe Einstufung zeigen.

// Schwelle für "Hof verlassen, nicht zurückgekehrt" - gilt UNABHÄNGIG von
// Fahrzeugtyp/Status (auch abgemeldete Fahrzeuge, Nutzer-Vorgabe 2026-10-16:
// "Betrifft auch abgemeldete Fahrzeuge").
const HOF_VERLASSEN_KRITISCH_STUNDEN = 24;

// Allgemeine Stille-Erkennung (nur aktive Fahrzeuge) - Traktoren bekommen
// deutlich großzügigere Schwellen, weil sie saisonbedingt viel länger
// unbewegt stehen können als der Rest der Flotte (Nutzer-Vorgabe 2026-10-16).
const STILLE_WARNUNG_STUNDEN = 24;
const STILLE_KRITISCH_STUNDEN = 72;
const STILLE_WARNUNG_STUNDEN_TRAKTOR = 14 * 24;
const STILLE_KRITISCH_STUNDEN_TRAKTOR = 30 * 24;

export type FahrzeugAlarmStufe = "rot-hof" | "kritisch" | "warnung";

export interface FahrzeugAlarm {
  stufe: FahrzeugAlarmStufe;
  text: string;
  stundenStill: number;
}

function formatStille(stundenStill: number): string {
  if (stundenStill >= 48) return `${Math.round(stundenStill / 24)} Tagen`;
  return `${Math.round(stundenStill)}h`;
}

export function fahrzeugAlarmBerechnen(params: {
  typ: string | null;
  aktiv: boolean;
  zuletztGesehen: string | null;
  // letztes Ereignis an einer "Hof"-Geofence: 'geofenceEnter' | 'geofenceExit' | undefined/null
  letztesHofEreignis: string | null | undefined;
}): FahrzeugAlarm | null {
  if (!params.zuletztGesehen) return null; // nie gemeldet -> nichts zu bewerten (z.B. frisch zugeordneter Tracker)
  const stundenStill =
    (Date.now() - new Date(params.zuletztGesehen).getTime()) / 3_600_000;

  // Stufe Rot (am dringendsten): Hof verlassen, keine Rückkehr, > 24h still -
  // unabhängig von Typ/Status.
  if (
    params.letztesHofEreignis === "geofenceExit" &&
    stundenStill > HOF_VERLASSEN_KRITISCH_STUNDEN
  ) {
    return {
      stufe: "rot-hof",
      text: `Hof verlassen, seit ${formatStille(stundenStill)} keine Rückkehr/Position`,
      stundenStill,
    };
  }

  // Allgemeine Stille-Erkennung: nur für aktive Fahrzeuge - ein abgemeldetes
  // Fahrzeug, das brav auf dem Hof steht, soll keinen Alarm auslösen.
  if (!params.aktiv) return null;

  const istTraktor = params.typ === "traktor";
  const warnungAb = istTraktor ? STILLE_WARNUNG_STUNDEN_TRAKTOR : STILLE_WARNUNG_STUNDEN;
  const kritischAb = istTraktor ? STILLE_KRITISCH_STUNDEN_TRAKTOR : STILLE_KRITISCH_STUNDEN;

  if (stundenStill > kritischAb) {
    return { stufe: "kritisch", text: `Seit ${formatStille(stundenStill)} keine Position`, stundenStill };
  }
  if (stundenStill > warnungAb) {
    return { stufe: "warnung", text: `Seit ${formatStille(stundenStill)} keine Position`, stundenStill };
  }
  return null;
}

export function fahrzeugAlarmBadgeKlasse(stufe: FahrzeugAlarmStufe): string {
  return stufe === "warnung" ? "badge badge-warn" : "badge badge-danger";
}

export function fahrzeugAlarmLabel(stufe: FahrzeugAlarmStufe): string {
  if (stufe === "rot-hof") return "Hof verlassen";
  if (stufe === "kritisch") return "Kritisch";
  return "Warnung";
}
