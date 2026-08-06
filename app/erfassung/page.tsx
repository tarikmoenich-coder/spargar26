"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type {
  Arbeitsgruppe,
  Employee,
  FuehrerscheinEintrag,
  Period,
  WorkEntry,
} from "@/lib/types";

const OHNE_GRUPPE_KEY = "__ohne__";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Reine Kalendertag-Arithmetik auf Basis von "YYYY-MM-DD" - bewusst über
// UTC-Millisekunden statt lokaler Zeitzone, damit ein Tagessprung nicht je
// nach Zeitzone/Sommerzeit auf den falschen Tag landen kann.
function addDays(iso: string, delta: number): string {
  const [j, m, t] = iso.split("-").map(Number);
  const ms = Date.UTC(j, m - 1, t) + delta * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Kurzform "Mo 04.08." für die Spaltenköpfe der vorherigen Tage.
function kurzDatum(iso: string): string {
  const [, m, t] = iso.split("-");
  const wochentag = new Date(`${iso}T00:00:00Z`).toLocaleDateString("de-DE", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${wochentag} ${t}.${m}.`;
}

interface Gruppierung {
  key: string;
  anzeige: string;
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
    anzeige:
      key === OHNE_GRUPPE_KEY
        ? "Ohne Gruppe"
        : `${key} – ${gruppenByNr.get(key)?.bezeichnung ?? key}`,
    employees: buckets.get(key)!,
  }));
}

function ErfassungInner() {
  const { profile } = useProfile();
  const canGruppeAendern =
    profile?.role === "admin" || profile?.role === "hr";
  // useSearchParams() statt window.location.search: reagiert zuverlässig
  // auch auf clientseitige <Link>-Navigation, bei der Next.js diese Route
  // wiederverwendet statt sie neu zu mounten (sonst würde ein Sprung-Link
  // von "?datum=...&employee=..." nur nach einem harten Reload wirken).
  const searchParams = useSearchParams();
  // Standardmäßig gestern vorausgewählt (Nutzer trägt meist die Stunden
  // des Vortages nach), nicht heute - außer ein Sprung-Link (z.B. vom
  // Stundenmonitoring im Management) gibt ein konkretes Datum vor.
  const [datum, setDatum] = useState(() => {
    const p = searchParams.get("datum");
    return p && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : addDays(todayIso(), -1);
  });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [entries, setEntries] = useState<Record<string, WorkEntry>>({});
  // Nur zur Kontrolle/Übersicht: Stunden der 3 vorherigen Tage, nicht
  // bearbeitbar - Bearbeitung bleibt auf das oben gewählte Datum beschränkt.
  const [vorherigeEntries, setVorherigeEntries] = useState<
    Record<string, Record<string, WorkEntry>>
  >({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [printGroupKey, setPrintGroupKey] = useState<string | null>(null);
  // Aus employee_fuehrerschein_kategorien (schmale, breit zugängliche
  // Sicht) - zeigt nur, DASS und WOFÜR jemand einen Führerschein hat.
  const [fuehrerschein, setFuehrerschein] = useState<
    Record<string, string[]>
  >({});
  // Monatsabschluss: ist der Monat des gewählten Datums gesperrt? Wird
  // serverseitig ohnehin über RLS durchgesetzt (siehe work_entries_write/
  // -update in schema.sql) - hier nur für die Anzeige/zum Sperren der
  // Eingabefelder, damit man nicht erst beim Speichern auf einen Fehler
  // läuft.
  const [periode, setPeriode] = useState<Period | null>(null);
  const gesperrt = periode?.gesperrt ?? false;

  const vorherigeDaten = [
    addDays(datum, -3),
    addDays(datum, -2),
    addDays(datum, -1),
  ];

  const loadAll = useCallback(async (forDate: string) => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const vorherige = [addDays(forDate, -3), addDays(forDate, -2), addDays(forDate, -1)];
    const [{ data: emp }, { data: we }, { data: gr }, { data: weVorher }] =
      await Promise.all([
        supabase
          .from("employees")
          .select("id, personal_nr, name, vorname, aktiv, gruppe_nr")
          .eq("aktiv", true)
          .order("name"),
        supabase.from("work_entries").select("*").eq("datum", forDate),
        supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
        supabase.from("work_entries").select("*").in("datum", vorherige),
      ]);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    const map: Record<string, WorkEntry> = {};
    ((we as WorkEntry[]) ?? []).forEach((row) => {
      map[row.employee_id] = row;
    });
    setEntries(map);
    const vorherigeMap: Record<string, Record<string, WorkEntry>> = {};
    ((weVorher as WorkEntry[]) ?? []).forEach((row) => {
      if (!vorherigeMap[row.datum]) vorherigeMap[row.datum] = {};
      vorherigeMap[row.datum][row.employee_id] = row;
    });
    setVorherigeEntries(vorherigeMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll(datum);
  }, [datum, loadAll]);

  useEffect(() => {
    async function ladePeriode() {
      const [jahrStr, monatStr] = datum.split("-");
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("periods")
        .select("*")
        .eq("saison_jahr", Number(jahrStr))
        .eq("monat", Number(monatStr))
        .maybeSingle();
      setPeriode((data as Period) ?? null);
    }
    ladePeriode();
  }, [datum]);

  // Beim Tageswechsel (Pfeil-Buttons oder Datumsfeld) bleibt man an
  // derselben Stelle: Merkt sich vor dem Wechsel, welches Stunden-Feld
  // fokussiert war (bzw. ersatzweise die Scroll-Position), und stellt das
  // nach dem Laden der neuen Daten wieder her - sonst springt die Ansicht
  // durch die kurze "Lädt…"-Anzeige nach ganz oben. Anfangswert kommt vom
  // "employee"-URL-Parameter eines Sprung-Links (z.B. Stundenmonitoring im
  // Management) - dieselbe Restore-Logik springt dann direkt zur Person.
  const fokusEmployeeIdRef = useRef<string | null>(
    searchParams.get("employee")
  );
  const scrollYRef = useRef<number | null>(null);

  function merkeFokusUndScroll() {
    const aktiv = document.activeElement as HTMLElement | null;
    fokusEmployeeIdRef.current = aktiv?.getAttribute("data-employee-id") ?? null;
    scrollYRef.current = window.scrollY;
  }

  function datumWechseln(neuesDatum: string) {
    merkeFokusUndScroll();
    setDatum(neuesDatum);
  }

  // Falls Next.js diese Seite bei einer erneuten Navigation von einem
  // Sprung-Link aus wiederverwendet (kein Neu-Mount, siehe Kommentar oben),
  // greift der Anfangswert von useState()/useRef() nicht mehr - deshalb
  // zusätzlich auf Änderungen der URL-Parameter selbst reagieren.
  useEffect(() => {
    const datumParam = searchParams.get("datum");
    const employeeParam = searchParams.get("employee");
    if (datumParam && /^\d{4}-\d{2}-\d{2}$/.test(datumParam)) {
      fokusEmployeeIdRef.current = employeeParam;
      setDatum(datumParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  useEffect(() => {
    if (loading) return;
    const empId = fokusEmployeeIdRef.current;
    const scrollY = scrollYRef.current;
    fokusEmployeeIdRef.current = null;
    scrollYRef.current = null;
    if (empId) {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-stunden-feld="true"][data-employee-id="${empId}"]`
      );
      if (el) {
        el.focus();
        el.select();
        el.scrollIntoView({ block: "center" });
        return;
      }
    }
    if (scrollY !== null) window.scrollTo({ top: scrollY });
  }, [loading]);

  useEffect(() => {
    async function ladeFuehrerschein() {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("employee_fuehrerschein_kategorien")
        .select("*");
      const map: Record<string, string[]> = {};
      ((data as FuehrerscheinEintrag[]) ?? []).forEach((row) => {
        map[row.employee_id] = row.fuehrerschein_kategorien;
      });
      setFuehrerschein(map);
    }
    ladeFuehrerschein();
  }, []);

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

  // Freitext-Vermerk zum Tag (z.B. "krank", "zu spät") - erscheint auch in
  // der "Suche"-Seite bei den Arbeitsstunden der Person.
  async function saveNotiz(employeeId: string, notiz: string) {
    const supabase = getSupabaseClient();
    const existing = entries[employeeId];
    const value = notiz.trim() === "" ? null : notiz;
    if (existing) {
      await supabase
        .from("work_entries")
        .update({ notiz: value })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("work_entries")
        .insert({ employee_id: employeeId, datum, notiz: value });
    }
  }

  // Pfeiltasten hoch/runter im Stunden-Feld springen direkt zum selben
  // Feld der vorherigen/nächsten Person, ohne erst Markierung/Notiz/Gruppe
  // dieser Zeile durchlaufen zu müssen (schnellere Eingabe als mit Tab).
  // Umschalt+Pfeil runter/hoch springt stattdessen beim GLEICHEN
  // Mitarbeiter einen Tag vor/zurück - praktisch zum Nacherfassen mehrerer
  // Tage in Folge, ohne die Maus zu benutzen. Nutzt dieselbe Fokus-Restore-
  // Logik wie die Datums-Pfeiltasten oben, nur dass hier gezielt DIESES
  // Feld gemerkt wird statt document.activeElement (das nach .blur()
  // schon nichts mehr wäre).
  function handleStundenKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const empId = e.currentTarget.getAttribute("data-employee-id");
      fokusEmployeeIdRef.current = empId;
      scrollYRef.current = window.scrollY;
      e.currentTarget.blur(); // löst das Speichern über onBlur aus
      setDatum((d) => addDays(d, e.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const felder = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[data-stunden-feld="true"]'
      )
    );
    const idx = felder.indexOf(e.currentTarget);
    if (idx === -1) return;
    const naechstes = felder[e.key === "ArrowDown" ? idx + 1 : idx - 1];
    naechstes?.focus();
    naechstes?.select();
  }

  async function gruppeAendern(employeeId: string, neueGruppeNr: string) {
    const supabase = getSupabaseClient();
    const gruppe_nr = neueGruppeNr || null;
    const { error } = await supabase
      .from("employees")
      .update({ gruppe_nr })
      .eq("id", employeeId);
    if (error) return; // z.B. fehlende Rechte - Auswahl bleibt unverändert
    setEmployees((prev) =>
      prev.map((e) => (e.id === employeeId ? { ...e, gruppe_nr } : e))
    );
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

      <div className="sticky top-14 z-30 flex flex-col gap-2 bg-neutral-50 py-2 print:hidden">
        <div className="flex items-center gap-3">
          <label className="text-sm">
            Datum{" "}
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                className="btn-secondary px-2 text-xs"
                onClick={() => datumWechseln(addDays(datum, -1))}
                title="Ein Tag zurück"
              >
                ←
              </button>
              <input
                type="date"
                value={datum}
                onChange={(e) => datumWechseln(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary px-2 text-xs"
                onClick={() => datumWechseln(addDays(datum, 1))}
                title="Ein Tag vor"
              >
                →
              </button>
            </span>
          </label>
          <span className="text-sm text-neutral-500">
            Tagessumme: {gesamtStunden.toFixed(2)} Std.
          </span>
        </div>

        {gesperrt && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            🔒 Dieser Monat ist im Rahmen des Monatsabschlusses gesperrt -
            die Stunden für diesen Tag können nicht mehr geändert werden.
            Zum Nachtragen muss der Monat auf der Lohnübersicht bewusst
            wieder geöffnet werden.
          </p>
        )}

        {!loading && gruppierungen.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {gruppierungen.map((g) => (
              <a key={g.key} href={`#gruppe-${g.key}`} className="btn-secondary text-xs">
                {g.anzeige} ({g.employees.length})
              </a>
            ))}
          </div>
        )}
      </div>

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
            <div className="hidden print:mb-4 print:block">
              <h2 className="text-xl font-semibold">
                Gruppenstundenzettel – {g.anzeige}
              </h2>
              <p className="mt-3 text-base">
                Datum:{" "}
                <span className="inline-block w-80 border-b-2 border-black">
                  &nbsp;
                </span>
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 print:hidden">
              <h2 className="text-base font-semibold text-emerald-800">
                {g.anzeige}{" "}
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
                  <th>Führerschein</th>
                  {vorherigeDaten.map((d) => (
                    <th
                      key={d}
                      className="font-normal text-neutral-400"
                      title="Nur zur Kontrolle - hier nicht bearbeitbar"
                    >
                      {kurzDatum(d)}
                    </th>
                  ))}
                  <th>Stunden</th>
                  <th>Markierung</th>
                  <th>Notiz</th>
                  {canGruppeAendern && <th>Gruppe</th>}
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
                        {fuehrerschein[emp.id] ? (
                          <span className="text-emerald-700">
                            {fuehrerschein[emp.id].join(", ")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {vorherigeDaten.map((d) => {
                        const alt = vorherigeEntries[d]?.[emp.id];
                        return (
                          <td key={d} className="text-neutral-400">
                            {alt?.stunden ?? alt?.markierung ?? "—"}
                          </td>
                        );
                      })}
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={24}
                          step={0.25}
                          className="w-20"
                          defaultValue={entry?.stunden ?? ""}
                          key={`${emp.id}-${entry?.version ?? 0}`}
                          data-stunden-feld="true"
                          data-employee-id={emp.id}
                          onBlur={(e) => saveHours(emp.id, e.target.value)}
                          onKeyDown={handleStundenKeyDown}
                          disabled={gesperrt || savingId === emp.id}
                          title="↑/↓: vorherige/nächste Person · Umschalt+↑/↓: Vortag/Folgetag derselben Person"
                        />
                      </td>
                      <td>
                        <select
                          defaultValue={entry?.markierung ?? ""}
                          key={`m-${emp.id}-${entry?.version ?? 0}`}
                          onChange={(e) =>
                            saveMarkierung(emp.id, e.target.value)
                          }
                          disabled={gesperrt}
                        >
                          <option value="">—</option>
                          <option value="U">U (Urlaub/Feiertag)</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="z.B. krank, zu spät"
                          className="w-36"
                          defaultValue={entry?.notiz ?? ""}
                          key={`n-${emp.id}-${entry?.version ?? 0}`}
                          onBlur={(e) => saveNotiz(emp.id, e.target.value)}
                          disabled={gesperrt}
                        />
                      </td>
                      {canGruppeAendern && (
                        <td>
                          <select
                            value={emp.gruppe_nr ?? ""}
                            onChange={(e) =>
                              gruppeAendern(emp.id, e.target.value)
                            }
                          >
                            <option value="">— keine Gruppe —</option>
                            {gruppen.map((gr) => (
                              <option key={gr.gruppe_nr} value={gr.gruppe_nr}>
                                {gr.gruppe_nr} – {gr.bezeichnung}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
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

export default function ErfassungPage() {
  // useSearchParams() erfordert eine Suspense-Grenze (Next.js App Router).
  return (
    <Suspense fallback={<p className="text-neutral-500">Lädt…</p>}>
      <ErfassungInner />
    </Suspense>
  );
}
