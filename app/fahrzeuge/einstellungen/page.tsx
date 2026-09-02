"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type { FahrzeugArbeitszeit, FahrzeugGeofence } from "@/lib/types";
import FahrzeugeTabs from "@/components/FahrzeugeTabs";
import PageHeader from "@/components/PageHeader";

const WOCHENTAGE = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

export default function FahrzeugeEinstellungenPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [zeiten, setZeiten] = useState<FahrzeugArbeitszeit[]>([]);
  const [geofences, setGeofences] = useState<FahrzeugGeofence[]>([]);
  const [loading, setLoading] = useState(true);

  const laden = useCallback(async () => {
    const supabase = getSupabaseClient();
    const [z, g] = await Promise.all([
      supabase.from("fahrzeug_arbeitszeit").select("*").order("wochentag"),
      supabase.from("fahrzeug_geofence").select("*").order("name"),
    ]);
    setZeiten((z.data as FahrzeugArbeitszeit[]) ?? []);
    setGeofences((g.data as FahrzeugGeofence[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  async function zeitAendern(
    wochentag: number,
    patch: Partial<FahrzeugArbeitszeit>
  ) {
    setZeiten((prev) =>
      prev.map((z) => (z.wochentag === wochentag ? { ...z, ...patch } : z))
    );
    await getSupabaseClient()
      .from("fahrzeug_arbeitszeit")
      .update(patch)
      .eq("wochentag", wochentag);
  }

  async function hofAendern(id: number, ist_hof: boolean) {
    setGeofences((prev) =>
      prev.map((g) =>
        g.traccar_geofence_id === id ? { ...g, ist_hof } : g
      )
    );
    await getSupabaseClient()
      .from("fahrzeug_geofence")
      .update({ ist_hof })
      .eq("traccar_geofence_id", id);
  }

  return (
    <div className="flex flex-col gap-4">
      <FahrzeugeTabs />
      <PageHeader
        icon={Settings}
        titel="Fahrzeuge – Einstellungen"
        beschreibung="Arbeitszeit-Fenster für den Alarm und welche Geofences als Hof gelten."
      />

      {!canEdit && (
        <p className="text-xs text-amber-700">
          Deine Rolle darf die Einstellungen nur ansehen.
        </p>
      )}

      {loading ? (
        <p className="p-4 text-sm text-neutral-500">Lädt …</p>
      ) : (
        <>
          <h2 className="text-base font-semibold text-emerald-800">
            Arbeitszeiten
          </h2>
          <p className="text-sm text-neutral-500">
            Eine Fahrzeugnutzung (Bewegung oder Hof-Ausfahrt) außerhalb dieser
            Zeiten löst einen Alarm aus. Tag ohne Haken = ganzer Tag zählt als
            „außerhalb".
          </p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>aktiv</th>
                  <th>von</th>
                  <th>bis</th>
                </tr>
              </thead>
              <tbody>
                {zeiten.map((z) => (
                  <tr key={z.wochentag}>
                    <td>{WOCHENTAGE[z.wochentag]}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={z.aktiv}
                        disabled={!canEdit}
                        onChange={(e) =>
                          zeitAendern(z.wochentag, { aktiv: e.target.checked })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        value={z.von.slice(0, 5)}
                        disabled={!canEdit || !z.aktiv}
                        onChange={(e) =>
                          zeitAendern(z.wochentag, { von: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        value={z.bis.slice(0, 5)}
                        disabled={!canEdit || !z.aktiv}
                        onChange={(e) =>
                          zeitAendern(z.wochentag, { bis: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-4 text-base font-semibold text-emerald-800">
            Geofences
          </h2>
          <p className="text-sm text-neutral-500">
            Geofences werden in Traccar gezeichnet und hier gespiegelt. „Hof"
            steuert die Ein-/Ausfahrt-Auswertung und den Alarm bei
            Hof-Ausfahrten außerhalb der Arbeitszeit.
          </p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Beschreibung</th>
                  <th>ist Hof</th>
                </tr>
              </thead>
              <tbody>
                {geofences.map((g) => (
                  <tr key={g.traccar_geofence_id}>
                    <td>{g.name ?? `#${g.traccar_geofence_id}`}</td>
                    <td className="text-sm text-neutral-500">
                      {g.beschreibung ?? "—"}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={g.ist_hof}
                        disabled={!canEdit}
                        onChange={(e) =>
                          hofAendern(g.traccar_geofence_id, e.target.checked)
                        }
                      />
                    </td>
                  </tr>
                ))}
                {geofences.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-neutral-500">
                      Noch keine Geofences aus Traccar. In Traccar 2 Geofences um
                      die Höfe anlegen und den Geräten zuweisen.
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
