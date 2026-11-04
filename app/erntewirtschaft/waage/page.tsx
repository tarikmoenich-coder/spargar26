"use client";

// Erntewirtschaft -> Waage: einfache Lese-Seite fuer tools/ernte-waage-agent/
// (siehe docs/erntewirtschaft-plan.md Teil D). Zeigt die rohen ernte_scan-
// Zeilen der Waage (quelle='waage', ereignis='gewicht') - noch keine
// Kisten-Zyklen/Feld-/Fahrer-Zuordnung, die kommen erst mit der
// SpidertrackBox-Seite. Aktualisiert sich automatisch alle 5s, damit man
// beim Testen am Hof nicht selbst in Supabase nachschauen muss.

import { useCallback, useEffect, useState } from "react";
import { Scale } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatMenge } from "@/lib/format";

const SEITENGROESSE = 100;
const AKTUALISIERUNG_MS = 5000;

interface ErnteScanZeile {
  id: number;
  empfangen_am: string;
  tag_uid: string | null;
  gewicht_kg: number | null;
  waage_id: number | null;
}

interface ErnteWaageZeile {
  id: number;
  name: string;
  live_gewicht_kg: number | null;
  live_aktualisiert_am: string | null;
}

// Ab wie vielen Sekunden ohne frisches live_aktualisiert_am die Anzeige auf
// "keine Verbindung" springt - deutlich über dem LIVE_POLL_INTERVALL_MS-
// Default (3s) des Agenten, damit ein einzelner verzögerter Poll nicht
// sofort als Ausfall gilt.
const WAAGE_LIVE_TIMEOUT_S = 10;

function formatZeitpunktDE(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function ErntewirtschaftWaagePage() {
  const [zeilen, setZeilen] = useState<ErnteScanZeile[]>([]);
  const [waagen, setWaagen] = useState<ErnteWaageZeile[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zuletztAktualisiert, setZuletztAktualisiert] = useState<Date | null>(null);

  const laden = useCallback(async () => {
    const supabase = getSupabaseClient();
    const [{ data: scanData, error: scanFehler }, { data: waageData }] = await Promise.all([
      supabase
        .from("ernte_scan")
        .select("id, empfangen_am, tag_uid, gewicht_kg, waage_id")
        .eq("quelle", "waage")
        .eq("ereignis", "gewicht")
        .order("empfangen_am", { ascending: false })
        .limit(SEITENGROESSE),
      supabase.from("ernte_waage").select("id, name, live_gewicht_kg, live_aktualisiert_am"),
    ]);

    setFehler(scanFehler?.message ?? null);
    setZeilen((scanData as ErnteScanZeile[]) ?? []);
    setWaagen((waageData as ErnteWaageZeile[]) ?? []);
    setLoading(false);
    setZuletztAktualisiert(new Date());
  }, []);

  useEffect(() => {
    laden();
    const intervall = setInterval(laden, AKTUALISIERUNG_MS);
    return () => clearInterval(intervall);
  }, [laden]);

  const heute = new Date().toISOString().slice(0, 10);
  const zeilenHeute = zeilen.filter((z) => z.empfangen_am.slice(0, 10) === heute);
  const summeHeuteKg = zeilenHeute.reduce((s, z) => s + (z.gewicht_kg ?? 0), 0);
  const letzte = zeilen[0];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={Scale}
        titel="Waage"
        beschreibung="Live-Protokoll des Waagen-Agenten - Scan-Code + Gewicht je Wiegung an der Hofwaage."
        aktionen={
          <>
            <a href="/erntewirtschaft/waage/kiosk" className="btn-secondary text-xs">
              Kiosk öffnen
            </a>
            <button type="button" className="btn-secondary text-xs" onClick={laden}>
              Aktualisieren
            </button>
          </>
        }
      />

      {waagen.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {waagen.map((w) => {
            const sekunden = w.live_aktualisiert_am
              ? Math.round((Date.now() - new Date(w.live_aktualisiert_am).getTime()) / 1000)
              : null;
            const verbunden = sekunden !== null && sekunden <= WAAGE_LIVE_TIMEOUT_S;
            return (
              <div key={w.id} className="card flex items-center gap-3">
                <span className={`h-3 w-3 shrink-0 rounded-full ${verbunden ? "bg-emerald-500" : "bg-beere-500"}`} />
                <div>
                  <p className="text-sm font-medium text-neutral-800">{w.name}</p>
                  <p className="text-xs text-neutral-500">
                    {w.live_gewicht_kg != null ? `${formatMenge(w.live_gewicht_kg)} kg (live)` : "ohne Verbindung"}
                    {sekunden !== null && ` · vor ${sekunden}s`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs text-neutral-500">Wägungen heute</p>
          <p className="text-2xl font-semibold text-emerald-900">{zeilenHeute.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-neutral-500">Summe heute</p>
          <p className="text-2xl font-semibold text-emerald-900">{formatMenge(summeHeuteKg)} kg</p>
        </div>
        <div className="card">
          <p className="text-xs text-neutral-500">Letzte Wägung</p>
          <p className="text-2xl font-semibold text-emerald-900">
            {letzte ? `${formatMenge(letzte.gewicht_kg)} kg` : "—"}
          </p>
          {letzte && (
            <p className="text-xs text-neutral-500">{formatZeitpunktDE(letzte.empfangen_am)}</p>
          )}
        </div>
      </div>

      {fehler && (
        <p className="text-sm text-beere-700">
          Konnte nicht laden: {fehler}. Ist die Migration
          migration_2026-10-12_erntewirtschaft_waage_grundlage.sql schon eingespielt?
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : zeilen.length === 0 ? (
        <p className="text-neutral-500">
          Noch keine Wägungen. Läuft der Waagen-Agent (tools/ernte-waage-agent/) und ist mit der Waage verbunden?
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Code</th>
                <th>Gewicht</th>
                <th>Waage</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.id}>
                  <td className="whitespace-nowrap">{formatZeitpunktDE(z.empfangen_am)}</td>
                  <td className="font-mono text-sm">{z.tag_uid ?? "—"}</td>
                  <td>{formatMenge(z.gewicht_kg)} kg</td>
                  <td>{z.waage_id ? waagen.find((w) => w.id === z.waage_id)?.name ?? z.waage_id : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-neutral-400">
        {zuletztAktualisiert &&
          `Aktualisiert ${zuletztAktualisiert.toLocaleTimeString("de-DE")} - aktualisiert sich automatisch alle ${
            AKTUALISIERUNG_MS / 1000
          }s.`}
      </p>
    </div>
  );
}
