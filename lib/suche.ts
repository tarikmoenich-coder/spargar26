// Einheitliche Textsuche (Nutzer-Vorgabe 2026-11-28, Vorschlag #2): Akzente
// und Sonderzeichen werden beim Suchen ignoriert - in beide Richtungen.
// „Sabanovic“ findet „Šabanović“, „Stefan“ findet „Ștefan“, „Muller“ und
// „Mueller“ finden „Müller“, „Strasse“ findet „Straße“, „Djordjevic“ findet
// „Đorđević“.
//
// Verwendung: Suchbegriff UND durchsuchten Text mit sucheNormal() behandeln,
// dann .includes() - oder direkt passt(text, begriff).

export function sucheNormal(s: string | number | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    // deutsche Umschreibung vor dem Entfernen der Akzente: ä/ae -> a usw.
    .replace(/ä|ae/g, "a")
    .replace(/ö|oe/g, "o")
    .replace(/ü|ue/g, "u")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/dj/g, "d") // Đorđević wird oft „Djordjevic“ geschrieben
    .replace(/ø/g, "o")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

export function passt(text: string | number | null | undefined, begriff: string): boolean {
  return sucheNormal(text).includes(sucheNormal(begriff));
}
