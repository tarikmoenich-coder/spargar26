"use client";

// Vertrieb → Woche (Vertriebsplanung V4, docs/vertriebsplanung-plan.md).
// Die konkrete Kalenderwoche: Grundplan + Änderungen nur für einzelne Tage
// (Krankheit, Tausch, Stand zu). Feiertage gelten wie Sonntag (Nutzer
// 2026-11-26). Abwesenheiten (Urlaub/krank) werden rot markiert, damit eine
// Vertretung eingeplant wird. Je Tag geht es von hier zu den Ausdrucken:
// A3-Tagesplan aller Touren und A4-Änderungszettel je Tour.

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Car, ChevronLeft, ChevronRight, Printer, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import PageHeader from "@/components/PageHeader";
import VertriebTabs from "@/components/VertriebTabs";
import type { VtHalbtag, VtStand } from "@/lib/types";
import { HALBTAGE, farbeGeschlecht, fahrerStandId, zeitKurz } from "@/lib/vertrieb";
import { datumPlusTageIso, heuteLokalIso } from "@/lib/datum";
import {
  datumKurz,
  datumLang,
  feiertageBerechnen,
  kalenderwoche,
  montagVon,
  tagesplanBerechnen,
  tourAenderungen,
  type TagesFeld,
  type Tagesplan,
} from "@/lib/tagesplan";
import { saisonVon, tagesplanDatenLaden, type TagesplanDaten } from "@/lib/tagesplanLaden";

const WT = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const SCHRAFFUR = { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, rgba(0,0,0,0.045) 5px 6px)" };
type Umfang = VtHalbtag | "TAG";
type Auswahl = { datum: string; stand_id: number; umfang: Umfang; x: number; y: number; h: number };

export default function VertriebWochePage() {
  const { profile } = useProfile();
  const darfPflegen = hatRolle(profile, "admin", "hr");
  const [montag, setMontag] = useState(() => montagVon(heuteLokalIso()));
  const [d, setD] = useState<TagesplanDaten | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [auswahl, setAuswahl] = useState<Auswahl | null>(null);
  const [suche, setSuche] = useState("");
  const [standSuche, setStandSuche] = useState("");
  const [nurProbleme, setNurProbleme] = useState(false);
  const [zeigeFeiertage, setZeigeFeiertage] = useState(false);
  const [neuFt, setNeuFt] = useState({ datum: "", name: "" });
  const sucheRef = useRef<HTMLInputElement>(null);

  const tage = useMemo(() => Array.from({ length: 7 }, (_, i) => datumPlusTageIso(montag, i)), [montag]);

  const load = useCallback(async () => {
    const daten = await tagesplanDatenLaden(getSupabaseClient(), montag, datumPlusTageIso(montag, 6));
    setD(daten);
    setFehler(daten.fehler);
  }, [montag]);
  useEffect(() => {
    load();
  }, [load]);

  const personById = useMemo(() => new Map((d?.personen ?? []).map((p) => [p.id, p])), [d]);
  const standById = useMemo(() => new Map((d?.staende ?? []).map((s) => [s.id, s])), [d]);
  const kurzName = (id: string) => {
    const p = personById.get(id);
    return p ? `${p.vorname} ${p.name.charAt(0)}.` : "?";
  };
  const personName = (id: string) => {
    const p = personById.get(id);
    return p ? `${p.vorname} ${p.name}` : "?";
  };
  const hatFs = useCallback(
    (id: string) => !!personById.get(id)?.fuehrerschein_b || !!d?.fsDoku.some((f) => f.employee_id === id && f.fuehrerschein_kategorien.length > 0),
    [personById, d]
  );

  const plaene: Tagesplan[] = useMemo(() => {
    if (!d) return [];
    return tage.map((datum) =>
      tagesplanBerechnen({
        datum,
        feiertage: d.feiertage,
        grundplan: d.grundplan.filter((g) => g.saison_jahr === saisonVon(datum)),
        zeiten: d.zeiten,
        aenderungen: d.aenderungen,
        abwesenheiten: d.abwesenheiten,
        staende: d.staende,
        touren: d.touren,
        tourStaende: d.tourStaende,
        tourTage: d.tourTage,
        fahrzeuge: d.fahrzeuge,
      })
    );
  }, [d, tage]);

  // Probleme je Feld: Lücke (offen, niemand), Person abwesend
  const problem = (f: TagesFeld) => !f.zu && f.offen && (!f.emp || !!f.abwesend);

  // Zeilen nach Mo-Sa-Tour gruppiert (wie im Grundplan)
  const gruppen = useMemo(() => {
    if (!d) return [];
    const q = standSuche.trim().toLowerCase();
    const sichtbar = (s: VtStand) => {
      if (!s.aktiv) return false;
      if (q && !`${s.nummer} ${s.name}`.toLowerCase().includes(q)) return false;
      if (nurProbleme && !plaene.some((tp) => HALBTAGE.some((h) => problem(tp.feld(s.id, h.wert))))) return false;
      return true;
    };
    const res: { key: string; titel: string; staende: VtStand[] }[] = [];
    const vergeben = new Set<number>();
    for (const t of d.touren.filter((x) => x.tagesart === "MO_SA" && x.aktiv).sort((a, b) => a.nummer - b.nummer)) {
      const liste = d.tourStaende
        .filter((x) => x.tour_id === t.id)
        .sort((a, b) => a.reihenfolge - b.reihenfolge)
        .map((x) => standById.get(x.stand_id))
        .filter((s): s is VtStand => !!s);
      liste.forEach((s) => vergeben.add(s.id));
      const f = liste.filter(sichtbar);
      if (f.length) res.push({ key: `t${t.id}`, titel: `Tour ${t.nummer}${t.name ? ` · ${t.name}` : ""}`, staende: f });
    }
    const rest = d.staende.filter((s) => !vergeben.has(s.id) && sichtbar(s));
    if (rest.length) res.push({ key: "ohne", titel: "Ohne Tour (Mo–Sa)", staende: rest });
    return res;
  }, [d, standById, standSuche, nurProbleme, plaene]);

  const fahrerMoSa = useMemo(() => {
    const m = new Set<number>();
    for (const t of d?.touren ?? []) {
      if (!t.aktiv || t.tagesart !== "MO_SA") continue;
      const f = fahrerStandId(d!.tourStaende.filter((x) => x.tour_id === t.id));
      if (f != null) m.add(f);
    }
    return m;
  }, [d]);

  // Änderungen gegenüber dem letzten Ausdruck je Tag
  const aenderungenJeTag = useMemo(() => {
    const m = new Map<string, { anzahl: number; gedruckt: string | null }>();
    for (const tp of plaene) {
      const letzter = d?.drucke.find((x) => x.datum === tp.datum) ?? null;
      m.set(tp.datum, { anzahl: letzter ? tourAenderungen(tp, letzter.stand).length : 0, gedruckt: letzter?.gedruckt_am ?? null });
    }
    return m;
  }, [plaene, d]);

  // --- Schreiben ------------------------------------------------------------------
  // art: "person" (empId), "grundplan" (Änderung löschen), "leer" (unbesetzt), "zu"
  async function setzen(a: Auswahl, art: "person" | "grundplan" | "leer" | "zu", empId: string | null = null) {
    if (!d) return;
    const sb = getSupabaseClient();
    setFehler(null);
    const tp = plaene.find((x) => x.datum === a.datum)!;
    const hs: VtHalbtag[] = a.umfang === "TAG" ? ["VM", "NM"] : [a.umfang];
    for (const h of hs) {
      const f = tp.feld(a.stand_id, h);
      if (!f.offen && art !== "grundplan" && art !== "zu" && !f.emp) continue;
      // Person steht zur selben Zeit woanders -> dort heute unbesetzt
      if (art === "person" && empId) {
        for (const g of tp.felder.values())
          if (g.halbtag === h && g.emp === empId && g.stand_id !== a.stand_id) {
            const { error } = await sb
              .from("vt_tag_aenderung")
              .upsert({ datum: a.datum, stand_id: g.stand_id, halbtag: h, employee_id: null, geschlossen: false, geaendert_am: new Date().toISOString() }, { onConflict: "datum,stand_id,halbtag" });
            if (error) return setFehler(error.message), load();
          }
      }
      const zurueck = art === "grundplan" || (art === "person" && empId === f.grundEmp);
      if (zurueck) {
        if (f.aenderung) {
          const { error } = await sb.from("vt_tag_aenderung").delete().eq("id", f.aenderung.id);
          if (error) return setFehler(error.message), load();
        }
        continue;
      }
      const { error } = await sb.from("vt_tag_aenderung").upsert(
        {
          datum: a.datum,
          stand_id: a.stand_id,
          halbtag: h,
          employee_id: art === "person" ? empId : null,
          geschlossen: art === "zu",
          geaendert_am: new Date().toISOString(),
        },
        { onConflict: "datum,stand_id,halbtag" }
      );
      if (error) return setFehler(error.message), load();
    }
    setAuswahl(null);
    load();
  }

  async function feiertageEintragen(jahr: number) {
    const vorschlag = feiertageBerechnen(jahr).filter((f) => !d?.feiertage.some((x) => x.datum === f.datum));
    if (!vorschlag.length) return setFehler(`Alle Feiertage ${jahr} sind schon eingetragen.`);
    if (!confirm(`${vorschlag.length} Feiertage ${jahr} eintragen?\n\n${vorschlag.map((f) => `${datumLang(f.datum)}: ${f.name}`).join("\n")}`)) return;
    const { error } = await getSupabaseClient().from("vt_feiertag").insert(vorschlag);
    if (error) setFehler(error.message);
    load();
  }
  async function feiertagLoeschen(id: number) {
    const { error } = await getSupabaseClient().from("vt_feiertag").delete().eq("id", id);
    if (error) setFehler(error.message);
    load();
  }
  async function feiertagNeu() {
    if (!neuFt.datum || !neuFt.name.trim()) return;
    const { error } = await getSupabaseClient().from("vt_feiertag").insert({ datum: neuFt.datum, name: neuFt.name.trim() });
    if (error) setFehler(error.message);
    setNeuFt({ datum: "", name: "" });
    load();
  }

  // --- Auswahl ----------------------------------------------------------------------
  function oeffnen(el: Element, datum: string, stand_id: number, umfang: Umfang) {
    if (!darfPflegen) return;
    const r = el.getBoundingClientRect();
    setSuche("");
    setAuswahl({ datum, stand_id, umfang, x: r.left, y: r.top, h: r.height });
  }
  useEffect(() => {
    if (auswahl) sucheRef.current?.focus();
  }, [auswahl]);

  const kandidaten = useMemo(() => {
    if (!auswahl || !d) return [];
    const tp = plaene.find((x) => x.datum === auswahl.datum)!;
    const hs: VtHalbtag[] = auswahl.umfang === "TAG" ? ["VM", "NM"] : [auswahl.umfang];
    const q = suche.trim().toLowerCase();
    return d.planung
      .filter((pl) => pl.saison_jahr === saisonVon(auswahl.datum))
      .map((pl) => personById.get(pl.employee_id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .filter((p) => !q || `${p.vorname} ${p.name} ${p.personal_nr}`.toLowerCase().includes(q))
      .map((p) => {
        const kannWerte = hs.map((h) => d.verf.find((v) => v.employee_id === p.id && v.saison_jahr === saisonVon(auswahl.datum) && v.wochentag === tp.planTag && v.halbtag === h)?.kann ?? null);
        const abwesend = d.abwesenheiten.find((a) => a.employee_id === p.id && a.von <= auswahl.datum && a.bis >= auswahl.datum && (a.halbtag === null || hs.includes(a.halbtag)));
        const woanders = [...tp.felder.values()].find((g) => hs.includes(g.halbtag) && g.emp === p.id && g.stand_id !== auswahl.stand_id);
        const kann = kannWerte.includes(false) ? false : kannWerte.every((k) => k === true) ? true : null;
        const rang = (abwesend ? 10 : 0) + (kann === false ? 5 : kann === null ? 1 : 0) + (woanders ? 3 : 0);
        return { p, kann, abwesend, woanders, rang };
      })
      .sort((a, b) => a.rang - b.rang || a.p.name.localeCompare(b.p.name, "de"));
  }, [auswahl, d, plaene, suche, personById]);

  // --- Darstellung ------------------------------------------------------------------
  function chip(empId: string, warn: boolean) {
    const p = personById.get(empId);
    return (
      <span
        className={`inline-flex max-w-[6.5rem] items-center gap-0.5 truncate rounded border px-1 py-0.5 text-[11px] font-medium leading-tight ${warn ? "ring-2 ring-beere-500" : ""}`}
        style={farbeGeschlecht(p?.geschlecht)}
      >
        {hatFs(empId) && <Car className="h-3 w-3 shrink-0" />}
        <span className="truncate">{kurzName(empId)}</span>
      </span>
    );
  }

  function zellen(tp: Tagesplan, s: VtStand) {
    const vm = tp.feld(s.id, "VM");
    const nm = tp.feld(s.id, "NM");
    const fahrerZeile = fahrerMoSa.has(s.id) && tp.planTag !== 7;
    const zelle = (u: Umfang, f: TagesFeld, extra?: TagesFeld) => {
      const felder = extra ? [f, extra] : [f];
      const geaendert = felder.some((x) => x.aenderung);
      const zu = felder.every((x) => x.zu);
      const geschlossen = felder.every((x) => !x.offen && !x.emp) && !geaendert;
      const fehlt = felder.some((x) => x.offen && !x.zu && !x.emp);
      const abw = felder.find((x) => x.abwesend)?.abwesend ?? null;
      const klickbar = darfPflegen && !geschlossen;
      const titel = [
        `${s.nummer} ${s.name} · ${datumLang(tp.datum)} ${u === "TAG" ? "" : u === "VM" ? "Vormittag" : "Nachmittag"}`,
        f.von ? `${zeitKurz(f.von)}–${zeitKurz((extra ?? f).bis)}` : "",
        zu ? "heute geschlossen" : "",
        fehlt ? "NIEMAND EINGEPLANT - Vertretung fehlt" : "",
        abw ? `${personName(f.emp ?? extra?.emp ?? "")} ist abwesend${abw.grund ? `: ${abw.grund}` : ""} - Vertretung einplanen` : "",
        geaendert ? `geändert - laut Grundplan: ${felder.map((x) => (x.grundEmp ? personName(x.grundEmp) : "niemand")).join(" / ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return (
        <td
          key={`${tp.datum}${u}`}
          colSpan={u === "TAG" ? 2 : 1}
          onClick={(e) => klickbar && oeffnen(e.currentTarget, tp.datum, s.id, u === "TAG" || (vm.offen && nm.offen && !vm.emp && !nm.emp && !vm.zu && !nm.zu) ? "TAG" : u)}
          title={titel}
          style={geschlossen || zu ? SCHRAFFUR : undefined}
          className={`h-8 min-w-[3.75rem] whitespace-nowrap border-r-0 border-t-0 px-0.5 text-center align-middle ${u === "NM" ? "border-l-0" : ""} ${
            fehlt || abw ? "bg-beere-50" : geschlossen ? "bg-neutral-50" : fahrerZeile ? "bg-violet-50" : "bg-white"
          } ${geaendert ? "shadow-[inset_3px_0_0_0_#f97316]" : ""} ${klickbar ? "cursor-pointer hover:bg-emerald-50/60" : ""} ${
            auswahl && auswahl.datum === tp.datum && auswahl.stand_id === s.id && (auswahl.umfang === u || auswahl.umfang === "TAG" || u === "TAG")
              ? "!bg-amber-100 ring-2 ring-inset ring-amber-500"
              : ""
          }`}
        >
          {zu ? (
            <span className="text-[10px] font-medium text-neutral-500">zu</span>
          ) : f.emp ? (
            chip(f.emp, !!abw)
          ) : fehlt ? (
            <span className="text-[11px] font-semibold text-beere-700">fehlt</span>
          ) : null}
        </td>
      );
    };
    if (vm.emp && nm.emp && vm.emp === nm.emp && !vm.zu && !nm.zu) return [zelle("TAG", vm, nm)];
    if (vm.zu && nm.zu) return [zelle("TAG", vm, nm)];
    return [zelle("VM", vm), zelle("NM", nm)];
  }

  const popStil = (() => {
    if (!auswahl || typeof window === "undefined") return {};
    const left = Math.max(8, Math.min(auswahl.x, window.innerWidth - 368));
    const unten = auswahl.y + auswahl.h + 4;
    const top = unten + 440 > window.innerHeight ? Math.max(8, auswahl.y - 444) : unten;
    return { left, top, width: 360, maxHeight: 440 };
  })();
  const aktTp = auswahl ? plaene.find((x) => x.datum === auswahl.datum) : null;
  const aktFelder = auswahl && aktTp ? (auswahl.umfang === "TAG" ? (["VM", "NM"] as VtHalbtag[]) : [auswahl.umfang]).map((h) => aktTp.feld(auswahl.stand_id, h)) : [];
  const jahr = Number(montag.slice(0, 4));
  const feiertageJahr = (d?.feiertage ?? []).filter((f) => f.datum.startsWith(String(jahr)));

  return (
    <div className="flex flex-col gap-4">
      <VertriebTabs />
      <PageHeader
        icon={CalendarDays}
        titel={`Woche KW ${kalenderwoche(montag)} · ${datumKurz(montag)}–${datumKurz(datumPlusTageIso(montag, 6))}${montag.slice(0, 4)}`}
        beschreibung={`Grundplan plus Änderungen nur für einzelne Tage (Krankheit, Tausch, Stand zu). Feiertage gelten wie Sonntag.${
          darfPflegen ? " Feld anklicken = für diesen Tag ändern." : ""
        }`}
        aktionen={
          <div className="flex items-center gap-1 print:hidden">
            <button className="btn-secondary px-2" onClick={() => setMontag(datumPlusTageIso(montag, -7))} title="Woche zurück">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input type="date" value={montag} onChange={(e) => e.target.value && setMontag(montagVon(e.target.value))} />
            <button className="btn-secondary px-2" onClick={() => setMontag(datumPlusTageIso(montag, 7))} title="Woche vor">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button className="btn-secondary" onClick={() => setMontag(montagVon(heuteLokalIso()))}>
              diese Woche
            </button>
          </div>
        }
      />
      {fehler && <p className="text-sm text-beere-600">{fehler}</p>}

      <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
        <input placeholder="Stand suchen …" value={standSuche} onChange={(e) => setStandSuche(e.target.value)} className="w-44" />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={nurProbleme} onChange={(e) => setNurProbleme(e.target.checked)} />
          nur Stände mit Lücken / Abwesenden
        </label>
        <button className="btn-secondary ml-auto text-xs" onClick={() => setZeigeFeiertage((x) => !x)}>
          Feiertage {jahr} ({feiertageJahr.length})
        </button>
      </div>

      {zeigeFeiertage && (
        <div className="card flex flex-col gap-2 text-sm">
          <div className="font-semibold">Feiertage {jahr} - gelten wie Sonntag (Öffnungszeiten, Sonntagstouren, Sonntags-Besetzung)</div>
          <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
            {feiertageJahr.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <span className="w-56">{datumLang(f.datum)}</span>
                <span className="flex-1 text-neutral-600">{f.name}</span>
                {darfPflegen && (
                  <button className="text-neutral-400 hover:text-beere-600" onClick={() => feiertagLoeschen(f.id)} title="entfernen">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
            {feiertageJahr.length === 0 && <li className="text-neutral-500">Noch keine Feiertage eingetragen.</li>}
          </ul>
          {darfPflegen && (
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-secondary text-xs" onClick={() => feiertageEintragen(jahr)}>
                Gesetzliche Feiertage {jahr} eintragen (Hessen + Fronleichnam)
              </button>
              <input type="date" value={neuFt.datum} onChange={(e) => setNeuFt({ ...neuFt, datum: e.target.value })} />
              <input placeholder="Name" value={neuFt.name} onChange={(e) => setNeuFt({ ...neuFt, name: e.target.value })} className="w-44" />
              <button className="btn-secondary text-xs" onClick={feiertagNeu}>
                hinzufügen
              </button>
            </div>
          )}
        </div>
      )}

      {!d ? (
        <p className="text-sm text-neutral-500">Lädt …</p>
      ) : (
        <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded border border-linie">
          <table className="w-auto min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-52 border-x-0 border-t-0 bg-emerald-50 text-sm">Stand</th>
                {plaene.map((tp) => {
                  const ae = aenderungenJeTag.get(tp.datum);
                  const luecken = [...tp.felder.values()].filter(problem).length;
                  return (
                    <th key={tp.datum} colSpan={2} className={`sticky top-0 z-20 border-r-0 border-t-0 p-0.5 text-center ${tp.feiertag ? "bg-amber-100" : "bg-emerald-50"}`}>
                      <div className="text-sm">
                        {WT[tp.wochentag]} {datumKurz(tp.datum)}
                      </div>
                      {tp.feiertag && (
                        <div className="truncate text-[10px] font-semibold text-amber-800" title={`${tp.feiertag.name} - wie Sonntag`}>
                          {tp.feiertag.name} · wie So
                        </div>
                      )}
                      <div className={`text-[10px] font-normal ${luecken ? "text-beere-700" : "text-emerald-700"}`}>{luecken ? `${luecken} offen` : "alles besetzt"}</div>
                      <div className="mt-0.5 flex justify-center gap-1 font-normal print:hidden">
                        <Link href={`/vertrieb/druck/tag?datum=${tp.datum}`} className="rounded border border-linie bg-white px-1 text-[10px] hover:bg-sand" title="Tagesplan aller Touren (DIN A3)">
                          <Printer className="inline h-3 w-3" /> A3
                        </Link>
                        {ae && ae.gedruckt && ae.anzahl > 0 && (
                          <Link
                            href={`/vertrieb/druck/aenderung?datum=${tp.datum}`}
                            className="rounded border border-orange-400 bg-orange-50 px-1 text-[10px] font-semibold text-orange-800 hover:bg-orange-100"
                            title="Seit dem letzten Ausdruck geändert - Änderungszettel je Tour (DIN A4)"
                          >
                            {ae.anzahl} geändert
                          </Link>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {gruppen.map((g) => (
                <Fragment key={g.key}>
                  <tr>
                    <td className="sticky left-0 z-10 border-x-0 border-t-0 bg-sand py-1 text-sm font-semibold text-emerald-900">{g.titel}</td>
                    <td colSpan={14} className="border-x-0 border-t-0 bg-sand" />
                  </tr>
                  {g.staende.map((s) => (
                    <tr key={s.id}>
                      <td className={`sticky left-0 z-10 whitespace-nowrap border-x-0 border-t-0 py-0.5 text-sm ${fahrerMoSa.has(s.id) ? "bg-violet-50" : "bg-white"}`}>
                        <span className="inline-block w-7 text-right text-xs tabular-nums text-neutral-400">{s.nummer}</span>{" "}
                        <span className={fahrerMoSa.has(s.id) ? "font-semibold" : ""}>{s.name}</span>
                        {fahrerMoSa.has(s.id) && <Car className="ml-1 inline h-4 w-4 text-violet-700" />}
                      </td>
                      {plaene.flatMap((tp) => zellen(tp, s))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-neutral-500">
        Orange Strich links = für diesen Tag geändert. Rot „fehlt“ = offen, aber niemand eingeplant. Roter Rahmen = eingeplante Person ist laut
        Abwesenheit nicht da. „zu“ = Stand heute geschlossen. Gelbe Spalte = Feiertag (wie Sonntag). Gelb = Frau, blau = Mann,{" "}
        <Car className="inline h-3 w-3" /> = Führerschein. „A3“ druckt den Tagesplan aller Touren; nach dem Druck zeigt „geändert“, für wie viele
        Touren es danach Änderungen gab (Änderungszettel A4).
      </p>

      {auswahl && aktTp && darfPflegen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAuswahl(null)} />
          <div
            className="fixed z-50 flex flex-col gap-2 overflow-hidden rounded-lg border border-linie bg-white p-3 shadow-xl"
            style={popStil}
            onKeyDown={(e) => e.key === "Escape" && setAuswahl(null)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold leading-tight">
                {standById.get(auswahl.stand_id)?.nummer} {standById.get(auswahl.stand_id)?.name}
                <div className="font-normal text-neutral-500">
                  {datumLang(auswahl.datum)}
                  {aktTp.feiertag ? ` · ${aktTp.feiertag.name} (wie Sonntag)` : ""}
                </div>
              </div>
              <button className="rounded p-0.5 hover:bg-neutral-100" onClick={() => setAuswahl(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-1 text-xs">
              {(["TAG", "VM", "NM"] as Umfang[]).map((u) => (
                <button
                  key={u}
                  className={`rounded border px-2 py-0.5 ${auswahl.umfang === u ? "border-emerald-600 bg-emerald-50 font-medium" : "border-linie hover:bg-neutral-50"}`}
                  onClick={() => setAuswahl({ ...auswahl, umfang: u })}
                >
                  {u === "TAG" ? "ganzer Tag" : u === "VM" ? "Vormittag" : "Nachmittag"}
                </button>
              ))}
            </div>
            <div className="text-xs text-neutral-600">
              Grundplan: {aktFelder.map((f) => `${f.halbtag} ${f.grundEmp ? personName(f.grundEmp) : "niemand"}`).join(" · ")}
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {aktFelder.some((f) => f.aenderung) && (
                <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setzen(auswahl, "grundplan")}>
                  wie Grundplan
                </button>
              )}
              <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setzen(auswahl, "leer")} title="Person fällt aus, Vertretung noch offen">
                niemand (fehlt)
              </button>
              <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setzen(auswahl, "zu")}>
                Stand heute zu
              </button>
            </div>
            <input ref={sucheRef} placeholder="Vertretung suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
            <div className="-mx-1 flex-1 overflow-y-auto">
              {kandidaten.map(({ p, kann, abwesend, woanders }) => (
                <button
                  key={p.id}
                  onClick={() => setzen(auswahl, "person", p.id)}
                  className={`flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-emerald-50 ${abwesend || kann === false ? "text-beere-700" : ""}`}
                >
                  <span className="h-3 w-3 shrink-0 rounded-sm border" style={farbeGeschlecht(p.geschlecht)} />
                  <span className="w-3 text-center">{kann === true ? "✓" : kann === false ? "✗" : "?"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {p.vorname} {p.name}
                    </span>
                    {hatFs(p.id) && <Car className="ml-1 inline h-3 w-3 text-neutral-500" />}
                    <span className="block truncate text-neutral-500">
                      {abwesend ? `abwesend${abwesend.grund ? `: ${abwesend.grund}` : ""}` : ""}
                      {woanders ? `steht bei ${standById.get(woanders.stand_id)?.name} → dort dann „fehlt“` : ""}
                    </span>
                  </span>
                </button>
              ))}
              {kandidaten.length === 0 && <div className="px-1 py-2 text-sm text-neutral-500">Niemand gefunden.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
