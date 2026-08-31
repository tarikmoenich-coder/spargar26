"use client";

// Unterkunft → Kontrollplan (2026-09). Baum Gebäude → Wohneinheit → Raum mit
// Ampel für die letzte Kontrolle (Schwellen je Raumtyp aus den Stammdaten),
// Tagen seit der letzten Kontrolle, offenen Mängeln und dem spätesten
// nächsten Kontrolltermin (offene Mängel ziehen ihn vor). Nur lesend – von
// hier springt man in die Zwischenkontrolle bzw. die Mängelliste.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import { formatDatumDE } from "@/lib/format";
import {
  KONTROLL_AMPEL_FARBE,
  KONTROLL_AMPEL_LABELS,
  naechsteKontrolle,
  raumName,
  type KontrollAmpel,
  type KontrollSchwellen,
} from "@/lib/unterkunft";
import {
  UNTERKUNFT_VORGANG_TYP_LABELS,
  type UnterkunftKontrollIntervall,
  type UnterkunftZimmerUebersicht,
} from "@/lib/types";

// Dringlichkeit für Sortierung/Rollup: nie kontrolliert und überfällig zuerst.
const AMPEL_RANG: Record<KontrollAmpel, number> = {
  rot: 0,
  keine: 1,
  gelb: 2,
  gruen: 3,
};

function tageHer(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function UnterkunftKontrollplanPage() {
  const [zimmer, setZimmer] = useState<UnterkunftZimmerUebersicht[]>([]);
  const [intervalle, setIntervalle] = useState<Record<string, KontrollSchwellen>>(
    {}
  );
  const [maengel, setMaengel] = useState<
    { id: number; zimmer_id: number; gemeldet_am: string }[]
  >([]);
  const [vorgaenge, setVorgaenge] = useState<
    { zimmer_id: number; gesamtzustand: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [gebaeudeFilter, setGebaeudeFilter] = useState("");
  const [nurFaellig, setNurFaellig] = useState(false);
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const [zu, setZu] = useState<Set<string>>(new Set()); // eingeklappte Knoten

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [z, ki, m, v] = await Promise.all([
      supabase
        .from("unterkunft_zimmer_uebersicht")
        .select("*")
        .order("gebaeude_name")
        .order("nummer"),
      supabase.from("unterkunft_kontroll_intervall").select("*"),
      supabase
        .from("unterkunft_mangel")
        .select("id, zimmer_id, gemeldet_am")
        .neq("status", "behoben"),
      supabase
        .from("unterkunft_vorgang")
        .select("zimmer_id, gesamtzustand")
        .eq("abgeschlossen", true)
        .eq("storniert", false)
        .order("abgeschlossen_am", { ascending: false }),
    ]);
    setZimmer((z.data as UnterkunftZimmerUebersicht[]) ?? []);
    setIntervalle(
      Object.fromEntries(
        ((ki.data as UnterkunftKontrollIntervall[]) ?? []).map((r) => [
          r.art,
          { gruen: r.gruen_bis_tage, gelb: r.gelb_bis_tage },
        ])
      )
    );
    setMaengel(
      (m.data as { id: number; zimmer_id: number; gemeldet_am: string }[]) ?? []
    );
    setVorgaenge(
      (v.data as { zimmer_id: number; gesamtzustand: string | null }[]) ?? []
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  const offeneMaengelProZimmer = useMemo(() => {
    const map: Record<number, { id: number; gemeldet_am: string }[]> = {};
    maengel.forEach((m) => {
      (map[m.zimmer_id] ??= []).push({ id: m.id, gemeldet_am: m.gemeldet_am });
    });
    return map;
  }, [maengel]);

  // Belegte + geplante Personen je Wohneinheit (für Allgemeinräume).
  const belegtProEinheit = useMemo(() => {
    const m: Record<number, number> = {};
    zimmer.forEach((z) => {
      if (z.wohneinheit_id != null)
        m[z.wohneinheit_id] =
          (m[z.wohneinheit_id] ?? 0) + z.belegt + z.schwebend;
    });
    return m;
  }, [zimmer]);

  const inNutzungVon = useCallback(
    (z: UnterkunftZimmerUebersicht): boolean => {
      if (z.art === "zimmer") return z.belegt > 0 || z.schwebend > 0;
      if (z.wohneinheit_id == null) return true;
      return (belegtProEinheit[z.wohneinheit_id] ?? 0) > 0;
    },
    [belegtProEinheit]
  );

  // Aufeinanderfolgende Kontrollen mit Ergebnis "alles in Ordnung"
  // (gesamtzustand = "gut"), von der jüngsten an gezählt.
  const sauberStreakProZimmer = useMemo(() => {
    const streak: Record<number, number> = {};
    const gebrochen = new Set<number>();
    for (const v of vorgaenge) {
      if (gebrochen.has(v.zimmer_id)) continue;
      if (v.gesamtzustand === "gut")
        streak[v.zimmer_id] = (streak[v.zimmer_id] ?? 0) + 1;
      else gebrochen.add(v.zimmer_id);
    }
    return streak;
  }, [vorgaenge]);

  // { frist, ampel } je Raum – Zeitzyklus, offene Mängel, Nutzung, Sauber-Serie.
  const infoVon = useCallback(
    (z: UnterkunftZimmerUebersicht) =>
      naechsteKontrolle({
        letzteKontrolleAm: z.letzte_kontrolle_am,
        schwellen: intervalle[z.art] ?? null,
        offeneMaengel: offeneMaengelProZimmer[z.zimmer_id] ?? [],
        inNutzung: inNutzungVon(z),
        sauberStreak: sauberStreakProZimmer[z.zimmer_id] ?? 0,
      }),
    [intervalle, offeneMaengelProZimmer, inNutzungVon, sauberStreakProZimmer]
  );
  const ampelVon = useCallback(
    (z: UnterkunftZimmerUebersicht): KontrollAmpel => infoVon(z).ampel,
    [infoVon]
  );
  // Für Rollup/Filter irrelevant: leerer Raum ohne offenen Mangel.
  const relevantVon = useCallback(
    (z: UnterkunftZimmerUebersicht): boolean =>
      inNutzungVon(z) ||
      (offeneMaengelProZimmer[z.zimmer_id]?.length ?? 0) > 0,
    [inNutzungVon, offeneMaengelProZimmer]
  );

  const gebaeudeListe = useMemo(
    () => Array.from(new Set(zimmer.map((z) => z.gebaeude_name))).sort(),
    [zimmer]
  );

  // Baum: Gebäude → Wohneinheit → Räume (bereits gefiltert/sortiert).
  const baum = useMemo(() => {
    const sichtbar = zimmer.filter((z) => {
      if (!z.aktiv && !zeigeInaktive) return false;
      if (gebaeudeFilter && z.gebaeude_name !== gebaeudeFilter) return false;
      if (nurFaellig && (ampelVon(z) === "gruen" || !relevantVon(z)))
        return false;
      return true;
    });
    type Node = {
      key: string;
      id: number;
      name: string;
      etage: string | null;
      raeume: UnterkunftZimmerUebersicht[];
    };
    const geb = new Map<
      number,
      { id: number; name: string; einheiten: Map<number, Node>; ohne: Node }
    >();
    for (const z of sichtbar) {
      let g = geb.get(z.gebaeude_id);
      if (!g) {
        g = {
          id: z.gebaeude_id,
          name: z.gebaeude_name,
          einheiten: new Map(),
          ohne: {
            key: `w:none:${z.gebaeude_id}`,
            id: -1,
            name: "Ohne Wohneinheit",
            etage: null,
            raeume: [],
          },
        };
        geb.set(z.gebaeude_id, g);
      }
      if (z.wohneinheit_id == null) {
        g.ohne.raeume.push(z);
      } else {
        let w = g.einheiten.get(z.wohneinheit_id);
        if (!w) {
          w = {
            key: `w:${z.wohneinheit_id}`,
            id: z.wohneinheit_id,
            name: z.wohneinheit_name ?? `Wohneinheit ${z.wohneinheit_id}`,
            etage: z.etage_label,
            raeume: [],
          };
          g.einheiten.set(z.wohneinheit_id, w);
        }
        w.raeume.push(z);
      }
    }
    const sortRaeume = (r: UnterkunftZimmerUebersicht[]) =>
      [...r].sort(
        (a, b) =>
          AMPEL_RANG[ampelVon(a)] - AMPEL_RANG[ampelVon(b)] ||
          a.nummer.localeCompare(b.nummer, "de", { numeric: true })
      );
    return [...geb.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => {
        const einheiten = [...g.einheiten.values()]
          .map((w) => ({ ...w, raeume: sortRaeume(w.raeume) }))
          .sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
        const ohne =
          g.ohne.raeume.length > 0
            ? { ...g.ohne, raeume: sortRaeume(g.ohne.raeume) }
            : null;
        return { ...g, einheiten, ohne };
      });
  }, [zimmer, gebaeudeFilter, nurFaellig, zeigeInaktive, ampelVon, relevantVon]);

  // Rollup-Zähler für einen Knoten. Leere Räume ohne Mangel zählen nicht mit.
  const rollup = useCallback(
    (raeume: UnterkunftZimmerUebersicht[]) => {
      let ueberfaellig = 0,
        baldFaellig = 0,
        ohneKontrolle = 0,
        maengel = 0,
        leer = 0;
      for (const r of raeume) {
        maengel += r.offene_maengel;
        if (!relevantVon(r)) {
          leer++;
          continue;
        }
        const a = ampelVon(r);
        if (a === "rot") ueberfaellig++;
        else if (a === "gelb") baldFaellig++;
        else if (a === "keine") ohneKontrolle++;
      }
      return { ueberfaellig, baldFaellig, ohneKontrolle, maengel, leer };
    },
    [ampelVon, relevantVon]
  );

  function toggle(key: string) {
    setZu((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function alle(einklappen: boolean) {
    if (!einklappen) {
      setZu(new Set());
      return;
    }
    const keys = new Set<string>();
    baum.forEach((g) => {
      keys.add(`g:${g.id}`);
      g.einheiten.forEach((w) => keys.add(w.key));
      if (g.ohne) keys.add(g.ohne.key);
    });
    setZu(keys);
  }

  function RollupBadges({
    r,
  }: {
    r: ReturnType<typeof rollup>;
  }) {
    if (
      r.ueberfaellig + r.baldFaellig + r.ohneKontrolle + r.maengel ===
      0
    ) {
      return (
        <span className="flex flex-wrap gap-1 text-xs">
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
            alles aktuell
          </span>
          {r.leer > 0 && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
              {r.leer} leer
            </span>
          )}
        </span>
      );
    }
    return (
      <span className="flex flex-wrap gap-1 text-xs">
        {r.ueberfaellig > 0 && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
            {r.ueberfaellig} überfällig
          </span>
        )}
        {r.ohneKontrolle > 0 && (
          <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-neutral-700">
            {r.ohneKontrolle} ohne Kontrolle
          </span>
        )}
        {r.baldFaellig > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
            {r.baldFaellig} bald fällig
          </span>
        )}
        {r.maengel > 0 && (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
            {r.maengel} Mängel
          </span>
        )}
        {r.leer > 0 && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
            {r.leer} leer
          </span>
        )}
      </span>
    );
  }

  function RaumZeile({ z }: { z: UnterkunftZimmerUebersicht }) {
    const { ampel: a, frist } = infoVon(z);
    const tage = tageHer(z.letzte_kontrolle_am);
    const heute = new Date().toISOString().slice(0, 10);
    const leer = !relevantVon(z); // nicht belegt UND kein offener Mangel
    const ueberfaellig = !leer && (frist == null || frist <= heute);
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-100 py-1.5 pl-6 text-sm first:border-t-0">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{
            backgroundColor: leer ? "#e5e5e5" : KONTROLL_AMPEL_FARBE[a],
          }}
          title={
            leer ? "Nicht belegt – keine Kontrolle fällig" : KONTROLL_AMPEL_LABELS[a]
          }
        />
        <span className="min-w-[6rem] font-medium">
          {raumName(z)}
          {!z.aktiv && (
            <span className="ml-1 text-xs font-normal text-red-500">inaktiv</span>
          )}
        </span>
        <span className="min-w-[12rem] text-neutral-600">
          {z.letzte_kontrolle_am ? (
            <>
              {formatDatumDE(z.letzte_kontrolle_am)}
              {z.letzte_kontrolle_typ
                ? ` · ${UNTERKUNFT_VORGANG_TYP_LABELS[z.letzte_kontrolle_typ]}`
                : ""}
              {tage != null && (
                <span className="text-neutral-400"> · vor {tage} T</span>
              )}
            </>
          ) : (
            <span className="text-neutral-500">noch keine Kontrolle</span>
          )}
        </span>
        {(() => {
          const mgl = offeneMaengelProZimmer[z.zimmer_id] ?? [];
          if (mgl.length === 0)
            return <span className="text-neutral-400">keine Mängel</span>;
          const href =
            mgl.length === 1
              ? `/unterkunft/maengel?mangel=${mgl[0].id}`
              : `/unterkunft/maengel?zimmer=${z.zimmer_id}`;
          return (
            <Link
              href={href}
              className="font-medium text-red-600 underline decoration-dotted underline-offset-2"
            >
              {mgl.length} {mgl.length === 1 ? "Mangel" : "Mängel"} öffnen
            </Link>
          );
        })()}
        <span
          className={`min-w-[13rem] ${
            leer
              ? "text-neutral-400"
              : ueberfaellig
                ? "font-medium text-red-600"
                : "text-neutral-600"
          }`}
        >
          {leer
            ? "nicht belegt – keine Kontrolle fällig"
            : `Kontrolle spätestens: ${
                frist == null ? "sofort" : formatDatumDE(frist)
              }`}
        </span>
        {z.gesperrt && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">
            🔒 gesperrt
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <Link
            href={`/unterkunft/kontrolle?zimmer=${z.zimmer_id}`}
            className="text-xs text-emerald-700 underline"
          >
            Kontrolle
          </Link>
          {z.offene_maengel > 0 && (
            <Link
              href={`/unterkunft/maengel?zimmer=${z.zimmer_id}`}
              className="text-xs text-emerald-700 underline"
            >
              Mängel
            </Link>
          )}
        </span>
      </div>
    );
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  return (
    <div className="space-y-4">
      <UnterkunftTabs />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">Kontrollplan</h1>
          <p className="max-w-3xl text-sm text-neutral-500">
            Gebäude → Wohneinheit → Raum · letzte Kontrolle, offene Mängel und
            spätester nächster Kontrolltermin. Zeitzyklus je Raumtyp aus den{" "}
            <Link href="/unterkunft/stammdaten" className="underline">
              Stammdaten
            </Link>
            . Offener Mangel: Kontrolle binnen 3 Tagen; bei einer Kontrolle
            nicht behoben: binnen 1 Tag. 2× in Folge „alles in Ordnung“ →
            14-Tage-Takt (bis wieder ein Mangel auftaucht). Leere Zimmer sind
            nicht kontrollpflichtig.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button className="btn-secondary" onClick={() => alle(false)}>
            Alle ausklappen
          </button>
          <button className="btn-secondary" onClick={() => alle(true)}>
            Alle einklappen
          </button>
          <label>
            Gebäude
            <select
              className="ml-2"
              value={gebaeudeFilter}
              onChange={(e) => setGebaeudeFilter(e.target.value)}
            >
              <option value="">alle</option>
              {gebaeudeListe.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={nurFaellig}
              onChange={(e) => setNurFaellig(e.target.checked)}
            />
            nur nicht-grün
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={zeigeInaktive}
              onChange={(e) => setZeigeInaktive(e.target.checked)}
            />
            inaktive zeigen
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        {(["gruen", "gelb", "rot", "keine"] as KontrollAmpel[]).map((a) => (
          <span key={a} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: KONTROLL_AMPEL_FARBE[a] }}
            />
            {KONTROLL_AMPEL_LABELS[a]}
          </span>
        ))}
      </div>

      {baum.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Keine Räume im Filter – oder noch keine Zimmer unter{" "}
          <Link href="/unterkunft/stammdaten" className="underline">
            Stammdaten
          </Link>{" "}
          angelegt.
        </p>
      ) : (
        <div className="space-y-2">
          {baum.map((g) => {
            const gAlle = [
              ...g.einheiten.flatMap((w) => w.raeume),
              ...(g.ohne?.raeume ?? []),
            ];
            const gZu = zu.has(`g:${g.id}`);
            return (
              <div key={g.id} className="rounded border border-neutral-200">
                <button
                  className="flex w-full flex-wrap items-center gap-2 bg-neutral-50 px-3 py-2 text-left"
                  onClick={() => toggle(`g:${g.id}`)}
                >
                  <span className="font-semibold text-emerald-900">
                    {gZu ? "▸" : "▾"} {g.name}
                  </span>
                  <span className="text-xs text-neutral-400">
                    ({gAlle.length} Räume)
                  </span>
                  <span className="ml-auto">
                    <RollupBadges r={rollup(gAlle)} />
                  </span>
                </button>

                {!gZu && (
                  <div className="space-y-2 p-2">
                    {g.einheiten.map((w) => {
                      const wZu = zu.has(w.key);
                      return (
                        <div
                          key={w.key}
                          className="rounded border border-neutral-200"
                        >
                          <button
                            className="flex w-full flex-wrap items-center gap-2 px-3 py-1.5 text-left"
                            onClick={() => toggle(w.key)}
                          >
                            <span className="font-medium text-neutral-800">
                              {wZu ? "▸" : "▾"} {w.name}
                              {w.etage ? (
                                <span className="text-neutral-400">
                                  {" "}
                                  · {w.etage}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-xs text-neutral-400">
                              ({w.raeume.length})
                            </span>
                            <span className="ml-auto flex items-center gap-2">
                              <RollupBadges r={rollup(w.raeume)} />
                              <Link
                                href={`/unterkunft/kontrolle?wohneinheit=${w.id}`}
                                className="text-xs text-emerald-700 underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                kontrollieren
                              </Link>
                            </span>
                          </button>
                          {!wZu && (
                            <div className="px-2 pb-1">
                              {w.raeume.map((z) => (
                                <RaumZeile key={z.zimmer_id} z={z} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {g.ohne && (
                      <div className="rounded border border-neutral-200">
                        <button
                          className="flex w-full flex-wrap items-center gap-2 px-3 py-1.5 text-left"
                          onClick={() => toggle(g.ohne!.key)}
                        >
                          <span className="font-medium text-neutral-500">
                            {zu.has(g.ohne.key) ? "▸" : "▾"} {g.ohne.name}
                          </span>
                          <span className="text-xs text-neutral-400">
                            ({g.ohne.raeume.length})
                          </span>
                          <span className="ml-auto">
                            <RollupBadges r={rollup(g.ohne.raeume)} />
                          </span>
                        </button>
                        {!zu.has(g.ohne.key) && (
                          <div className="px-2 pb-1">
                            {g.ohne.raeume.map((z) => (
                              <RaumZeile key={z.zimmer_id} z={z} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
