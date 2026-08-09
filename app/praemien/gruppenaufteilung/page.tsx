"use client";

// Prämien → Gruppenaufteilung (Nutzer-Vorgabe 2026-08-09): entscheidet, WER
// überhaupt in den Prämien-Erfassungsseiten (Zuckermais/Erdbeeren/Spargel)
// auftaucht - unabhängig von den Stundenerfassungs-Gruppen
// (employees.gruppe_nr), die weiterhin unverändert wichtig bleiben. Nur
// ein einfaches An/Aus je Kultur (employees.praemien_zuckermais/
// _erdbeeren/_spargel), keine neue eigene Gruppen-Ebene. Die bestehenden
// Gruppen/Herkünfte dienen hier nur als Filter, um schnell viele Personen
// auf einmal auszuwählen (z.B. "alle aus Gruppe 101" oder "alle aus
// Rumänien"). Nur admin/hr (wie andere Personalstamm-Änderungen).

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import PraemienTabs from "@/components/PraemienTabs";
import type { Arbeitsgruppe, Employee, Herkunft } from "@/lib/types";

type Kultur = "praemien_zuckermais" | "praemien_erdbeeren" | "praemien_spargel";

const KULTUREN: { wert: Kultur; label: string }[] = [
  { wert: "praemien_zuckermais", label: "Zuckermais" },
  { wert: "praemien_erdbeeren", label: "Erdbeeren" },
  { wert: "praemien_spargel", label: "Spargel" },
];

export default function PraemienGruppenaufteilungPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  const [gruppeFilter, setGruppeFilter] = useState("");
  const [herkunftFilter, setHerkunftFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<string>>(new Set());
  const [kultur, setKultur] = useState<Kultur>("praemien_zuckermais");
  const [loading, setLoading] = useState(true);
  const [speichern, setSpeichern] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: gr }, { data: hk }] = await Promise.all([
      supabase.from("employees").select("*").order("name"),
      supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
      supabase.from("herkuenfte").select("*").order("reihenfolge"),
    ]);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    setHerkuenfte((hk as Herkunft[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const gefiltert = employees
    .filter((e) => showInactive || e.aktiv)
    .filter((e) => !gruppeFilter || e.gruppe_nr === gruppeFilter)
    .filter((e) => !herkunftFilter || e.herkunft === herkunftFilter);

  function toggleEins(id: string) {
    setAusgewaehlt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function alleTogglen() {
    const alleIds = gefiltert.map((e) => e.id);
    const alleAusgewaehlt = alleIds.every((id) => ausgewaehlt.has(id));
    setAusgewaehlt((prev) => {
      const next = new Set(prev);
      if (alleAusgewaehlt) {
        alleIds.forEach((id) => next.delete(id));
      } else {
        alleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  async function anwenden(wert: boolean) {
    if (ausgewaehlt.size === 0) return;
    setSpeichern(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("employees")
      .update({ [kultur]: wert })
      .in("id", Array.from(ausgewaehlt));
    setSpeichern(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setAusgewaehlt(new Set());
    load();
  }

  const gruppenByNr = new Map(gruppen.map((g) => [g.gruppe_nr, g]));
  const kulturLabel = KULTUREN.find((k) => k.wert === kultur)?.label ?? "";

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-4">
        <PraemienTabs />
        <p className="text-neutral-500">
          Nur admin/hr dürfen die Gruppenaufteilung ändern.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PraemienTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Prämien – Gruppenaufteilung
        </h1>
        <p className="text-sm text-neutral-500">
          Legt fest, wer in den Prämien-Erfassungsseiten (Zuckermais/
          Erdbeeren/Spargel) überhaupt auftaucht - unabhängig von den
          Stundenerfassungs-Gruppen, die weiterhin unverändert wichtig
          bleiben. Mit Gruppe/Herkunft filtern, Personen auswählen, dann
          einer Kultur hinzufügen oder daraus entfernen.
        </p>
      </div>

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-3 bg-neutral-50 py-2">
        <label className="text-sm">
          Gruppe{" "}
          <select
            value={gruppeFilter}
            onChange={(e) => setGruppeFilter(e.target.value)}
          >
            <option value="">Alle</option>
            {gruppen.map((g) => (
              <option key={g.gruppe_nr} value={g.gruppe_nr}>
                {g.gruppe_nr} – {g.bezeichnung}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Herkunft{" "}
          <select
            value={herkunftFilter}
            onChange={(e) => setHerkunftFilter(e.target.value)}
          >
            <option value="">Alle</option>
            {herkuenfte.map((h) => (
              <option key={h.wert} value={h.wert}>
                {h.wert}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          inaktive anzeigen
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-200 bg-white p-3">
        <span className="text-sm font-medium">
          {ausgewaehlt.size} Person(en) ausgewählt
        </span>
        <label className="text-sm">
          Kultur{" "}
          <select
            value={kultur}
            onChange={(e) => setKultur(e.target.value as Kultur)}
          >
            {KULTUREN.map((k) => (
              <option key={k.wert} value={k.wert}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={ausgewaehlt.size === 0 || speichern}
          onClick={() => anwenden(true)}
        >
          Zu {kulturLabel} hinzufügen
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={ausgewaehlt.size === 0 || speichern}
          onClick={() => anwenden(false)}
        >
          Von {kulturLabel} entfernen
        </button>
        {fehler && <span className="text-sm text-red-600">⚠ {fehler}</span>}
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    onChange={alleTogglen}
                    checked={
                      gefiltert.length > 0 &&
                      gefiltert.every((e) => ausgewaehlt.has(e.id))
                    }
                    title="Markiert/entmarkiert alle sichtbaren (gefilterten) Zeilen"
                  />
                </th>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Gruppe</th>
                <th>Herkunft</th>
                <th>Zuckermais</th>
                <th>Erdbeeren</th>
                <th>Spargel</th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((e) => (
                <tr key={e.id} className={e.aktiv ? "" : "opacity-60"}>
                  <td>
                    <input
                      type="checkbox"
                      checked={ausgewaehlt.has(e.id)}
                      onChange={() => toggleEins(e.id)}
                    />
                  </td>
                  <td>{e.personal_nr}</td>
                  <td>
                    {e.name}, {e.vorname}
                  </td>
                  <td className="text-sm text-neutral-500">
                    {e.gruppe_nr
                      ? `${e.gruppe_nr} – ${
                          gruppenByNr.get(e.gruppe_nr)?.bezeichnung ?? e.gruppe_nr
                        }`
                      : "—"}
                  </td>
                  <td className="text-sm text-neutral-500">
                    {e.herkunft ?? "—"}
                  </td>
                  <td className="text-center">
                    {e.praemien_zuckermais ? "✓" : "—"}
                  </td>
                  <td className="text-center">
                    {e.praemien_erdbeeren ? "✓" : "—"}
                  </td>
                  <td className="text-center">
                    {e.praemien_spargel ? "✓" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
