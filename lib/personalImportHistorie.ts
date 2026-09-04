// Historie-Import: die komplette Personaldatei der Vorjahre (eine Zeile je
// Person UND Saison-Jahr) auf eine employees-Zeile je personal_nr eindampfen
// und die Jahre getrennt als Praesenz ablegen (employee_saison_praesenz).
//
// Nutzer-Vorgabe 2026-09-04:
//  - keine Jahresdetails, nur "war in Saison X da"
//  - jüngstes Jahr liefert die Stammdaten beim Eindampfen
//  - gleiche/sehr ähnliche Personen mit verschiedenen Personalnummern kommen
//    vor (Tippfehler / falsch als "zum ersten Mal hier" eingestuft) -> nicht
//    automatisch zusammenführen, sondern als Verdachtsfall markieren.

import { normalisiereHeader, type ImportZeile } from "./personalImport";

export const SAISON_HEADER_ALIASE = [
  "jahr",
  "saison",
  "saisonjahr",
  "erntejahr",
  "year",
];

// Erste Spalte, deren normalisierte Überschrift auf ein Saison-Alias passt.
export function erkenneSaisonSpalte(headers: string[]): string | null {
  for (const h of headers) {
    if (SAISON_HEADER_ALIASE.includes(normalisiereHeader(h))) return h;
  }
  return null;
}

// "2019", "Saison 2019", "2019/20" -> 2019; sonst null.
export function parseSaisonJahr(wert: string): number | null {
  const m = wert.trim().match(/(?:19|20)\d{2}/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1990 && n <= 2100 ? n : null;
}

// Name ohne Diakritika/Interpunktion/Groß-Klein - Grundlage für den
// Dubletten-Abgleich.
export function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    // restliche Diakritika (kroatisch č/ć/š/ž/đ, polnisch ą/ę/ł, rumänisch
    // ș/ț ...) auf den Grundbuchstaben reduzieren
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export interface HistoriePerson {
  personal_nr: string;
  name: string;
  vorname: string;
  geburtsdatum: string | null;
  gruppe_nr: string | null;
  herkunft: string | null;
  nationalitaet: string | null;
  ort: string | null;
  land: string | null;
  stundenlohn: number | null;
  abrechnungsart: ImportZeile["abrechnungsart"];
  sozialversicherungsnummer: string | null;
  steuer_id: string | null;
  iban: string | null;
  bic: string | null;
  zahlungsempfaenger: string | null;
  // sortiert, eindeutig
  jahre: number[];
  // Excel-Zeilennummern, aus denen diese Person zusammengesetzt wurde
  quellzeilen: number[];
  fehler: string[];
  warnungen: string[];
  // gesetzt von markiereVerdachtsdubletten(): gleicher/ähnlicher Mensch unter
  // anderer Personalnummer (in der Datei oder im bestehenden Stamm)
  verdacht: string | null;
}

interface RohEintrag {
  zeile: ImportZeile;
  saison_jahr: number | null;
}

function ausZeile(z: ImportZeile) {
  return {
    personal_nr: z.personal_nr,
    name: z.name,
    vorname: z.vorname,
    geburtsdatum: z.geburtsdatum,
    gruppe_nr: z.gruppe_nr,
    herkunft: z.herkunft,
    nationalitaet: z.nationalitaet,
    ort: z.ort,
    land: z.land,
    stundenlohn: z.stundenlohn,
    abrechnungsart: z.abrechnungsart,
    sozialversicherungsnummer: z.sozialversicherungsnummer,
    steuer_id: z.steuer_id,
    iban: z.iban,
    bic: z.bic,
    zahlungsempfaenger: z.zahlungsempfaenger,
  };
}

// Gruppiert die Rohzeilen nach personal_nr. Die Stammdaten kommen aus der
// Zeile mit dem jüngsten Saison-Jahr (fehlt das Jahr überall, gewinnt die
// zuletzt in der Datei stehende Zeile). Die Jahre werden vereinigt.
export function verdichtePersonen(eintraege: RohEintrag[]): HistoriePerson[] {
  const gruppen = new Map<string, RohEintrag[]>();
  for (const e of eintraege) {
    if (!e.zeile.personal_nr) continue; // fehlende Nr. bleibt eine Fehlerzeile
    const key = e.zeile.personal_nr.trim().toLowerCase();
    const liste = gruppen.get(key);
    if (liste) liste.push(e);
    else gruppen.set(key, [e]);
  }

  const out: HistoriePerson[] = [];
  for (const liste of gruppen.values()) {
    const sortiert = [...liste].sort(
      (a, b) =>
        (b.saison_jahr ?? b.zeile.zeile) - (a.saison_jahr ?? a.zeile.zeile)
    );
    const leit = sortiert[0].zeile;
    const jahre = [
      ...new Set(
        liste
          .map((e) => e.saison_jahr)
          .filter((j): j is number => j !== null)
      ),
    ].sort((a, b) => a - b);
    const warnungen = [...new Set(liste.flatMap((e) => e.zeile.warnungen))];
    const fehler: string[] = [];
    if (!leit.name) fehler.push("Name fehlt");
    if (!leit.vorname) fehler.push("Vorname fehlt");
    if (jahre.length === 0) {
      warnungen.push(
        "keine Saison/Jahr-Angabe in den Quellzeilen - Person wird ohne Jahre angelegt"
      );
    }

    out.push({
      ...ausZeile(leit),
      jahre,
      quellzeilen: liste.map((e) => e.zeile.zeile).sort((a, b) => a - b),
      fehler,
      warnungen,
      verdacht: null,
    });
  }
  return out;
}

export interface BestehenderMitarbeiter {
  personal_nr: string;
  name: string;
  vorname: string;
  geburtsdatum: string | null;
}

interface Kandidat {
  nr: string;
  quelle: "Datei" | "Stamm";
}

// Markiert Personen, die unter einer ANDEREN Personalnummer schon einmal
// vorkommen - stark: gleicher Name + gleiches Geburtsdatum; schwach: nur
// gleicher Name (+ Hinweis, das Geburtsdatum zu prüfen). Gleiche Nummer in
// Datei UND Stamm ist normal (Rückkehrer) und wird NICHT markiert.
export function markiereVerdachtsdubletten(
  personen: HistoriePerson[],
  bestehende: BestehenderMitarbeiter[]
): void {
  const stark = new Map<string, Kandidat[]>();
  const schwach = new Map<string, Kandidat[]>();

  const eintragen = (m: Map<string, Kandidat[]>, k: string, e: Kandidat) => {
    if (!k) return;
    const liste = m.get(k);
    if (liste) liste.push(e);
    else m.set(k, [e]);
  };
  const starkKey = (name: string, vorname: string, gebdat: string | null) =>
    gebdat && normName(name) && normName(vorname)
      ? `${gebdat}|${normName(name)}|${normName(vorname)}`
      : "";
  const schwachKey = (name: string, vorname: string) =>
    normName(name) && normName(vorname)
      ? `${normName(name)}|${normName(vorname)}`
      : "";

  for (const b of bestehende) {
    const e: Kandidat = { nr: b.personal_nr, quelle: "Stamm" };
    eintragen(stark, starkKey(b.name, b.vorname, b.geburtsdatum), e);
    eintragen(schwach, schwachKey(b.name, b.vorname), e);
  }
  for (const p of personen) {
    const e: Kandidat = { nr: p.personal_nr, quelle: "Datei" };
    eintragen(stark, starkKey(p.name, p.vorname, p.geburtsdatum), e);
    eintragen(schwach, schwachKey(p.name, p.vorname), e);
  }

  const beschreibe = (treffer: Kandidat[]): string => {
    const gesehen = new Set<string>();
    const teile: string[] = [];
    for (const t of treffer) {
      const s = `Nr. ${t.nr} (${t.quelle})`;
      if (!gesehen.has(s)) {
        gesehen.add(s);
        teile.push(s);
      }
    }
    return teile.join(", ");
  };

  for (const p of personen) {
    const eigen = p.personal_nr.trim().toLowerCase();
    const sTreffer = (stark.get(starkKey(p.name, p.vorname, p.geburtsdatum)) ?? []).filter(
      (t) => t.nr.trim().toLowerCase() !== eigen
    );
    if (sTreffer.length > 0) {
      p.verdacht = `gleicher Name + Geburtsdatum wie ${beschreibe(sTreffer)}`;
      continue;
    }
    const wTreffer = (schwach.get(schwachKey(p.name, p.vorname)) ?? []).filter(
      (t) => t.nr.trim().toLowerCase() !== eigen
    );
    if (wTreffer.length > 0) {
      p.verdacht = `gleicher Name wie ${beschreibe(wTreffer)} - Geburtsdatum prüfen`;
    }
  }
}
