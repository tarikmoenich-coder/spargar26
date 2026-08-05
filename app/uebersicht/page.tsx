"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  ABRECHNUNGSART_LABELS,
  type Arbeitsgruppe,
  type SeasonSummaryRow,
} from "@/lib/types";
import { formatDatumDE } from "@/lib/format";

const OHNE_GRUPPE_KEY = "__ohne__";

const CURRENT_YEAR = new Date().getFullYear();

function fmt(n: number | string | null | undefined) {
  return n === null || n === undefined || n === "" ? "—" : Number(n).toFixed(2);
}

// Liest ein Feld aus dem eingefrorenen Schnappschuss, falls die Person
// abgerechnet ist - sonst den live berechneten Wert. So bleibt eine bereits
// ausgezahlte Abrechnung stabil, auch wenn sich Sätze/Vorschüsse danach
// ändern.
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

export default function UebersichtPage() {
  const { profile } = useProfile();
  const [rows, setRows] = useState<SeasonSummaryRow[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [gruppeFilter, setGruppeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<string>>(new Set());
  const [abrechnenLaeuft, setAbrechnenLaeuft] = useState(false);
  const [abrechnenFehler, setAbrechnenFehler] = useState<string | null>(null);
  const [auszahlungslisteZeilen, setAuszahlungslisteZeilen] = useState<
    SeasonSummaryRow[] | null
  >(null);
  const [letzterBeleg, setLetzterBeleg] = useState<string | null>(null);
  const [abrechnenZahlungsart, setAbrechnenZahlungsart] = useState("BAR");

  const canEdit =
    profile?.role === "admin" || profile?.role === "lohnabrechnung";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("season_summary")
      .select("*")
      .eq("saison_jahr", jahr)
      .order("name");
    if (!error) setRows((data as SeasonSummaryRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    setAusgewaehlt(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  useEffect(() => {
    async function ladeGruppen() {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("arbeitsgruppen")
        .select("*")
        .order("reihenfolge");
      setGruppen((data as Arbeitsgruppe[]) ?? []);
    }
    ladeGruppen();
  }, []);

  const gruppenByNr = new Map(gruppen.map((g) => [g.gruppe_nr, g]));

  // Damit eine Mitarbeiterin z.B. alle zur Abrechnung vorgesehenen Personen
  // vorab in eine Gruppe (z.B. "101 - Abrechnen") packen kann und diese hier
  // gefiltert und komplett auf einmal markiert werden können.
  const gefilterteRows = !gruppeFilter
    ? rows
    : rows.filter((r) =>
        gruppeFilter === OHNE_GRUPPE_KEY
          ? !r.gruppe_nr
          : r.gruppe_nr === gruppeFilter
      );

  // Druck: nach dem Öffnen des Druckdialogs (oder Abbruch) zurücksetzen.
  useEffect(() => {
    function handleAfterPrint() {
      setAuszahlungslisteZeilen(null);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  useEffect(() => {
    if (auszahlungslisteZeilen === null) return;
    const id = setTimeout(() => window.print(), 50);
    return () => clearTimeout(id);
  }, [auszahlungslisteZeilen]);

  function toggleAuswahl(employeeId: string) {
    setAusgewaehlt((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  // Wirkt bewusst nur auf die (ggf. nach Gruppe gefilterten) sichtbaren
  // Zeilen, nicht auf alle - so lässt sich z.B. gezielt nur die Gruppe
  // "101 - Abrechnen" komplett markieren.
  function alleTogglen() {
    const alleIds = gefilterteRows.map((r) => r.employee_id);
    const alleAusgewaehlt = alleIds.every((id) => ausgewaehlt.has(id));
    setAusgewaehlt((prev) => {
      const next = new Set(prev);
      if (alleAusgewaehlt) {
        alleIds.forEach((id) => next.delete(id));
      } else {
        alleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  async function jetztAbrechnen() {
    if (ausgewaehlt.size === 0) return;
    const namen = rows
      .filter((r) => ausgewaehlt.has(r.employee_id))
      .map((r) => `${r.name}, ${r.vorname}`);
    const bestaetigt = window.confirm(
      `${ausgewaehlt.size} Person(en) für Saison ${jahr} jetzt abrechnen?\n\n` +
        `${namen.join("\n")}\n\n` +
        `Diese Personen werden danach auf "inaktiv" gesetzt (können bei Bedarf ` +
        `später wieder reaktiviert werden).`
    );
    if (!bestaetigt) return;

    setAbrechnenLaeuft(true);
    setAbrechnenFehler(null);
    const supabase = getSupabaseClient();
    const ids = Array.from(ausgewaehlt);
    // Eine Belegnummer für die ganze Aktion, egal wie viele Personen.
    const { data: belegnummer, error: fehler } = await supabase.rpc(
      "saison_abrechnen_batch",
      {
        p_employee_ids: ids,
        p_saison_jahr: jahr,
        p_zahlungsart: abrechnenZahlungsart,
      }
    );
    if (fehler) setAbrechnenFehler(fehler.message);

    // Frisch geladene Daten (mit Schnappschuss) direkt für den Ausdruck
    // holen, statt auf den nächsten Render zu warten.
    const { data: frisch } = await supabase
      .from("season_summary")
      .select("*")
      .in("employee_id", ids)
      .eq("saison_jahr", jahr);
    if (frisch && frisch.length > 0) {
      setAuszahlungslisteZeilen(frisch as SeasonSummaryRow[]);
    }
    if (belegnummer && !fehler) {
      setLetzterBeleg(belegnummer);
    }

    setAusgewaehlt(new Set());
    setAbrechnenLaeuft(false);
    load();
  }

  function auszahlungslisteFuerAuswahlDrucken() {
    const zeilen = rows.filter(
      (r) => ausgewaehlt.has(r.employee_id) && r.abgerechnet_am
    );
    if (zeilen.length === 0) return;
    setAuszahlungslisteZeilen(zeilen);
  }

  async function nettoExternSpeichern(row: SeasonSummaryRow, wert: string) {
    const supabase = getSupabaseClient();
    const netto_extern = wert.trim() === "" ? null : Number(wert);
    await supabase.from("season_bonuses").upsert(
      {
        employee_id: row.employee_id,
        saison_jahr: row.saison_jahr,
        netto_extern,
      },
      { onConflict: "employee_id,saison_jahr" }
    );
    load();
  }

  // Vorfinanzierte Heimreise (Hin+Rück) - als eine gemeinsame Summe erfasst,
  // da die App die beiden Richtungen aktuell nicht getrennt auswertet.
  async function busKostenSpeichern(row: SeasonSummaryRow, wert: string) {
    const supabase = getSupabaseClient();
    const bus_hin = wert.trim() === "" ? 0 : Number(wert);
    await supabase.from("season_bonuses").upsert(
      {
        employee_id: row.employee_id,
        saison_jahr: row.saison_jahr,
        bus_hin,
      },
      { onConflict: "employee_id,saison_jahr" }
    );
    load();
  }

  // Kautionen (Fahrer/Zimmer) - wie Buskosten pro Person/Saison erfasst.
  async function kautionSpeichern(
    row: SeasonSummaryRow,
    feld: "fahrer_kaution" | "zimmer_kaution",
    wert: string
  ) {
    const supabase = getSupabaseClient();
    const betrag = wert.trim() === "" ? 0 : Number(wert);
    await supabase.from("season_bonuses").upsert(
      {
        employee_id: row.employee_id,
        saison_jahr: row.saison_jahr,
        [feld]: betrag,
      },
      { onConflict: "employee_id,saison_jahr" }
    );
    load();
  }

  const auswahlAnzahlAbgerechnet = rows.filter(
    (r) => ausgewaehlt.has(r.employee_id) && r.abgerechnet_am
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">
          Saison-Lohnübersicht
        </h1>
        <p className="text-sm text-neutral-500">
          Automatisch aus Stunden, Prämien, Verpflegungs-/Wohnen-Abzügen und
          Vorschüssen berechnet. <strong>Erster Entwurf</strong> - vor echten
          Auszahlungen unbedingt gegen die bisherige Excel-Datei prüfen
          (siehe README, offener Punkt OI-009).
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          Bei Abrechnungsart „Lohnsteuerklasse 1" und
          „Sozialversicherungspflichtig" kann die App die Lohnsteuer nicht
          selbst berechnen - hier bitte den Netto-Betrag aus dem
          Lohnprogramm eintragen (entspricht der früheren Excel-Spalte
          „Netto-Summe (HSC)"). Ohne diesen Wert bleibt der
          Auszahlungsbetrag leer.
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          Abgerechnete Personen zeigen den eingefrorenen Stand von der
          Abrechnung, nicht die Live-Berechnung. „⚠" bedeutet: die aktuelle
          Live-Berechnung weicht inzwischen davon ab (z.B. weil danach ein
          Vorschuss oder Satz geändert wurde).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <label className="text-sm">
          Saison-Jahr{" "}
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-24"
          />
        </label>
        <label className="text-sm">
          Gruppe{" "}
          <select
            value={gruppeFilter}
            onChange={(e) => setGruppeFilter(e.target.value)}
          >
            <option value="">Alle</option>
            {gruppen.map((g) => (
              <option key={g.gruppe_nr} value={g.gruppe_nr}>
                {g.gruppe_nr} – {g.bezeichnung}
              </option>
            ))}
            <option value={OHNE_GRUPPE_KEY}>Ohne Gruppe</option>
          </select>
        </label>
        {canEdit && (
          <label className="text-sm">
            Zahlungsart{" "}
            <select
              value={abrechnenZahlungsart}
              onChange={(e) => setAbrechnenZahlungsart(e.target.value)}
            >
              <option value="BAR">BAR</option>
              <option value="AZ">Überweisung (AZ)</option>
            </select>
          </label>
        )}
        {canEdit && (
          <button
            type="button"
            className="btn"
            disabled={ausgewaehlt.size === 0 || abrechnenLaeuft}
            onClick={jetztAbrechnen}
          >
            {ausgewaehlt.size > 0
              ? `${ausgewaehlt.size} Person(en) jetzt abrechnen`
              : "Jetzt Abrechnen"}
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            className="btn-secondary"
            disabled={auswahlAnzahlAbgerechnet === 0}
            onClick={auszahlungslisteFuerAuswahlDrucken}
          >
            Auszahlungsliste für Auswahl drucken
            {auswahlAnzahlAbgerechnet > 0 ? ` (${auswahlAnzahlAbgerechnet})` : ""}
          </button>
        )}
        {abrechnenFehler && (
          <span className="text-sm text-red-600">{abrechnenFehler}</span>
        )}
      </div>

      {letzterBeleg && (
        <p className="text-sm text-emerald-800 print:hidden">
          Beleg {letzterBeleg} erstellt - Details unter „Auszahlungen".
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500 print:hidden">Lädt…</p>
      ) : (
        <div className="overflow-x-auto print:hidden">
          <table>
            <thead>
              <tr>
                {canEdit && (
                  <th>
                    <input
                      type="checkbox"
                      onChange={alleTogglen}
                      checked={
                        gefilterteRows.length > 0 &&
                        gefilterteRows.every((r) => ausgewaehlt.has(r.employee_id))
                      }
                      title="Markiert/entmarkiert alle sichtbaren (gefilterten) Zeilen"
                    />
                  </th>
                )}
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Gruppe</th>
                <th>Std.</th>
                <th>Tage</th>
                <th>Abrechnungsart</th>
                <th>Brutto €</th>
                <th>Lohnsteuer (pauschal) €</th>
                <th>Netto €</th>
                <th>Verpfl./Unterkunft €</th>
                <th>Vorschüsse €</th>
                <th>Buskosten €</th>
                <th>Fahrerkaution €</th>
                <th>Zimmerkaution €</th>
                <th>Auszahlungsbetrag €</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {gefilterteRows.map((r) => (
                <tr key={r.employee_id} className={r.aktiv ? "" : "opacity-60"}>
                  {canEdit && (
                    <td>
                      <input
                        type="checkbox"
                        checked={ausgewaehlt.has(r.employee_id)}
                        onChange={() => toggleAuswahl(r.employee_id)}
                      />
                    </td>
                  )}
                  <td>{r.personal_nr}</td>
                  <td>
                    {r.name}, {r.vorname}
                  </td>
                  <td className="text-sm text-neutral-500">
                    {r.gruppe_nr
                      ? `${r.gruppe_nr} – ${
                          gruppenByNr.get(r.gruppe_nr)?.bezeichnung ?? r.gruppe_nr
                        }`
                      : "—"}
                  </td>
                  <td>{fmt(anzeige(r, "gesamt_stunden"))}</td>
                  <td>{anzeige(r, "anwesenheitstage") ?? "—"}</td>
                  <td>{ABRECHNUNGSART_LABELS[r.abrechnungsart]}</td>
                  <td>{fmt(anzeige(r, "bruttolohn"))}</td>
                  <td>{fmt(anzeige(r, "lohnsteuer_pauschal"))}</td>
                  <td>
                    {r.abrechnungsart === "pauschal" || !canEdit || r.abgerechnet_am ? (
                      fmt(anzeige(r, "netto"))
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        className="w-24"
                        defaultValue={r.netto_extern ?? ""}
                        placeholder="aus Lohnprogramm"
                        key={`${r.employee_id}-${r.netto_extern ?? ""}`}
                        onBlur={(e) =>
                          nettoExternSpeichern(r, e.target.value)
                        }
                      />
                    )}
                  </td>
                  <td>
                    {(
                      Number(anzeige(r, "abzug_verpflegung")) +
                      Number(anzeige(r, "abzug_wohnen"))
                    ).toFixed(2)}
                  </td>
                  <td>{fmt(anzeige(r, "vorschuss_summe"))}</td>
                  <td>
                    {!canEdit || r.abgerechnet_am ? (
                      fmt(anzeige(r, "bus_kosten"))
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        className="w-20"
                        defaultValue={r.bus_kosten || ""}
                        placeholder="0,00"
                        key={`${r.employee_id}-bus-${r.bus_kosten}`}
                        onBlur={(e) => busKostenSpeichern(r, e.target.value)}
                      />
                    )}
                  </td>
                  <td>
                    {!canEdit || r.abgerechnet_am ? (
                      fmt(anzeige(r, "fahrer_kaution"))
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        className="w-20"
                        defaultValue={r.fahrer_kaution || ""}
                        placeholder="0,00"
                        key={`${r.employee_id}-fk-${r.fahrer_kaution}`}
                        onBlur={(e) =>
                          kautionSpeichern(r, "fahrer_kaution", e.target.value)
                        }
                      />
                    )}
                  </td>
                  <td>
                    {!canEdit || r.abgerechnet_am ? (
                      fmt(anzeige(r, "zimmer_kaution"))
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        className="w-20"
                        defaultValue={r.zimmer_kaution || ""}
                        placeholder="0,00"
                        key={`${r.employee_id}-zk-${r.zimmer_kaution}`}
                        onBlur={(e) =>
                          kautionSpeichern(r, "zimmer_kaution", e.target.value)
                        }
                      />
                    )}
                  </td>
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
                  <td>
                    {r.aktiv ? "aktiv" : "inaktiv"}
                    {r.abgerechnet_am && (
                      <>
                        <br />
                        <span className="text-xs text-neutral-500">
                          abgerechnet {formatDatumDE(r.abgerechnet_am)}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Auszahlungsliste zum Ausdrucken - nur im Druck sichtbar. */}
      {auszahlungslisteZeilen && (
        <div className="hidden print:block">
          <h2 className="text-xl font-semibold">
            Auszahlungsliste Saison {jahr}
          </h2>
          <p className="mt-1 text-base">
            Datum: {formatDatumDE(new Date().toISOString())} · Anzahl
            Personen: {auszahlungslisteZeilen.length}
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
              {auszahlungslisteZeilen.map((r) => (
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
                  {auszahlungslisteZeilen
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
