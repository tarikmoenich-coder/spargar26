"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import {
  arbeitsserieRelevant,
  serieCutoffISO,
} from "@/lib/controlling";
import { speichereWorkEntryFeld } from "@/lib/workEntrySpeichern";
import {
  addTageIso,
  montagDerWoche,
  sonntagDerWoche,
  tagMonat,
  wochenBauen,
  WOCHENTAGE_KUERZEL,
} from "@/lib/woche";
import type { ArbeitstageSerie, Period, WorkEntry } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";

function serieKey(s: ArbeitstageSerie) {
  return `${s.employee_id}-${s.serie_bis}`;
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

  // Aufgeklapptes Wochenraster einer Serie.
  const [offenKey, setOffenKey] = useState<string | null>(null);
  const [rasterEntries, setRasterEntries] = useState<WorkEntry[]>([]);
  const [loadingRaster, setLoadingRaster] = useState(false);
  const [rasterFehler, setRasterFehler] = useState<string | null>(null);
  // Per Monatsabschluss gesperrte Monate im Raster-Zeitraum, Key "YYYY-MM".
  const [gesperrtRaster, setGesperrtRaster] = useState<Set<string>>(new Set());

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

  const cutoff = serieCutoffISO();
  const relevante = arbeitsserie.filter((s) => arbeitsserieRelevant(s, cutoff));
  const serieRot = relevante.filter((s) => s.ampel === "rot").length;
  const serieGelb = relevante.filter((s) => s.ampel === "gelb").length;
  const serieErsatzFehlt = relevante.filter(
    (s) =>
      s.ersatzausgleich === "fehlt" || s.ersatzausgleich === "kein_ausgleich"
  ).length;

  // Rasterfenster: von Montag der Serienstartwoche bis Sonntag der Woche
  // NACH dem Serienende (eine Woche Puffer - zeigt, ob danach Ruhetage
  // genommen wurden).
  function rasterFenster(s: ArbeitstageSerie) {
    const von = montagDerWoche(s.serie_von);
    const bis = addTageIso(sonntagDerWoche(s.serie_bis), 7);
    return { von, bis };
  }

  async function loadRaster(s: ArbeitstageSerie) {
    setLoadingRaster(true);
    setRasterFehler(null);
    const supabase = getSupabaseClient();
    const { von, bis } = rasterFenster(s);
    const jahre = Array.from(
      new Set([Number(von.slice(0, 4)), Number(bis.slice(0, 4))])
    );
    const [{ data, error }, { data: perioden }] = await Promise.all([
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
    ]);
    if (error) {
      setRasterFehler(error.message);
      setRasterEntries([]);
    } else {
      setRasterEntries((data as WorkEntry[]) ?? []);
    }
    setGesperrtRaster(
      new Set(
        ((perioden as Period[]) ?? []).map(
          (p) => `${p.saison_jahr}-${String(p.monat).padStart(2, "0")}`
        )
      )
    );
    setLoadingRaster(false);
  }

  function toggleSerie(s: ArbeitstageSerie) {
    const key = serieKey(s);
    if (offenKey === key) {
      setOffenKey(null);
      return;
    }
    setOffenKey(key);
    loadRaster(s);
  }

  async function rasterFeldSpeichern(
    s: ArbeitstageSerie,
    datum: string,
    entry: WorkEntry | undefined,
    wert: string
  ) {
    const stunden = wert === "" ? null : Number(wert);
    const ergebnis = await speichereWorkEntryFeld(
      s.employee_id,
      datum,
      entry ?? null,
      { stunden }
    );
    if (!ergebnis.ok) {
      setRasterFehler(
        ergebnis.konflikt
          ? "Konnte nicht gespeichert werden - eine andere Person hat diesen Tag zwischenzeitlich geändert. Das Raster wurde neu geladen, bitte bei Bedarf erneut eingeben."
          : `Konnte nicht gespeichert werden: ${ergebnis.fehler}`
      );
    } else {
      setRasterFehler(null);
    }
    // Raster neu laden - und die Serien-Übersicht: ein genullter Tag kann die
    // Serie verkürzen, teilen oder ganz auflösen.
    await Promise.all([loadRaster(s), loadArbeitsserie()]);
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
                const offen = offenKey === key;
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
                          onClick={() => toggleSerie(s)}
                        >
                          {offen ? "Schließen" : "Bearbeiten"}
                        </button>{" "}
                        <Link
                          href={`/erfassung?datum=${s.serie_bis}&employee=${s.employee_id}`}
                          className="btn-secondary text-xs"
                        >
                          In Erfassung
                        </Link>
                      </td>
                    </tr>
                    {offen && (
                      <tr>
                        <td colSpan={7} className="bg-sand">
                          <div className="flex flex-col gap-2 p-2">
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
                            <p className="text-xs text-neutral-500">
                              Kritischer Zeitraum bernstein hinterlegt. Eine
                              Stunde auf 0 setzen (bzw. leeren) unterbricht die
                              Serie - die Übersicht aktualisiert sich danach.
                            </p>
                            {loadingRaster ? (
                              <p className="text-neutral-500">Lädt…</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="min-w-[640px]">
                                  <thead>
                                    <tr>
                                      {WOCHENTAGE_KUERZEL.map((w) => (
                                        <th key={w}>{w}</th>
                                      ))}
                                      <th>Summe</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(() => {
                                      const { von } = rasterFenster(s);
                                      const bis = addTageIso(
                                        sonntagDerWoche(s.serie_bis),
                                        7
                                      );
                                      return wochenBauen(
                                        rasterEntries,
                                        von,
                                        bis
                                      ).map((woche) => (
                                        <tr key={woche.montag}>
                                          {woche.tage.map((tag) => {
                                            const imKritischen =
                                              tag.datum >= s.serie_von &&
                                              tag.datum <= s.serie_bis;
                                            const jm = tag.datum.slice(0, 7);
                                            const tagGesperrt =
                                              gesperrtRaster.has(jm);
                                            return (
                                              <td
                                                key={tag.datum}
                                                className={
                                                  imKritischen
                                                    ? "bg-amber-50 align-top"
                                                    : "align-top"
                                                }
                                              >
                                                <div className="text-left text-xs text-neutral-500">
                                                  {tagMonat(tag.datum)}
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
                                                  defaultValue={
                                                    tag.entry?.stunden ?? ""
                                                  }
                                                  key={
                                                    tag.entry
                                                      ? `${tag.entry.id}-${tag.entry.version}`
                                                      : tag.datum
                                                  }
                                                  disabled={
                                                    tagGesperrt ||
                                                    !canEditStunden
                                                  }
                                                  onBlur={(e) =>
                                                    rasterFeldSpeichern(
                                                      s,
                                                      tag.datum,
                                                      tag.entry,
                                                      e.target.value
                                                    )
                                                  }
                                                />
                                                {tag.entry?.markierung && (
                                                  <div className="text-xs text-neutral-500">
                                                    {tag.entry.markierung}
                                                  </div>
                                                )}
                                              </td>
                                            );
                                          })}
                                          <td className="align-top font-semibold">
                                            {woche.summe.toFixed(2)}
                                          </td>
                                        </tr>
                                      ));
                                    })()}
                                  </tbody>
                                </table>
                              </div>
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
