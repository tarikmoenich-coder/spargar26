// Erzeugt die Excel-Datei für den Lohnsteuerabzug-Sammelantrag (Finanzamt
// Bensheim) - inhaltlich nachgebildet aus der vom Finanzamt gelieferten
// Vorlage (Blätter "Eingabe" und "Freibetrag"; das dritte, ausgeblendete
// Blatt der Vorlage war eine fehlerhafte Zahlwort-Hilfstabelle für ein altes
// Kästchen-Layout und wird bewusst weggelassen). Werte statt Formeln - die
// Berechnung übernimmt lib/lohnsteuerantrag.ts, hier wird nur noch
// geschrieben, damit nichts doppelt gerechnet wird.

import * as XLSX from "xlsx";
import { formatDatumDE } from "@/lib/format";
import {
  freibetragMonatlich,
  freibetragTaeglich,
  freibetragWoechentlich,
} from "@/lib/lohnsteuerantrag";

export interface LohnsteuerantragFirmendaten {
  name: string;
  steuernummer: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
}

export interface LohnsteuerantragExportZeile {
  lfdNr: number;
  name: string;
  vorname: string;
  geburtsdatum: string | null;
  steuerId: string | null;
  vorherigeZeitraeume: string | null;
  verheiratetSeit: string | null;
  bescheinigungFrueherErteilt: boolean;
  aufenthaltVon: string;
  aufenthaltBis: string;
  tage: number;
  anAbreisetage: number;
  beschaeftigtAls: string | null;
  heimatStrasse: string | null;
  heimatHausnummer: string | null;
  heimatPlz: string | null;
  heimatOrt: string | null;
  heimatLand: string | null;
  verpflegungsmehraufwand: number;
  eigenerHausstand: boolean;
  gefahreneKm: number;
  fahrtkostenAbsetzbar: number;
  unterkunftskosten: number;
  sonstigeWerbungskosten: number;
  werbungskostenGesamt: number;
  pauschbetragAnteilig: number;
  freibetragBeantragt: number;
}

function firmenanschriftZeilen(firma: LohnsteuerantragFirmendaten): string[] {
  const strasse = [firma.strasse, firma.hausnummer].filter(Boolean).join(" ");
  const ort = [firma.plz, firma.ort].filter(Boolean).join(" ");
  return [strasse, ort].filter(Boolean);
}

function kopfBlock(
  titel: string[],
  jahr: number,
  firma: LohnsteuerantragFirmendaten
): (string | number)[][] {
  const anschrift = firmenanschriftZeilen(firma);
  return [
    ...titel.map((zeile) => [zeile]),
    [],
    ["Kalenderjahr:", jahr],
    ["Steuernummer:", firma.steuernummer ?? ""],
    ["Arbeitgeber:", firma.name],
    ["Anschrift:", anschrift[0] ?? ""],
    ["", anschrift[1] ?? ""],
    [],
  ];
}

const EINGABE_HEADER = [
  "lfd. Nr.",
  "Name",
  "Vorname",
  "Geb.-Datum",
  "Steuer-ID",
  "vorherige Zeiträume in Deutschland",
  "Verheiratet seit",
  "Bescheinigung bereits erteilt (früheres Jahr)",
  "Aufenthalt in der BRD - von",
  "Aufenthalt in der BRD - bis",
  "Tage",
  "Beschäftigt als",
  "Straße",
  "Haus-Nr.",
  "Postleitzahl",
  "Ort",
  "Wohnsitz im Ausland - Straße, Hausnummer",
  "Wohnsitz im Ausland - PLZ",
  "Wohnsitz im Ausland - Ort, Staat",
  "An-/Abreisetage (14 EUR)",
  "Zwischentage (28 EUR)",
  "Verpflegungsmehraufwand absetzbarer Betrag",
  "eigener Hausstand",
  "An-/Abreise km (eigener Pkw)",
  "Fahrtkosten absetzbarer Betrag",
  "Unterkunftskosten",
  "Sonstige Werbungskosten",
  "Gesamt absetzbarer Betrag",
  "abzüglich anteiligem Pauschbetrag",
  "Freibetrag",
];

function eingabeZeile(z: LohnsteuerantragExportZeile): (string | number)[] {
  const heimatStrasse = [z.heimatStrasse, z.heimatHausnummer]
    .filter(Boolean)
    .join(" ");
  const heimatOrtStaat = [z.heimatOrt, z.heimatLand].filter(Boolean).join(", ");
  return [
    z.lfdNr,
    z.name,
    z.vorname,
    formatDatumDE(z.geburtsdatum),
    z.steuerId ?? "",
    z.vorherigeZeitraeume ?? "",
    formatDatumDE(z.verheiratetSeit),
    z.bescheinigungFrueherErteilt ? "ja" : "nein",
    formatDatumDE(z.aufenthaltVon),
    formatDatumDE(z.aufenthaltBis),
    z.tage,
    z.beschaeftigtAls ?? "",
    "", // Firmen-Straße wird zentral im Kopf genannt, hier bewusst leer
    "",
    "",
    "",
    heimatStrasse,
    z.heimatPlz ?? "",
    heimatOrtStaat,
    z.anAbreisetage,
    Math.max(0, z.tage - z.anAbreisetage),
    z.verpflegungsmehraufwand,
    z.eigenerHausstand ? "ja" : "nein",
    z.gefahreneKm,
    z.fahrtkostenAbsetzbar,
    z.unterkunftskosten,
    z.sonstigeWerbungskosten,
    z.werbungskostenGesamt,
    z.pauschbetragAnteilig,
    z.freibetragBeantragt,
  ];
}

const FREIBETRAG_HEADER = [
  "lfd. Nr.",
  "Name",
  "Vorname",
  "Geb.-Datum",
  "Steuer-ID",
  "Steuerklasse",
  "Gültig von",
  "Gültig bis",
  "Freibetrag",
  "monatlich",
  "wöchentlich",
  "täglich",
];

function freibetragZeile(z: LohnsteuerantragExportZeile): (string | number)[] {
  return [
    z.lfdNr,
    z.name,
    z.vorname,
    formatDatumDE(z.geburtsdatum),
    z.steuerId ?? "",
    "Eins",
    formatDatumDE(z.aufenthaltVon),
    formatDatumDE(z.aufenthaltBis),
    z.freibetragBeantragt,
    freibetragMonatlich(z.freibetragBeantragt, z.tage),
    freibetragWoechentlich(z.freibetragBeantragt, z.tage),
    freibetragTaeglich(z.freibetragBeantragt, z.tage),
  ];
}

export function erzeugeLohnsteuerantragExcel(
  jahr: number,
  firma: LohnsteuerantragFirmendaten,
  zeilen: LohnsteuerantragExportZeile[]
): void {
  const workbook = XLSX.utils.book_new();

  const eingabeDaten = [
    ...kopfBlock(
      [
        "Übersicht der beschränkt einkommensteuerpflichtigen Arbeitnehmer für den",
        "Antrag auf Erteilung einer (Sammel-) Bescheinigung für den Lohnsteuerabzug",
      ],
      jahr,
      firma
    ),
    EINGABE_HEADER,
    ...zeilen.map(eingabeZeile),
  ];
  const eingabeSheet = XLSX.utils.aoa_to_sheet(eingabeDaten);
  XLSX.utils.book_append_sheet(workbook, eingabeSheet, "Eingabe");

  const freibetragDaten = [
    ...kopfBlock(
      [
        "Sammelbescheinigung für den Lohnsteuerabzug für beschränkt",
        "steuerpflichtige Arbeitnehmer",
      ],
      jahr,
      firma
    ),
    FREIBETRAG_HEADER,
    ...zeilen.map(freibetragZeile),
  ];
  const freibetragSheet = XLSX.utils.aoa_to_sheet(freibetragDaten);
  XLSX.utils.book_append_sheet(workbook, freibetragSheet, "Freibetrag");

  XLSX.writeFile(workbook, `Lohnsteuerabzug-Sammelantrag-${jahr}.xlsx`);
}
