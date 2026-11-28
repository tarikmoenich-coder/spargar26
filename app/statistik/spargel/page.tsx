"use client";

// Statistik → Spargel (Nutzer-Vorgabe 2026-11-28): je Feld und je Mitarbeiter,
// aus den Spargel-Tageszeilen (spargel_praemie_tag; 2026 aus der Excel,
// danach aus der Ernteerfassung).
//
// Leistung im Vergleich zum Feld: je Feld und Tag wird der Schnitt aller
// Personen gebildet (kg ÷ Stunden). Leistung einer Person = ihre kg ÷ (ihre
// Stunden × Feld-Schnitt der jeweiligen Tage). 100 % = so schnell wie der
// Schnitt auf denselben Feldern an denselben Tagen - fairer als reine kg/h,
// weil schwache Felder niemanden benachteiligen. Gruppenzeilen zählen beim
// Feld-Ertrag mit, nicht bei Personen und nicht im Feld-Schnitt.

import PageHeader from "@/components/PageHeader";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import { Kennzahl } from "@/components/Uebersicht";
import { BarChart3, ChevronDown, Clock, Grid3x3, Scale, Users } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { formatDatumDE, formatEuro, formatMenge } from "@/lib/format";
import { darf } from "@/lib/rollen";
import { sucheNormal } from "@/lib/suche";

interface Zeile {
  datum: string;
  saison_jahr: number;
  employee_id: string | null;
  personal_nr: string | null;
  gruppe: string | null;
  feld_id: number | null;
  feld_name: string | null;
  kg: number;
  stunden: number;
  kisten: number | null;
  kategorie_min: number | null;
  praemie: number;
  fehlbetrag: number;
}

type Ansicht = "felder" | "personen";

// ISO-Kalenderwoche
function kw(iso: string): number {
  const d = new Date(iso + "T12:00:00");
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const tag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - tag);
  const j = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - j.getTime()) / 86400000 + 1) / 7);
}

const feldKey = (z: Pick<Zeile, "feld_id" | "feld_name">) => (z.feld_id ? `f${z.feld_id}` : `n${z.feld_name ?? "?"}`);
const katText = (k: number | null) => (k === null ? "—" : formatMenge(k, k % 1 ? 1 : 0));

// Kleines Wochen-Balkendiagramm (eine Reihe, Wert je KW, Hinweis beim Überfahren)
function WochenBalken({ werte, einheit, nachkomma = 0 }: { werte: { kw: number; wert: number }[]; einheit: string; nachkomma?: number }) {
  if (werte.length === 0) return <span className="text-xs text-neutral-400">—</span>;
  const max = Math.max(...werte.map((w) => w.wert), 1);
  const b = 14;
  const h = 56;
  return (
    <svg
      viewBox={`0 0 ${werte.length * (b + 2)} ${h + 14}`}
      className="h-[70px] max-w-full"
      style={{ width: werte.length * (b + 2) }}
      role="img"
      aria-label={`Verlauf je Kalenderwoche in ${einheit}`}
    >
      {werte.map((w, i) => {
        const hoehe = Math.max(2, (w.wert / max) * h);
        return (
          <g key={w.kw}>
            <title>{`KW ${w.kw}: ${formatMenge(w.wert, nachkomma)} ${einheit}`}</title>
            <rect x={i * (b + 2)} y={h - hoehe} width={b} height={hoehe} rx={2} className="fill-emerald-500" />
            <text x={i * (b + 2) + b / 2} y={h + 11} textAnchor="middle" className="fill-neutral-400" style={{ fontSize: 8 }}>
              {w.kw}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LeistungsBadge({ wert }: { wert: number | null }) {
  if (wert === null) return <span className="text-neutral-400">—</span>;
  const p = Math.round(wert * 100);
  const ton = p >= 110 ? "text-emerald-700" : p < 90 ? "text-beere-700" : "text-neutral-700";
  return <span className={`font-medium tabular-nums ${ton}`}>{p} %</span>;
}

export default function StatistikSpargelPage() {
  const { profile } = useProfile();
  const darfLesen = darf(profile, "ernte.statistik:L", "ernte.praemien:L", "lohn.uebersicht:L");

  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [flaeche, setFlaeche] = useState<Record<number, number>>({});
  const [namen, setNamen] = useState<Record<string, string>>({});
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [saison, setSaison] = useState<number | null>(null);
  const [ansicht, setAnsicht] = useState<Ansicht>("felder");
  const [offen, setOffen] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [sortPers, setSortPers] = useState<"leistung" | "kg" | "kgh" | "praemie">("leistung");

  useEffect(() => {
    if (!darfLesen) return;
    (async () => {
      setLaedt(true);
      const sb = getSupabaseClient();
      try {
        const [z, f, e] = await Promise.all([
          ladeAlleSeiten<Zeile>((von, bis) =>
            sb
              .from("spargel_praemie_tag")
              .select("datum, saison_jahr, employee_id, personal_nr, gruppe, feld_id, feld_name, kg, stunden, kisten, kategorie_min, praemie, fehlbetrag")
              .order("datum")
              .order("personal_nr")
              .range(von, bis)
          ),
          sb.from("feld_geojson").select("id, flaeche_brutto_ha"),
          ladeAlleSeiten<{ id: string; name: string; vorname: string }>((von, bis) =>
            sb.from("employees").select("id, name, vorname").order("id").range(von, bis)
          ),
        ]);
        setZeilen(z.map((x) => ({ ...x, kg: Number(x.kg), stunden: Number(x.stunden), praemie: Number(x.praemie), fehlbetrag: Number(x.fehlbetrag) })));
        setFlaeche(
          Object.fromEntries(
            ((f.data as { id: number; flaeche_brutto_ha: number | null }[]) ?? [])
              .filter((x) => x.flaeche_brutto_ha)
              .map((x) => [x.id, Number(x.flaeche_brutto_ha)])
          )
        );
        setNamen(Object.fromEntries(e.map((x) => [x.id, `${x.name}, ${x.vorname}`])));
        const jahre = Array.from(new Set(z.map((x) => x.saison_jahr))).sort();
        setSaison((s) => s ?? jahre[jahre.length - 1] ?? null);
        setFehler(null);
      } catch (err) {
        setFehler(String(err));
      }
      setLaedt(false);
    })();
  }, [darfLesen]);

  const jahre = useMemo(() => Array.from(new Set(zeilen.map((x) => x.saison_jahr))).sort(), [zeilen]);
  const sz = useMemo(() => zeilen.filter((z) => z.saison_jahr === saison), [zeilen, saison]);

  // Feld-Schnitt je Feld und Tag (nur Personen)
  const schnitt = useMemo(() => {
    const m = new Map<string, { kg: number; std: number }>();
    for (const z of sz) {
      if (z.gruppe || !z.stunden) continue;
      const k = `${feldKey(z)}|${z.datum}`;
      const s = m.get(k) ?? { kg: 0, std: 0 };
      s.kg += z.kg;
      s.std += z.stunden;
      m.set(k, s);
    }
    return m;
  }, [sz]);
  const schnittVon = (z: Zeile) => {
    const s = schnitt.get(`${feldKey(z)}|${z.datum}`);
    return s && s.std ? s.kg / s.std : null;
  };

  const gesamt = useMemo(() => {
    const g = { kg: 0, std: 0, tage: new Set<string>(), felder: new Set<string>(), personen: new Set<string>() };
    for (const z of sz) {
      g.kg += z.kg;
      g.tage.add(z.datum);
      g.felder.add(feldKey(z));
      if (!z.gruppe) {
        g.std += z.stunden;
        g.personen.add(z.employee_id ?? z.personal_nr ?? "");
      }
    }
    return g;
  }, [sz]);

  // Vorjahr je Feld (kg)
  const vorjahrKg = useMemo(() => {
    const m = new Map<string, number>();
    if (!saison) return m;
    for (const z of zeilen) if (z.saison_jahr === saison - 1) m.set(feldKey(z), (m.get(feldKey(z)) ?? 0) + z.kg);
    return m;
  }, [zeilen, saison]);

  const felder = useMemo(() => {
    const m = new Map<
      string,
      {
        key: string;
        id: number | null;
        name: string;
        kg: number;
        std: number;
        kgPers: number;
        tage: Set<string>;
        personen: Set<string>;
        kisten: number;
        praemie: number;
        erster: string;
        letzter: string;
        kat: Map<string, number>;
        woche: Map<number, number>;
      }
    >();
    for (const z of sz) {
      const k = feldKey(z);
      const f =
        m.get(k) ??
        {
          key: k,
          id: z.feld_id,
          name: z.feld_name || "ohne Feld",
          kg: 0,
          std: 0,
          kgPers: 0,
          tage: new Set<string>(),
          personen: new Set<string>(),
          kisten: 0,
          praemie: 0,
          erster: z.datum,
          letzter: z.datum,
          kat: new Map<string, number>(),
          woche: new Map<number, number>(),
        };
      f.kg += z.kg;
      f.kisten += z.kisten ?? 0;
      f.praemie += z.praemie;
      f.tage.add(z.datum);
      if (z.datum < f.erster) f.erster = z.datum;
      if (z.datum > f.letzter) f.letzter = z.datum;
      if (!z.gruppe) {
        f.std += z.stunden;
        f.kgPers += z.kg;
        f.personen.add(z.employee_id ?? z.personal_nr ?? "");
      }
      if (z.kategorie_min !== null) f.kat.set(z.datum, Number(z.kategorie_min));
      f.woche.set(kw(z.datum), (f.woche.get(kw(z.datum)) ?? 0) + z.kg);
      m.set(k, f);
    }
    return Array.from(m.values()).sort((a, b) => b.kg - a.kg);
  }, [sz]);

  const personen = useMemo(() => {
    const m = new Map<
      string,
      {
        key: string;
        name: string;
        pnr: string;
        kg: number;
        std: number;
        soll: number; // Stunden × Feld-Schnitt
        tage: Set<string>;
        praemie: number;
        fehl: number;
        felder: Map<string, { name: string; tage: number; kg: number }>;
        woche: Map<number, { kg: number; soll: number }>;
      }
    >();
    for (const z of sz) {
      if (z.gruppe) continue;
      const key = z.employee_id ?? `p:${z.personal_nr}`;
      const p =
        m.get(key) ??
        {
          key,
          name: z.employee_id ? namen[z.employee_id] ?? `Pers.-Nr. ${z.personal_nr}` : `Pers.-Nr. ${z.personal_nr ?? "?"}`,
          pnr: z.personal_nr ?? "",
          kg: 0,
          std: 0,
          soll: 0,
          tage: new Set<string>(),
          praemie: 0,
          fehl: 0,
          felder: new Map(),
          woche: new Map(),
        };
      const s = schnittVon(z);
      p.kg += z.kg;
      p.std += z.stunden;
      if (s) p.soll += z.stunden * s;
      p.tage.add(z.datum);
      p.praemie += z.praemie;
      p.fehl += z.fehlbetrag;
      const fk = feldKey(z);
      const fe = p.felder.get(fk) ?? { name: z.feld_name || "ohne Feld", tage: 0, kg: 0 };
      fe.tage += 1;
      fe.kg += z.kg;
      p.felder.set(fk, fe);
      const w = p.woche.get(kw(z.datum)) ?? { kg: 0, soll: 0 };
      w.kg += z.kg;
      if (s) w.soll += z.stunden * s;
      p.woche.set(kw(z.datum), w);
      m.set(key, p);
    }
    const q = sucheNormal(suche);
    const liste = Array.from(m.values()).filter((p) => !q || sucheNormal(p.name).includes(q) || sucheNormal(p.pnr).includes(q));
    const leistung = (p: (typeof liste)[number]) => (p.soll ? p.kg / p.soll : -1);
    return liste.sort((a, b) =>
      sortPers === "kg"
        ? b.kg - a.kg
        : sortPers === "kgh"
          ? (b.std ? b.kg / b.std : 0) - (a.std ? a.kg / a.std : 0)
          : sortPers === "praemie"
            ? b.praemie - a.praemie
            : leistung(b) - leistung(a)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sz, namen, suche, sortPers, schnitt]);

  if (!darfLesen) {
    return (
      <div className="flex flex-col gap-4">
        <ErntewirtschaftTabs />
        <PageHeader icon={BarChart3} titel="Statistik – Spargel" />
        <p className="text-sm text-neutral-500">Keine Berechtigung.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ErntewirtschaftTabs />
      <PageHeader
        icon={BarChart3}
        titel="Statistik – Spargel"
        beschreibung="Ertrag je Feld und Leistung je Mitarbeiter. Leistung = im Vergleich zum Schnitt auf demselben Feld am selben Tag (100 % = Schnitt)."
        aktionen={
          jahre.length > 0 && (
            <select value={saison ?? ""} onChange={(e) => setSaison(Number(e.target.value))} aria-label="Saison">
              {jahre.map((j) => (
                <option key={j} value={j}>
                  Saison {j}
                </option>
              ))}
            </select>
          )
        }
      />

      {fehler && <p className="text-sm text-beere-700">Konnte nicht geladen werden: {fehler}</p>}
      {laedt ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : sz.length === 0 ? (
        <p className="text-sm text-neutral-500">Noch keine Spargeldaten vorhanden.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kennzahl icon={Scale} titel="Ertrag" wert={`${formatMenge(gesamt.kg / 1000, 1)} t`} />
            <Kennzahl icon={Grid3x3} titel="Felder" wert={gesamt.felder.size} unter={`${gesamt.tage.size} Erntetage`} />
            <Kennzahl icon={Users} titel="Mitarbeiter" wert={gesamt.personen.size} />
            <Kennzahl icon={Clock} titel="Stunden" wert={formatMenge(gesamt.std, 0)} />
            <Kennzahl icon={Scale} titel="Ø kg je Stunde" wert={formatMenge(gesamt.std ? gesamt.kg / gesamt.std : null, 1)} unter="ohne Gruppen" />
          </div>

          <div className="flex flex-wrap gap-4 border-b border-linie text-sm">
            {(
              [
                ["felder", "Je Feld"],
                ["personen", "Je Mitarbeiter"],
              ] as [Ansicht, string][]
            ).map(([w, l]) => (
              <button
                key={w}
                type="button"
                onClick={() => {
                  setAnsicht(w);
                  setOffen(null);
                }}
                className={`-mb-px border-b-2 px-1 pb-2 ${
                  ansicht === w ? "border-emerald-600 font-semibold text-emerald-800" : "border-transparent text-neutral-600 hover:text-emerald-800"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {ansicht === "felder" && (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Feld</th>
                    <th className="text-right">Ertrag kg</th>
                    <th className="text-right">ha</th>
                    <th className="text-right">kg/ha</th>
                    {vorjahrKg.size > 0 && <th className="text-right">Vorjahr kg</th>}
                    <th className="text-right">Erntetage</th>
                    <th>Zeitraum</th>
                    <th className="text-right">Personen</th>
                    <th className="text-right">Ø kg/h</th>
                    <th className="text-right">Kategorie</th>
                    <th className="text-right">Prämie</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {felder.map((f) => {
                    const ha = f.id ? flaeche[f.id] : undefined;
                    const kats = Array.from(f.kat.values());
                    const kmin = kats.length ? Math.min(...kats) : null;
                    const kmax = kats.length ? Math.max(...kats) : null;
                    const auf = offen === f.key;
                    // Kategorie-Wechsel im Verlauf
                    const wechsel: { datum: string; kat: number }[] = [];
                    Array.from(f.kat.entries())
                      .sort(([a], [b]) => a.localeCompare(b))
                      .forEach(([d, k]) => {
                        if (!wechsel.length || wechsel[wechsel.length - 1].kat !== k) wechsel.push({ datum: d, kat: k });
                      });
                    return (
                      <Fragment key={f.key}>
                        <tr className="cursor-pointer hover:bg-emerald-50/40" onClick={() => setOffen(auf ? null : f.key)}>
                          <td className="whitespace-nowrap font-medium">{f.name}</td>
                          <td className="text-right tabular-nums">{formatMenge(f.kg, 0)}</td>
                          <td className="text-right tabular-nums text-neutral-500">{ha ? formatMenge(ha, 2) : "—"}</td>
                          <td className="text-right tabular-nums">{ha ? formatMenge(f.kg / ha, 0) : "—"}</td>
                          {vorjahrKg.size > 0 && (
                            <td className="text-right tabular-nums text-neutral-500">{vorjahrKg.has(f.key) ? formatMenge(vorjahrKg.get(f.key), 0) : "—"}</td>
                          )}
                          <td className="text-right tabular-nums">{f.tage.size}</td>
                          <td className="whitespace-nowrap text-neutral-500">
                            {formatDatumDE(f.erster).slice(0, 6)}–{formatDatumDE(f.letzter).slice(0, 6)}
                          </td>
                          <td className="text-right tabular-nums">{f.personen.size}</td>
                          <td className="text-right tabular-nums">{formatMenge(f.std ? f.kgPers / f.std : null, 1)}</td>
                          <td className="text-right tabular-nums">{kmin === kmax ? katText(kmin) : `${katText(kmin)}–${katText(kmax)}`}</td>
                          <td className="text-right tabular-nums">{f.praemie ? formatEuro(f.praemie) : ""}</td>
                          <td>
                            <ChevronDown className={`h-4 w-4 text-neutral-400 transition ${auf ? "" : "-rotate-90"}`} />
                          </td>
                        </tr>
                        {auf && (
                          <tr>
                            <td colSpan={12} className="bg-white">
                              <div className="flex flex-wrap gap-8 py-2">
                                <div>
                                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">Ertrag je Kalenderwoche (kg)</div>
                                  <WochenBalken
                                    einheit="kg"
                                    werte={Array.from(f.woche.entries())
                                      .sort(([a], [b]) => a - b)
                                      .map(([w, v]) => ({ kw: w, wert: v }))}
                                  />
                                </div>
                                <div className="min-w-0">
                                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">Kategorie-Wechsel</div>
                                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                    {wechsel.map((w) => (
                                      <li key={w.datum} className="tabular-nums">
                                        <span className="text-neutral-500">{formatDatumDE(w.datum).slice(0, 6)}</span> {katText(w.kat)}
                                      </li>
                                    ))}
                                  </ul>
                                  <div className="mt-2 text-xs text-neutral-500">
                                    {formatMenge(f.kisten, 0)} Kisten · {formatMenge(f.std, 0)} Std. (ohne Gruppen)
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {ansicht === "personen" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="statistik-suche"
                  className="max-w-xs"
                  placeholder="Name oder Personalnummer suchen"
                  value={suche}
                  onChange={(e) => setSuche(e.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  Sortieren
                  <select value={sortPers} onChange={(e) => setSortPers(e.target.value as typeof sortPers)}>
                    <option value="leistung">nach Leistung</option>
                    <option value="kgh">nach kg/h</option>
                    <option value="kg">nach kg</option>
                    <option value="praemie">nach Prämie</option>
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Mitarbeiter</th>
                      <th>Pers.-Nr.</th>
                      <th className="text-right" title="kg im Vergleich zum Schnitt auf denselben Feldern an denselben Tagen">
                        Leistung
                      </th>
                      <th className="text-right">kg</th>
                      <th className="text-right">Std.</th>
                      <th className="text-right">kg/h</th>
                      <th className="text-right">Tage</th>
                      <th className="text-right">Felder</th>
                      <th className="text-right">Prämie</th>
                      <th className="text-right">Unter der Schwelle</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {personen.map((p) => {
                      const auf = offen === p.key;
                      return (
                        <Fragment key={p.key}>
                          <tr className="cursor-pointer hover:bg-emerald-50/40" onClick={() => setOffen(auf ? null : p.key)}>
                            <td className="whitespace-nowrap">{p.name}</td>
                            <td className="text-neutral-500">{p.pnr}</td>
                            <td className="text-right">
                              <LeistungsBadge wert={p.soll ? p.kg / p.soll : null} />
                            </td>
                            <td className="text-right tabular-nums">{formatMenge(p.kg, 0)}</td>
                            <td className="text-right tabular-nums">{formatMenge(p.std, 1)}</td>
                            <td className="text-right tabular-nums">{formatMenge(p.std ? p.kg / p.std : null, 1)}</td>
                            <td className="text-right tabular-nums">{p.tage.size}</td>
                            <td className="text-right tabular-nums">{p.felder.size}</td>
                            <td className="text-right tabular-nums">{p.praemie ? formatEuro(p.praemie) : ""}</td>
                            <td className="text-right tabular-nums text-neutral-500">{p.fehl ? formatEuro(p.fehl) : ""}</td>
                            <td>
                              <ChevronDown className={`h-4 w-4 text-neutral-400 transition ${auf ? "" : "-rotate-90"}`} />
                            </td>
                          </tr>
                          {auf && (
                            <tr>
                              <td colSpan={11} className="bg-white">
                                <div className="flex flex-wrap gap-8 py-2">
                                  <div>
                                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                                      Leistung je Kalenderwoche (% vom Feld-Schnitt)
                                    </div>
                                    <WochenBalken
                                      einheit="%"
                                      werte={Array.from(p.woche.entries())
                                        .filter(([, w]) => w.soll > 0)
                                        .sort(([a], [b]) => a - b)
                                        .map(([w, v]) => ({ kw: w, wert: (v.kg / v.soll) * 100 }))}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">Felder</div>
                                    <ul className="text-sm">
                                      {Array.from(p.felder.values())
                                        .sort((a, b) => b.tage - a.tage)
                                        .map((f) => (
                                          <li key={f.name} className="tabular-nums">
                                            {f.name} <span className="text-neutral-500">· {f.tage} Tage · {formatMenge(f.kg, 0)} kg</span>
                                          </li>
                                        ))}
                                    </ul>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-neutral-500">
                Leistung: <span className="text-emerald-700">grün</span> ab 110 %, <span className="text-beere-700">rot</span> unter 90 % des
                Schnitts auf denselben Feldern an denselben Tagen.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
