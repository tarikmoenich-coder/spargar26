"use client";

// Wiederverwendbares Wochenraster zum gleichzeitigen Bearbeiten mehrerer
// Tage einer Person (Stunden + Markierung) in EINEM Entwurf, erst "Alles
// speichern" schreibt. Extrahiert 2026-09-17 aus
// app/management/arbeitstage/page.tsx (Nutzer-Vorgabe: "beim
// Urlaubscontrolling einen ähnlichen Aufbau ... Mir ging es dabei eher um
// das gleichzeitige editieren aller Tage. Das hab ich ja beim 'Arbeitstage
// am Stück' auch. Das war der Kern des Ganzen") - jetzt von Arbeitstage
// UND Urlaub genutzt, mit demselben Sperr-Mechanismus
// (arbeitstage_bearbeitung_lock ist an employee_id gebunden, nicht an ein
// bestimmtes Controlling-Thema - beide schreiben auf work_entries, die
// Sperre verhindert also auch Konflikte ZWISCHEN den beiden Einstiegen).

import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatMenge } from "@/lib/format";
import {
  speichereWorkEntryFeld,
  type WorkEntryPatch,
} from "@/lib/workEntrySpeichern";
import { tagMonat, wochenBauen, WOCHENTAGE_KUERZEL } from "@/lib/woche";
import type { ArbeitstageBearbeitungLock, Period, WorkEntry } from "@/lib/types";

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

export interface TageRasterProps {
  employeeId: string;
  // profile.id des angemeldeten Nutzers (für Sperre/Heartbeat) - wird von
  // der aufrufenden Seite durchgereicht (useProfile()), damit diese
  // Komponente nicht selbst nochmal den Auth-Status abfragen muss.
  profileId: string | null;
  // Fenster, in dem Tage bearbeitet werden können - Montag..Sonntag-
  // ausgerichtet (wochenBauen rundet nötigenfalls selbst).
  von: string;
  bis: string;
  // Saisonjahr für den Urlaubsanspruch-Hinweis unten.
  saisonJahr: number;
  // Darf die Rolle Stunden überhaupt bearbeiten (RLS work_entries).
  canEdit: boolean;
  // Optionaler hervorgehobener Bereich innerhalb des Fensters (Arbeitstage:
  // die eigentliche Verstoß-Serie; Urlaub braucht das nicht).
  kritischerBereich?: { von: string; bis: string };
  // Meldet Änderungen am Entwurf nach oben, damit die aufrufende Seite vor
  // dem Wechsel auf eine andere Zeile nachfragen kann.
  onDirtyChange?: (dirty: boolean) => void;
  // Nach erfolgreichem "Alles speichern" - die aufrufende Seite lädt i.d.R.
  // ihre eigene Übersichtsliste neu (Zahlen/Status können sich geändert
  // haben).
  onGespeichert?: () => void;
  // Zusätzliche Knöpfe (i.d.R. "Schließen") in derselben Zeile wie "Alles
  // speichern"/"Verwerfen" - das Ein-/Ausklappen der Zeile ist Sache der
  // aufrufenden Seite, nicht dieser Komponente.
  zusatzAktionen?: React.ReactNode;
}

export default function TageRaster({
  employeeId,
  profileId,
  von,
  bis,
  saisonJahr,
  canEdit,
  kritischerBereich,
  onDirtyChange,
  onGespeichert,
  zusatzAktionen,
}: TageRasterProps) {
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
  const [loading, setLoading] = useState(true);
  const [rasterFehler, setRasterFehler] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFehler, setSaveFehler] = useState<string[]>([]);
  const [gesperrtRaster, setGesperrtRaster] = useState<Set<string>>(new Set());

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wie im Original (app/management/arbeitstage/page.tsx): synchron bei
  // jedem Render aktualisiert, NICHT als Effekt-Abhängigkeit - der
  // Lock-Erwerb-Effekt unten soll nicht neu laufen, nur weil profileId
  // asynchron nachträgt (useProfile() lädt verzögert).
  const profileIdRef = useRef<string | null>(null);
  profileIdRef.current = profileId;

  async function ladeRasterDaten() {
    const supabase = getSupabaseClient();
    const jahre = Array.from(
      new Set([Number(von.slice(0, 4)), Number(bis.slice(0, 4))])
    );
    const [{ data, error }, { data: perioden }, { data: urlaubRow }] =
      await Promise.all([
        supabase
          .from("work_entries")
          .select("id, employee_id, datum, stunden, version, markierung, notiz")
          .eq("employee_id", employeeId)
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
          .eq("employee_id", employeeId)
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

  // Sperre erwerben + Daten laden, sobald die Person/das Fenster wechselt -
  // beim Unmount (Zeile geschlossen/gewechselt) Sperre wieder freigeben.
  useEffect(() => {
    let abgehaengt = false;
    setLoading(true);
    setSaveFehler([]);

    async function starten() {
      const supabase = getSupabaseClient();
      let lockOwn = true;
      if (canEdit) {
        const { data, error } = await supabase.rpc("arbeitstage_lock_erwerben", {
          p_employee_id: employeeId,
        });
        const row = (Array.isArray(data) ? data[0] : data) as
          | { ok: boolean; halter: string | null; seit: string }
          | null
          | undefined;
        if (abgehaengt) return;
        if (error || !row) {
          // RPC nicht verfügbar (Migration fehlt) - nicht hart blockieren.
          setLock({ own: true });
          lockOwn = true;
        } else if (row.ok) {
          setLock({ own: true });
          lockOwn = true;
        } else {
          setLock({ own: false, halter: row.halter ?? "jemand", seit: row.seit });
          lockOwn = false;
        }
      } else {
        lockOwn = false;
        const { data: lr } = await supabase
          .from("arbeitstage_bearbeitung_lock")
          .select("*")
          .eq("employee_id", employeeId)
          .maybeSingle();
        if (abgehaengt) return;
        const row = lr as ArbeitstageBearbeitungLock | null;
        if (row) {
          const { data: pn } = await supabase
            .from("profile_namen")
            .select("full_name")
            .eq("id", row.gesperrt_von)
            .maybeSingle();
          if (abgehaengt) return;
          setLock({
            own: false,
            halter: (pn as { full_name: string } | null)?.full_name ?? "jemand",
            seit: row.gesperrt_am,
          });
        } else {
          setLock({ own: false });
        }
      }

      await ladeRasterDaten();
      if (abgehaengt) return;
      setLoading(false);

      if (canEdit && lockOwn) {
        heartbeatRef.current = setInterval(() => {
          const pid = profileIdRef.current;
          if (!pid) return;
          getSupabaseClient()
            .from("arbeitstage_bearbeitung_lock")
            .update({ zuletzt_gesehen: new Date().toISOString() })
            .eq("employee_id", employeeId)
            .eq("gesperrt_von", pid)
            .then(() => {});
        }, 60_000);
      }
    }
    starten();

    return () => {
      abgehaengt = true;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      const pid = profileIdRef.current;
      if (pid) {
        getSupabaseClient()
          .from("arbeitstage_bearbeitung_lock")
          .delete()
          .eq("employee_id", employeeId)
          .eq("gesperrt_von", pid)
          .then(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, von, bis]);

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

  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

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
        fehler.push(`${tagMonat(datum)}: ungültige Stundenzahl`);
        continue;
      }
      const patch: WorkEntryPatch = {};
      if ((neuStunden ?? null) !== (o.stunden ?? null)) patch.stunden = neuStunden;
      if ((neuMark ?? null) !== (o.markierung ?? null)) patch.markierung = neuMark;
      const existing = rasterEntries.find((e) => e.datum === datum) ?? null;
      const res = await speichereWorkEntryFeld(employeeId, datum, existing, patch);
      if (!res.ok) {
        fehler.push(
          `${tagMonat(datum)}: ${
            res.konflikt
              ? "wurde zwischenzeitlich in der Stundenerfassung geändert"
              : res.fehler ?? "Fehler beim Speichern"
          }`
        );
      }
    }
    setSaveFehler(fehler);
    await ladeRasterDaten();
    setSaving(false);
    onGespeichert?.();
  }

  const kannBearbeiten = canEdit && lock?.own === true;
  const wochen = useMemo(() => wochenBauen(rasterEntries, von, bis), [rasterEntries, von, bis]);

  return (
    <div className="flex flex-col gap-2 p-2">
      {lock && !lock.own && (
        <p className="text-sm font-medium text-beere-600">
          🔒 Wird gerade von {lock.halter ?? "jemand"} bearbeitet
          {lock.seit ? ` (seit ${new Date(lock.seit).toLocaleString("de-DE")})` : ""}.
          Nur Ansicht.
        </p>
      )}
      {!canEdit && (
        <p className="text-xs text-amber-700">
          Deine Rolle darf Stunden nicht bearbeiten - nur zur Ansicht.
        </p>
      )}
      {rasterFehler && (
        <p className="text-sm font-medium text-beere-600">⚠ {rasterFehler}</p>
      )}
      {saveFehler.length > 0 && (
        <div className="text-sm font-medium text-beere-600">
          ⚠ Nicht gespeichert:
          <ul className="ml-4 list-disc font-normal">
            {saveFehler.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-neutral-500">
        Wochensummen sind eingefroren;{" "}
        <span className="inline-flex items-center gap-0.5 text-amber-700">
          <Calculator className="h-3 w-3" /> Δ
        </span>{" "}
        zeigt die Differenz zum Original. Erst „Alles speichern" schreibt.
      </p>

      {loading ? (
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
                {wochen.map((woche) => {
                  const datums = woche.tage.map((t) => t.datum);
                  const frozen = frozenSums[woche.montag] ?? 0;
                  const live = liveWochensumme(datums);
                  const delta = live - frozen;
                  return (
                    <tr key={woche.montag}>
                      {woche.tage.map((tag) => {
                        const d = tag.datum;
                        const imKritischen =
                          !!kritischerBereich &&
                          d >= kritischerBereich.von &&
                          d <= kritischerBereich.bis;
                        const jm = d.slice(0, 7);
                        const tagGesperrt = gesperrtRaster.has(jm);
                        const dd = draft[d] ?? { stunden: "", markierung: "" };
                        return (
                          <td
                            key={d}
                            className={imKritischen ? "bg-amber-50 align-top" : "align-top"}
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
                              disabled={!kannBearbeiten || tagGesperrt || dd.markierung === "U"}
                              onChange={(e) =>
                                setDraftFeld(d, { stunden: e.target.value })
                              }
                            />
                            <select
                              className="mt-1 w-20 text-xs"
                              value={dd.markierung}
                              disabled={!kannBearbeiten || tagGesperrt}
                              onChange={(e) => {
                                const v = e.target.value;
                                setDraftFeld(
                                  d,
                                  v === "U"
                                    ? { markierung: "U", stunden: "" }
                                    : { markierung: v }
                                );
                              }}
                            >
                              <option value="">—</option>
                              <option value="U">Urlaub</option>
                              {dd.markierung !== "" && dd.markierung !== "U" && (
                                <option value={dd.markierung}>{dd.markierung}</option>
                              )}
                            </select>
                          </td>
                        );
                      })}
                      <td className="align-top">
                        <span className="font-semibold">{formatMenge(frozen, 2)}</span>
                        {Math.abs(delta) >= 0.005 && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-amber-700">
                            <Calculator className="h-3 w-3" />
                            Δ {delta > 0 ? "+" : ""}
                            {formatMenge(delta, 2)}
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
              <span className="font-medium">{urlaub.rest}</span> von{" "}
              {urlaub.anspruch} Tagen (bisher {urlaub.genommen}× „U").
              {(neueU > 0 || wegU > 0) && restNachSpeichern !== null && (
                <>
                  {" "}
                  Nach dem Speichern verbleibend:{" "}
                  <span
                    className={`font-medium ${
                      restNachSpeichern < 0 ? "text-beere-600" : "text-emerald-700"
                    }`}
                  >
                    {restNachSpeichern}
                  </span>
                  .
                </>
              )}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
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
              </>
            )}
            {zusatzAktionen}
          </div>
        </>
      )}
    </div>
  );
}
