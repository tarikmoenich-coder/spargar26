// Einheitliches Spalten-/Kopfzeilenfarbschema für die Lohn-Tabellen
// (Lohnübersicht, Auszahlungen) - Nutzer-Vorgabe 2026-08-09, angelehnt an
// die frühere Excel-Datei: Brutto/Netto bekommen eine durchgehende
// Zellfarbe (Kopf + Zellen), die übrigen Kategorien nur eine farbige
// Überschriftenleiste (Kopfzeile) - die Zellen bleiben weiß.
//
// Personalstammdaten, Stunden und Anwesenheitstage bleiben bewusst weiß/
// neutral (keine Klassen aus dieser Datei nötig).

// Bruttolohn: leichtes Hellbraun, wie in der Excel.
export const FARBE_BRUTTO_TH = "bg-amber-100";
export const FARBE_BRUTTO_TD = "bg-amber-50";

// Nettolohn: Hellgrau.
export const FARBE_NETTO_TH = "bg-slate-200";
export const FARBE_NETTO_TD = "bg-slate-100";

// Kautionen (Fahrer-/Zimmerkaution): immer Blau (nur Kopfzeile).
export const FARBE_KAUTION_TH = "bg-blue-100";

// Zulagen/Boni: immer Grün (nur Kopfzeile).
export const FARBE_ZULAGE_TH = "bg-green-100";

// Abzüge (Vorschuss, Unterkunft, Verpflegung, Bus, Kleidung, ...): immer
// Rot (nur Kopfzeile).
export const FARBE_ABZUG_TH = "bg-red-100";
