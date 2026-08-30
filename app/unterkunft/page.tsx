"use client";

// Unterkunft → Grundriss (Migration 2026-08-30): Einstiegsseite des Moduls.
// Zweite Planungsebene neben der Gebäudeliste - je Stockwerk ein schematischer
// Grundriss, in dem die Zimmer als anklickbare Kacheln auf einem Raster
// liegen. Klick auf ein Zimmer öffnet rechts ein Panel (Bewohner, freie
// Betten, letzte Kontrolle mit Ampel, offene Mängel) samt Sprung in die
// Arbeits-Tabs.
//
// Platzieren/Verschieben der Zimmer nur für admin (Nutzer-Vorgabe
// 2026-08-30) - die Rasterkoordinaten liegen auf unterkunft_zimmer
// (plan_x/plan_y/plan_w/plan_h).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import { formatDatumDE } from "@/lib/format";
import {
  GRUNDRISS_ZELLE as Z,
  KONTROLL_AMPEL_FARBE,
  KONTROLL_AMPEL_LABELS,
  kontrollAmpel,
} from "@/lib/unterkunft";
import {
  UNTERKUNFT_VORGANG_TYP_LABELS,
  type UnterkunftBelegungAktuell,
  type UnterkunftEtage,
  type UnterkunftGebaeude,
  type UnterkunftZimmerUebersicht,
} from "@/lib/types";

// Sichtbares Raster (Zellen), unabhängig von der tatsächlichen Belegung -
// wird erweitert, sobald ein Zimmer weiter außen liegt.
const MIN_COLS = 16;
const MIN_ROWS = 12;

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
  const [etagen, setEtagen] = useState<UnterkunftEtage[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmerUebersicht[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegungAktuell[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [gebaeudeId, setGebaeudeId] = useState<number | null>(null);
  const [etageId, setEtageId] = useState<number | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragState | null>(null);

  const svgWrapRef = useRef<HTMLDivElement>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, e, z, b] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").order("name"),
      supabase
        .from("unterkunft_etage")
        .select("*")
        .order("gebaeude_id")
        .order("reihenfolge"),
      supabase.from("unterkunft_zimmer_uebersicht").select("*").order("nummer"),
      supabase.from("unterkunft_belegung_aktuell").select("*"),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setEtagen((e.data as UnterkunftEtage[]) ?? []);
    setZimmer((z.data as UnterkunftZimmerUebersicht[]) ?? []);
    setBelegungen((b.data as UnterkunftBelegungAktuell[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  // Erstes Gebäude / erste Etage vorwählen, sobald geladen bzw. nach einem
  // Wechsel eine ungültige Auswahl korrigieren.
  useEffect(() => {
    if (gebaeude.length === 0) return;
    if (gebaeudeId == null || !gebaeude.some((g) => g.id === gebaeudeId)) {
      setGebaeudeId(gebaeude[0].id);
    }
  }, [gebaeude, gebaeudeId]);

  const etagenDesGebaeudes = useMemo(
    () => etagen.filter((e) => e.gebaeude_id === gebaeudeId),
    [etagen, gebaeudeId]
  );

  useEffect(() => {
    if (etagenDesGebaeudes.length === 0) {
      setEtageId(null);
      return;
    }
    if (etageId == null || !etagenDesGebaeudes.some((e) => e.id === etageId)) {
      setEtageId(etagenDesGebaeudes[0].id);
    }
  }, [etagenDesGebaeudes, etageId]);

  const zimmerDerEtage = useMemo(
    () => zimmer.filter((z) => z.etage_id === etageId),
    [zimmer, etageId]
  );
  const platziert = zimmerDerEtage.filter(
    (z) => z.plan_x != null && z.plan_y != null
  );
  const ablage = zimmerDerEtage.filter(
    (z) => z.plan_x == null || z.plan_y == null
  );

  const belegungProZimmer = useMemo(() => {
    const map: Record<number, UnterkunftBelegungAktuell[]> = {};
    belegungen.forEach((b) => {
      (map[b.zimmer_id] ??= []).push(b);
    });
    return map;
  }, [belegungen]);

  const cols = Math.max(
    MIN_COLS,
    ...platziert.map((z) => (z.plan_x ?? 0) + z.plan_w + 1)
  );
  const rows = Math.max(
    MIN_ROWS,
    ...platziert.map((z) => (z.plan_y ?? 0) + z.plan_h + 1)
  );

  const sel = selId != null ? zimmer.find((z) => z.zimmer_id === selId) ?? null : null;

  // --- Speichern der Grundriss-Koordinaten -------------------------------
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

  function platziereAusAblage(zimmerId: number) {
    // Erste freie Rasterzelle (grob) suchen, sonst 0/0.
    const belegt = new Set(
      platziert.flatMap((z) => {
        const cells: string[] = [];
        for (let x = z.plan_x!; x < z.plan_x! + z.plan_w; x++)
          for (let y = z.plan_y!; y < z.plan_y! + z.plan_h; y++)
            cells.push(`${x},${y}`);
        return cells;
      })
    );
    let ziel = { x: 0, y: 0 };
    outer: for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!belegt.has(`${x},${y}`)) {
          ziel = { x, y };
          break outer;
        }
      }
    }
    speicherePlan(zimmerId, { plan_x: ziel.x, plan_y: ziel.y });
    setSelId(zimmerId);
  }

  // --- Ziehen -----------------------------------------------------------
  function onZimmerPointerDown(e: React.PointerEvent, z: UnterkunftZimmerUebersicht) {
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

  function onZimmerPointerMove(e: React.PointerEvent, z: UnterkunftZimmerUebersicht) {
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

  function onZimmerPointerUp(e: React.PointerEvent, z: UnterkunftZimmerUebersicht) {
    if (!drag || drag.zimmerId !== z.zimmer_id) return;
    (e.currentTarget as Element).releasePointerCapture(drag.pointerId);
    const { aktX, aktY, origX, origY } = drag;
    setDrag(null);
    if (aktX !== origX || aktY !== origY) {
      speicherePlan(z.zimmer_id, { plan_x: aktX, plan_y: aktY });
    }
  }

  // Pfeiltasten verschieben das gewählte Zimmer (tablet-/tastaturfreundlich).
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

  function zimmerFarbe(z: UnterkunftZimmerUebersicht): { fill: string; stroke: string } {
    if (!z.aktiv) return { fill: "#fafafa", stroke: "#e5e5e5" };
    if (z.offene_maengel > 0) return { fill: "#fef2f2", stroke: "#dc2626" };
    if (z.frei > 0) return { fill: "#ecfdf5", stroke: "#34d399" };
    return { fill: "#f1f5f9", stroke: "#cbd5e1" };
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  const aktGebaeude = gebaeude.find((g) => g.id === gebaeudeId) ?? null;

  return (
    <div className="space-y-4">
      <UnterkunftTabs />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">Grundriss</h1>
          <p className="text-sm text-neutral-500">
            Zimmer anklicken für Details. Farbe: grün = freie Betten, grau =
            voll, rot = offene Mängel; Punkt = Kontroll-Ampel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label>
            Gebäude
            <select
              className="ml-2"
              value={gebaeudeId ?? ""}
              onChange={(e) => {
                setGebaeudeId(Number(e.target.value));
                setSelId(null);
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

      {fehler && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}

      {/* Etagen-Umschalter */}
      {etagenDesGebaeudes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {etagenDesGebaeudes.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                setEtageId(e.id);
                setSelId(null);
              }}
              className={`rounded border px-3 py-1 text-sm ${
                e.id === etageId
                  ? "border-emerald-700 bg-emerald-50 font-semibold text-emerald-800"
                  : "border-neutral-300 text-neutral-600 hover:border-emerald-400"
              }`}
            >
              {e.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-500">
          {aktGebaeude
            ? "Für dieses Gebäude sind noch keine Etagen angelegt – unter "
            : "Noch kein Gebäude angelegt – unter "}
          <Link href="/unterkunft/stammdaten" className="text-emerald-700 underline">
            Stammdaten
          </Link>{" "}
          beginnen.
        </p>
      )}

      {etageId != null && (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Canvas */}
          <div
            ref={svgWrapRef}
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

              {platziert.map((z) => {
                const wirdGezogen = drag?.zimmerId === z.zimmer_id;
                const px = (wirdGezogen ? drag!.aktX : z.plan_x!) * Z;
                const py = (wirdGezogen ? drag!.aktY : z.plan_y!) * Z;
                const w = z.plan_w * Z;
                const h = z.plan_h * Z;
                const { fill, stroke } = zimmerFarbe(z);
                const ausgewaehlt = z.zimmer_id === selId;
                const ampel = kontrollAmpel(z.letzte_kontrolle_am);
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
                      strokeWidth={ausgewaehlt ? 3 : z.offene_maengel > 0 ? 2 : 1.5}
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
                    <text
                      x={w / 2}
                      y={h - 6}
                      textAnchor="middle"
                      className="select-none"
                      fontSize={10}
                      fill="#64748b"
                    >
                      {z.belegt}/{z.betten} belegt
                    </text>
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

          {/* Seitenpanel */}
          <div className="w-full shrink-0 space-y-4 lg:w-80">
            {bearbeiten && canEditPlan && (
              <div className="rounded border border-neutral-200 p-3">
                <h2 className="text-sm font-semibold text-neutral-800">
                  Nicht platziert ({ablage.length})
                </h2>
                {ablage.length === 0 ? (
                  <p className="mt-1 text-sm text-neutral-400">
                    Alle Zimmer dieser Etage liegen im Grundriss.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ablage.map((z) => (
                      <button
                        key={z.zimmer_id}
                        onClick={() => platziereAusAblage(z.zimmer_id)}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-sm hover:border-emerald-500"
                        title="In den Grundriss legen"
                      >
                        {z.nummer}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-neutral-400">
                  Zimmer ziehen zum Verschieben · Pfeiltasten für Feinjustage.
                </p>
              </div>
            )}

            {sel ? (
              <div className="rounded border border-neutral-200 p-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-emerald-900">
                    Zimmer {sel.nummer}
                  </h2>
                  <span className="text-xs text-neutral-500">
                    {sel.gebaeude_name} · {sel.etage_name ?? sel.etage ?? "—"}
                  </span>
                </div>
                {!sel.aktiv && (
                  <p className="text-xs text-red-600">inaktiv</p>
                )}

                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">Betten</dt>
                    <dd>
                      {sel.belegt} / {sel.betten} belegt ·{" "}
                      <span
                        className={sel.frei > 0 ? "font-medium text-emerald-700" : ""}
                      >
                        {sel.frei} frei
                      </span>
                    </dd>
                  </div>
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
                        sel.offene_maengel > 0 ? "font-medium text-red-600" : ""
                      }
                    >
                      {sel.offene_maengel > 0 ? sel.offene_maengel : "—"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3">
                  <div className="text-xs font-medium text-neutral-500">
                    Bewohner heute
                  </div>
                  {(belegungProZimmer[sel.zimmer_id] ?? []).length === 0 ? (
                    <p className="text-sm text-neutral-400">niemand</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {(belegungProZimmer[sel.zimmer_id] ?? []).map((b) => (
                        <li key={b.id}>
                          {b.vorname} {b.name}{" "}
                          <span className="text-neutral-400">({b.personal_nr})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                  <Link className="btn-secondary" href="/unterkunft/uebergabe">
                    Übergabe / Abnahme
                  </Link>
                  <Link className="btn-secondary" href="/unterkunft/kontrolle">
                    Zwischenkontrolle
                  </Link>
                  <Link className="btn-secondary" href="/unterkunft/maengel">
                    Mängel
                  </Link>
                  <Link className="btn-secondary" href="/unterkunft/belegung">
                    Belegung
                  </Link>
                </div>

                {bearbeiten && canEditPlan && sel.plan_x != null && (
                  <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
                    <div className="flex items-center gap-2 text-sm">
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
                          speicherePlan(sel.zimmer_id, { plan_w: sel.plan_w + 1 })
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
                          speicherePlan(sel.zimmer_id, { plan_h: sel.plan_h + 1 })
                        }
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => {
                        speicherePlan(sel.zimmer_id, {
                          plan_x: null,
                          plan_y: null,
                        });
                      }}
                    >
                      vom Grundriss nehmen
                    </button>
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
  );
}
