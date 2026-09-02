"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Route } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import type { Fahrzeug, FahrzeugPosition } from "@/lib/types";
import FahrzeugeTabs from "@/components/FahrzeugeTabs";
import FahrzeugKarte, { type Trackpunkt } from "@/components/FahrzeugKarte";
import PageHeader from "@/components/PageHeader";

function heuteIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function haversineKm(a: Trackpunkt, b: Trackpunkt): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface Fahrt {
  von: string;
  bis: string;
  minuten: number;
  km: number;
  maxSpeed: number;
  punkte: Trackpunkt[];
}

// Fahrten = zusammenhängende Punktfolgen; neue Fahrt bei Zeitlücke > 15 min.
function fahrtenAus(positionen: FahrzeugPosition[]): Fahrt[] {
  const gueltig = positionen.filter((p) => p.gueltig);
  const fahrten: Fahrt[] = [];
  let aktuell: FahrzeugPosition[] = [];
  const abschliessen = () => {
    if (aktuell.length < 2) {
      aktuell = [];
      return;
    }
    const pk: Trackpunkt[] = aktuell.map((p) => ({ lng: p.lng, lat: p.lat }));
    let km = 0;
    for (let i = 1; i < pk.length; i++) km += haversineKm(pk[i - 1], pk[i]);
    const von = aktuell[0].zeitpunkt;
    const bis = aktuell[aktuell.length - 1].zeitpunkt;
    fahrten.push({
      von,
      bis,
      minuten: Math.round(
        (new Date(bis).getTime() - new Date(von).getTime()) / 60000
      ),
      km,
      maxSpeed: Math.max(0, ...aktuell.map((p) => p.speed_kmh ?? 0)),
      punkte: pk,
    });
    aktuell = [];
  };
  for (const p of gueltig) {
    if (aktuell.length > 0) {
      const luecke =
        (new Date(p.zeitpunkt).getTime() -
          new Date(aktuell[aktuell.length - 1].zeitpunkt).getTime()) /
        60000;
      if (luecke > 15) abschliessen();
    }
    aktuell.push(p);
  }
  abschliessen();
  return fahrten;
}

function VerlaufInner() {
  const params = useSearchParams();
  const [fahrzeuge, setFahrzeuge] = useState<
    Pick<Fahrzeug, "id" | "bezeichnung" | "kennzeichen">[]
  >([]);
  const [fahrzeugId, setFahrzeugId] = useState<string>(
    params.get("fahrzeug") ?? ""
  );
  const [datum, setDatum] = useState<string>(heuteIso());
  const [positionen, setPositionen] = useState<FahrzeugPosition[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSupabaseClient()
      .from("fahrzeug")
      .select("id, bezeichnung, kennzeichen")
      .eq("aktiv", true)
      .order("bezeichnung")
      .then(({ data }) => {
        const liste = (data as typeof fahrzeuge) ?? [];
        setFahrzeuge(liste);
        setFahrzeugId((cur) => cur || (liste[0] ? String(liste[0].id) : ""));
      });
  }, []);

  useEffect(() => {
    if (!fahrzeugId) {
      setPositionen([]);
      return;
    }
    setLoading(true);
    getSupabaseClient()
      .from("fahrzeug_position")
      .select("*")
      .eq("fahrzeug_id", Number(fahrzeugId))
      .gte("zeitpunkt", `${datum}T00:00:00`)
      .lte("zeitpunkt", `${datum}T23:59:59.999`)
      .order("zeitpunkt")
      .then(({ data }) => {
        setPositionen((data as FahrzeugPosition[]) ?? []);
        setLoading(false);
      });
  }, [fahrzeugId, datum]);

  const fahrten = useMemo(() => fahrtenAus(positionen), [positionen]);
  const track = useMemo<Trackpunkt[]>(
    () =>
      positionen
        .filter((p) => p.gueltig)
        .map((p) => ({ lng: p.lng, lat: p.lat })),
    [positionen]
  );
  const gesamtKm = fahrten.reduce((s, f) => s + f.km, 0);
  const gesamtMin = fahrten.reduce((s, f) => s + f.minuten, 0);

  return (
    <div className="flex flex-col gap-4">
      <FahrzeugeTabs />
      <PageHeader
        icon={Route}
        titel="Streckenverlauf"
        beschreibung="Fahrten eines Fahrzeugs an einem Tag – Strecke auf der Karte, aufgeteilt in einzelne Fahrten."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Fahrzeug{" "}
          <select
            value={fahrzeugId}
            onChange={(e) => setFahrzeugId(e.target.value)}
          >
            {fahrzeuge.length === 0 && <option value="">—</option>}
            {fahrzeuge.map((f) => (
              <option key={f.id} value={f.id}>
                {f.bezeichnung}
                {f.kennzeichen ? ` (${f.kennzeichen})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Datum{" "}
          <input
            type="date"
            value={datum}
            max={heuteIso()}
            onChange={(e) => setDatum(e.target.value)}
          />
        </label>
        <span className="text-sm text-neutral-500">
          {loading
            ? "lädt …"
            : `${fahrten.length} Fahrt(en) · ${gesamtKm.toFixed(1)} km · ${Math.round(
                gesamtMin
              )} min unterwegs`}
        </span>
      </div>

      <FahrzeugKarte fahrzeuge={[]} track={track} hoehe="h-[60vh]" />

      {!loading && positionen.length === 0 && (
        <p className="text-sm text-neutral-500">
          Keine Positionen für diesen Tag.
        </p>
      )}

      {fahrten.length > 0 && (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Start</th>
                <th>Ende</th>
                <th>Dauer</th>
                <th>Strecke</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              {fahrten.map((f, i) => (
                <tr key={f.von}>
                  <td>{i + 1}</td>
                  <td className="whitespace-nowrap">
                    {new Date(f.von).toLocaleTimeString("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="whitespace-nowrap">
                    {new Date(f.bis).toLocaleTimeString("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>{f.minuten} min</td>
                  <td>{f.km.toFixed(1)} km</td>
                  <td>{Math.round(f.maxSpeed)} km/h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-neutral-400">
        Strecke aus den gespeicherten GPS-Punkten ({formatDatumDE(datum)}) –
        Kilometer als Luftlinien-Summe zwischen den Punkten, daher grobe
        Näherung.
      </p>
    </div>
  );
}

export default function StreckenverlaufPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-neutral-500">Lädt …</p>}>
      <VerlaufInner />
    </Suspense>
  );
}
