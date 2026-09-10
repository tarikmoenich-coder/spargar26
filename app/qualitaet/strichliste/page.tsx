"use client";

// Qualität → Strichliste / Nacharbeit (Nutzer-Vorgabe 2026-09-10). Das
// A3-Papierblatt an der Kistenannahme bleibt das Live-Arbeitsblatt; hier
// kommt am Schichtende je Person die Summe rein: wie viele Kisten i.O.
// angenommen und wie viele in die Nacharbeit gegangen sind. Daraus die
// Nacharbeitsquote je Person - erstmal reine Anzeige (Statistik →
// Zuckermais), keine Prämienwirkung. Tabelle zuckermais_annahme.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import { formatDatumDE } from "@/lib/format";
import { MENUE_RECHTE } from "@/lib/rollen";
import type {
  Employee,
  QsSchicht,
  UserRole,
  ZuckermaisAnnahme,
} from "@/lib/types";

function heuteIso() {
  return new Date().toISOString().slice(0, 10);
}
// Schicht automatisch aus der Uhrzeit: ab 14:00 Nachmittag, davor Vormittag
// (gleiche Regel wie in der Schichtkontrolle).
function schichtJetzt(): QsSchicht {
  return new Date().getHours() >= 14 ? "nachmittag" : "vormittag";
}
function quote(nacharbeit: number, gesamt: number): number | null {
  return gesamt > 0 ? Math.round((nacharbeit / gesamt) * 1000) / 10 : null;
}
function quoteKlasse(q: number | null): string {
  if (q === null) return "badge badge-neutral";
  if (q <= 3) return "badge badge-ok";
  if (q <= 8) return "badge badge-warn";
  return "badge badge-danger";
}
function name(e: Employee): string {
  return `${e.name}${e.vorname ? ", " + e.vorname : ""}`;
}

type Feld = { io: string; nacharbeit: string };
const LEER: Feld = { io: "", nacharbeit: "" };

export default function StrichlistePage() {
  const { profile } = useProfile();
  const canSee =
    !!profile &&
    (MENUE_RECHTE["/qualitaet"] ?? []).includes(profile.role as UserRole);
  const canWrite =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung" ||
    profile?.role === "erntewirtschaft";

  const [datum, setDatum] = useState(heuteIso());
  const [schicht, setSchicht] = useState<QsSchicht>(schichtJetzt);

  const [personen, setPersonen] = useState<Employee[]>([]);
  const [werte, setWerte] = useState<Record<string, Feld>>({});
  const [laden, setLaden] = useState(true);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichertUm, setGespeichertUm] = useState<string | null>(null);

  const laed = useCallback(async () => {
    setLaden(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: rows }] = await Promise.all([
      supabase
        .from("employees")
        .select("*")
        .eq("aktiv", true)
        .eq("praemien_zuckermais", true)
        .order("name")
        .order("vorname"),
      supabase
        .from("zuckermais_annahme")
        .select("*")
        .eq("datum", datum)
        .eq("schicht", schicht),
    ]);
    const liste = (emp as Employee[]) ?? [];
    setPersonen(liste);
    const vorhanden: Record<string, Feld> = {};
    ((rows as ZuckermaisAnnahme[]) ?? []).forEach((r) => {
      vorhanden[r.employee_id] = {
        io: String(r.kisten_io),
        nacharbeit: String(r.kisten_nacharbeit),
      };
    });
    const next: Record<string, Feld> = {};
    liste.forEach((e) => {
      next[e.id] = vorhanden[e.id] ?? { ...LEER };
    });
    setWerte(next);
    setLaden(false);
  }, [datum, schicht]);

  useEffect(() => {
    laed();
  }, [laed]);

  function setzeFeld(id: string, teil: keyof Feld, roh: string) {
    // nur ganze, nicht-negative Zahlen
    const v = roh.replace(/[^\d]/g, "");
    setWerte((prev) => ({ ...prev, [id]: { ...(prev[id] ?? LEER), [teil]: v } }));
    setGespeichertUm(null);
  }

  async function alleSpeichern() {
    setSpeichert(true);
    setFehler(null);
    const supabase = getSupabaseClient();

    const upserts: {
      datum: string;
      schicht: QsSchicht;
      employee_id: string;
      kisten_io: number;
      kisten_nacharbeit: number;
      erfasst_von: string | null;
    }[] = [];
    const leeren: string[] = [];

    for (const e of personen) {
      const f = werte[e.id] ?? LEER;
      const io = f.io === "" ? 0 : Number(f.io);
      const na = f.nacharbeit === "" ? 0 : Number(f.nacharbeit);
      if (io === 0 && na === 0) {
        leeren.push(e.id);
      } else {
        upserts.push({
          datum,
          schicht,
          employee_id: e.id,
          kisten_io: io,
          kisten_nacharbeit: na,
          erfasst_von: profile?.id ?? null,
        });
      }
    }

    if (upserts.length > 0) {
      const { error } = await supabase
        .from("zuckermais_annahme")
        .upsert(upserts, { onConflict: "datum,schicht,employee_id" });
      if (error) {
        setFehler(error.message);
        setSpeichert(false);
        return;
      }
    }
    // Auf 0/leer gesetzte Zeilen entfernen (wie bei den Prämien-Rohdaten:
    // ein geleertes Feld löscht den Eintrag).
    if (leeren.length > 0) {
      const { error } = await supabase
        .from("zuckermais_annahme")
        .delete()
        .eq("datum", datum)
        .eq("schicht", schicht)
        .in("employee_id", leeren);
      if (error) {
        setFehler(error.message);
        setSpeichert(false);
        return;
      }
    }
    setSpeichert(false);
    setGespeichertUm(
      new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
    laed();
  }

  const summe = useMemo(() => {
    let io = 0;
    let na = 0;
    let personenMitDaten = 0;
    for (const e of personen) {
      const f = werte[e.id] ?? LEER;
      const pIo = f.io === "" ? 0 : Number(f.io);
      const pNa = f.nacharbeit === "" ? 0 : Number(f.nacharbeit);
      if (pIo > 0 || pNa > 0) personenMitDaten += 1;
      io += pIo;
      na += pNa;
    }
    return { io, na, gesamt: io + na, personenMitDaten };
  }, [personen, werte]);

  if (profile && !canSee) {
    return (
      <div className="flex flex-col gap-4">
        <ErntewirtschaftTabs />
        <p className="text-neutral-500">
          Die Strichliste ist nur für admin/hr/zeiterfassung/lohnabrechnung/
          management/erntewirtschaft.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />

      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Qualität – Strichliste / Nacharbeit
        </h1>
        <p className="text-sm text-neutral-500">
          Am Schichtende je Person die Summe vom Papierblatt der Kistenannahme
          eintragen: angenommene Kisten (i.O.) und Kisten in die Nacharbeit.
          Daraus die Nacharbeitsquote – erscheint in der Statistik
          (Erntewirtschaft → Statistik → Zuckermais), ohne Prämienwirkung.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded border border-linie bg-white px-3 py-2">
        <label className="text-sm">
          Datum
          <input
            type="date"
            className="mt-1 block"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Schicht
          <select
            className="mt-1 block"
            value={schicht}
            onChange={(e) => setSchicht(e.target.value as QsSchicht)}
          >
            <option value="vormittag">Vormittag</option>
            <option value="nachmittag">Nachmittag</option>
          </select>
        </label>
        <div className="ml-auto text-sm text-neutral-500">
          {summe.personenMitDaten} Person(en) · {summe.io} i.O. · {summe.na}{" "}
          Nacharbeit{" "}
          {summe.gesamt > 0 && (
            <span className={quoteKlasse(quote(summe.na, summe.gesamt))}>
              Ø {quote(summe.na, summe.gesamt) ?? "—"} %
            </span>
          )}
        </div>
      </div>

      {fehler && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {fehler}
        </p>
      )}

      {laden ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : personen.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Keine aktiven, dem Zuckermais zugeordneten Personen. In der
          Gruppenaufteilung bzw. im Personalstamm setzen (Prämien Zuckermais).
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-linie bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-linie text-left text-neutral-500">
                  <th className="px-3 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 font-medium">Kisten i.O.</th>
                  <th className="px-3 py-2 font-medium">Nacharbeit</th>
                  <th className="px-3 py-2 font-medium">Quote</th>
                </tr>
              </thead>
              <tbody>
                {personen.map((e) => {
                  const f = werte[e.id] ?? LEER;
                  const io = f.io === "" ? 0 : Number(f.io);
                  const na = f.nacharbeit === "" ? 0 : Number(f.nacharbeit);
                  const q = quote(na, io + na);
                  return (
                    <tr
                      key={e.id}
                      className="border-b border-linie last:border-0"
                    >
                      <td className="px-3 py-1.5">{name(e)}</td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-20"
                          disabled={!canWrite}
                          value={f.io}
                          onChange={(ev) =>
                            setzeFeld(e.id, "io", ev.target.value)
                          }
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-20"
                          disabled={!canWrite}
                          value={f.nacharbeit}
                          onChange={(ev) =>
                            setzeFeld(e.id, "nacharbeit", ev.target.value)
                          }
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        {io + na > 0 ? (
                          <span className={quoteKlasse(q)}>{q} %</span>
                        ) : (
                          <span className="text-neutral-300">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canWrite && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn"
                onClick={alleSpeichern}
                disabled={speichert}
              >
                {speichert ? "Speichert…" : "Alle speichern"}
              </button>
              {gespeichertUm && (
                <span className="text-sm text-emerald-700">
                  Gespeichert um {gespeichertUm} Uhr ({formatDatumDE(datum)},{" "}
                  {schicht === "vormittag" ? "Vormittag" : "Nachmittag"}).
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
