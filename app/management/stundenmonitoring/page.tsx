"use client";

import { Fragment, useEffect, useState } from "react";
import { AlarmClock } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import {
  MAX_STUNDEN_PRO_TAG,
  type UeberstundenEintrag,
  type UeberstundenTag,
} from "@/lib/controlling";
import {
  kannStundenkontoAuszahlen,
  kannStundenkontoBuchen,
} from "@/lib/stundenkontoRechte";
import { speichereWorkEntryFeld } from "@/lib/workEntrySpeichern";
import type { Period } from "@/lib/types";
import StundenkontoBereich from "@/components/StundenkontoBereich";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";

const CURRENT_YEAR = new Date().getFullYear();

export default function ControllingStundenmonitoringPage() {
  const { profile } = useProfile();
  // Muss exakt zu work_entries_write/-update in schema.sql passen (RLS).
  const canEditStunden =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung";
  const canStundenkontoBuchen = kannStundenkontoBuchen(profile?.role);
  const canStundenkontoAuszahlen = kannStundenkontoAuszahlen(profile?.role);

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [ueberstunden, setUeberstunden] = useState<UeberstundenEintrag[]>([]);
  const [loadingUeberstunden, setLoadingUeberstunden] = useState(true);
  const [offenUeberstundenId, setOffenUeberstundenId] = useState<string | null>(
    null
  );
  const [gesperrteMonate, setGesperrteMonate] = useState<Set<number>>(new Set());
  const [ueberstundenFehler, setUeberstundenFehler] = useState<string | null>(
    null
  );

  async function loadUeberstunden() {
    setLoadingUeberstunden(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("work_entries")
      .select(
        "id, employee_id, datum, stunden, version, markierung, notiz, employees(personal_nr, name, vorname)"
      )
      .gt("stunden", MAX_STUNDEN_PRO_TAG)
      .gte("datum", `${jahr}-01-01`)
      .lte("datum", `${jahr}-12-31`)
      .order("datum");
    if (!error && data) {
      const proMitarbeiter = new Map<string, UeberstundenEintrag>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data as any[]).forEach((row) => {
        if (!proMitarbeiter.has(row.employee_id)) {
          proMitarbeiter.set(row.employee_id, {
            employee_id: row.employee_id,
            personal_nr: row.employees?.personal_nr ?? "",
            name: row.employees?.name ?? "",
            vorname: row.employees?.vorname ?? "",
            tage: [],
          });
        }
        proMitarbeiter.get(row.employee_id)!.tage.push({
          id: row.id,
          datum: row.datum,
          stunden: Number(row.stunden),
          version: row.version,
          markierung: row.markierung,
          notiz: row.notiz,
        });
      });
      const ergebnis = Array.from(proMitarbeiter.values()).sort(
        (a, b) => b.tage.length - a.tage.length
      );
      setUeberstunden(ergebnis);
    }
    setLoadingUeberstunden(false);
  }

  useEffect(() => {
    loadUeberstunden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  useEffect(() => {
    async function ladeGesperrteMonate() {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("periods")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("gesperrt", true);
      setGesperrteMonate(
        new Set(((data as Period[]) ?? []).map((p) => p.monat))
      );
    }
    ladeGesperrteMonate();
  }, [jahr]);

  async function ueberstundenSpeichern(
    employeeId: string,
    tag: UeberstundenTag,
    wert: string
  ) {
    const stunden = wert === "" ? null : Number(wert);
    const ergebnis = await speichereWorkEntryFeld(
      employeeId,
      tag.datum,
      {
        id: tag.id,
        employee_id: employeeId,
        datum: tag.datum,
        stunden: tag.stunden,
        version: tag.version,
        markierung: tag.markierung,
        notiz: tag.notiz,
      },
      { stunden }
    );
    if (!ergebnis.ok) {
      setUeberstundenFehler(
        ergebnis.konflikt
          ? "Konnte nicht gespeichert werden - eine andere Person hat diesen Eintrag zwischenzeitlich geändert. Die Liste wurde neu geladen, bitte bei Bedarf erneut eingeben."
          : `Konnte nicht gespeichert werden: ${ergebnis.fehler}`
      );
    } else {
      setUeberstundenFehler(null);
    }
    await loadUeberstunden();
  }

  const tageGesamt = ueberstunden.reduce((summe, u) => summe + u.tage.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <ControllingTabs />
      <PageHeader
        icon={AlarmClock}
        titel="Stundenmonitoring"
        beschreibung={`Personen mit mindestens einem Tag über ${MAX_STUNDEN_PRO_TAG.toFixed(
          2
        )} Stunden in der Stundenerfassung. Aufklappen zeigt die betroffenen Tage – direkt hier bearbeitbar.`}
      />

      <p className="text-sm text-neutral-600">
        Anzahl Tage &gt; {MAX_STUNDEN_PRO_TAG.toFixed(0)} Std.:{" "}
        <span className="font-medium text-amber-600">
          {loadingUeberstunden ? "…" : tageGesamt}
        </span>
      </p>

      <label className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 block bg-sand py-2 text-sm">
        Saison-Jahr{" "}
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
          className="w-24"
        />
      </label>

      {loadingUeberstunden ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : ueberstunden.length === 0 ? (
        <p className="text-neutral-500">
          Keine Tage über {MAX_STUNDEN_PRO_TAG.toFixed(2)} Stunden für {jahr}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Anzahl Tage &gt; {MAX_STUNDEN_PRO_TAG.toFixed(0)} Std.</th>
                <th>Höchstwert Std.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ueberstunden.map((u) => {
                const offen = offenUeberstundenId === u.employee_id;
                const hoechstwert = Math.max(...u.tage.map((t) => t.stunden));
                return (
                  <Fragment key={u.employee_id}>
                    <tr>
                      <td>{u.personal_nr}</td>
                      <td>
                        {u.name}, {u.vorname}
                      </td>
                      <td className="font-medium text-amber-600">
                        {u.tage.length}
                      </td>
                      <td>{hoechstwert.toFixed(2)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() =>
                            setOffenUeberstundenId(
                              offen ? null : u.employee_id
                            )
                          }
                        >
                          {offen ? "Schließen" : "Anzeigen"}
                        </button>
                      </td>
                    </tr>
                    {offen && (
                      <tr>
                        <td colSpan={5} className="bg-sand">
                          <div className="flex flex-col gap-3 p-2">
                            {!canEditStunden && (
                              <p className="text-xs text-amber-700">
                                Deine Rolle darf Stunden nicht bearbeiten - nur
                                zur Ansicht.
                              </p>
                            )}
                            {ueberstundenFehler && (
                              <p className="text-sm font-medium text-red-600">
                                ⚠ {ueberstundenFehler}
                              </p>
                            )}
                            <table>
                              <thead>
                                <tr>
                                  <th>Datum</th>
                                  <th>Stunden</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...u.tage]
                                  .sort((a, b) =>
                                    a.datum.localeCompare(b.datum)
                                  )
                                  .map((t) => {
                                    const monat = Number(t.datum.slice(5, 7));
                                    const tagGesperrt =
                                      gesperrteMonate.has(monat);
                                    return (
                                      <tr key={t.id}>
                                        <td>
                                          {formatDatumDE(t.datum)}
                                          {tagGesperrt && (
                                            <span
                                              className="ml-1 text-xs text-amber-600"
                                              title="Monat per Monatsabschluss gesperrt"
                                            >
                                              🔒
                                            </span>
                                          )}
                                        </td>
                                        <td>
                                          <input
                                            type="number"
                                            min={0}
                                            max={24}
                                            step={0.25}
                                            className="w-20 font-medium text-amber-600"
                                            defaultValue={t.stunden}
                                            key={`${t.id}-${t.version}`}
                                            disabled={
                                              tagGesperrt || !canEditStunden
                                            }
                                            onBlur={(e) =>
                                              ueberstundenSpeichern(
                                                u.employee_id,
                                                t,
                                                e.target.value
                                              )
                                            }
                                          />
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>

                            {(canStundenkontoBuchen ||
                              canStundenkontoAuszahlen) && (
                              <div className="rounded border border-linie bg-white">
                                <StundenkontoBereich
                                  employeeId={u.employee_id}
                                  saisonJahr={jahr}
                                  personLabel={`${u.name}, ${u.vorname}`}
                                />
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
