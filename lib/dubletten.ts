// Mögliche Dubletten im Personalstamm finden (2026-11-25, Seite
// /personal-zusammenfuehren). Reine Funktion, ohne Datenbank.
//
// Merkmale: gleiche SV-Nummer, gleiche Steuer-ID, gleicher Name + Vorname +
// Geburtsdatum, oder gleiches Geburtsdatum mit ähnlichen Namen (Tippfehler).
// Statuswechsel-Ketten (employees.vorgaenger_employee_id, 1234 -> 1234a)
// sind gewollt getrennte Datensätze und werden nicht vorgeschlagen.
// Nur innerhalb desselben Bereichs (Landwirtschaft / Vertrieb).
import { normName } from "./hscImport";
import { abstand } from "./hscImportLw";

export interface DublettenPerson {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  geburtsdatum: string | null;
  sozialversicherungsnummer: string | null;
  steuer_id: string | null;
  bereich: string;
  vorgaenger_employee_id: string | null;
}

export interface DublettenPaar {
  a: DublettenPerson;
  b: DublettenPerson;
  grund: string;
  sicher: boolean; // SV-Nummer / Steuer-ID / Name+Geburtsdatum exakt
}

function aehnlich(x: string, y: string): boolean {
  const a = normName(x);
  const b = normName(y);
  if (!a || !b) return false;
  return a === b || abstand(a, b) <= 2 || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
}

export function dublettenFinden(personen: DublettenPerson[]): DublettenPaar[] {
  const nachId = new Map(personen.map((p) => [p.id, p]));
  // Wurzel der Statuswechsel-Kette
  const wurzel = (p: DublettenPerson): string => {
    let x = p;
    const gesehen = new Set<string>();
    while (x.vorgaenger_employee_id && nachId.has(x.vorgaenger_employee_id) && !gesehen.has(x.id)) {
      gesehen.add(x.id);
      x = nachId.get(x.vorgaenger_employee_id)!;
    }
    return x.id;
  };
  const kette = new Map(personen.map((p) => [p.id, wurzel(p)]));
  const paare = new Map<string, DublettenPaar>();
  const merke = (a: DublettenPerson, b: DublettenPerson, grund: string, sicher: boolean) => {
    if (a.id === b.id || a.bereich !== b.bereich || kette.get(a.id) === kette.get(b.id)) return;
    const [x, y] = a.personal_nr.localeCompare(b.personal_nr, "de", { numeric: true }) <= 0 ? [a, b] : [b, a];
    const k = `${x.id}|${y.id}`;
    const alt = paare.get(k);
    if (!alt) paare.set(k, { a: x, b: y, grund, sicher });
    else if (!alt.grund.includes(grund)) {
      alt.grund += `, ${grund}`;
      alt.sicher = alt.sicher || sicher;
    }
  };
  const gruppen = (schluessel: (p: DublettenPerson) => string | null, grund: string, sicher: boolean) => {
    const m = new Map<string, DublettenPerson[]>();
    personen.forEach((p) => {
      const k = schluessel(p);
      if (k) m.set(k, [...(m.get(k) ?? []), p]);
    });
    m.forEach((l) => {
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) merke(l[i], l[j], grund, sicher);
    });
  };
  gruppen((p) => (p.sozialversicherungsnummer ?? "").replace(/\s/g, "").toUpperCase() || null, "gleiche SV-Nummer", true);
  gruppen((p) => {
    const s = (p.steuer_id ?? "").replace(/\D/g, "");
    return s.length >= 8 ? s : null;
  }, "gleiche Steuer-ID", true);
  gruppen(
    (p) => (p.geburtsdatum && normName(p.name) ? `${p.geburtsdatum}|${normName(p.name)}|${normName(p.vorname)}` : null),
    "gleicher Name + Geburtsdatum",
    true
  );
  // ähnliche Namen bei gleichem Geburtsdatum
  const nachGeb = new Map<string, DublettenPerson[]>();
  personen.forEach((p) => p.geburtsdatum && nachGeb.set(p.geburtsdatum, [...(nachGeb.get(p.geburtsdatum) ?? []), p]));
  nachGeb.forEach((l) => {
    for (let i = 0; i < l.length; i++)
      for (let j = i + 1; j < l.length; j++) {
        const a = l[i];
        const b = l[j];
        const svA = (a.sozialversicherungsnummer ?? "").replace(/\s/g, "").toUpperCase();
        const svB = (b.sozialversicherungsnummer ?? "").replace(/\s/g, "").toUpperCase();
        if (svA && svB && svA !== svB) continue; // verschiedene SV-Nummern = verschiedene Menschen
        if (aehnlich(a.name, b.name) && aehnlich(a.vorname, b.vorname)) {
          merke(a, b, "ähnlicher Name, gleiches Geburtsdatum", false);
        }
      }
  });
  return Array.from(paare.values()).sort(
    (x, y) => Number(y.sicher) - Number(x.sicher) || x.a.personal_nr.localeCompare(y.a.personal_nr, "de", { numeric: true })
  );
}
