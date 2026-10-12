// Lokale Warteschlange fuer ernte_scan-Zeilen, die wegen Netzausfall/
// Supabase-Fehler nicht sofort geschrieben werden konnten - siehe
// docs/erntewirtschaft-plan.md Teil D ("lokale Warteschlange + Retry").
//
// Bewusst eine einfache JSON-Zeilen-Datei statt SQLite: better-sqlite3
// braucht ein natives Binary passend zur Node-Version/Plattform - auf
// einem frischen Windows-Rechner ohne vorhandenes Binary (z. B. sehr neue
// Node-Version) versucht npm, es selbst zu kompilieren, und scheitert
// ohne Visual-Studio-Build-Tools/funktionierendes Python. Bei der
// erwarteten Menge (einzelne Wiegungen, nicht tausende/Sekunde) reicht
// eine simple Datei völlig.
import fs from "node:fs";

export function einreihen(pfad, payload) {
  fs.appendFileSync(pfad, `${JSON.stringify(payload)}\n`);
}

export function wartendeHolen(pfad) {
  if (!fs.existsSync(pfad)) return [];
  return fs
    .readFileSync(pfad, "utf8")
    .split("\n")
    .filter((zeile) => zeile.trim().length > 0)
    .map((zeile) => JSON.parse(zeile));
}

/** Ersetzt die Datei durch genau die Eintraege, die noch offen sind (leer -> Datei weg). */
export function schreibeZurueck(pfad, payloads) {
  if (payloads.length === 0) {
    fs.rmSync(pfad, { force: true });
    return;
  }
  fs.writeFileSync(pfad, payloads.map((p) => JSON.stringify(p)).join("\n") + "\n");
}

export function anzahlWartend(pfad) {
  return wartendeHolen(pfad).length;
}
