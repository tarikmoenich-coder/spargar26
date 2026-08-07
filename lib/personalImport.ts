// Zuordnung/Validierung für den Personal-Import aus Excel/CSV.
// Erkennt Spaltenüberschriften unabhängig von Groß-/Kleinschreibung,
// Umlauten und Interpunktion (z.B. "Pers.-Nr." und "Personalnummer" gelten
// beide als personal_nr).

import type { Abrechnungsart } from "./types";

export const IMPORT_FELDER = [
  "personal_nr",
  "gruppe_nr",
  "herkunft",
  "nationalitaet",
  "name",
  "vorname",
  "geburtsdatum",
  "ort",
  "land",
  "stundenlohn",
  "abrechnungsart",
  "sozialversicherungsnummer",
  "steuer_id",
  "iban",
  "bic",
  "zahlungsempfaenger",
] as const;

export type ImportFeld = (typeof IMPORT_FELDER)[number];

const HEADER_ALIASE: Record<ImportFeld, string[]> = {
  personal_nr: ["personalnummer", "persnr", "personalnr", "nr"],
  gruppe_nr: ["gruppe", "gruppennr", "gruppennummer", "arbeitsgruppe"],
  herkunft: ["herkunft"],
  nationalitaet: ["nationalitaet"],
  name: ["name", "nachname"],
  vorname: ["vorname"],
  geburtsdatum: ["geburtsdatum", "geboren", "geburtstag"],
  ort: ["ort", "wohnort"],
  land: ["land"],
  stundenlohn: ["stundenlohn", "lohn", "stundensatz"],
  abrechnungsart: ["abrechnungsart"],
  sozialversicherungsnummer: ["sozialversicherungsnummer", "svnummer", "svnr"],
  steuer_id: ["steuerid", "steuernummer"],
  iban: ["iban"],
  bic: ["bic"],
  zahlungsempfaenger: ["zahlungsempfaenger", "empfaenger"],
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
): Record<string, ImportFeld | null> {
  const alle: [string, ImportFeld][] = [];
  for (const feld of IMPORT_FELDER) {
    for (const alias of HEADER_ALIASE[feld]) alle.push([alias, feld]);
  }
  const map: Record<string, ImportFeld | null> = {};
  for (const h of headers) {
    const norm = normalisiereHeader(h);
    const treffer = alle.find(([alias]) => alias === norm);
    map[h] = treffer ? treffer[1] : null;
  }
  return map;
}

// Wandelt eine von XLSX gelesene Zelle (String, Zahl, Date, Bool) in Text
// um. Echte Datumszellen werden als TT.MM.JJJJ ausgegeben.
//
// WICHTIG (per Test verifiziert, 2026-08-06 - siehe Bugfix-Commit "Datum
// beim Stunden-Import um einen Tag verschoben"): die xlsx-Bibliothek
// liefert bei cellDates:true für eine echte Excel-Datumszelle ein
// Date-Objekt, das LOKALE Mitternacht des Kalendertags repräsentiert
// (nicht UTC-Mitternacht, wie ein früherer Kommentar hier fälschlich
// annahm). Für Nutzer östlich von UTC (z.B. Deutschland, UTC+1/+2) liegt
// der zugrundeliegende UTC-Zeitstempel dadurch noch auf dem VORTAG - mit
// UTC-Gettern gelesen ergäbe das systematisch ein um einen Tag zu frühes
// Datum. Deshalb hier bewusst LOKALE Getter, nicht UTC-Getter.
export function zellwertZuText(wert: unknown): string {
  if (wert instanceof Date) {
    const tag = String(wert.getDate()).padStart(2, "0");
    const monat = String(wert.getMonth() + 1).padStart(2, "0");
    const jahr = wert.getFullYear();
    return `${tag}.${monat}.${jahr}`;
  }
  if (wert === null || wert === undefined) return "";
  return String(wert).trim();
}

// "23.4.2026" oder "2026-04-23" -> "2026-04-23"; sonst null.
export function parseDatum(wert: string): string | null {
  const v = wert.trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, jahr, monat, tag] = iso;
    return `${jahr}-${monat.padStart(2, "0")}-${tag.padStart(2, "0")}`;
  }
  const de = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (de) {
    const [, tag, monat, jahr] = de;
    return `${jahr}-${monat.padStart(2, "0")}-${tag.padStart(2, "0")}`;
  }
  return null;
}

export function parseZahl(wert: string): number | null {
  let v = wert.trim();
  if (!v) return null;
  const hatKomma = v.includes(",");
  const hatPunkt = v.includes(".");
  if (hatKomma && hatPunkt) {
    // deutsches Format mit Tausendertrennzeichen, z.B. "1.234,56"
    v = v.replace(/\./g, "").replace(",", ".");
  } else if (hatKomma) {
    // Komma als Dezimaltrennzeichen, z.B. "13,50"
    v = v.replace(",", ".");
  }
  // sonst: Punkt bleibt Dezimaltrennzeichen, z.B. "13.50"
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Erkennt sowohl ausgeschriebene Werte als auch die Kurzformen wie im
// Altsystem (siehe ABRECHNUNGSART_LABELS in lib/types.ts) - "PA" ->
// normalisiereHeader() -> "pa" usw.
const ABRECHNUNGSART_ALIASE: Record<string, Abrechnungsart> = {
  pauschal: "pauschal",
  pa: "pauschal",
  lohnsteuerklasse1: "lohnsteuerklasse_1",
  lohnsteuerklassei: "lohnsteuerklasse_1",
  stkl1: "lohnsteuerklasse_1",
  stklassei: "lohnsteuerklasse_1",
  sozialversicherungspflichtig: "sozialversicherungspflichtig",
  svpflichtig: "sozialversicherungspflichtig",
  svpfl: "sozialversicherungspflichtig",
};

export function parseAbrechnungsart(wert: string): {
  wert: Abrechnungsart;
  warnung: string | null;
} {
  const norm = normalisiereHeader(wert);
  if (!norm) return { wert: "sozialversicherungspflichtig", warnung: null };
  const treffer = ABRECHNUNGSART_ALIASE[norm];
  if (treffer) return { wert: treffer, warnung: null };
  return {
    wert: "sozialversicherungspflichtig",
    warnung: `Abrechnungsart "${wert}" nicht erkannt - auf "Sozialversicherungspflichtig" gesetzt`,
  };
}

// "342a" -> "342" (Statuswechsel-Konvention, siehe Personalstamm-Button
// "Statuswechsel": ein "a" am Ende der Personalnummer markiert eine mit
// einer Vorgänger-Person verknüpfte Nummer, z.B. bei SV-frei -> -pflichtig).
// null, wenn die Nummer nicht auf "a" endet oder nur aus "a" besteht.
export function vorgaengerNrAus(personal_nr: string): string | null {
  const v = personal_nr.trim();
  if (v.length < 2) return null;
  if (!v.toLowerCase().endsWith("a")) return null;
  return v.slice(0, -1);
}

export interface ImportZeile {
  zeile: number;
  personal_nr: string;
  // Aus der Personalnummer abgeleitet (siehe vorgaengerNrAus) - die
  // eigentliche Verknüpfung (zu einer employee_id) wird erst beim Import
  // in der Seite aufgelöst, da die Vorgänger-Person ggf. erst in
  // DIESEM Import mit angelegt wird.
  vorgaenger_personal_nr: string | null;
  name: string;
  vorname: string;
  gruppe_nr: string | null;
  herkunft: string | null;
  nationalitaet: string | null;
  geburtsdatum: string | null;
  ort: string | null;
  land: string | null;
  stundenlohn: number | null;
  abrechnungsart: Abrechnungsart;
  sozialversicherungsnummer: string | null;
  steuer_id: string | null;
  iban: string | null;
  bic: string | null;
  zahlungsempfaenger: string | null;
  fehler: string[];
  warnungen: string[];
}

export function baueZeile(
  zeile: number,
  werte: Partial<Record<ImportFeld, string>>,
  bekannteGruppen: Set<string>,
  bekannteHerkuenfte: Set<string>
): ImportZeile {
  const fehler: string[] = [];
  const warnungen: string[] = [];

  const personal_nr = (werte.personal_nr ?? "").trim();
  const name = (werte.name ?? "").trim();
  const vorname = (werte.vorname ?? "").trim();
  if (!personal_nr) fehler.push("Personalnummer fehlt");
  if (!name) fehler.push("Name fehlt");
  if (!vorname) fehler.push("Vorname fehlt");

  let gruppe_nr = (werte.gruppe_nr ?? "").trim() || null;
  if (gruppe_nr && !bekannteGruppen.has(gruppe_nr)) {
    warnungen.push(
      `Gruppe "${gruppe_nr}" ist nicht angelegt - wurde leer gelassen`
    );
    gruppe_nr = null;
  }

  let herkunft = (werte.herkunft ?? "").trim() || null;
  if (herkunft && !bekannteHerkuenfte.has(herkunft)) {
    warnungen.push(
      `Herkunft "${herkunft}" ist nicht angelegt - wurde leer gelassen`
    );
    herkunft = null;
  }

  let geburtsdatum: string | null = null;
  if (werte.geburtsdatum?.trim()) {
    geburtsdatum = parseDatum(werte.geburtsdatum);
    if (geburtsdatum === null) {
      warnungen.push(
        `Geburtsdatum "${werte.geburtsdatum}" nicht erkannt (erwartet TT.MM.JJJJ) - wurde leer gelassen`
      );
    }
  }

  let stundenlohn: number | null = null;
  if (werte.stundenlohn?.trim()) {
    stundenlohn = parseZahl(werte.stundenlohn);
    if (stundenlohn === null) {
      warnungen.push(
        `Stundenlohn "${werte.stundenlohn}" nicht erkannt - wurde leer gelassen`
      );
    }
  }

  const { wert: abrechnungsart, warnung: abrWarnung } = parseAbrechnungsart(
    werte.abrechnungsart ?? ""
  );
  if (abrWarnung) warnungen.push(abrWarnung);

  return {
    zeile,
    personal_nr,
    vorgaenger_personal_nr: personal_nr ? vorgaengerNrAus(personal_nr) : null,
    name,
    vorname,
    gruppe_nr,
    herkunft,
    nationalitaet: werte.nationalitaet?.trim() || null,
    geburtsdatum,
    ort: werte.ort?.trim() || null,
    land: werte.land?.trim() || null,
    stundenlohn,
    abrechnungsart,
    sozialversicherungsnummer: werte.sozialversicherungsnummer?.trim() || null,
    steuer_id: werte.steuer_id?.trim() || null,
    iban: werte.iban?.trim() || null,
    bic: werte.bic?.trim() || null,
    zahlungsempfaenger: werte.zahlungsempfaenger?.trim() || null,
    fehler,
    warnungen,
  };
}
