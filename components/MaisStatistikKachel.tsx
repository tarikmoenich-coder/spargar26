"use client";

// Mais-Statistik-Kachel für das Erntewirtschaft-Dashboard (Nutzer-Vorgabe
// 2026-08-09): Tagessumme Kolben als Säulendiagramm + Leistung (Kolben/
// Std., Tagesschnitt) als Liniendiagramm darunter, gleiche Datums-Achse.
// Bewusst KEIN Zwei-Achsen-Diagramm (eine Grafik mit zwei Y-Skalen) - das
// würde bei so unterschiedlichen Größenordnungen (Tausende Kolben vs.
// niedrige Hundert Kolben/Std.) eine Korrelation vortäuschen, die nicht in
// den Daten liegt. Stattdessen zwei schlanke, übereinander ausgerichtete
// Diagramme mit gemeinsamer X-Achse und einem gemeinsamen Tooltip, der
// beide Werte für den jeweiligen Tag zeigt.
// Alle Zahlen: 1000er-Punkte, 0 Nachkommastellen (Nutzer-Vorgabe), siehe
// lib/format.ts formatZahlDE.
//
// Breite reagiert auf die verfügbare Kartenbreite (ResizeObserver, siehe
// components/LohnTabs.tsx für dasselbe Muster) - bei wenigen Tagen wird
// der freie Platz mit Abstand zwischen den Balken gefüllt statt die
// Grafik nur in Daten-Pixelbreite (und damit winzig) zu zeigen. Erst wenn
// selbst beim Mindestabstand nicht mehr alle Tage hineinpassen, wird
// waagerecht gescrollt. Balken bleiben dabei laut Marken-Vorgabe immer
// ≤ 24px dick (kein "Auffüllen" der Balken selbst, nur mehr Luft
// dazwischen).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE, formatZahlDE } from "@/lib/format";
import type { ZuckermaisStatistikTag } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

const MIN_SLOT_BREITE = 22;
const MAX_BALKEN_BREITE = 24;
const BALKEN_RADIUS = 4;
const PLOT_HOEHE = 110;
const ACHSEN_BREITE = 44;
const STANDARD_BREITE = 600; // Fallback, bevor die erste Messung vorliegt

// Rundet auf eine "glatte" Zahl auf (1/2/5/10 × 10^n) - für Achsen-Ticks.
function nettoMax(wert: number): number {
  if (wert <= 0) return 10;
  const exponent = Math.floor(Math.log10(wert));
  const basis = Math.pow(10, exponent);
  const anteil = wert / basis;
  const glatterAnteil = anteil <= 1 ? 1 : anteil <= 2 ? 2 : anteil <= 5 ? 5 : 10;
  return glatterAnteil * basis;
}

// Balken mit nur oben abgerundeten Ecken, unten eckig (Marken-Vorgabe).
function balkenPfad(x: number, yTop: number, breite: number, hoehe: number): string {
  if (hoehe <= 0) return "";
  const r = Math.min(BALKEN_RADIUS, breite / 2, hoehe);
  const yBoden = yTop + hoehe;
  return `M ${x} ${yBoden} L ${x} ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop} L ${
    x + breite - r
  } ${yTop} Q ${x + breite} ${yTop} ${x + breite} ${yTop + r} L ${
    x + breite
  } ${yBoden} Z`;
}

export default function MaisStatistikKachel() {
  const [zeilen, setZeilen] = useState<ZuckermaisStatistikTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const [kartenBreite, setKartenBreite] = useState(STANDARD_BREITE);
  const containerRef = useRef<HTMLDivElement>(null);
  const messRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("zuckermais_statistik_tag")
        .select("*")
        .gte("datum", `${CURRENT_YEAR}-01-01`)
        .lte("datum", `${CURRENT_YEAR}-12-31`)
        .order("datum", { ascending: true });
      setZeilen((data as ZuckermaisStatistikTag[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  // Verfügbare Breite messen (nicht nur einmal - auch bei Fenster-/
  // Spalten-Größenänderung), analog zu components/LohnTabs.tsx.
  useEffect(() => {
    const el = messRef.current;
    if (!el) return;
    const setzeBreite = () => {
      if (el.clientWidth > 0) setKartenBreite(el.clientWidth);
    };
    setzeBreite();
    const observer = new ResizeObserver(setzeBreite);
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, zeilen.length]);

  function zeigeTooltip(i: number, clientX: number, clientY: number) {
    setHoverIndex(i);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setHoverPos({ x: clientX - rect.left, y: clientY - rect.top });
    }
  }

  if (loading) {
    return (
      <div ref={messRef} className="rounded border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-base font-semibold text-emerald-800">
          Mais-Statistik
        </h2>
        <p className="text-sm text-neutral-500">Lädt…</p>
      </div>
    );
  }

  if (zeilen.length === 0) {
    return (
      <div ref={messRef} className="rounded border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-base font-semibold text-emerald-800">
          Mais-Statistik
        </h2>
        <p className="text-sm text-neutral-500">
          Noch keine Zuckermais-Einträge für {CURRENT_YEAR}.
        </p>
      </div>
    );
  }

  const kolbenWerte = zeilen.map((z) => Number(z.summe_kolben));
  const leistungWerte = zeilen.map((z) => Number(z.kolben_pro_stunde ?? 0));
  const kolbenMax = nettoMax(Math.max(...kolbenWerte, 1));
  const leistungMax = nettoMax(Math.max(...leistungWerte, 1));

  // Breite: füllt den verfügbaren Platz (Slots werden bei wenigen Tagen
  // breiter, mit mehr Luft zwischen den Balken) - erst wenn selbst beim
  // Mindestabstand nicht alle Tage hineinpassen, wird die Grafik breiter
  // als die Karte und waagerecht scrollbar.
  const plotVerfuegbar = Math.max(kartenBreite - ACHSEN_BREITE, 100);
  const mindestPlotBreite = zeilen.length * MIN_SLOT_BREITE;
  const plotBreite = Math.max(plotVerfuegbar, mindestPlotBreite);
  const svgBreite = plotBreite + ACHSEN_BREITE;
  const slotBreite = plotBreite / zeilen.length;
  const balkenBreite = Math.min(MAX_BALKEN_BREITE, slotBreite * 0.6);

  // Nur jedes n-te Datum beschriften, damit die X-Achse bei vielen Tagen
  // nicht überfüllt (~8 Beschriftungen als Ziel).
  const labelSchritt = Math.max(1, Math.ceil(zeilen.length / 8));

  const hoverZeile = hoverIndex !== null ? zeilen[hoverIndex] : null;

  return (
    <div className="rounded border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-emerald-800">
          Mais-Statistik {CURRENT_YEAR}
        </h2>
        <Link
          href="/statistik/zuckermais"
          className="text-xs text-emerald-700 hover:underline"
        >
          Alle Details →
        </Link>
      </div>

      <div ref={messRef}>
        <div ref={containerRef} className="relative">
          <div className="overflow-x-auto">
            <svg
              width={svgBreite}
              height={PLOT_HOEHE + 18}
              role="img"
              aria-label="Tagessumme Kolben je Tag"
            >
              {/* Gitterlinien (hairline, rezessiv) + Ticks */}
              {[0, 0.5, 1].map((f) => {
                const y = PLOT_HOEHE - f * PLOT_HOEHE;
                return (
                  <g key={f}>
                    <line
                      x1={ACHSEN_BREITE}
                      x2={svgBreite}
                      y1={y}
                      y2={y}
                      stroke="#e5e5e5"
                      strokeWidth={1}
                    />
                    <text
                      x={ACHSEN_BREITE - 6}
                      y={y + 3}
                      textAnchor="end"
                      fontSize={10}
                      fill="#78716c"
                    >
                      {formatZahlDE(f * kolbenMax)}
                    </text>
                  </g>
                );
              })}
              {/* Balken: Tagessumme Kolben (kategorische Farbe Slot 1, blau) */}
              {zeilen.map((z, i) => {
                const wert = Number(z.summe_kolben);
                const hoehe = kolbenMax > 0 ? (wert / kolbenMax) * PLOT_HOEHE : 0;
                const x =
                  ACHSEN_BREITE + i * slotBreite + (slotBreite - balkenBreite) / 2;
                const aktiv = hoverIndex === i;
                return (
                  <path
                    key={z.datum}
                    d={balkenPfad(x, PLOT_HOEHE - hoehe, balkenBreite, hoehe)}
                    fill={aktiv ? "#1c5cab" : "#2a78d6"}
                    onPointerMove={(e) => zeigeTooltip(i, e.clientX, e.clientY)}
                    onPointerLeave={() => setHoverIndex(null)}
                    style={{ cursor: "pointer" }}
                  />
                );
              })}
            </svg>
          </div>
          <p className="mt-1 text-xs text-neutral-500">Tagessumme Kolben</p>

          <div className="mt-2 overflow-x-auto">
            <svg
              width={svgBreite}
              height={PLOT_HOEHE + 18}
              role="img"
              aria-label="Leistung Kolben je Stunde, Tagesschnitt"
            >
              {[0, 0.5, 1].map((f) => {
                const y = PLOT_HOEHE - f * PLOT_HOEHE;
                return (
                  <g key={f}>
                    <line
                      x1={ACHSEN_BREITE}
                      x2={svgBreite}
                      y1={y}
                      y2={y}
                      stroke="#e5e5e5"
                      strokeWidth={1}
                    />
                    <text
                      x={ACHSEN_BREITE - 6}
                      y={y + 3}
                      textAnchor="end"
                      fontSize={10}
                      fill="#78716c"
                    >
                      {formatZahlDE(f * leistungMax)}
                    </text>
                  </g>
                );
              })}
              {/* Linie: Leistung Kolben/Std. (kategorische Farbe Slot 3, grün/aqua) */}
              <polyline
                points={zeilen
                  .map((z, i) => {
                    const wert = Number(z.kolben_pro_stunde ?? 0);
                    const y =
                      PLOT_HOEHE -
                      (leistungMax > 0 ? (wert / leistungMax) * PLOT_HOEHE : 0);
                    const x = ACHSEN_BREITE + i * slotBreite + slotBreite / 2;
                    return `${x},${y}`;
                  })
                  .join(" ")}
                fill="none"
                stroke="#1baf7a"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {zeilen.map((z, i) => {
                const wert = Number(z.kolben_pro_stunde ?? 0);
                const y =
                  PLOT_HOEHE -
                  (leistungMax > 0 ? (wert / leistungMax) * PLOT_HOEHE : 0);
                const x = ACHSEN_BREITE + i * slotBreite + slotBreite / 2;
                const aktiv = hoverIndex === i;
                return (
                  <g key={z.datum}>
                    {/* Größeres, unsichtbares Hit-Target (Vorgabe: Hit-Target größer als die Marke) */}
                    <circle
                      cx={x}
                      cy={y}
                      r={12}
                      fill="transparent"
                      onPointerMove={(e) => zeigeTooltip(i, e.clientX, e.clientY)}
                      onPointerLeave={() => setHoverIndex(null)}
                      style={{ cursor: "pointer" }}
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r={aktiv ? 5 : 4}
                      fill="#1baf7a"
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  </g>
                );
              })}
              {/* Endpunkt-Beschriftung (letzter Wert) in Text-Farbe statt
                  Serienfarbe - nötig, da die grüne Linie allein unter 3:1
                  Kontrast liegt (Vorgabe: sichtbare Beschriftung als
                  Abhilfe). */}
              {(() => {
                const letzter = zeilen[zeilen.length - 1];
                const wert = Number(letzter.kolben_pro_stunde ?? 0);
                const y =
                  PLOT_HOEHE -
                  (leistungMax > 0 ? (wert / leistungMax) * PLOT_HOEHE : 0);
                const x =
                  ACHSEN_BREITE + (zeilen.length - 1) * slotBreite + slotBreite / 2;
                return (
                  <text
                    x={x}
                    y={Math.max(y - 8, 10)}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill="#44403c"
                  >
                    {formatZahlDE(wert)}
                  </text>
                );
              })()}
            </svg>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Leistung (Kolben/Std., Tagesschnitt)
          </p>

          {/* Gemeinsame Datums-Achse für beide Diagramme */}
          <div className="overflow-x-auto">
            <svg width={svgBreite} height={16}>
              {zeilen.map((z, i) => {
                if (i % labelSchritt !== 0) return null;
                const x = ACHSEN_BREITE + i * slotBreite + slotBreite / 2;
                return (
                  <text
                    key={z.datum}
                    x={x}
                    y={10}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#78716c"
                  >
                    {formatDatumDE(z.datum).slice(0, 5)}
                  </text>
                );
              })}
            </svg>
          </div>

          {/* Ein gemeinsamer Tooltip für beide Diagramme (zeigt beide Werte
              desselben Tages, statt zwei getrennter Tooltips). */}
          {hoverZeile && hoverPos && (
            <div
              className="pointer-events-none absolute z-10 rounded border border-neutral-200 bg-white px-2 py-1 text-xs shadow-md"
              style={{
                left: Math.min(hoverPos.x + 10, svgBreite - 140),
                top: Math.max(hoverPos.y - 50, 0),
              }}
            >
              <p className="font-medium text-neutral-800">
                {formatDatumDE(hoverZeile.datum)}
              </p>
              <p className="text-neutral-600">
                <span className="mr-1 inline-block h-0.5 w-3 align-middle bg-[#2a78d6]" />
                {formatZahlDE(hoverZeile.summe_kolben)} Kolben
              </p>
              <p className="text-neutral-600">
                <span className="mr-1 inline-block h-0.5 w-3 align-middle bg-[#1baf7a]" />
                {formatZahlDE(hoverZeile.kolben_pro_stunde)} Kolben/Std.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
