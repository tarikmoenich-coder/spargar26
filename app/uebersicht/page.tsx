"use client";

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
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
import { formatDatumDE, formatMenge } from "@/lib/format";
import LohnTabs from "@/components/LohnTabs";
import PageHeader from "@/components/PageHeader";
import { Banknote } from "lucide-react";
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
  return n === null || n === undefined || n === "" ? "—" : formatMenge(Number(n), 2);
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
  // Druck der Monats-Filter-Liste für die Buchhaltung: erst der Dialog
  // (bereits ausgezahlte Personen mitdrucken?), dann steht in druckMonat die
  // getroffene Wahl - ein Effekt löst danach window.print() aus.
  const [druckDialogOffen, setDruckDialogOffen] = useState(false);
  const [druckMonat, setDruckMonat] = useState<{
    mitAusgezahlten: boolean;
  } | null>(null);
  // Stunden-/Vorschussübersicht für die per Checkbox ausgewählten Personen -
  // tagegenau (Nutzer-Vorgabe 2026-09-24: "tagegenau, nur mit monatlicher
  // Hervorhebung für die Übersichtlichkeit"), unabhängig vom Monatsfilter
  // oben, deckt immer die ganze Saison ab. Gleiches Druck-Muster wie
  // druckMonat: erst Daten laden, dann per Effekt window.print() auslösen.
  const [stundenVorschussDaten, setStundenVorschussDaten] = useState<
    {
      employeeId: string;
      personalNr: string;
      name: string;
      vorname: string;
      tage: { datum: string; stunden: number | null; vorschuss: number }[];
    }[] | null
  >(null);
  const [stundenVorschussLaeuft, setStundenVorschussLaeuft] = useState(false);

  // Sortierung der Monats-Filter-Liste (wirkt auf Bildschirm UND Druck, damit
  // die Buchhaltung vor dem Druck die gewünschte Reihenfolge sieht).
  const [monatSort, setMonatSort] = useState<
    "name" | "personal_nr" | "gruppe" | "herkunft"
  >("name");
  const [alleAktiven, setAlleAktiven] = useState<
    {
      id: string;
      personal_nr: string;
      name: string;
      vorname: string;
      gruppe_nr: string | null;
      herkunft: string | null;
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

  // Auswahl auch beim Wechsel des Gruppenfilters zurücksetzen (Nutzer-Meldung
  // 2026-09-24: "ignoriert meinen Gruppenfilter") - sonst blieben Personen
  // aus einer vorher gewählten (jetzt ausgeblendeten) Gruppe unsichtbar
  // markiert und flossen z.B. in den Druck mit ein, obwohl der Filter etwas
  // anderes zeigte.
  useEffect(() => {
    setAusgewaehlt(new Set());
  }, [gruppeFilter]);

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
        .select("id, personal_nr, name, vorname, gruppe_nr, herkunft")
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

  // Sobald eine Druck-Wahl feststeht: kurz warten (Druckansicht rendern
  // lassen), drucken, danach zurücksetzen. Gleiches Muster wie auf
  // "Auszahlungen".
  useEffect(() => {
    if (!druckMonat) return;
    const id = setTimeout(() => window.print(), 50);
    return () => clearTimeout(id);
  }, [druckMonat]);

  useEffect(() => {
    function handleAfterPrint() {
      setDruckMonat(null);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  // Lädt Stunden (work_entries, tagegenau) + Vorschüsse (employee_vorschuss_
  // historie, tagegenau) für die ausgewählten Personen und löst danach den
  // Druck aus. Tagegenau statt Monatssummen (Nutzer-Vorgabe 2026-09-24) -
  // die Monatsgliederung passiert erst beim Rendern (Zwischenüberschrift je
  // Monat), nicht mehr schon beim Laden.
  async function stundenVorschussDrucken() {
    if (ausgewaehlt.size === 0) return;
    setStundenVorschussLaeuft(true);
    const ids = Array.from(ausgewaehlt);
    const supabase = getSupabaseClient();
    const vonBis = { von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
    // Seitenweise laden (lib/ladeAlle.ts) - sonst schneidet PostgREST bei
    // ~1000 Zeilen ab. Bei mehreren ausgewählten Personen über eine ganze
    // Saison ist das schnell überschritten (Nutzer-Meldung 2026-09-24: bei
    // manchen Personen stand überall 0 Stunden, obwohl die Lohnübersicht
    // die korrekte Summe zeigte - die Zeilen dieser Personen lagen einfach
    // hinter der 1000er-Grenze und kamen nie an).
    const [stundenDaten, vorschussDaten] = await Promise.all([
      ladeAlleSeiten<{ employee_id: string; datum: string; stunden: number | null }>(
        (von, bis) =>
          supabase
            .from("work_entries")
            .select("employee_id, datum, stunden")
            .in("employee_id", ids)
            .gte("datum", vonBis.von)
            .lte("datum", vonBis.bis)
            .order("employee_id")
            .order("datum")
            .range(von, bis)
      ),
      ladeAlleSeiten<{ employee_id: string; datum: string; betrag: number }>((von, bis) =>
        supabase
          .from("employee_vorschuss_historie")
          .select("employee_id, datum, betrag, storniert")
          .in("employee_id", ids)
          .eq("storniert", false)
          .order("employee_id")
          .order("datum")
          .range(von, bis)
      ),
    ]);

    // Je Person eine Map datum -> {stunden, vorschuss}; beide Quellen tragen
    // in dieselbe Zeile ein, damit ein Tag mit sowohl Stunden als auch einem
    // Vorschuss nicht doppelt auftaucht.
    const proPerson = new Map<string, Map<string, { stunden: number | null; vorschuss: number }>>();
    const zeile = (employeeId: string, datum: string) => {
      const m = proPerson.get(employeeId) ?? new Map<string, { stunden: number | null; vorschuss: number }>();
      proPerson.set(employeeId, m);
      const z = m.get(datum) ?? { stunden: null, vorschuss: 0 };
      m.set(datum, z);
      return z;
    };

    for (const r of stundenDaten) {
      if (r.stunden === null) continue; // nur echte Stundeneinträge, keine bloße Markierung
      zeile(r.employee_id, r.datum).stunden = r.stunden;
    }
    for (const r of vorschussDaten) {
      // advances.datum ist timestamptz, kommt also schon als vollständiger
      // ISO-Zeitstempel - direkt parsen, nicht wie ein reines Datum behandeln
      // (frührer Fehler: "T00:00:00" angehängt -> ungültiges Datum -> jede
      // Zeile wurde stillschweigend übersprungen, Vorschuss stand überall 0).
      const datumObj = new Date(r.datum);
      if (datumObj.getFullYear() !== jahr) continue; // andere Saison/Kalenderjahr
      const datum = `${datumObj.getFullYear()}-${String(datumObj.getMonth() + 1).padStart(2, "0")}-${String(datumObj.getDate()).padStart(2, "0")}`;
      const z = zeile(r.employee_id, datum);
      z.vorschuss += Number(r.betrag);
    }

    const ergebnis = ids
      .map((id) => rows.find((r) => r.employee_id === id))
      .filter((r): r is SeasonSummaryRow => !!r)
      .sort((a, b) => a.personal_nr.localeCompare(b.personal_nr, "de", { numeric: true }))
      .map((r) => {
        const tageMap = proPerson.get(r.employee_id) ?? new Map();
        const tage = [...tageMap.entries()]
          .map(([datum, w]) => ({ datum, stunden: w.stunden, vorschuss: w.vorschuss }))
          .sort((a, b) => a.datum.localeCompare(b.datum));
        return {
          employeeId: r.employee_id,
          personalNr: r.personal_nr,
          name: r.name,
          vorname: r.vorname,
          tage,
        };
      });

    setStundenVorschussLaeuft(false);
    setStundenVorschussDaten(ergebnis);
  }

  useEffect(() => {
    if (!stundenVorschussDaten) return;
    const id = setTimeout(() => window.print(), 50);
    return () => clearTimeout(id);
  }, [stundenVorschussDaten]);

  useEffect(() => {
    function handleAfterPrintStundenVorschuss() {
      setStundenVorschussDaten(null);
    }
    window.addEventListener("afterprint", handleAfterPrintStundenVorschuss);
    return () => window.removeEventListener("afterprint", handleAfterPrintStundenVorschuss);
  }, []);

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
      `Grund für die Korrektur von ${fmt(alterNetto)} € auf ${fmt(
        neuerNetto
      )} € (Netto) bei ${row.name}, ${row.vorname} (Pflichtfeld, wird protokolliert):`
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

  // Gemeinsame Sortierung für Monats-Zeilen und "fehlende" Personen -
  // Personalnummer/Gruppe numerisch, Name als Nachname, Vorname; ohne
  // Gruppe ans Ende.
  function sortiereMonat<
    T extends {
      personal_nr: string;
      name: string;
      vorname: string;
      gruppe_nr: string | null;
      herkunft?: string | null;
    }
  >(list: T[]): T[] {
    const nachName = (a: T, b: T) =>
      `${a.name}, ${a.vorname}`.localeCompare(`${b.name}, ${b.vorname}`, "de");
    return [...list].sort((a, b) => {
      if (monatSort === "personal_nr") {
        return a.personal_nr.localeCompare(b.personal_nr, "de", {
          numeric: true,
        });
      }
      if (monatSort === "gruppe") {
        const ga = a.gruppe_nr ?? "";
        const gb = b.gruppe_nr ?? "";
        if (ga !== gb) {
          if (!ga) return 1;
          if (!gb) return -1;
          return ga.localeCompare(gb, "de", { numeric: true });
        }
      }
      if (monatSort === "herkunft") {
        const ha = a.herkunft ?? "";
        const hb = b.herkunft ?? "";
        if (ha !== hb) {
          if (!ha) return 1;
          if (!hb) return -1;
          return ha.localeCompare(hb, "de");
        }
      }
      return nachName(a, b);
    });
  }

  const gefilterteMonatsRows = sortiereMonat(
    monatsRows.filter((r) => passtZurGruppe(r.gruppe_nr)).filter(passtZurSuche)
  );
  const fehlendeImMonat = sortiereMonat(
    alleAktiven.filter(
      (m) =>
        !monatsRowsById.has(m.id) &&
        passtZurGruppe(m.gruppe_nr) &&
        passtZurSuche(m)
    )
  );

  // Bereits ausgezahlte (abgerechnete) Personen - aus der Saison-Sicht, die
  // unabhängig vom Monatsfilter geladen ist. Für den Druck-Dialog "Ausge-
  // zahlte Personen mitdrucken?".
  const abgerechnetIds = new Set(
    rows.filter((r) => r.abgerechnet_am).map((r) => r.employee_id)
  );

  // Spaltensummen der Monats-Filter-Ansicht (Std., Tage, Basis-Brutto,
  // Verpflegung, Unterkunft).
  function monatsSumme(list: SeasonSummaryMonatRow[]) {
    return list.reduce(
      (acc, r) => ({
        stunden: acc.stunden + Number(r.gesamt_stunden || 0),
        tage: acc.tage + Number(r.anwesenheitstage || 0),
        basis: acc.basis + Number(r.basis_brutto || 0),
        verpflegung: acc.verpflegung + Number(r.abzug_verpflegung || 0),
        wohnen: acc.wohnen + Number(r.abzug_wohnen || 0),
      }),
      { stunden: 0, tage: 0, basis: 0, verpflegung: 0, wohnen: 0 }
    );
  }
  const summeMonatSichtbar = monatsSumme(gefilterteMonatsRows);

  return (
    <div className="flex flex-col gap-4">
      <LohnTabs />
      <div className="print:hidden">
        <PageHeader icon={Banknote} titel="Saison-Lohnübersicht" />
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

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-3 bg-sand py-2 print:hidden">
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
        {monatFilter === 0 && canEdit && (
          <button
            type="button"
            className="btn-secondary"
            disabled={ausgewaehlt.size === 0 || stundenVorschussLaeuft}
            onClick={stundenVorschussDrucken}
            title="Für die ausgewählten Personen eine nach Monaten gegliederte Stunden-/Vorschussübersicht drucken"
          >
            {stundenVorschussLaeuft
              ? "Lädt…"
              : "Stunden-/Vorschussübersicht drucken"}
          </button>
        )}
        {monatFilter === 0 && abrechnenFehler && (
          <span className="text-sm text-beere-600">{abrechnenFehler}</span>
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
                    {fmt(
                      Number(anzeige(r, "abzug_verpflegung")) +
                        Number(anzeige(r, "abzug_wohnen"))
                    )}
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
                    {(() => {
                      // Effektiver Stundenlohn "auf die Hand" (Nutzer-Vorgabe
                      // 2026-09-24) - Auszahlungsbetrag und Stunden aus
                      // derselben Quelle (live oder eingefrorener Snapshot),
                      // damit das Verhältnis in sich stimmig bleibt.
                      const betrag = Number(anzeige(r, "auszahlungsbetrag"));
                      const stunden = Number(anzeige(r, "gesamt_stunden"));
                      if (!Number.isFinite(betrag) || !(stunden > 0)) return null;
                      return (
                        <span className="ml-1 text-xs font-normal text-neutral-500">
                          ({fmt(betrag / stunden)} €/Std.)
                        </span>
                      );
                    })()}
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
                : "border-linie bg-white"
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
            <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-linie bg-white px-4 py-2 text-sm shadow-card">
                <span className="font-medium text-emerald-900">
                  Summe · {gefilterteMonatsRows.length} Pers.
                </span>
                <span>
                  Std. <strong>{fmt(summeMonatSichtbar.stunden)}</strong>
                </span>
                <span>
                  Tage <strong>{summeMonatSichtbar.tage}</strong>
                </span>
                <span>
                  Basis-Brutto{" "}
                  <strong>{fmt(summeMonatSichtbar.basis)} €</strong>
                </span>
                <span>
                  Verpflegung{" "}
                  <strong>{fmt(summeMonatSichtbar.verpflegung)} €</strong>
                </span>
                <span>
                  Unterkunft{" "}
                  <strong>{fmt(summeMonatSichtbar.wohnen)} €</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm">
                  Sortieren{" "}
                  <select
                    value={monatSort}
                    onChange={(e) =>
                      setMonatSort(
                        e.target.value as
                          | "name"
                          | "personal_nr"
                          | "gruppe"
                          | "herkunft"
                      )
                    }
                  >
                    <option value="name">Name</option>
                    <option value="personal_nr">Personalnummer</option>
                    <option value="gruppe">Gruppe</option>
                    <option value="herkunft">Herkunft</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={gefilterteMonatsRows.length === 0}
                  onClick={() => setDruckDialogOffen(true)}
                >
                  Liste drucken
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th>Gruppe</th>
                    <th>Herkunft</th>
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
                        <td className="text-sm text-neutral-500">
                          {r.herkunft ?? "—"}
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
                    <tr key={m.id} className="bg-beere-50">
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
                      <td className="text-sm text-neutral-500">
                        {m.herkunft ?? "—"}
                      </td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td className="font-medium text-beere-600">
                        ⚠ Keine Einträge
                      </td>
                    </tr>
                  ))}
                  {gefilterteMonatsRows.length === 0 &&
                    fehlendeImMonat.length === 0 && (
                      <tr>
                        <td colSpan={10} className="text-neutral-500">
                          Keine Daten für diesen Monat.
                        </td>
                      </tr>
                    )}
                </tbody>
                {gefilterteMonatsRows.length > 0 && (
                  <tfoot>
                    <tr className="font-semibold">
                      <td colSpan={4} className="text-right">
                        Summe ({gefilterteMonatsRows.length})
                      </td>
                      <td>{fmt(summeMonatSichtbar.stunden)}</td>
                      <td>{summeMonatSichtbar.tage}</td>
                      <td className={FARBE_BRUTTO_TD}>
                        {fmt(summeMonatSichtbar.basis)}
                      </td>
                      <td>{fmt(summeMonatSichtbar.verpflegung)}</td>
                      <td>{fmt(summeMonatSichtbar.wohnen)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            </>
          )}
        </div>
      )}

      {/* Druck-Dialog: Buchhaltung entscheidet, ob bereits ausgezahlte
          (abgerechnete) Personen mit auf die Liste sollen. */}
      {druckDialogOffen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden">
          <div className="w-full max-w-sm rounded-lg border border-linie bg-white p-4 shadow-card">
            <h2 className="text-base font-semibold text-emerald-900">
              Monatsliste drucken
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              {MONATSNAMEN[monatFilter - 1]} {jahr} – sollen bereits
              ausgezahlte (abgerechnete) Personen mitgedruckt werden?
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDruckDialogOffen(false)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDruckDialogOffen(false);
                  setDruckMonat({ mitAusgezahlten: false });
                }}
              >
                Nein, ohne
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDruckDialogOffen(false);
                  setDruckMonat({ mitAusgezahlten: true });
                }}
              >
                Ja, mitdrucken
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Druckansicht der Monats-Filter-Liste - nur beim Drucken sichtbar,
          genau die Spalten der Bildschirm-Tabelle plus Spaltensummen. */}
      {monatFilter !== 0 &&
        druckMonat &&
        (() => {
          const zeilen = gefilterteMonatsRows.filter(
            (r) =>
              druckMonat.mitAusgezahlten || !abgerechnetIds.has(r.employee_id)
          );
          const s = monatsSumme(zeilen);
          return (
            <div className="hidden print:block">
              <h2 className="text-xl font-semibold">
                Lohnübersicht {MONATSNAMEN[monatFilter - 1]} {jahr}
              </h2>
              <p className="mt-1 text-base">
                Datum: {formatDatumDE(new Date().toISOString())} · Personen:{" "}
                {zeilen.length}
                {gruppeFilter
                  ? ` · Gruppe: ${
                      gruppeFilter === OHNE_GRUPPE_KEY
                        ? "ohne Gruppe"
                        : `${gruppeFilter} – ${
                            gruppenByNr.get(gruppeFilter)?.bezeichnung ??
                            gruppeFilter
                          }`
                    }`
                  : ""}
                {" · "}
                {druckMonat.mitAusgezahlten
                  ? "inkl. bereits ausgezahlter Personen"
                  : "ohne bereits ausgezahlte Personen"}
                {" · sortiert nach "}
                {monatSort === "personal_nr"
                  ? "Personalnummer"
                  : monatSort === "gruppe"
                    ? "Gruppe"
                    : monatSort === "herkunft"
                      ? "Herkunft"
                      : "Name"}
              </p>
              <table className="mt-4 print-form-table print-dense-table print-persnr-schmal">
                <thead>
                  <tr>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th>Herkunft</th>
                    <th>Std.</th>
                    <th>Tage</th>
                    <th>Basis-Brutto €</th>
                    <th>Verpflegung €</th>
                    <th>Unterkunft €</th>
                    <th>Letzter Eintrag</th>
                  </tr>
                </thead>
                <tbody>
                  {zeilen.map((r) => (
                    <tr key={r.employee_id}>
                      <td>{r.personal_nr}</td>
                      <td>
                        {r.name}, {r.vorname}
                      </td>
                      <td>{r.herkunft ?? "—"}</td>
                      <td>{fmt(r.gesamt_stunden)}</td>
                      <td>{r.anwesenheitstage}</td>
                      <td>{fmt(r.basis_brutto)}</td>
                      <td>{fmt(r.abzug_verpflegung)}</td>
                      <td>{fmt(r.abzug_wohnen)}</td>
                      <td>{formatDatumDE(r.letzter_eintrag)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="text-right font-semibold">
                      Summe ({zeilen.length})
                    </td>
                    <td className="font-semibold">{fmt(s.stunden)}</td>
                    <td className="font-semibold">{s.tage}</td>
                    <td className="font-semibold">{fmt(s.basis)}</td>
                    <td className="font-semibold">{fmt(s.verpflegung)}</td>
                    <td className="font-semibold">{fmt(s.wohnen)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })()}

      {/* Druckansicht der Stunden-/Vorschussübersicht - je ausgewählter Person
          EIN kompaktes Raster (Nutzer-Vorgabe 2026-09-24: "verbraucht zu viel
          Platz", max. 1 Seite/Person): Zeile = Tag im Monat (1..31), Spalte =
          nur die Monate mit tatsächlichen Einträgen (je Monat ein schmales
          Std.- und ein €-Feld) - dadurch unabhängig von der Saisonlänge auf
          maximal ~31 Zeilen begrenzt, statt einer Zeile je Arbeitstag. */}
      {stundenVorschussDaten && (
        <div className="hidden print:block">
          {stundenVorschussDaten.map((p, i) => {
            // Je aktivem Monat eine Map Tag-im-Monat -> Werte; maxTag ist der
            // höchste vorkommende Tag über alle Monate hinweg (gemeinsame
            // Zeilenzahl fürs Raster).
            const monate = new Map<number, Map<number, { stunden: number | null; vorschuss: number }>>();
            let maxTag = 1;
            for (const t of p.tage) {
              const monat = Number(t.datum.slice(5, 7));
              const tag = Number(t.datum.slice(8, 10));
              maxTag = Math.max(maxTag, tag);
              const mMap = monate.get(monat) ?? new Map();
              monate.set(monat, mMap);
              mMap.set(tag, { stunden: t.stunden, vorschuss: t.vorschuss });
            }
            const aktiveMonate = [...monate.keys()].sort((a, b) => a - b);
            const summeStunden = p.tage.reduce((acc, t) => acc + (t.stunden ?? 0), 0);
            const summeVorschuss = p.tage.reduce((acc, t) => acc + t.vorschuss, 0);

            return (
              <div key={p.employeeId} className={i > 0 ? "print-page-break" : ""}>
                <h2 className="text-xl font-semibold">
                  Stunden-/Vorschussübersicht {jahr}
                </h2>
                <p className="mt-1 text-base">
                  {p.personalNr} · {p.name}, {p.vorname} · Datum:{" "}
                  {formatDatumDE(new Date().toISOString())}
                </p>
                {aktiveMonate.length === 0 ? (
                  <p className="mt-2 text-sm">Keine Stunden/Vorschüsse in {jahr} erfasst.</p>
                ) : (
                  <table className="mt-4 print-form-table print-dense-table print-monatsraster">
                    <thead>
                      <tr>
                        <th rowSpan={2}>Tag</th>
                        {aktiveMonate.map((m) => (
                          <th key={m} colSpan={2}>
                            {MONATSNAMEN[m - 1]}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {aktiveMonate.map((m) => (
                          <Fragment key={m}>
                            <th>Std.</th>
                            <th>€</th>
                          </Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: maxTag }, (_, i2) => i2 + 1).map((tag) => (
                        <tr key={tag}>
                          <td className="font-medium">{tag}.</td>
                          {aktiveMonate.map((m) => {
                            const w = monate.get(m)?.get(tag);
                            return (
                              <Fragment key={m}>
                                <td>{w?.stunden != null ? fmt(w.stunden) : "—"}</td>
                                <td>{w?.vorschuss ? fmt(w.vorschuss) : "—"}</td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="text-right font-semibold">Summe</td>
                        {aktiveMonate.map((m) => {
                          const werte = [...(monate.get(m)?.values() ?? [])];
                          const mStunden = werte.reduce((acc, w) => acc + (w.stunden ?? 0), 0);
                          const mVorschuss = werte.reduce((acc, w) => acc + w.vorschuss, 0);
                          return (
                            <Fragment key={m}>
                              <td className="font-semibold">{fmt(mStunden)}</td>
                              <td className="font-semibold">{fmt(mVorschuss)}</td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    </tfoot>
                  </table>
                )}
                {aktiveMonate.length > 1 && (
                  <p className="mt-1 text-right text-sm font-semibold">
                    Gesamt {jahr}: {fmt(summeStunden)} Std. · {fmt(summeVorschuss)} €
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
