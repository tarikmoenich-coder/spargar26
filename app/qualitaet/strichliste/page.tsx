"use client";

// Qualität → Strichliste / Nacharbeit (Nutzer-Vorgabe 2026-09-10, auf
// Tagesebene vereinfacht 2026-09-14: "Vormittag und Nachmittag kann zu
// Tagessumme zusammengefasst werden"). Das A3-Papierblatt an der
// Kistenannahme bleibt nach Vormittag/Nachmittag getrennt das
// Live-Arbeitsblatt; hier kommt am Tagesende je Person nur EINE Zahl rein:
// wie viele Kisten in die Nacharbeit gingen.
//
// "Kisten i.O." wird bewusst NICHT mehr erfasst - das war dieselbe Zahl wie
// die Prämien-Kisten des Tages (zuckermais_rohdaten.kisten), nur ein
// zweites Mal von Hand eingetippt (Nutzer-Feedback: "was mir gerade nicht
// gefällt ist, dass ich bei Prämien die Kisten erfasse und bei
// Strichliste/Nacharbeit nochmal"). "i.O." wird hier nur noch angezeigt,
// berechnet aus Prämien-Kisten - Nacharbeit (Sicht zuckermais_annahme_quote).

import PageHeader from "@/components/PageHeader";
import { ListChecks } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import { formatDatumDE } from "@/lib/format";
import { MENUE_RECHTE } from "@/lib/rollen";
import type { Employee, UserRole } from "@/lib/types";

function heuteIso() {
  return new Date().toISOString().slice(0, 10);
}
// Standardvorschlag für die Strichliste (Nutzer-Vorgabe 2026-09-16): wird
// meist am Folgetag für den Vortag nachgetragen, "gestern" spart das
// Umstellen.
function gesternIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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

  const [datum, setDatum] = useState(gesternIso());

  const [personen, setPersonen] = useState<Employee[]>([]);
  // Prämien-Kisten des Tages je Person - null, solange dort noch nichts
  // erfasst ist (siehe Hinweis in der Zeile).
  const [praemieKisten, setPraemieKisten] = useState<Record<string, number | null>>({});
  const [nacharbeitFelder, setNacharbeitFelder] = useState<Record<string, string>>({});
  const [laden, setLaden] = useState(true);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichertUm, setGespeichertUm] = useState<string | null>(null);

  const laed = useCallback(async () => {
    setLaden(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: praemien }, { data: annahme }] = await Promise.all([
      supabase
        .from("employees")
        .select("*")
        .eq("aktiv", true)
        .eq("praemien_zuckermais", true)
        .order("name")
        .order("vorname"),
      supabase
        .from("zuckermais_rohdaten")
        .select("employee_id, kisten")
        .eq("datum", datum),
      supabase
        .from("zuckermais_annahme")
        .select("*")
        .eq("datum", datum),
    ]);
    const liste = (emp as Employee[]) ?? [];
    setPersonen(liste);

    const praemieMap: Record<string, number | null> = {};
    (
      (praemien as { employee_id: string; kisten: number }[]) ?? []
    ).forEach((p) => {
      praemieMap[p.employee_id] = p.kisten;
    });
    liste.forEach((e) => {
      if (!(e.id in praemieMap)) praemieMap[e.id] = null;
    });
    setPraemieKisten(praemieMap);

    const annahmeMap: Record<string, string> = {};
    (
      (annahme as { employee_id: string; kisten_nacharbeit: number }[]) ?? []
    ).forEach((a) => {
      annahmeMap[a.employee_id] = String(a.kisten_nacharbeit);
    });
    const next: Record<string, string> = {};
    liste.forEach((e) => {
      next[e.id] = annahmeMap[e.id] ?? "";
    });
    setNacharbeitFelder(next);
    setLaden(false);
  }, [datum]);

  useEffect(() => {
    laed();
  }, [laed]);

  function setzeNacharbeit(id: string, roh: string) {
    const v = roh.replace(/[^\d]/g, "");
    setNacharbeitFelder((prev) => ({ ...prev, [id]: v }));
    setGespeichertUm(null);
  }

  async function alleSpeichern() {
    setSpeichert(true);
    setFehler(null);
    const supabase = getSupabaseClient();

    const upserts: { datum: string; employee_id: string; kisten_nacharbeit: number }[] = [];
    const leeren: string[] = [];

    for (const e of personen) {
      const na = nacharbeitFelder[e.id] === "" ? 0 : Number(nacharbeitFelder[e.id]);
      if (na === 0) {
        leeren.push(e.id);
      } else {
        upserts.push({ datum, employee_id: e.id, kisten_nacharbeit: na });
      }
    }

    if (upserts.length > 0) {
      const { error } = await supabase
        .from("zuckermais_annahme")
        .upsert(upserts, { onConflict: "datum,employee_id" });
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
        .in("employee_id", leeren);
      if (error) {
        setFehler(error.message);
        setSpeichert(false);
        return;
      }
    }
    setSpeichert(false);
    setGespeichertUm(
      new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    );
    laed();
  }

  const summe = useMemo(() => {
    let io = 0;
    let na = 0;
    let personenMitNacharbeit = 0;
    let ohnePraemie = 0;
    for (const e of personen) {
      const naWert = nacharbeitFelder[e.id] === "" ? 0 : Number(nacharbeitFelder[e.id]);
      if (naWert > 0) personenMitNacharbeit += 1;
      na += naWert;
      const kistenPraemie = praemieKisten[e.id];
      if (kistenPraemie == null) {
        if (naWert > 0) ohnePraemie += 1;
      } else {
        io += Math.max(kistenPraemie - naWert, 0);
      }
    }
    return { io, na, gesamt: io + na, personenMitNacharbeit, ohnePraemie };
  }, [personen, nacharbeitFelder, praemieKisten]);

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
        <PageHeader icon={ListChecks} titel="Qualität – Strichliste / Nacharbeit" />
        <p className="text-sm text-neutral-500">
          Am Tagesende je Person nur die Nacharbeit vom Papierblatt der
          Kistenannahme eintragen. „Kisten i.O." wird nicht mehr separat
          erfasst, sondern aus den Prämien-Kisten desselben Tages abgeleitet
          (dort schon einmal eingetippt). Erscheint in der Statistik
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
        <div className="ml-auto text-sm text-neutral-500">
          {summe.personenMitNacharbeit} Person(en) mit Nacharbeit · {summe.na}{" "}
          Nacharbeit{" "}
          {summe.gesamt > 0 && (
            <span className={quoteKlasse(quote(summe.na, summe.gesamt))}>
              Ø {quote(summe.na, summe.gesamt) ?? "—"} %
            </span>
          )}
        </div>
      </div>

      {fehler && (
        <p className="rounded border border-beere-300 bg-beere-50 px-3 py-2 text-sm text-beere-800">
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
                  <th className="px-3 py-2 font-medium">Kisten (Prämie)</th>
                  <th className="px-3 py-2 font-medium">Nacharbeit</th>
                  <th className="px-3 py-2 font-medium">Kisten i.O.</th>
                  <th className="px-3 py-2 font-medium">Quote</th>
                </tr>
              </thead>
              <tbody>
                {personen.map((e) => {
                  const kistenPraemie = praemieKisten[e.id] ?? null;
                  const na =
                    nacharbeitFelder[e.id] === "" ? 0 : Number(nacharbeitFelder[e.id] || 0);
                  const io = kistenPraemie != null ? Math.max(kistenPraemie - na, 0) : null;
                  const gesamt = kistenPraemie ?? 0;
                  const q = kistenPraemie != null ? quote(na, gesamt) : null;
                  return (
                    <tr key={e.id} className="border-b border-linie last:border-0">
                      <td className="px-3 py-1.5">{name(e)}</td>
                      <td className="px-3 py-1.5 text-neutral-600">
                        {kistenPraemie != null ? (
                          kistenPraemie
                        ) : (
                          <span
                            className="text-amber-700"
                            title="Für diesen Tag noch keine Prämien-Kisten erfasst (Prämien → Zuckermais)"
                          >
                            fehlt noch
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-20"
                          disabled={!canWrite}
                          value={nacharbeitFelder[e.id] ?? ""}
                          onChange={(ev) => setzeNacharbeit(e.id, ev.target.value)}
                        />
                      </td>
                      <td className="px-3 py-1.5">{io ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        {q !== null ? (
                          <span className={quoteKlasse(q)}>{q} %</span>
                        ) : (
                          <span className="text-neutral-300">—</span>
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
                  Gespeichert um {gespeichertUm} Uhr ({formatDatumDE(datum)}).
                </span>
              )}
              {summe.ohnePraemie > 0 && (
                <span className="text-sm text-amber-700">
                  ⚠ {summe.ohnePraemie} Person(en) mit Nacharbeit, aber ohne
                  Prämien-Kisten für diesen Tag - „i.O." kann erst berechnet
                  werden, wenn die Prämie erfasst ist.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
