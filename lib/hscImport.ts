// Import des Vertriebs-Personalstamms aus HSC-Exporten (Stufe 4,
// 2026-11-25). Reine Funktionen (ohne Datenbank) - die Seite
// app/personal-import-hsc nutzt sie, und sie lassen sich lokal gegen echte
// Exporte testen.
//
// Nutzer-Entscheidungen 2026-11-25:
//   * zwei Exporte: Anita Mönich (alte Vertriebsfirma, Kürzel AM) und
//     Mönich Direkt (MD) - MD hat den Personalstamm von AM mit denselben
//     Personalnummern übernommen. Eine Person = eine Personalnummer.
//   * Personalnummer in der App mit Präfix "V-".
//   * Personengruppe (PGS): 101 -> SV-pflichtig, 109 -> Minijob (RV-Befreiung
//     aus "AntragRVBefreiungPGS109"), 110 -> kurzfristig, sonst (900, 119)
//     -> SV-pflichtig mit Hinweis.
//   * Herkunft bleibt leer (wird bei der Personalplanung gesetzt).
//   * HSC liefert je Firma nur den LETZTEN Beschäftigungszeitraum (Eintritt/
//     Austritt) - frühere Saisons dazwischen sind nicht enthalten.
import type { Abrechnungsart } from "./types";

export type HscZeile = Record<string, string>;

export interface HscDatei {
  name: string;
  firma: string; // Firmenkürzel (AM / MD)
  stand: number; // Abrechnungsjahr*12 + Abrechnungsmonat - neuere Datei liefert die Stammdaten
  zeilen: HscZeile[];
}

// CSV (Semikolon, HSC-Export ist Windows-1252) -> Zeilen
export function hscCsvLesen(text: string): HscZeile[] {
  const zeilen: string[][] = [];
  let feld = "";
  let zeile: string[] = [];
  let inAnf = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inAnf) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          feld += '"';
          i++;
        } else inAnf = false;
      } else feld += c;
    } else if (c === '"') inAnf = true;
    else if (c === ";") {
      zeile.push(feld);
      feld = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      zeile.push(feld);
      feld = "";
      if (zeile.some((f) => f !== "")) zeilen.push(zeile);
      zeile = [];
    } else feld += c;
  }
  if (feld !== "" || zeile.length) {
    zeile.push(feld);
    if (zeile.some((f) => f !== "")) zeilen.push(zeile);
  }
  const [kopf, ...daten] = zeilen;
  return daten.map((z) => Object.fromEntries(kopf.map((k, i) => [k.trim(), (z[i] ?? "").trim()])));
}

// Byte-Inhalt dekodieren: UTF-8, sonst Windows-1252 (HSC-Standard)
export function hscDekodieren(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1252").decode(bytes);
}

export function hscDateiStand(zeilen: HscZeile[]): number {
  return Math.max(
    0,
    ...zeilen.map((z) => Number(z.Abrechnungsjahr || 0) * 12 + Number(z.Abrechnungsmonat || 0))
  );
}

// "TT.MM.JJJJ" -> "JJJJ-MM-TT"
export function hscDatum(d: string | undefined): string | null {
  const m = (d ?? "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

// DEÜV-Staatsangehörigkeitsschlüssel - nur die sicher bekannten, mit den
// Wohnländern im Export plausibilisierten Schlüssel; unbekannte bleiben leer
// (Hinweis in der Vorschau).
const STAATSANGEHOERIGKEIT: Record<string, string> = {
  "000": "Deutschland",
  "122": "Bosnien und Herzegowina",
  "125": "Bulgarien",
  "130": "Kroatien",
  "131": "Slowenien",
  "137": "Italien",
  "152": "Polen",
  "154": "Rumänien",
  "155": "Slowakei",
  "165": "Ungarn",
  "166": "Ukraine",
  "170": "Serbien",
};

const FAMILIENSTAND: Record<string, string | null> = {
  verheiratet: "verheiratet",
  ledig: "ledig",
  geschieden: "geschieden_getrennt",
  getrennt: "geschieden_getrennt",
  verwitwet: "verwitwet",
  unbekannt: null,
};

export function abrechnungsartAusPgs(pgs: string): { art: Abrechnungsart; hinweis: string | null } {
  switch (pgs.trim()) {
    case "101":
      return { art: "sozialversicherungspflichtig", hinweis: null };
    case "109":
      return { art: "minijob", hinweis: null };
    case "110":
      return { art: "kurzfristig", hinweis: null };
    default:
      return {
        art: "sozialversicherungspflichtig",
        hinweis: `Personengruppe ${pgs || "(leer)"} unbekannt - als SV-pflichtig übernommen, bitte prüfen`,
      };
  }
}

function normName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
export function personSchluessel(name: string, vorname: string, geburtsdatum: string | null): string {
  return `${normName(name)}|${normName(vorname)}|${geburtsdatum ?? ""}`;
}

export interface HscZeitraum {
  firma: string;
  von: string;
  bis: string | null;
}

export interface HscPerson {
  hscNr: string;
  personal_nr: string; // mit "V-"
  stamm: Record<string, unknown>; // Felder für employee_personaldaten
  aktiv: boolean;
  zeitraeume: HscZeitraum[];
  saisonFirma: Record<number, string>; // Saisonjahr -> Firma
  hinweise: string[];
  fehler: string[]; // verhindert den Import dieser Person
  schluessel: string; // Name|Vorname|Geburtsdatum
}

// Mehrere Exporte (verschiedene Firmen) zu Personen zusammenführen.
export function hscZusammenfuehren(dateien: HscDatei[], heuteJahr: number): HscPerson[] {
  const nachNeu = [...dateien].sort((a, b) => b.stand - a.stand); // neueste zuerst
  const nachAlt = [...dateien].sort((a, b) => a.stand - b.stand);
  const nummern = new Set<string>();
  dateien.forEach((d) => d.zeilen.forEach((z) => z.Personalnummer && nummern.add(z.Personalnummer)));

  const personen: HscPerson[] = [];
  for (const nr of Array.from(nummern)) {
    const quellen = nachNeu
      .map((d) => ({ d, z: d.zeilen.find((z) => z.Personalnummer === nr) }))
      .filter((q): q is { d: HscDatei; z: HscZeile } => !!q.z);
    const neu = quellen[0].z;
    // Feld aus der neuesten Datei, sonst aus einer älteren
    const feld = (f: string) => quellen.map((q) => q.z[f]).find((v) => v && v.trim()) ?? "";
    const hinweise: string[] = [];
    const fehler: string[] = [];

    const geburtsdatum = hscDatum(feld("Geburtsdatum"));
    if (!geburtsdatum) hinweise.push("ohne Geburtsdatum");
    if (!feld("Name") || !feld("Vorname")) fehler.push("Name oder Vorname fehlt");
    if (!feld("VersicherungsNummer")) hinweise.push("ohne SV-Nummer");
    const anrede = neu.Anrede;
    if (anrede && anrede !== "Herr" && anrede !== "Frau") {
      hinweise.push("Anrede in HSC auffällig (nicht übernommen - Geschlecht stimmt)");
    }

    const { art, hinweis: pgsHinweis } = abrechnungsartAusPgs(neu.PGS ?? "");
    if (pgsHinweis) hinweise.push(pgsHinweis);

    const staCode = feld("Staatsangehoerigkeit");
    const sta = STAATSANGEHOERIGKEIT[staCode] ?? null;
    if (staCode && !sta) hinweise.push(`Staatsangehörigkeit HSC-Schlüssel ${staCode} - bitte nachtragen`);

    const fam = feld("Familienstand").toLowerCase();
    const lohnRoh = (neu.Lohnsatz1 ?? "").replace(/\./g, "").replace(",", ".");
    const lohn = Number(lohnRoh);
    let stundenlohn: number | null = null;
    if (neu.Monatsentgelt === "1" || lohn >= 100) {
      if (lohn > 0) hinweise.push("in HSC mit Monatsgehalt - Stundenlohn nicht übernommen");
    } else if (lohn > 0) stundenlohn = lohn;

    const geschlecht = /^m/i.test(feld("Geschlecht")) ? "M" : /^w/i.test(feld("Geschlecht")) ? "F" : null;
    const iban = feld("IBAN").replace(/\s/g, "").toUpperCase() || null;

    // Beschäftigungszeiträume: gleicher Zeitraum in mehreren Dateien = aus
    // der älteren Firma übernommen (gehört dorthin)
    const zeitraeume: HscZeitraum[] = [];
    for (const d of nachAlt) {
      const z = d.zeilen.find((x) => x.Personalnummer === nr);
      if (!z) continue;
      const von = hscDatum(z.Eintrittsdatum);
      if (!von) continue;
      const bis = hscDatum(z.Austrittsdatum);
      if (zeitraeume.some((t) => t.von === von && t.bis === bis)) continue;
      zeitraeume.push({ firma: d.firma, von, bis });
    }
    if (zeitraeume.length === 0) hinweise.push("ohne Eintrittsdatum - keine Saisonjahre");

    const aktiv = neu.Aktiv === "True";
    // Saisonjahre je Zeitraum; spätere Zeiträume überschreiben frühere
    const saisonFirma: Record<number, string> = {};
    for (const t of [...zeitraeume].sort((a, b) => a.von.localeCompare(b.von))) {
      const ab = Number(t.von.slice(0, 4));
      const bis = t.bis ? Number(t.bis.slice(0, 4)) : aktiv ? heuteJahr : ab;
      for (let j = ab; j <= Math.max(ab, bis); j++) saisonFirma[j] = t.firma;
    }

    personen.push({
      hscNr: nr,
      personal_nr: `V-${nr}`,
      aktiv,
      zeitraeume,
      saisonFirma,
      hinweise,
      fehler,
      schluessel: personSchluessel(feld("Name"), feld("Vorname"), geburtsdatum),
      stamm: {
        personal_nr: `V-${nr}`,
        bereich: "VT",
        name: feld("Name"),
        vorname: feld("Vorname"),
        geburtsdatum,
        geschlecht,
        geburtsname: feld("Geburtsname") || null,
        geburtsort: feld("Geburtsort") && feld("Geburtsort").toLowerCase() !== "unbekannt" ? feld("Geburtsort") : null,
        strasse: feld("Strasse") || null,
        hausnummer: feld("HausNummer") || null,
        plz: feld("PLZ") || null,
        ort: [feld("Ort"), feld("Ortsteil")].filter(Boolean).join(" - ") || null,
        land: feld("Land") || null,
        staatsangehoerigkeit: sta,
        nationalitaet: sta,
        sozialversicherungsnummer: feld("VersicherungsNummer") || null,
        steuer_id: feld("SteuerID") || null,
        familienstand: fam in FAMILIENSTAND ? FAMILIENSTAND[fam] : null,
        telefon_privat: feld("Handy") || feld("Telefon") || null,
        email_privat: feld("Email") || null,
        iban,
        bic: feld("BIC").replace(/\s/g, "").toUpperCase() || null,
        zahlungsempfaenger: feld("Empfaenger") || null,
        stundenlohn,
        abrechnungsart: art,
        minijob_rv_befreit: art === "minijob" && neu.AntragRVBefreiungPGS109 === "True",
        funktion: feld("Beschaeftigung") || null,
        aktiv,
        herkunft: null,
        notiz: `Import aus HSC (${quellen.map((q) => q.d.firma).join(", ")}), HSC-Personalnummer ${nr}`,
      },
    });
  }

  // gleiche Person unter mehreren Personalnummern
  const nachSchluessel = new Map<string, HscPerson[]>();
  personen.forEach((p) => {
    if (!p.schluessel.endsWith("|")) {
      nachSchluessel.set(p.schluessel, [...(nachSchluessel.get(p.schluessel) ?? []), p]);
    }
  });
  nachSchluessel.forEach((liste) => {
    if (liste.length > 1) {
      liste.forEach((p) =>
        p.hinweise.push(
          `gleiche Person auch unter ${liste
            .filter((x) => x !== p)
            .map((x) => x.personal_nr)
            .join(", ")} - beide werden übernommen, bitte prüfen`
        )
      );
    }
  });
  return personen.sort((a, b) => a.hscNr.localeCompare(b.hscNr, "de", { numeric: true }));
}
