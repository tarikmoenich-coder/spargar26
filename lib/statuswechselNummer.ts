// Personalnummern bei einem Statuswechsel (SV-frei -> SV-pflichtig usw.):
// die neue, mit der alten Person verknüpfte Nummer bekommt einen Buchstaben
// als Endung, und bei jedem weiteren Wechsel geht es im Alphabet weiter
// (Nutzer-Vorgabe 2026-09-21): 6386 -> 6386a -> 6386b -> 6386c ...
// Früher wurde stur ein "a" angehängt (6386a -> 6386aa).

// Nächste Nummer nach einem Statuswechsel. null, wenn kein Buchstabe mehr
// frei ist (Endung z bzw. Z).
export function naechsteStatuswechselNr(personalNr: string): string | null {
  const nr = personalNr.trim();
  if (nr === "") return null;
  const letzte = nr[nr.length - 1];
  // Endet die Nummer auf einen Buchstaben, der zu einer Nummer davor gehört
  // (mindestens ein Zeichen davor), wird er um eins weitergezählt.
  if (nr.length > 1 && /[a-zA-Z]/.test(letzte)) {
    if (letzte === "z" || letzte === "Z") return null;
    return nr.slice(0, -1) + String.fromCharCode(letzte.charCodeAt(0) + 1);
  }
  return `${nr}a`;
}

// Umkehrung (für den Excel-Import): 6386b -> 6386a, 6386a -> 6386. null,
// wenn die Nummer nicht auf einen Buchstaben endet.
export function vorgaengerStatuswechselNr(personalNr: string): string | null {
  const nr = personalNr.trim();
  if (nr.length < 2) return null;
  const letzte = nr[nr.length - 1];
  if (!/[a-zA-Z]/.test(letzte)) return null;
  if (letzte === "a" || letzte === "A") return nr.slice(0, -1);
  return nr.slice(0, -1) + String.fromCharCode(letzte.charCodeAt(0) - 1);
}
