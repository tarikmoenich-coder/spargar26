// Rollen-Regeln fürs Stundenkonto (Nutzer-Vorgabe 2026-08-20/21) - an
// EINER Stelle definiert, damit die Stundenerfassung UND das Controlling-
// Stundenmonitoring garantiert dieselben Rechte anwenden. Muss exakt zu
// den Rollenprüfungen in stundenkonto_buchen/
// stundenkonto_in_auszahlung_umwandeln (supabase/schema.sql) passen -
// sonst wirken Felder editierbar, obwohl die Datenbank ablehnt (gleicher
// Fallstrick wie beim Bugreport 2026-08-08 zu work_entries).

// Buchen (Gutschrift/Korrektur/Freizeitausgleich) - keine Lohnwirkung,
// wie die Stundenerfassung selbst.
export function kannStundenkontoBuchen(role: string | null | undefined): boolean {
  return role === "admin" || role === "hr" || role === "zeiterfassung";
}

// "In Auszahlung umwandeln" - erzeugt einen echten Lohnbestandteil.
// Nutzer-Vorgabe 2026-08-21: hr und management dürfen das ebenfalls sehen
// (nicht nur admin/lohnabrechnung wie beim ursprünglichen Bau am
// 2026-08-20) - ausdrücklich NICHT zeiterfassung.
export function kannStundenkontoAuszahlen(role: string | null | undefined): boolean {
  return (
    role === "admin" ||
    role === "hr" ||
    role === "lohnabrechnung" ||
    role === "management"
  );
}
