"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, Calculator } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import { arbeitsserieRelevant, serieCutoffISO } from "@/lib/controlling";
import {
  speichereWorkEntryFeld,
  type WorkEntryPatch,
} from "@/lib/workEntrySpeichern";
import {
  addTageIso,
  montagDerWoche,
  sonntagDerWoche,
  tagMonat,
  wochenBauen,
  WOCHENTAGE_KUERZEL,
} from "@/lib/woche";
import type {
  ArbeitstageBearbeitungLock,
  ArbeitstageSerie,
  Period,
  WorkEntry,
} from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";

function serieKey(s: ArbeitstageSerie) {
  return `${s.employee_id}-${s.serie_bis}`;
}

type OrigDay = { stunden: number | null; markierung: string | null };
// markierung als String, damit ein bestehendes "F" (Fahrer) nicht durch den
// nur "—/U"-Dropdown verloren geht - es bleibt als dritte Option erhalten,
// bis es bewusst geändert wird.
type DraftDay = { stunden: string; markierung: string };

interface LockZustand {
  own: boolean;
  halter?: string;
  seit?: string;
}

export default function ControllingArbeitstagePage() {
  const { profile } = useProfile();
  // Muss zu work_entries_write/-update (RLS) passen - wie Stundenerfassung.
  const canEditStunden =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung";

  const [arbeitsserie, setArbeitsserie] = useState<ArbeitstageSerie[]>([]);
  const [loadingArbeitsserie, setLoadingArbeitsserie] = useState(true);
  const [arbeitsserieFehler, setArbeitsserieFehler] = useState<string | null>(
    null
  );

  // Aufgeklapptes Wochenraster (immer nur eines gleichzeitig).
  const [offen, setOffen] = useState<ArbeitstageSerie | null>(null);
  const [rasterEntries, setRasterEntries] = useState<WorkEntry[]>([]);
  const [original, setOriginal] = useState<Record<string, OrigDay>>({});
  const [draft, setDraft] = useState<Record<string, DraftDay>>({});
  const [frozenSums, setFrozenSums] = useState<Record<string, number>>({});
  const [lock, setLock] = useState<LockZustand | null>(null);
  const [urlaub, setUrlaub] = useState<{
    anspruch: number;
    genommen: number;
    rest: number;
  } | null>(null);
  const [loadingRaster, setLoadingRaster] = useState(false);
  const [rasterFehler, setRasterFehler] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFehler, setSaveFehler] = useState<string[]>([]);
  // Per Monatsabschluss gesperrte Monate im Raster-Zeitraum, Key "YYYY-MM".
  const [gesperrtRaster, setGesperrtRaster] = useState<Set<string>>(new Set());

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Für die Freigabe der Sperre beim Unmount (Closure wäre dann veraltet).
  const freigabeRef = useRef<string | null>(null);
  const profileIdRef = useRef<string | null>(null);
  profileIdRef.current = profile?.id ?? null;

  async function loadArbeitsserie() {
    setLoadingArbeitsserie(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("arbeitstage_serie_uebersicht")
      .select("*");
    if (error) {
      setArbeitsserieFehler(error.message);
    } else {
      setArbeitsserieFehler(null);
      setArbeitsserie((data as ArbeitstageSerie[]) ?? []);
    }
    setLoadingArbeitsserie(false);
  }

  useEffect(() => {
    loadArbeitsserie();
  }, []);

  // Sperre beim Verlassen der Seite freigeben (Backstop: 3-Min-Ablauf in DB).
  useEffect(() => {
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      const emp = freigabeRef.current;
      const pid = profileIdRef.current;
      if (emp && pid) {
        getSupabaseClient()
          .from("arbeitstage_bearbeitung_lock")
          .delete()
          .eq("employee_id", emp)
          .eq("gesperrt_von", pid)
          .then(() => {});
      }
    };
  }, []);

  const cutoff = serieCutoffISO();
  const relevante = arbeitsserie.filter((s) => arbeitsserieRelevant(s, cutoff));
  const serieRot = relevante.filter((s) => s.ampel === "rot").length;
  const serieGelb = relevante.filter((s) => s.ampel === "gelb").length;
  const serieErsatzFehlt = relevante.filter(
    (s) =>
      s.ersatzausgleich === "fehlt" || s.ersatzausgleich === "kein_ausgleich"
  ).length;

  // Rasterfenster: Montag der Serienstartwoche bis Sonntag der Woche NACH
  // dem Serienende (eine Woche Puffer - zeigt, ob danach Ruhetage kamen).
  function rasterFenster(s: ArbeitstageSerie) {
    return {
      von: montagDerWoche(s.serie_von),
      bis: addTageIso(sonntagDerWoche(s.serie_bis), 7),
    };
  }

  const alleDatums = Object.keys(draft);

  function istGeaendert(datum: string): boolean {
    const o = original[datum] ?? { stunden: null, markierung: null };
    const d = draft[datum];
    if (!d) return false;
    const ds = d.stunden.trim() === "" ? null : Number(d.stunden);
    const dm = d.markierung === "" ? null : d.markierung;
    return (ds ?? null) !== (o.stunden ?? null) || (dm ?? null) !== (o.markierung ?? null);
  }
  const dirty = alleDatums.some(istGeaendert);

  const neueU = alleDatums.filter(
    (d) => draft[d]?.markierung === "U" && (original[d]?.markierung ?? null) !== "U"
  ).length;
  const wegU = alleDatums.filter(
    (d) => (original[d]?.markierung ?? null) === "U" && draft[d]?.markierung !== "U"
  ).length;
  const restNachSpeichern = urlaub ? urlaub.rest - neueU + wegU : null;

  function liveWochensumme(datums: string[]): number {
    return datums.reduce((s, d) => s + Number(draft[d]?.stunden || 0), 0);
  }

  // Nur die Daten (work_entries/periods/urlaub) neu laden & Entwurf neu
  // aufsetzen - ohne die Sperre neu zu erwerben oder den Heartbeat
  // anzufassen. Nach "Alles speichern".
  async function ladeRasterDaten(s: ArbeitstageSerie) {
    const supabase = getSupabaseClient();
    const { von, bis } = rasterFenster(s);
    const jahre = Array.from(
      new Set([Number(von.slice(0, 4)), Number(bis.slice(0, 4))])
    );
    const saisonJahr = Number(s.serie_bis.slice(0, 4));
    const [{ data, error }, { data: perioden }, { data: urlaubRow }] =
      await Promise.all([
        supabase
          .from("work_entries")
          .select("id, employee_id, datum, stunden, version, markierung, notiz")
          .eq("employee_id", s.employee_id)
          .gte("datum", von)
          .lte("datum", bis)
          .order("datum"),
        supabase
          .from("periods")
          .select("*")
          .in("saison_jahr", jahre)
          .eq("gesperrt", true),
        supabase
          .from("employee_urlaubstage")
          .select("urlaubsanspruch_tage, u_tage, resturlaub_tage")
          .eq("employee_id", s.employee_id)
          .eq("saison_jahr", saisonJahr)
          .maybeSingle(),
      ]);

    if (error) {
      setRasterFehler(error.message);
      setRasterEntries([]);
      setOriginal({});
      setDraft({});
      setFrozenSums({});
    } else {
      setRasterFehler(null);
      const entries = (data as WorkEntry[]) ?? [];
      setRasterEntries(entries);
      const byDatum = new Map(entries.map((e) => [e.datum, e]));
      const orig: Record<string, OrigDay> = {};
      const dr: Record<string, DraftDay> = {};
      const fs: Record<string, number> = {};
      for (const w of wochenBauen(entries, von, bis)) {
        let summe = 0;
        for (const t of w.tage) {
          const e = byDatum.get(t.datum);
          const os: OrigDay = {
            stunden: e?.stunden ?? null,
            markierung: e?.markierung ?? null,
          };
          orig[t.datum] = os;
          dr[t.datum] = {
            stunden: os.stunden === null ? "" : String(os.stunden),
            markierung: os.markierung ?? "",
          };
          summe += Number(os.stunden ?? 0);
        }
        fs[w.montag] = summe;
      }
      setOriginal(orig);
      setDraft(dr);
      setFrozenSums(fs);
    }
    setGesperrtRaster(
      new Set(
        ((perioden as Period[]) ?? []).map(
          (p) => `${p.saison_jahr}-${String(p.monat).padStart(2, "0")}`
        )
      )
    );
    const ur = urlaubRow as {
      urlaubsanspruch_tage: number;
      u_tage: number;
      resturlaub_tage: number;
    } | null;
    setUrlaub(
      ur
        ? { anspruch: ur.urlaubsanspruch_tage, genommen: ur.u_tage, rest: ur.resturlaub_tage }
        : null
    );
  }

  async function oeffneSerie(s: ArbeitstageSerie) {
    if (offen) {
      const ok = await schliesseSerie();
      if (!ok) return;
    }
    setOffen(s);
    setSaveFehler([]);
    setLoadingRaster(true);

    const supabase = getSupabaseClient();
    let lockOwn = true;
    if (canEditStunden) {
      const { data, error } = await supabase.rpc("arbeitstage_lock_erwerben", {
        p_employee_id: s.employee_id,
      });
      const row = (Array.isArray(data) ? data[0] : data) as
        | { ok: boolean; halter: string | null; seit: string }
        | null
        | undefined;
      if (error || !row) {
        // RPC nicht verfügbar (Migration fehlt) - nicht hart blockieren.
        setLock({ own: true });
        lockOwn = true;
      } else if (row.ok) {
        setLock({ own: true });
        lockOwn = true;
      } else {
        setLock({
          own: false,
          halter: row.halter ?? "jemand",
          seit: row.seit,
        });
        lockOwn = false;
      }
    } else {
      lockOwn = false;
      const { data: lr } = await supabase
        .from("arbeitstage_bearbeitung_lock")
        .select("*")
        .eq("employee_id", s.employee_id)
        .maybeSingle();
      const row = lr as ArbeitstageBearbeitungLock | null;
      if (row) {
        const { data: pn } = await supabase
          .from("profile_namen")
          .select("full_name")
          .eq("id", row.gesperrt_von)
          .maybeSingle();
        setLock({
          own: false,
          halter: (pn as { full_name: string } | null)?.full_name ?? "jemand",
          seit: row.gesperrt_am,
        });
      } else {
        setLock({ own: false });
      }
    }

    await ladeRasterDaten(s);
    setLoadingRaster(false);

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (canEditStunden && lockOwn) {
      freigabeRef.current = s.employee_id;
      heartbeatRef.current = setInterval(() => {
        const pid = profileIdRef.current;
        if (!pid) return;
        getSupabaseClient()
          .from("arbeitstage_bearbeitung_lock")
          .update({ zuletzt_gesehen: new Date().toISOString() })
          .eq("employee_id", s.employee_id)
          .eq("gesperrt_von", pid)
          .then(() => {});
      }, 60_000);
    }
  }

  async function schliesseSerie(): Promise<boolean> {
    if (dirty && !window.confirm("Nicht gespeicherte Änderungen verwerfen?")) {
      return false;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    const emp = freigabeRef.current;
    const pid = profileIdRef.current;
    if (emp && pid) {
      getSupabaseClient()
        .from("arbeitstage_bearbeitung_lock")
        .delete()
        .eq("employee_id", emp)
        .eq("gesperrt_von", pid)
        .then(() => {});
    }
    freigabeRef.current = null;
    setOffen(null);
    setRasterEntries([]);
    setOriginal({});
    setDraft({});
    setFrozenSums({});
    setLock(null);
    setUrlaub(null);
    setSaveFehler([]);
    setRasterFehler(null);
    return true;
  }

  // Serie durch die Bearbeitung verkürzt/aufgelöst -> Raster schließen &
  // Sperre freigeben (nach "Alles speichern" ist der Entwurf nicht dirty,
  // also fragt schliesseSerie nicht nach).
  useEffect(() => {
    if (!offen || loadingArbeitsserie || loadingRaster) return;
    const nochDa = arbeitsserie.some((x) => serieKey(x) === serieKey(offen));
    if (!nochDa) schliesseSerie();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbeitsserie]);

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (offen && dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [offen, dirty]);

  function setDraftFeld(datum: string, patch: Partial<DraftDay>) {
    setDraft((prev) => ({
      ...prev,
      [datum]: { ...prev[datum], ...patch },
    }));
  }

  function entwurfVerwerfen() {
    setDraft(() => {
      const dr: Record<string, DraftDay> = {};
      for (const [datum, o] of Object.entries(original)) {
        dr[datum] = {
          stunden: o.stunden === null ? "" : String(o.stunden),
          markierung: o.markierung ?? "",
        };
      }
      return dr;
    });
    setSaveFehler([]);
  }

  async function allesSpeichern() {
    const s = offen;
    if (!s) return;
    setSaving(true);
    const fehler: string[] = [];
    for (const datum of alleDatums.slice().sort()) {
      if (!istGeaendert(datum)) continue;
      const o = original[datum] ?? { stunden: null, markierung: null };
      const d = draft[datum];
      const neuStunden = d.stunden.trim() === "" ? null : Number(d.stunden);
      const neuMark = d.markierung === "" ? null : d.markierung;
      if (
        neuStunden !== null &&
        (Number.isNaN(neuStunden) || neuStunden < 0 || neuStunden > 24)
      ) {
        fehler.push(`${formatDatumDE(datum)}: ungültige Stundenzahl`);
        continue;
      }
      const patch: WorkEntryPatch = {};
      if ((neuStunden ?? null) !== (o.stunden ?? null)) patch.stunden = neuStunden;
      if ((neuMark ?? null) !== (o.markierung ?? null)) patch.markierung = neuMark;
      const existing = rasterEntries.find((e) => e.datum === datum) ?? null;
      const res = await speichereWorkEntryFeld(s.employee_id, datum, existing, patch);
      if (!res.ok) {
        fehler.push(
          `${formatDatumDE(datum)}: ${
            res.konflikt
              ? "wurde zwischenzeitlich in der Stundenerfassung geändert"
              : res.fehler ?? "Fehler beim Speichern"
          }`
        );
      }
    }
    setSaveFehler(fehler);
    await ladeRasterDaten(s);
    await loadArbeitsserie();
    setSaving(false);
  }

  function ersatzausgleichText(s: ArbeitstageSerie) {
    if (s.ersatzausgleich === null) return <>—</>;
    if (s.ersatzausgleich === "kein_ausgleich")
      return (
        <span className="font-medium text-red-600">
          kein legaler Ausgleich möglich
        </span>
      );
    if (s.ersatzausgleich === "erfuellt") return <>erfüllt</>;
    if (s.ersatzausgleich === "offen")
      return (
        <>
          {`offen (${s.ersatz_freie_tage ?? 0}/2 freie Tage${
            s.ersatz_fenster_bis
              ? `, bis ${formatDatumDE(s.ersatz_fenster_bis)}`
              : ""
          })`}
        </>
      );
    return (
      <span className="font-medium text-red-600">
        fehlt ({s.ersatz_freie_tage ?? 0}/2 freie Tage)
      </span>
    );
  }

  const kannBearbeiten = canEditStunden && lock?.own === true;

  return (
    <div className="flex flex-col gap-4">
      <ControllingTabs />
      <PageHeader
        icon={CalendarClock}
        titel="Arbeitstage am Stück"
        beschreibung="Aufeinanderfolgende Arbeitstage ohne freien Tag (Pause = 0 Std., „U“ oder kein Eintrag; „F“/Fahrer zählt als Arbeitstag). Ab 7 Tagen gelb, ab 14 Tagen rot. Nach 14 Tagen am Stück verlangt das Arbeitszeitgesetz 2 freie Tage in der Folgewoche (Ersatzausgleich); ab 21 Tagen gibt es keinen legalen Ausgleich mehr. Aktueller Stand, unabhängig vom Jahr."
      />

      <p className="text-sm text-neutral-600">
        {loadingArbeitsserie ? (
          "…"
        ) : (
          <>
            <span className="font-medium text-red-600">{serieRot}</span> rot ·{" "}
            <span className="font-medium text-amber-600">{serieGelb}</span> gelb
            {serieErsatzFehlt > 0 && (
              <>
                {" · "}
                <span className="font-medium text-red-600">
                  {serieErsatzFehlt}× Ersatzausgleich fehlt
                </span>
              </>
            )}
          </>
        )}
      </p>

      {loadingArbeitsserie ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : arbeitsserieFehler ? (
        <p className="text-sm text-red-600">
          Auswertung nicht verfügbar ({arbeitsserieFehler}). Vermutlich fehlt
          die Migration 2026-09-19 (arbeitstage_serie_uebersicht) in der
          Datenbank.
        </p>
      ) : relevante.length === 0 ? (
        <p className="text-neutral-500">
          Kein Handlungsbedarf - keine Serie von 7 oder mehr Arbeitstagen am
          Stück in den letzten Wochen.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Tage am Stück</th>
                <th>Zeitraum</th>
                <th>Status</th>
                <th>Ersatzausgleich</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {relevante.map((s) => {
                const key = serieKey(s);
                const istOffen = !!offen && serieKey(offen) === key;
                return (
                  <Fragment key={key}>
                    <tr>
                      <td>{s.personal_nr}</td>
                      <td>
                        {s.name}, {s.vorname}
                      </td>
                      <td
                        className={
                          s.ampel === "rot"
                            ? "font-medium text-red-600"
                            : "font-medium text-amber-600"
                        }
                      >
                        {s.serie_tage}
                      </td>
                      <td className="whitespace-nowrap">
                        {formatDatumDE(s.serie_von)} –{" "}
                        {formatDatumDE(s.serie_bis)}
                      </td>
                      <td className="text-sm">
                        {s.laeuft_noch ? "läuft noch" : "beendet"}
                      </td>
                      <td className="text-sm">{ersatzausgleichText(s)}</td>
                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() =>
                            istOffen ? schliesseSerie() : oeffneSerie(s)
                          }
                        >
                          {istOffen ? "Schließen" : "Bearbeiten"}
                        </button>{" "}
                        <Link
                          href={`/erfassung?datum=${s.serie_bis}&employee=${s.employee_id}`}
                          className="btn-secondary text-xs"
                        >
                          In Erfassung
                        </Link>
                      </td>
                    </tr>
                    {istOffen && (
                      <tr>
                        <td colSpan={7} className="bg-sand">
                          <div className="flex flex-col gap-2 p-2">
                            {lock && !lock.own && (
                              <p className="text-sm font-medium text-red-600">
                                🔒 Wird gerade von {lock.halter ?? "jemand"}{" "}
                                bearbeitet
                                {lock.seit
                                  ? ` (seit ${new Date(
                                      lock.seit
                                    ).toLocaleString("de-DE")})`
                                  : ""}
                                . Nur Ansicht.
                              </p>
                            )}
                            {!canEditStunden && (
                              <p className="text-xs text-amber-700">
                                Deine Rolle darf Stunden nicht bearbeiten - nur
                                zur Ansicht.
                              </p>
                            )}
                            {rasterFehler && (
                              <p className="text-sm font-medium text-red-600">
                                ⚠ {rasterFehler}
                              </p>
                            )}
                            {saveFehler.length > 0 && (
                              <div className="text-sm font-medium text-red-600">
                                ⚠ Nicht gespeichert:
                                <ul className="ml-4 list-disc font-normal">
                                  {saveFehler.map((f) => (
                                    <li key={f}>{f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <p className="text-xs text-neutral-500">
                              Wochensummen sind eingefroren; {" "}
                              <span className="inline-flex items-center gap-0.5 text-amber-700">
                                <Calculator className="h-3 w-3" /> Δ
                              </span>{" "}
                              zeigt die Differenz zum Original. Erst „Alles
                              speichern“ schreibt – die Serien-Übersicht
                              aktualisiert sich danach.
                            </p>

                            {loadingRaster ? (
                              <p className="text-neutral-500">Lädt…</p>
                            ) : (
                              <>
                                <div className="overflow-x-auto">
                                  <table className="min-w-[680px]">
                                    <thead>
                                      <tr>
                                        {WOCHENTAGE_KUERZEL.map((w) => (
                                          <th key={w}>{w}</th>
                                        ))}
                                        <th>Summe</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {wochenBauen(
                                        rasterEntries,
                                        rasterFenster(s).von,
                                        rasterFenster(s).bis
                                      ).map((woche) => {
                                        const datums = woche.tage.map(
                                          (t) => t.datum
                                        );
                                        const frozen =
                                          frozenSums[woche.montag] ?? 0;
                                        const live = liveWochensumme(datums);
                                        const delta = live - frozen;
                                        return (
                                          <tr key={woche.montag}>
                                            {woche.tage.map((tag) => {
                                              const d = tag.datum;
                                              const imKritischen =
                                                d >= s.serie_von &&
                                                d <= s.serie_bis;
                                              const jm = d.slice(0, 7);
                                              const tagGesperrt =
                                                gesperrtRaster.has(jm);
                                              const dd =
                                                draft[d] ?? {
                                                  stunden: "",
                                                  markierung: "",
                                                };
                                              return (
                                                <td
                                                  key={d}
                                                  className={
                                                    imKritischen
                                                      ? "bg-amber-50 align-top"
                                                      : "align-top"
                                                  }
                                                >
                                                  <div className="text-left text-xs text-neutral-500">
                                                    {tagMonat(d)}
                                                    {tagGesperrt && (
                                                      <span
                                                        className="ml-1 text-amber-600"
                                                        title="Monat per Monatsabschluss gesperrt"
                                                      >
                                                        🔒
                                                      </span>
                                                    )}
                                                  </div>
                                                  <input
                                                    type="number"
                                                    min={0}
                                                    max={24}
                                                    step={0.25}
                                                    className="w-16"
                                                    value={dd.stunden}
                                                    disabled={
                                                      !kannBearbeiten ||
                                                      tagGesperrt ||
                                                      dd.markierung === "U"
                                                    }
                                                    onChange={(e) =>
                                                      setDraftFeld(d, {
                                                        stunden: e.target.value,
                                                      })
                                                    }
                                                  />
                                                  <select
                                                    className="mt-1 w-20 text-xs"
                                                    value={dd.markierung}
                                                    disabled={
                                                      !kannBearbeiten ||
                                                      tagGesperrt
                                                    }
                                                    onChange={(e) => {
                                                      const v = e.target.value;
                                                      setDraftFeld(
                                                        d,
                                                        v === "U"
                                                          ? {
                                                              markierung: "U",
                                                              stunden: "",
                                                            }
                                                          : { markierung: v }
                                                      );
                                                    }}
                                                  >
                                                    <option value="">—</option>
                                                    <option value="U">
                                                      Urlaub
                                                    </option>
                                                    {dd.markierung !== "" &&
                                                      dd.markierung !== "U" && (
                                                        <option
                                                          value={dd.markierung}
                                                        >
                                                          {dd.markierung}
                                                        </option>
                                                      )}
                                                  </select>
                                                </td>
                                              );
                                            })}
                                            <td className="align-top">
                                              <span className="font-semibold">
                                                {frozen.toFixed(2)}
                                              </span>
                                              {Math.abs(delta) >= 0.005 && (
                                                <span className="ml-1 inline-flex items-center gap-0.5 text-amber-700">
                                                  <Calculator className="h-3 w-3" />
                                                  Δ {delta > 0 ? "+" : ""}
                                                  {delta.toFixed(2)}
                                                </span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {urlaub && (
                                  <p className="text-sm">
                                    Offener Urlaubsanspruch:{" "}
                                    <span className="font-medium">
                                      {urlaub.rest}
                                    </span>{" "}
                                    von {urlaub.anspruch} Tagen (bisher{" "}
                                    {urlaub.genommen}× „U“).
                                    {(neueU > 0 || wegU > 0) &&
                                      restNachSpeichern !== null && (
                                        <>
                                          {" "}
                                          Nach dem Speichern verbleibend:{" "}
                                          <span
                                            className={`font-medium ${
                                              restNachSpeichern < 0
                                                ? "text-red-600"
                                                : "text-emerald-700"
                                            }`}
                                          >
                                            {restNachSpeichern}
                                          </span>
                                          .
                                        </>
                                      )}
                                  </p>
                                )}

                                {canEditStunden && (
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      className="btn"
                                      disabled={!dirty || saving || !lock?.own}
                                      onClick={allesSpeichern}
                                    >
                                      {saving ? "Speichert…" : "Alles speichern"}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      disabled={!dirty || saving}
                                      onClick={entwurfVerwerfen}
                                    >
                                      Verwerfen
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      onClick={() => schliesseSerie()}
                                    >
                                      Schließen
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
