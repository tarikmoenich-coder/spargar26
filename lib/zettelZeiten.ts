// Zeitrechnung für die "Zettel-Erfassung" (Stundenerfassung, Nutzer-Vorgabe
// 2026-09-20): die Vorarbeiter schreiben auf den Stundenzettel Vormittag
// von/bis und Nachmittag von/bis; die Mitarbeiterin tippt diese Zeiten EINMAL
// je Zettel (nicht je Person) und die App rechnet die Stunden aus. Die Zeiten
// werden seit migration_2026-10-15 zusätzlich am Eintrag gespeichert
// (work_entries.vm_von ... nm_bis); work_entries.stunden bleibt der
// Lohn-Wert, standardmäßig auf Viertelstunden gerundet.

// Akzeptiert "6:30", "06:30", "6.30", "630", "0630" und "6" (= 06:00).
// Einstellige Minuten ("6:3", "6,5") gelten bewusst als ungültig, weil sie
// sowohl als Uhrzeit als auch als Dezimalstunden gelesen werden könnten.
export function parseZeit(eingabe: string): number | null {
  const s = eingabe.trim().replace(/\s+/g, "");
  if (!s) return null;
  let h: number;
  let m: number;
  const mit = s.match(/^(\d{1,2})[:.,hH](\d{2})$/);
  if (mit) {
    h = Number(mit[1]);
    m = Number(mit[2]);
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    m = 0;
  } else if (/^\d{3,4}$/.test(s)) {
    m = Number(s.slice(-2));
    h = Number(s.slice(0, -2));
  } else {
    return null;
  }
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

export function formatZeit(minuten: number): string {
  const h = Math.floor(minuten / 60);
  const m = minuten % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function rundeViertelstunde(stunden: number): number {
  return Math.round(stunden * 4) / 4;
}

// Dezimalzahl mit Komma oder Punkt, 0..24 Stunden.
export function parseStunden(eingabe: string): number | null {
  const s = eingabe.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 24) return null;
  return n;
}

export interface ZettelZeiten {
  vmVon: string;
  vmBis: string;
  nmVon: string;
  nmBis: string;
}

export interface ZeitenErgebnis {
  // true, sobald gar nichts eingetragen ist
  leer: boolean;
  fehler: string | null;
  minuten: number;
  stunden: number; // auf Viertelstunden gerundet
  pauseMinuten: number | null; // Lücke zwischen Vormittag-Ende und Nachmittag-Beginn
}

function block(
  name: string,
  von: string,
  bis: string
): { minuten: number; fehler: string | null; leer: boolean; v?: number; b?: number } {
  const vLeer = von.trim() === "";
  const bLeer = bis.trim() === "";
  if (vLeer && bLeer) return { minuten: 0, fehler: null, leer: true };
  if (vLeer || bLeer) {
    return { minuten: 0, fehler: `${name}: von und bis angeben`, leer: false };
  }
  const v = parseZeit(von);
  const b = parseZeit(bis);
  if (v === null || b === null) {
    return { minuten: 0, fehler: `${name}: ungültige Uhrzeit`, leer: false };
  }
  if (b <= v) {
    return { minuten: 0, fehler: `${name}: Ende liegt nicht nach dem Beginn`, leer: false };
  }
  return { minuten: b - v, fehler: null, leer: false, v, b };
}

export type Rundung = "viertel" | "minute";

// Aus der Zeitangabe eines gespeicherten Eintrags ("06:30:00") wird "06:30".
export function zeitAnzeige(db: string | null | undefined): string {
  return db ? db.slice(0, 5) : "";
}

export function stundenAusZeiten(
  z: ZettelZeiten,
  rundung: Rundung = "viertel"
): ZeitenErgebnis {
  const vm = block("Vormittag", z.vmVon, z.vmBis);
  const nm = block("Nachmittag", z.nmVon, z.nmBis);
  if (vm.leer && nm.leer) {
    return { leer: true, fehler: null, minuten: 0, stunden: 0, pauseMinuten: null };
  }
  const fehler = vm.fehler ?? nm.fehler;
  if (fehler) {
    return { leer: false, fehler, minuten: 0, stunden: 0, pauseMinuten: null };
  }
  let pauseMinuten: number | null = null;
  if (vm.b !== undefined && nm.v !== undefined) {
    if (nm.v < vm.b) {
      return {
        leer: false,
        fehler: "Der Nachmittag beginnt vor dem Ende des Vormittags",
        minuten: 0,
        stunden: 0,
        pauseMinuten: null,
      };
    }
    pauseMinuten = nm.v - vm.b;
  }
  const minuten = vm.minuten + nm.minuten;
  return {
    leer: false,
    fehler: null,
    minuten,
    stunden:
      rundung === "viertel"
        ? rundeViertelstunde(minuten / 60)
        : Math.round((minuten / 60) * 100) / 100,
    pauseMinuten,
  };
}
