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

export function tagesartVon(wochentag: number): VtTagesart {
  return wochentag === 7 ? "SO" : "MO_SA";
}

// ---------------------------------------------------------------------------
// Prüfung eines Plans (Grundplan V3, später auch Wochenplan V4).
// ---------------------------------------------------------------------------
export interface PlanBesetzung {
  stand_id: number;
  wochentag: number;
  halbtag: VtHalbtag;
  employee_id: string;
}

export interface PlanHinweis {
  art: "fehler" | "warnung" | "info";
  text: string;
  stand_id?: number;
  wochentag?: number;
  halbtag?: VtHalbtag;
  employee_id?: string;
}

export interface TourMitStaenden {
  id: number;
  nummer: number;
  tagesart: VtTagesart;
  aktiv: boolean;
  staende: Pick<VtTourStand, "stand_id" | "reihenfolge" | "nur_ware">[];
}

// Fahrer einer Tour an einem Wochentag: die Person am letzten mitfahrenden
// Stand (Vormittag, sonst Nachmittag). Er fährt hin und zurück.
export function fahrerAmTag(
  tour: TourMitStaenden,
  wochentag: number,
  plan: Map<string, string>
): { stand_id: number | null; employee_id: string | null; wechsel: boolean } {
  const fs = fahrerStandId(tour.staende);
  if (fs == null) return { stand_id: null, employee_id: null, wechsel: false };
  const vm = plan.get(planKey(fs, wochentag, "VM")) ?? null;
  const nm = plan.get(planKey(fs, wochentag, "NM")) ?? null;
  return { stand_id: fs, employee_id: vm ?? nm, wechsel: !!vm && !!nm && vm !== nm };
}

export function planKey(standId: number, wochentag: number, halbtag: VtHalbtag): string {
  return `${standId}|${wochentag}|${halbtag}`;
}

export function planPruefen(opts: {
  besetzung: PlanBesetzung[];
  zeiten: VtStandZeit[];
  aktiveStandIds: Set<number>;
  touren: TourMitStaenden[];
  kann: (employeeId: string, wochentag: number, halbtag: VtHalbtag) => boolean | null;
  hatFuehrerschein: (employeeId: string) => boolean;
  personName: (employeeId: string) => string;
  standName: (standId: number) => string;
}): PlanHinweis[] {
  const { besetzung, zeiten, aktiveStandIds, touren, kann, hatFuehrerschein, personName, standName } = opts;
  const h: PlanHinweis[] = [];
  const plan = new Map(besetzung.map((b) => [planKey(b.stand_id, b.wochentag, b.halbtag), b.employee_id]));
  const offen = new Set(zeiten.map((z) => planKey(z.stand_id, z.wochentag, z.halbtag)));
  const tagKurz = (t: number) => WOCHENTAGE.find((w) => w.nr === t)!.kurz;

  // Lücken: offen, aktiv, niemand eingeplant
  for (const z of zeiten) {
    if (!aktiveStandIds.has(z.stand_id)) continue;
    if (!plan.has(planKey(z.stand_id, z.wochentag, z.halbtag)))
      h.push({ art: "warnung", text: `${standName(z.stand_id)} ${tagKurz(z.wochentag)} ${z.halbtag}: unbesetzt`, stand_id: z.stand_id, wochentag: z.wochentag, halbtag: z.halbtag });
  }

  for (const b of besetzung) {
    const wo = { stand_id: b.stand_id, wochentag: b.wochentag, halbtag: b.halbtag, employee_id: b.employee_id };
    const was = `${standName(b.stand_id)} ${tagKurz(b.wochentag)} ${b.halbtag}`;
    if (!offen.has(planKey(b.stand_id, b.wochentag, b.halbtag)))
      h.push({ art: "warnung", text: `${was}: ${personName(b.employee_id)} eingeplant, Stand ist geschlossen`, ...wo });
    const k = kann(b.employee_id, b.wochentag, b.halbtag);
    if (k === false) h.push({ art: "fehler", text: `${was}: ${personName(b.employee_id)} kann laut Verfügbarkeit nicht`, ...wo });
    else if (k === null) h.push({ art: "info", text: `${was}: Verfügbarkeit von ${personName(b.employee_id)} unbekannt`, ...wo });
  }

  // Standwechsel am Tag (erlaubt, aber unüblich)
  const proPersonTag = new Map<string, Set<number>>();
  for (const b of besetzung) {
    const key = `${b.employee_id}|${b.wochentag}`;
    if (!proPersonTag.has(key)) proPersonTag.set(key, new Set());
    proPersonTag.get(key)!.add(b.stand_id);
  }
  for (const [key, s] of proPersonTag)
    if (s.size > 1) {
      const [emp, tag] = key.split("|");
      h.push({ art: "info", text: `${personName(emp)} ${tagKurz(Number(tag))}: an ${s.size} Ständen (Standwechsel am Tag)`, employee_id: emp, wochentag: Number(tag) });
    }

  // Touren: Fahrer je Tag
  for (const t of touren) {
    if (!t.aktiv || t.staende.length === 0) continue;
    const tage = TAGESARTEN.find((x) => x.wert === t.tagesart)!.tage;
    for (const tag of tage) {
      const jemandDabei = t.staende.some(
        (s) => !s.nur_ware && (plan.has(planKey(s.stand_id, tag, "VM")) || plan.has(planKey(s.stand_id, tag, "NM")))
      );
      if (!jemandDabei) continue;
      const f = fahrerAmTag(t, tag, plan);
      const wann = `Tour ${t.nummer}${t.tagesart === "SO" ? " (So)" : ""} ${tagKurz(tag)}`;
      if (f.stand_id == null) h.push({ art: "fehler", text: `${wann}: kein Fahrer-Stand (alle "nur Ware")`, wochentag: tag });
      else if (!f.employee_id)
        h.push({ art: "fehler", text: `${wann}: Fahrer-Stand ${standName(f.stand_id)} unbesetzt - wer fährt?`, stand_id: f.stand_id, wochentag: tag });
      else {
        if (f.wechsel)
          h.push({ art: "fehler", text: `${wann}: am Fahrer-Stand ${standName(f.stand_id)} wechselt die Person - der Fahrer muss den ganzen Tag bleiben`, stand_id: f.stand_id, wochentag: tag });
        if (!hatFuehrerschein(f.employee_id))
          h.push({ art: "fehler", text: `${wann}: Fahrer ${personName(f.employee_id)} hat keinen Führerschein eingetragen`, stand_id: f.stand_id, wochentag: tag, employee_id: f.employee_id });
      }
    }
  }
  return h;
}
