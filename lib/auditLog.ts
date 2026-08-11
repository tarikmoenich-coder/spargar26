// Aufbereitung der Audit-Log-Rohdaten für die Anzeige (Seite
// "Änderungsprotokoll" und die Kurzinfo auf der Personal-Seite).
// Die Sicht audit_log_ansicht liefert den kompletten Datensatz vorher und
// nachher als JSON - welche Felder sich tatsächlich geändert haben, wird
// erst hier ermittelt.

import type { AuditLogEintrag } from "./types";

// Klartext je protokollierter Tabelle. Was hier nicht steht, wird mit dem
// technischen Namen angezeigt (besser als es zu verstecken).
export const BEREICH_LABELS: Record<string, string> = {
  employees: "Personalstamm",
  work_entries: "Stunden",
  advances: "Vorschüsse",
  zuckermais_rohdaten: "Prämien Zuckermais",
  erdbeeren_rohdaten: "Prämien Erdbeeren",
  cash_deposits: "Kassenbuch",
  cash_checks: "Kassenprüfung",
  employee_documents: "Dokumente",
  periods: "Monatsabschluss",
  personal_kandidaten: "Personalplanung",
};

export const AKTION_LABELS: Record<string, string> = {
  insert: "Angelegt",
  update: "Geändert",
  delete: "Gelöscht",
  storno: "Storniert",
  reopen: "Wieder geöffnet",
};

export function bereichLabel(entity: string): string {
  return BEREICH_LABELS[entity] ?? entity;
}

export function aktionLabel(action: string): string {
  return AKTION_LABELS[action] ?? action;
}

// Felder, die bei jeder Änderung mitlaufen und deshalb nur Rauschen wären.
const TECHNISCHE_FELDER = new Set([
  "updated_at",
  "updated_by",
  "version",
  "erfasst_am",
  "erfasst_von",
]);

export interface FeldAenderung {
  feld: string;
  vorher: string;
  nachher: string;
}

function alsText(wert: unknown): string {
  if (wert === null || wert === undefined || wert === "") return "—";
  if (typeof wert === "boolean") return wert ? "Ja" : "Nein";
  if (Array.isArray(wert)) return wert.length === 0 ? "—" : wert.join(", ");
  if (typeof wert === "object") return JSON.stringify(wert);
  return String(wert);
}

// Ermittelt die tatsächlich geänderten Felder. Bei "Angelegt"/"Gelöscht"
// gibt es keinen Vergleich - dort werden die belegten Felder des einen
// vorhandenen Datensatzes gezeigt.
export function feldAenderungen(e: AuditLogEintrag): FeldAenderung[] {
  const vorher = e.before_data ?? {};
  const nachher = e.after_data ?? {};
  const felder = new Set([...Object.keys(vorher), ...Object.keys(nachher)]);
  const ergebnis: FeldAenderung[] = [];
  felder.forEach((feld) => {
    if (TECHNISCHE_FELDER.has(feld)) return;
    const a = alsText(vorher[feld]);
    const b = alsText(nachher[feld]);
    if (a === b) return;
    // Beim Anlegen/Löschen nur belegte Felder zeigen - sonst stünden dort
    // dutzende "— → —"-Zeilen.
    if (!e.before_data && b === "—") return;
    if (!e.after_data && a === "—") return;
    ergebnis.push({ feld, vorher: a, nachher: b });
  });
  return ergebnis.sort((x, y) => x.feld.localeCompare(y.feld));
}
