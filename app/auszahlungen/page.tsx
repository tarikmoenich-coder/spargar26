"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { AuszahlungsbelegSummary, SeasonSummaryRow } from "@/lib/types";
import { formatDatumDE } from "@/lib/format";

function fmt(n: number | string | null | undefined) {
  return n === null || n === undefined || n === "" ? "—" : Number(n).toFixed(2);
}

// Liest ein Feld aus dem eingefrorenen Schnappschuss (immer vorhanden, da
// diese Seite nur bereits abgerechnete Personen zeigt).
function anzeige(r: SeasonSummaryRow, feld: keyof SeasonSummaryRow) {
  if (r.snapshot && feld in r.snapshot) return r.snapshot[feld];
  return r[feld] as number | string | null;
}

function weichtAb(r: SeasonSummaryRow) {
  if (!r.snapshot) return false;
  const eingefroren = Number(r.snapshot.auszahlungsbetrag);
  const live = r.auszahlungsbetrag === null ? NaN : Number(r.auszahlungsbetrag);
  if (Number.isNaN(eingefroren) || Number.isNaN(live)) return false;
  return Math.abs(eingefroren - live) > 0.005;
}

export default function AuszahlungenPage() {
  const [belege, setBelege] = useState<AuszahlungsbelegSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [offen, setOffen] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<Record<number, SeasonSummaryRow[]>>({});
  const [druckZeilen, setDruckZeilen] = useState<{
    belegnummer: string;
    zahlungsart: string;
    zeilen: SeasonSummaryRow[];
  } | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("auszahlungsbeleg_summary")
      .select("*")
      .order("erstellt_am", { ascending: false });
    if (!error) setBelege((data as AuszahlungsbelegSummary[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    function handleAfterPrint() {
      setDruckZeilen(null);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  useEffect(() => {
    if (druckZeilen === null) return;
    const id = setTimeout(() => window.print(), 50);
    return () => clearTimeout(id);
  }, [druckZeilen]);

  async function toggleOffen(beleg: AuszahlungsbelegSummary) {
    setOffen((prev) => {
      const next = new Set(prev);
      if (next.has(beleg.id)) next.delete(beleg.id);
      else next.add(beleg.id);
      return next;
    });
    if (!details[beleg.id]) {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("season_summary")
        .select("*")
        .eq("auszahlungsbeleg_id", beleg.id)
        .order("name");
      if (!error) {
        setDetails((prev) => ({
          ...prev,
          [beleg.id]: (data as SeasonSummaryRow[]) ?? [],
        }));
      }
    }
  }

  function drucken(beleg: AuszahlungsbelegSummary) {
    const zeilen = details[beleg.id];
    if (!zeilen) return;
    setDruckZeilen({
      belegnummer: beleg.belegnummer,
      zahlungsart: beleg.zahlungsart,
      zeilen,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">
          Auszahlungen
        </h1>
        <p className="text-sm text-neutral-500">
          Ein Beleg je „Jetzt Abrechnen"-Aktion auf der Lohnübersicht, auch
          bei mehreren Personen gleichzeitig. „⚠" bedeutet: mindestens eine
          Person in diesem Beleg weicht inzwischen von der Live-Berechnung
          ab (z.B. weil danach ein Vorschuss oder Satz geändert wurde).
        </p>
      </div>

      {loading ? (
        <p className="text-neutral-500 print:hidden">Lädt…</p>
      ) : belege.length === 0 ? (
        <p className="text-neutral-500 print:hidden">
          Noch keine Auszahlungen erfasst.
        </p>
      ) : (
        <div className="flex flex-col gap-2 print:hidden">
          {belege.map((beleg) => {
            const istOffen = offen.has(beleg.id);
            const zeilen = details[beleg.id];
            return (
              <div
                key={beleg.id}
                className="rounded border border-neutral-200 bg-white"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 p-3 text-left"
                  onClick={() => toggleOffen(beleg)}
                >
                  <span className="font-medium">
                    {beleg.belegnummer}
                    {beleg.weicht_ab && (
                      <span className="ml-2 text-amber-600" title="Weicht von der Live-Berechnung ab">
                        ⚠
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-neutral-500">
                    Saison {beleg.saison_jahr} · {formatDatumDE(beleg.erstellt_am)} ·{" "}
                    {beleg.zahlungsart === "BAR" ? "Bar" : "Überweisung"}
                  </span>
                  <span className="text-sm text-neutral-500">
                    {beleg.anzahl_personen} Person(en)
                  </span>
                  <span className="font-medium">
                    {fmt(beleg.summe_auszahlungsbetrag)} €
                  </span>
                  <span className="text-xs text-neutral-400">
                    {istOffen ? "▲" : "▼"}
                  </span>
                </button>

                {istOffen && (
                  <div className="border-t border-neutral-200 p-3">
                    {!zeilen ? (
                      <p className="text-sm text-neutral-500">Lädt…</p>
                    ) : (
                      <>
                        <div className="mb-2 flex justify-end">
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => drucken(beleg)}
                          >
                            Diese Liste drucken
                          </button>
                        </div>
                        <div className="overflow-x-auto">
                          <table>
                            <thead>
                              <tr>
                                <th>Pers.-Nr.</th>
                                <th>Name</th>
                                <th>Std.</th>
                                <th>Tage</th>
                                <th>Brutto €</th>
                                <th>Steuer €</th>
                                <th>Netto €</th>
                                <th>Verpfl./Unterk. €</th>
                                <th>Vorschüsse €</th>
                                <th>Buskosten €</th>
                                <th>Fahrerkaution €</th>
                                <th>Zimmerkaution €</th>
                                <th>Auszahlung €</th>
                              </tr>
                            </thead>
                            <tbody>
                              {zeilen.map((r) => (
                                <tr key={r.employee_id}>
                                  <td>{r.personal_nr}</td>
                                  <td>
                                    {r.name}, {r.vorname}
                                  </td>
                                  <td>{fmt(anzeige(r, "gesamt_stunden"))}</td>
                                  <td>{anzeige(r, "anwesenheitstage") ?? "—"}</td>
                                  <td>{fmt(anzeige(r, "bruttolohn"))}</td>
                                  <td>{fmt(anzeige(r, "lohnsteuer_pauschal"))}</td>
                                  <td>{fmt(anzeige(r, "netto"))}</td>
                                  <td>
                                    {(
                                      Number(anzeige(r, "abzug_verpflegung")) +
                                      Number(anzeige(r, "abzug_wohnen"))
                                    ).toFixed(2)}
                                  </td>
                                  <td>{fmt(anzeige(r, "vorschuss_summe"))}</td>
                                  <td>{fmt(anzeige(r, "bus_kosten"))}</td>
                                  <td>{fmt(anzeige(r, "fahrer_kaution"))}</td>
                                  <td>{fmt(anzeige(r, "zimmer_kaution"))}</td>
                                  <td className="font-medium">
                                    {fmt(anzeige(r, "auszahlungsbetrag"))}
                                    {weichtAb(r) && (
                                      <span
                                        className="ml-1 text-amber-600"
                                        title={`Live-Berechnung aktuell: ${fmt(
                                          r.auszahlungsbetrag
                                        )} €`}
                                      >
                                        ⚠
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Druckansicht - nur im Druck sichtbar. */}
      {druckZeilen && (
        <div className="hidden print:block">
          <h2 className="text-xl font-semibold">
            Auszahlungsliste – Beleg {druckZeilen.belegnummer}
          </h2>
          <p className="mt-1 text-base">
            Datum: {formatDatumDE(new Date().toISOString())} ·{" "}
            {druckZeilen.zahlungsart === "BAR" ? "Bar" : "Überweisung"} ·
            Anzahl Personen: {druckZeilen.zeilen.length}
          </p>
          <table className="mt-4 print-form-table">
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Std.</th>
                <th>Tage</th>
                <th>Brutto €</th>
                <th>Steuer €</th>
                <th>Netto €</th>
                <th>Verpfl./Unterk. €</th>
                <th>Vorschüsse €</th>
                <th>Buskosten €</th>
                <th>Fahrerkaution €</th>
                <th>Zimmerkaution €</th>
                <th>Auszahlung €</th>
                <th>Unterschrift</th>
              </tr>
            </thead>
            <tbody>
              {druckZeilen.zeilen.map((r) => (
                <tr key={r.employee_id}>
                  <td>{r.personal_nr}</td>
                  <td>
                    {r.name}, {r.vorname}
                  </td>
                  <td>{fmt(anzeige(r, "gesamt_stunden"))}</td>
                  <td>{anzeige(r, "anwesenheitstage") ?? "—"}</td>
                  <td>{fmt(anzeige(r, "bruttolohn"))}</td>
                  <td>{fmt(anzeige(r, "lohnsteuer_pauschal"))}</td>
                  <td>{fmt(anzeige(r, "netto"))}</td>
                  <td>
                    {(
                      Number(anzeige(r, "abzug_verpflegung")) +
                      Number(anzeige(r, "abzug_wohnen"))
                    ).toFixed(2)}
                  </td>
                  <td>{fmt(anzeige(r, "vorschuss_summe"))}</td>
                  <td>{fmt(anzeige(r, "bus_kosten"))}</td>
                  <td>{fmt(anzeige(r, "fahrer_kaution"))}</td>
                  <td>{fmt(anzeige(r, "zimmer_kaution"))}</td>
                  <td className="font-semibold">
                    {fmt(anzeige(r, "auszahlungsbetrag"))}
                  </td>
                  <td></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={12} className="text-right font-semibold">
                  Summe Auszahlung
                </td>
                <td className="font-semibold">
                  {druckZeilen.zeilen
                    .reduce(
                      (s, r) => s + Number(anzeige(r, "auszahlungsbetrag") ?? 0),
                      0
                    )
                    .toFixed(2)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
