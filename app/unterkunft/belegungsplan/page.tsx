"use client";

// Unterkunft → Belegungsplan (Migration 2026-08-29, verschoben von /unterkunft
// nach /unterkunft/belegungsplan am 2026-08-30, seit der Grundriss die
// Einstiegsseite ist). Je Zimmer wer heute dort wohnt, freie Betten, letzte
// abgeschlossene Kontrolle und offene Mängel. Nur lesend – Pflege läuft über
// die anderen Tabs.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import { formatDatumDE } from "@/lib/format";
import {
  UNTERKUNFT_VORGANG_TYP_LABELS,
  type UnterkunftBelegungAktuell,
  type UnterkunftZimmerUebersicht,
} from "@/lib/types";

export default function UnterkunftBelegungsplanPage() {
  const [zimmer, setZimmer] = useState<UnterkunftZimmerUebersicht[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegungAktuell[]>([]);
  const [loading, setLoading] = useState(true);
  const [gebaeudeFilter, setGebaeudeFilter] = useState("");
  const [nurMitLuecke, setNurMitLuecke] = useState(false);
  const [zeigeInaktive, setZeigeInaktive] = useState(false);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [z, b] = await Promise.all([
      supabase
        .from("unterkunft_zimmer_uebersicht")
        .select("*")
        .order("gebaeude_name")
        .order("nummer"),
      supabase.from("unterkunft_belegung_aktuell").select("*"),
    ]);
    setZimmer((z.data as UnterkunftZimmerUebersicht[]) ?? []);
    setBelegungen((b.data as UnterkunftBelegungAktuell[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  const gebaeudeListe = useMemo(
    () => Array.from(new Set(zimmer.map((z) => z.gebaeude_name))).sort(),
    [zimmer]
  );

  const belegungProZimmer = useMemo(() => {
    const map: Record<number, UnterkunftBelegungAktuell[]> = {};
    belegungen.forEach((b) => {
      (map[b.zimmer_id] ??= []).push(b);
    });
    return map;
  }, [belegungen]);

  const gefiltert = zimmer.filter((z) => {
    if (!z.aktiv && !zeigeInaktive) return false;
    if (gebaeudeFilter && z.gebaeude_name !== gebaeudeFilter) return false;
    if (nurMitLuecke && z.frei <= 0 && z.offene_maengel === 0) return false;
    return true;
  });

  const summe = gefiltert.reduce(
    (acc, z) => ({
      betten: acc.betten + z.betten,
      belegt: acc.belegt + z.belegt,
      frei: acc.frei + z.frei,
      maengel: acc.maengel + z.offene_maengel,
    }),
    { betten: 0, belegt: 0, frei: 0, maengel: 0 }
  );

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  return (
    <div className="space-y-6">
      <UnterkunftTabs />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">Belegungsplan</h1>
          <p className="text-sm text-neutral-500">
            Stand heute · {summe.belegt} belegt · {summe.frei} frei · {summe.maengel}{" "}
            offene Mängel
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label>
            Gebäude
            <select
              className="ml-2"
              value={gebaeudeFilter}
              onChange={(e) => setGebaeudeFilter(e.target.value)}
            >
              <option value="">alle</option>
              {gebaeudeListe.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={nurMitLuecke}
              onChange={(e) => setNurMitLuecke(e.target.checked)}
            />
            nur freie Betten / Mängel
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={zeigeInaktive}
              onChange={(e) => setZeigeInaktive(e.target.checked)}
            />
            inaktive Zimmer zeigen
          </label>
        </div>
      </div>

      {zimmer.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Noch keine Zimmer angelegt – unter <strong>Stammdaten</strong> beginnen.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Gebäude</th>
              <th>Zimmer</th>
              <th>Wohneinheit</th>
              <th>Belegt / Betten</th>
              <th>Frei</th>
              <th>Schwebend</th>
              <th>Bewohner heute</th>
              <th>Letzte Kontrolle</th>
              <th>Offene Mängel</th>
            </tr>
          </thead>
          <tbody>
            {gefiltert.map((z) => {
              const bew = belegungProZimmer[z.zimmer_id] ?? [];
              return (
                <tr key={z.zimmer_id} className={z.aktiv ? "" : "text-neutral-400"}>
                  <td>{z.gebaeude_name}</td>
                  <td className="font-medium">
                    {z.nummer}
                    {!z.aktiv && " (inaktiv)"}
                  </td>
                  <td>
                    {z.wohneinheit_name ?? "—"}
                    {z.etage_label ? ` · ${z.etage_label}` : ""}
                  </td>
                  <td>
                    {z.belegt} / {z.betten}
                  </td>
                  <td className={z.frei > 0 ? "font-medium text-emerald-700" : ""}>
                    {z.frei}
                  </td>
                  <td className={z.schwebend > 0 ? "text-amber-700" : ""}>
                    {z.schwebend > 0 ? z.schwebend : "—"}
                  </td>
                  <td>
                    {bew.length === 0
                      ? "—"
                      : bew
                          .map((b) => `${b.vorname} ${b.name} (${b.personal_nr})`)
                          .join(", ")}
                  </td>
                  <td>
                    {z.letzte_kontrolle_am
                      ? `${formatDatumDE(z.letzte_kontrolle_am)}${
                          z.letzte_kontrolle_typ
                            ? ` · ${UNTERKUNFT_VORGANG_TYP_LABELS[z.letzte_kontrolle_typ]}`
                            : ""
                        }`
                      : "noch keine"}
                  </td>
                  <td className={z.offene_maengel > 0 ? "font-medium text-red-600" : ""}>
                    {z.offene_maengel > 0 ? z.offene_maengel : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
