// Vertriebsplanung (docs/vertriebsplanung-plan.md): gemeinsame Hilfen für
// Stände, Öffnungszeiten und Touren.
import type { VtHalbtag, VtStandZeit, VtTagesart, VtTourStand } from "@/lib/types";

// ISO-Wochentage 1 = Montag ... 7 = Sonntag
export const WOCHENTAGE: { nr: number; kurz: string; lang: string }[] = [
  { nr: 1, kurz: "Mo", lang: "Montag" },
  { nr: 2, kurz: "Di", lang: "Dienstag" },
  { nr: 3, kurz: "Mi", lang: "Mittwoch" },
  { nr: 4, kurz: "Do", lang: "Donnerstag" },
  { nr: 5, kurz: "Fr", lang: "Freitag" },
  { nr: 6, kurz: "Sa", lang: "Samstag" },
  { nr: 7, kurz: "So", lang: "Sonntag" },
];

export const HALBTAGE: { wert: VtHalbtag; label: string }[] = [
  { wert: "VM", label: "Vormittag" },
  { wert: "NM", label: "Nachmittag" },
];

export const TAGESARTEN: { wert: VtTagesart; label: string; tage: number[] }[] = [
  { wert: "MO_SA", label: "Montag – Samstag", tage: [1, 2, 3, 4, 5, 6] },
  { wert: "SO", label: "Sonntag", tage: [7] },
];

// "08:00:00" -> "8:00"
export function zeitKurz(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  return `${Number(h)}:${m}`;
}

// "08:00:00" -> "08:00" (Wert für <input type="time">)
export function zeitInput(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}

// Koordinaten aus einem eingefügten Text ("50.123, 8.654" aus Google Maps
// oder "50,123 8,654"). null, wenn nicht lesbar.
export function koordinatenLesen(text: string): { lat: number; lng: number } | null {
  const zahlen = text
    .trim()
    .replace(/(\d),(\d)/g, "$1.$2")
    .split(/[\s;,]+/)
    .filter(Boolean)
    .map(Number);
  if (zahlen.length !== 2 || zahlen.some((z) => !Number.isFinite(z))) return null;
  const [lat, lng] = zahlen;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// Ist der Stand an einem der Tage der Tagesart geöffnet?
export function offenAnTagesart(zeiten: VtStandZeit[], standId: number, tagesart: VtTagesart): boolean {
  const tage = TAGESARTEN.find((t) => t.wert === tagesart)!.tage;
  return zeiten.some((z) => z.stand_id === standId && tage.includes(z.wochentag));
}

// Fahrer-Stand einer Tour: der LETZTE Stand, der nicht "nur Ware" ist
// (Nutzer-Vorgabe: dessen Verkäufer fährt hin und zurück).
export function fahrerStandId(staende: Pick<VtTourStand, "stand_id" | "reihenfolge" | "nur_ware">[]): number | null {
  const mit = [...staende].filter((s) => !s.nur_ware).sort((a, b) => a.reihenfolge - b.reihenfolge);
  return mit.length ? mit[mit.length - 1].stand_id : null;
}

// Saison, die gerade geplant wird: ab September die kommende.
export function planungsSaison(heute = new Date()): number {
  return heute.getMonth() >= 8 ? heute.getFullYear() + 1 : heute.getFullYear();
}
