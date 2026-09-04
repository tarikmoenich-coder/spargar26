"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import {
  ANZAHL_PERSONALNUMMERN_KREISE,
  kreisBereich,
  naechsteFreieNummer,
  parsePersonalNrNummer,
} from "@/lib/personalnummern";
import PersonalTabs from "@/components/PersonalTabs";

interface Row {
  personal_nr: string;
  herkunft: string | null;
  name: string;
  vorname: string;
  aktiv: boolean;
}

export default function PersonalnummernPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = getSupabaseClient();
      // Absichtlich ohne .eq("aktiv", true): auch inaktive Mitarbeiter
      // behalten ihre Nummer für immer (kein Hard-Delete, ADR-011).
      // Seitenweise, sonst schneidet PostgREST bei ~1000 Zeilen ab und
      // Nummern dahinter gälten fälschlich als frei.
      const rows = await ladeAlleSeiten<Row>((von, bis) =>
        supabase
          .from("employees")
          .select("personal_nr, herkunft, name, vorname, aktiv")
          .order("personal_nr")
          .range(von, bis)
      );
      setRows(rows);
      setLoading(false);
    }
    load();
  }, []);

  const duplikate = useMemo(() => {
    const byKey = new Map<string, Row[]>();
    for (const r of rows) {
      const key = r.personal_nr.trim().toLowerCase();
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(r);
    }
    return Array.from(byKey.values()).filter((group) => group.length > 1);
  }, [rows]);

  const kreise = useMemo(() => {
    const result = [];
    for (let kreis = 1; kreis <= ANZAHL_PERSONALNUMMERN_KREISE; kreis++) {
      const [von, bis] = kreisBereich(kreis);
      const belegt = new Set<number>();
      const herkuenfte = new Map<string, number>();
      for (const r of rows) {
        const num = parsePersonalNrNummer(r.personal_nr);
        if (num === null || num < von || num > bis) continue;
        belegt.add(num);
        const h = r.herkunft?.trim() || "unbekannt";
        herkuenfte.set(h, (herkuenfte.get(h) ?? 0) + 1);
      }
      result.push({
        kreis,
        von,
        bis,
        belegtAnzahl: belegt.size,
        gesamt: bis - von + 1,
        naechsteFreie: naechsteFreieNummer(belegt, kreis),
        herkuenfte: Array.from(herkuenfte.entries()).sort(
          (a, b) => b[1] - a[1]
        ),
      });
    }
    return result;
  }, [rows]);

  const nichtNumerisch = useMemo(
    () => rows.filter((r) => parsePersonalNrNummer(r.personal_nr) === null),
    [rows]
  );

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Personalnummern
        </h1>
        <p className="text-sm text-neutral-500">
          Übersicht über die 10 Personalnummern-Kreise (Kreis 1: 1–999, Kreis
          2: 1000–1999, usw.) und ob eine Nummer doppelt vergeben wurde.
          Deaktivierte Mitarbeiter zählen weiter als „belegt“, da ihre Nummer
          aus Historiengründen nicht neu vergeben wird.
        </p>
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-emerald-800">
              Doppelt vergebene Personalnummern
            </h2>
            {duplikate.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Keine doppelten Personalnummern gefunden.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Personalnummer</th>
                    <th>Betroffene Mitarbeiter</th>
                  </tr>
                </thead>
                <tbody>
                  {duplikate.map((group) => (
                    <tr key={group[0].personal_nr}>
                      <td>{group[0].personal_nr}</td>
                      <td>
                        {group
                          .map(
                            (r) =>
                              `${r.name}, ${r.vorname}${
                                r.aktiv ? "" : " (inaktiv)"
                              }`
                          )
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-emerald-800">
              Kreise
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Kreis</th>
                  <th>Bereich</th>
                  <th>Belegt</th>
                  <th>Nächste freie Nummer</th>
                  <th>Herkunft laut Personaldaten</th>
                </tr>
              </thead>
              <tbody>
                {kreise.map((k) => (
                  <tr key={k.kreis}>
                    <td>{k.kreis}</td>
                    <td>
                      {k.von}–{k.bis}
                    </td>
                    <td>
                      {k.belegtAnzahl} / {k.gesamt}
                    </td>
                    <td className="font-medium">
                      {k.naechsteFreie ?? "Kreis voll"}
                    </td>
                    <td>
                      {k.herkuenfte.length === 0
                        ? "—"
                        : k.herkuenfte
                            .map(([h, n]) => `${h} (${n})`)
                            .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {nichtNumerisch.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-emerald-800">
                Nicht zuordenbare Personalnummern
              </h2>
              <p className="text-sm text-neutral-500">
                Diese Nummern beginnen nicht mit einer Ziffer und lassen sich
                daher keinem Kreis zuordnen.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Personalnummer</th>
                    <th>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {nichtNumerisch.map((r) => (
                    <tr key={r.personal_nr}>
                      <td>{r.personal_nr}</td>
                      <td>
                        {r.name}, {r.vorname}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
