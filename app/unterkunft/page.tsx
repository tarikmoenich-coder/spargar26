"use client";

// Unterkunft → Grundriss (Migration 2026-08-30, Wohneinheiten 2026-08-31):
// Einstiegsseite. Gebäude wählen → Etage-Umschalter → Wohneinheit-Karten
// (Betten · fest · schwebend · frei · Herkunfts-Mix). Karte antippen →
// Zimmer-Raster der Wohneinheit + Liste „noch offen" (schwebende Personen
// ohne Übergabe). Zimmer antippen → Panel mit Bewohnern/Kontrolle/Mängeln
// und „Übergabe starten" (deep link mit ?zimmer=).
//
// Zimmer im Raster platzieren/verschieben: nur admin.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import { formatDatumDE } from "@/lib/format";
import {
  GRUNDRISS_ZELLE as Z,
  KONTROLL_AMPEL_FARBE,
  KONTROLL_AMPEL_LABELS,
  herkunftMix,
  kontrollAmpel,
} from "@/lib/unterkunft";
import {
  UNTERKUNFT_VORGANG_TYP_LABELS,
  type UnterkunftBelegungAktuell,
  type UnterkunftGebaeude,
  type UnterkunftWohneinheitUebersicht,
  type UnterkunftZimmerUebersicht,
  type UnterkunftZuordnungOffen,
} from "@/lib/types";

const MIN_COLS = 14;
const MIN_ROWS = 10;

interface DragState {
  zimmerId: number;
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  aktX: number;
  aktY: number;
}

export default function UnterkunftGrundrissPage() {
  const { profile } = useProfile();
  const canEditPlan = profile?.role === "admin";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [einheiten, setEinheiten] = useState<UnterkunftWohneinheitUebersicht[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmerUebersicht[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegungAktuell[]>([]);
  const [zuordnungen, setZuordnungen] = useState<UnterkunftZuordnungOffen[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [gebaeudeId, setGebaeudeId] = useState<number | null>(null);
  const [etageFilter, setEtageFilter] = useState<string>("");
  const [einheitId, setEinheitId] = useState<number | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragState | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, e, z, b, zu] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").order("name"),
      supabase
        .from("unterkunft_wohneinheit_uebersicht")
        .select("*")
        .order("reihenfolge"),
      supabase.from("unterkunft_zimmer_uebersicht").select("*").order("nummer"),
      supabase.from("unterkunft_belegung_aktuell").select("*"),
      supabase.from("unterkunft_zuordnung_offen").select("*"),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setEinheiten((e.data as UnterkunftWohneinheitUebersicht[]) ?? []);
    setZimmer((z.data as UnterkunftZimmerUebersicht[]) ?? []);
    setBelegungen((b.data as UnterkunftBelegungAktuell[]) ?? []);
    setZuordnungen((zu.data as UnterkunftZuordnungOffen[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  useEffect(() => {
    if (gebaeude.length === 0) return;
    if (gebaeudeId == null || !gebaeude.some((g) => g.id === gebaeudeId)) {
      setGebaeudeId(gebaeude[0].id);
    }
  }, [gebaeude, gebaeudeId]);

  const einheitenDesGebaeudes = useMemo(
    () => einheiten.filter((e) => e.gebaeude_id === gebaeudeId && e.aktiv),
    [einheiten, gebaeudeId]
  );

  const etagen = useMemo(() => {
    const s = new Set<string>();
    einheitenDesGebaeudes.forEach((e) => {
      if (e.etage_label) s.add(e.etage_label);
    });
    return [...s].sort();
  }, [einheitenDesGebaeudes]);

  const gefilterteEinheiten = etageFilter
    ? einheitenDesGebaeudes.filter((e) => e.etage_label === etageFilter)
    : einheitenDesGebaeudes;

  const einheit =
    einheitId != null
      ? einheiten.find((e) => e.wohneinheit_id === einheitId) ?? null
      : null;

  // Inaktive Zimmer werden im Grundriss nur im Bearbeiten-Modus gezeigt
  // (sonst nicht mehr im Weg).
  const zimmerDerEinheit = useMemo(
    () =>
      zimmer.filter(
        (z) => z.wohneinheit_id === einheitId && (z.aktiv || bearbeiten)
      ),
    [zimmer, einheitId, bearbeiten]
  );
  const platziert = zimmerDerEinheit.filter(
    (z) => z.plan_x != null && z.plan_y != null
  );
  const ablage = zimmerDerEinheit.filter(
    (z) => z.plan_x == null || z.plan_y == null
  );

  const belegungProZimmer = useMemo(() => {
    const map: Record<number, UnterkunftBelegungAktuell[]> = {};
    belegungen.forEach((b) => {
      (map[b.zimmer_id] ??= []).push(b);
    });
    return map;
  }, [belegungen]);

  const zuordnungProZimmer = useMemo(() => {
    const map: Record<number, UnterkunftZuordnungOffen[]> = {};
    zuordnungen.forEach((z) => {
      if (z.zimmer_id != null) (map[z.zimmer_id] ??= []).push(z);
    });
    return map;
  }, [zuordnungen]);

  const zuordnungDerEinheit = useMemo(
    () => zuordnungen.filter((z) => z.wohneinheit_id === einheitId),
    [zuordnungen, einheitId]
  );

  // Zur Orientierung: platzierte Zimmer der ANDEREN Wohneinheiten derselben
  // Etage (gleiches Gebäude, gleiches etage_label) - ausgegraut, nicht
  // anklickbar. Nur wenn die Wohneinheit ein Etage-Label trägt.
  const nachbarZimmer = useMemo(() => {
    if (!einheit || !einheit.etage_label) return [];
    const sibIds = new Set(
      einheiten
        .filter(
          (e) =>
            e.gebaeude_id === einheit.gebaeude_id &&
            e.etage_label === einheit.etage_label &&
            e.wohneinheit_id !== einheit.wohneinheit_id
        )
        .map((e) => e.wohneinheit_id)
    );
    return zimmer.filter(
      (z) =>
        z.wohneinheit_id != null &&
        sibIds.has(z.wohneinheit_id) &&
        z.plan_x != null &&
        z.plan_y != null &&
        z.aktiv
    );
  }, [einheit, einheiten, zimmer]);

  const rasterZimmer = [...platziert, ...nachbarZimmer];
  const cols = Math.max(
    MIN_COLS,
    ...rasterZimmer.map((z) => (z.plan_x ?? 0) + z.plan_w + 1)
  );
  const rows = Math.max(
    MIN_ROWS,
    ...rasterZimmer.map((z) => (z.plan_y ?? 0) + z.plan_h + 1)
  );

  const sel =
    selId != null ? zimmer.find((z) => z.zimmer_id === selId) ?? null : null;

  const speicherePlan = useCallback(
    async (
      zimmerId: number,
      patch: Partial<
        Pick<UnterkunftZimmerUebersicht, "plan_x" | "plan_y" | "plan_w" | "plan_h">
      >
    ) => {
      setZimmer((prev) =>
        prev.map((z) => (z.zimmer_id === zimmerId ? { ...z, ...patch } : z))
      );
      const { error } = await getSupabaseClient()
        .from("unterkunft_zimmer")
        .update({ ...patch, updated_by: profile?.id ?? null })
        .eq("id", zimmerId);
      if (error) {
        setFehler(error.message);
        laden();
      } else {
        setFehler(null);
      }
    },
    [profile?.id, laden]
  );

  function freieZelle(): { x: number; y: number } {
    const belegt = new Set(
      rasterZimmer.flatMap((z) => {
        const cells: string[] = [];
        for (let x = z.plan_x!; x < z.plan_x! + z.plan_w; x++)
          for (let y = z.plan_y!; y < z.plan_y! + z.plan_h; y++)
            cells.push(`${x},${y}`);
        return cells;
      })
    );
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if (!belegt.has(`${x},${y}`)) return { x, y };
    return { x: 0, y: 0 };
  }

  function platziereAusAblage(zimmerId: number) {
    const ziel = freieZelle();
    speicherePlan(zimmerId, { plan_x: ziel.x, plan_y: ziel.y });
    setSelId(zimmerId);
  }

  // Küche / Bad/WC / Flur als Gemeinschaftsraum anlegen und direkt auf eine
  // freie Rasterzelle legen. Keine Betten, keine Belegung/Übergabe -
  // Kontrollen und Mängel gelten aber.
  async function gemeinschaftHinzufuegen(label: string) {
    if (!einheitId || gebaeudeId == null) return;
    const vorhanden = new Set(
      zimmer.filter((z) => z.gebaeude_id === gebaeudeId).map((z) => z.nummer)
    );
    let name = label;
    let i = 2;
    while (vorhanden.has(name)) name = `${label} ${i++}`;
    const ziel = freieZelle();
    const { data, error } = await getSupabaseClient()
      .from("unterkunft_zimmer")
      .insert({
        gebaeude_id: gebaeudeId,
        wohneinheit_id: einheitId,
        nummer: name,
        art: "gemeinschaft",
        plan_x: ziel.x,
        plan_y: ziel.y,
        plan_w: 2,
        plan_h: 2,
      })
      .select("id")
      .single();
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
    setSelId((data as { id: number }).id);
  }

  async function zimmerLoeschen(z: UnterkunftZimmerUebersicht) {
    if (
      !window.confirm(
        `„${z.nummer}" endgültig löschen – samt evtl. Kontrollen und Mängeln?`
      )
    )
      return;
    const sb = getSupabaseClient();
    // Abgeschlossene Vorgänge sind trigger-geschützt: als Admin erst „öffnen",
    // dann löschen (kaskadiert Positionen + Fotos), dann die Mängel.
    const { data: vg } = await sb
      .from("unterkunft_vorgang")
      .select("id, abgeschlossen")
      .eq("zimmer_id", z.zimmer_id);
    const abg = ((vg as { id: string; abgeschlossen: boolean }[]) ?? [])
      .filter((v) => v.abgeschlossen)
      .map((v) => v.id);
    if (abg.length) {
      const { error } = await sb
        .from("unterkunft_vorgang")
        .update({ abgeschlossen: false })
        .in("id", abg);
      if (error) {
        setFehler(error.message);
        return;
      }
    }
    for (const t of ["unterkunft_vorgang", "unterkunft_mangel"] as const) {
      const { error } = await sb.from(t).delete().eq("zimmer_id", z.zimmer_id);
      if (error) {
        setFehler(error.message);
        return;
      }
    }
    const { error } = await sb
      .from("unterkunft_zimmer")
      .delete()
      .eq("id", z.zimmer_id);
    if (error) {
      setFehler(error.message);
      return;
    }
    setSelId(null);
    await laden();
  }

  function onZimmerPointerDown(
    e: React.PointerEvent,
    z: UnterkunftZimmerUebersicht
  ) {
    setSelId(z.zimmer_id);
    if (!bearbeiten || !canEditPlan || e.button !== 0) return;
    if (z.plan_x == null || z.plan_y == null) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({
      zimmerId: z.zimmer_id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: z.plan_x,
      origY: z.plan_y,
      aktX: z.plan_x,
      aktY: z.plan_y,
    });
  }

  function onZimmerPointerMove(
    e: React.PointerEvent,
    z: UnterkunftZimmerUebersicht
  ) {
    if (!drag || drag.zimmerId !== z.zimmer_id) return;
    const pxProZelle = Z * zoom;
    const dx = Math.round((e.clientX - drag.startX) / pxProZelle);
    const dy = Math.round((e.clientY - drag.startY) / pxProZelle);
    const nx = Math.max(0, Math.min(cols - z.plan_w, drag.origX + dx));
    const ny = Math.max(0, Math.min(rows - z.plan_h, drag.origY + dy));
    if (nx !== drag.aktX || ny !== drag.aktY) {
      setDrag({ ...drag, aktX: nx, aktY: ny });
    }
  }

  function onZimmerPointerUp(
    e: React.PointerEvent,
    z: UnterkunftZimmerUebersicht
  ) {
    if (!drag || drag.zimmerId !== z.zimmer_id) return;
    (e.currentTarget as Element).releasePointerCapture(drag.pointerId);
    const { aktX, aktY, origX, origY } = drag;
    setDrag(null);
    if (aktX !== origX || aktY !== origY) {
      speicherePlan(z.zimmer_id, { plan_x: aktX, plan_y: aktY });
    }
  }

  function onWrapKeyDown(e: React.KeyboardEvent) {
    if (!bearbeiten || !canEditPlan || !sel) return;
    if (sel.plan_x == null || sel.plan_y == null) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const s = step[e.key];
    if (!s) return;
    e.preventDefault();
    const nx = Math.max(0, Math.min(cols - sel.plan_w, sel.plan_x + s[0]));
    const ny = Math.max(0, Math.min(rows - sel.plan_h, sel.plan_y + s[1]));
    if (nx !== sel.plan_x || ny !== sel.plan_y) {
      speicherePlan(sel.zimmer_id, { plan_x: nx, plan_y: ny });
    }
  }

  function zimmerFarbe(z: UnterkunftZimmerUebersicht): {
    fill: string;
    stroke: string;
  } {
    if (!z.aktiv) return { fill: "#fafafa", stroke: "#e5e5e5" };
    if (z.offene_maengel > 0) return { fill: "#fef2f2", stroke: "#dc2626" };
    if (z.art === "gemeinschaft") return { fill: "#eef2ff", stroke: "#a5b4fc" };
    if (z.frei > 0) return { fill: "#ecfdf5", stroke: "#34d399" };
    return { fill: "#f1f5f9", stroke: "#cbd5e1" };
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  return (
    <div className="space-y-4">
      <UnterkunftTabs />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">Grundriss</h1>
          <p className="text-sm text-neutral-500">
            Wohneinheit antippen für Zimmer &amp; Übergaben.
          </p>
        </div>
        <label className="text-sm">
          Gebäude
          <select
            className="ml-2"
            value={gebaeudeId ?? ""}
            onChange={(e) => {
              setGebaeudeId(Number(e.target.value));
              setEinheitId(null);
              setSelId(null);
              setEtageFilter("");
            }}
          >
            {gebaeude.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {!g.aktiv ? " (inaktiv)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {fehler && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}

      {/* Etage-Umschalter */}
      {etagen.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {["", ...etagen].map((et) => (
            <button
              key={et || "alle"}
              onClick={() => {
                setEtageFilter(et);
                setEinheitId(null);
                setSelId(null);
              }}
              className={`rounded-full border px-3 py-1 text-sm ${
                et === etageFilter
                  ? "border-emerald-700 bg-emerald-700 font-semibold text-white"
                  : "border-neutral-300 text-neutral-600 hover:border-emerald-400"
              }`}
            >
              {et || "Alle"}
            </button>
          ))}
        </div>
      )}

      {einheitenDesGebaeudes.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Für dieses Gebäude sind noch keine Wohneinheiten angelegt – unter{" "}
          <Link href="/unterkunft/stammdaten" className="text-emerald-700 underline">
            Stammdaten
          </Link>{" "}
          beginnen.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {gefilterteEinheiten.map((e) => {
            const personen = [
              ...belegungen.filter((b) => b.wohneinheit_id === e.wohneinheit_id),
              ...zuordnungen.filter((z) => z.wohneinheit_id === e.wohneinheit_id),
            ];
            const aktiv = e.wohneinheit_id === einheitId;
            return (
              <button
                key={e.wohneinheit_id}
                onClick={() => {
                  setEinheitId(aktiv ? null : e.wohneinheit_id);
                  setSelId(null);
                }}
                className={`rounded border p-3 text-left ${
                  aktiv
                    ? "border-emerald-700 ring-1 ring-emerald-700"
                    : "border-neutral-200 hover:border-emerald-400"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-emerald-900">{e.name}</span>
                  {e.etage_label && (
                    <span className="text-xs text-neutral-500">{e.etage_label}</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                  <span>{e.betten} Betten</span>
                  <span className="text-emerald-700">{e.fest} fest</span>
                  <span className="text-amber-700">{e.schwebend} schwebend</span>
                  <span className={e.frei > 0 ? "text-emerald-700" : "text-neutral-400"}>
                    {e.frei} frei
                  </span>
                </div>
                {personen.length > 0 && (
                  <div className="mt-1 text-xs text-neutral-500">
                    {herkunftMix(personen)}
                  </div>
                )}
                {e.schwebend > 0 && (
                  <div className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                    {e.schwebend} Übergabe(n) offen
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Wohneinheit-Detail: Zimmer-Raster + offene Personen */}
      {einheit && (
        <div className="space-y-3 rounded border border-neutral-200 p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-emerald-900">
                {einheit.name}
                {einheit.etage_label ? ` · ${einheit.etage_label}` : ""} — Zimmer
              </h2>
              {nachbarZimmer.length > 0 && (
                <p className="text-xs text-neutral-400">
                  Graue Kacheln = andere Wohneinheiten der Etage{" "}
                  {einheit.etage_label} (nur zur Orientierung).
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex items-center gap-1">
                <button
                  className="btn-secondary"
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  title="Verkleinern"
                >
                  −
                </button>
                <span className="w-10 text-center tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  className="btn-secondary"
                  onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
                  title="Vergrößern"
                >
                  +
                </button>
              </div>
              {canEditPlan && (
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={bearbeiten}
                    onChange={(e) => setBearbeiten(e.target.checked)}
                  />
                  Bearbeiten
                </label>
              )}
            </div>
          </div>

          {zimmerDerEinheit.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Noch keine Zimmer in dieser Wohneinheit – unter{" "}
              <Link
                href="/unterkunft/stammdaten"
                className="text-emerald-700 underline"
              >
                Stammdaten
              </Link>{" "}
              anlegen.
            </p>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row">
              <div
                tabIndex={0}
                onKeyDown={onWrapKeyDown}
                className="max-w-full flex-1 overflow-auto rounded border border-neutral-200 bg-white p-2 outline-none"
              >
                <svg
                  width={cols * Z * zoom}
                  height={rows * Z * zoom}
                  viewBox={`0 0 ${cols * Z} ${rows * Z}`}
                  className="block"
                  style={{ touchAction: bearbeiten ? "none" : "auto" }}
                >
                  <defs>
                    <pattern
                      id="raster"
                      width={Z}
                      height={Z}
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d={`M ${Z} 0 L 0 0 0 ${Z}`}
                        fill="none"
                        stroke="#f0f0f0"
                        strokeWidth={1}
                      />
                    </pattern>
                  </defs>
                  <rect width={cols * Z} height={rows * Z} fill="url(#raster)" />

                  {/* Nachbar-Wohneinheiten derselben Etage - nur Orientierung */}
                  {nachbarZimmer.map((z) => (
                    <g
                      key={`nachbar-${z.zimmer_id}`}
                      transform={`translate(${z.plan_x! * Z} ${z.plan_y! * Z})`}
                      style={{ pointerEvents: "none" }}
                      opacity={0.4}
                    >
                      <rect
                        width={z.plan_w * Z}
                        height={z.plan_h * Z}
                        rx={5}
                        fill="#f5f5f5"
                        stroke="#cbd5e1"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      <text
                        x={(z.plan_w * Z) / 2}
                        y={(z.plan_h * Z) / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="select-none"
                        fontSize={11}
                        fill="#94a3b8"
                      >
                        {z.nummer}
                      </text>
                      <text
                        x={(z.plan_w * Z) / 2}
                        y={z.plan_h * Z - 5}
                        textAnchor="middle"
                        className="select-none"
                        fontSize={8}
                        fill="#94a3b8"
                      >
                        {einheiten.find((e) => e.wohneinheit_id === z.wohneinheit_id)
                          ?.name ?? ""}
                      </text>
                    </g>
                  ))}

                  {platziert.map((z) => {
                    const wirdGezogen = drag?.zimmerId === z.zimmer_id;
                    const px = (wirdGezogen ? drag!.aktX : z.plan_x!) * Z;
                    const py = (wirdGezogen ? drag!.aktY : z.plan_y!) * Z;
                    const w = z.plan_w * Z;
                    const h = z.plan_h * Z;
                    const { fill, stroke } = zimmerFarbe(z);
                    const ausgewaehlt = z.zimmer_id === selId;
                    const ampel = kontrollAmpel(z.letzte_kontrolle_am);
                    const schwebendHier =
                      (zuordnungProZimmer[z.zimmer_id] ?? []).length;
                    return (
                      <g
                        key={z.zimmer_id}
                        transform={`translate(${px} ${py})`}
                        onPointerDown={(e) => onZimmerPointerDown(e, z)}
                        onPointerMove={(e) => onZimmerPointerMove(e, z)}
                        onPointerUp={(e) => onZimmerPointerUp(e, z)}
                        style={{
                          cursor: bearbeiten && canEditPlan ? "move" : "pointer",
                        }}
                      >
                        <rect
                          width={w}
                          height={h}
                          rx={5}
                          fill={fill}
                          stroke={ausgewaehlt ? "#047857" : stroke}
                          strokeWidth={
                            ausgewaehlt ? 3 : z.offene_maengel > 0 ? 2 : 1.5
                          }
                          strokeDasharray={z.aktiv ? undefined : "4 3"}
                        />
                        <text
                          x={w / 2}
                          y={h / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="select-none"
                          fontSize={Math.min(15, h / 2.2)}
                          fontWeight={600}
                          fill={z.aktiv ? "#0f172a" : "#a3a3a3"}
                        >
                          {z.nummer}
                        </text>
                        {z.art !== "gemeinschaft" && (
                          <text
                            x={w / 2}
                            y={h - 6}
                            textAnchor="middle"
                            className="select-none"
                            fontSize={10}
                            fill="#64748b"
                          >
                            {z.belegt}/{z.betten}
                            {schwebendHier > 0 ? ` +${schwebendHier}` : ""}
                          </text>
                        )}
                        <circle
                          cx={w - 9}
                          cy={9}
                          r={5}
                          fill={KONTROLL_AMPEL_FARBE[ampel]}
                          stroke="#fff"
                          strokeWidth={1.5}
                        />
                        {z.offene_maengel > 0 && (
                          <text
                            x={7}
                            y={13}
                            fontSize={10}
                            fontWeight={700}
                            fill="#dc2626"
                            className="select-none"
                          >
                            {z.offene_maengel} M
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="w-full shrink-0 space-y-4 lg:w-80">
                {/* noch offen (schwebende Personen dieser Wohneinheit) */}
                <div className="rounded border border-neutral-200 p-3">
                  <h3 className="text-sm font-semibold text-neutral-800">
                    Noch offen ({zuordnungDerEinheit.length})
                  </h3>
                  {zuordnungDerEinheit.length === 0 ? (
                    <p className="mt-1 text-sm text-neutral-400">
                      keine schwebenden Zuordnungen.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {zuordnungDerEinheit.map((z) => (
                        <li key={z.id} className="flex justify-between gap-2">
                          <span>
                            {z.vorname} {z.name}
                            {z.herkunft ? (
                              <span className="text-neutral-400"> · {z.herkunft}</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-neutral-500">
                            {z.zimmer_nummer
                              ? `Zi. ${z.zimmer_nummer}`
                              : "kein Zimmer"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {bearbeiten && canEditPlan && (
                  <div className="rounded border border-neutral-200 p-3">
                    <h3 className="text-sm font-semibold text-neutral-800">
                      Nicht platziert ({ablage.length})
                    </h3>
                    {ablage.length === 0 ? (
                      <p className="mt-1 text-sm text-neutral-400">
                        alle Zimmer liegen im Raster.
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ablage.map((z) => (
                          <button
                            key={z.zimmer_id}
                            onClick={() => platziereAusAblage(z.zimmer_id)}
                            className="rounded border border-neutral-300 px-2 py-0.5 text-sm hover:border-emerald-500"
                          >
                            {z.nummer}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-neutral-400">
                      Zimmer ziehen · Pfeiltasten für Feinjustage.
                    </p>
                    <div className="mt-2 border-t border-neutral-100 pt-2">
                      <div className="text-xs font-medium text-neutral-500">
                        Gemeinschaftsraum hinzufügen
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {["Küche", "Bad/WC", "Flur"].map((label) => (
                          <button
                            key={label}
                            onClick={() => gemeinschaftHinzufuegen(label)}
                            className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-sm text-indigo-800 hover:border-indigo-500"
                          >
                            + {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {sel && sel.wohneinheit_id === einheitId ? (
                  <div className="rounded border border-neutral-200 p-3">
                    <h3 className="text-base font-semibold text-emerald-900">
                      {sel.art === "gemeinschaft"
                        ? sel.nummer
                        : `Zimmer ${sel.nummer}`}
                    </h3>
                    {!sel.aktiv && <p className="text-xs text-red-600">inaktiv</p>}

                    <dl className="mt-2 space-y-1 text-sm">
                      {sel.art === "zimmer" && (
                        <div className="flex justify-between">
                          <dt className="text-neutral-500">Betten</dt>
                          <dd>
                            {sel.belegt} / {sel.betten} ·{" "}
                            <span
                              className={
                                sel.frei > 0
                                  ? "font-medium text-emerald-700"
                                  : ""
                              }
                            >
                              {sel.frei} frei
                            </span>
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <dt className="text-neutral-500">Letzte Kontrolle</dt>
                        <dd className="text-right">
                          {sel.letzte_kontrolle_am ? (
                            <>
                              {formatDatumDE(sel.letzte_kontrolle_am)}
                              {sel.letzte_kontrolle_typ
                                ? ` · ${UNTERKUNFT_VORGANG_TYP_LABELS[sel.letzte_kontrolle_typ]}`
                                : ""}
                            </>
                          ) : (
                            "noch keine"
                          )}
                          <span
                            className="ml-1 inline-block h-2.5 w-2.5 rounded-full align-middle"
                            style={{
                              backgroundColor:
                                KONTROLL_AMPEL_FARBE[
                                  kontrollAmpel(sel.letzte_kontrolle_am)
                                ],
                            }}
                            title={
                              KONTROLL_AMPEL_LABELS[
                                kontrollAmpel(sel.letzte_kontrolle_am)
                              ]
                            }
                          />
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-neutral-500">Offene Mängel</dt>
                        <dd
                          className={
                            sel.offene_maengel > 0
                              ? "font-medium text-red-600"
                              : ""
                          }
                        >
                          {sel.offene_maengel > 0 ? sel.offene_maengel : "—"}
                        </dd>
                      </div>
                    </dl>

                    {sel.art === "zimmer" && (
                      <>
                        <div className="mt-3">
                          <div className="text-xs font-medium text-neutral-500">
                            Bewohner heute
                          </div>
                          {(belegungProZimmer[sel.zimmer_id] ?? []).length ===
                          0 ? (
                            <p className="text-sm text-neutral-400">niemand</p>
                          ) : (
                            <ul className="mt-1 space-y-0.5 text-sm">
                              {(belegungProZimmer[sel.zimmer_id] ?? []).map(
                                (b) => (
                                  <li key={b.id}>
                                    {b.vorname} {b.name}
                                    {b.herkunft ? (
                                      <span className="text-neutral-400">
                                        {" "}
                                        · {b.herkunft}
                                      </span>
                                    ) : null}
                                  </li>
                                )
                              )}
                            </ul>
                          )}
                        </div>

                        {(zuordnungProZimmer[sel.zimmer_id] ?? []).length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs font-medium text-neutral-500">
                              Geplant (schwebend)
                            </div>
                            <ul className="mt-1 space-y-0.5 text-sm">
                              {(zuordnungProZimmer[sel.zimmer_id] ?? []).map(
                                (z) => (
                                  <li key={z.id} className="text-amber-800">
                                    {z.vorname} {z.name}
                                  </li>
                                )
                              )}
                            </ul>
                          </div>
                        )}
                      </>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                      {sel.art === "zimmer" && (
                        <Link
                          className="btn"
                          href={`/unterkunft/uebergabe?zimmer=${sel.zimmer_id}`}
                        >
                          Übergabe starten
                        </Link>
                      )}
                      <Link
                        className="btn-secondary"
                        href={`/unterkunft/kontrolle?zimmer=${sel.zimmer_id}`}
                      >
                        Kontrolle
                      </Link>
                      <Link className="btn-secondary" href="/unterkunft/maengel">
                        Mängel
                      </Link>
                    </div>

                    {bearbeiten && canEditPlan && sel.plan_x != null && (
                      <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-neutral-500">Breite</span>
                          <button
                            className="btn-secondary"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_w: Math.max(1, sel.plan_w - 1),
                              })
                            }
                          >
                            −
                          </button>
                          <span className="w-5 text-center tabular-nums">
                            {sel.plan_w}
                          </span>
                          <button
                            className="btn-secondary"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_w: sel.plan_w + 1,
                              })
                            }
                          >
                            +
                          </button>
                          <span className="ml-2 text-neutral-500">Höhe</span>
                          <button
                            className="btn-secondary"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_h: Math.max(1, sel.plan_h - 1),
                              })
                            }
                          >
                            −
                          </button>
                          <span className="w-5 text-center tabular-nums">
                            {sel.plan_h}
                          </span>
                          <button
                            className="btn-secondary"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_h: sel.plan_h + 1,
                              })
                            }
                          >
                            +
                          </button>
                        </div>
                        <div className="flex gap-3">
                          <button
                            className="text-xs text-red-600 hover:underline"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_x: null,
                                plan_y: null,
                              })
                            }
                          >
                            vom Raster nehmen
                          </button>
                          {sel.art === "gemeinschaft" && (
                            <button
                              className="text-xs text-red-600 hover:underline"
                              onClick={() => zimmerLoeschen(sel)}
                            >
                              Löschen
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-neutral-200 p-3 text-sm text-neutral-400">
                    Kein Zimmer ausgewählt.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
