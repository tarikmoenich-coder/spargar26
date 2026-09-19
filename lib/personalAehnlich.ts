// Findet in der Personalplanung Personen, die schon einmal hier waren, auch
// wenn die Schreibweise abweicht (Nutzer-Vorgabe 2026-09-19: "sonst rutscht
// mir jemand als neu durch, der schon mal da war"). Drei Hilfen:
//   - Namen werden ohne Akzente/Sonderzeichen verglichen (Ștefan = Stefan),
//   - Name und Vorname dürfen vertauscht sein,
//   - bei gleichem Geburtsdatum genügt ein ÄHNLICHER Name (kleiner Tippfehler-
//     Abstand). Das Geburtsdatum allein reicht bewusst NICHT: bei tausenden
//     Personen im Stamm teilen sich zufällig viele dasselbe Datum.

import type { Employee } from "@/lib/types";

export function normalisiereName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ł/gi, "l")
    .replace(/đ/gi, "d")
    .replace(/ø/gi, "o")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let vorher = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const aktuell = [i];
    for (let j = 1; j <= b.length; j++) {
      aktuell[j] = Math.min(
        vorher[j] + 1,
        aktuell[j - 1] + 1,
        vorher[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    vorher = aktuell;
  }
  return vorher[b.length];
}

// Erlaubter Abstand wächst mit der Namenslänge (kurze Namen: fast keiner).
function aehnlich(a: string, b: string): boolean {
  if (!a || !b) return false;
  const toleranz = Math.min(2, Math.floor(Math.min(a.length, b.length) / 3));
  return levenshtein(a, b) <= toleranz;
}

function namensSchluessel(name: string, vorname: string): string {
  return [name, vorname].sort().join("|");
}

export interface PersonenIndex {
  nachGeburt: Map<string, Employee[]>;
  nachName: Map<string, Employee[]>;
}

export function baueIndex(employees: Employee[]): PersonenIndex {
  const nachGeburt = new Map<string, Employee[]>();
  const nachName = new Map<string, Employee[]>();
  for (const e of employees) {
    if (e.geburtsdatum) {
      const liste = nachGeburt.get(e.geburtsdatum) ?? [];
      liste.push(e);
      nachGeburt.set(e.geburtsdatum, liste);
    }
    const schluessel = namensSchluessel(
      normalisiereName(e.name),
      normalisiereName(e.vorname)
    );
    const liste = nachName.get(schluessel) ?? [];
    liste.push(e);
    nachName.set(schluessel, liste);
  }
  return { nachGeburt, nachName };
}

export interface AehnlichePerson {
  emp: Employee;
  grund: "name" | "geburtsdatum";
}

export function findeAehnliche(
  index: PersonenIndex,
  person: { name: string; vorname: string; geburtsdatum: string | null }
): AehnlichePerson[] {
  const n = normalisiereName(person.name);
  const v = normalisiereName(person.vorname);
  if (!n || !v) return [];
  const gd = person.geburtsdatum || null;
  const treffer = new Map<string, AehnlichePerson>();

  for (const e of index.nachName.get(namensSchluessel(n, v)) ?? []) {
    if (!gd || !e.geburtsdatum || e.geburtsdatum === gd) {
      treffer.set(e.id, { emp: e, grund: "name" });
    }
  }
  if (gd) {
    for (const e of index.nachGeburt.get(gd) ?? []) {
      if (treffer.has(e.id)) continue;
      const en = normalisiereName(e.name);
      const ev = normalisiereName(e.vorname);
      if (aehnlich(n, en) || aehnlich(v, ev) || aehnlich(n, ev) || aehnlich(v, en)) {
        treffer.set(e.id, { emp: e, grund: "geburtsdatum" });
      }
    }
  }
  return [...treffer.values()];
}
