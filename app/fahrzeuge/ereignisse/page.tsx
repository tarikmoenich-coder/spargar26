"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Route } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type {
  Fahrzeug,
  FahrzeugEreignis,
  FahrzeugHofzeitTag,
} from "@/lib/types";
import FahrzeugeTabs from "@/components/FahrzeugeTabs";
import PageHeader from "@/components/PageHeader";

function heuteIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function uhr(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
const TYP_TEXT: Record<string, string> = {
  geofenceExit: "Hof verlassen",
  geofenceEnter: "zurück am Hof",
  deviceMoving: "in Bewegung",
  deviceStopped: "gestoppt",
  ignitionOn: "Zündung an",
  ignitionOff: "Zündung aus",
};

export default function FahrzeugeEreignissePage() {
  const [datum, setDatum] = useState(heuteIso());
  const [fahrzeuge, setFahrzeuge] = useState<
    Pick<Fahrzeug, "id" | "bezeichnung" | "kennzeichen">[]
  >([]);
  const [hofzeiten, setHofzeiten] = useState<FahrzeugHofzeitTag[]>([]);
  const [ereignisse, setEreignisse] = useState<FahrzeugEreignis[]>([]);
  const [loading, setLoading] = useState(true);
  const [nurAuffaellig, setNurAuffaellig] = useState(false);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [f, h, e] = await Promise.all([
      supabase.from("fahrzeug").select("id, bezeichnung, kennzeichen"),
      supabase.from("fahrzeug_hofzeit_tag").select("*").eq("tag", datum),
      supabase
        .from("fahrzeug_ereignis")
        .select("*")
        .gte("zeitpunkt", `${datum}T00:00:00`)
        .lte("zeitpunkt", `${datum}T23:59:59.999`)
        .order("zeitpunkt", { ascending: false }),
    ]);
    setFahrzeuge((f.data as typeof fahrzeuge) ?? []);
    setHofzeiten((h.data as FahrzeugHofzeitTag[]) ?? []);
    setEreignisse((e.data as FahrzeugEreignis[]) ?? []);
    setLoading(false);
  }, [datum]);

  useEffect(() => {
    laden();
  }, [laden]);

  const nameVon = useMemo(() => {
    const m = new Map<number, string>();
    fahrzeuge.forEach((f) =>
      m.set(
        f.id,
        `${f.bezeichnung}${f.kennzeichen ? ` (${f.kennzeichen})` : ""}`
      )
    );
    return m;
  }, [fahrzeuge]);

  const gefilterte = nurAuffaellig
    ? ereignisse.filter((e) => e.alarm_relevant)
    : ereignisse;

  return (
    <div className="flex flex-col gap-4">
      <FahrzeugeTabs />
      <PageHeader
        icon={Route}
        titel="Hofzeiten & Alarme"
        beschreibung="Wann Fahrzeuge den Hof verlassen und zurückkommen – und Nutzung außerhalb der Arbeitszeit."
      />

      <label className="text-sm">
        Datum{" "}
        <input
          type="date"
          value={datum}
          max={heuteIso()}
          onChange={(e) => setDatum(e.target.value)}
        />
      </label>

      {loading ? (
        <p className="p-4 text-sm text-neutral-500">Lädt …</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Fahrzeug</th>
                  <th>Erste Ausfahrt</th>
                  <th>Letzte Rückkehr</th>
                  <th>Ausfahrten</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {hofzeiten.map((h) => (
                  <tr key={h.fahrzeug_id}>
                    <td>{nameVon.get(h.fahrzeug_id) ?? h.fahrzeug_id}</td>
                    <td>{uhr(h.erste_ausfahrt)}</td>
                    <td>{uhr(h.letzte_rueckkehr)}</td>
                    <td>{h.ausfahrten}</td>
                    <td>
                      {h.auffaellig && (
                        <span className="badge badge-danger">⚠ auffällig</span>
                      )}
                    </td>
                  </tr>
                ))}
                {hofzeiten.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-neutral-500">
                      Keine Hof-Ein-/Ausfahrten an diesem Tag (Geofences in
                      Traccar angelegt und als „Hof" markiert?).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-emerald-800">
              Ereignisse ({gefilterte.length})
            </h2>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={nurAuffaellig}
                onChange={(e) => setNurAuffaellig(e.target.checked)}
              />
              nur Auffälligkeiten
            </label>
          </div>

          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>Fahrzeug</th>
                  <th>Ereignis</th>
                  <th>Geofence</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {gefilterte.map((e) => (
                  <tr
                    key={e.traccar_event_id}
                    className={e.alarm_relevant ? "bg-red-50" : ""}
                  >
                    <td className="whitespace-nowrap">{uhr(e.zeitpunkt)}</td>
                    <td>
                      {e.fahrzeug_id != null
                        ? (nameVon.get(e.fahrzeug_id) ?? e.traccar_unique_id)
                        : e.traccar_unique_id}
                    </td>
                    <td>{TYP_TEXT[e.typ] ?? e.typ}</td>
                    <td className="text-sm">{e.geofence_name ?? "—"}</td>
                    <td className="whitespace-nowrap text-xs">
                      {e.ausserhalb_arbeitszeit && (
                        <span className="badge badge-warn">
                          außerhalb Arbeitszeit
                        </span>
                      )}{" "}
                      {e.alarm_gesendet_am && (
                        <span className="badge badge-neutral">
                          Alarm gesendet
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {gefilterte.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-neutral-500">
                      Keine Ereignisse.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
