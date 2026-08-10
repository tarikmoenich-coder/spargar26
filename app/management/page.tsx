"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  ABRECHNUNGSART_LABELS,
  type EmployeeUrlaubstage,
  type SeasonSummaryRow,
  type SvPruefung,
} from "@/lib/types";
import { formatDatumDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();

// Felder, die nach dem Abrechnen ("Jetzt Abrechnen") noch von einem
// Schnappschuss abweichen können (z.B. weil danach ein Vorschuss oder
// Satz geändert wurde) - mit Anzeige-Label und Formatierung, damit die
// Abweichung konkret benannt werden kann statt nur mit "⚠".
const ABWEICHUNGS_FELDER: {
  key: keyof SeasonSummaryRow;
  label: string;
  eur: boolean;
}[] = [
  { key: "gesamt_stunden", label: "Stunden", eur: false },
  { key: "anwesenheitstage", label: "Anwesenheitstage", eur: false },
  { key: "praemien_summe", label: "Prämien", eur: true },
  { key: "bruttolohn", label: "Bruttolohn", eur: true },
  { key: "abzug_verpflegung", label: "Verpflegung", eur: true },
  { key: "abzug_wohnen", label: "Unterkunft", eur: true },
  { key: "vorschuss_summe", label: "Vorschüsse", eur: true },
  { key: "bus_kosten", label: "Buskosten", eur: true },
  { key: "fahrer_kaution", label: "Fahrerkaution", eur: true },
  { key: "zimmer_kaution", label: "Zimmerkaution", eur: true },
  { key: "lohnsteuer_pauschal", label: "Lohnsteuer (pauschal)", eur: true },
  { key: "netto_extern", label: "Netto (extern)", eur: true },
  { key: "netto", label: "Netto", eur: true },
  { key: "auszahlungsbetrag", label: "Auszahlungsbetrag", eur: true },
];

interface Abweichung {
  feld: string;
  alt: string;
  neu: string;
}

// Maximale Arbeitsstunden pro Tag, ab deren Überschreitung eine Person im
// Stundenmonitoring auftaucht.
const MAX_STUNDEN_PRO_TAG = 12;

interface UeberstundenTag {
  datum: string;
  stunden: number;
}

interface UeberstundenEintrag {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  tage: UeberstundenTag[];
}

function formatWert(v: unknown, eur: boolean): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return eur ? `${n.toFixed(2)} €` : String(n);
}

// Vergleicht den eingefrorenen Schnappschuss mit dem aktuellen Live-Stand
// und liefert nur die tatsächlich geänderten Felder (Rundungsdifferenzen
// < 0,005 zählen nicht als Änderung).
function findeAbweichungen(r: SeasonSummaryRow): Abweichung[] {
  if (!r.snapshot) return [];
  const treffer: Abweichung[] = [];
  for (const f of ABWEICHUNGS_FELDER) {
    if (!(f.key in r.snapshot)) continue;
    const altWert = r.snapshot[f.key];
    const neuWert = r[f.key] as number | string | null;
    const altNum = altWert === null ? NaN : Number(altWert);
    const neuNum = neuWert === null ? NaN : Number(neuWert);
    const beideZahlen = !Number.isNaN(altNum) && !Number.isNaN(neuNum);
    const geaendert = beideZahlen
      ? Math.abs(altNum - neuNum) > 0.005
      : altWert !== neuWert;
    if (geaendert) {
      treffer.push({
        feld: f.label,
        alt: formatWert(altWert, f.eur),
        neu: formatWert(neuWert, f.eur),
      });
    }
  }
  return treffer;
}

export default function ManagementPage() {
  const [faelle, setFaelle] = useState<SvPruefung[]>([]);
  const [loading, setLoading] = useState(true);
  const [jahr, setJahr] = useState(CURRENT_YEAR);

  const [abweichungen, setAbweichungen] = useState<
    { row: SeasonSummaryRow; belegnummer: string; diffs: Abweichung[] }[]
  >([]);
  const [loadingAbw, setLoadingAbw] = useState(true);

  const [ueberstunden, setUeberstunden] = useState<UeberstundenEintrag[]>([]);
  const [loadingUeberstunden, setLoadingUeberstunden] = useState(true);
  const [offenUeberstundenId, setOffenUeberstundenId] = useState<
    string | null
  >(null);

  const [urlaubUeberzogen, setUrlaubUeberzogen] = useState<
    EmployeeUrlaubstage[]
  >([]);
  const [loadingUrlaub, setLoadingUrlaub] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("employee_sv_pruefung")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("kritisch", true)
        .order("arbeitstage_ueber0", { ascending: false });
      if (!error) setFaelle((data as SvPruefung[]) ?? []);
      setLoading(false);
    }
    load();
  }, [jahr]);

  useEffect(() => {
    async function loadAbweichungen() {
      setLoadingAbw(true);
      const supabase = getSupabaseClient();
      const [{ data: rows, error }, { data: belege }] = await Promise.all([
        supabase
          .from("season_summary")
          .select("*")
          .eq("saison_jahr", jahr)
          .not("snapshot", "is", null)
          .order("name"),
        supabase
          .from("auszahlungsbelege")
          .select("id, belegnummer")
          .eq("saison_jahr", jahr),
      ]);
      if (!error && rows) {
        const belegnummerVon = new Map(
          (belege ?? []).map((b: any) => [b.id, b.belegnummer as string])
        );
        const ergebnis = (rows as SeasonSummaryRow[])
          .map((r) => ({
            row: r,
            belegnummer: r.auszahlungsbeleg_id
              ? belegnummerVon.get(r.auszahlungsbeleg_id) ?? "—"
              : "—",
            diffs: findeAbweichungen(r),
          }))
          .filter((e) => e.diffs.length > 0);
        setAbweichungen(ergebnis);
      }
      setLoadingAbw(false);
    }
    loadAbweichungen();
  }, [jahr]);

  useEffect(() => {
    async function loadUeberstunden() {
      setLoadingUeberstunden(true);
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("work_entries")
        .select("employee_id, datum, stunden, employees(personal_nr, name, vorname)")
        .gt("stunden", MAX_STUNDEN_PRO_TAG)
        .gte("datum", `${jahr}-01-01`)
        .lte("datum", `${jahr}-12-31`)
        .order("datum");
      if (!error && data) {
        const proMitarbeiter = new Map<string, UeberstundenEintrag>();
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
            datum: row.datum,
            stunden: Number(row.stunden),
          });
        });
        const ergebnis = Array.from(proMitarbeiter.values()).sort(
          (a, b) => b.tage.length - a.tage.length
        );
        setUeberstunden(ergebnis);
      }
      setLoadingUeberstunden(false);
    }
    loadUeberstunden();
  }, [jahr]);

  useEffect(() => {
    async function loadUrlaub() {
      setLoadingUrlaub(true);
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("employee_urlaubstage")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("ueberzogen", true)
        .order("u_tage", { ascending: false });
      if (!error) setUrlaubUeberzogen((data as EmployeeUrlaubstage[]) ?? []);
      setLoadingUrlaub(false);
    }
    loadUrlaub();
  }, [jahr]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Controlling
        </h1>
        <p className="text-sm text-neutral-500">
          90-Tage-/15-Wochen-Kontrolle: Personen, bei denen die Grenze für
          sozialversicherungsfreie kurzfristige Beschäftigung bereits
          überschritten ist – jetzt zusätzlich abgeglichen mit dem SV-freien
          Zeitraum laut den Angaben auf „Personal → Sozialversicherung"
          (Bezahlter Urlaub/Freistellung bzw. Schulferien/offener Zeitraum).
          Reine Tage-/Wochen-/Datums-Prüfung – ersetzt nicht die rechtliche
          Prüfung der Sozialversicherungsbefreiung selbst.
        </p>
      </div>

      <label className="sticky top-14 z-30 block bg-neutral-50 py-2 text-sm">
        Saison-Jahr{" "}
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
          className="w-24"
        />
      </label>

      <div>
        <h2 className="mb-2 text-base font-semibold text-emerald-800">
          90-Tage-/15-Wochen-Kontrolle
        </h2>
        {loading ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : faelle.length === 0 ? (
          <p className="text-neutral-500">
            Keine kritischen Fälle für {jahr}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Abrechnungsart</th>
                  <th>1. Arbeitstag</th>
                  <th>Letzter Arbeitstag</th>
                  <th>Arbeitstage &gt; 0 (bei uns)</th>
                  <th title="Bisherige Arbeitstage in Deutschland bei anderen Arbeitgebern laut SV-Fragebogen (Personal → Sozialversicherung)">
                    Vorbeschäftigung Deutschland
                  </th>
                  <th>Kombinierte Tage</th>
                  <th>Rest bis 90 Tage (kombiniert)</th>
                  <th title="SV-freier Zeitraum laut Angaben (Personal → Sozialversicherung), abgeleitet aus Bezahlter Urlaub/Freistellung bzw. Schulferien/offenem Zeitraum">
                    SV-freier Zeitraum (Angaben)
                  </th>
                  <th title="Das frühere von 15-Wochen-Ende und dem Ende des SV-freien Zeitraums laut Angaben. Die 90-Tage-Grenze links gilt nur zusätzlich, falls die Person nach einer Auszahlung vor Erreichen der 90 Tage erneut kommt.">
                    Austrittsdatum (empfohlen)
                  </th>
                  <th>Grund</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {faelle.map((f) => (
                  <tr key={f.employee_id}>
                    <td>{f.personal_nr}</td>
                    <td>
                      {f.name}, {f.vorname}
                      {!f.aktiv && (
                        <span className="ml-1 text-xs text-neutral-500">
                          (inaktiv)
                        </span>
                      )}
                    </td>
                    <td>{ABRECHNUNGSART_LABELS[f.abrechnungsart]}</td>
                    <td>{formatDatumDE(f.erster_arbeitstag)}</td>
                    <td>{formatDatumDE(f.letzter_arbeitstag)}</td>
                    <td>{f.arbeitstage_ueber0}</td>
                    <td>{f.vorbeschaeftigung_deutschland_tage}</td>
                    <td>{f.kombinierte_tage}</td>
                    <td>{f.rest_bis_90_tage_kombiniert}</td>
                    <td className="text-sm">
                      {f.sv_frei_von || f.sv_frei_bis ? (
                        <>
                          {formatDatumDE(f.sv_frei_von)} –{" "}
                          {f.sv_frei_bis
                            ? formatDatumDE(f.sv_frei_bis)
                            : "unbefristet"}
                          {f.sv_frei_luecke && (
                            <span
                              className="ml-1 text-amber-700"
                              title={`Lücke zwischen Bezahltem Urlaub und Freistellung: ${formatDatumDE(f.sv_frei_luecke_von)} – ${formatDatumDE(f.sv_frei_luecke_bis)}`}
                            >
                              ⚠ Lücke
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-neutral-400">
                          keine Angaben
                        </span>
                      )}
                    </td>
                    <td>{formatDatumDE(f.austrittsdatum_empfohlen)}</td>
                    <td className="text-sm">
                      {[
                        f.arbeitstage_ueber0 > 90 ? "90-Tage-Grenze" : null,
                        f.ueberschritten_15_wochen ? "15-Wochen-Grenze" : null,
                        f.arbeitstage_ueber0 <= 90 && f.kombinierte_tage > 90
                          ? "90-Tage-Grenze (mit Vorbeschäftigung)"
                          : null,
                        f.ueberschritten_sv_frei_beginn
                          ? "SV-freier Zeitraum (Angaben) beginnt zu spät"
                          : null,
                        f.ueberschritten_sv_frei_ende
                          ? "SV-freier Zeitraum (Angaben) überschritten"
                          : null,
                        f.sv_frei_luecke &&
                        !f.ueberschritten_sv_frei_beginn &&
                        !f.ueberschritten_sv_frei_ende
                          ? "Lücke im SV-freien Zeitraum"
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" + ")}
                    </td>
                    <td className="font-medium text-red-600">⚠ Überschritten</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-base font-semibold text-emerald-800">
          Stundenmonitoring
        </h2>
        <p className="mb-2 text-sm text-neutral-500">
          Personen mit mindestens einem Tag über {MAX_STUNDEN_PRO_TAG.toFixed(2)}{" "}
          Stunden in der Stundenerfassung. Aufklappen zeigt die betroffenen
          Tage.
        </p>
        {loadingUeberstunden ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : ueberstunden.length === 0 ? (
          <p className="text-neutral-500">
            Keine Tage über {MAX_STUNDEN_PRO_TAG.toFixed(2)} Stunden für{" "}
            {jahr}.
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
                              setOffenUeberstundenId(offen ? null : u.employee_id)
                            }
                          >
                            {offen ? "Schließen" : "Anzeigen"}
                          </button>
                        </td>
                      </tr>
                      {offen && (
                        <tr>
                          <td colSpan={5} className="bg-neutral-50">
                            <table>
                              <thead>
                                <tr>
                                  <th>Datum</th>
                                  <th>Stunden</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...u.tage]
                                  .sort((a, b) => a.datum.localeCompare(b.datum))
                                  .map((t) => (
                                    <tr key={t.datum}>
                                      <td>{formatDatumDE(t.datum)}</td>
                                      <td className="font-medium text-amber-600">
                                        {t.stunden.toFixed(2)}
                                      </td>
                                      <td>
                                        <Link
                                          href={`/erfassung?datum=${t.datum}&employee=${u.employee_id}`}
                                          className="btn-secondary text-xs"
                                        >
                                          In Stundenerfassung öffnen
                                        </Link>
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
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

      <div>
        <h2 className="mb-2 text-base font-semibold text-emerald-800">
          Abweichungen bei Auszahlungen
        </h2>
        <p className="mb-2 text-sm text-neutral-500">
          Personen, die bereits abgerechnet wurden ("Jetzt Abrechnen"), bei
          denen sich seither mindestens ein Wert geändert hat (z.B. ein
          nachträglich korrigierter Vorschuss oder ein geänderter Satz) - mit
          genauer Angabe, welcher Wert sich wie geändert hat. Entspricht dem
          „⚠" auf der Auszahlungen-Seite.
        </p>
        {loadingAbw ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : abweichungen.length === 0 ? (
          <p className="text-neutral-500">
            Keine Abweichungen für {jahr}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Beleg-Nr.</th>
                  <th>Abgerechnet am</th>
                  <th>Geänderte Werte</th>
                </tr>
              </thead>
              <tbody>
                {abweichungen.map(({ row, belegnummer, diffs }) => (
                  <tr key={row.employee_id}>
                    <td>{row.personal_nr}</td>
                    <td>
                      {row.name}, {row.vorname}
                    </td>
                    <td>{belegnummer}</td>
                    <td>{formatDatumDE(row.abgerechnet_am)}</td>
                    <td className="text-sm">
                      <ul className="flex flex-col gap-0.5">
                        {diffs.map((d) => (
                          <li key={d.feld}>
                            <span className="font-medium">{d.feld}:</span>{" "}
                            {d.alt}{" "}
                            <span className="text-amber-600">→</span> {d.neu}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-base font-semibold text-emerald-800">
          Urlaubstage
        </h2>
        <p className="mb-2 text-sm text-neutral-500">
          Anspruch: 2 Urlaubstage je vollem Kalendermonat der Beschäftigung
          (1. bis letzter Tag mit Stunden oder Markierung) - ein Monat, in
          dem erst nach dem 1. begonnen oder vor dem Monatsletzten geendet
          wurde, zählt nicht mit. Personen, bei denen mehr Tage mit
          Markierung "U" erfasst wurden als der Anspruch hergibt.
        </p>
        {loadingUrlaub ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : urlaubUeberzogen.length === 0 ? (
          <p className="text-neutral-500">
            Keine überzogenen Urlaubstage für {jahr}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>1. Eintrag</th>
                  <th>Letzter Eintrag</th>
                  <th>Volle Kalendermonate</th>
                  <th>Anspruch (Tage)</th>
                  <th>Genommen ("U", Tage)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {urlaubUeberzogen.map((u) => (
                  <tr key={u.employee_id}>
                    <td>{u.personal_nr}</td>
                    <td>
                      {u.name}, {u.vorname}
                      {!u.aktiv && (
                        <span className="ml-1 text-xs text-neutral-500">
                          (inaktiv)
                        </span>
                      )}
                    </td>
                    <td>{formatDatumDE(u.erster_eintrag)}</td>
                    <td>{formatDatumDE(u.letzter_eintrag)}</td>
                    <td>{u.volle_kalendermonate}</td>
                    <td>{u.urlaubsanspruch_tage}</td>
                    <td>{u.u_tage}</td>
                    <td className="font-medium text-red-600">
                      ⚠ {u.u_tage - u.urlaubsanspruch_tage} Tag(e) zu viel
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
