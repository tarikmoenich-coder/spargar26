"use client";

// Vertrieb → Grundplan (Vertriebsplanung V3, docs/vertriebsplanung-plan.md).
// Je Saison ein fester Plan: Stand x Wochentag x Vormittag/Nachmittag ->
// Person. Zeilen nach Tour (Mo-Sa) gruppiert, damit sichtbar ist, wer
// zusammen im Auto sitzt; Fahrer = Person am letzten mitfahrenden Stand.
// Lücken, "kann nicht", Fahrer ohne Führerschein usw. werden sofort
// angezeigt (lib/vertrieb.ts planPruefen).
//
// Ansicht (Nutzer 2026-11-26 "übersichtlicher und arbeitsfreundlicher"):
// - Planen je Stand ("Stammbesetzung": eine Person in alle passenden
//   Halbtage der Zeile) statt nur Feld für Feld,
// - Auswahl direkt am angeklickten Feld, mit Tastatur (Pfeile, Enter springt
//   zum nächsten offenen Feld der Zeile),
// - feste Farbe je Person, gleiche Person VM+NM = ein Feld,
// - leere offene Felder neutral, gelb/rot nur bei echten Problemen,
// - Fortschritt je Stand/Tour, Filter, Sonntag ausblendbar, fester Kopf.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Car, CalendarRange, ChevronDown, ChevronRight, Printer, UserPlus, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import VertriebTabs from "@/components/VertriebTabs";
import type {
  FuehrerscheinEintrag,
  VtGrundplan,
  VtHalbtag,
  VtStand,
  VtStandZeit,
  VtTour,
  VtTourStand,
  VtVerfuegbarkeit,
  VtVerkaeuferSaison,
} from "@/lib/types";
import {
  HALBTAGE,
  WOCHENTAGE,
  fahrerAmTag,
  planKey,
  planPruefen,
  planungsSaison,
  type PlanHinweis,
  type TourMitStaenden,
} from "@/lib/vertrieb";
import { ladeAlleSeiten, ladeAlleMitFehler } from "@/lib/ladeAlle";

type Person = { id: string; personal_nr: string; name: string; vorname: string; fuehrerschein_b: boolean | null };
type Feld = { stand_id: number; wochentag: number; halbtag: VtHalbtag };
type Umfang = "VM" | "NM" | "TAG";
// Auswahl-Fenster: entweder für ein Feld (Tag eines Standes) oder für die ganze Zeile
type Auswahl =
  | { art: "feld"; stand_id: number; wochentag: number; umfang: Umfang; x: number; y: number; h: number }
  | { art: "zeile"; stand_id: number; umfang: Umfang; mitSonntag: boolean; ueberschreiben: boolean; x: number; y: number; h: number };

const LS_SONNTAG = "grundplan.sonntag";
const POP_BREITE = 360;
const POP_HOEHE = 420;

// Feste, gut unterscheidbare Farbe je Person (aus der ID abgeleitet)
function farbe(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = (h % 24) * 15;
  return {
    background: `hsl(${hue} 75% 91%)`,
    borderColor: `hsl(${hue} 45% 70%)`,
    color: `hsl(${hue} 55% 24%)`,
  };
}
const SCHRAFFUR = {
  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, rgba(0,0,0,0.045) 5px 6px)",
};

export default function VertriebGrundplanPage() {
  const { profile } = useProfile();
  const darfPflegen = hatRolle(profile, "admin", "hr");

  const [saison, setSaison] = useState(planungsSaison());
  const [personen, setPersonen] = useState<Person[]>([]);
  const [fsDoku, setFsDoku] = useState<FuehrerscheinEintrag[]>([]);
  const [planung, setPlanung] = useState<VtVerkaeuferSaison[]>([]);
  const [verf, setVerf] = useState<VtVerfuegbarkeit[]>([]);
  const [staende, setStaende] = useState<VtStand[]>([]);
  const [zeiten, setZeiten] = useState<VtStandZeit[]>([]);
  const [touren, setTouren] = useState<VtTour[]>([]);
  const [tourStaende, setTourStaende] = useState<VtTourStand[]>([]);
  const [plan, setPlan] = useState<VtGrundplan[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  const [auswahl, setAuswahl] = useState<Auswahl | null>(null);
  const [suche, setSuche] = useState("");
  const [markiert, setMarkiert] = useState(0);
  const [zeigeListe, setZeigeListe] = useState(false);
  const [markierePerson, setMarkierePerson] = useState<string>("");

  // Filter
  const [standSuche, setStandSuche] = useState("");
  const [tourFilter, setTourFilter] = useState<string>("alle");
  const [nurLuecken, setNurLuecken] = useState(false);
  const [nurKonflikte, setNurKonflikte] = useState(false);
  const [zeigeSonntag, setZeigeSonntag] = useState(false);
  const [zu, setZu] = useState<Set<string>>(new Set());
  const sucheRef = useRef<HTMLInputElement>(null);
  // Eigenes Scrollen (nächstes Feld ins Bild holen) soll die Auswahl nicht schließen
  const scrollIgnorierenBis = useRef(0);

  useEffect(() => {
    try {
      setZeigeSonntag(localStorage.getItem(LS_SONNTAG) === "1");
    } catch {
      /* ohne Speicher: Standard */
    }
  }, []);
  function sonntagUmschalten(an: boolean) {
    setZeigeSonntag(an);
    try {
      localStorage.setItem(LS_SONNTAG, an ? "1" : "0");
    } catch {
      /* egal */
    }
  }

  const load = useCallback(async () => {
    const sb = getSupabaseClient();
    const [p, fs, pl, v, s, z, t, ts, g] = await Promise.all([
      // seitenweise - PostgREST liefert je Abfrage höchstens 1000 Zeilen
      ladeAlleSeiten<Person>((von, bis) =>
        sb
          .from("employees")
          .select("id, personal_nr, name, vorname, fuehrerschein_b")
          .eq("bereich", "VT")
          .order("id")
          .range(von, bis)
      ),
      ladeAlleSeiten<FuehrerscheinEintrag>((von, bis) =>
        sb.from("employee_fuehrerschein_kategorien").select("*").order("employee_id").range(von, bis)
      ),
      sb.from("vt_verkaeufer_saison").select("*").eq("saison_jahr", saison),
      ladeAlleMitFehler<VtVerfuegbarkeit>((von, bis) =>
        sb.from("vt_verfuegbarkeit").select("*").eq("saison_jahr", saison).order("id").range(von, bis)
      ),
      sb.from("vt_stand").select("*").order("nummer"),
      ladeAlleMitFehler<VtStandZeit>((von, bis) => sb.from("vt_stand_zeit").select("*").order("id").range(von, bis)),
      sb.from("vt_tour").select("*").order("nummer"),
      sb.from("vt_tour_stand").select("*"),
      ladeAlleMitFehler<VtGrundplan>((von, bis) =>
        sb.from("vt_grundplan").select("*").eq("saison_jahr", saison).order("id").range(von, bis)
      ),
    ]);
    const err = pl.error ?? v.error ?? s.error ?? z.error ?? t.error ?? ts.error ?? g.error;
    setFehler(err ? err.message : null);
    setPersonen(p);
    setFsDoku(fs);
    setPlanung((pl.data as VtVerkaeuferSaison[]) ?? []);
    setVerf((v.data as VtVerfuegbarkeit[]) ?? []);
    setStaende((s.data as VtStand[]) ?? []);
    setZeiten((z.data as VtStandZeit[]) ?? []);
    setTouren((t.data as VtTour[]) ?? []);
    setTourStaende((ts.data as VtTourStand[]) ?? []);
    setPlan((g.data as VtGrundplan[]) ?? []);
    setLoading(false);
  }, [saison]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // --- abgeleitete Daten ---------------------------------------------------
  const personById = useMemo(() => new Map(personen.map((p) => [p.id, p])), [personen]);
  const standById = useMemo(() => new Map(staende.map((s) => [s.id, s])), [staende]);
  const personName = useCallback(
    (id: string) => {
      const p = personById.get(id);
      return p ? `${p.vorname} ${p.name}` : "?";
    },
    [personById]
  );
  const kurzName = (id: string) => {
    const p = personById.get(id);
    return p ? `${p.vorname} ${p.name.charAt(0)}.` : "?";
  };
  const standName = useCallback(
    (id: number) => {
      const s = standById.get(id);
      return s ? `${s.nummer} ${s.name}` : `#${id}`;
    },
    [standById]
  );
  const hatFuehrerschein = useCallback(
    (id: string) =>
      !!personById.get(id)?.fuehrerschein_b ||
      fsDoku.some((f) => f.employee_id === id && f.fuehrerschein_kategorien.length > 0),
    [personById, fsDoku]
  );
  const verfMap = useMemo(() => new Map(verf.map((v) => [`${v.employee_id}|${v.wochentag}|${v.halbtag}`, v.kann])), [verf]);
  const kann = useCallback(
    (emp: string, tag: number, h: VtHalbtag) => verfMap.get(`${emp}|${tag}|${h}`) ?? null,
    [verfMap]
  );
  const planMap = useMemo(() => new Map(plan.map((g) => [planKey(g.stand_id, g.wochentag, g.halbtag), g])), [plan]);
  const planEmpMap = useMemo(() => new Map(plan.map((g) => [planKey(g.stand_id, g.wochentag, g.halbtag), g.employee_id])), [plan]);
  const personBelegt = useMemo(() => new Map(plan.map((g) => [`${g.employee_id}|${g.wochentag}|${g.halbtag}`, g])), [plan]);
  const offen = useMemo(() => new Set(zeiten.map((z) => planKey(z.stand_id, z.wochentag, z.halbtag))), [zeiten]);
  const zeitVon = useMemo(() => new Map(zeiten.map((z) => [planKey(z.stand_id, z.wochentag, z.halbtag), z])), [zeiten]);

  const tourenMit: TourMitStaenden[] = useMemo(
    () =>
      touren.map((t) => ({
        id: t.id,
        nummer: t.nummer,
        tagesart: t.tagesart,
        aktiv: t.aktiv,
        staende: tourStaende.filter((x) => x.tour_id === t.id),
      })),
    [touren, tourStaende]
  );

  const sonntagsTour = useMemo(() => {
    const m = new Map<number, TourMitStaenden>();
    for (const t of tourenMit.filter((x) => x.tagesart === "SO")) for (const s of t.staende) m.set(s.stand_id, t);
    return m;
  }, [tourenMit]);
  const tourVonStandTag = (standId: number, tag: number): TourMitStaenden | null => {
    // Inaktive Touren zählen nicht (wie in planPruefen).
    if (tag === 7) {
      const t = sonntagsTour.get(standId);
      return t && t.aktiv ? t : null;
    }
    return tourenMit.find((t) => t.aktiv && t.tagesart === "MO_SA" && t.staende.some((s) => s.stand_id === standId)) ?? null;
  };

  const hinweise: PlanHinweis[] = useMemo(
    () =>
      planPruefen({
        besetzung: plan,
        zeiten,
        aktiveStandIds: new Set(staende.filter((s) => s.aktiv).map((s) => s.id)),
        touren: tourenMit,
        kann,
        hatFuehrerschein,
        personName,
        standName,
      }),
    [plan, zeiten, staende, tourenMit, kann, hatFuehrerschein, personName, standName]
  );
  const istLuecke = (h: PlanHinweis) => h.art === "warnung" && h.text.endsWith("unbesetzt");
  // Nur echte Probleme färben Felder ein - eine Lücke ist (noch) kein Problem.
  const problemFelder = useMemo(() => {
    const m = new Map<string, PlanHinweis[]>();
    for (const h of hinweise)
      if (h.stand_id != null && h.wochentag != null && !istLuecke(h) && h.art !== "info") {
        const keys = h.halbtag ? [planKey(h.stand_id, h.wochentag, h.halbtag)] : HALBTAGE.map((x) => planKey(h.stand_id!, h.wochentag!, x.wert));
        for (const key of keys) m.set(key, [...(m.get(key) ?? []), h]);
      }
    return m;
  }, [hinweise]);

  const anzahlJePerson = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of plan) m.set(g.employee_id, (m.get(g.employee_id) ?? 0) + 1);
    return m;
  }, [plan]);

  // Fortschritt je Stand: besetzte / offene Halbtage der angezeigten Tage
  // (Sonntag nur, wenn er eingeblendet ist)
  const fortschritt = useMemo(() => {
    const m = new Map<number, { soll: number; ist: number; konflikt: boolean }>();
    for (const z of zeiten) {
      if (z.wochentag === 7 && !zeigeSonntag) continue;
      const e = m.get(z.stand_id) ?? { soll: 0, ist: 0, konflikt: false };
      e.soll++;
      if (planMap.has(planKey(z.stand_id, z.wochentag, z.halbtag))) e.ist++;
      m.set(z.stand_id, e);
    }
    for (const key of problemFelder.keys()) {
      const [sid, tag] = key.split("|").map(Number);
      if (tag === 7 && !zeigeSonntag) continue;
      const e = m.get(sid) ?? { soll: 0, ist: 0, konflikt: false };
      if (problemFelder.get(key)!.some((h) => h.art === "fehler")) e.konflikt = true;
      m.set(sid, e);
    }
    return m;
  }, [zeiten, planMap, problemFelder, zeigeSonntag]);

  const nurWareStaende = useMemo(
    () => new Set(tourenMit.filter((t) => t.aktiv && t.tagesart === "MO_SA").flatMap((t) => t.staende.filter((x) => x.nur_ware).map((x) => x.stand_id))),
    [tourenMit]
  );
  const tage = useMemo(() => WOCHENTAGE.filter((t) => zeigeSonntag || t.nr !== 7), [zeigeSonntag]);
  const sonntagOffen = useMemo(() => new Set(zeiten.filter((z) => z.wochentag === 7).map((z) => z.stand_id)).size, [zeiten]);

  // Zeilen: aktive Stände (+ inaktive mit Planeinträgen) nach Mo-Sa-Tour gruppiert, gefiltert
  const gruppen = useMemo(() => {
    const geplant = new Set(plan.map((g) => g.stand_id));
    const q = standSuche.trim().toLowerCase();
    const passt = (s: VtStand) => {
      if (!(s.aktiv || geplant.has(s.id))) return false;
      if (q && !`${s.nummer} ${s.name}`.toLowerCase().includes(q)) return false;
      const f = fortschritt.get(s.id);
      if (nurLuecken && !(f && f.ist < f.soll)) return false;
      if (nurKonflikte && !f?.konflikt) return false;
      return true;
    };
    const res: { key: string; titel: string; staende: VtStand[]; alle: VtStand[] }[] = [];
    const vergeben = new Set<number>();
    for (const t of tourenMit.filter((x) => x.tagesart === "MO_SA")) {
      const alle = [...t.staende]
        .sort((a, b) => a.reihenfolge - b.reihenfolge)
        .map((x) => standById.get(x.stand_id))
        .filter((s): s is VtStand => !!s && (s.aktiv || geplant.has(s.id)));
      alle.forEach((s) => vergeben.add(s.id));
      if (tourFilter !== "alle" && tourFilter !== String(t.id)) continue;
      const name = touren.find((x) => x.id === t.id)?.name;
      const liste = alle.filter(passt);
      if (liste.length) res.push({ key: `t${t.id}`, titel: `Tour ${t.nummer}${name ? ` · ${name}` : ""}${t.aktiv ? "" : " (inaktiv)"}`, staende: liste, alle });
    }
    if (tourFilter === "alle" || tourFilter === "ohne") {
      const alle = staende.filter((s) => (s.aktiv || geplant.has(s.id)) && !vergeben.has(s.id));
      const liste = alle.filter(passt);
      if (liste.length) res.push({ key: "ohne", titel: "Ohne Tour (Mo–Sa)", staende: liste, alle });
    }
    return res;
  }, [staende, plan, tourenMit, standById, touren, standSuche, tourFilter, nurLuecken, nurKonflikte, fortschritt]);

  const summe = (liste: VtStand[]) =>
    liste.reduce(
      (acc, s) => {
        const f = fortschritt.get(s.id);
        return { soll: acc.soll + (f?.soll ?? 0), ist: acc.ist + (f?.ist ?? 0) };
      },
      { soll: 0, ist: 0 }
    );
  const gesamt = useMemo(() => {
    const aktiv = new Set(staende.filter((s) => s.aktiv).map((s) => s.id));
    let soll = 0;
    let ist = 0;
    for (const z of zeiten)
      if (aktiv.has(z.stand_id) && (zeigeSonntag || z.wochentag !== 7)) {
        soll++;
        if (planMap.has(planKey(z.stand_id, z.wochentag, z.halbtag))) ist++;
      }
    return { soll, ist };
  }, [staende, zeiten, planMap, zeigeSonntag]);

  // --- Zielfelder einer Auswahl -----------------------------------------------
  const halbtageVon = (u: Umfang): VtHalbtag[] => (u === "TAG" ? ["VM", "NM"] : [u]);
  const zielFelder = useCallback(
    (a: Auswahl): Feld[] => {
      const res: Feld[] = [];
      const tageListe = a.art === "feld" ? [a.wochentag] : [1, 2, 3, 4, 5, 6, ...(a.mitSonntag ? [7] : [])];
      for (const tag of tageListe)
        for (const h of halbtageVon(a.umfang)) {
          const key = planKey(a.stand_id, tag, h);
          if (offen.has(key) || planMap.has(key)) res.push({ stand_id: a.stand_id, wochentag: tag, halbtag: h });
        }
      return res;
    },
    [offen, planMap]
  );

  // --- Schreiben -----------------------------------------------------------
  // Feld-Modus: bewusst gewählt -> überschreibt, verschiebt die Person von
  // einem anderen Stand her und trägt auch bei "kann nicht" ein (wird rot).
  // Zeilen-Modus (Stammbesetzung): nur passende Felder, nichts verschieben.
  async function eintragen(felder: Feld[], empId: string | null, modus: "feld" | "zeile", ueberschreiben: boolean) {
    const sb = getSupabaseClient();
    setFehler(null);
    setMeldung(null);
    if (empId === null) {
      const ids = felder.map((f) => planMap.get(planKey(f.stand_id, f.wochentag, f.halbtag))?.id).filter((x): x is number => x != null);
      if (ids.length) {
        const { error } = await sb.from("vt_grundplan").delete().in("id", ids);
        if (error) setFehler(error.message);
      }
      await load();
      return;
    }
    const loeschen: number[] = [];
    const neu: Omit<VtGrundplan, "id">[] = [];
    let uebersprungen = 0;
    for (const f of felder) {
      const key = planKey(f.stand_id, f.wochentag, f.halbtag);
      const vorhanden = planMap.get(key);
      if (vorhanden?.employee_id === empId) continue;
      const woanders = personBelegt.get(`${empId}|${f.wochentag}|${f.halbtag}`);
      const anderswo = woanders && woanders.stand_id !== f.stand_id;
      if (modus === "zeile") {
        if ((vorhanden && !ueberschreiben) || anderswo || !offen.has(key) || kann(empId, f.wochentag, f.halbtag) === false) {
          uebersprungen++;
          continue;
        }
      } else if (anderswo) loeschen.push(woanders.id);
      neu.push({ saison_jahr: saison, stand_id: f.stand_id, wochentag: f.wochentag, halbtag: f.halbtag, employee_id: empId });
    }
    if (loeschen.length) {
      const { error } = await sb.from("vt_grundplan").delete().in("id", loeschen);
      if (error) {
        setFehler(error.message);
        return load();
      }
    }
    if (neu.length) {
      const { error } = await sb.from("vt_grundplan").upsert(neu, { onConflict: "saison_jahr,stand_id,wochentag,halbtag" });
      if (error) setFehler(error.message);
    }
    if (modus === "zeile")
      setMeldung(
        `${personName(empId)}: ${neu.length} Halbtag${neu.length === 1 ? "" : "e"} eingetragen` +
          (uebersprungen ? `, ${uebersprungen} übersprungen (belegt, kann nicht oder steht dann woanders)` : "")
      );
    await load();
  }

  // Montag in leere Felder Di-Sa übernehmen, wo der Stand offen ist, die
  // Person nicht "kann nicht" gemeldet hat und zur Zeit frei ist.
  async function montagUebernehmen() {
    const belegt = new Set(plan.map((g) => `${g.employee_id}|${g.wochentag}|${g.halbtag}`));
    const neu: Omit<VtGrundplan, "id">[] = [];
    for (const g of plan.filter((x) => x.wochentag === 1))
      for (const tag of [2, 3, 4, 5, 6]) {
        const key = planKey(g.stand_id, tag, g.halbtag);
        const pk = `${g.employee_id}|${tag}|${g.halbtag}`;
        if (!offen.has(key) || planMap.has(key) || belegt.has(pk) || kann(g.employee_id, tag, g.halbtag) === false) continue;
        belegt.add(pk);
        neu.push({ saison_jahr: saison, stand_id: g.stand_id, wochentag: tag, halbtag: g.halbtag, employee_id: g.employee_id });
      }
    if (!neu.length) return setFehler("Nichts zu übernehmen - alle passenden Felder Di–Sa sind schon belegt.");
    if (!confirm(`${neu.length} leere Felder (Di–Sa) mit der Montagsbesetzung füllen?`)) return;
    const { error } = await getSupabaseClient().from("vt_grundplan").insert(neu);
    if (error) setFehler(error.message);
    load();
  }

  // --- Auswahl öffnen / bewegen -----------------------------------------------
  function position(el: Element) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, h: r.height };
  }
  function feldOeffnen(el: Element, stand_id: number, wochentag: number, umfang: Umfang) {
    if (!darfPflegen) return;
    setSuche("");
    setMarkiert(0);
    setAuswahl({ art: "feld", stand_id, wochentag, umfang, ...position(el) });
  }
  function zeileOeffnen(el: Element, stand_id: number) {
    if (!darfPflegen) return;
    setSuche("");
    setMarkiert(0);
    setAuswahl({ art: "zeile", stand_id, umfang: "TAG", mitSonntag: false, ueberschreiben: false, ...position(el) });
  }
  // Nach Enter: zum nächsten offenen Feld rechts in derselben Zeile springen
  function naechstesFeld(a: Extract<Auswahl, { art: "feld" }>) {
    const reihe: { tag: number; umfang: VtHalbtag }[] = [];
    for (const t of tage)
      for (const u of ["VM", "NM"] as const) reihe.push({ tag: t.nr, umfang: u });
    const start = reihe.findIndex((r) => r.tag === a.wochentag && (a.umfang === "TAG" ? r.umfang === "NM" : r.umfang === a.umfang));
    for (const r of reihe.slice(start + 1)) {
      const k = planKey(a.stand_id, r.tag, r.umfang);
      if (!offen.has(k) || planMap.has(k)) continue;
      const el =
        document.querySelector(`[data-zelle="${a.stand_id}|${r.tag}|${r.umfang}"]`) ??
        document.querySelector(`[data-zelle="${a.stand_id}|${r.tag}|TAG"]`);
      if (!el) break;
      scrollIgnorierenBis.current = Date.now() + 400;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      // Ganzen Tag weiterplanen, wenn vorher der ganze Tag gewählt war und beide Hälften offen sind
      const beideOffen = offen.has(planKey(a.stand_id, r.tag, "VM")) && offen.has(planKey(a.stand_id, r.tag, "NM"));
      const umfang: Umfang = a.umfang === "TAG" && beideOffen ? "TAG" : r.umfang;
      setSuche("");
      setMarkiert(0);
      setAuswahl({ art: "feld", stand_id: a.stand_id, wochentag: r.tag, umfang, ...position(el) });
      return;
    }
    setAuswahl(null);
  }

  // --- Kandidaten für die Auswahl ---------------------------------------------
  const kandidaten = useMemo(() => {
    if (!auswahl) return [];
    const felder = zielFelder(auswahl).filter((f) => offen.has(planKey(f.stand_id, f.wochentag, f.halbtag)));
    const q = suche.trim().toLowerCase();
    return planung
      .map((pl) => ({ p: personById.get(pl.employee_id), max: pl.max_halbtage_woche ?? null }))
      .filter((x): x is { p: Person; max: number | null } => !!x.p)
      .filter(({ p }) => !q || `${p.vorname} ${p.name} ${p.personal_nr}`.toLowerCase().includes(q))
      .map(({ p, max }) => {
        let ja = 0;
        let nein = 0;
        let woandersN = 0;
        let passt = 0;
        let woandersStand: number | null = null;
        for (const f of felder) {
          const k = kann(p.id, f.wochentag, f.halbtag);
          if (k === true) ja++;
          if (k === false) nein++;
          const w = personBelegt.get(`${p.id}|${f.wochentag}|${f.halbtag}`);
          const anderswo = !!w && w.stand_id !== f.stand_id;
          if (anderswo) {
            woandersN++;
            woandersStand = w!.stand_id;
          }
          const vorhanden = planMap.get(planKey(f.stand_id, f.wochentag, f.halbtag));
          const frei = !vorhanden || vorhanden.employee_id === p.id || (auswahl.art === "zeile" && auswahl.ueberschreiben);
          if (k !== false && !anderswo && frei) passt++;
        }
        const anz = anzahlJePerson.get(p.id) ?? 0;
        const status: "ja" | "nein" | "?" =
          auswahl.art === "zeile"
            ? passt === 0
              ? "nein"
              : passt === felder.length
                ? "ja"
                : "?"
            : nein > 0
              ? "nein"
              : felder.length > 0 && ja === felder.length
                ? "ja"
                : "?";
        const rang =
          auswahl.art === "zeile"
            ? -passt * 10 + (nein ? 1 : 0)
            : (status === "ja" ? 0 : status === "?" ? 1 : 2) + (woandersN ? 3 : 0) + (max != null && anz >= max ? 1 : 0);
        return { p, max, anz, status, woandersN, woandersStand, passt, gesamt: felder.length, rang };
      })
      .sort((a, b) => a.rang - b.rang || a.p.name.localeCompare(b.p.name, "de"));
  }, [auswahl, suche, planung, personById, kann, personBelegt, planMap, anzahlJePerson, zielFelder, offen]);

  function waehlen(empId: string, perTastatur: boolean) {
    if (!auswahl) return;
    const a = auswahl;
    const felder = zielFelder(a);
    if (a.art === "zeile") {
      setAuswahl(null);
      eintragen(felder, empId, "zeile", a.ueberschreiben);
      return;
    }
    eintragen(felder, empId, "feld", true);
    if (perTastatur) naechstesFeld(a);
    else setAuswahl(null);
  }
  function leeren() {
    if (!auswahl) return;
    const a = auswahl;
    const felder = zielFelder(a).filter((f) => planMap.has(planKey(f.stand_id, f.wochentag, f.halbtag)));
    if (!felder.length) return setAuswahl(null);
    if (a.art === "zeile" && !confirm(`${felder.length} Einträge bei ${standName(a.stand_id)} entfernen?`)) return;
    setAuswahl(null);
    eintragen(felder, null, a.art, true);
  }

  function tastatur(e: React.KeyboardEvent) {
    if (e.key === "Escape") return setAuswahl(null);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMarkiert((m) => Math.min(m + 1, kandidaten.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMarkiert((m) => Math.max(m - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const k = kandidaten[markiert];
      if (k) waehlen(k.p.id, true);
    }
  }
  useEffect(() => {
    document.querySelector(`[data-kandidat="${markiert}"]`)?.scrollIntoView({ block: "nearest" });
  }, [markiert]);
  useEffect(() => {
    if (auswahl) sucheRef.current?.focus();
  }, [auswahl]);

  const saisonen = [planungsSaison() - 1, planungsSaison(), planungsSaison() + 1];
  const zaehler = {
    fehler: hinweise.filter((h) => h.art === "fehler").length,
    warnung: hinweise.filter((h) => h.art === "warnung" && !istLuecke(h)).length,
    info: hinweise.filter((h) => h.art === "info").length,
  };
  const prozent = gesamt.soll ? Math.round((gesamt.ist / gesamt.soll) * 100) : 0;
  const tourOptionen = touren.filter((t) => t.tagesart === "MO_SA");

  // --- Darstellung einer Zelle ------------------------------------------------
  function chip(empId: string, fahrer: boolean) {
    const gedimmt = markierePerson && markierePerson !== empId;
    return (
      <span
        className={`inline-flex max-w-[7.5rem] items-center gap-0.5 truncate rounded border px-1.5 py-0.5 text-[11px] font-medium leading-tight ${
          gedimmt ? "opacity-30" : ""
        } ${markierePerson === empId ? "ring-2 ring-emerald-700" : ""}`}
        style={farbe(empId)}
        title={personName(empId)}
      >
        {fahrer && <Car className="h-3 w-3 shrink-0" />}
        <span className="truncate">{kurzName(empId)}</span>
      </span>
    );
  }
  function leerInhalt(standId: number, tag: number, h: VtHalbtag, nurWare: boolean) {
    // Bei hervorgehobener Person: zeigen, ob sie hier könnte
    if (markierePerson) {
      const k = kann(markierePerson, tag, h);
      const w = personBelegt.get(`${markierePerson}|${tag}|${h}`);
      if (k === true && !w) return <span className="text-emerald-500" title="hervorgehobene Person kann hier und ist frei">✓</span>;
      if (k === false) return <span className="text-beere-300" title="hervorgehobene Person kann nicht">✗</span>;
    }
    return (
      <span className="text-neutral-300" title={nurWare ? "Stand bekommt nur Ware - Verkäufer trotzdem einplanen" : undefined}>
        ·
      </span>
    );
  }

  function tagZellen(s: VtStand, tag: number) {
    const kVM = planKey(s.id, tag, "VM");
    const kNM = planKey(s.id, tag, "NM");
    const vm = planMap.get(kVM);
    const nm = planMap.get(kNM);
    const oVM = offen.has(kVM);
    const oNM = offen.has(kNM);
    const tour = tourVonStandTag(s.id, tag);
    const fahrer = tour ? fahrerAmTag(tour, tag, planEmpMap) : null;
    const nurWare = !!tour?.staende.find((x) => x.stand_id === s.id)?.nur_ware;
    const istFahrer = (e?: VtGrundplan) => !!e && fahrer?.stand_id === s.id && fahrer.employee_id === e.employee_id;
    const gewaehlt = (u: Umfang) =>
      auswahl?.art === "feld" && auswahl.stand_id === s.id && auswahl.wochentag === tag && (auswahl.umfang === u || (u !== "TAG" && auswahl.umfang === "TAG"));

    const zelle = (u: Umfang, eintrag: VtGrundplan | undefined, istOffen: boolean, keys: string[]) => {
      const probleme = keys.flatMap((k) => problemFelder.get(k) ?? []);
      const istFehler = probleme.some((p) => p.art === "fehler");
      const istWarn = !istFehler && probleme.length > 0;
      const geschlossen = !istOffen && !eintrag;
      const klickbar = darfPflegen && (istOffen || !!eintrag);
      const zeit = u !== "TAG" ? zeitVon.get(planKey(s.id, tag, u)) : null;
      const titel = [
        `${s.nummer} ${s.name} · ${WOCHENTAGE.find((w) => w.nr === tag)!.lang} ${u === "TAG" ? "ganzer Tag" : u === "VM" ? "Vormittag" : "Nachmittag"}`,
        zeit ? `${zeit.von.slice(0, 5)}–${zeit.bis.slice(0, 5)}` : geschlossen ? "Stand geschlossen" : "",
        eintrag ? personName(eintrag.employee_id) : "",
        ...probleme.map((p) => p.text),
      ]
        .filter(Boolean)
        .join("\n");
      return (
        <td
          key={`${tag}${u}`}
          colSpan={u === "TAG" ? 2 : 1}
          data-zelle={`${s.id}|${tag}|${u}`}
          onClick={(e) => klickbar && feldOeffnen(e.currentTarget, s.id, tag, u === "TAG" || (oVM && oNM && !vm && !nm) ? "TAG" : u)}
          title={titel}
          style={geschlossen ? SCHRAFFUR : undefined}
          className={`h-8 min-w-[4.25rem] whitespace-nowrap border-r-0 border-t-0 px-0.5 py-0.5 text-center align-middle ${u === "NM" ? "border-l-0" : ""} ${istFehler ? "bg-beere-50 ring-1 ring-inset ring-beere-300" : istWarn ? "bg-amber-50" : geschlossen ? "bg-neutral-50" : "bg-white"} ${
            klickbar ? "cursor-pointer hover:bg-emerald-50/60" : ""
          } ${gewaehlt(u) ? "!bg-amber-100 ring-2 ring-inset ring-amber-500" : ""}`}
        >
          {eintrag ? chip(eintrag.employee_id, istFahrer(eintrag)) : istOffen ? leerInhalt(s.id, tag, u === "TAG" ? "VM" : u, nurWare) : null}
        </td>
      );
    };

    if (vm && nm && vm.employee_id === nm.employee_id) return [zelle("TAG", vm, true, [kVM, kNM])];
    return [zelle("VM", vm, oVM, [kVM]), zelle("NM", nm, oNM, [kNM])];
  }

  const aktTitel = (() => {
    if (!auswahl) return null;
    const st = standName(auswahl.stand_id);
    if (auswahl.art === "zeile") return `${st} · Stammbesetzung`;
    return `${st} · ${WOCHENTAGE.find((w) => w.nr === auswahl.wochentag)!.lang}`;
  })();
  const popStil = (() => {
    if (!auswahl || typeof window === "undefined") return {};
    const left = Math.max(8, Math.min(auswahl.x, window.innerWidth - POP_BREITE - 8));
    const unten = auswahl.y + auswahl.h + 4;
    const top = unten + POP_HOEHE > window.innerHeight ? Math.max(8, auswahl.y - POP_HOEHE - 4) : unten;
    return { left, top, width: POP_BREITE, maxHeight: POP_HOEHE };
  })();
  const felderDerAuswahl = auswahl ? zielFelder(auswahl) : [];
  const belegteDerAuswahl = felderDerAuswahl.filter((f) => planMap.has(planKey(f.stand_id, f.wochentag, f.halbtag))).length;

  return (
    <div className="flex flex-col gap-4">
      <VertriebTabs />
      <PageHeader
        icon={CalendarRange}
        titel={`Grundplan ${saison}`}
        beschreibung={`Wer steht wann an welchem Stand - gilt die ganze Saison.${
          darfPflegen ? " Feld anklicken = einen Tag planen, Personen-Symbol am Stand = ganze Woche auf einmal." : ""
        }`}
        aktionen={
          <>
            <select value={saison} onChange={(e) => setSaison(Number(e.target.value))} className="print:hidden">
              {saisonen.map((s) => (
                <option key={s} value={s}>
                  Saison {s}
                </option>
              ))}
            </select>
            {darfPflegen && (
              <button className="btn-secondary print:hidden" onClick={montagUebernehmen} title="Leere Felder Di–Sa mit der Montagsbesetzung füllen">
                Montag → Di–Sa
              </button>
            )}
            <button className="btn-secondary print:hidden" onClick={() => window.print()}>
              <Printer className="mr-1 inline h-4 w-4" />
              Drucken
            </button>
          </>
        }
      />
      {fehler && <p className="text-sm text-beere-600">{fehler}</p>}
      {meldung && <p className="text-sm text-emerald-700 print:hidden">{meldung}</p>}

      {!loading && planung.length === 0 && (
        <p className="text-sm text-amber-700 print:hidden">
          Für {saison} ist noch kein Verkäufer in der Planung - erst unter „Verfügbarkeit“ Verkäufer übernehmen.
        </p>
      )}

      {/* Stand der Planung */}
      <div className="flex flex-wrap items-center gap-3 text-sm print:hidden">
        <div className="flex min-w-64 items-center gap-2">
          <div className="h-2 w-40 overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full bg-emerald-600" style={{ width: `${prozent}%` }} />
          </div>
          <span>
            <b>{gesamt.ist.toLocaleString("de-DE")}</b> von {gesamt.soll.toLocaleString("de-DE")} Halbtagen besetzt ({prozent} %){zeigeSonntag ? "" : " · Mo–Sa"}
          </span>
        </div>
        <button
          className={zaehler.fehler ? "badge-danger" : "badge-ok"}
          onClick={() => zaehler.fehler && setNurKonflikte((x) => !x)}
          title={zaehler.fehler ? "nur Stände mit Konflikten zeigen" : undefined}
        >
          {zaehler.fehler} Konflikte
        </button>
        {zaehler.warnung > 0 && <span className="badge-warn">{zaehler.warnung} Hinweise</span>}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={zeigeListe} onChange={(e) => setZeigeListe(e.target.checked)} />
          Konflikte als Liste
        </label>
      </div>
      {zeigeListe && (
        <ul className="max-h-64 overflow-y-auto rounded border border-linie bg-white p-2 text-sm print:hidden">
          {hinweise
            .filter((h) => !istLuecke(h))
            .sort((a, b) => ["fehler", "warnung", "info"].indexOf(a.art) - ["fehler", "warnung", "info"].indexOf(b.art))
            .map((h, i) => (
              <li key={i} className={h.art === "fehler" ? "text-beere-700" : h.art === "warnung" ? "text-amber-700" : "text-neutral-500"}>
                {h.art === "fehler" ? "✗" : h.art === "warnung" ? "⚠" : "ℹ"} {h.text}
              </li>
            ))}
          {hinweise.every(istLuecke) && <li className="text-neutral-500">Keine Konflikte oder Hinweise.</li>}
        </ul>
      )}

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
        <input placeholder="Stand suchen …" value={standSuche} onChange={(e) => setStandSuche(e.target.value)} className="w-44" />
        <select value={tourFilter} onChange={(e) => setTourFilter(e.target.value)}>
          <option value="alle">Alle Touren</option>
          {tourOptionen.map((t) => (
            <option key={t.id} value={String(t.id)}>
              Tour {t.nummer}
              {t.name ? ` · ${t.name}` : ""}
            </option>
          ))}
          <option value="ohne">Ohne Tour</option>
        </select>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={nurLuecken} onChange={(e) => setNurLuecken(e.target.checked)} />
          nur mit Lücken
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={nurKonflikte} onChange={(e) => setNurKonflikte(e.target.checked)} />
          nur mit Konflikten
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={zeigeSonntag} onChange={(e) => sonntagUmschalten(e.target.checked)} />
          Sonntag zeigen{sonntagOffen ? ` (${sonntagOffen} Stände offen)` : ""}
        </label>
        <select value={markierePerson} onChange={(e) => setMarkierePerson(e.target.value)} className="ml-auto max-w-64">
          <option value="">Person hervorheben …</option>
          {planung
            .map((pl) => ({ p: personById.get(pl.employee_id), max: pl.max_halbtage_woche }))
            .filter((x): x is { p: Person; max: number | null } => !!x.p)
            .sort((a, b) => a.p.name.localeCompare(b.p.name, "de"))
            .map(({ p, max }) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.vorname} ({anzahlJePerson.get(p.id) ?? 0}
                {max != null ? `/${max}` : ""} Halbtage)
              </option>
            ))}
        </select>
      </div>

      {!loading && staende.length === 0 ? (
        <EmptyState icon={CalendarRange} text="Noch keine Stände angelegt." />
      ) : (
        <div
          className="max-h-[calc(100vh-15rem)] overflow-auto rounded border border-linie print:max-h-none print:overflow-visible"
          onScroll={() => auswahl && Date.now() > scrollIgnorierenBis.current && setAuswahl(null)}
        >
          <table className="w-auto min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-56 border-x-0 border-t-0 bg-emerald-50 text-sm">Stand</th>
                {tage.map((t) => (
                  <th key={t.nr} colSpan={2} className="sticky top-0 z-20 border-r-0 border-t-0 bg-emerald-50 p-0 text-center">
                    <div className="pt-1 text-sm">{t.kurz}</div>
                    <div className="grid grid-cols-2 pb-0.5 text-[10px] font-normal text-neutral-500">
                      <span>VM</span>
                      <span>NM</span>
                    </div>
                  </th>
                ))}
                <th className="sticky top-0 z-20 border-r-0 border-t-0 bg-emerald-50 px-1 text-center text-[11px] font-normal text-neutral-600">besetzt</th>
              </tr>
            </thead>
            <tbody>
              {gruppen.map((g) => {
                const eingeklappt = zu.has(g.key);
                const sum = summe(g.alle);
                return (
                  <Fragment key={g.key}>
                    <tr>
                      <td className="sticky left-0 z-10 border-x-0 border-b border-t-0 bg-sand py-1.5">
                        <button
                          className="flex w-full items-center gap-1 text-left text-sm font-semibold text-emerald-900"
                          onClick={() =>
                            setZu((alt) => {
                              const n = new Set(alt);
                              if (n.has(g.key)) n.delete(g.key);
                              else n.add(g.key);
                              return n;
                            })
                          }
                        >
                          {eingeklappt ? <ChevronRight className="h-4 w-4 print:hidden" /> : <ChevronDown className="h-4 w-4 print:hidden" />}
                          {g.titel}
                          <span className="ml-auto text-xs font-normal text-neutral-500">{g.alle.length} Stände</span>
                        </button>
                      </td>
                      <td colSpan={tage.length * 2} className="border-x-0 border-b border-t-0 bg-sand" />
                      <td className="border-r-0 border-t-0 bg-sand text-center text-[11px] text-neutral-600">
                        {sum.ist}/{sum.soll}
                      </td>
                    </tr>
                    {!eingeklappt &&
                      g.staende.map((s) => {
                        const soTour = sonntagsTour.get(s.id);
                        const f = fortschritt.get(s.id) ?? { soll: 0, ist: 0, konflikt: false };
                        const voll = f.soll > 0 && f.ist >= f.soll;
                        return (
                          <tr key={s.id} className={`group ${s.aktiv ? "" : "opacity-50"}`}>
                            <td className="sticky left-0 z-10 whitespace-nowrap border-x-0 border-b border-t-0 bg-white py-0.5 text-sm group-hover:bg-neutral-50">
                              <div className="flex items-center gap-1.5">
                                <span className="w-7 text-right text-xs tabular-nums text-neutral-400">{s.nummer}</span>
                                <span className="truncate">{s.name}</span>
                                {nurWareStaende.has(s.id) && (
                                  <span className="rounded bg-sand-200 px-1 text-[10px] text-neutral-600" title="Stand bekommt nur Ware, der Verkäufer fährt nicht mit - trotzdem einplanen">
                                    nur Ware
                                  </span>
                                )}
                                {zeigeSonntag && soTour && <span className="text-[11px] text-neutral-500">So: T{soTour.nummer}</span>}
                                {zeigeSonntag && !soTour && offen.has(planKey(s.id, 7, "VM")) && (
                                  <span className="text-[11px] text-amber-700" title="Sonntags offen, aber in keiner Sonntagstour">
                                    So: keine Tour
                                  </span>
                                )}
                                {darfPflegen && (
                                  <button
                                    className="ml-auto rounded p-0.5 text-emerald-700 opacity-40 hover:bg-emerald-50 group-hover:opacity-100 print:hidden"
                                    title="Stammbesetzung: eine Person für die ganze Woche eintragen"
                                    onClick={(e) => zeileOeffnen(e.currentTarget, s.id)}
                                  >
                                    <UserPlus className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                            {tage.flatMap((t) => tagZellen(s, t.nr))}
                            <td
                              className={`whitespace-nowrap border-r-0 border-t-0 px-1 text-center text-[11px] tabular-nums ${
                                f.konflikt ? "text-beere-700" : voll ? "text-emerald-700" : f.ist > 0 ? "text-amber-700" : "text-neutral-400"
                              }`}
                            >
                              {f.soll ? `${f.ist}/${f.soll}` : "–"}
                              {voll && !f.konflikt && " ✓"}
                            </td>
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
              {gruppen.length === 0 && !loading && (
                <tr>
                  <td colSpan={tage.length * 2 + 2} className="py-6 text-center text-sm text-neutral-500">
                    Kein Stand passt zum Filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-neutral-500">
        <Car className="inline h-3 w-3" /> = Fahrer der Tour (letzter mitfahrender Stand, fährt hin und zurück). Jede Person hat eine feste Farbe; steht
        sie vormittags und nachmittags am selben Stand, ist es ein Feld. · = offen, noch niemand eingeplant. Schraffiert = Stand geschlossen. Rot =
        Konflikt, gelb = Hinweis. Sonntags gelten die Sonntagstouren.
      </p>

      {/* Auswahl-Fenster direkt am Feld */}
      {auswahl && darfPflegen && (
        <>
          <div className="fixed inset-0 z-40 print:hidden" onClick={() => setAuswahl(null)} />
          <div
            className="fixed z-50 flex flex-col gap-2 overflow-hidden rounded-lg border border-linie bg-white p-3 shadow-xl print:hidden"
            style={popStil}
            onKeyDown={tastatur}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold leading-tight">{aktTitel}</div>
              <button className="rounded p-0.5 hover:bg-neutral-100" onClick={() => setAuswahl(null)} title="schließen (Esc)">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Umfang */}
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {(["TAG", "VM", "NM"] as Umfang[])
                .filter((u) => {
                  if (auswahl.art === "zeile" || u === "TAG") return true;
                  const k = planKey(auswahl.stand_id, auswahl.wochentag, u);
                  return offen.has(k) || planMap.has(k);
                })
                .map((u) => (
                  <button
                    key={u}
                    className={`rounded border px-2 py-0.5 ${auswahl.umfang === u ? "border-emerald-600 bg-emerald-50 font-medium" : "border-linie hover:bg-neutral-50"}`}
                    onClick={() => {
                      setAuswahl({ ...auswahl, umfang: u });
                      sucheRef.current?.focus();
                    }}
                  >
                    {u === "TAG" ? "ganzer Tag" : u === "VM" ? "Vormittag" : "Nachmittag"}
                  </button>
                ))}
              {auswahl.art === "feld" &&
                (() => {
                  const z = halbtageVon(auswahl.umfang)
                    .map((h) => zeitVon.get(planKey(auswahl.stand_id, auswahl.wochentag, h)))
                    .filter(Boolean);
                  return z.length ? (
                    <span className="ml-1 text-neutral-500">
                      {z[0]!.von.slice(0, 5)}–{z[z.length - 1]!.bis.slice(0, 5)}
                    </span>
                  ) : (
                    <span className="ml-1 text-amber-700">Stand geschlossen</span>
                  );
                })()}
            </div>
            {auswahl.art === "zeile" && (
              <div className="flex flex-wrap gap-3 text-xs">
                {offen.has(planKey(auswahl.stand_id, 7, "VM")) || offen.has(planKey(auswahl.stand_id, 7, "NM")) ? (
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={auswahl.mitSonntag} onChange={(e) => setAuswahl({ ...auswahl, mitSonntag: e.target.checked })} />
                    mit Sonntag
                  </label>
                ) : null}
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={auswahl.ueberschreiben}
                    onChange={(e) => setAuswahl({ ...auswahl, ueberschreiben: e.target.checked })}
                  />
                  belegte Felder überschreiben
                </label>
                <span className="text-neutral-500">Mo–Sa, nur Halbtage, an denen die Person kann und frei ist.</span>
              </div>
            )}

            <input ref={sucheRef} placeholder="Name tippen … (↑↓ Enter)" value={suche} onChange={(e) => { setSuche(e.target.value); setMarkiert(0); }} />

            <div className="-mx-1 flex-1 overflow-y-auto">
              {kandidaten.map(({ p, max, anz, status, woandersN, woandersStand, passt, gesamt: g }, i) => {
                const aktuell = auswahl.art === "feld" && felderDerAuswahl.some((f) => planMap.get(planKey(f.stand_id, f.wochentag, f.halbtag))?.employee_id === p.id);
                return (
                  <button
                    key={p.id}
                    data-kandidat={i}
                    onMouseEnter={() => setMarkiert(i)}
                    onClick={() => waehlen(p.id, false)}
                    className={`flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs ${i === markiert ? "bg-emerald-50" : ""} ${
                      status === "nein" ? "text-beere-700" : ""
                    }`}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-sm border" style={farbe(p.id)} />
                    <span className="w-3 shrink-0 text-center">{status === "ja" ? "✓" : status === "nein" ? "✗" : auswahl.art === "zeile" ? "◐" : "?"}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`font-medium ${aktuell ? "underline" : ""}`}>
                        {p.vorname} {p.name}
                      </span>
                      {hatFuehrerschein(p.id) && <Car className="ml-1 inline h-3 w-3 text-neutral-500" />}
                      <span className="block truncate text-neutral-500">
                        {auswahl.art === "zeile" ? `passt ${passt}/${g} · ` : ""}
                        {anz}
                        {max != null ? `/${max}` : ""} Halbtage
                        {auswahl.art === "feld" && woandersN > 0 && woandersStand != null && ` · steht bei ${standName(woandersStand)} → wird verschoben`}
                      </span>
                    </span>
                  </button>
                );
              })}
              {kandidaten.length === 0 && <div className="px-1 py-2 text-sm text-neutral-500">Niemand gefunden.</div>}
            </div>

            {belegteDerAuswahl > 0 && (
              <button className="btn-secondary self-start text-xs" onClick={leeren}>
                {auswahl.art === "zeile" ? `Zeile leeren (${belegteDerAuswahl})` : "Feld leeren"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
