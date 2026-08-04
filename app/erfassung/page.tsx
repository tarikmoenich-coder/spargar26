"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Arbeitsgruppe, Employee, WorkEntry } from "@/lib/types";

const OHNE_GRUPPE_KEY = "__ohne__";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

interface Gruppierung {
  key: string;
  bezeichnung: string;
  employees: Employee[];
}

function gruppiere(
  employees: Employee[],
  gruppen: Arbeitsgruppe[]
): Gruppierung[] {
  const gruppenByNr = new Map(gruppen.map((g) => [g.gruppe_nr, g]));
  const buckets = new Map<string, Employee[]>();
  for (const emp of employees) {
    const key = emp.gruppe_nr ?? OHNE_GRUPPE_KEY;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(emp);
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === OHNE_GRUPPE_KEY) return 1;
    if (b === OHNE_GRUPPE_KEY) return -1;
    const ra = gruppenByNr.get(a)?.reihenfolge ?? 0;
    const rb = gruppenByNr.get(b)?.reihenfolge ?? 0;
    return ra - rb || a.localeCompare(b);
  });
  return keys.map((key) => ({
    key,
    bezeichnung:
      key === OHNE_GRUPPE_KEY
        ? "Ohne Gruppe"
        : gruppenByNr.get(key)?.bezeichnung ?? key,
    employees: buckets.get(key)!,
  }));
}

export default function ErfassungPage() {
  const [datum, setDatum] = useState(todayIso());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [entries, setEntries] = useState<Record<string, WorkEntry>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [printGroupKey, setPrintGroupKey] = useState<string | null>(null);

  const loadAll = useCallback(async (forDate: string) => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: we }, { data: gr }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname, aktiv, gruppe_nr")
        .eq("aktiv", true)
        .order("name"),
      supabase.from("work_entries").select("*").eq("datum", forDate),
      supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
    ]);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    const map: Record<string, WorkEntry> = {};
    ((we as WorkEntry[]) ?? []).forEach((row) => {
      map[row.employee_id] = row;
    });
    setEntries(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll(datum);
  }, [datum, loadAll]);

  // Live-Sync: Änderungen anderer Nutzer an diesem Tag sofort übernehmen.
  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`work_entries_${datum}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "work_entries",
          filter: `datum=eq.${datum}`,
        },
        (payload) => {
          setEntries((prev) => {
            const next = { ...prev };
            if (payload.eventType === "DELETE") {
              const oldRow = payload.old as WorkEntry;
              delete next[oldRow.employee_id];
            } else {
              const row = payload.new as WorkEntry;
              next[row.employee_id] = row;
            }
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [datum]);

  // Druck: nach dem Öffnen des Druckdialogs (oder Abbruch) Auswahl zurücksetzen.
  useEffect(() => {
    function handleAfterPrint() {
      setPrintGroupKey(null);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  useEffect(() => {
    if (printGroupKey === null) return;
    const id = setTimeout(() => window.print(), 50);
    return () => clearTimeout(id);
  }, [printGroupKey]);

  async function saveHours(employeeId: string, value: string) {
    setSavingId(employeeId);
    const supabase = getSupabaseClient();
    const stunden = value === "" ? null : Number(value);
    const existing = entries[employeeId];

    if (existing) {
      await supabase
        .from("work_entries")
        .update({ stunden })
        .eq("id", existing.id)
        .eq("version", existing.version); // optimistische Sperre (ADR-010)
    } else {
      await supabase.from("work_entries").insert({
        employee_id: employeeId,
        datum,
        stunden,
      });
    }
    setSavingId(null);
  }

  async function saveMarkierung(employeeId: string, markierung: string) {
    const supabase = getSupabaseClient();
    const existing = entries[employeeId];
    const value = markierung === "" ? null : markierung;
    if (existing) {
      await supabase
        .from("work_entries")
        .update({ markierung: value })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("work_entries")
        .insert({ employee_id: employeeId, datum, markierung: value });
    }
  }

  const gruppierungen = gruppiere(employees, gruppen);

  const gesamtStunden = Object.values(entries).reduce(
    (sum, e) => sum + (e.stunden ?? 0),
    0
  );

  function gruppenStunden(g: Gruppierung) {
    return g.employees.reduce(
      (sum, emp) => sum + (entries[emp.id]?.stunden ?? 0),
      0
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">
          Stundenerfassung
        </h1>
        <p className="text-sm text-neutral-500">
          Änderungen werden sofort für alle angemeldeten Nutzer sichtbar
          (Live-Sync). „U“ = Urlaub/Feiertag.
        </p>
      </div>

      <div className="flex items-center gap-3 print:hidden">
        <label className="text-sm">
          Datum{" "}
          <input
            type="date"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
          />
        </label>
        <span className="text-sm text-neutral-500">
          Tagessumme: {gesamtStunden.toFixed(2)} Std.
        </span>
      </div>

      {!loading && gruppierungen.length > 1 && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {gruppierungen.map((g) => (
            <a key={g.key} href={`#gruppe-${g.key}`} className="btn-secondary text-xs">
              {g.bezeichnung} ({g.employees.length})
            </a>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        gruppierungen.map((g) => (
          <section
            key={g.key}
            id={`gruppe-${g.key}`}
            className={
              printGroupKey && printGroupKey !== g.key ? "print:hidden" : ""
            }
          >
            <div className="hidden print:block">
              <h2 className="text-base font-semibold">
                Gruppenstundenzettel – {g.bezeichnung}
              </h2>
              <p className="text-sm">Datum: {datum}</p>
            </div>

            <div className="flex items-center justify-between gap-3 print:hidden">
              <h2 className="text-base font-semibold text-emerald-800">
                {g.bezeichnung}{" "}
                <span className="font-normal text-neutral-500">
                  ({g.employees.length} Pers., {gruppenStunden(g).toFixed(2)} Std.)
                </span>
              </h2>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setPrintGroupKey(g.key)}
              >
                Gruppe drucken
              </button>
            </div>

            <table className="print:hidden">
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Stunden</th>
                  <th>Markierung</th>
                </tr>
              </thead>
              <tbody>
                {g.employees.map((emp) => {
                  const entry = entries[emp.id];
                  return (
                    <tr key={emp.id}>
                      <td>{emp.personal_nr}</td>
                      <td>
                        {emp.name}, {emp.vorname}
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={24}
                          step={0.25}
                          className="w-20"
                          defaultValue={entry?.stunden ?? ""}
                          key={`${emp.id}-${entry?.version ?? 0}`}
                          onBlur={(e) => saveHours(emp.id, e.target.value)}
                          disabled={savingId === emp.id}
                        />
                      </td>
                      <td>
                        <select
                          defaultValue={entry?.markierung ?? ""}
                          key={`m-${emp.id}-${entry?.version ?? 0}`}
                          onChange={(e) =>
                            saveMarkierung(emp.id, e.target.value)
                          }
                        >
                          <option value="">—</option>
                          <option value="U">U (Urlaub/Feiertag)</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Reine Papier-Vorlage zum handschriftlichen Ausfüllen -
                bewusst ohne die digital erfassten Stunden, da vor Ort
                ausgefüllt und später übertragen wird. */}
            <table className="hidden print:table print-form-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Name</th>
                  <th colSpan={2}>Vormittag</th>
                  <th colSpan={2}>Nachmittag</th>
                  <th rowSpan={2}>Summe Std.</th>
                </tr>
                <tr>
                  <th>von</th>
                  <th>bis</th>
                  <th>von</th>
                  <th>bis</th>
                </tr>
              </thead>
              <tbody>
                {g.employees.map((emp) => (
                  <tr key={emp.id}>
                    <td>
                      {emp.name}, {emp.vorname}
                    </td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
