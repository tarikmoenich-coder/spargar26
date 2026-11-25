// Abgleich des Landwirtschafts-Personalstamms mit HSC-Exporten (2026-11-25).
// Reine Funktionen ohne Datenbank - die Seite app/personal-import-hsc-lw
// nutzt sie, lokal gegen die echten Exporte getestet.
//
// Hintergrund (Nutzer 2026-11-25): der bisherige Stamm kam aus einer
// teils unvollständigen Excel. Personalnummern wurden früher bei der
// Neuanlage schlampig gegen vergebene Nummern geprüft - eine Nummer gehörte
// so manchmal zwei Menschen, und dieselbe Person wurde (auch in HSC) unter
// einer neuen Nummer nochmal angelegt. HSC hat Vorrang, weil dort jede
// Nummer nur einmal vergeben werden kann.
//
// Nutzer-Entscheidungen 2026-11-25:
//   * Nummernregel: ist die App-Nummer eine gültige HSC-Nummer DERSELBEN
//     Person, bleibt sie; sonst bekommt die Person die neueste HSC-Nummer
//     (die übrigen HSC-Nummern landen in der Notiz).
//   * Dieselbe HSC-Nummer in Mömmel UND ML für zwei verschiedene Menschen:
//     wer jünger eingetreten ist, bekommt die Nummer, der andere die Nummer
//     mit Firmenzusatz ("1234-ML").
//   * App-Datensätze, deren Nummer in HSC jemand anderem gehört und die HSC
//     nicht kennt, bekommen "<Nr>-alt" und kommen auf die Klärungsliste.
//   * Alle Personen, die nur in HSC stehen, werden (inaktiv) angelegt.
//   * Lohnsteuer: SteuerArt 1 (Steuerklasse 8/9) = pauschal, sonst
//     Steuerklasse 1; PGS 101 = SV-pflichtig, 109 = Minijob.
//   * Bei vorhandenen Personen bleibt die Abrechnungsart unverändert; leere
//     Felder werden aus HSC gefüllt, Abweichungen nur auf Wunsch übernommen.
//
// Buchstaben-Endungen (1234 -> 1234a) sind Statuswechsel (neuer Datensatz,
// employees.vorgaenger_employee_id) - sie bleiben eigene Datensätze und
// werden nur mit derselben Endung verglichen.
import {
  FAMILIENSTAND,
  STAATSANGEHOERIGKEIT,
  hscDatum,
  normName,
  type HscZeile,
} from "./hscImport";
import type { Abrechnungsart } from "./types";

export interface LwHscDatei {
  name: string;
  firma: string; // MA / ML
  zeilen: HscZeile[];
}

// Ein HSC-Datensatz (eine Personalnummer in einer Firma)
export interface LwHscSatz {
  firma: string;
  nr: string; // wie in HSC
  nrNorm: string;
  endung: string; // Buchstaben-Endung ("" / "a" / "b" ...)
  name: string;
  vorname: string;
  geburtsdatum: string | null;
  sv: string | null;
  steuerId: string | null;
  von: string | null; // Eintritt
  bis: string | null; // Austritt
  aktiv: boolean;
  zeile: HscZeile;
}

// Bestehende Person der App (Bereich Landwirtschaft)
export interface LwAppPerson {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  geburtsdatum: string | null;
  sozialversicherungsnummer: string | null;
  steuer_id: string | null;
  aktiv: boolean;
  notiz: string | null;
  vorgaenger_employee_id: string | null;
  // weitere Stammfelder für "leere Felder füllen"
  [feld: string]: unknown;
}

export interface LwZeitraum {
  firma: string;
  von: string;
  bis: string | null;
  plausibel?: boolean; // false = Datum offensichtlich vertippt (nur Eintrittsjahr zählt, kein Beschäftigungszeitraum)
}

// Felder, die aus HSC gefüllt werden dürfen, mit Gruppe für "überschreiben"
export const LW_FELDER: { feld: string; label: string; gruppe: LwFeldGruppe }[] = [
  { feld: "name", label: "Name", gruppe: "name" },
  { feld: "vorname", label: "Vorname", gruppe: "name" },
  { feld: "geburtsdatum", label: "Geburtsdatum", gruppe: "name" },
  { feld: "geschlecht", label: "Geschlecht", gruppe: "person" },
  { feld: "geburtsname", label: "Geburtsname", gruppe: "person" },
  { feld: "geburtsort", label: "Geburtsort", gruppe: "person" },
  { feld: "staatsangehoerigkeit", label: "Staatsangehörigkeit", gruppe: "person" },
  { feld: "nationalitaet", label: "Nationalität", gruppe: "person" },
  { feld: "familienstand", label: "Familienstand", gruppe: "person" },
  { feld: "strasse", label: "Straße", gruppe: "adresse" },
  { feld: "hausnummer", label: "Hausnummer", gruppe: "adresse" },
  { feld: "plz", label: "PLZ", gruppe: "adresse" },
  { feld: "ort", label: "Ort", gruppe: "adresse" },
  { feld: "land", label: "Land", gruppe: "adresse" },
  { feld: "telefon_privat", label: "Telefon", gruppe: "kontakt" },
  { feld: "email_privat", label: "E-Mail", gruppe: "kontakt" },
  { feld: "sozialversicherungsnummer", label: "SV-Nummer", gruppe: "ids" },
  { feld: "steuer_id", label: "Steuer-ID", gruppe: "ids" },
  { feld: "iban", label: "IBAN", gruppe: "bank" },
  { feld: "bic", label: "BIC", gruppe: "bank" },
  { feld: "zahlungsempfaenger", label: "Zahlungsempfänger", gruppe: "bank" },
];
export type LwFeldGruppe = "name" | "person" | "adresse" | "kontakt" | "ids" | "bank";
export const LW_GRUPPEN: Record<LwFeldGruppe, string> = {
  name: "Name / Geburtsdatum",
  person: "Persönliches",
  adresse: "Adresse",
  kontakt: "Telefon / E-Mail",
  ids: "SV-Nummer / Steuer-ID",
  bank: "Bankverbindung",
};

export function nrNorm(nr: string): string {
  return (nr ?? "").toLowerCase().replace(/\s+/g, "");
}
export function nrEndung(nr: string): string {
  const m = nrNorm(nr).match(/^\d+([a-z]*)$/);
  return m ? m[1] : "";
}
function svNorm(s: string | null | undefined): string | null {
  const v = (s ?? "").replace(/\s/g, "").toUpperCase();
  return v || null;
}
function stIdNorm(s: string | null | undefined): string | null {
  const v = (s ?? "").replace(/\D/g, "");
  return v.length >= 8 ? v : null;
}

// --- HSC-Dateien lesen ---------------------------------------------------------

export function lwSaetzeLesen(dateien: LwHscDatei[]): LwHscSatz[] {
  const out: LwHscSatz[] = [];
  for (const d of dateien) {
    for (const z of d.zeilen) {
      const nr = (z.Personalnummer ?? "").trim();
      if (!nr) continue;
      out.push({
        firma: d.firma,
        nr,
        nrNorm: nrNorm(nr),
        endung: nrEndung(nr),
        name: (z.Name ?? "").trim(),
        vorname: (z.Vorname ?? "").trim(),
        geburtsdatum: hscDatum(z.Geburtsdatum),
        sv: svNorm(z.VersicherungsNummer),
        steuerId: stIdNorm(z.SteuerID),
        von: hscDatum(z.Eintrittsdatum),
        bis: hscDatum(z.Austrittsdatum),
        aktiv: z.Aktiv === "True",
        zeile: z,
      });
    }
  }
  return out;
}

export function lwAbrechnungsart(z: HscZeile): Abrechnungsart {
  const pgs = (z.PGS ?? "").trim();
  if (pgs === "101") return "sozialversicherungspflichtig";
  if (pgs === "109") return "minijob";
  if ((z.SteuerArt ?? "").trim() === "1") return "pauschal";
  return "lohnsteuerklasse_1";
}

// Stammfelder aus einem HSC-Satz (Spaltennamen wie employees)
export function lwStammAusHsc(s: LwHscSatz): Record<string, string | null> {
  const z = s.zeile;
  const f = (k: string) => (z[k] ?? "").trim();
  const sta = STAATSANGEHOERIGKEIT[f("Staatsangehoerigkeit")] ?? null;
  const fam = f("Familienstand").toLowerCase();
  const geschlecht = /^m/i.test(f("Geschlecht")) ? "M" : /^w/i.test(f("Geschlecht")) ? "F" : null;
  return {
    name: s.name || null,
    vorname: s.vorname || null,
    geburtsdatum: s.geburtsdatum,
    geschlecht,
    geburtsname: f("Geburtsname") || null,
    geburtsort: f("Geburtsort") && f("Geburtsort").toLowerCase() !== "unbekannt" ? f("Geburtsort") : null,
    staatsangehoerigkeit: sta,
    nationalitaet: sta,
    familienstand: fam in FAMILIENSTAND ? FAMILIENSTAND[fam] : null,
    strasse: f("Strasse") || null,
    hausnummer: f("HausNummer") || null,
    plz: f("PLZ") || null,
    ort: [f("Ort"), f("Ortsteil")].filter(Boolean).join(" - ") || null,
    land: f("Land") || null,
    telefon_privat: f("Handy") || f("Telefon") || null,
    email_privat: f("Email") || null,
    sozialversicherungsnummer: s.sv,
    steuer_id: s.steuerId,
    iban: f("IBAN").replace(/\s/g, "").toUpperCase() || null,
    bic: f("BIC").replace(/\s/g, "").toUpperCase() || null,
    zahlungsempfaenger: f("Empfaenger") || null,
  };
}

// Vergleich zweier Feldwerte (Groß/Klein, Leerzeichen, Akzente egal)
function gleich(feld: string, a: unknown, b: unknown): boolean {
  const s = (v: unknown) => (v == null ? "" : String(v));
  if (feld === "iban" || feld === "bic" || feld === "sozialversicherungsnummer") {
    return s(a).replace(/\s/g, "").toUpperCase() === s(b).replace(/\s/g, "").toUpperCase();
  }
  if (feld === "steuer_id" || feld === "telefon_privat") {
    return s(a).replace(/\D/g, "") === s(b).replace(/\D/g, "");
  }
  return normName(s(a)) === normName(s(b));
}

// Tippfehler-tolerant: Levenshtein-Abstand (kurze Namen)
export function abstand(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let p = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1));
      p = t;
    }
  }
  return d[b.length];
}
function namensAehnlich(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  return x === y || abstand(x, y) <= 2 || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}
interface Ident {
  name: string;
  vorname: string;
  geburtsdatum: string | null;
  sv: string | null;
}
// Gleiche Personalnummer: dieselbe Person, wenn höchstens eines von Name /
// Vorname / Geburtsdatum abweicht (Tippfehler, Heirat, Zahlendreher in der
// alten Excel). Widersprechen sich die SV-Nummern, muss alles passen.
export function gleichePersonBeiGleicherNr(a: Ident, b: Ident): boolean {
  const punkte =
    (a.geburtsdatum && a.geburtsdatum === b.geburtsdatum ? 1 : 0) +
    (namensAehnlich(a.name, b.name) ? 1 : 0) +
    (namensAehnlich(a.vorname, b.vorname) ? 1 : 0);
  if (a.sv && b.sv && a.sv !== b.sv) return punkte === 3;
  return punkte >= 2;
}

// --- Abgleich --------------------------------------------------------------------

export interface LwSlot {
  schluessel: string; // Gruppe|Endung
  hsc: LwHscSatz[]; // neueste zuerst
  app: LwAppPerson[];
  haupt: LwAppPerson | null; // der App-Datensatz, der ergänzt wird
  nrNeu: string | null; // Ziel-Personalnummer (null = App-only, behält)
  verbindungUnsicher: boolean; // nur über SV/Steuer-ID verbunden, Name/Geburtsdatum weichen ab
}

export interface LwUmnummerierung {
  id: string;
  alt: string;
  neu: string;
  name: string;
  grund: string;
}

export interface LwNeu {
  slot: LwSlot;
  stamm: Record<string, unknown>;
  // Statuswechsel (1234 -> 1234a): Personalnummer des Vorgänger-Datensatzes
  vorgaengerNr: string | null;
}

export interface LwAbweichung {
  id: string;
  personal_nr: string; // nach dem Abgleich
  name: string;
  feld: string;
  app: string;
  hsc: string;
}

export interface LwErgaenzung {
  id: string;
  leer: Record<string, string>; // leere App-Felder -> HSC-Wert
  abweichend: Record<string, string>; // abweichende Felder -> HSC-Wert
  notizZusatz: string | null;
}

export type LwKlaerungArt = "dublette" | "vermischt" | "nr_kollision" | "nicht_in_hsc" | "unsicher" | "datum";
export interface LwKlaerung {
  art: LwKlaerungArt;
  personal_nr: string; // nach dem Abgleich
  name: string;
  text: string;
  ids: string[];
}

export interface LwSaisonDaten {
  employeeKey: string; // App-id oder "neu:<nr>"
  zeitraeume: LwZeitraum[];
  saisonFirma: Record<number, string>;
}

export interface LwPlan {
  saetze: number;
  personenHsc: number;
  bestaetigt: number; // App-Datensatz mit gültiger HSC-Nummer
  umnummerierungen: LwUmnummerierung[];
  neu: LwNeu[];
  ergaenzungen: LwErgaenzung[];
  abweichungen: LwAbweichung[];
  klaerung: LwKlaerung[];
  saison: LwSaisonDaten[];
  slots: LwSlot[];
}

function nameVon(p: { name: string; vorname: string }): string {
  return `${p.name}, ${p.vorname}`;
}

// Saisonjahre aus Zeiträumen (wie Vertriebs-Import): Jahre von Eintritt bis
// Austritt, ohne Austritt bis heute (aktiv) bzw. nur das Eintrittsjahr
export function lwSaisonFirma(zeitraeume: LwZeitraum[], aktiv: boolean, heuteJahr: number): Record<number, string> {
  const out: Record<number, string> = {};
  for (const t of [...zeitraeume].sort((a, b) => a.von.localeCompare(b.von))) {
    const ab = Number(t.von.slice(0, 4));
    if (ab < 1990 || ab > heuteJahr + 1) continue;
    let bis = t.bis ? Number(t.bis.slice(0, 4)) : aktiv ? heuteJahr : ab;
    if (t.plausibel === false || bis > heuteJahr + 1) bis = ab;
    for (let j = ab; j <= Math.max(ab, bis); j++) out[j] = t.firma;
  }
  return out;
}

export function lwAbgleich(
  saetze: LwHscSatz[],
  app: LwAppPerson[],
  appJahre: Map<string, number[]>,
  belegteNummernAndere: Set<string>, // normierte Nummern außerhalb LW (z.B. Vertrieb) - nur zur Sicherheit
  heuteJahr: number
): LwPlan {
  // 1) Personen bilden: Union-Find über HSC-Sätze und App-Datensätze
  type Knoten = { art: "h"; s: LwHscSatz } | { art: "a"; p: LwAppPerson };
  const knoten: Knoten[] = [
    ...saetze.map((s) => ({ art: "h" as const, s })),
    ...app.map((p) => ({ art: "a" as const, p })),
  ];
  const par = knoten.map((_, i) => i);
  const finde = (i: number): number => {
    while (par[i] !== i) {
      par[i] = par[par[i]];
      i = par[i];
    }
    return i;
  };
  const erster = new Map<string, number>();
  const verbinde = (i: number, k: string) => {
    const j = erster.get(k);
    if (j === undefined) erster.set(k, i);
    else par[finde(i)] = finde(j);
  };
  knoten.forEach((k, i) => {
    const name = k.art === "h" ? k.s.name : k.p.name;
    const vorname = k.art === "h" ? k.s.vorname : k.p.vorname;
    const geb = k.art === "h" ? k.s.geburtsdatum : k.p.geburtsdatum;
    const sv = k.art === "h" ? k.s.sv : svNorm(k.p.sozialversicherungsnummer);
    const st = k.art === "h" ? k.s.steuerId : stIdNorm(k.p.steuer_id);
    if (sv) verbinde(i, `sv|${sv}`);
    if (st) verbinde(i, `st|${st}`);
    if (geb && normName(name) && normName(vorname)) verbinde(i, `g|${geb}|${normName(name)}|${normName(vorname)}`);
  });

  // unscharf: (a) gleiche Nummer + ähnliche Person, (b) gleiches
  // Geburtsdatum + beide Namen ähnlich
  const ident = (k: Knoten): Ident =>
    k.art === "h"
      ? { name: k.s.name, vorname: k.s.vorname, geburtsdatum: k.s.geburtsdatum, sv: k.s.sv }
      : { name: k.p.name, vorname: k.p.vorname, geburtsdatum: k.p.geburtsdatum, sv: svNorm(k.p.sozialversicherungsnummer) };
  const nachNr = new Map<string, number[]>();
  const nachGeb = new Map<string, number[]>();
  knoten.forEach((k, i) => {
    const nr = nrNorm(k.art === "h" ? k.s.nr : k.p.personal_nr);
    nachNr.set(nr, [...(nachNr.get(nr) ?? []), i]);
    const g = ident(k).geburtsdatum;
    if (g) nachGeb.set(g, [...(nachGeb.get(g) ?? []), i]);
  });
  const paare = (liste: number[], passt: (a: Ident, b: Ident) => boolean) => {
    for (let x = 0; x < liste.length; x++)
      for (let y = x + 1; y < liste.length; y++) {
        const i = liste[x];
        const j = liste[y];
        if (finde(i) !== finde(j) && passt(ident(knoten[i]), ident(knoten[j]))) par[finde(i)] = finde(j);
      }
  };
  nachNr.forEach((l) => paare(l, gleichePersonBeiGleicherNr));
  nachGeb.forEach((l) =>
    paare(l, (a, b) => !(a.sv && b.sv && a.sv !== b.sv) && namensAehnlich(a.name, b.name) && namensAehnlich(a.vorname, b.vorname))
  );

  // 2) Slots: Person x Buchstaben-Endung
  const slotMap = new Map<string, LwSlot>();
  knoten.forEach((k, i) => {
    const nr = k.art === "h" ? k.s.nr : k.p.personal_nr;
    const key = `${finde(i)}|${nrEndung(nr)}`;
    let slot = slotMap.get(key);
    if (!slot) {
      slot = { schluessel: key, hsc: [], app: [], haupt: null, nrNeu: null, verbindungUnsicher: false };
      slotMap.set(key, slot);
    }
    if (k.art === "h") slot.hsc.push(k.s);
    else slot.app.push(k.p);
  });
  const slots = Array.from(slotMap.values());
  const jahreVon = (p: LwAppPerson) => appJahre.get(p.id) ?? [];
  const juengsterEintritt = (sl: LwSlot) => sl.hsc[0]?.von ?? "";
  slots.forEach((sl) => {
    sl.hsc.sort((a, b) => (b.von ?? "").localeCompare(a.von ?? "") || a.firma.localeCompare(b.firma));
    const hscNrn = new Set(sl.hsc.map((s) => s.nrNorm));
    // Haupt-Datensatz: App-Nummer ist gültige HSC-Nummer, sonst jüngste Jahre / aktiv
    const rang = (p: LwAppPerson) =>
      (hscNrn.has(nrNorm(p.personal_nr)) ? 1e6 : 0) + (p.aktiv ? 1e5 : 0) + Math.max(0, ...jahreVon(p));
    sl.app.sort((a, b) => rang(b) - rang(a));
    sl.haupt = sl.app[0] ?? null;
    const namen = new Set(
      [...sl.hsc.map((s) => `${s.geburtsdatum}|${normName(s.name)}|${normName(s.vorname)}`),
       ...sl.app.map((p) => `${p.geburtsdatum}|${normName(p.name)}|${normName(p.vorname)}`)]
    );
    sl.verbindungUnsicher = namen.size > 1;
  });

  // 3) Nummern vergeben: jüngster Eintritt zuerst, dann die App-only-Datensätze
  const vergeben = new Set<string>(belegteNummernAndere);
  const zielNr = new Map<string, string>(); // App-id -> Nummer
  const hscSlots = slots.filter((s) => s.hsc.length > 0)
    .sort((a, b) => juengsterEintritt(b).localeCompare(juengsterEintritt(a)));
  const klaerung: LwKlaerung[] = [];
  for (const sl of hscSlots) {
    const kandidaten: string[] = [];
    if (sl.haupt && sl.hsc.some((s) => s.nrNorm === nrNorm(sl.haupt!.personal_nr))) {
      kandidaten.push(sl.hsc.find((s) => s.nrNorm === nrNorm(sl.haupt!.personal_nr))!.nr);
    }
    sl.hsc.forEach((s) => kandidaten.push(s.nr));
    let nr = kandidaten.find((k) => !vergeben.has(nrNorm(k)));
    if (!nr) {
      // alle HSC-Nummern schon an jüngere Personen vergeben -> Firmenzusatz
      const s = sl.hsc[0];
      nr = `${s.nr}-${s.firma}`;
      for (let i = 2; vergeben.has(nrNorm(nr)); i++) nr = `${s.nr}-${s.firma}${i}`;
      klaerung.push({
        art: "nr_kollision",
        personal_nr: nr,
        name: nameVon(s),
        text: `HSC-Nummer ${s.nr} gehört in der anderen Firma einer jünger eingetretenen Person - bekommt ${nr}`,
        ids: sl.haupt ? [sl.haupt.id] : [],
      });
    }
    vergeben.add(nrNorm(nr));
    sl.nrNeu = nr;
    if (sl.haupt) zielNr.set(sl.haupt.id, nr);
  }
  // übrige App-Datensätze (Dubletten, nicht in HSC): Nummer behalten, wenn frei
  const rest = slots.flatMap((sl) => sl.app.filter((p) => !zielNr.has(p.id)));
  for (const p of rest) {
    let nr = p.personal_nr;
    if (vergeben.has(nrNorm(nr))) {
      nr = `${p.personal_nr}-alt`;
      for (let i = 2; vergeben.has(nrNorm(nr)); i++) nr = `${p.personal_nr}-alt${i}`;
    }
    vergeben.add(nrNorm(nr));
    zielNr.set(p.id, nr);
  }

  // HSC-Nummer -> Slot (für "Nummer gehört jemand anderem")
  const hscNrSlot = new Map<string, LwSlot>();
  slots.forEach((sl) => sl.hsc.forEach((s) => hscNrSlot.set(s.nrNorm, sl)));

  const gruppenMitHsc = new Set(slots.filter((s) => s.hsc.length).map((s) => s.schluessel.split("|")[0]));

  // 4) Ergebnis je Slot
  const umnummerierungen: LwUmnummerierung[] = [];
  const neu: LwNeu[] = [];
  const ergaenzungen: LwErgaenzung[] = [];
  const abweichungen: LwAbweichung[] = [];
  const saison: LwSaisonDaten[] = [];
  let bestaetigt = 0;

  for (const sl of slots) {
    for (const p of sl.app) {
      const ziel = zielNr.get(p.id)!;
      const fremd = hscNrSlot.get(nrNorm(p.personal_nr));
      const gehoertAnderem = !!fremd && fremd !== sl;
      if (ziel !== p.personal_nr) {
        umnummerierungen.push({
          id: p.id,
          alt: p.personal_nr,
          neu: ziel,
          name: nameVon(p),
          grund: gehoertAnderem
            ? `Nummer gehört in HSC ${nameVon(fremd!.hsc[0])}`
            : p === sl.haupt && sl.hsc.length
              ? nrNorm(ziel) === nrNorm(p.personal_nr)
                ? "Schreibweise wie in HSC"
                : "Nummer in HSC nicht vorhanden - neueste HSC-Nummer"
              : "Nummer wird für eine andere Person gebraucht",
        });
      }
      if (gehoertAnderem && jahreVon(p).length > 0) {
        const fremdJahre = Object.keys(
          lwSaisonFirma(
            fremd!.hsc.filter((s) => s.von).map((s) => ({ firma: s.firma, von: s.von!, bis: s.bis })),
            fremd!.hsc.some((s) => s.aktiv),
            heuteJahr
          )
        );
        klaerung.push({
          art: "vermischt",
          personal_nr: ziel,
          name: nameVon(p),
          text:
            `Trug die Nummer ${p.personal_nr}, die in HSC ${nameVon(fremd!.hsc[0])} gehört. ` +
            `Saisonjahre in der App: ${jahreVon(p).join(", ")}` +
            (fremdJahre.length ? ` - ${nameVon(fremd!.hsc[0])} laut HSC: ${fremdJahre.join(", ")}` : "") +
            ". Bitte prüfen, ob Jahre der anderen Person hier hängen.",
          ids: [p.id],
        });
      }
    }
    if (sl.app.length > 1) {
      klaerung.push({
        art: "dublette",
        personal_nr: zielNr.get(sl.haupt!.id)!,
        name: nameVon(sl.haupt!),
        text:
          `Dieselbe Person mehrfach im Stamm: ` +
          sl.app.map((p) => `${zielNr.get(p.id)}${zielNr.get(p.id) !== p.personal_nr ? ` (bisher ${p.personal_nr})` : ""} [${jahreVon(p).join(", ") || "ohne Jahre"}]`).join(" · ") +
          " - zusammenführen",
        ids: sl.app.map((p) => p.id),
      });
    }
    if (sl.hsc.length === 0) {
      // Statuswechsel-Datensatz (z.B. 1234a), dessen Person in HSC unter
      // einer anderen Endung steht: kein Klärungsfall
      const root = sl.schluessel.split("|")[0];
      if (gruppenMitHsc.has(root)) continue;
      sl.app.forEach((p) =>
        klaerung.push({
          art: "nicht_in_hsc",
          personal_nr: zielNr.get(p.id)!,
          name: nameVon(p),
          text:
            `In HSC nicht gefunden` +
            (zielNr.get(p.id) !== p.personal_nr ? ` - Nummer ${p.personal_nr} gehört dort jemand anderem` : "") +
            (jahreVon(p).length ? ` · Jahre ${jahreVon(p).join(", ")}` : ""),
          ids: [p.id],
        })
      );
      continue;
    }

    const neuester = sl.hsc[0];
    const hscStamm = lwStammAusHsc(neuester);
    // fehlende Werte aus älteren HSC-Sätzen derselben Person
    for (const s of sl.hsc.slice(1)) {
      const alt = lwStammAusHsc(s);
      for (const k of Object.keys(hscStamm)) if (!hscStamm[k] && alt[k]) hscStamm[k] = alt[k];
    }
    const zeitraeume: LwZeitraum[] = [];
    for (const s of sl.hsc) {
      if (s.von && !zeitraeume.some((t) => t.von === s.von && t.bis === s.bis)) {
        const jahr = (d: string | null) => (d ? Number(d.slice(0, 4)) : null);
        const plausibel =
          jahr(s.von)! >= 1990 && jahr(s.von)! <= heuteJahr + 1 && (s.bis === null || jahr(s.bis)! <= heuteJahr + 1);
        if (!plausibel) {
          klaerung.push({
            art: "datum",
            personal_nr: sl.nrNeu!,
            name: nameVon(s),
            text: `HSC ${s.firma} ${s.nr}: Eintritt ${s.von} / Austritt ${s.bis ?? "-"} unplausibel - nur das Eintrittsjahr wird gezählt, kein Beschäftigungszeitraum angelegt. Bitte in HSC korrigieren.`,
            ids: sl.haupt ? [sl.haupt.id] : [],
          });
        }
        zeitraeume.push({ firma: s.firma, von: s.von, bis: s.bis, plausibel });
      }
    }
    const aktiv = sl.hsc.some((s) => s.aktiv);
    const andereNrn = Array.from(new Set(sl.hsc.map((s) => s.nr))).filter(
      (n) => nrNorm(n) !== nrNorm(sl.nrNeu!)
    );

    if (sl.verbindungUnsicher) {
      klaerung.push({
        art: "unsicher",
        personal_nr: sl.nrNeu!,
        name: nameVon(neuester),
        text:
          "Nur über SV-Nummer/Steuer-ID zugeordnet, Name oder Geburtsdatum weichen ab: " +
          Array.from(new Set([
            ...sl.hsc.map((s) => `${nameVon(s)} ${s.geburtsdatum ?? "?"} (HSC ${s.firma} ${s.nr})`),
            ...sl.app.map((p) => `${nameVon(p)} ${p.geburtsdatum ?? "?"} (App ${p.personal_nr})`),
          ])).join(" · "),
        ids: sl.app.map((p) => p.id),
      });
    }

    if (sl.haupt) {
      const p = sl.haupt;
      if (sl.hsc.some((s) => s.nrNorm === nrNorm(p.personal_nr))) bestaetigt++;
      const leer: Record<string, string> = {};
      const abweichend: Record<string, string> = {};
      for (const { feld, label } of LW_FELDER) {
        const h = hscStamm[feld];
        if (!h) continue;
        const a = p[feld];
        if (a == null || a === "") leer[feld] = h;
        else if (!gleich(feld, a, h)) {
          abweichend[feld] = h;
          abweichungen.push({ id: p.id, personal_nr: sl.nrNeu!, name: nameVon(p), feld: label, app: String(a), hsc: h });
        }
      }
      const notizZusatz = andereNrn.length && !(p.notiz ?? "").includes("weitere HSC-Nummern")
        ? `weitere HSC-Nummern: ${andereNrn.join(", ")}`
        : null;
      if (Object.keys(leer).length || Object.keys(abweichend).length || notizZusatz) {
        ergaenzungen.push({ id: p.id, leer, abweichend, notizZusatz });
      }
      saison.push({ employeeKey: p.id, zeitraeume, saisonFirma: lwSaisonFirma(zeitraeume, aktiv, heuteJahr) });
    } else {
      const s = neuester;
      // Vorgänger: Datensatz derselben Person mit der nächstniedrigeren Endung
      const root = sl.schluessel.split("|")[0];
      const endung = sl.schluessel.slice(root.length + 1);
      const vorgaenger = slots
        .filter((x) => x.schluessel.startsWith(`${root}|`) && x !== sl)
        .map((x) => ({ x, e: x.schluessel.slice(root.length + 1) }))
        .filter(({ e }) => e < endung && (e.length < endung.length || e.length === endung.length))
        .sort((a, b) => (b.e.length - a.e.length) || b.e.localeCompare(a.e))[0];
      const vorgaengerNr = vorgaenger
        ? vorgaenger.x.haupt
          ? zielNr.get(vorgaenger.x.haupt.id) ?? null
          : vorgaenger.x.nrNeu
        : null;
      neu.push({
        slot: sl,
        vorgaengerNr,
        stamm: {
          ...hscStamm,
          personal_nr: sl.nrNeu,
          bereich: "LW",
          abrechnungsart: lwAbrechnungsart(s.zeile),
          funktion: (s.zeile.Beschaeftigung ?? "").trim() || null,
          aktiv: false,
          herkunft: null,
          notiz:
            `Import aus HSC (${Array.from(new Set(sl.hsc.map((x) => `${x.firma} ${x.nr}`))).join(", ")})` +
            (andereNrn.length ? `; weitere HSC-Nummern: ${andereNrn.join(", ")}` : ""),
        },
      });
      saison.push({ employeeKey: `neu:${sl.nrNeu}`, zeitraeume, saisonFirma: lwSaisonFirma(zeitraeume, aktiv, heuteJahr) });
    }
  }

  const reihenfolge: Record<LwKlaerungArt, number> = { vermischt: 0, dublette: 1, nr_kollision: 2, datum: 3, unsicher: 4, nicht_in_hsc: 5 };
  klaerung.sort((a, b) => reihenfolge[a.art] - reihenfolge[b.art] || a.personal_nr.localeCompare(b.personal_nr, "de", { numeric: true }));
  umnummerierungen.sort((a, b) => a.alt.localeCompare(b.alt, "de", { numeric: true }));

  return {
    saetze: saetze.length,
    personenHsc: slots.filter((s) => s.hsc.length).length,
    bestaetigt,
    umnummerierungen,
    neu,
    ergaenzungen,
    abweichungen,
    klaerung,
    saison,
    slots,
  };
}

// Prüft, dass die Nummernvergabe in sich eindeutig ist (für Tests/Sicherheit)
export function lwPlanPruefen(plan: LwPlan, app: LwAppPerson[]): string[] {
  const fehler: string[] = [];
  const ende = new Map<string, string>(); // norm -> wer
  const umn = new Map(plan.umnummerierungen.map((u) => [u.id, u.neu]));
  for (const p of app) {
    const nr = nrNorm(umn.get(p.id) ?? p.personal_nr);
    if (ende.has(nr)) fehler.push(`Nummer ${nr} doppelt (${ende.get(nr)} / ${p.id})`);
    ende.set(nr, p.id);
  }
  for (const n of plan.neu) {
    const nr = nrNorm(String(n.stamm.personal_nr));
    if (ende.has(nr)) fehler.push(`Nummer ${nr} doppelt (neu)`);
    ende.set(nr, "neu");
  }
  return fehler;
}
