"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { uebersetzung } from "@/lib/i18n";
import type {
  Arbeitsgruppe,
  Employee,
  FuehrerscheinEintrag,
  Period,
  WorkEntry,
} from "@/lib/types";
import ErfassungTabs from "@/components/ErfassungTabs";

const OHNE_GRUPPE_KEY = "__ohne__";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Reine Kalendertag-Arithmetik auf Basis von "YYYY-MM-DD" - bewusst über
// UTC-Millisekunden statt lokaler Zeitzone, damit ein Tagessprung nicht je
// nach Zeitzone/Sommerzeit auf den falschen Tag landen kann.
//
// Robust gegen ungültige/unvollständige Eingaben: ein <input type="date">
// liefert beim Tippen per Tastatur (statt über den Picker) zwischenzeitlich
// einen LEEREN String, solange das Datum noch nicht vollständig eingegeben
// ist - ohne diese Prüfung würde new Date(NaN).toISOString() eine
// RangeError werfen und die ganze Seite mit "Application error" abstürzen
// lassen (passiert hier in der Render-Phase, nicht in einem try/catch
// abfangbar). Bei ungültiger Eingabe wird einfach der unveränderte Wert
// zurückgegeben, bis ein vollständiges Datum eingetippt ist.
function addDays(iso: string, delta: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [j, m, t] = iso.split("-").map(Number);
  const ms = Date.UTC(j, m - 1, t) + delta * 86400000;
  const ergebnis = new Date(ms);
  if (Number.isNaN(ergebnis.getTime())) return iso;
  return ergebnis.toISOString().slice(0, 10);
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
  const t = uebersetzung(profile?.sprache);
  const canGruppeAendern =
    profile?.role === "admin" || profile?.role === "hr";
  // Muss exakt zu work_entries_write/-update in schema.sql passen (RLS).
  // Ohne diese clientseitige Sperre sahen Rollen ohne Schreibrecht (z.B.
  // "management") ganz normal editierbar wirkende Felder, deren Eingabe
  // aber lautlos von der Datenbank abgelehnt wurde - Nutzer-Bugreport
  // 2026-08-08 ("eingetippte Stunden nach Neuladen wieder weg").
  const canEditStunden =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung";
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
  // Ebenso, aber für die 2 kommenden Tage (z.B. um schon vorab erfasste
  // Urlaubstage zu sehen) - Nutzer-Vorgabe 2026-08-08.
  const [kommendeEntries, setKommendeEntries] = useState<
    Record<string, Record<string, WorkEntry>>
  >({});
  const [loading, setLoading] = useState(true);
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
  // Zeigt an, wenn ein Speicherversuch nicht ankam (z.B. weil ein anderer
  // Nutzer den Eintrag zwischenzeitlich geändert hat - optimistische
  // Sperre schlägt fehl - oder weil die Berechtigung fehlt). Vorher wurde
  // das lautlos verschluckt: die Eingabe verschwand beim nächsten Laden
  // spurlos, ohne dass sichtbar war, warum (Nutzer-Bugreport 2026-08-08).
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null);

  // Für den Live-Sync-Handler: der jeweils AKTUELLE Tag, nicht der zum
  // Zeitpunkt des Abonnierens eingefangene - beim schnellen Tageswechsel
  // (z.B. Umschalt+Pfeil) kann eine Nachricht vom vorherigen Kanal noch
  // eintreffen, nachdem schon der neue Tag geladen ist. Ohne diesen Check
  // würde sie fälschlich in die Ansicht des neuen Tages einsickern (beide
  // sind nur nach employee_id indiziert) und dabei mitten in der Eingabe
  // den Fokus rauswerfen.
  const datumRef = useRef(datum);
  useEffect(() => {
    datumRef.current = datum;
  }, [datum]);

  const vorherigeDaten = [
    addDays(datum, -3),
    addDays(datum, -2),
    addDays(datum, -1),
  ];
  const kommendeDaten = [addDays(datum, 1), addDays(datum, 2)];

  const loadAll = useCallback(async (forDate: string) => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const vorherige = [addDays(forDate, -3), addDays(forDate, -2), addDays(forDate, -1)];
    const kommende = [addDays(forDate, 1), addDays(forDate, 2)];
    const [{ data: emp }, { data: we }, { data: gr }, { data: weVorher }, { data: weKommend }] =
      await Promise.all([
        supabase
          .from("employees")
          .select("id, personal_nr, name, vorname, herkunft, aktiv, gruppe_nr")
          .eq("aktiv", true)
          .order("name"),
        supabase.from("work_entries").select("*").eq("datum", forDate),
        supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
        supabase.from("work_entries").select("*").in("datum", vorherige),
        supabase.from("work_entries").select("*").in("datum", kommende),
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
    const kommendeMap: Record<string, Record<string, WorkEntry>> = {};
    ((weKommend as WorkEntry[]) ?? []).forEach((row) => {
      if (!kommendeMap[row.datum]) kommendeMap[row.datum] = {};
      kommendeMap[row.datum][row.employee_id] = row;
    });
    setKommendeEntries(kommendeMap);
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
    // <input type="date"> liefert beim Tippen per Tastatur zwischenzeitlich
    // einen leeren String, solange das Datum noch unvollständig ist -
    // ignorieren, statt einen ungültigen Zwischenstand zu übernehmen (siehe
    // ausführlicher Kommentar bei addDays oben).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(neuesDatum)) return;
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
    // Einen Frame warten, bis der Browser die neuen Zeilen wirklich
    // gemalt hat, statt mitten in der React-Commit-Phase zu fokussieren -
    // macht das Fokussieren zuverlässiger.
    requestAnimationFrame(() => {
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
    });
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
          const row = (payload.new ?? payload.old) as WorkEntry;
          // Veraltete Nachricht vom vorherigen Tag (Kanal noch nicht
          // abgemeldet) ignorieren - siehe Kommentar bei datumRef oben.
          if (row.datum !== datumRef.current) return;
          // Gerade aktiv in Bearbeitung (Feld hat den Fokus) - nicht durch
          // Live-Sync mitten in der Eingabe überschreiben/den Fokus rauben.
          const aktiv = document.activeElement;
          if (
            aktiv instanceof HTMLElement &&
            aktiv.getAttribute("data-stunden-feld") === "true" &&
            aktiv.getAttribute("data-employee-id") === row.employee_id
          ) {
            return;
          }
          setEntries((prev) => {
            const next = { ...prev };
            if (payload.eventType === "DELETE") {
              delete next[row.employee_id];
            } else {
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

  // Lädt den tatsächlichen aktuellen Stand aus der Datenbank neu, wenn ein
  // Speicherversuch fehlgeschlagen ist (Konflikt oder fehlende
  // Berechtigung) - damit die Eingabefelder nie einen Wert zeigen, der in
  // Wahrheit gar nicht gespeichert wurde.
  async function ladeEintragNeu(employeeId: string) {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("work_entries")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("datum", datum)
      .maybeSingle();
    setEntries((prev) => {
      const next = { ...prev };
      if (data) next[employeeId] = data as WorkEntry;
      else delete next[employeeId];
      return next;
    });
  }

  function empfaengerName(employeeId: string): string {
    const e = employees.find((emp) => emp.id === employeeId);
    return e ? `${e.name}, ${e.vorname}` : "diese Person";
  }

  // Gemeinsame Speicherlogik für Stunden/Markierung/Notiz - alle drei
  // teilen sich dasselbe Muster: bei bestehendem Eintrag per optimistischer
  // Sperre (version) aktualisieren, sonst neu anlegen. WICHTIG: Anders als
  // zuvor wird das Ergebnis jetzt geprüft - weder ein RLS-Fehler (z.B.
  // fehlende Berechtigung, gesperrter Monat) noch ein Versionskonflikt
  // (0 betroffene Zeilen, wenn zwischenzeitlich jemand anders gespeichert
  // hat) dürfen mehr lautlos verschluckt werden, siehe Bugreport
  // 2026-08-08 ("eingetippte Stunden nach Neuladen wieder weg").
  async function speichereFeld(
    employeeId: string,
    patch: Partial<Pick<WorkEntry, "stunden" | "markierung" | "notiz">>,
    feldLabel: string
  ): Promise<boolean> {
    const supabase = getSupabaseClient();
    const existing = entries[employeeId];
    let konflikt = false;
    let fehlerText: string | null = null;

    if (existing) {
      const { data, error } = await supabase
        .from("work_entries")
        .update(patch)
        .eq("id", existing.id)
        .eq("version", existing.version) // optimistische Sperre (ADR-010)
        .select("id");
      if (error) fehlerText = error.message;
      else if (!data || data.length === 0) konflikt = true;
    } else {
      const { error } = await supabase
        .from("work_entries")
        .insert({ employee_id: employeeId, datum, ...patch });
      if (error) {
        // Eindeutigkeitsverletzung (employee_id, datum) = jemand anders
        // war zwischenzeitlich schneller - auch das ist ein Konflikt, kein
        // "echter" Fehler.
        if (error.code === "23505") konflikt = true;
        else fehlerText = error.message;
      }
    }

    if (konflikt) {
      setSpeicherFehler(
        `${feldLabel} für ${empfaengerName(employeeId)} konnte nicht gespeichert werden - ` +
          `eine andere Person hat diesen Eintrag zwischenzeitlich geändert. ` +
          `Der aktuelle Stand wurde neu geladen, bitte bei Bedarf erneut eingeben.`
      );
      await ladeEintragNeu(employeeId);
      return false;
    }
    if (fehlerText) {
      setSpeicherFehler(
        `${feldLabel} für ${empfaengerName(employeeId)} konnte nicht gespeichert werden: ${fehlerText}`
      );
      await ladeEintragNeu(employeeId);
      return false;
    }
    setSpeicherFehler(null);
    return true;
  }

  async function saveHours(employeeId: string, value: string) {
    const stunden = value === "" ? null : Number(value);
    await speichereFeld(employeeId, { stunden }, "Stunden");
  }

  async function saveMarkierung(employeeId: string, markierung: string) {
    const value = markierung === "" ? null : markierung;
    await speichereFeld(employeeId, { markierung: value }, "Markierung");
  }

  // Freitext-Vermerk zum Tag (z.B. "krank", "zu spät") - erscheint auch in
  // der "Suche"-Seite bei den Arbeitsstunden der Person.
  async function saveNotiz(employeeId: string, notiz: string) {
    const value = notiz.trim() === "" ? null : notiz;
    await speichereFeld(employeeId, { notiz: value }, "Notiz");
  }

  // Pfeiltasten hoch/runter im Stunden-Feld springen direkt zum selben
  // Feld der vorherigen/nächsten Person, ohne erst Markierung/Notiz/Gruppe
  // dieser Zeile durchlaufen zu müssen (schnellere Eingabe als mit Tab).
  // Umschalt+Pfeil rechts/links springt stattdessen beim GLEICHEN
  // Mitarbeiter einen Tag vor/zurück - praktisch zum Nacherfassen mehrerer
  // Tage in Folge, ohne die Maus zu benutzen. Nutzt dieselbe Fokus-Restore-
  // Logik wie die Datums-Pfeiltasten oben, nur dass hier gezielt DIESES
  // Feld gemerkt wird statt document.activeElement (das nach .blur()
  // schon nichts mehr wäre).
  function handleStundenKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const empId = e.currentTarget.getAttribute("data-employee-id");
      fokusEmployeeIdRef.current = empId;
      scrollYRef.current = window.scrollY;
      e.currentTarget.blur(); // löst das Speichern über onBlur aus
      setDatum((d) => addDays(d, e.key === "ArrowRight" ? 1 : -1));
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
      <ErfassungTabs />
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">
          {t("erfassung.title")}
        </h1>
        <p className="text-sm text-neutral-500">{t("erfassung.untertitel")}</p>
      </div>

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-col gap-2 bg-neutral-50 py-2 print:hidden">
        <div className="flex items-center gap-3">
          <label className="text-sm">
            {t("gemeinsam.datum")}{" "}
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                className="btn-secondary px-2 text-xs"
                onClick={() => datumWechseln(addDays(datum, -1))}
                title={t("erfassung.eintagzurueck")}
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
                title={t("erfassung.eintagvor")}
              >
                →
              </button>
            </span>
          </label>
          <span className="text-sm text-neutral-500">
            {t("erfassung.tagessumme", { wert: gesamtStunden.toFixed(2) })}
          </span>
        </div>

        {!canEditStunden && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            {t("erfassung.rollegesperrt", { rolle: profile?.role ?? "" })}
          </p>
        )}

        {gesperrt && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            {t("erfassung.monatgesperrt")}
          </p>
        )}

        {speicherFehler && (
          <p className="flex items-center justify-between gap-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            <span>⚠ {speicherFehler}</span>
            <button
              type="button"
              className="btn-secondary shrink-0 text-xs"
              onClick={() => setSpeicherFehler(null)}
            >
              {t("erfassung.ausblenden")}
            </button>
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
        <p className="text-neutral-500">{t("gemeinsam.laedt")}</p>
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
                  (
                  {t("erfassung.personenstd", {
                    n: g.employees.length,
                    std: gruppenStunden(g).toFixed(2),
                  })}
                  )
                </span>
              </h2>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setPrintGroupKey(g.key)}
              >
                {t("erfassung.gruppedrucken")}
              </button>
            </div>

            <table className="print:hidden">
              <thead>
                <tr>
                  <th>{t("erfassung.persnr")}</th>
                  {canGruppeAendern && <th>{t("erfassung.gruppe")}</th>}
                  <th>{t("erfassung.name")}</th>
                  <th>{t("erfassung.herkunft")}</th>
                  <th>{t("erfassung.fuehrerschein")}</th>
                  {vorherigeDaten.map((d) => (
                    <th
                      key={d}
                      className="font-normal text-neutral-400"
                      title={t("erfassung.nurkontrolle")}
                    >
                      {kurzDatum(d)}
                    </th>
                  ))}
                  <th>{t("erfassung.stunden")}</th>
                  {kommendeDaten.map((d) => (
                    <th
                      key={d}
                      className="font-normal text-neutral-400"
                      title={t("erfassung.nurkontrolle")}
                    >
                      {kurzDatum(d)}
                    </th>
                  ))}
                  <th>{t("gemeinsam.markierung")}</th>
                  <th>{t("gemeinsam.notiz")}</th>
                  {canGruppeAendern && <th>{t("erfassung.gruppe")}</th>}
                </tr>
              </thead>
              <tbody>
                {g.employees.map((emp) => {
                  const entry = entries[emp.id];
                  return (
                    <tr key={emp.id}>
                      <td>{emp.personal_nr}</td>
                      {canGruppeAendern && (
                        <td>
                          <select
                            value={emp.gruppe_nr ?? ""}
                            onChange={(e) =>
                              gruppeAendern(emp.id, e.target.value)
                            }
                          >
                            <option value="">{t("erfassung.keinegruppe")}</option>
                            {gruppen.map((gr) => (
                              <option key={gr.gruppe_nr} value={gr.gruppe_nr}>
                                {gr.gruppe_nr} – {gr.bezeichnung}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td>
                        {emp.name}, {emp.vorname}
                      </td>
                      <td>{emp.herkunft ?? "—"}</td>
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
                          disabled={gesperrt || !canEditStunden}
                          title={t("erfassung.stundenfeldtitel")}
                        />
                      </td>
                      {kommendeDaten.map((d) => {
                        const kommend = kommendeEntries[d]?.[emp.id];
                        return (
                          <td key={d} className="text-neutral-400">
                            {kommend?.stunden ?? kommend?.markierung ?? "—"}
                          </td>
                        );
                      })}
                      <td>
                        <select
                          defaultValue={entry?.markierung ?? ""}
                          key={`m-${emp.id}-${entry?.version ?? 0}`}
                          onChange={(e) =>
                            saveMarkierung(emp.id, e.target.value)
                          }
                          disabled={gesperrt || !canEditStunden}
                        >
                          <option value="">—</option>
                          <option value="U">{t("erfassung.markierungurlaub")}</option>
                          <option value="F">{t("erfassung.markierungfahrer")}</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder={t("erfassung.notizplatzhalter")}
                          className="w-36"
                          defaultValue={entry?.notiz ?? ""}
                          key={`n-${emp.id}-${entry?.version ?? 0}`}
                          onBlur={(e) => saveNotiz(emp.id, e.target.value)}
                          disabled={gesperrt || !canEditStunden}
                        />
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

export default function ErfassungPage() {
  // useSearchParams() erfordert eine Suspense-Grenze (Next.js App Router).
  return (
    <Suspense fallback={<p className="text-neutral-500">Lädt…</p>}>
      <ErfassungInner />
    </Suspense>
  );
}
