"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type {
  AuszahlungsbelegSummary,
  AuszahlungsbelegZeile,
  Kautionsuebergabe,
  SeasonSummaryRow,
} from "@/lib/types";
import { formatDatumDE } from "@/lib/format";
import LohnTabs from "@/components/LohnTabs";
import {
  FARBE_ABZUG_TH,
  FARBE_BRUTTO_TD,
  FARBE_BRUTTO_TH,
  FARBE_KAUTION_TH,
  FARBE_NETTO_TD,
  FARBE_NETTO_TH,
  FARBE_ZULAGE_TH,
} from "@/lib/farben";

function monatsSchluessel(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `KU-${mm}-${d.getFullYear()}`;
}

function fmt(n: number | string | null | undefined) {
  return n === null || n === undefined || n === "" ? "—" : Number(n).toFixed(2);
}

// Nur für den Ausdruck (Nutzer-Vorgabe 2026-08-21: "Tausender
// Trennpunkte") - bewusst eine eigene Funktion statt fmt() selbst zu
// ändern, damit die interaktive Ansicht (aufklappbare Liste oben) beim
// bisherigen Format bleibt.
function fmtDruck(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return "—";
  return Number(n).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Liest ein Feld aus dem eingefrorenen Schnappschuss (immer vorhanden, da
// diese Seite nur bereits abgerechnete Personen zeigt).
function anzeige(r: SeasonSummaryRow, feld: keyof SeasonSummaryRow) {
  if (r.snapshot && feld in r.snapshot) return r.snapshot[feld];
  return r[feld] as number | string | null;
}

// Druck-Spalten der Auszahlungsliste (Nutzer-Vorgabe 2026-08-21): in einer
// festen Reihenfolge, die die Rechenkette sichtbar macht - Basislohn +
// Prämien + Zulage = Brutto, minus Steuer = Netto, minus Verpflegung/
// Unterkunft = "Netto nach Verpfl./Unterk." (kein feststehender
// Fachbegriff dafür, deshalb ein selbsterklärendes Etikett statt eines
// evtl. falschen), minus Vorschüsse/Buskosten/Kleidung/Kautionen =
// Auszahlung. "gruppe" bestimmt die dickere Trennlinie zwischen den
// Abschnitten (siehe .print-gruppenstart in globals.css) - wird beim
// Rendern anhand der tatsächlich SICHTBAREN Spalten neu berechnet, damit
// die Linie korrekt an der ersten sichtbaren Spalte einer Gruppe bleibt,
// auch wenn eine davor per "alle Werte 0" ausgeblendet wurde.
interface AuszahlungsSpalte {
  key: string;
  label: string;
  gruppe: "brutto" | "steuer" | "sachbezug" | "abzuege" | "auszahlung";
  wert: (r: SeasonSummaryRow) => number;
  immerZeigen?: boolean;
  thKlasse?: string;
  tdKlasse?: string;
  // Nutzer-Vorgabe 2026-08-21: Brutto/Netto/Auszahlung etwas größer und
  // fett gegenüber dem Rest - siehe .print-hervorgehoben in globals.css.
  hervorgehoben?: boolean;
}

const AUSZAHLUNGS_SPALTEN: AuszahlungsSpalte[] = [
  {
    key: "basis_brutto",
    label: "Basislohn €",
    gruppe: "brutto",
    wert: (r) => Number(anzeige(r, "basis_brutto") ?? 0),
    thKlasse: FARBE_BRUTTO_TH,
  },
  {
    key: "praemien_summe",
    label: "Prämien €",
    gruppe: "brutto",
    wert: (r) => Number(anzeige(r, "praemien_summe") ?? 0),
    thKlasse: FARBE_ZULAGE_TH,
  },
  {
    key: "stundenkonto_auszahlung_betrag",
    label: "Zulage €",
    gruppe: "brutto",
    wert: (r) => Number(anzeige(r, "stundenkonto_auszahlung_betrag") ?? 0),
    thKlasse: FARBE_ZULAGE_TH,
  },
  {
    key: "bruttolohn",
    label: "Brutto €",
    gruppe: "brutto",
    wert: (r) => Number(anzeige(r, "bruttolohn") ?? 0),
    immerZeigen: true,
    thKlasse: FARBE_BRUTTO_TH,
    tdKlasse: FARBE_BRUTTO_TD,
    hervorgehoben: true,
  },
  {
    key: "lohnsteuer_pauschal",
    label: "Steuer €",
    gruppe: "steuer",
    wert: (r) => Number(anzeige(r, "lohnsteuer_pauschal") ?? 0),
    // Nutzer-Vorgabe 2026-08-21: zeigt zusätzlich, ob es sich um die von
    // der App selbst berechnete pauschale Lohnsteuer handelt ("PA", Label
    // wie in ABRECHNUNGSART_LABELS) oder um eine vom externen
    // Lohnprogramm ermittelte Steuer ("HSC", siehe OI-009/Sheet "Summen"
    // Spalte BA "Netto-Summe (HSC)") - bei "HSC" ist lohnsteuer_pauschal
    // technisch 0 (die App kennt den echten Betrag nicht), deshalb
    // "immerZeigen": sonst würde die Spalte bei einem rein-HSC-Beleg
    // fälschlich als "alle Werte 0" verschwinden, obwohl das PA/HSC-Etikett
    // weiterhin eine wichtige Information ist.
    immerZeigen: true,
    thKlasse: FARBE_ABZUG_TH,
  },
  {
    key: "netto",
    label: "Netto €",
    gruppe: "steuer",
    wert: (r) => Number(anzeige(r, "netto") ?? 0),
    immerZeigen: true,
    thKlasse: FARBE_NETTO_TH,
    tdKlasse: FARBE_NETTO_TD,
    hervorgehoben: true,
  },
  {
    key: "verpflegung_unterkunft",
    label: "Verpfl./Unterk. €",
    gruppe: "sachbezug",
    wert: (r) =>
      Number(anzeige(r, "abzug_verpflegung") ?? 0) +
      Number(anzeige(r, "abzug_wohnen") ?? 0),
    thKlasse: FARBE_ABZUG_TH,
  },
  {
    key: "netto_nach_verpflegung",
    // Kurz gehalten (Nutzer-Vorgabe 2026-08-21: "nimmt zu viel Platz in
    // Anspruch") - kein feststehender Fachbegriff für diese Zwischensumme,
    // deshalb weiterhin ein selbsterklärendes, aber kürzeres Etikett.
    label: "Netto nach Abz. €",
    gruppe: "sachbezug",
    wert: (r) =>
      Number(anzeige(r, "netto") ?? 0) -
      Number(anzeige(r, "abzug_verpflegung") ?? 0) -
      Number(anzeige(r, "abzug_wohnen") ?? 0),
  },
  {
    key: "vorschuss_summe",
    label: "Vorschüsse €",
    gruppe: "abzuege",
    wert: (r) => Number(anzeige(r, "vorschuss_summe") ?? 0),
    thKlasse: FARBE_ABZUG_TH,
  },
  {
    key: "bus_kosten",
    label: "Buskosten €",
    gruppe: "abzuege",
    wert: (r) => Number(anzeige(r, "bus_kosten") ?? 0),
    thKlasse: FARBE_ABZUG_TH,
  },
  {
    key: "kleidung_betrag",
    label: "Kleidung €",
    gruppe: "abzuege",
    wert: (r) => Number(anzeige(r, "kleidung_betrag") ?? 0),
    thKlasse: FARBE_ABZUG_TH,
  },
  {
    key: "kautionen",
    label: "Kaution(en) €",
    gruppe: "abzuege",
    wert: (r) =>
      Number(anzeige(r, "fahrer_kaution") ?? 0) +
      Number(anzeige(r, "zimmer_kaution") ?? 0),
    thKlasse: FARBE_KAUTION_TH,
  },
  {
    key: "auszahlungsbetrag",
    label: "Auszahlung €",
    gruppe: "auszahlung",
    wert: (r) => Number(anzeige(r, "auszahlungsbetrag") ?? 0),
    immerZeigen: true,
    hervorgehoben: true,
  },
];

// Blendet Spalten aus, in denen bei ALLEN Zeilen dieses Belegs eine 0
// steht (Nutzer-Vorgabe 2026-08-21: "kostet viel Platz") - außer den als
// "immerZeigen" markierten Kern-/Summenspalten. "Netto nach Verpfl./
// Unterk." hängt an "Verpfl./Unterk." und verschwindet automatisch mit,
// da sie sonst nur die bereits sichtbare Netto-Spalte wiederholen würde.
function sichtbareSpalten(zeilen: SeasonSummaryRow[]): AuszahlungsSpalte[] {
  const spalten = AUSZAHLUNGS_SPALTEN.filter(
    (s) => s.immerZeigen || zeilen.some((r) => s.wert(r) !== 0)
  );
  const verpflSichtbar = spalten.some(
    (s) => s.key === "verpflegung_unterkunft"
  );
  return spalten.filter(
    (s) => s.key !== "netto_nach_verpflegung" || verpflSichtbar
  );
}

const MONATSNAMEN = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export default function AuszahlungenPage() {
  const { profile } = useProfile();
  const canKaution =
    profile?.role === "admin" ||
    profile?.role === "kasse" ||
    profile?.role === "lohnabrechnung";

  const [belege, setBelege] = useState<AuszahlungsbelegSummary[]>([]);
  const [jahrFilter, setJahrFilter] = useState<number | "alle">("alle");
  const [monatFilter, setMonatFilter] = useState<number | "alle">("alle");
  const [loading, setLoading] = useState(true);
  const [offen, setOffen] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<Record<number, AuszahlungsbelegZeile[]>>({});
  const [druckZeilen, setDruckZeilen] = useState<{
    belegnummer: string;
    zahlungsart: string;
    zeilen: AuszahlungsbelegZeile[];
    kaution: Kautionsuebergabe | null;
    kautionPersonen: { name: string; personal_nr: string; betrag: number }[];
  } | null>(null);

  // Kautionsübergabe an den Hausmeister (Nutzer-Vorgabe 2026-08-09) - je
  // Auszahlungsbeleg maximal eine nicht-stornierte Übergabe.
  const [kautionen, setKautionen] = useState<
    Record<number, Kautionsuebergabe>
  >({});
  const [kautionFormBelegId, setKautionFormBelegId] = useState<number | null>(
    null
  );
  const [uebergebenAn, setUebergebenAn] = useState("");
  const [kautionSaving, setKautionSaving] = useState(false);
  const [kautionFehler, setKautionFehler] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data, error }, { data: kautionenData }] = await Promise.all([
      supabase
        .from("auszahlungsbeleg_summary")
        .select("*")
        .order("erstellt_am", { ascending: false }),
      supabase
        .from("kautionsuebergaben")
        .select("*")
        .eq("storniert", false),
    ]);
    if (!error) setBelege((data as AuszahlungsbelegSummary[]) ?? []);
    const kautionMap: Record<number, Kautionsuebergabe> = {};
    ((kautionenData as Kautionsuebergabe[]) ?? []).forEach((k) => {
      kautionMap[k.auszahlungsbeleg_id] = k;
    });
    setKautionen(kautionMap);
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
      // Nutzer-Vorgabe 2026-08-21: Quelle von season_summary (per
      // auszahlungsbeleg_id gefiltert - wanderte bei einer erneuten
      // Abrechnung derselben Person auf den NEUEN Beleg, wodurch die Person
      // rückwirkend aus diesem, bereits gedruckten Beleg verschwand) auf
      // die unveränderliche auszahlungsbeleg_zeilen umgestellt.
      const { data, error } = await supabase
        .from("auszahlungsbeleg_zeilen")
        .select("*")
        .eq("auszahlungsbeleg_id", beleg.id)
        .order("name");
      if (!error) {
        const zeilen: AuszahlungsbelegZeile[] = (
          (data as {
            employee_id: string;
            saison_jahr: number;
            personal_nr: string;
            name: string;
            vorname: string;
            abrechnungsart: SeasonSummaryRow["abrechnungsart"];
            ist_differenz: boolean;
            zeile: Record<string, number | string | null>;
          }[]) ?? []
        ).map((row) => ({
          ...(row.zeile as unknown as SeasonSummaryRow),
          employee_id: row.employee_id,
          saison_jahr: row.saison_jahr,
          personal_nr: row.personal_nr,
          name: row.name,
          vorname: row.vorname,
          abrechnungsart: row.abrechnungsart,
          gruppe_nr: null,
          aktiv: true,
          abgerechnet_am: null,
          auszahlungsbeleg_id: beleg.id,
          // anzeige() liest bevorzugt aus snapshot - die eingefrorene
          // Beleg-Zeile IST hier schon der anzuzeigende Wert (voll oder
          // Differenz), kein separater "Live"-Stand mehr nötig.
          snapshot: row.zeile,
          ist_differenz: row.ist_differenz,
        }));
        setDetails((prev) => ({
          ...prev,
          [beleg.id]: zeilen,
        }));
      }
    }
  }

  async function drucken(beleg: AuszahlungsbelegSummary) {
    const zeilen = details[beleg.id];
    if (!zeilen) return;
    const kaution = kautionen[beleg.id] ?? null;
    let kautionPersonen: { name: string; personal_nr: string; betrag: number }[] =
      [];
    if (kaution) {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("kautionsuebergabe_personen")
        .select("employee_id, betrag")
        .eq("kautionsuebergabe_id", kaution.id);
      kautionPersonen = ((data as { employee_id: string; betrag: number }[]) ?? [])
        .map((p) => {
          const z = zeilen.find((r) => r.employee_id === p.employee_id);
          return {
            name: z ? `${z.name}, ${z.vorname}` : "—",
            personal_nr: z?.personal_nr ?? "—",
            betrag: Number(p.betrag),
          };
        });
    }
    setDruckZeilen({
      belegnummer: beleg.belegnummer,
      zahlungsart: beleg.zahlungsart,
      zeilen,
      kaution,
      kautionPersonen,
    });
  }

  // Kandidaten für die Kaution-Übergabe: alle Personen dieses Belegs mit
  // Zimmerkaution > 0 (aus dem eingefrorenen Schnappschuss - unverändert,
  // selbst wenn die Live-Berechnung inzwischen abweicht).
  function kautionsKandidaten(belegId: number) {
    return (details[belegId] ?? [])
      .map((r) => ({
        employee_id: r.employee_id,
        name: r.name,
        vorname: r.vorname,
        personal_nr: r.personal_nr,
        betrag: Number(anzeige(r, "zimmer_kaution")),
      }))
      .filter((p) => p.betrag > 0);
  }

  function kautionFormOeffnen(belegId: number) {
    setKautionFormBelegId(belegId);
    setUebergebenAn("");
    setKautionFehler(null);
  }

  async function kautionUebergeben(beleg: AuszahlungsbelegSummary) {
    const kandidaten = kautionsKandidaten(beleg.id);
    if (kandidaten.length === 0) return;
    if (!uebergebenAn.trim()) {
      setKautionFehler('Bitte "Übergeben an" ausfüllen.');
      return;
    }
    setKautionSaving(true);
    setKautionFehler(null);
    const supabase = getSupabaseClient();
    const summe = kandidaten.reduce((s, p) => s + p.betrag, 0);

    const { data: belegnummer, error: belegError } = await supabase.rpc(
      "naechste_belegnummer",
      { prefix_monat: monatsSchluessel(new Date()) }
    );
    if (belegError) {
      setKautionFehler(belegError.message);
      setKautionSaving(false);
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("kautionsuebergaben")
      .insert({
        belegnummer,
        auszahlungsbeleg_id: beleg.id,
        uebergeben_an: uebergebenAn.trim(),
        betrag_summe: summe,
      })
      .select()
      .single();
    if (insertError || !inserted) {
      setKautionFehler(insertError?.message ?? "Speichern fehlgeschlagen");
      setKautionSaving(false);
      return;
    }

    const { error: personenError } = await supabase
      .from("kautionsuebergabe_personen")
      .insert(
        kandidaten.map((p) => ({
          kautionsuebergabe_id: inserted.id,
          employee_id: p.employee_id,
          betrag: p.betrag,
        }))
      );
    if (personenError) {
      setKautionFehler(personenError.message);
      setKautionSaving(false);
      return;
    }

    setKautionSaving(false);
    setKautionFormBelegId(null);
    load();
  }

  async function kautionStornieren(k: Kautionsuebergabe) {
    const grund = window.prompt(
      "Grund für die Stornierung der Kautionsübergabe (Pflichtfeld, wird protokolliert):"
    );
    if (!grund) return;
    const supabase = getSupabaseClient();
    await supabase
      .from("kautionsuebergaben")
      .update({
        storniert: true,
        storno_grund: grund,
        storniert_am: new Date().toISOString(),
      })
      .eq("id", k.id);
    load();
  }

  const jahreOptionen = Array.from(
    new Set(belege.map((b) => b.saison_jahr))
  ).sort((a, b) => b - a);

  const belegeGefiltert = belege.filter((b) => {
    if (jahrFilter !== "alle" && b.saison_jahr !== jahrFilter) return false;
    if (monatFilter !== "alle") {
      const monat = new Date(b.erstellt_am).getMonth() + 1;
      if (monat !== monatFilter) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <LohnTabs />
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

      {!loading && belege.length > 0 && (
        <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-3 bg-neutral-50 py-2 print:hidden">
          <label className="text-sm">
            Saison-Jahr{" "}
            <select
              value={jahrFilter}
              onChange={(e) =>
                setJahrFilter(
                  e.target.value === "alle" ? "alle" : Number(e.target.value)
                )
              }
            >
              <option value="alle">Alle</option>
              {jahreOptionen.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Monat{" "}
            <select
              value={monatFilter}
              onChange={(e) =>
                setMonatFilter(
                  e.target.value === "alle" ? "alle" : Number(e.target.value)
                )
              }
            >
              <option value="alle">Alle</option>
              {MONATSNAMEN.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <span className="text-sm text-neutral-500">
            {belegeGefiltert.length} von {belege.length} Beleg(en)
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500 print:hidden">Lädt…</p>
      ) : belege.length === 0 ? (
        <p className="text-neutral-500 print:hidden">
          Noch keine Auszahlungen erfasst.
        </p>
      ) : belegeGefiltert.length === 0 ? (
        <p className="text-neutral-500 print:hidden">
          Keine Auszahlungen für diesen Filter.
        </p>
      ) : (
        <div className="flex flex-col gap-2 print:hidden">
          {belegeGefiltert.map((beleg) => {
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
                    {beleg.enthaelt_differenz && (
                      <span
                        className="ml-2 text-amber-600"
                        title="Enthält mindestens einen Differenzbeleg - eine Person war für diese Saison bereits einmal abgerechnet"
                      >
                        ⚠ Differenz
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
                                <th className={FARBE_BRUTTO_TH}>Brutto €</th>
                                <th
                                  className={FARBE_ZULAGE_TH}
                                  title="Akkord, Fahrer-Zulage, Erdbeer-/Spargel-/Zuckermais-Prämie - bereits im Brutto enthalten, hier zur Nachvollziehbarkeit separat ausgewiesen"
                                >
                                  Prämien €
                                </th>
                                <th>Steuer €</th>
                                <th className={FARBE_NETTO_TH}>Netto €</th>
                                <th className={FARBE_ABZUG_TH}>Verpfl./Unterk. €</th>
                                <th className={FARBE_ABZUG_TH}>Vorschüsse €</th>
                                <th className={FARBE_ABZUG_TH}>Buskosten €</th>
                                <th className={FARBE_KAUTION_TH}>Fahrerkaution €</th>
                                <th className={FARBE_KAUTION_TH}>Zimmerkaution €</th>
                                <th className={FARBE_ABZUG_TH}>Kleidung €</th>
                                <th>Auszahlung €</th>
                              </tr>
                            </thead>
                            <tbody>
                              {zeilen.map((r) => (
                                <tr key={r.employee_id}>
                                  <td>{r.personal_nr}</td>
                                  <td>
                                    {r.name}, {r.vorname}
                                    {r.ist_differenz && (
                                      <span
                                        className="ml-1 text-amber-600 text-xs"
                                        title="Nur die Differenz seit einer früheren Abrechnung dieser Person/Saison, nicht der volle Saison-Betrag"
                                      >
                                        (Differenz)
                                      </span>
                                    )}
                                  </td>
                                  <td>{fmt(anzeige(r, "gesamt_stunden"))}</td>
                                  <td>{anzeige(r, "anwesenheitstage") ?? "—"}</td>
                                  <td className={FARBE_BRUTTO_TD}>
                                    {fmt(anzeige(r, "bruttolohn"))}
                                  </td>
                                  <td>{fmt(anzeige(r, "praemien_summe"))}</td>
                                  <td>{fmt(anzeige(r, "lohnsteuer_pauschal"))}</td>
                                  <td className={FARBE_NETTO_TD}>
                                    {fmt(anzeige(r, "netto"))}
                                  </td>
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
                                  <td>{fmt(anzeige(r, "kleidung_betrag"))}</td>
                                  <td className="font-medium">
                                    {fmt(anzeige(r, "auszahlungsbetrag"))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {canKaution && (
                          <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3">
                            {(() => {
                              const kandidaten = kautionsKandidaten(beleg.id);
                              const bestehend = kautionen[beleg.id];
                              if (kandidaten.length === 0) {
                                return (
                                  <p className="text-sm text-neutral-500">
                                    Keine Zimmerkaution in diesem Beleg -
                                    keine Übergabe nötig.
                                  </p>
                                );
                              }
                              if (bestehend) {
                                return (
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm">
                                      ✓ Kaution übergeben: Beleg{" "}
                                      <strong>{bestehend.belegnummer}</strong>{" "}
                                      an <strong>{bestehend.uebergeben_an}</strong>{" "}
                                      ({Number(bestehend.betrag_summe).toFixed(2)} €)
                                      am {formatDatumDE(bestehend.erstellt_am)}
                                    </p>
                                    <button
                                      type="button"
                                      className="btn-danger text-xs"
                                      onClick={() => kautionStornieren(bestehend)}
                                    >
                                      Stornieren
                                    </button>
                                  </div>
                                );
                              }
                              if (kautionFormBelegId === beleg.id) {
                                const summe = kandidaten.reduce(
                                  (s, p) => s + p.betrag,
                                  0
                                );
                                return (
                                  <div className="flex flex-col gap-2">
                                    <p className="text-sm font-medium text-blue-900">
                                      Kaution übergeben ({kandidaten.length}{" "}
                                      Person(en), {summe.toFixed(2)} € gesamt)
                                    </p>
                                    <ul className="text-sm text-neutral-700">
                                      {kandidaten.map((p) => (
                                        <li key={p.employee_id}>
                                          {p.personal_nr} – {p.name}, {p.vorname}:{" "}
                                          {p.betrag.toFixed(2)} €
                                        </li>
                                      ))}
                                    </ul>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <input
                                        placeholder="Übergeben an (Hausmeister)"
                                        value={uebergebenAn}
                                        onChange={(e) =>
                                          setUebergebenAn(e.target.value)
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="btn text-xs"
                                        disabled={kautionSaving}
                                        onClick={() => kautionUebergeben(beleg)}
                                      >
                                        Bestätigen
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-secondary text-xs"
                                        onClick={() => setKautionFormBelegId(null)}
                                      >
                                        Abbrechen
                                      </button>
                                      {kautionFehler && (
                                        <span className="text-sm text-red-600">
                                          {kautionFehler}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <button
                                  type="button"
                                  className="btn-secondary text-xs"
                                  onClick={() => kautionFormOeffnen(beleg.id)}
                                >
                                  Kaution übergeben ({kandidaten.length} Person
                                  (en))
                                </button>
                              );
                            })()}
                          </div>
                        )}
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
          {(() => {
            const spalten = sichtbareSpalten(druckZeilen.zeilen);
            const gruppenstart = spalten.map(
              (s, i) => i === 0 || spalten[i - 1].gruppe !== s.gruppe
            );
            return (
              <table className="mt-4 print-form-table print-dense-table print-persnr-schmal">
                <thead>
                  <tr>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th>Std.</th>
                    <th>Tage</th>
                    {spalten.map((s, i) => (
                      <th
                        key={s.key}
                        className={`${s.thKlasse ?? ""} ${
                          gruppenstart[i] ? "print-gruppenstart" : ""
                        } ${s.hervorgehoben ? "print-hervorgehoben" : ""}`}
                      >
                        {s.label}
                      </th>
                    ))}
                    <th className="print-gruppenstart print-unterschrift-breit">
                      Unterschrift
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {druckZeilen.zeilen.map((r) => (
                    <tr key={r.employee_id}>
                      <td>{r.personal_nr}</td>
                      <td>
                        {r.name}, {r.vorname}
                        {r.ist_differenz && " (Differenz)"}
                      </td>
                      <td>{fmtDruck(anzeige(r, "gesamt_stunden"))}</td>
                      <td>{anzeige(r, "anwesenheitstage") ?? "—"}</td>
                      {spalten.map((s, i) => (
                        <td
                          key={s.key}
                          className={`${s.tdKlasse ?? ""} ${
                            gruppenstart[i] ? "print-gruppenstart" : ""
                          } ${s.hervorgehoben ? "print-hervorgehoben" : ""}`}
                        >
                          {s.key === "lohnsteuer_pauschal" ? (
                            r.abrechnungsart === "pauschal" ? (
                              <>{fmtDruck(s.wert(r))} (PA)</>
                            ) : (
                              <>– (HSC)</>
                            )
                          ) : (
                            fmtDruck(s.wert(r))
                          )}
                        </td>
                      ))}
                      <td className="print-unterschrift-breit"></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      colSpan={spalten.length + 3}
                      className="text-right font-semibold"
                    >
                      Summe Auszahlung
                    </td>
                    <td className="font-semibold print-hervorgehoben">
                      {fmtDruck(
                        druckZeilen.zeilen.reduce(
                          (s, r) =>
                            s + Number(anzeige(r, "auszahlungsbetrag") ?? 0),
                          0
                        )
                      )}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            );
          })()}

          {/* Kautionsübergabe an den Hausmeister - erscheint direkt im
              Anschluss an den Auszahlungsbeleg (Nutzer-Vorgabe 2026-08-09).
              Analog zum Vorschuss-Übergabebeleg: Zusammenfassung, dann eine
              zweite Liste nur für die Unterschrift. */}
          {druckZeilen.kaution && (
            <div className="print-page-break">
              <h2 className="text-xl font-semibold">Kautionsübergabe</h2>
              <p className="mt-1 text-base">
                Belegnummer: {druckZeilen.kaution.belegnummer} · Datum:{" "}
                {formatDatumDE(druckZeilen.kaution.erstellt_am)}
              </p>
              <p className="text-base">
                Übergeben an: {druckZeilen.kaution.uebergeben_an} · Personen:{" "}
                {druckZeilen.kautionPersonen.length} · Betrag:{" "}
                {fmtDruck(druckZeilen.kaution.betrag_summe)} €
              </p>
              <table className="mt-4 print-form-table print-dense-table print-persnr-schmal">
                <thead>
                  <tr>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th>Betrag €</th>
                  </tr>
                </thead>
                <tbody>
                  {druckZeilen.kautionPersonen.map((p, i) => (
                    <tr key={i}>
                      <td>{p.personal_nr}</td>
                      <td>{p.name}</td>
                      <td>{fmtDruck(p.betrag)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="text-right font-semibold">
                      Summe
                    </td>
                    <td className="font-semibold">
                      {fmtDruck(druckZeilen.kaution.betrag_summe)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="mt-8 text-base">
                Übergeben an: {druckZeilen.kaution.uebergeben_an}
              </p>
              <p className="mt-8 text-base">
                Unterschrift:{" "}
                <span className="ml-2 inline-block w-64 border-b-2 border-black">
                  &nbsp;
                </span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
