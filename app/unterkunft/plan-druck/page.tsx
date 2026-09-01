"use client";

// Unterkunft → Plan-Druck (Nutzer-Vorgabe 2026-09-01): druckbare Übersicht
// aller Grundrisse mit aktueller Belegung, gebäudeweise auswählbar, entweder
// mit Namen oder anonym nur nach Herkunft (Kürzel + Farbe). Nur admin/hr
// (components/UnterkunftTabs.tsx blendet den Reiter für alle anderen aus,
// hier zusätzlich serverseitig über RLS/eigene Prüfung abgesichert).
//
// Die Koordinaten (plan_x/y/w/h) sind je (Gebäude, Etage) ein gemeinsamer
// Raster - das nutzt schon die "Nachbar-Wohneinheiten"-Anzeige im Grundriss
// (app/unterkunft/page.tsx) aus. Für den Druck werden deshalb einfach ALLE
// Räume einer Etage gemeinsam (nicht mehr blass/nur eine Wohneinheit "scharf")
// gerendert.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import { formatDatumDE } from "@/lib/format";
import {
  GRUNDRISS_ZELLE as Z,
  heuteIso,
  herkunftDominant,
  herkunftFarbe,
  raumName,
} from "@/lib/unterkunft";
import type {
  UnterkunftBelegungAktuell,
  UnterkunftGebaeude,
  UnterkunftZimmerArt,
  UnterkunftZimmerUebersicht,
} from "@/lib/types";

const RAUM_STYLE: Record<
  Exclude<UnterkunftZimmerArt, "zimmer">,
  { fill: string; stroke: string }
> = {
  bad: { fill: "#e0f2fe", stroke: "#0ea5e9" },
  wc: { fill: "#cffafe", stroke: "#06b6d4" },
  flur: { fill: "#ede9fe", stroke: "#8b5cf6" },
  kueche: { fill: "#fef3c7", stroke: "#f59e0b" },
  gemeinschaft: { fill: "#eef2ff", stroke: "#a5b4fc" },
};

type Anzeige = "namen" | "herkunft";

// Deterministisches, innerhalb der gedruckten Auswahl kollisionsfreies
// 2(+)-stelliges Kürzel je Herkunft ("?" für unbekannt).
function kuerzelMap(herkuenfte: string[]): Map<string, string> {
  const uniq = [...new Set(herkuenfte)].sort((a, b) => a.localeCompare(b, "de"));
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const h of uniq) {
    let len = 2;
    let k = h.slice(0, len).toUpperCase();
    while (used.has(k) && len < h.length) {
      len++;
      k = h.slice(0, len).toUpperCase();
    }
    while (used.has(k)) k += "*";
    used.add(k);
    map.set(h, k);
  }
  return map;
}

interface EtagenGruppe {
  key: string;
  gebId: number;
  gebName: string;
  etage: string | null;
  raeume: UnterkunftZimmerUebersicht[];
}

export default function UnterkunftPlanDruckPage() {
  const { profile } = useProfile();
  const zugriff = profile?.role === "admin" || profile?.role === "hr";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmerUebersicht[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegungAktuell[]>([]);
  const [loading, setLoading] = useState(true);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<number>>(new Set());
  const [anzeige, setAnzeige] = useState<Anzeige>("namen");

  useEffect(() => {
    if (!zugriff) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const supabase = getSupabaseClient();
      const [g, z, b] = await Promise.all([
        supabase.from("unterkunft_gebaeude").select("*").order("name"),
        supabase
          .from("unterkunft_zimmer_uebersicht")
          .select("*")
          .order("nummer"),
        supabase.from("unterkunft_belegung_aktuell").select("*"),
      ]);
      const gListe = (g.data as UnterkunftGebaeude[]) ?? [];
      setGebaeude(gListe);
      setZimmer((z.data as UnterkunftZimmerUebersicht[]) ?? []);
      setBelegungen((b.data as UnterkunftBelegungAktuell[]) ?? []);
      setAusgewaehlt(new Set(gListe.map((x) => x.id)));
      setLoading(false);
    })();
  }, [zugriff]);

  if (!zugriff) {
    return (
      <div className="space-y-4">
        <UnterkunftTabs />
        <p className="text-sm text-neutral-500">
          Kein Zugriff – der Plan-Druck ist admin/hr vorbehalten.
        </p>
      </div>
    );
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  const belegungProZimmer: Record<number, UnterkunftBelegungAktuell[]> = {};
  belegungen.forEach((b) => {
    (belegungProZimmer[b.zimmer_id] ??= []).push(b);
  });

  const zimmerGedruckt = zimmer.filter(
    (z) => z.aktiv && ausgewaehlt.has(z.gebaeude_id)
  );

  const herkuenfteVorkommend = zimmerGedruckt.flatMap((z) =>
    (belegungProZimmer[z.zimmer_id] ?? []).map(
      (b) => b.herkunft?.trim() || "?"
    )
  );
  const kuerzelVon = kuerzelMap(herkuenfteVorkommend);

  // Etagen-Gruppen je Gebäude: gemeinsamer Koordinatenraum ist
  // (Gebäude, Etage-Label); ohne Etage-Label eine eigene Gruppe je
  // Wohneinheit (kann dann nicht mit Nachbarn gemeinsam geplottet werden).
  const etagenMap = new Map<string, EtagenGruppe>();
  for (const z of zimmerGedruckt) {
    const key = `${z.gebaeude_id}|${z.etage_label ?? `w:${z.wohneinheit_id}`}`;
    let e = etagenMap.get(key);
    if (!e) {
      e = {
        key,
        gebId: z.gebaeude_id,
        gebName: z.gebaeude_name,
        etage: z.etage_label,
        raeume: [],
      };
      etagenMap.set(key, e);
    }
    e.raeume.push(z);
  }
  const gebGruppen = new Map<
    number,
    { gebId: number; gebName: string; etagen: EtagenGruppe[] }
  >();
  for (const e of etagenMap.values()) {
    let g = gebGruppen.get(e.gebId);
    if (!g) {
      g = { gebId: e.gebId, gebName: e.gebName, etagen: [] };
      gebGruppen.set(e.gebId, g);
    }
    g.etagen.push(e);
  }
  const gruppen = [...gebGruppen.values()]
    .sort((a, b) => a.gebName.localeCompare(b.gebName, "de", { numeric: true }))
    .map((g) => ({
      ...g,
      etagen: g.etagen.sort((a, b) =>
        (a.etage ?? "").localeCompare(b.etage ?? "", "de", { numeric: true })
      ),
    }));

  function drucken() {
    setTimeout(() => window.print(), 50);
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <UnterkunftTabs />
      </div>

      <div className="space-y-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">
            Plan-Druck
          </h1>
          <p className="text-sm text-neutral-500">
            Alle Grundrisse mit aktueller Belegung – gebäudeweise auswählbar,
            zum Ausdrucken/Archivieren.
          </p>
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Gebäude</span>
            <button
              className="text-xs text-emerald-700 underline"
              onClick={() =>
                setAusgewaehlt(new Set(gebaeude.map((g) => g.id)))
              }
            >
              alle
            </button>
            <button
              className="text-xs text-emerald-700 underline"
              onClick={() => setAusgewaehlt(new Set())}
            >
              keine
            </button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {gebaeude.map((g) => (
              <label key={g.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={ausgewaehlt.has(g.id)}
                  onChange={(e) =>
                    setAusgewaehlt((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(g.id);
                      else n.delete(g.id);
                      return n;
                    })
                  }
                />
                {g.name}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Anzeige</span>
          <div className="flex overflow-hidden rounded border border-neutral-300">
            {(["namen", "herkunft"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAnzeige(a)}
                className={`px-2 py-1 text-xs ${
                  anzeige === a
                    ? "bg-emerald-700 font-semibold text-white"
                    : "bg-white text-neutral-600"
                }`}
              >
                {a === "namen" ? "Namentlich" : "Nur Herkunft (anonym)"}
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn"
          onClick={drucken}
          disabled={ausgewaehlt.size === 0}
        >
          🖨 Drucken
        </button>
        {ausgewaehlt.size === 0 && (
          <p className="text-xs text-neutral-400">
            Erst mindestens ein Gebäude auswählen.
          </p>
        )}
      </div>

      {/* Druckinhalt */}
      <div className="hidden print:block">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Grundriss-Übersicht</h1>
          <p className="text-xs text-neutral-600">
            Stand {formatDatumDE(heuteIso())}
            {anzeige === "herkunft" ? " · anonymisiert (nur Herkunft)" : ""}
          </p>
        </div>

        {kuerzelVon.size > 0 && (
          <div className="mb-4 break-inside-avoid">
            <div className="text-xs font-semibold">Herkunfts-Legende</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
              {[...kuerzelVon.entries()].map(([h, k]) => {
                const farbe = herkunftFarbe(h === "?" ? null : h);
                return (
                  <span key={h} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm border"
                      style={{
                        backgroundColor: farbe.fill,
                        borderColor: farbe.stroke,
                      }}
                    />
                    {k} = {h === "?" ? "unbekannt" : h}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {gruppen.length === 0 ? (
          <p className="text-sm text-neutral-500">Kein Gebäude ausgewählt.</p>
        ) : (
          gruppen.map((g) => (
            <div key={g.gebId} className="break-after-page">
              <h2 className="mb-2 text-sm font-semibold">{g.gebName}</h2>
              {g.etagen.map((e) => (
                <EtagenPlan
                  key={e.key}
                  etage={e}
                  belegungProZimmer={belegungProZimmer}
                  kuerzelVon={kuerzelVon}
                  anzeige={anzeige}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EtagenPlan({
  etage,
  belegungProZimmer,
  kuerzelVon,
  anzeige,
}: {
  etage: EtagenGruppe;
  belegungProZimmer: Record<number, UnterkunftBelegungAktuell[]>;
  kuerzelVon: Map<string, string>;
  anzeige: Anzeige;
}) {
  const platziert = etage.raeume.filter(
    (z) => z.plan_x != null && z.plan_y != null
  );
  const unplatziert = etage.raeume.filter(
    (z) => z.plan_x == null || z.plan_y == null
  );
  const cols = Math.max(
    4,
    ...platziert.map((z) => (z.plan_x ?? 0) + z.plan_w + 1)
  );
  const rows = Math.max(
    4,
    ...platziert.map((z) => (z.plan_y ?? 0) + z.plan_h + 1)
  );

  // Für die Namensliste: Räume dieser Etagen-Gruppe nach Wohneinheit sortiert.
  const nachWE = new Map<
    string,
    { name: string; raeume: UnterkunftZimmerUebersicht[] }
  >();
  for (const z of etage.raeume) {
    const key = z.wohneinheit_name ?? "Ohne Wohneinheit";
    if (!nachWE.has(key)) nachWE.set(key, { name: key, raeume: [] });
    nachWE.get(key)!.raeume.push(z);
  }

  return (
    <div className="mb-6 break-inside-avoid">
      <h3 className="mb-1 text-xs font-medium text-neutral-700">
        {etage.etage
          ? `Etage ${etage.etage}`
          : (etage.raeume[0]?.wohneinheit_name ?? "")}
      </h3>
      <svg
        viewBox={`0 0 ${cols * Z} ${rows * Z}`}
        // Auf Seitenbreite skalieren statt nativer Pixelgröße - sonst
        // ragt eine breite Etage über den Papierrand hinaus.
        className="block h-auto w-full max-w-2xl border border-neutral-300"
      >
        {platziert.map((z) => {
          const dominant =
            z.art === "zimmer"
              ? herkunftDominant(belegungProZimmer[z.zimmer_id] ?? [])
              : null;
          const style =
            z.art !== "zimmer" ? RAUM_STYLE[z.art] : herkunftFarbe(dominant);
          const kuerzel = dominant ? kuerzelVon.get(dominant) : undefined;
          return (
            <g
              key={z.zimmer_id}
              transform={`translate(${z.plan_x! * Z} ${z.plan_y! * Z})`}
            >
              <rect
                width={z.plan_w * Z}
                height={z.plan_h * Z}
                rx={4}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={1}
              />
              <text x={4} y={14} fontSize={11} fontWeight={600} fill="#1f2937">
                {z.art === "zimmer" ? z.nummer : raumName(z)}
              </text>
              {z.art === "zimmer" && (
                <text x={4} y={z.plan_h * Z - 6} fontSize={9} fill="#475569">
                  {z.belegt}/{z.betten}
                  {z.geplant > 0 ? ` +${z.geplant}` : ""}
                  {kuerzel ? ` · ${kuerzel}` : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {anzeige === "namen" && (
        <div className="mt-2 grid gap-x-6 gap-y-2 text-[10px] sm:grid-cols-2">
          {[...nachWE.values()].map((w) => {
            const zimmerListe = w.raeume
              .filter((z) => z.art === "zimmer")
              .sort((a, b) =>
                a.nummer.localeCompare(b.nummer, "de", { numeric: true })
              );
            if (zimmerListe.length === 0) return null;
            return (
              <div key={w.name}>
                <div className="font-medium text-neutral-800">{w.name}</div>
                <ul className="mt-0.5 space-y-0.5">
                  {zimmerListe.map((z) => {
                    const personen = belegungProZimmer[z.zimmer_id] ?? [];
                    return (
                      <li key={z.zimmer_id} className="flex gap-2">
                        <span className="w-7 shrink-0 font-medium">
                          {z.nummer}
                        </span>
                        <span>
                          {personen.length === 0
                            ? "—"
                            : personen
                                .map(
                                  (p) =>
                                    `${p.vorname} ${p.name}${
                                      p.herkunft ? ` (${p.herkunft})` : ""
                                    }`
                                )
                                .join(", ")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {unplatziert.length > 0 && (
            <p className="text-neutral-400 sm:col-span-2">
              nicht im Plan platziert:{" "}
              {unplatziert
                .map((z) =>
                  z.art === "zimmer" ? `Zimmer ${z.nummer}` : raumName(z)
                )
                .join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
