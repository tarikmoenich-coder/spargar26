// Vertriebsplanung V4 (docs/vertriebsplanung-plan.md): der konkrete Tag.
//
// Tagesplan = Grundplan der Saison (Wochentag; an Feiertagen der SONNTAG -
// Nutzer 2026-11-26: Feiertage komplett wie Sonntag: Öffnungszeiten,
// Sonntagstouren, Sonntags-Besetzung) + Änderungen nur für dieses Datum
// (vt_tag_aenderung) + Abwesenheiten (vt_abwesenheit) als Warnung.
// Wird von der Wochenansicht und den Ausdrucken gemeinsam benutzt.

import type {
  TagesplanStand,
  VtAbwesenheit,
  VtFeiertag,
  VtGrundplan,
  VtHalbtag,
  VtStand,
  VtStandSaison,
  VtStandZeit,
  VtTagAenderung,
  VtTour,
  VtTourStand,
  VtTourTag,
} from "@/lib/types";
import { fahrerStandId, planKey } from "@/lib/vertrieb";

export type Fahrzeug = { id: number; kennzeichen: string | null; bezeichnung: string };

// ISO-Wochentag (1 = Mo ... 7 = So) eines Kalenderdatums "YYYY-MM-DD"
export function wochentagVon(datum: string): number {
  const d = new Date(`${datum}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

// Montag der Woche eines Datums
export function montagVon(datum: string): string {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (wochentagVon(datum) - 1));
  return d.toISOString().slice(0, 10);
}

// ISO-Kalenderwoche
export function kalenderwoche(datum: string): number {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - wochentagVon(datum));
  const jahresanfang = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - jahresanfang.getTime()) / 86400000 + 1) / 7);
}

const TAGNAME = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MONAT = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
// "Dienstag, 6. April 2027"
export function datumLang(datum: string): string {
  const [j, m, t] = datum.split("-").map(Number);
  return `${TAGNAME[wochentagVon(datum)]}, ${t}. ${MONAT[m - 1]} ${j}`;
}
// "6.4."
export function datumKurz(datum: string): string {
  const [, m, t] = datum.split("-").map(Number);
  return `${t}.${m}.`;
}

// Gesetzliche Feiertage Hessen (+ Fronleichnam gilt auch in RLP/BW/BY-Unterfranken).
// Vorschlag zum Eintragen - die Liste in vt_feiertag ist maßgeblich.
export function feiertageBerechnen(jahr: number): { datum: string; name: string }[] {
  // Ostersonntag (Gauß / Meeus)
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  const ostern = new Date(Date.UTC(jahr, monat - 1, tag));
  const plus = (n: number) => {
    const x = new Date(ostern);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const fest = (mm: number, dd: number) => `${jahr}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return [
    { datum: fest(1, 1), name: "Neujahr" },
    { datum: plus(-2), name: "Karfreitag" },
    { datum: plus(1), name: "Ostermontag" },
    { datum: fest(5, 1), name: "Tag der Arbeit" },
    { datum: plus(39), name: "Christi Himmelfahrt" },
    { datum: plus(50), name: "Pfingstmontag" },
    { datum: plus(60), name: "Fronleichnam" },
    { datum: fest(10, 3), name: "Tag der Deutschen Einheit" },
    { datum: fest(12, 25), name: "1. Weihnachtstag" },
    { datum: fest(12, 26), name: "2. Weihnachtstag" },
  ].sort((x, y) => x.datum.localeCompare(y.datum));
}

export interface TagesFeld {
  stand_id: number;
  halbtag: VtHalbtag;
  // laut Öffnungszeiten (Wochentag bzw. Sonntag am Feiertag) offen
  offen: boolean;
  von: string | null;
  bis: string | null;
  grundEmp: string | null; // laut Grundplan
  emp: string | null; // gilt heute
  zu: boolean; // heute geschlossen (Änderung)
  aenderung: VtTagAenderung | null;
  abwesend: VtAbwesenheit | null; // eingeplante Person ist laut Abwesenheit nicht da
  // Stand an diesem Datum noch nicht eröffnet / schon geschlossen (vt_stand_saison), sonst null
  ausserSaison: string | null;
}

// Außerhalb der Stand-Saison? -> Text ("öffnet am 15.4." / "seit 21.6. zu"), sonst null
export function ausserhalbSaison(standSaison: VtStandSaison[], standId: number, datum: string): string | null {
  const s = standSaison.find((x) => x.stand_id === standId && x.saison_jahr === Number(datum.slice(0, 4)));
  if (!s) return null;
  if (s.eroeffnung && datum < s.eroeffnung) return `öffnet am ${datumKurz(s.eroeffnung)}`;
  if (s.schluss && datum > s.schluss) return `seit ${datumKurz(datumPlus1(s.schluss))} zu`;
  return null;
}
function datumPlus1(d: string): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
// "ab 15.4. · bis 20.6." für Listen, leer = ganze Saison
export function saisonText(standSaison: VtStandSaison[], standId: number, jahr: number): string {
  const s = standSaison.find((x) => x.stand_id === standId && x.saison_jahr === jahr);
  if (!s) return "";
  return [s.eroeffnung ? `ab ${datumKurz(s.eroeffnung)}` : "", s.schluss ? `bis ${datumKurz(s.schluss)}` : ""].filter(Boolean).join(" · ");
}

export interface TourHalt {
  stand: VtStand;
  platz: number;
  nur_ware: boolean;
  fahrerStand: boolean;
  vm: TagesFeld;
  nm: TagesFeld;
}

export interface TagesTour {
  tour: VtTour;
  fahrzeug: Fahrzeug | null;
  fahrzeugGeaendert: boolean;
  abfahrt: string | null;
  abfahrtGeaendert: boolean;
  halte: TourHalt[];
  fahrer: string | null; // employee_id
  fahrerStandId: number | null;
}

export interface Tagesplan {
  datum: string;
  wochentag: number;
  planTag: number; // 7 an Feiertagen
  feiertag: VtFeiertag | null;
  felder: Map<string, TagesFeld>; // planKey(stand, planTag, halbtag)
  feld: (standId: number, h: VtHalbtag) => TagesFeld;
  touren: TagesTour[];
  ohneTour: { stand: VtStand; vm: TagesFeld; nm: TagesFeld }[];
}

export function tagesplanBerechnen(o: {
  datum: string;
  feiertage: VtFeiertag[];
  grundplan: VtGrundplan[]; // Saison des Datums
  zeiten: VtStandZeit[];
  aenderungen: VtTagAenderung[]; // dieses Datum (andere werden ignoriert)
  abwesenheiten: VtAbwesenheit[];
  staende: VtStand[];
  touren: VtTour[];
  tourStaende: VtTourStand[];
  tourTage: VtTourTag[];
  fahrzeuge: Fahrzeug[];
  standSaison?: VtStandSaison[];
}): Tagesplan {
  const wochentag = wochentagVon(o.datum);
  const feiertag = o.feiertage.find((f) => f.datum === o.datum) ?? null;
  const planTag = feiertag ? 7 : wochentag;
  const tagesart = planTag === 7 ? "SO" : "MO_SA";

  const zeit = new Map(o.zeiten.filter((z) => z.wochentag === planTag).map((z) => [`${z.stand_id}|${z.halbtag}`, z]));
  const grund = new Map(o.grundplan.filter((g) => g.wochentag === planTag).map((g) => [`${g.stand_id}|${g.halbtag}`, g.employee_id]));
  const aend = new Map(o.aenderungen.filter((a) => a.datum === o.datum).map((a) => [`${a.stand_id}|${a.halbtag}`, a]));
  const abw = o.abwesenheiten.filter((a) => a.von <= o.datum && a.bis >= o.datum);
  const abwesendVon = (emp: string | null, h: VtHalbtag) =>
    emp ? abw.find((a) => a.employee_id === emp && (a.halbtag === null || a.halbtag === h)) ?? null : null;

  const felder = new Map<string, TagesFeld>();
  const feld = (standId: number, h: VtHalbtag): TagesFeld => {
    const key = planKey(standId, planTag, h);
    const da = felder.get(key);
    if (da) return da;
    // Vor der Eröffnung / nach dem Schluss: Stand zu, niemand eingeplant
    const ausser = ausserhalbSaison(o.standSaison ?? [], standId, o.datum);
    const z = ausser ? null : zeit.get(`${standId}|${h}`) ?? null;
    const a = ausser ? null : aend.get(`${standId}|${h}`) ?? null;
    const grundEmp = ausser ? null : grund.get(`${standId}|${h}`) ?? null;
    const zu = !!a?.geschlossen;
    const emp = a ? (a.geschlossen ? null : a.employee_id) : grundEmp;
    const f: TagesFeld = {
      stand_id: standId,
      halbtag: h,
      offen: !!z,
      von: z?.von ?? null,
      bis: z?.bis ?? null,
      grundEmp,
      emp,
      zu,
      aenderung: a,
      abwesend: abwesendVon(emp, h),
      ausserSaison: ausser,
    };
    felder.set(key, f);
    return f;
  };
  for (const s of o.staende) {
    feld(s.id, "VM");
    feld(s.id, "NM");
  }

  const standById = new Map(o.staende.map((s) => [s.id, s]));
  const fz = new Map(o.fahrzeuge.map((f) => [f.id, f]));
  const inTour = new Set<number>();
  const touren: TagesTour[] = o.touren
    .filter((t) => t.aktiv && t.tagesart === tagesart)
    .sort((a, b) => a.nummer - b.nummer)
    .map((t) => {
      // Stände außerhalb ihrer Saison fallen heute aus der Tour (Reihenfolge und Fahrer neu)
      const liste = o.tourStaende
        .filter((x) => x.tour_id === t.id)
        .sort((a, b) => a.reihenfolge - b.reihenfolge)
        .filter((x) => {
          if (!ausserhalbSaison(o.standSaison ?? [], x.stand_id, o.datum)) return true;
          inTour.add(x.stand_id);
          return false;
        });
      const fs = fahrerStandId(liste);
      const halte: TourHalt[] = liste
        .map((x, i) => {
          const st = standById.get(x.stand_id);
          if (!st) return null;
          inTour.add(st.id);
          return { stand: st, platz: i + 1, nur_ware: x.nur_ware, fahrerStand: x.stand_id === fs, vm: feld(st.id, "VM"), nm: feld(st.id, "NM") };
        })
        .filter((x): x is TourHalt => !!x);
      const tt = o.tourTage.find((x) => x.tour_id === t.id && x.datum === o.datum) ?? null;
      const fahrzeugId = tt && tt.fahrzeug_id !== null ? tt.fahrzeug_id : t.fahrzeug_id;
      const abfahrt = tt && tt.abfahrt !== null ? tt.abfahrt : t.abfahrt;
      const fh = halte.find((h) => h.fahrerStand);
      return {
        tour: t,
        fahrzeug: fahrzeugId != null ? fz.get(fahrzeugId) ?? null : null,
        fahrzeugGeaendert: !!tt && tt.fahrzeug_id !== null && tt.fahrzeug_id !== t.fahrzeug_id,
        abfahrt,
        abfahrtGeaendert: !!tt && tt.abfahrt !== null && tt.abfahrt !== t.abfahrt,
        halte,
        fahrer: fh ? fh.vm.emp ?? fh.nm.emp : null,
        fahrerStandId: fs,
      };
    })
    // Touren ohne offenen Stand fallen heute weg; Reihenfolge nach Abfahrt
    // (Nutzer 2026-11-26), ohne Abfahrt ans Ende, dann nach Tournummer
    .filter((t) => t.halte.length > 0)
    .sort((a, b) => (a.abfahrt ?? "99").localeCompare(b.abfahrt ?? "99") || a.tour.nummer - b.tour.nummer);
  const ohneTour = o.staende
    .filter((s) => !inTour.has(s.id))
    .map((s) => ({ stand: s, vm: feld(s.id, "VM"), nm: feld(s.id, "NM") }))
    .filter((x) => x.stand.aktiv && (x.vm.offen || x.nm.offen || x.vm.emp || x.nm.emp));

  return { datum: o.datum, wochentag, planTag, feiertag, felder, feld, touren, ohneTour };
}

// Für den Druck-Stand und den Änderungszettel
export function tagesplanStand(tp: Tagesplan, art: "A3" | "A4"): TagesplanStand {
  const besetzung: Record<string, string | null> = {};
  for (const f of tp.felder.values()) if (f.offen || f.emp || f.zu) besetzung[`${f.stand_id}|${f.halbtag}`] = f.zu ? "zu" : f.emp;
  const touren: TagesplanStand["touren"] = {};
  for (const t of tp.touren) touren[String(t.tour.id)] = { fahrzeug_id: t.fahrzeug?.id ?? null, abfahrt: t.abfahrt };
  return { art, besetzung, touren };
}

export interface TourAenderung {
  tour: TagesTour;
  // Halt -> was war vorher (laut Bezugsstand)
  halte: Map<number, { vm: string | null | undefined; nm: string | null | undefined }>;
  fahrzeugVorher: number | null | undefined;
  abfahrtVorher: string | null | undefined;
  // Personen, die vorher in dieser Tour waren und jetzt nicht mehr
  raus: string[];
}

// Was hat sich je Tour gegenüber dem Bezugsstand geändert? Ohne Bezugsstand
// (noch nie gedruckt) = gegenüber dem Grundplan.
export function tourAenderungen(tp: Tagesplan, bezug: TagesplanStand | null): TourAenderung[] {
  const vorher = (f: TagesFeld): string | null =>
    bezug ? (`${f.stand_id}|${f.halbtag}` in bezug.besetzung ? bezug.besetzung[`${f.stand_id}|${f.halbtag}`] : null) : f.grundEmp;
  const jetzt = (f: TagesFeld): string | null => (f.zu ? "zu" : f.emp);
  const res: TourAenderung[] = [];
  for (const t of tp.touren) {
    const halte = new Map<number, { vm: string | null | undefined; nm: string | null | undefined }>();
    const vorherPersonen = new Set<string>();
    const jetztPersonen = new Set<string>();
    for (const h of t.halte) {
      const e: { vm: string | null | undefined; nm: string | null | undefined } = { vm: undefined, nm: undefined };
      for (const [k, f] of [["vm", h.vm], ["nm", h.nm]] as const) {
        const v = vorher(f);
        const j = jetzt(f);
        if (v && v !== "zu") vorherPersonen.add(v);
        if (j && j !== "zu") jetztPersonen.add(j);
        if (v !== j) e[k] = v;
      }
      if (e.vm !== undefined || e.nm !== undefined) halte.set(h.stand.id, e);
    }
    const tb = bezug?.touren[String(t.tour.id)];
    const fahrzeugVorher = bezug ? (tb ? tb.fahrzeug_id : null) : t.tour.fahrzeug_id;
    const abfahrtVorher = bezug ? (tb ? tb.abfahrt : null) : t.tour.abfahrt;
    const fzAnders = fahrzeugVorher !== (t.fahrzeug?.id ?? null);
    const abAnders = (abfahrtVorher ?? null) !== (t.abfahrt ?? null);
    const raus = [...vorherPersonen].filter((p) => !jetztPersonen.has(p));
    if (halte.size || fzAnders || abAnders)
      res.push({ tour: t, halte, fahrzeugVorher: fzAnders ? fahrzeugVorher : undefined, abfahrtVorher: abAnders ? abfahrtVorher : undefined, raus });
  }
  return res;
}
