"use client";

import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { formatMenge } from "@/lib/format";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { uebersetzung } from "@/lib/i18n";
import { kannStundenkontoAuszahlen, kannStundenkontoBuchen } from "@/lib/stundenkontoRechte";
import {
  speichereWorkEntryFeld,
  type WorkEntryPatch,
} from "@/lib/workEntrySpeichern";
import type {
  Arbeitsgruppe,
  Employee,
  EmployeeStundenkontoSaldo,
  FuehrerscheinEintrag,
  Period,
  WorkEntry,
} from "@/lib/types";
import ErfassungTabs from "@/components/ErfassungTabs";
import StundenkontoBereich from "@/components/StundenkontoBereich";
import { Car, Truck } from "lucide-react";
import GruppenAuswahl from "@/components/GruppenAuswahl";
import ZeitenZelle, { type ZeitenSpeichern } from "@/components/ZeitenZelle";
import {
  formatZeit,
  parseZeit,
  stundenAusZeiten,
  type Rundung,
  type ZettelZeiten,
} from "@/lib/zettelZeiten";

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

// Kurzform "Mo 04.08." für die Spaltenköpfe der Wochentage.
function kurzDatum(iso: string): string {
  const [, m, t] = iso.split("-");
  const wochentag = new Date(`${iso}T00:00:00Z`).toLocaleDateString("de-DE", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${wochentag} ${t}.${m}.`;
}

// Montag (ISO-Wochenstart) der Woche, in der `iso` liegt. Reine
// Kalenderarithmetik über UTC, gleiche Robustheit wie addDays().
function montagDerWoche(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [j, m, t] = iso.split("-").map(Number);
  const wochentag = new Date(Date.UTC(j, m - 1, t)).getUTCDay(); // 0=So..6=Sa
  return addDays(iso, wochentag === 0 ? -6 : 1 - wochentag);
}

// Die 7 Kalendertage (Mo..So) der Woche um `iso`.
function wochenTageVon(iso: string): string[] {
  const mo = montagDerWoche(iso);
  return [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(mo, d));
}

// ISO-Kalenderwoche (1..53) - für die Beschriftung "KW 36".
function isoKw(iso: string): number {
  const [j, m, t] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  // Donnerstag derselben Woche bestimmt das KW-Jahr (ISO 8601).
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jahresanfang = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - jahresanfang.getTime()) / 86400000 + 1) / 7);
}

// "04.08." - kompaktes Tagesdatum für die KW-Kopfzeile.
function tagMonat(iso: string): string {
  const [, m, t] = iso.split("-");
  return `${t}.${m}.`;
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

const LEERE_ZEITEN: ZettelZeiten = { vmVon: "", vmBis: "", nmVon: "", nmBis: "" };

function ErfassungInner() {
  const { profile } = useProfile();
  const t = uebersetzung(profile?.sprache);
  const canGruppeAendern =
    profile?.role === "admin" || profile?.role === "hr";
  // Nutzer-Vorgabe 2026-09-21: die Spalte "Markierung" ist entfallen. Urlaub
  // wird im Controlling (Urlaub / Arbeitstage am Stück) erfasst, "F" (Fahrer)
  // gibt es nicht mehr. Bestehende Markierungen bleiben in den Daten und
  // werden hier nur noch als Kürzel neben den Stunden angezeigt.
  // Muss exakt zu work_entries_write/-update in schema.sql passen (RLS).
  // Ohne diese clientseitige Sperre sahen Rollen ohne Schreibrecht (z.B.
  // "management") ganz normal editierbar wirkende Felder, deren Eingabe
  // aber lautlos von der Datenbank abgelehnt wurde - Nutzer-Bugreport
  // 2026-08-08 ("eingetippte Stunden nach Neuladen wieder weg").
  const canEditStunden =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung";
  // Stundenkonto: Rollenregeln zentral in lib/stundenkontoRechte.ts - hier
  // nur zur Anzeige des "Verwalten"-Umschalters (die eigentliche Prüfung
  // je Aktion steckt in StundenkontoBereich/schema.sql).
  const canStundenkontoBuchen = kannStundenkontoBuchen(profile?.role);
  const canStundenkontoAuszahlen = kannStundenkontoAuszahlen(profile?.role);
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
  // Suchfilter nach Name/Personalnummer (Nutzer-Vorgabe 2026-08-14, wie
  // schon auf "Personal"/"Lohnübersicht") - wirkt vor der Gruppierung, die
  // Sprungleiste/Gruppen-Summen zeigen dadurch automatisch nur noch die
  // gefilterten Personen.
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<Record<string, WorkEntry>>({});
  // Nutzer-Vorgabe 2026-09-01: die Erfassung zeigt immer eine ganze
  // Kalenderwoche (Mo..So). Bearbeitbar bleibt nur der oben gewählte Tag
  // (`datum`) - die übrigen 6 Tage der Woche stehen hier nur zur Kontrolle,
  // je Tag ein employeeId->WorkEntry-Eintrag.
  const [kontextEntries, setKontextEntries] = useState<
    Record<string, Record<string, WorkEntry>>
  >({});
  const [loading, setLoading] = useState(true);
  const [printGroupKey, setPrintGroupKey] = useState<string | null>(null);
  // "Für ganze Gruppe übernehmen": Stundenwert je Gruppe (Kopfzeile), Meldung
  // zum letzten Durchlauf und welche Gruppe gerade speichert.
  // Arbeitszeiten (von-bis): je Gruppe aufklappbar, Rundung seitenweit
  // Gruppenfilter: null = alle Gruppen untereinander, sonst nur diese eine
  const [gruppeFilter, setGruppeFilter] = useState<string | null>(null);
  const [zeitenOffen, setZeitenOffen] = useState<Record<string, boolean>>({});
  const [zeitenRundung, setZeitenRundung] = useState<Rundung>("viertel");
  const [gruppenZeiten, setGruppenZeiten] = useState<
    Record<string, ZettelZeiten>
  >({});
  const [gruppenWert, setGruppenWert] = useState<Record<string, string>>({});
  const [gruppenMeldung, setGruppenMeldung] = useState<
    Record<string, { text: string; fehler: boolean }>
  >({});
  const [gruppeLaeuft, setGruppeLaeuft] = useState<string | null>(null);
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

  // Stundenkonto (Nutzer-Vorgabe 2026-08-20): immer sichtbar, unabhängig
  // vom gewählten Tag - nur das Jahr des gewählten Datums bestimmt die
  // Saison, auf die sich das Konto bezieht (wie season_bonuses überall
  // sonst in der App). Die eigentliche Werkzeugleiste steckt in der
  // wiederverwendeten Komponente StundenkontoBereich (siehe unten) - hier
  // nur der Saldo für die kompakte Spalte in dieser Tabelle sowie, welche
  // Person gerade aufgeklappt ist.
  const stundenkontoJahr = Number(datum.slice(0, 4));
  const [stundenkontoSaldo, setStundenkontoSaldo] = useState<
    Record<string, number>
  >({});
  const [stundenkontoOffenId, setStundenkontoOffenId] = useState<
    string | null
  >(null);

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

  // Die ganze Woche um den gewählten Tag; `kontextTage` = alle außer dem
  // bearbeitbaren Tag (nur zur Anzeige).
  const wochenTage = wochenTageVon(datum);
  const kontextTage = wochenTage.filter((d) => d !== datum);

  const loadAll = useCallback(async (forDate: string) => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const alleTage = wochenTageVon(forDate);
    const kontext = alleTage.filter((d) => d !== forDate);
    const [{ data: emp }, { data: we }, { data: gr }, { data: weKontext }] =
      await Promise.all([
        supabase
          .from("employees")
          .select("id, personal_nr, name, vorname, herkunft, aktiv, gruppe_nr")
          .eq("aktiv", true)
          .order("name"),
        supabase.from("work_entries").select("*").eq("datum", forDate),
        supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
        supabase.from("work_entries").select("*").in("datum", kontext),
      ]);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    const map: Record<string, WorkEntry> = {};
    ((we as WorkEntry[]) ?? []).forEach((row) => {
      map[row.employee_id] = row;
    });
    setEntries(map);
    const kontextMap: Record<string, Record<string, WorkEntry>> = {};
    ((weKontext as WorkEntry[]) ?? []).forEach((row) => {
      if (!kontextMap[row.datum]) kontextMap[row.datum] = {};
      kontextMap[row.datum][row.employee_id] = row;
    });
    setKontextEntries(kontextMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll(datum);
  }, [datum, loadAll]);

  // Stundenkonto-Salden für alle sichtbaren Personen - unabhängig vom
  // gewählten Tag, nur vom Jahr (siehe stundenkontoJahr oben).
  useEffect(() => {
    async function ladeSalden() {
      if (employees.length === 0) return;
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("employee_stundenkonto_saldo")
        .select("*")
        .eq("saison_jahr", stundenkontoJahr);
      const map: Record<string, number> = {};
      ((data as EmployeeStundenkontoSaldo[]) ?? []).forEach((row) => {
        map[row.employee_id] = Number(row.saldo);
      });
      setStundenkontoSaldo(map);
    }
    ladeSalden();
  }, [employees, stundenkontoJahr]);

  // Bugreport 2026-08-20: ein Mitarbeiter sah nach mehrfachem "Neuladen"
  // weiterhin einen veralteten Stundenwert, obwohl im Protokoll längst der
  // korrekte Wert stand - erst Aus-/Wiedereinloggen zeigte den richtigen
  // Wert. Das Muster (normales Neuladen hilft nicht, ein erzwungener
  // Neuaufbau der Seite schon) passt zum Browser-"Back-Forward-Cache":
  // der Browser stellt beim Zurückkehren (Tab-Wechsel, Bildschirm
  // entsperren, Zurück-Navigation) eine eingefrorene Kopie der Seite aus
  // dem Speicher wieder her, statt sie neu vom Server zu laden - ein Login
  // erzwingt dagegen praktisch immer eine echte Navigation. Ohne Service
  // Worker/PWA-Cache in dieser App (geprüft) ist das der plausibelste
  // Mechanismus. Absicherung unabhängig von der genauen Ursache: bei jeder
  // Rückkehr zur Seite zwingend frisch aus der Datenbank nachladen - außer
  // gerade ein Stunden-Feld hat den Fokus (nicht mitten in der Eingabe
  // unterbrechen, gleiche Prüfung wie beim Live-Sync unten).
  useEffect(() => {
    function aktivesStundenfeld() {
      const aktiv = document.activeElement;
      return (
        aktiv instanceof HTMLElement &&
        aktiv.getAttribute("data-stunden-feld") === "true"
      );
    }
    function neuLadenFallsSinnvoll() {
      if (aktivesStundenfeld()) return;
      loadAll(datumRef.current);
    }
    function handlePageShow(e: PageTransitionEvent) {
      // event.persisted = true heißt: aus dem Back-Forward-Cache
      // wiederhergestellt, nicht neu vom Server geladen.
      if (e.persisted) neuLadenFallsSinnvoll();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") neuLadenFallsSinnvoll();
    }
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadAll]);

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

  // Gemeinsame Speicherlogik für Stunden/Markierung/Notiz - ausgelagert in
  // lib/workEntrySpeichern.ts (Nutzer-Vorgabe 2026-08-21: dieselbe,
  // geprüfte Logik soll auch das Controlling-Stundenmonitoring nutzen,
  // nicht ein zweites Mal geschrieben werden). WICHTIG: weder ein
  // RLS-Fehler (z.B. fehlende Berechtigung, gesperrter Monat) noch ein
  // Versionskonflikt dürfen lautlos verschluckt werden, siehe Bugreport
  // 2026-08-08 ("eingetippte Stunden nach Neuladen wieder weg").
  async function speichereFeld(
    employeeId: string,
    patch: WorkEntryPatch,
    feldLabel: string
  ): Promise<boolean> {
    const ergebnis = await speichereWorkEntryFeld(
      employeeId,
      datum,
      entries[employeeId],
      patch
    );
    if (!ergebnis.ok) {
      if (ergebnis.konflikt) {
        setSpeicherFehler(
          `${feldLabel} für ${empfaengerName(employeeId)} konnte nicht gespeichert werden - ` +
            `eine andere Person hat diesen Eintrag zwischenzeitlich geändert. ` +
            `Der aktuelle Stand wurde neu geladen, bitte bei Bedarf erneut eingeben.`
        );
      } else {
        setSpeicherFehler(
          `${feldLabel} für ${empfaengerName(employeeId)} konnte nicht gespeichert werden: ${ergebnis.fehler}`
        );
      }
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

  async function saveZeiten(employeeId: string, w: ZeitenSpeichern) {
    const { stunden, ...zeiten } = w;
    await speichereFeld(
      employeeId,
      stunden === undefined ? zeiten : { ...zeiten, stunden },
      "Arbeitszeiten"
    );
  }

  // Freitext-Vermerk zum Tag (z.B. "krank", "zu spät") - erscheint auch in
  // der "Suche"-Seite bei den Arbeitsstunden der Person.
  async function saveNotiz(employeeId: string, notiz: string) {
    const value = notiz.trim() === "" ? null : notiz;
    await speichereFeld(employeeId, { notiz: value }, "Notiz");
  }

  function stundenkontoAufklappen(employeeId: string) {
    setStundenkontoOffenId((prev) => (prev === employeeId ? null : employeeId));
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

  // Trägt den Wert aus der Gruppen-Kopfzeile bei allen Personen der Gruppe
  // ein, die für den Tag noch keine Stunden UND keine Markierung (Urlaub/
  // Fahrer) haben - bereits Erfasstes wird nie überschrieben. Nutzt dieselbe
  // Speicherlogik wie die Einzelerfassung (optimistische Sperre).
  async function gruppeUebernehmen(g: Gruppierung) {
    const roh = (gruppenWert[g.key] ?? "").trim().replace(",", ".");
    const stunden = Number(roh);
    if (roh === "" || !Number.isFinite(stunden) || stunden < 0 || stunden > 24) {
      setGruppenMeldung((prev) => ({
        ...prev,
        [g.key]: { text: t("erfassung.gruppestundenungueltig"), fehler: true },
      }));
      return;
    }
    await gruppeSchreiben(g, { stunden }, stunden);
  }

  // Wie gruppeUebernehmen, aber mit den Arbeitszeiten aus der Kopfzeile
  // des aufgeklappten Zeiten-Bereichs: Stunden werden daraus errechnet.
  async function gruppeZeitenUebernehmen(g: Gruppierung) {
    const z = gruppenZeiten[g.key] ?? LEERE_ZEITEN;
    const norm = (v: string) => {
      const m = parseZeit(v);
      return m === null ? v.trim() : formatZeit(m);
    };
    const n: ZettelZeiten = {
      vmVon: norm(z.vmVon),
      vmBis: norm(z.vmBis),
      nmVon: norm(z.nmVon),
      nmBis: norm(z.nmBis),
    };
    const r = stundenAusZeiten(n, zeitenRundung);
    if (r.leer || r.fehler) {
      setGruppenMeldung((prev) => ({
        ...prev,
        [g.key]: { text: r.fehler ?? t("erfassung.gruppezeitenleer"), fehler: true },
      }));
      return;
    }
    const oderNull = (v: string) => (v === "" ? null : v);
    await gruppeSchreiben(
      g,
      {
        vm_von: oderNull(n.vmVon),
        vm_bis: oderNull(n.vmBis),
        nm_von: oderNull(n.nmVon),
        nm_bis: oderNull(n.nmBis),
        stunden: r.stunden,
      },
      r.stunden
    );
  }

  // Entfernt für den gewählten Tag bei allen Personen der Gruppe die Stunden
  // und Arbeitszeiten (Notiz und Markierung bleiben unberührt). Mit
  // Rückfrage, weil es viele Einträge auf einmal betrifft.
  async function gruppeLeeren(g: Gruppierung) {
    const ziele = g.employees.filter((emp) => {
      const e = entries[emp.id];
      return (
        e && (e.stunden != null || e.vm_von || e.vm_bis || e.nm_von || e.nm_bis)
      );
    });
    const meldung = (text: string, fehler = false) =>
      setGruppenMeldung((prev) => ({ ...prev, [g.key]: { text, fehler } }));
    if (ziele.length === 0) {
      meldung(t("erfassung.gruppeleerenichts"), true);
      return;
    }
    if (!window.confirm(t("erfassung.gruppeleerenfrage", { n: ziele.length, gruppe: g.anzeige, datum }))) {
      return;
    }
    setGruppeLaeuft(g.key);
    let geleert = 0;
    const fehler: string[] = [];
    for (let i = 0; i < ziele.length; i += 5) {
      const ergebnisse = await Promise.all(
        ziele.slice(i, i + 5).map(async (emp) => ({
          emp,
          r: await speichereWorkEntryFeld(emp.id, datum, entries[emp.id], {
            stunden: null,
            vm_von: null,
            vm_bis: null,
            nm_von: null,
            nm_bis: null,
          }),
        }))
      );
      for (const { emp, r } of ergebnisse) {
        if (r.ok) geleert += 1;
        else fehler.push(`${emp.name}, ${emp.vorname}`);
      }
    }
    const { data } = await getSupabaseClient()
      .from("work_entries")
      .select("*")
      .eq("datum", datum)
      .in("employee_id", ziele.map((emp) => emp.id));
    setEntries((prev) => {
      const next = { ...prev };
      ((data as WorkEntry[]) ?? []).forEach((row) => {
        next[row.employee_id] = row;
      });
      return next;
    });
    const teile = [t("erfassung.gruppegeleert", { n: geleert })];
    if (fehler.length > 0) {
      teile.push(t("erfassung.gruppefehler", { n: fehler.length, namen: fehler.join("; ") }));
    }
    meldung(teile.join(" · "), fehler.length > 0);
    setGruppeLaeuft(null);
  }

  async function gruppeSchreiben(
    g: Gruppierung,
    patch: WorkEntryPatch,
    stunden: number
  ) {
    const meldung = (text: string, fehler = false) =>
      setGruppenMeldung((prev) => ({ ...prev, [g.key]: { text, fehler } }));
    const ziele = g.employees.filter(
      (emp) => entries[emp.id]?.stunden == null && !entries[emp.id]?.markierung
    );
    const uebersprungen = g.employees.length - ziele.length;
    if (ziele.length === 0) {
      meldung(t("erfassung.gruppenichtsoffen"), true);
      return;
    }
    setGruppeLaeuft(g.key);
    setGruppenMeldung((prev) => {
      const next = { ...prev };
      delete next[g.key];
      return next;
    });
    let gefuellt = 0;
    const fehler: string[] = [];
    // In kleinen Paketen parallel, damit große Gruppen schnell fertig sind,
    // ohne die Datenbank mit allem auf einmal zu belasten.
    for (let i = 0; i < ziele.length; i += 5) {
      const ergebnisse = await Promise.all(
        ziele.slice(i, i + 5).map(async (emp) => ({
          emp,
          r: await speichereWorkEntryFeld(emp.id, datum, entries[emp.id], patch),
        }))
      );
      for (const { emp, r } of ergebnisse) {
        if (r.ok) gefuellt += 1;
        else fehler.push(`${emp.name}, ${emp.vorname}`);
      }
    }
    // Die betroffenen Einträge frisch laden, damit die Felder den
    // gespeicherten Stand zeigen (auch bei einem Konflikt).
    const { data } = await getSupabaseClient()
      .from("work_entries")
      .select("*")
      .eq("datum", datum)
      .in(
        "employee_id",
        ziele.map((emp) => emp.id)
      );
    setEntries((prev) => {
      const next = { ...prev };
      ((data as WorkEntry[]) ?? []).forEach((row) => {
        next[row.employee_id] = row;
      });
      return next;
    });
    const teile = [
      t("erfassung.gruppefuellergebnis", {
        n: gefuellt,
        std: formatMenge(stunden, 2),
      }),
    ];
    if (uebersprungen > 0) {
      teile.push(t("erfassung.gruppeuebersprungen", { n: uebersprungen }));
    }
    if (fehler.length > 0) {
      teile.push(
        t("erfassung.gruppefehler", { n: fehler.length, namen: fehler.join("; ") })
      );
    }
    meldung(teile.join(" · "), fehler.length > 0);
    setGruppeLaeuft(null);
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

  const gefilterteEmployees = employees.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q)
    );
  });

  const gruppierungen = gruppiere(gefilterteEmployees, gruppen);
  const aktiverIndex = gruppierungen.findIndex((g) => g.key === gruppeFilter);
  // Existiert die gewählte Gruppe nicht mehr (z.B. Suchfilter oder leer
  // geworden), werden wieder alle gezeigt.
  const aktiveGruppe = aktiverIndex >= 0 ? gruppierungen[aktiverIndex].key : null;
  const angezeigteGruppen =
    aktiveGruppe === null
      ? gruppierungen
      : gruppierungen.filter((g) => g.key === aktiveGruppe);

  const gesamtStunden = Object.values(entries).reduce(
    (sum, e) => sum + (e.stunden ?? 0),
    0
  );

  // Summe über die ganze sichtbare Kalenderwoche (bearbeitbarer Tag +
  // Kontext-Tage).
  const wochenStunden =
    gesamtStunden +
    kontextTage.reduce(
      (sum, d) =>
        sum +
        Object.values(kontextEntries[d] ?? {}).reduce(
          (s, e) => s + (e.stunden ?? 0),
          0
        ),
      0
    );

  const kwLabel = `KW ${isoKw(datum)} · ${tagMonat(wochenTage[0])}–${tagMonat(
    wochenTage[6]
  )}`;

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

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-col gap-2 bg-sand py-2 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <input
            placeholder="Suche nach Name oder Personalnummer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <span className="inline-flex items-center gap-1 text-sm">
            <button
              type="button"
              className="btn-secondary px-2 text-xs"
              onClick={() => datumWechseln(addDays(datum, -7))}
              title="Eine Kalenderwoche zurück"
            >
              ‹‹
            </button>
            <span className="min-w-[11rem] text-center font-medium text-neutral-700">
              {kwLabel}
            </span>
            <button
              type="button"
              className="btn-secondary px-2 text-xs"
              onClick={() => datumWechseln(addDays(datum, 7))}
              title="Eine Kalenderwoche vor"
            >
              ››
            </button>
          </span>
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
            {t("erfassung.tagessumme", { wert: formatMenge(gesamtStunden, 2) })} ·
            Woche {formatMenge(wochenStunden, 2)}
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
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={`rounded border px-2 py-0.5 text-xs ${aktiveGruppe === null ? "border-emerald-700 bg-emerald-700 text-white" : "border-linie bg-white text-neutral-700 hover:border-emerald-700"}`}
              onClick={() => setGruppeFilter(null)}
            >
              {t("erfassung.gruppealle")}
            </button>
            {gruppierungen.map((g) => (
              <button
                key={g.key}
                type="button"
                title={`${g.anzeige} (${g.employees.length})`}
                className={`rounded border px-2 py-0.5 text-xs ${aktiveGruppe === g.key ? "border-emerald-700 bg-emerald-700 text-white" : "border-linie bg-white text-neutral-700 hover:border-emerald-700"}`}
                onClick={() => setGruppeFilter(g.key)}
              >
                {g.key === OHNE_GRUPPE_KEY ? t("erfassung.gruppeohne") : g.key}
              </button>
            ))}
            {aktiveGruppe !== null && (
              <span className="ml-2 flex items-center gap-1">
                <button
                  type="button"
                  className="btn-secondary px-2 text-xs"
                  disabled={aktiverIndex <= 0}
                  title={t("erfassung.gruppevorige")}
                  onClick={() => setGruppeFilter(gruppierungen[aktiverIndex - 1].key)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="btn-secondary px-2 text-xs"
                  disabled={aktiverIndex >= gruppierungen.length - 1}
                  title={t("erfassung.gruppenaechste")}
                  onClick={() => setGruppeFilter(gruppierungen[aktiverIndex + 1].key)}
                >
                  ›
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-neutral-500">{t("gemeinsam.laedt")}</p>
      ) : (
        angezeigteGruppen.map((g) => (
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

            <div className="flex items-start gap-3 print:hidden">
              <h2 className="w-72 shrink-0 text-base font-semibold text-emerald-800">
                {g.anzeige}{" "}
                <span className="font-normal text-neutral-500">
                  (
                  {t("erfassung.personenstd", {
                    n: g.employees.length,
                    std: formatMenge(gruppenStunden(g), 2),
                  })}
                  )
                </span>
              </h2>
              {canEditStunden && !gesperrt && (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="w-24"
                    placeholder={t("erfassung.gruppestundenplatzhalter")}
                    value={gruppenWert[g.key] ?? ""}
                    onChange={(e) =>
                      setGruppenWert((prev) => ({
                        ...prev,
                        [g.key]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        gruppeUebernehmen(g);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn text-xs"
                    disabled={
                      gruppeLaeuft !== null ||
                      (gruppenWert[g.key] ?? "").trim() === ""
                    }
                    title={t("erfassung.gruppeuebernehmentitel")}
                    onClick={() => gruppeUebernehmen(g)}
                  >
                    {t("erfassung.gruppeuebernehmen")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs text-red-700"
                    disabled={gruppeLaeuft !== null}
                    title={t("erfassung.gruppeleerentitel")}
                    onClick={() => gruppeLeeren(g)}
                  >
                    {t("erfassung.gruppeleeren")}
                  </button>
                  {gruppenMeldung[g.key] && (
                    <span
                      className={`text-xs font-medium ${gruppenMeldung[g.key].fehler ? "text-red-600" : "text-emerald-700"}`}
                    >
                      {gruppenMeldung[g.key].text}
                    </span>
                  )}
                </div>
              )}
              <button
                type="button"
                className="btn-secondary ml-auto shrink-0 text-xs"
                onClick={() => setPrintGroupKey(g.key)}
              >
                {t("erfassung.gruppedrucken")}
              </button>
            </div>

            {canEditStunden && (
              <div className="print:hidden">
                <button
                  type="button"
                  className="text-xs text-emerald-700 underline"
                  onClick={() =>
                    setZeitenOffen((prev) => ({ ...prev, [g.key]: !prev[g.key] }))
                  }
                >
                  {zeitenOffen[g.key]
                    ? t("erfassung.zeitenzu")
                    : t("erfassung.zeitenauf")}
                </button>
                {zeitenOffen[g.key] && !gesperrt && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-linie bg-sand px-3 py-2 text-sm">
                    <span className="font-medium">{t("erfassung.zeitengruppe")}</span>
                    {(
                      [
                        ["vmVon", "Vormittag von"],
                        ["vmBis", "Vormittag bis"],
                        ["nmVon", "Nachmittag von"],
                        ["nmBis", "Nachmittag bis"],
                      ] as const
                    ).map(([feld, titel], i) => (
                      <Fragment key={feld}>
                        {i === 2 && <span className="text-neutral-300">|</span>}
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          className="w-16 px-1 text-center"
                          placeholder="1130"
                          title={titel}
                          value={gruppenZeiten[g.key]?.[feld] ?? ""}
                          onChange={(e) =>
                            setGruppenZeiten((prev) => ({
                              ...prev,
                              [g.key]: {
                                ...LEERE_ZEITEN,
                                ...prev[g.key],
                                [feld]: e.target.value,
                              },
                            }))
                          }
                        />
                        {i === 0 || i === 2 ? (
                          <span className="text-neutral-400">–</span>
                        ) : null}
                      </Fragment>
                    ))}
                    <button
                      type="button"
                      className="btn text-xs"
                      disabled={gruppeLaeuft !== null}
                      title={t("erfassung.zeitengruppetitel")}
                      onClick={() => gruppeZeitenUebernehmen(g)}
                    >
                      {t("erfassung.zeitengruppesetzen")}
                    </button>
                    <label className="ml-auto flex items-center gap-1 text-xs text-neutral-600">
                      {t("erfassung.rundung")}
                      <select
                        value={zeitenRundung}
                        onChange={(e) => setZeitenRundung(e.target.value as Rundung)}
                      >
                        <option value="viertel">{t("erfassung.rundungviertel")}</option>
                        <option value="minute">{t("erfassung.rundungminute")}</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="overflow-x-auto print:hidden">
            <table className="whitespace-nowrap print:hidden">
              <thead>
                <tr>
                  <th>{t("erfassung.persnr")}</th>
                  {canGruppeAendern && <th>{t("erfassung.gruppe")}</th>}
                  <th>{t("erfassung.nachname")}</th>
                  <th>{t("erfassung.vorname")}</th>
                  <th>{t("erfassung.herkunft")}</th>
                  {(zeitenOffen[g.key]
                    ? wochenTage.filter((d) => d === datum)
                    : wochenTage
                  ).map((d) => {
                    const istBearbeitbar = d === datum;
                    return (
                      <th
                        key={d}
                        className={
                          istBearbeitbar
                            ? "font-semibold text-emerald-800"
                            : "cursor-pointer font-normal text-neutral-400 hover:text-emerald-700"
                        }
                        title={
                          istBearbeitbar
                            ? t("erfassung.stunden")
                            : `${t("erfassung.nurkontrolle")} – zum Bearbeiten anklicken`
                        }
                        onClick={
                          istBearbeitbar ? undefined : () => datumWechseln(d)
                        }
                      >
                        {kurzDatum(d)}
                      </th>
                    );
                  })}
                  {zeitenOffen[g.key] && <th>{t("erfassung.arbeitszeit")}</th>}
                  <th>{t("gemeinsam.notiz")}</th>
                  <th title="Immer sichtbar, unabhängig vom gewählten Tag - siehe Erklärung beim Aufklappen">
                    Stundenkonto
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.employees.map((emp) => {
                  const entry = entries[emp.id];
                  const saldo = stundenkontoSaldo[emp.id] ?? 0;
                  const stundenkontoOffen = stundenkontoOffenId === emp.id;
                  return (
                  <Fragment key={emp.id}>
                    <tr>
                      <td>
                        {emp.personal_nr}
                      </td>
                      {canGruppeAendern && (
                        <td>
                          <GruppenAuswahl
                            wert={emp.gruppe_nr}
                            gruppen={gruppen}
                            keineLabel={t("erfassung.keinegruppe")}
                            onWaehlen={(nr) => gruppeAendern(emp.id, nr)}
                          />
                        </td>
                      )}
                      <td>{emp.name}</td>
                      <td>
                        {emp.vorname}
                        {fuehrerschein[emp.id] && (
                          <span
                            title={`${t("erfassung.fuehrerschein")}: ${fuehrerschein[emp.id].join(", ")}`}
                          >
                            {fuehrerschein[emp.id].some((k) => k === "C" || k === "CE") ? (
                              <Truck className="ml-1.5 inline h-[18px] w-[18px] align-text-bottom text-emerald-700" />
                            ) : (
                              <Car className="ml-1.5 inline h-4 w-4 align-text-bottom text-emerald-700" />
                            )}
                          </span>
                        )}
                      </td>
                      <td>{emp.herkunft ?? "—"}</td>
                      {(zeitenOffen[g.key]
                        ? wochenTage.filter((d) => d === datum)
                        : wochenTage
                      ).map((d) => {
                        if (d === datum) {
                          return (
                            <td key={d}>
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
                              {entry?.markierung && (
                                <span
                                  className="ml-1 rounded bg-neutral-200 px-1 text-xs text-neutral-600"
                                  title={t("erfassung.markierunganzeige")}
                                >
                                  {entry.markierung}
                                </span>
                              )}
                            </td>
                          );
                        }
                        const kalt = kontextEntries[d]?.[emp.id];
                        return (
                          <td
                            key={d}
                            className="cursor-pointer text-neutral-400 hover:text-emerald-700"
                            onClick={() => datumWechseln(d)}
                            title="Zum Bearbeiten anklicken"
                          >
                            {kalt?.stunden ?? kalt?.markierung ?? "—"}
                          </td>
                        );
                      })}
                      {zeitenOffen[g.key] && (
                        <td>
                          <ZeitenZelle
                            key={`z-${emp.id}-${entry?.version ?? 0}`}
                            entry={entry}
                            rundung={zeitenRundung}
                            disabled={gesperrt || !canEditStunden}
                            onSpeichern={(w) => saveZeiten(emp.id, w)}
                          />
                        </td>
                      )}
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
                      <td>
                        <span
                          className={
                            saldo < 0
                              ? "font-medium text-red-600"
                              : "font-medium"
                          }
                        >
                          {formatMenge(saldo, 2)} Std.
                        </span>{" "}
                        {(canStundenkontoBuchen || canStundenkontoAuszahlen) && (
                          <button
                            type="button"
                            className="text-xs text-emerald-700 underline"
                            onClick={() => stundenkontoAufklappen(emp.id)}
                          >
                            {stundenkontoOffen ? "Schließen" : "Verwalten"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {stundenkontoOffen && (
                      <tr>
                        <td
                          colSpan={
                            6 +
                            (zeitenOffen[g.key] ? 1 : wochenTage.length) +
                            (zeitenOffen[g.key] ? 1 : 0) +
                            (canGruppeAendern ? 1 : 0)
                          }
                          className="whitespace-normal bg-sand"
                        >
                          <StundenkontoBereich
                            employeeId={emp.id}
                            saisonJahr={stundenkontoJahr}
                            personLabel={`${emp.name}, ${emp.vorname}`}
                            bearbeitetesDatum={datum}
                            onSaldoChange={(neu) =>
                              setStundenkontoSaldo((prev) => ({
                                ...prev,
                                [emp.id]: neu,
                              }))
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>

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
