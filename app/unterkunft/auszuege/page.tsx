"use client";

// Unterkunft → Auszüge (Migration 2026-09-16). Personen, deren Auszug noch
// abgenommen werden muss: laufende Belegung + (Lohn-Auszahlung nach Einzug
// ODER Mitarbeiter inaktiv). Aufbau wie die „Heute zu erledigen"-Liste im
// Kontrollplan: flach, nach Gebäude gruppiert. „Auszug starten" führt direkt
// in die Abnahme; danach ist die Belegung beendet und die Zeile verschwindet.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import { formatDatumDE } from "@/lib/format";
import { raumName } from "@/lib/unterkunft";
import type { UnterkunftAuszugOffen } from "@/lib/types";

export default function UnterkunftAuszuegePage() {
  const [zeilen, setZeilen] = useState<UnterkunftAuszugOffen[]>([]);
  const [loading, setLoading] = useState(true);

  const laden = useCallback(async () => {
    setLoading(true);
    const { data } = await getSupabaseClient()
      .from("unterkunft_auszug_offen")
      .select("*");
    setZeilen((data as UnterkunftAuszugOffen[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  const proGebaeude = useMemo(() => {
    const m = new Map<string, UnterkunftAuszugOffen[]>();
    [...zeilen]
      .sort(
        (a, b) =>
          a.gebaeude_name.localeCompare(b.gebaeude_name) ||
          (a.wohneinheit_name ?? "").localeCompare(b.wohneinheit_name ?? "") ||
          `${a.name} ${a.vorname}`.localeCompare(`${b.name} ${b.vorname}`)
      )
      .forEach((z) => {
        const k = z.gebaeude_name;
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(z);
      });
    return [...m.entries()];
  }, [zeilen]);

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  return (
    <div className="space-y-4">
      <UnterkunftTabs />

      <div>
        <h1 className="text-lg font-semibold text-emerald-900">
          Auszüge ({zeilen.length})
        </h1>
        <p className="max-w-2xl text-sm text-neutral-500">
          Personen mit laufender Belegung, für die die Lohn-Auszahlung erfolgt
          ist (oder die inzwischen abgereist sind). Zimmer abnehmen und „Auszug
          starten" – danach ist die Belegung beendet.
        </p>
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          Kein offener Auszug. 👍
        </p>
      ) : (
        proGebaeude.map(([geb, liste]) => (
          <section key={geb} className="space-y-2">
            <h2 className="flex items-center gap-2 font-semibold text-neutral-800">
              {geb}
              <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs">
                {liste.length}
              </span>
            </h2>
            <ul className="divide-y divide-neutral-100 rounded border border-linie">
              {liste.map((z) => (
                <li
                  key={z.belegung_id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                >
                  <span className="min-w-[10rem] font-medium">
                    {z.vorname} {z.name}
                  </span>
                  <span className="text-neutral-600">
                    {z.wohneinheit_name ? `${z.wohneinheit_name} · ` : ""}
                    {z.zimmer_art === "zimmer"
                      ? `Zimmer ${z.zimmer_nummer}`
                      : raumName({ art: z.zimmer_art, nummer: z.zimmer_nummer })}
                  </span>
                  <span className="text-neutral-500">
                    {z.ausgezahlt_am
                      ? `ausgezahlt ${formatDatumDE(z.ausgezahlt_am)}`
                      : "Mitarbeiter inaktiv"}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      z.hat_kaution
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-neutral-200 text-neutral-600"
                    }`}
                  >
                    {z.hat_kaution ? "Kaution zurück" : "keine Kaution"}
                  </span>
                  <Link
                    href={`/unterkunft/uebergabe?zimmer=${z.zimmer_id}&typ=auszug&belegung=${z.belegung_id}`}
                    className="ml-auto rounded bg-red-600 px-3 py-1 text-xs font-medium text-white"
                  >
                    Auszug starten
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
