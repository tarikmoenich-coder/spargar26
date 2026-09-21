"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Truck } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import {
  FAHRZEUG_TYPEN,
  FAHRZEUG_TYP_LABELS,
  fahrzeugTypLabel,
  type FahrzeugGeofence,
  type FahrzeugTracker,
  type FahrzeugUebersicht,
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
  // Kartenfilter nach Fahrzeugtyp ("" = alle). Wirkt auf Karte UND Liste.
  const [typFilter, setTypFilter] = useState("");
  // Freitextsuche (Nutzer-Vorgabe 2026-09-16: bei ~150 Fahrzeugen reicht der
  // Typ-Filter allein nicht mehr). Wirkt wie der Typ-Filter auf Karte UND
  // Liste.
  const [suche, setSuche] = useState("");
  // Abgemeldete Fahrzeuge sind standardmäßig aus - sie haben in der Regel
  // keinen aktuellen Standort und würden nur die Übersicht überladen.
  const [zeigeAbgemeldete, setZeigeAbgemeldete] = useState(false);
  // "Auf Karte zeigen" aus der Liste: neues Objekt je Klick.
  const [fokus, setFokus] = useState<{ id: number; ts: number } | null>(null);

  function aufKarteZeigen(id: number) {
    setFokus({ id, ts: Date.now() });
    setZeige("karte");
  }

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

  // Nur Typen anbieten, die tatsächlich vorkommen (+ die aktuelle Auswahl,
  // falls das letzte Fahrzeug dieses Typs gerade rausgefiltert lädt).
  const vorhandeneTypen = new Set(
    fahrzeuge.map((f) => f.typ).filter((t): t is string => !!t)
  );
  const typOptionen = FAHRZEUG_TYPEN.filter(
    (t) => vorhandeneTypen.has(t) || t === typFilter
  );
  const abgemeldeteAnzahl = fahrzeuge.filter((f) => !f.aktiv).length;
  const sucheNorm = suche.trim().toLowerCase();
  const sichtbar = fahrzeuge.filter((f) => {
    if (!zeigeAbgemeldete && !f.aktiv) return false;
    if (typFilter && f.typ !== typFilter) return false;
    if (!sucheNorm) return true;
    return (
      f.bezeichnung.toLowerCase().includes(sucheNorm) ||
      (f.kennzeichen ?? "").toLowerCase().includes(sucheNorm) ||
      (f.fahrer_name ?? "").toLowerCase().includes(sucheNorm) ||
      (f.fahrer_vorname ?? "").toLowerCase().includes(sucheNorm)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <FahrzeugeTabs />
      <PageHeader
        icon={Truck}
        titel="Fahrzeuge"
        beschreibung="Live-Standort der Flotte (GPS über Traccar). Aktualisiert sich alle 20 Sekunden."
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-linie bg-white p-0.5 text-sm">
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
          <input
            type="search"
            placeholder="Suche: Bezeichnung, Kennzeichen, Fahrer …"
            className="w-56 text-sm"
            value={suche}
            onChange={(e) => {
              setSuche(e.target.value);
              setFokus(null);
            }}
          />
          <select
            className="text-sm"
            value={typFilter}
            onChange={(e) => {
              setTypFilter(e.target.value);
              setFokus(null); // Auto-Fit für den neuen Filter wieder zulassen
            }}
            title="Nach Fahrzeugtyp filtern"
          >
            <option value="">Alle Typen</option>
            {typOptionen.map((t) => (
              <option key={t} value={t}>
                {FAHRZEUG_TYP_LABELS[t]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-neutral-600">
            <input
              type="checkbox"
              checked={zeigeAbgemeldete}
              onChange={(e) => {
                setZeigeAbgemeldete(e.target.checked);
                setFokus(null);
              }}
            />
            abgemeldete Fahrzeuge anzeigen
            {abgemeldeteAnzahl > 0 && ` (${abgemeldeteAnzahl})`}
          </label>
          <span className="text-xs text-neutral-500">
            {sichtbar.length} von {fahrzeuge.length}
          </span>
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
          <div className={zeige === "karte" ? "" : "hidden"}>
            <FahrzeugKarte
              fahrzeuge={sichtbar}
              geofences={geofences}
              bilder={bilder}
              fokus={fokus}
              aktiv={zeige === "karte"}
              hoehe="h-[70vh]"
            />
          </div>

          <div className={zeige === "liste" ? "" : "hidden"}>
            {fahrzeuge.length === 0 ? (
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
            ) : sichtbar.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Kein Fahrzeug entspricht Suche/Filter.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-linie bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-linie text-left text-neutral-500">
                      <th className="px-3 py-2 font-medium"></th>
                      <th className="px-3 py-2 font-medium">Fahrzeug</th>
                      <th className="px-3 py-2 font-medium">Fahrer</th>
                      <th className="px-3 py-2 font-medium">Zustand</th>
                      <th className="px-3 py-2 font-medium">Batterie</th>
                      <th className="px-3 py-2 font-medium">Typ</th>
                      <th className="px-3 py-2 font-medium">km-Stand</th>
                      <th className="px-3 py-2 font-medium">HU fällig</th>
                      <th className="px-3 py-2 font-medium">Angemeldet seit</th>
                      <th className="px-3 py-2 font-medium">Abgemeldet am</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sichtbar.map((f) => {
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
                        <tr
                          key={f.id}
                          className={`border-b border-linie last:border-0 ${
                            f.aktiv ? "" : "opacity-50"
                          }`}
                        >
                          <td className="px-3 py-1.5">
                            {foto ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={foto}
                                alt=""
                                className="h-8 w-12 rounded border border-linie object-cover"
                              />
                            ) : (
                              <span
                                className={`ml-1.5 inline-block h-2.5 w-2.5 rounded-full ${farbe}`}
                                title={vorText(min)}
                              />
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <Link
                              href={`/fahrzeuge/verlauf?fahrzeug=${f.id}`}
                              className="font-medium text-emerald-900 hover:underline"
                            >
                              {f.bezeichnung}
                            </Link>
                            {f.kennzeichen && (
                              <span className="ml-1.5 text-neutral-500">
                                {f.kennzeichen}
                              </span>
                            )}
                            {!f.aktiv && (
                              <span className="badge badge-neutral ml-1.5">
                                abgemeldet
                              </span>
                            )}
                            {huTage !== null && huTage < 30 && (
                              <span
                                className={`ml-1.5 ${
                                  huTage < 0
                                    ? "badge badge-danger"
                                    : "badge badge-warn"
                                }`}
                              >
                                {huTage < 0
                                  ? "HU überfällig"
                                  : `HU in ${huTage} T.`}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-neutral-600">
                            {f.fahrer_name
                              ? `${f.fahrer_name}, ${f.fahrer_vorname ?? ""}`
                              : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-neutral-600">
                            {f.speed_kmh != null
                              ? `${Math.round(f.speed_kmh)} km/h`
                              : "steht"}{" "}
                            · Zündung{" "}
                            {f.zuendung == null
                              ? "—"
                              : f.zuendung
                                ? "an"
                                : "aus"}{" "}
                            · {vorText(min)}
                          </td>
                          <td className="px-3 py-1.5">
                            {f.batterie_prozent != null ? (
                              <span
                                className={
                                  f.batterie_prozent < 20
                                    ? "font-medium text-beere-600"
                                    : f.batterie_prozent < 40
                                      ? "text-amber-600"
                                      : "text-neutral-600"
                                }
                              >
                                🔋 {Math.round(f.batterie_prozent)} %
                              </span>
                            ) : (
                              <span className="text-neutral-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-neutral-600">
                            {fahrzeugTypLabel(f.typ)}
                          </td>
                          <td className="px-3 py-1.5 text-neutral-600">
                            {f.km_stand != null
                              ? `${f.km_stand.toLocaleString("de-DE")} km`
                              : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-neutral-600">
                            {f.hu_faellig ? formatDatumDE(f.hu_faellig) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-neutral-600">
                            {f.angemeldet_seit
                              ? formatDatumDE(f.angemeldet_seit)
                              : "—"}
                          </td>
                          <td className="px-3 py-1.5">
                            {f.abgemeldet_am ? (
                              <span className="text-beere-600">
                                {formatDatumDE(f.abgemeldet_am)}
                              </span>
                            ) : (
                              <span className="text-neutral-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              disabled={f.lat == null || f.lng == null}
                              title={
                                f.lat == null || f.lng == null
                                  ? "Keine Position bekannt"
                                  : "Auf der Karte anzeigen"
                              }
                              onClick={() => aufKarteZeigen(f.id)}
                            >
                              Karte
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
