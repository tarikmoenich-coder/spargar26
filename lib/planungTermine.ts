// Terminlogik der Personalplanung: Arbeitsende ergibt sich automatisch aus dem
// Arbeitsbeginn (Nutzer-Vorgabe 2026-09-19: Arbeitsbeginn + 104 Tage =
// Arbeitsende, entspricht der 15-Wochen-Grenze inkl. Starttag).

export const ARBEITSDAUER_TAGE = 104;

export function plusTage(iso: string, tage: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

export function arbeitsendeAuto(beginn: string): string {
  return plusTage(beginn, ARBEITSDAUER_TAGE);
}

// Wird das Arbeitsende bei einem neuen Arbeitsbeginn automatisch nachgezogen?
// Ja, wenn es leer ist oder noch dem Automatikwert des alten Beginns
// entspricht - ein bewusst abweichendes Enddatum bleibt so unangetastet.
export function endeFolgtBeginn(
  alterBeginn: string | null,
  aktuellesEnde: string | null
): boolean {
  if (!aktuellesEnde) return true;
  return !!alterBeginn && aktuellesEnde === arbeitsendeAuto(alterBeginn);
}

// Teilt lange ID-Listen für .in(...)-Abfragen auf (die IDs stehen in der
// URL; sehr lange Listen würden das Längenlimit überschreiten).
export function inBloecken<T>(liste: T[], groesse = 50): T[][] {
  const bloecke: T[][] = [];
  for (let i = 0; i < liste.length; i += groesse) {
    bloecke.push(liste.slice(i, i + groesse));
  }
  return bloecke;
}
