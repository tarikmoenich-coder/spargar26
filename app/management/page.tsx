"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  ABRECHNUNGSART_LABELS,
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Management
        </h1>
        <p className="text-sm text-neutral-500">
          90-Tage-/15-Wochen-Kontrolle: Personen, bei denen die Grenze für
          sozialversicherungsfreie kurzfristige Beschäftigung bereits
          überschritten ist. Reine Tage-/Wochen-Zählung – ersetzt nicht die
          rechtliche Prüfung der Sozialversicherungsbefreiung selbst.
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
                  <th>Arbeitstage &gt; 0</th>
                  <th>Rest bis 90 Tage</th>
                  <th>Austrittsdatum (15 Wo.)</th>
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
                    <td>{f.rest_bis_90_tage}</td>
                    <td>{formatDatumDE(f.austrittsdatum_15_wochen)}</td>
                    <td className="text-sm">
                      {[
                        f.ueberschritten_90_tage ? "90-Tage-Grenze" : null,
                        f.ueberschritten_15_wochen ? "15-Wochen-Grenze" : null,
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
    </div>
  );
}
