// Zuordnung/Validierung für den Maschinen-Import aus Excel/CSV
// (app/erntewirtschaft/stammdaten). Gleiches Muster wie lib/personalImport.ts
// (Header-Alias-Erkennung unabhängig von Groß-/Kleinschreibung, Umlauten,
// Interpunktion) - hier deutlich schlanker, da Maschinen nur vier Felder
// haben und keine Fremdschlüssel-Abhängigkeiten zwischen Importzeilen
// bestehen (anders als der Personal-Import mit seiner Statuswechsel-
// Vorgänger-Verknüpfung).

export const ERNTE_MASCHINE_IMPORT_FELDER = [
  "nummer",
  "bezeichnung",
  "box_seriennummer",
  "traccar_unique_id",
] as const;

export type ErnteMaschineImportFeld = (typeof ERNTE_MASCHINE_IMPORT_FELDER)[number];

const HEADER_ALIASE: Record<ErnteMaschineImportFeld, string[]> = {
  nummer: ["nummer", "maschinennummer", "nr", "maschinennr"],
  bezeichnung: ["bezeichnung", "name"],
  box_seriennummer: ["boxseriennummer", "seriennummer", "boxsn", "sn"],
  traccar_unique_id: ["traccaruniqueid", "imei", "uniqueid"],
};

export function normalisiereHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

// original Spaltenüberschrift -> erkanntes Feld (oder null, falls unbekannt)
export function erkenneSpalten(
  headers: string[]
): Record<string, ErnteMaschineImportFeld | null> {
  const alle: [string, ErnteMaschineImportFeld][] = [];
  for (const feld of ERNTE_MASCHINE_IMPORT_FELDER) {
    for (const alias of HEADER_ALIASE[feld]) alle.push([alias, feld]);
  }
  const map: Record<string, ErnteMaschineImportFeld | null> = {};
  for (const h of headers) {
    const norm = normalisiereHeader(h);
    const treffer = alle.find(([alias]) => alias === norm);
    map[h] = treffer ? treffer[1] : null;
  }
  return map;
}

// Wandelt eine von XLSX gelesene Zelle in Text um - gleiche Logik wie
// lib/personalImport.ts zellwertZuText (Datumszellen kommen hier nicht vor,
// trotzdem dieselbe robuste Behandlung für alles andere).
export function zellwertZuText(wert: unknown): string {
  if (wert === null || wert === undefined) return "";
  return String(wert).trim();
}

export interface ErnteMaschineImportZeile {
  zeile: number;
  nummer: string;
  bezeichnung: string | null;
  box_seriennummer: string | null;
  traccar_unique_id: string | null;
  fehler: string[];
  warnungen: string[];
}

export function baueZeile(
  zeile: number,
  werte: Partial<Record<ErnteMaschineImportFeld, string>>
): ErnteMaschineImportZeile {
  const fehler: string[] = [];
  const nummer = (werte.nummer ?? "").trim();
  if (!nummer) fehler.push("Nummer fehlt");

  return {
    zeile,
    nummer,
    bezeichnung: werte.bezeichnung?.trim() || null,
    box_seriennummer: werte.box_seriennummer?.trim() || null,
    traccar_unique_id: werte.traccar_unique_id?.trim() || null,
    fehler,
    warnungen: [],
  };
}
