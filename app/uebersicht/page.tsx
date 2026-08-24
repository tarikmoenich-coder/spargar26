"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  ABRECHNUNGSART_LABELS,
  type Arbeitsgruppe,
  type EmployeeStatusChain,
  type FuehrerscheinEintrag,
  type Period,
  type ProfilName,
  type SeasonSummaryMonatRow,
  type SeasonSummaryRow,
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

const OHNE_GRUPPE_KEY = "__ohne__";

const CURRENT_YEAR = new Date().getFullYear();

const MONATSNAMEN = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

// Letzter Kalendertag eines Monats, z.B. (2026, 4) -> "2026-04-30".
function letzterTagDesMonats(jahr: number, monat: number): string {
  const letzterTag = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  return `${jahr}-${String(monat).padStart(2, "0")}-${String(letzterTag).padStart(2, "0")}`;
}

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
  // Suchfilter nach Name/Personalnummer (Nutzer-Vorgabe 2026-08-14, wie
  // schon auf "Personal") - wirkt zusätzlich zum Gruppen-Filter, auf beide
  // Ansichten (Saison-Summe und Monats-Kontrolle).
  const [search, setSearch] = useState("");
  // Standardmäßig ausgeblendet (Nutzer-Vorgabe 2026-08-09) - bereits
  // abgerechnete/inaktive Personen sollen die Lohnübersicht nicht
  // zumüllen. Gleiches Muster wie "inaktive anzeigen" im Personalstamm.
  const [showInactive, setShowInactive] = useState(false);
  // Nutzer-Vorgabe 2026-08-24: "die Personen sind nicht sichtbar, weil sie
  // 'inaktiv' sind - das passt nicht, weil sie noch nicht abgerechnet
  // sind" - eine per Statuswechsel abgelöste, jetzt inaktive Nummer mit
  // noch offener Auszahlung geht in der allgemeinen "inaktive anzeigen"-
  // Liste unter, weil sie dort ununterscheidbar von wirklich fertigen
  // Ex-Mitarbeitern steht. Eigener Schnellfilter, der showInactive für
  // genau diesen Fall ersetzt statt nur zu ergänzen.
  const [nurOffeneStatuswechsel, setNurOffeneStatuswechsel] = useState(false);
  const [statusChain, setStatusChain] = useState<
    Record<string, EmployeeStatusChain>
  >({});
  // Aus employee_fuehrerschein_kategorien (schmale, breit zugängliche
  // Sicht) - zeigt nur, DASS und WOFÜR jemand einen Führerschein hat.
  const [fuehrerschein, setFuehrerschein] = useState<
    Record<string, string[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<string>>(new Set());
  const [abrechnenLaeuft, setAbrechnenLaeuft] = useState(false);
  const [abrechnenFehler, setAbrechnenFehler] = useState<string | null>(null);
  const [letzterBeleg, setLetzterBeleg] = useState<string | null>(null);
  const [abrechnenZahlungsart, setAbrechnenZahlungsart] = useState("BAR");

  // Monatsfilter (0 = "Alle", d.h. die normale Saison-Ansicht oben) - für
  // die Monatsabschluss-Kontrolle: eigene Sicht mit Monats-Stunden/-Brutto/
  // -Verpflegung statt der Saison-Summen, siehe season_summary_monat.
  const [monatFilter, setMonatFilter] = useState(0);
  const [monatsRows, setMonatsRows] = useState<SeasonSummaryMonatRow[]>([]);
  const [loadingMonat, setLoadingMonat] = useState(false);
  const [alleAktiven, setAlleAktiven] = useState<
    {
      id: string;
      personal_nr: string;
      name: string;
      vorname: string;
      gruppe_nr: string | null;
    }[]
  >([]);
  const [periode, setPeriode] = useState<Period | null>(null);
  const [periodeLaeuft, setPeriodeLaeuft] = useState(false);
  const [namenVon, setNamenVon] = useState<Record<string, string>>({});
  // Korrektur eines bereits abgerechneten Netto-Betrags (Nutzer-Vorgabe
  // 2026-08-19) - key ist `${employee_id}-${saison_jahr}`.
  const [korrigierenKey, setKorrigierenKey] = useState<string | null>(null);
  const [korrekturNetto, setKorrekturNetto] = useState<Record<string, string>>(
    {}
  );
  const [korrekturLaeuft, setKorrekturLaeuft] = useState<string | null>(null);
  // Gleiches Muster, eigener State - Korrektur der "Verpflegungsfreie
  // Tage" nach dem Abrechnen (Nutzer-Vorgabe 2026-08-19, z.B. Kantine noch
  // nicht geöffnet).
  const [korrigierenVerpflegungKey, setKorrigierenVerpflegungKey] = useState<
    string | null
  >(null);
  const [korrekturVerpflegungstage, setKorrekturVerpflegungstage] = useState<
    Record<string, string>
  >({});
  const [korrekturVerpflegungLaeuft, setKorrekturVerpflegungLaeuft] = useState<
    string | null
  >(null);

  const canEdit =
    profile?.role === "admin" || profile?.role === "lohnabrechnung";
  // Monatsabschluss: eigene Berechtigung, deckt sich mit der RLS-Policy
  // "periods_write" (nicht mit canEdit/lohnabrechnung).
  const canCloseMonth = profile?.role === "admin" || profile?.role === "hr";

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
    async function ladeStatusChain() {
      const supabase = getSupabaseClient();
      const { data } = await supabase.from("employee_status_chain").select("*");
      const map: Record<string, EmployeeStatusChain> = {};
      ((data as EmployeeStatusChain[]) ?? []).forEach((c) => {
        map[c.employee_id] = c;
      });
      setStatusChain(map);
    }
    ladeGruppen();
    ladeStatusChain();
  }, []);

  useEffect(() => {
    async function ladeAktive() {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("employees")
        .select("id, personal_nr, name, vorname, gruppe_nr")
        .eq("aktiv", true)
        .order("name");
      setAlleAktiven(data ?? []);
    }
    async function ladeNamen() {
      const supabase = getSupabaseClient();
      const { data } = await supabase.from("profile_namen").select("*");
      const map: Record<string, string> = {};
      ((data as ProfilName[]) ?? []).forEach((p) => {
        map[p.id] = p.full_name;
      });
      setNamenVon(map);
    }
    ladeAktive();
    ladeNamen();
  }, []);

  async function ladeMonat() {
    if (monatFilter === 0) return;
    setLoadingMonat(true);
    const supabase = getSupabaseClient();
    const [{ data: mRows }, { data: pRow }] = await Promise.all([
      supabase
        .from("season_summary_monat")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("monat", monatFilter),
      supabase
        .from("periods")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("monat", monatFilter)
        .maybeSingle(),
    ]);
    setMonatsRows((mRows as SeasonSummaryMonatRow[]) ?? []);
    setPeriode((pRow as Period) ?? null);
    setLoadingMonat(false);
  }

  useEffect(() => {
    ladeMonat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr, monatFilter]);

  async function monatAbschliessen() {
    if (!profile) return;
    const bestaetigt = window.confirm(
      `${MONATSNAMEN[monatFilter - 1]} ${jahr} abschließen? Die ` +
        `Stundenerfassung ist für diesen Monat danach gesperrt, bis er ` +
        `bewusst wieder geöffnet wird.`
    );
    if (!bestaetigt) return;
    setPeriodeLaeuft(true);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("periods").upsert(
      {
        saison_jahr: jahr,
        monat: monatFilter,
        gesperrt: true,
        gesperrt_von: profile.id,
        gesperrt_am: new Date().toISOString(),
      },
      { onConflict: "saison_jahr,monat" }
    );
    setPeriodeLaeuft(false);
    if (error) {
      window.alert(`Fehler: ${error.message}`);
      return;
    }
    ladeMonat();
  }

  async function monatOeffnen() {
    if (!profile) return;
    const grund = window.prompt(
      "Grund für das Wiederöffnen (Pflichtfeld, wird protokolliert):"
    );
    if (!grund) return;
    setPeriodeLaeuft(true);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("periods").upsert(
      {
        saison_jahr: jahr,
        monat: monatFilter,
        gesperrt: false,
        entsperrt_von: profile.id,
        entsperrt_am: new Date().toISOString(),
        entsperrt_grund: grund,
      },
      { onConflict: "saison_jahr,monat" }
    );
    setPeriodeLaeuft(false);
    if (error) {
      window.alert(`Fehler: ${error.message}`);
      return;
    }
    ladeMonat();
  }

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

  const gruppenByNr = new Map(gruppen.map((g) => [g.gruppe_nr, g]));

  // Vor gefilterteRows definiert, damit sowohl die Saison- als auch die
  // Monats-Ansicht (weiter unten) dieselbe Suche nutzen können.
  const passtZurSuche = (r: {
    personal_nr: string;
    name: string;
    vorname: string;
  }) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.vorname.toLowerCase().includes(q) ||
      r.personal_nr.toLowerCase().includes(q)
    );
  };

  // Nutzer-Vorgabe 2026-08-24: eine per Statuswechsel abgelöste, inaktive
  // Nummer mit noch offener Auszahlung erkennen - hat eine Nachfolge-Nummer
  // (siehe employee_status_chain) UND ist noch nicht abgerechnet.
  function hatOffenenStatuswechsel(r: SeasonSummaryRow) {
    return (
      !r.aktiv &&
      !r.abgerechnet_am &&
      !!statusChain[r.employee_id]?.nachfolger_status
    );
  }

  // Damit eine Mitarbeiterin z.B. alle zur Abrechnung vorgesehenen Personen
  // vorab in eine Gruppe (z.B. "101 - Abrechnen") packen kann und diese hier
  // gefiltert und komplett auf einmal markiert werden können.
  const gefilterteRows = rows
    .filter((r) =>
      nurOffeneStatuswechsel
        ? hatOffenenStatuswechsel(r)
        : showInactive || r.aktiv
    )
    .filter((r) =>
      !gruppeFilter
        ? true
        : gruppeFilter === OHNE_GRUPPE_KEY
          ? !r.gruppe_nr
          : r.gruppe_nr === gruppeFilter
    )
    .filter(passtZurSuche);

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
    const ausgewaehlteRows = rows.filter((r) => ausgewaehlt.has(r.employee_id));
    const namen = ausgewaehlteRows.map((r) => `${r.name}, ${r.vorname}`);
    // Nutzer-Vorgabe 2026-08-21 (Frage: "Person abgerechnet, deaktiviert,
    // reaktiviert, Stunden nachgetragen, erneut abgerechnet - kommt dann
    // eine weitere Abrechnung?"): wer bereits ein abgerechnet_am hat, war
    // für diese Saison schon einmal abgerechnet (z.B. reaktiviert) - für
    // diese Personen erzeugt saison_abrechnen_batch jetzt automatisch nur
    // einen Differenzbeleg (siehe schema.sql/auszahlungsbeleg_zeilen), statt
    // nochmal den vollen Saison-Betrag auszuzahlen. Reiner Transparenz-
    // Hinweis vor dem Klick, kein RPC-Signaturwechsel nötig.
    const bereitsAbgerechnet = ausgewaehlteRows.filter((r) => r.abgerechnet_am);
    const differenzHinweis =
      bereitsAbgerechnet.length > 0
        ? `\n\nAchtung: ${bereitsAbgerechnet.length} Person(en) wurden für diese ` +
          `Saison bereits abgerechnet:\n${bereitsAbgerechnet
            .map((r) => `${r.name}, ${r.vorname}`)
            .join("\n")}\n\n` +
          `Für sie wird nur die Differenz seit der letzten Abrechnung ausgezahlt ` +
          `(Differenzbeleg), nicht nochmal der volle Saison-Betrag.`
        : "";
    const bestaetigt = window.confirm(
      `${ausgewaehlt.size} Person(en) für Saison ${jahr} jetzt abrechnen?\n\n` +
        `${namen.join("\n")}\n\n` +
        `Diese Personen werden danach auf "inaktiv" gesetzt (können bei Bedarf ` +
        `später wieder reaktiviert werden).` +
        differenzHinweis
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
    // Bugfix/Aufräumen 2026-08-21 (Nutzer-Vorgabe: "dieser Beleg ist
    // eigentlich auch unnötig"): früher wurde hier zusätzlich sofort eine
    // eigene Auszahlungsliste OHNE Belegnummer gedruckt (sowohl automatisch
    // nach "Jetzt Abrechnen" als auch über einen eigenen Button) - der
    // tatsächlich genutzte Beleg MIT Belegnummer kommt ohnehin von der
    // "Auszahlungen"-Seite (siehe Hinweis unten), dieser zweite,
    // unvollständige Ausdruck war nur verwirrende Doppelung.
    if (belegnummer && !fehler) {
      setLetzterBeleg(belegnummer);
    }

    setAusgewaehlt(new Set());
    setAbrechnenLaeuft(false);
    load();
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

  // Nachträgliche Korrektur eines bereits abgerechneten (und damit
  // gesperrten) Netto-Betrags - Nutzer-Vorgabe 2026-08-19: "der
  // Auszahlungsbetrag stimmt jetzt nicht mehr, weil ich den Netto-Betrag
  // falsch eingegeben habe". Bewusst nur Netto (kleinster, gezielter
  // Eingriff), Pflichtgrund + Protokoll in "Kassenbewegungen" (wie
  // Vorschuss-Korrektur), keine automatische Nach-/Rückzahlung - die
  // tatsächliche Geldbewegung läuft außerhalb der App, wie bei der
  // Kautions-Rückzahlung.
  async function nettoKorrigieren(row: SeasonSummaryRow) {
    const key = `${row.employee_id}-${row.saison_jahr}`;
    const neuerWert = korrekturNetto[key];
    if (!neuerWert || neuerWert.trim() === "") return;
    const neuerNetto = Number(neuerWert);
    if (Number.isNaN(neuerNetto)) return;
    const alterNetto = Number(anzeige(row, "netto"));
    if (neuerNetto === alterNetto) return; // keine Änderung
    const grund = window.prompt(
      `Grund für die Korrektur von ${alterNetto.toFixed(
        2
      )} € auf ${neuerNetto.toFixed(2)} € (Netto) bei ${row.name}, ${
        row.vorname
      } (Pflichtfeld, wird protokolliert):`
    );
    if (!grund) return;
    setKorrekturLaeuft(key);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("abrechnung_korrigieren", {
      p_employee_id: row.employee_id,
      p_saison_jahr: row.saison_jahr,
      p_neuer_netto_extern: neuerNetto,
      p_grund: grund,
    });
    setKorrekturLaeuft(null);
    if (error) {
      window.alert(`Korrektur fehlgeschlagen: ${error.message}`);
      return;
    }
    setKorrigierenKey(null);
    load();
  }

  // Verpflegungsfreie Tage (Nutzer-Vorgabe 2026-08-19, z.B. Kantine noch
  // nicht geöffnet) - VOR dem Abrechnen ein normales Eingabefeld wie
  // Buskosten/Kautionen, direktes Upsert.
  async function verpflegungsfreieTageSpeichern(
    row: SeasonSummaryRow,
    wert: string
  ) {
    const supabase = getSupabaseClient();
    const verpflegungsfreie_tage = wert.trim() === "" ? 0 : Number(wert);
    await supabase.from("season_bonuses").upsert(
      {
        employee_id: row.employee_id,
        saison_jahr: row.saison_jahr,
        verpflegungsfreie_tage,
      },
      { onConflict: "employee_id,saison_jahr" }
    );
    load();
  }

  // Gleiches Muster wie nettoKorrigieren, für "Verpflegungsfreie Tage"
  // NACH dem Abrechnen.
  async function verpflegungKorrigieren(row: SeasonSummaryRow) {
    const key = `${row.employee_id}-${row.saison_jahr}`;
    const neuerWert = korrekturVerpflegungstage[key];
    if (!neuerWert || neuerWert.trim() === "") return;
    const neueTage = Number(neuerWert);
    if (Number.isNaN(neueTage)) return;
    const alteTage = Number(anzeige(row, "verpflegungsfreie_tage") ?? 0);
    if (neueTage === alteTage) return; // keine Änderung
    const grund = window.prompt(
      `Grund für die Korrektur von ${alteTage} auf ${neueTage} verpflegungsfreie Tage bei ${row.name}, ${row.vorname} (Pflichtfeld, wird protokolliert):`
    );
    if (!grund) return;
    setKorrekturVerpflegungLaeuft(key);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("abrechnung_verpflegung_korrigieren", {
      p_employee_id: row.employee_id,
      p_saison_jahr: row.saison_jahr,
      p_neue_verpflegungsfreie_tage: neueTage,
      p_grund: grund,
    });
    setKorrekturVerpflegungLaeuft(null);
    if (error) {
      window.alert(`Korrektur fehlgeschlagen: ${error.message}`);
      return;
    }
    setKorrigierenVerpflegungKey(null);
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


  // Wer "erwartungsgemäß" bis wann Einträge im gewählten Monat haben
  // sollte: bis heute (falls der Monat noch läuft) oder bis zum Monatsende
  // (falls er schon vorbei ist).
  const heuteIso = new Date().toISOString().slice(0, 10);
  const monatsEnde = monatFilter ? letzterTagDesMonats(jahr, monatFilter) : "";
  const erwartetesEnde = monatFilter
    ? heuteIso < monatsEnde
      ? heuteIso
      : monatsEnde
    : "";

  // Aktive Personen ganz ohne Eintrag im gewählten Monat (season_summary_
  // monat hat für sie schlicht keine Zeile) - separat markiert, damit sie
  // nicht unbemerkt durchrutschen.
  const monatsRowsById = new Map(monatsRows.map((r) => [r.employee_id, r]));
  const passtZurGruppe = (gruppe_nr: string | null) =>
    !gruppeFilter ||
    (gruppeFilter === OHNE_GRUPPE_KEY ? !gruppe_nr : gruppe_nr === gruppeFilter);
  const gefilterteMonatsRows = monatsRows
    .filter((r) => passtZurGruppe(r.gruppe_nr))
    .filter(passtZurSuche);
  const fehlendeImMonat = alleAktiven.filter(
    (m) =>
      !monatsRowsById.has(m.id) &&
      passtZurGruppe(m.gruppe_nr) &&
      passtZurSuche(m)
  );

  return (
    <div className="flex flex-col gap-4">
      <LohnTabs />
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

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-3 bg-neutral-50 py-2 print:hidden">
        <input
          placeholder="Suche nach Name oder Personalnummer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
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
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          inaktive anzeigen
        </label>
        <label
          className="flex items-center gap-1 text-sm text-amber-700"
          title="Per Statuswechsel abgelöste, inaktive Personalnummern mit noch offener (nicht abgerechneter) Auszahlung - unabhängig von 'inaktive anzeigen'"
        >
          <input
            type="checkbox"
            checked={nurOffeneStatuswechsel}
            onChange={(e) => setNurOffeneStatuswechsel(e.target.checked)}
          />
          nur offene Statuswechsel
        </label>
        <label className="text-sm">
          Monat{" "}
          <select
            value={monatFilter}
            onChange={(e) => setMonatFilter(Number(e.target.value))}
          >
            <option value={0}>Alle (Saison-Summe)</option>
            {MONATSNAMEN.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {canEdit && monatFilter === 0 && (
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
        {canEdit && monatFilter === 0 && (
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
        {monatFilter === 0 && abrechnenFehler && (
          <span className="text-sm text-red-600">{abrechnenFehler}</span>
        )}
      </div>

      {monatFilter === 0 && letzterBeleg && (
        <p className="text-sm text-emerald-800 print:hidden">
          Beleg {letzterBeleg} erstellt - Details unter „Auszahlungen".
        </p>
      )}

      {monatFilter === 0 && (loading ? (
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
                <th>Führerschein</th>
                <th>Std.</th>
                <th>Tage</th>
                <th>Abrechnungsart</th>
                <th className={FARBE_BRUTTO_TH}>Brutto €</th>
                <th
                  className={FARBE_ZULAGE_TH}
                  title="Akkord, Fahrer-Zulage, Erdbeer-/Spargel-/Zuckermais-Prämie - bereits im Brutto enthalten, hier zur Nachvollziehbarkeit separat ausgewiesen"
                >
                  Prämien €
                </th>
                <th
                  className={FARBE_ZULAGE_TH}
                  title="Aus dem Stundenkonto in Auszahlung umgewandelte Stunden (Stundenerfassung → Stundenkonto) - bereits im Brutto enthalten, hier separat ausgewiesen"
                >
                  Zulage €
                </th>
                <th>Lohnsteuer (pauschal) €</th>
                <th className={FARBE_NETTO_TH}>Netto €</th>
                <th className={FARBE_ABZUG_TH}>Verpfl./Unterkunft €</th>
                <th
                  className={FARBE_ABZUG_TH}
                  title="Reduziert nur den Verpflegungsabzug (z.B. Tage, an denen die Kantine noch nicht geöffnet hatte) - Unterkunft bleibt unberührt"
                >
                  Verpfl.-freie Tage
                </th>
                <th className={FARBE_ABZUG_TH}>Vorschüsse €</th>
                <th className={FARBE_ABZUG_TH}>Buskosten €</th>
                <th className={FARBE_KAUTION_TH}>Fahrerkaution €</th>
                <th className={FARBE_KAUTION_TH}>Zimmerkaution €</th>
                <th
                  className={FARBE_ABZUG_TH}
                  title="Hose/Jacke/Stiefel, erfasst über Stundenerfassung → Arbeitskleidung"
                >
                  Kleidung €
                </th>
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
                  <td>
                    {fuehrerschein[r.employee_id] ? (
                      <span className="text-emerald-700">
                        {fuehrerschein[r.employee_id].join(", ")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{fmt(anzeige(r, "gesamt_stunden"))}</td>
                  <td>{anzeige(r, "anwesenheitstage") ?? "—"}</td>
                  <td>{ABRECHNUNGSART_LABELS[r.abrechnungsart]}</td>
                  <td className={FARBE_BRUTTO_TD}>
                    {fmt(anzeige(r, "bruttolohn"))}
                  </td>
                  <td>{fmt(anzeige(r, "praemien_summe"))}</td>
                  <td>{fmt(anzeige(r, "stundenkonto_auszahlung_betrag"))}</td>
                  <td>{fmt(anzeige(r, "lohnsteuer_pauschal"))}</td>
                  <td className={FARBE_NETTO_TD}>
                    {r.abrechnungsart === "pauschal" || !canEdit ? (
                      fmt(anzeige(r, "netto"))
                    ) : r.abgerechnet_am ? (
                      (() => {
                        const key = `${r.employee_id}-${r.saison_jahr}`;
                        return korrigierenKey === key ? (
                          <div className="flex flex-col gap-1">
                            <input
                              type="number"
                              step="0.01"
                              className="w-24"
                              placeholder="neuer Netto-Betrag"
                              value={korrekturNetto[key] ?? ""}
                              onChange={(e) =>
                                setKorrekturNetto((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                            />
                            <div className="flex gap-1">
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                disabled={korrekturLaeuft === key}
                                onClick={() => nettoKorrigieren(r)}
                              >
                                Speichern
                              </button>
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => setKorrigierenKey(null)}
                              >
                                Abbrechen
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {fmt(anzeige(r, "netto"))}{" "}
                            <button
                              type="button"
                              className="text-xs text-emerald-700 underline"
                              title="Nachträgliche Korrektur - wird mit Grund protokolliert"
                              onClick={() => {
                                setKorrekturNetto((prev) => ({
                                  ...prev,
                                  [key]: String(anzeige(r, "netto") ?? ""),
                                }));
                                setKorrigierenKey(key);
                              }}
                            >
                              korrigieren
                            </button>
                          </>
                        );
                      })()
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
                  <td>
                    {!canEdit ? (
                      anzeige(r, "verpflegungsfreie_tage") ?? 0
                    ) : r.abgerechnet_am ? (
                      (() => {
                        const key = `${r.employee_id}-${r.saison_jahr}`;
                        return korrigierenVerpflegungKey === key ? (
                          <div className="flex flex-col gap-1">
                            <input
                              type="number"
                              step="1"
                              min={0}
                              className="w-16"
                              placeholder="Tage"
                              value={korrekturVerpflegungstage[key] ?? ""}
                              onChange={(e) =>
                                setKorrekturVerpflegungstage((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                            />
                            <div className="flex gap-1">
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                disabled={korrekturVerpflegungLaeuft === key}
                                onClick={() => verpflegungKorrigieren(r)}
                              >
                                Speichern
                              </button>
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => setKorrigierenVerpflegungKey(null)}
                              >
                                Abbrechen
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {anzeige(r, "verpflegungsfreie_tage") ?? 0}{" "}
                            <button
                              type="button"
                              className="text-xs text-emerald-700 underline"
                              title="Nachträgliche Korrektur - wird mit Grund protokolliert"
                              onClick={() => {
                                setKorrekturVerpflegungstage((prev) => ({
                                  ...prev,
                                  [key]: String(
                                    anzeige(r, "verpflegungsfreie_tage") ?? 0
                                  ),
                                }));
                                setKorrigierenVerpflegungKey(key);
                              }}
                            >
                              korrigieren
                            </button>
                          </>
                        );
                      })()
                    ) : (
                      <input
                        type="number"
                        step="1"
                        min={0}
                        className="w-16"
                        defaultValue={r.verpflegungsfreie_tage || ""}
                        placeholder="0"
                        key={`${r.employee_id}-vft-${r.verpflegungsfreie_tage}`}
                        onBlur={(e) =>
                          verpflegungsfreieTageSpeichern(r, e.target.value)
                        }
                      />
                    )}
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
                  <td>{fmt(anzeige(r, "kleidung_betrag"))}</td>
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
                    {hatOffenenStatuswechsel(r) && (
                      <>
                        <br />
                        <span
                          className="text-xs font-medium text-amber-700"
                          title={`Neue Personalnummer ${
                            statusChain[r.employee_id]?.nachfolger_personal_nr ?? "—"
                          } (${statusChain[r.employee_id]?.nachfolger_status ?? "—"}) - hier noch keine Auszahlung erfolgt`}
                        >
                          ⚠ Statuswechsel offen
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {monatFilter !== 0 && (
        <div className="flex flex-col gap-4 print:hidden">
          <div
            className={`flex flex-wrap items-center gap-3 rounded border p-3 ${
              periode?.gesperrt
                ? "border-amber-300 bg-amber-50"
                : "border-neutral-200 bg-white"
            }`}
          >
            {periode?.gesperrt ? (
              <>
                <span className="text-sm font-medium text-amber-800">
                  🔒 {MONATSNAMEN[monatFilter - 1]} {jahr} ist abgeschlossen
                  {periode.gesperrt_am && (
                    <>
                      {" "}
                      (am {formatDatumDE(periode.gesperrt_am)}
                      {periode.gesperrt_von && namenVon[periode.gesperrt_von]
                        ? ` von ${namenVon[periode.gesperrt_von]}`
                        : ""}
                      )
                    </>
                  )}
                  . Die Stundenerfassung ist für diesen Monat gesperrt.
                </span>
                {canCloseMonth && (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={periodeLaeuft}
                    onClick={monatOeffnen}
                  >
                    Monat wieder öffnen
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="text-sm text-neutral-600">
                  🔓 {MONATSNAMEN[monatFilter - 1]} {jahr} ist offen.
                  {periode?.entsperrt_am && (
                    <>
                      {" "}
                      Zuletzt wiedergeöffnet am{" "}
                      {formatDatumDE(periode.entsperrt_am)}
                      {periode.entsperrt_von && namenVon[periode.entsperrt_von]
                        ? ` von ${namenVon[periode.entsperrt_von]}`
                        : ""}
                      {periode.entsperrt_grund
                        ? ` (${periode.entsperrt_grund})`
                        : ""}
                      .
                    </>
                  )}
                </span>
                {canCloseMonth && (
                  <button
                    type="button"
                    className="btn text-xs"
                    disabled={periodeLaeuft}
                    onClick={monatAbschliessen}
                  >
                    Monat abschließen
                  </button>
                )}
              </>
            )}
          </div>

          <p className="text-sm text-neutral-500">
            Reine Monats-Kontrolle: Stunden, Anwesenheitstage, Basis-Brutto
            (nur Stunden × Stundenlohn, <strong>ohne</strong> Saison-Prämien
            wie Akkord/Fahrer-Zulage/Erdbeer-/Spargel-Prämie - die werden
            weiterhin nur einmal pro Saison erfasst) sowie Verpflegung/
            Unterkunft als monatlicher Durchlaufposten. Die eigentliche
            Auszahlung bleibt ein Saison-Vorgang ("Jetzt Abrechnen" oben bei
            "Alle"). „⚠" bedeutet: letzter Eintrag liegt vor dem erwarteten
            Ende ({formatDatumDE(erwartetesEnde)}) - möglicherweise fehlen
            noch Stunden.
          </p>

          {loadingMonat ? (
            <p className="text-neutral-500">Lädt…</p>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th>Gruppe</th>
                    <th>Std.</th>
                    <th>Tage</th>
                    <th className={FARBE_BRUTTO_TH}>Basis-Brutto €</th>
                    <th className={FARBE_ABZUG_TH}>Verpflegung €</th>
                    <th className={FARBE_ABZUG_TH}>Unterkunft €</th>
                    <th>Letzter Eintrag</th>
                  </tr>
                </thead>
                <tbody>
                  {gefilterteMonatsRows.map((r) => {
                    const warnung = r.letzter_eintrag < erwartetesEnde;
                    return (
                      <tr
                        key={r.employee_id}
                        className={r.aktiv ? "" : "opacity-60"}
                      >
                        <td>{r.personal_nr}</td>
                        <td>
                          {r.name}, {r.vorname}
                        </td>
                        <td className="text-sm text-neutral-500">
                          {r.gruppe_nr
                            ? `${r.gruppe_nr} – ${
                                gruppenByNr.get(r.gruppe_nr)?.bezeichnung ??
                                r.gruppe_nr
                              }`
                            : "—"}
                        </td>
                        <td>{fmt(r.gesamt_stunden)}</td>
                        <td>{r.anwesenheitstage}</td>
                        <td className={FARBE_BRUTTO_TD}>{fmt(r.basis_brutto)}</td>
                        <td>{fmt(r.abzug_verpflegung)}</td>
                        <td>{fmt(r.abzug_wohnen)}</td>
                        <td>
                          {formatDatumDE(r.letzter_eintrag)}
                          {warnung && (
                            <span
                              className="ml-1 text-amber-600"
                              title={`Möglicherweise unvollständig - letzter Eintrag vor dem erwarteten Ende (${formatDatumDE(erwartetesEnde)})`}
                            >
                              ⚠
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {fehlendeImMonat.map((m) => (
                    <tr key={m.id} className="bg-red-50">
                      <td>{m.personal_nr}</td>
                      <td>
                        {m.name}, {m.vorname}
                      </td>
                      <td className="text-sm text-neutral-500">
                        {m.gruppe_nr
                          ? `${m.gruppe_nr} – ${
                              gruppenByNr.get(m.gruppe_nr)?.bezeichnung ??
                              m.gruppe_nr
                            }`
                          : "—"}
                      </td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td className="font-medium text-red-600">
                        ⚠ Keine Einträge
                      </td>
                    </tr>
                  ))}
                  {gefilterteMonatsRows.length === 0 &&
                    fehlendeImMonat.length === 0 && (
                      <tr>
                        <td colSpan={9} className="text-neutral-500">
                          Keine Daten für diesen Monat.
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
