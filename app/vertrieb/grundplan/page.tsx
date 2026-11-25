"use client";

// Vertrieb → Grundplan (Vertriebsplanung V3, docs/vertriebsplanung-plan.md).
// Je Saison ein fester Plan: Stand x Wochentag x Vormittag/Nachmittag ->
// Person. Zeilen nach Tour (Mo-Sa) gruppiert, damit sichtbar ist, wer
// zusammen im Auto sitzt; Fahrer = Person am letzten mitfahrenden Stand.
// Lücken, "kann nicht", Fahrer ohne Führerschein usw. werden sofort
// angezeigt (lib/vertrieb.ts planPruefen).

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Car, CalendarRange, Printer, X } from "lucide-react";
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
import { ladeAlleSeiten } from "@/lib/ladeAlle";

type Person = { id: string; personal_nr: string; name: string; vorname: string; fuehrerschein_b: boolean | null };
type Feld = { stand_id: number; wochentag: number; halbtag: VtHalbtag };

const SPALTEN = WOCHENTAGE.flatMap((t) => HALBTAGE.map((h) => ({ tag: t.nr, kurz: t.kurz, halbtag: h.wert })));

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

  const [auswahl, setAuswahl] = useState<Feld | null>(null);
  const [suche, setSuche] = useState("");
  const [zeigeInfos, setZeigeInfos] = useState(false);
  const [markierePerson, setMarkierePerson] = useState<string>("");

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
      sb.from("vt_verfuegbarkeit").select("*").eq("saison_jahr", saison),
      sb.from("vt_stand").select("*").order("nummer"),
      sb.from("vt_stand_zeit").select("*"),
      sb.from("vt_tour").select("*").order("nummer"),
      sb.from("vt_tour_stand").select("*"),
      sb.from("vt_grundplan").select("*").eq("saison_jahr", saison),
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

  // Zeilen: aktive Stände (+ inaktive mit Planeinträgen) nach Mo-Sa-Tour gruppiert
  const gruppen = useMemo(() => {
    const geplant = new Set(plan.map((g) => g.stand_id));
    const sichtbar = staende.filter((s) => s.aktiv || geplant.has(s.id));
    const res: { titel: string; tour: TourMitStaenden | null; staende: VtStand[] }[] = [];
    const vergeben = new Set<number>();
    for (const t of tourenMit.filter((x) => x.tagesart === "MO_SA")) {
      const liste = [...t.staende]
        .sort((a, b) => a.reihenfolge - b.reihenfolge)
        .map((x) => standById.get(x.stand_id))
        .filter((s): s is VtStand => !!s && sichtbar.includes(s));
      liste.forEach((s) => vergeben.add(s.id));
      if (liste.length) res.push({ titel: `Tour ${t.nummer}${touren.find((x) => x.id === t.id)?.name ? ` · ${touren.find((x) => x.id === t.id)!.name}` : ""}`, tour: t, staende: liste });
    }
    const rest = sichtbar.filter((s) => !vergeben.has(s.id));
    if (rest.length) res.push({ titel: "Ohne Tour (Mo–Sa)", tour: null, staende: rest });
    return res;
  }, [staende, plan, tourenMit, standById, touren]);

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
  const fehlerFelder = useMemo(() => {
    const m = new Map<string, PlanHinweis[]>();
    for (const h of hinweise)
      if (h.stand_id != null && h.wochentag != null) {
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

  // --- Schreiben -----------------------------------------------------------
  async function setzen(feld: Feld, empId: string | null) {
    const sb = getSupabaseClient();
    setFehler(null);
    const alt = planMap.get(planKey(feld.stand_id, feld.wochentag, feld.halbtag));
    if (empId === null) {
      if (alt) {
        const { error } = await sb.from("vt_grundplan").delete().eq("id", alt.id);
        if (error) setFehler(error.message);
      }
    } else {
      // Steht die Person zur selben Zeit schon woanders: dort herausnehmen.
      const woanders = personBelegt.get(`${empId}|${feld.wochentag}|${feld.halbtag}`);
      if (woanders && woanders.stand_id !== feld.stand_id) {
        const { error } = await sb.from("vt_grundplan").delete().eq("id", woanders.id);
        if (error) {
          setFehler(error.message);
          return load();
        }
      }
      const { error } = await sb
        .from("vt_grundplan")
        .upsert(
          { saison_jahr: saison, stand_id: feld.stand_id, wochentag: feld.wochentag, halbtag: feld.halbtag, employee_id: empId },
          { onConflict: "saison_jahr,stand_id,wochentag,halbtag" }
        );
      if (error) setFehler(error.message);
    }
    setAuswahl(null);
    setSuche("");
    load();
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

  // --- Auswahl-Liste für ein Feld --------------------------------------------
  const kandidaten = useMemo(() => {
    if (!auswahl) return [];
    const q = suche.trim().toLowerCase();
    return planung
      .map((pl) => personById.get(pl.employee_id))
      .filter((p): p is Person => !!p)
      .filter((p) => !q || `${p.vorname} ${p.name} ${p.personal_nr}`.toLowerCase().includes(q))
      .map((p) => {
        const k = kann(p.id, auswahl.wochentag, auswahl.halbtag);
        const woanders = personBelegt.get(`${p.id}|${auswahl.wochentag}|${auswahl.halbtag}`);
        const max = planung.find((x) => x.employee_id === p.id)?.max_halbtage_woche ?? null;
        const anz = anzahlJePerson.get(p.id) ?? 0;
        const rang = (k === true ? 0 : k === null ? 1 : 2) + (woanders && woanders.stand_id !== auswahl.stand_id ? 3 : 0) + (max != null && anz >= max ? 1 : 0);
        return { p, k, woanders, max, anz, rang };
      })
      .sort((a, b) => a.rang - b.rang || a.p.name.localeCompare(b.p.name, "de"));
  }, [auswahl, suche, planung, personById, kann, personBelegt, anzahlJePerson]);

  const zaehler = {
    fehler: hinweise.filter((h) => h.art === "fehler").length,
    luecken: hinweise.filter((h) => h.art === "warnung" && h.text.endsWith("unbesetzt")).length,
    warnung: hinweise.filter((h) => h.art === "warnung" && !h.text.endsWith("unbesetzt")).length,
    info: hinweise.filter((h) => h.art === "info").length,
  };
  const saisonen = [planungsSaison() - 1, planungsSaison(), planungsSaison() + 1];
  const aktuellerInhaber = auswahl ? planMap.get(planKey(auswahl.stand_id, auswahl.wochentag, auswahl.halbtag)) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <VertriebTabs />
      <PageHeader
        icon={CalendarRange}
        titel={`Grundplan ${saison}`}
        beschreibung={`Wer steht wann an welchem Stand - gilt die ganze Saison.${
          darfPflegen ? " Klick auf ein Feld, um eine Person einzuplanen." : ""
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

      {!loading && planung.length === 0 && (
        <p className="text-sm text-amber-700 print:hidden">
          Für {saison} ist noch kein Verkäufer in der Planung - erst unter „Verfügbarkeit“ Verkäufer übernehmen.
        </p>
      )}

      {/* Zusammenfassung */}
      <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
        <span className={zaehler.fehler ? "badge-danger" : "badge-ok"}>{zaehler.fehler} Konflikte</span>
        <span className={zaehler.luecken ? "badge-warn" : "badge-ok"}>{zaehler.luecken} Lücken</span>
        {zaehler.warnung > 0 && <span className="badge-warn">{zaehler.warnung} Hinweise</span>}
        <label className="ml-2 flex items-center gap-1.5">
          <input type="checkbox" checked={zeigeInfos} onChange={(e) => setZeigeInfos(e.target.checked)} />
          Liste zeigen{zaehler.info ? ` (inkl. ${zaehler.info} Infos)` : ""}
        </label>
        <select value={markierePerson} onChange={(e) => setMarkierePerson(e.target.value)} className="ml-auto max-w-64">
          <option value="">Person hervorheben …</option>
          {planung
            .map((pl) => personById.get(pl.employee_id))
            .filter((p): p is Person => !!p)
            .sort((a, b) => a.name.localeCompare(b.name, "de"))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.vorname} ({anzahlJePerson.get(p.id) ?? 0} Halbtage)
              </option>
            ))}
        </select>
      </div>
      {zeigeInfos && (
        <ul className="max-h-64 overflow-y-auto rounded border border-linie bg-white p-2 text-sm print:hidden">
          {hinweise
            .sort((a, b) => ["fehler", "warnung", "info"].indexOf(a.art) - ["fehler", "warnung", "info"].indexOf(b.art))
            .map((h, i) => (
              <li key={i} className={h.art === "fehler" ? "text-beere-700" : h.art === "warnung" ? "text-amber-700" : "text-neutral-500"}>
                {h.art === "fehler" ? "✗" : h.art === "warnung" ? "⚠" : "ℹ"} {h.text}
              </li>
            ))}
        </ul>
      )}

      {/* Auswahl-Feld */}
      {auswahl && darfPflegen && (
        <div className="card sticky top-28 z-30 flex flex-col gap-2 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">
              {standName(auswahl.stand_id)} · {WOCHENTAGE.find((w) => w.nr === auswahl.wochentag)!.lang}{" "}
              {auswahl.halbtag === "VM" ? "Vormittag" : "Nachmittag"}
              {(() => {
                const z = zeitVon.get(planKey(auswahl.stand_id, auswahl.wochentag, auswahl.halbtag));
                return z ? <span className="ml-2 font-normal text-neutral-500">{z.von.slice(0, 5)}–{z.bis.slice(0, 5)}</span> : <span className="ml-2 font-normal text-amber-700">Stand geschlossen</span>;
              })()}
            </div>
            <div className="flex items-center gap-2">
              {aktuellerInhaber && (
                <button className="btn-secondary" onClick={() => setzen(auswahl, null)}>
                  Feld leeren
                </button>
              )}
              <button className="btn-secondary px-2" onClick={() => setAuswahl(null)} title="schließen">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <input autoFocus placeholder="Name suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} className="max-w-64" />
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
            {kandidaten.map(({ p, k, woanders, max, anz }) => (
              <button
                key={p.id}
                onClick={() => setzen(auswahl, p.id)}
                className={`rounded border px-2 py-1 text-left text-xs ${
                  aktuellerInhaber?.employee_id === p.id
                    ? "border-emerald-600 bg-emerald-50"
                    : k === true
                      ? "border-emerald-300 bg-white hover:bg-emerald-50"
                      : k === false
                        ? "border-beere-200 bg-beere-50 text-beere-700"
                        : "border-linie bg-white hover:bg-sand"
                }`}
              >
                <div className="font-medium">
                  {k === true ? "✓ " : k === false ? "✗ " : "? "}
                  {p.vorname} {p.name}
                  {hatFuehrerschein(p.id) && <Car className="ml-1 inline h-3 w-3" />}
                </div>
                <div className="text-neutral-500">
                  {anz}
                  {max != null ? `/${max}` : ""} Halbtage
                  {woanders && woanders.stand_id !== auswahl.stand_id && ` · steht bei ${standName(woanders.stand_id)} → wird verschoben`}
                </div>
              </button>
            ))}
            {kandidaten.length === 0 && <span className="text-sm text-neutral-500">Niemand gefunden.</span>}
          </div>
        </div>
      )}

      {!loading && staende.length === 0 ? (
        <EmptyState icon={CalendarRange} text="Noch keine Stände angelegt." />
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th rowSpan={2} className="text-sm">
                  Stand
                </th>
                {WOCHENTAGE.map((t) => (
                  <th key={t.nr} colSpan={2} className="border-l border-linie text-center text-sm">
                    {t.kurz}
                  </th>
                ))}
              </tr>
              <tr>
                {SPALTEN.map((s) => (
                  <th key={`${s.tag}${s.halbtag}`} className={`px-1 text-center font-normal text-neutral-500 ${s.halbtag === "VM" ? "border-l border-linie" : ""}`}>
                    {s.halbtag}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gruppen.map((g) => (
                <Fragment key={g.titel}>
                  <tr className="bg-sand">
                    <td colSpan={15} className="text-sm font-semibold text-emerald-900">
                      {g.titel}
                    </td>
                  </tr>
                  {g.staende.map((s) => {
                    const soTour = sonntagsTour.get(s.id);
                    return (
                      <tr key={s.id} className={s.aktiv ? "" : "opacity-50"}>
                        <td className="whitespace-nowrap text-sm">
                          {s.nummer} {s.name}
                          {soTour && soTour.nummer !== g.tour?.nummer && <span className="ml-1 text-xs text-neutral-500">(So: Tour {soTour.nummer})</span>}
                          {!soTour && offen.has(planKey(s.id, 7, "VM")) && <span className="ml-1 text-xs text-amber-700">(So: keine Tour)</span>}
                        </td>
                        {SPALTEN.map((sp) => {
                          const key = planKey(s.id, sp.tag, sp.halbtag);
                          const eintrag = planMap.get(key);
                          const istOffen = offen.has(key);
                          const probleme = fehlerFelder.get(key) ?? [];
                          const tour = tourVonStandTag(s.id, sp.tag);
                          const fahrer = tour ? fahrerAmTag(tour, sp.tag, planEmpMap) : null;
                          const istFahrer = !!eintrag && fahrer?.stand_id === s.id && fahrer.employee_id === eintrag.employee_id;
                          const nurWare = tour?.staende.find((x) => x.stand_id === s.id)?.nur_ware;
                          const istFehler = probleme.some((p) => p.art === "fehler");
                          const istWarn = probleme.some((p) => p.art === "warnung");
                          const markiert = markierePerson && eintrag?.employee_id === markierePerson;
                          const cls = !istOffen && !eintrag
                            ? "bg-neutral-100 text-neutral-300"
                            : istFehler
                              ? "bg-beere-50 text-beere-700"
                              : istWarn
                                ? "bg-amber-50 text-amber-800"
                                : "bg-white";
                          return (
                            <td
                              key={key}
                              onClick={() => darfPflegen && (istOffen || eintrag) && setAuswahl({ stand_id: s.id, wochentag: sp.tag, halbtag: sp.halbtag })}
                              title={probleme.map((p) => p.text).join("\n") || undefined}
                              className={`min-w-16 whitespace-nowrap px-1 text-center ${cls} ${sp.halbtag === "VM" ? "border-l border-linie" : ""} ${
                                darfPflegen && (istOffen || eintrag) ? "cursor-pointer hover:ring-1 hover:ring-emerald-400" : ""
                              } ${markiert ? "ring-2 ring-emerald-600" : ""} ${
                                auswahl?.stand_id === s.id && auswahl.wochentag === sp.tag && auswahl.halbtag === sp.halbtag ? "ring-2 ring-amber-500" : ""
                              }`}
                            >
                              {eintrag ? (
                                <>
                                  {istFahrer && <Car className="mr-0.5 inline h-3 w-3" />}
                                  {kurzName(eintrag.employee_id)}
                                </>
                              ) : istOffen ? (
                                nurWare ? (
                                  <span title="Stand bekommt nur Ware - Verkäufer kommt selbst, ist aber trotzdem einzuplanen">– (nur Ware)</span>
                                ) : (
                                  "–"
                                )
                              ) : (
                                ""
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-neutral-500">
        <Car className="inline h-3 w-3" /> = Fahrer der Tour (letzter mitfahrender Stand, fährt hin und zurück). Rot = Konflikt, gelb =
        Lücke/Hinweis, grau = Stand geschlossen. Sonntags gelten die Sonntagstouren.
      </p>
    </div>
  );
}
