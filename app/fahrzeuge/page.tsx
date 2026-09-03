"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Truck } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import type {
  FahrzeugGeofence,
  FahrzeugTracker,
  FahrzeugUebersicht,
} from "@/lib/types";
import FahrzeugeTabs from "@/components/FahrzeugeTabs";
import FahrzeugKarte from "@/components/FahrzeugKarte";
import PageHeader from "@/components/PageHeader";

function minutenHer(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}
function vorText(min: number | null): string {
  if (min === null) return "keine Meldung";
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  if (min < 1440) return `vor ${Math.round(min / 60)} h`;
  return `vor ${Math.round(min / 1440)} d`;
}
function tageBis(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round(
    (new Date(iso + "T00:00:00").getTime() - Date.now()) / 86400000
  );
}

export default function FahrzeugeUebersichtPage() {
  const [fahrzeuge, setFahrzeuge] = useState<FahrzeugUebersicht[]>([]);
  const [offeneTracker, setOffeneTracker] = useState<FahrzeugTracker[]>([]);
  const [geofences, setGeofences] = useState<FahrzeugGeofence[]>([]);
  const [bilder, setBilder] = useState<Record<number, string>>({});
  const [alarmHeute, setAlarmHeute] = useState(0);
  const [loading, setLoading] = useState(true);
  const [zeige, setZeige] = useState<"karte" | "liste">("karte");

  const laden = useCallback(async () => {
    const supabase = getSupabaseClient();
    const tagesbeginn = new Date();
    tagesbeginn.setHours(0, 0, 0, 0);
    const [f, t, g, al] = await Promise.all([
      supabase.from("fahrzeug_uebersicht").select("*").order("bezeichnung"),
      supabase
        .from("fahrzeug_tracker")
        .select("*")
        .is("fahrzeug_id", null)
        .order("zuletzt_gesehen", { ascending: false }),
      supabase.from("fahrzeug_geofence").select("*"),
      supabase
        .from("fahrzeug_ereignis")
        .select("traccar_event_id", { count: "exact", head: true })
        .eq("alarm_relevant", true)
        .gte("zeitpunkt", tagesbeginn.toISOString()),
    ]);
    setFahrzeuge((f.data as FahrzeugUebersicht[]) ?? []);
    setOffeneTracker((t.data as FahrzeugTracker[]) ?? []);
    setGeofences((g.data as FahrzeugGeofence[]) ?? []);
    setAlarmHeute(al.count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
    const id = setInterval(laden, 20000);
    return () => clearInterval(id);
  }, [laden]);

  // Fahrzeugfotos einmalig laden (nicht im 20-s-Poll, damit der klein bleibt).
  useEffect(() => {
    getSupabaseClient()
      .from("fahrzeug")
      .select("id, bild")
      .not("bild", "is", null)
      .then(({ data }) => {
        const m: Record<number, string> = {};
        (data as { id: number; bild: string | null }[] | null)?.forEach((r) => {
          if (r.bild) m[r.id] = r.bild;
        });
        setBilder(m);
      });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <FahrzeugeTabs />
      <PageHeader
        icon={Truck}
        titel="Fahrzeuge"
        beschreibung="Live-Standort der Flotte (GPS über Traccar). Aktualisiert sich alle 20 Sekunden."
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-linie bg-white p-0.5 text-sm lg:hidden">
          {(["karte", "liste"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setZeige(v)}
              className={`rounded px-3 py-1 ${
                zeige === v
                  ? "bg-emerald-700 text-white"
                  : "text-neutral-600"
              }`}
            >
              {v === "karte" ? "Karte" : "Liste"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {alarmHeute > 0 && (
            <Link
              href="/fahrzeuge/ereignisse"
              className="badge badge-danger"
              title="Fahrzeugnutzung außerhalb der Arbeitszeit"
            >
              ⚠ {alarmHeute} Auffälligkeit{alarmHeute === 1 ? "" : "en"} heute
            </Link>
          )}
          {offeneTracker.length > 0 && (
            <Link
              href="/fahrzeuge/stammdaten"
              className="badge badge-warn"
              title="Tracker, die Daten senden, aber keinem Fahrzeug zugeordnet sind"
            >
              {offeneTracker.length} Tracker ohne Fahrzeug
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <p className="p-4 text-sm text-neutral-500">Lädt …</p>
      ) : (
        <>
          <div className={zeige === "karte" ? "" : "hidden lg:block"}>
            <FahrzeugKarte
              fahrzeuge={fahrzeuge}
              geofences={geofences}
              bilder={bilder}
              hoehe="h-[70vh]"
            />
          </div>

          <div
            className={`flex flex-col gap-2 ${
              zeige === "liste" ? "" : "hidden lg:flex"
            }`}
          >
            {fahrzeuge.length === 0 && (
              <p className="text-sm text-neutral-500">
                Noch keine Fahrzeuge angelegt –{" "}
                <Link
                  href="/fahrzeuge/stammdaten"
                  className="text-emerald-700 underline"
                >
                  unter Stammdaten
                </Link>{" "}
                anlegen und einen Tracker zuordnen.
              </p>
            )}
            {fahrzeuge.map((f) => {
              const min = minutenHer(f.pos_zeitpunkt);
              const farbe =
                min === null || min >= 60
                  ? "bg-neutral-400"
                  : min >= 10
                    ? "bg-amber-500"
                    : "bg-emerald-500";
              const huTage = tageBis(f.hu_faellig);
              const foto = bilder[f.id];
              return (
                <div key={f.id} className="card flex gap-3">
                  {foto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={foto}
                      alt=""
                      className="h-16 w-24 shrink-0 rounded border border-linie object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded border border-dashed border-linie text-[10px] text-neutral-300">
                      kein Foto
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${farbe}`}
                        />
                        <Link
                          href={`/fahrzeuge/verlauf?fahrzeug=${f.id}`}
                          className="font-semibold text-emerald-900 hover:underline"
                        >
                          {f.bezeichnung}
                        </Link>
                        {f.kennzeichen && (
                          <span className="text-sm text-neutral-500">
                            {f.kennzeichen}
                          </span>
                        )}
                      </div>
                      {huTage !== null && huTage < 30 && (
                        <span
                          className={
                            huTage < 0
                              ? "badge badge-danger"
                              : "badge badge-warn"
                          }
                        >
                          {huTage < 0
                            ? `HU überfällig (${formatDatumDE(f.hu_faellig)})`
                            : `HU in ${huTage} Tagen`}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-neutral-600">
                      Fahrer:{" "}
                      {f.fahrer_name
                        ? `${f.fahrer_name}, ${f.fahrer_vorname ?? ""}`
                        : "—"}
                    </div>
                    <div className="text-sm text-neutral-600">
                      {f.speed_kmh != null
                        ? `${Math.round(f.speed_kmh)} km/h`
                        : "steht"}{" "}
                      · Zündung{" "}
                      {f.zuendung == null ? "—" : f.zuendung ? "an" : "aus"} ·
                      zuletzt {vorText(min)}
                      {f.batterie_prozent != null && (
                        <>
                          {" · "}
                          <span
                            className={
                              f.batterie_prozent < 20
                                ? "font-medium text-red-600"
                                : f.batterie_prozent < 40
                                  ? "text-amber-600"
                                  : ""
                            }
                          >
                            🔋 {Math.round(f.batterie_prozent)} %
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-neutral-400">
                      {f.km_stand != null
                        ? `${f.km_stand.toLocaleString("de-DE")} km`
                        : "km —"}
                      {f.geraetetyp ? ` · Tracker: ${f.geraetetyp}` : ""}
                      {f.traccar_unique_id ? "" : " · kein Tracker zugeordnet"}
                    </div>
                    {f.tracker_position && (
                      <div className="text-xs text-neutral-400">
                        📍 Tracker verbaut: {f.tracker_position}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
