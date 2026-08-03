"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Employee, WorkEntry } from "@/lib/types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function ErfassungPage() {
  const [datum, setDatum] = useState(todayIso());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<Record<string, WorkEntry>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadAll = useCallback(async (forDate: string) => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: we }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname, aktiv")
        .eq("aktiv", true)
        .order("name"),
      supabase.from("work_entries").select("*").eq("datum", forDate),
    ]);
    setEmployees((emp as Employee[]) ?? []);
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

  const gesamtStunden = Object.values(entries).reduce(
    (sum, e) => sum + (e.stunden ?? 0),
    0
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Stundenerfassung
        </h1>
        <p className="text-sm text-neutral-500">
          Änderungen werden sofort für alle angemeldeten Nutzer sichtbar
          (Live-Sync). „U“ = Urlaub/Feiertag.
        </p>
      </div>

      <div className="flex items-center gap-3">
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

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Pers.-Nr.</th>
              <th>Name</th>
              <th>Stunden</th>
              <th>Markierung</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
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
      )}
    </div>
  );
}
