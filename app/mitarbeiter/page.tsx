"use client";

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  ABRECHNUNGSART_LABELS,
  type Abrechnungsart,
  type Arbeitsgruppe,
  type Employee,
  type FuehrerscheinEintrag,
  type Herkunft,
  type PersonalKandidatChecklisteRow,
  type EmployeeLetzteAenderung,
  type SvAbschnitt,
  type SvPruefung,
  type VerpflegungsSatz,
} from "@/lib/types";
import { tageAufschluesselung } from "@/lib/svPruefung";
import {
  ANZAHL_PERSONALNUMMERN_KREISE,
  kreisBereich,
  naechsteFreieNummer,
  parsePersonalNrNummer,
} from "@/lib/personalnummern";
import { formatDatumDE, formatEuro } from "@/lib/format";
import { generiereDokument } from "@/lib/dokumentGenerator";
import PersonalTabs from "@/components/PersonalTabs";

const CURRENT_YEAR = new Date().getFullYear();

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const emptyForm = {
  personal_nr: "",
  gruppe_nr: "",
  herkunft: "",
  name: "",
  vorname: "",
  geburtsdatum: "",
  ort: "",
  land: "",
  stundenlohn: "",
  abrechnungsart: "sozialversicherungspflichtig" as Abrechnungsart,
  sozialversicherungsnummer: "",
  steuer_id: "",
  iban: "",
  bic: "",
  zahlungsempfaenger: "",
  schwarze_liste: false,
  schwarze_liste_grund: "",
};

export default function MitarbeiterPage() {
  const { profile } = useProfile();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  const [aktivSeit, setAktivSeit] = useState<Record<string, string>>({});
  const [letzteAbrechnung, setLetzteAbrechnung] = useState<
    Record<string, string>
  >({});
  const [svPruefung, setSvPruefung] = useState<Record<string, SvPruefung>>({});
  // Für die Tage-Aufschlüsselung im Tooltip bei "Rest bis 105 Tage"
  // (Nutzer-Vorgabe 2026-08-15) - ungruppiert, tageAufschluesselung()
  // filtert selbst je Person.
  const [svAbschnitte, setSvAbschnitte] = useState<SvAbschnitt[]>([]);
  const [letzteAenderung, setLetzteAenderung] = useState<
    Record<string, EmployeeLetzteAenderung>
  >({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Alle je vergebenen Personalnummern (auch inaktive Mitarbeiter, da deren
  // Nummer nicht neu vergeben wird) - für Dubletten-Warnung + "nächste freie
  // Nummer"-Hilfe.
  const [allePersonalNummern, setAllePersonalNummern] = useState<
    { personal_nr: string; name: string; vorname: string }[]
  >([]);
  const [naechsteKreis, setNaechsteKreis] = useState("1");
  // Aus employee_fuehrerschein_kategorien (schmale, breit zugängliche
  // Sicht) - zeigt nur, DASS und WOFÜR jemand einen Führerschein hat.
  // Details/Upload dazu laufen über "Personal → Dokumente".
  const [fuehrerschein, setFuehrerschein] = useState<
    Record<string, string[]>
  >({});
  // Für die Vorbelegung des Stundenlohns bei neu angelegten Personen -
  // siehe Kommentar bei der Vorbelegungs-useEffect weiter unten.
  const [verpflegungssatz, setVerpflegungssatz] =
    useState<VerpflegungsSatz | null>(null);
  // Dokumente-Status (Offen/Vollständig) aus der Anreiseliste gespiegelt -
  // nur befüllt für Personen, die aktuell dort durchlaufen (Personal →
  // Anreiseliste). "—" für alle anderen.
  const [anreiselisteStatus, setAnreiselisteStatus] = useState<
    Record<string, "offen" | "vollstaendig">
  >({});
  // Alle Mitarbeiter (auch inaktive, unabhängig vom showInactive-Filter) nur
  // mit Personalnummer - für die Verknüpfungs-Anzeige bei einem
  // Statuswechsel: die "Vorgänger"-Person ist danach inaktiv und wäre sonst
  // ggf. nicht in der aktuell gefilterten Liste enthalten.
  const [alleEmployeesById, setAlleEmployeesById] = useState<
    Record<string, { personal_nr: string; name: string; vorname: string }>
  >({});
  // Statuswechsel (z.B. sozialversicherungsfrei -> -pflichtig bei Erreichen
  // der 90-Tage-/15-Wochen-Grenze): legt eine neue, verknüpfte Person mit
  // "a" an der Personalnummer an und deaktiviert die alte - siehe
  // statuswechselDurchfuehren() weiter unten.
  const [statuswechselId, setStatuswechselId] = useState<string | null>(null);
  const [statuswechselStichtag, setStatuswechselStichtag] = useState("");
  const [statuswechselAbrechnungsart, setStatuswechselAbrechnungsart] =
    useState<Abrechnungsart>("sozialversicherungspflichtig");
  const [statuswechselLaufend, setStatuswechselLaufend] = useState(false);
  const [statuswechselFehler, setStatuswechselFehler] = useState<
    string | null
  >(null);
  // Mehrfachauswahl für "Alle Deaktivieren/Reaktivieren" - z.B. nach einem
  // Reimport, bei dem alle Personen erstmal aktiv sind (Nutzer-Vorgabe
  // 2026-08-06). Gleiches Muster wie bei den Vorschüssen: Gruppe/Herkunft
  // als Filter fügt alle passenden (aktuell sichtbaren) Personen der
  // Auswahl hinzu, zusätzlich einzeln per Checkbox in der Tabelle.
  const [bulkAusgewaehlt, setBulkAusgewaehlt] = useState<string[]>([]);
  const [bulkGruppenFilter, setBulkGruppenFilter] = useState("");
  const [bulkHerkunftFilter, setBulkHerkunftFilter] = useState("");
  const [bulkLaufend, setBulkLaufend] = useState(false);
  // Ziel-Gruppe, der die aktuelle Auswahl per "Auswahl zu Gruppe hinzufügen"
  // zugeordnet werden soll - z.B. um gruppenlose Personen oder mehrere
  // Leute auf einmal einer Gruppe zuzuordnen.
  const [bulkZielGruppe, setBulkZielGruppe] = useState("");
  // Dokumente (Arbeitsvertrag/Werkmietvertrag/Bankverbindung) direkt aus
  // dem Personalstamm generieren/(neu) drucken - unabhängig von der
  // Anreiseliste, die das nur für dort noch offen laufende Personen
  // anbietet (Nutzer-Vorgabe 2026-08-06: Nachdrucken war sonst nicht mehr
  // möglich, sobald jemand "Vollständig" ist oder nie über die
  // Personalplanung angelegt wurde).
  const [dokumenteId, setDokumenteId] = useState<string | null>(null);
  const [dokumenteVertragsbeginn, setDokumenteVertragsbeginn] = useState("");
  const [dokumenteVertragsende, setDokumenteVertragsende] = useState("");
  const [dokumenteFehler, setDokumenteFehler] = useState<string | null>(null);

  const canEdit = profile?.role === "admin" || profile?.role === "hr";
  // "Zuletzt geändert" nur für admin (Nutzer-Vorgabe 2026-08-11) - zeigt,
  // wann welcher Nutzer diesen Stammdatensatz zuletzt bearbeitet hat.
  const istAdmin = profile?.role === "admin";
  const gruppenLabel: Record<string, string> = Object.fromEntries(
    gruppen.map((g) => [g.gruppe_nr, g.bezeichnung])
  );

  const personalNrKonflikt = (() => {
    const typed = form.personal_nr.trim().toLowerCase();
    if (!typed) return null;
    const eigeneNr = editingId
      ? employees
          .find((e) => e.id === editingId)
          ?.personal_nr.trim()
          .toLowerCase()
      : null;
    if (eigeneNr && typed === eigeneNr) return null; // unverändert beim Bearbeiten
    return (
      allePersonalNummern.find(
        (r) => r.personal_nr.trim().toLowerCase() === typed
      ) ?? null
    );
  })();

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase.from("employees").select("*").order("name");
    if (!showInactive) query = query.eq("aktiv", true);
    const [
      { data, error },
      { data: ersteTage },
      { data: abrechnungen },
      { data: gruppenData },
      { data: herkunftData },
      { data: alleNrData },
      { data: svData },
      { data: svAbschnitteData },
      { data: fsData },
      { data: vSatzData },
      { data: checklisteData },
    ] = await Promise.all([
      query,
      supabase.from("employee_erster_arbeitstag").select("*"),
      supabase.from("employee_letzte_abrechnung").select("*"),
      supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
      supabase.from("herkuenfte").select("*").order("reihenfolge"),
      supabase.from("employees").select("id, personal_nr, name, vorname"),
      supabase
        .from("employee_sv_pruefung")
        .select("*")
        .eq("saison_jahr", CURRENT_YEAR),
      supabase
        .from("employee_sv_abschnitte")
        .select("*")
        .eq("saison_jahr", CURRENT_YEAR),
      supabase.from("employee_fuehrerschein_kategorien").select("*"),
      supabase
        .from("verpflegungssaetze")
        .select("*")
        .order("saison_jahr", { ascending: false })
        .limit(1),
      // Dokumente-Status aus der Anreiseliste gespiegelt (siehe Personal →
      // Anreiseliste) - live berechnet, damit hier nie ein veralteter Stand
      // stehen bleibt.
      supabase.from("personal_kandidaten_checkliste").select("*"),
    ]);
    if (!error) setEmployees((data as Employee[]) ?? []);
    const map: Record<string, string> = {};
    (ersteTage ?? []).forEach((row: { employee_id: string; erster_arbeitstag: string }) => {
      map[row.employee_id] = row.erster_arbeitstag;
    });
    setAktivSeit(map);
    const abrechnungMap: Record<string, string> = {};
    (abrechnungen ?? []).forEach(
      (row: { employee_id: string; abgerechnet_am: string }) => {
        abrechnungMap[row.employee_id] = row.abgerechnet_am;
      }
    );
    setLetzteAbrechnung(abrechnungMap);
    // Nur für admin - die Sicht ist per RLS ohnehin gesperrt, aber so wird
    // für alle anderen Rollen gar nicht erst angefragt.
    if (istAdmin) {
      const { data: aenderungen } = await supabase
        .from("employee_letzte_aenderung")
        .select("*");
      const aenderungMap: Record<string, EmployeeLetzteAenderung> = {};
      ((aenderungen as EmployeeLetzteAenderung[]) ?? []).forEach((a) => {
        aenderungMap[a.employee_id] = a;
      });
      setLetzteAenderung(aenderungMap);
    }
    setGruppen((gruppenData as Arbeitsgruppe[]) ?? []);
    setHerkuenfte((herkunftData as Herkunft[]) ?? []);
    setAllePersonalNummern(alleNrData ?? []);
    const byIdMap: Record<
      string,
      { personal_nr: string; name: string; vorname: string }
    > = {};
    (
      (alleNrData as
        | { id: string; personal_nr: string; name: string; vorname: string }[]
        | null) ?? []
    ).forEach((r) => {
      byIdMap[r.id] = {
        personal_nr: r.personal_nr,
        name: r.name,
        vorname: r.vorname,
      };
    });
    setAlleEmployeesById(byIdMap);
    const svMap: Record<string, SvPruefung> = {};
    (svData as SvPruefung[] | null ?? []).forEach((row) => {
      svMap[row.employee_id] = row;
    });
    setSvPruefung(svMap);
    setSvAbschnitte((svAbschnitteData as SvAbschnitt[]) ?? []);
    const fsMap: Record<string, string[]> = {};
    (fsData as FuehrerscheinEintrag[] | null ?? []).forEach((row) => {
      fsMap[row.employee_id] = row.fuehrerschein_kategorien;
    });
    setFuehrerschein(fsMap);
    setVerpflegungssatz(((vSatzData as VerpflegungsSatz[]) ?? [])[0] ?? null);
    const anreiseMap: Record<string, "offen" | "vollstaendig"> = {};
    ((checklisteData as PersonalKandidatChecklisteRow[]) ?? []).forEach((c) => {
      if (!c.employee_id) return;
      const vollstaendig =
        c.fragebogen_erfasst &&
        c.buskosten_erfasst &&
        c.ausweiskopie_vorhanden &&
        c.fuehrerschein_erfuellt &&
        c.hochzeitsurkunde_erfuellt &&
        c.lohnsteuerabzug_erfuellt;
      anreiseMap[c.employee_id] = vollstaendig ? "vollstaendig" : "offen";
    });
    setAnreiselisteStatus(anreiseMap);
    setLoading(false);
  }

  // Vorbelegt den Stundenlohn beim NEUANLEGEN (nicht beim Bearbeiten) mit
  // dem aktuell gültigen Mindestlohn aus den Einstellungen - bleibt weiter
  // frei änderbar. Läuft absichtlich bei jedem load() erneut (z.B. nach dem
  // Zurücksetzen des Formulars nach dem Anlegen), nicht nur beim ersten Mal.
  useEffect(() => {
    if (editingId) return;
    if (form.stundenlohn !== "") return;
    if (verpflegungssatz?.mindestlohn == null) return;
    setForm((f) => ({ ...f, stundenlohn: String(verpflegungssatz.mindestlohn) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verpflegungssatz]);

  function naechsteFreieUebernehmen() {
    const belegt = new Set<number>();
    allePersonalNummern.forEach((r) => {
      const n = parsePersonalNrNummer(r.personal_nr);
      if (n !== null) belegt.add(n);
    });
    const frei = naechsteFreieNummer(belegt, Number(naechsteKreis));
    if (frei !== null) {
      setForm((f) => ({ ...f, personal_nr: frei.toString() }));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  function startEdit(emp: Employee) {
    setEditingId(emp.id);
    setForm({
      personal_nr: emp.personal_nr,
      gruppe_nr: emp.gruppe_nr ?? "",
      herkunft: emp.herkunft ?? "",
      name: emp.name,
      vorname: emp.vorname,
      geburtsdatum: emp.geburtsdatum ?? "",
      ort: emp.ort ?? "",
      land: emp.land ?? "",
      stundenlohn: emp.stundenlohn?.toString() ?? "",
      abrechnungsart: emp.abrechnungsart ?? "sozialversicherungspflichtig",
      sozialversicherungsnummer: emp.sozialversicherungsnummer ?? "",
      steuer_id: emp.steuer_id ?? "",
      iban: emp.iban ?? "",
      bic: emp.bic ?? "",
      zahlungsempfaenger: emp.zahlungsempfaenger ?? "",
      schwarze_liste: emp.schwarze_liste ?? false,
      schwarze_liste_grund: emp.schwarze_liste_grund ?? "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    const payload = {
      personal_nr: form.personal_nr,
      gruppe_nr: form.gruppe_nr || null,
      herkunft: form.herkunft || null,
      name: form.name,
      vorname: form.vorname,
      geburtsdatum: form.geburtsdatum || null,
      ort: form.ort || null,
      land: form.land || null,
      stundenlohn: form.stundenlohn ? Number(form.stundenlohn) : null,
      abrechnungsart: form.abrechnungsart,
      sozialversicherungsnummer: form.sozialversicherungsnummer || null,
      steuer_id: form.steuer_id || null,
      iban: form.iban || null,
      bic: form.bic || null,
      zahlungsempfaenger: form.zahlungsempfaenger || null,
      schwarze_liste: form.schwarze_liste,
      schwarze_liste_grund: form.schwarze_liste ? form.schwarze_liste_grund || null : null,
      // Wer/wann gesetzt hat, nur bei tatsächlicher Änderung mitschreiben -
      // gleiches Muster wie gesperrt_von/entsperrt_von beim Monatsabschluss.
      ...(form.schwarze_liste !== (editingId
        ? employees.find((e) => e.id === editingId)?.schwarze_liste ?? false
        : false)
        ? {
            schwarze_liste_von: profile?.id ?? null,
            schwarze_liste_am: new Date().toISOString(),
          }
        : {}),
    };

    const { error } = editingId
      ? await supabase.from("employees").update(payload).eq("id", editingId)
      : await supabase.from("employees").insert(payload);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    resetForm();
    load();
  }

  async function toggleActive(emp: Employee) {
    // ADR-011: kein Löschen, nur Deaktivieren/Reaktivieren - Historie bleibt.
    const supabase = getSupabaseClient();
    await supabase
      .from("employees")
      .update({ aktiv: !emp.aktiv })
      .eq("id", emp.id);
    load();
  }

  function bulkToggle(id: string) {
    setBulkAusgewaehlt((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function bulkGruppeHinzufuegen() {
    if (!bulkGruppenFilter) return;
    const ids = filtered
      .filter((e) => e.gruppe_nr === bulkGruppenFilter)
      .map((e) => e.id);
    setBulkAusgewaehlt((prev) => Array.from(new Set([...prev, ...ids])));
  }

  function bulkHerkunftHinzufuegen() {
    if (!bulkHerkunftFilter) return;
    const ids = filtered
      .filter((e) => e.herkunft === bulkHerkunftFilter)
      .map((e) => e.id);
    setBulkAusgewaehlt((prev) => Array.from(new Set([...prev, ...ids])));
  }

  function bulkAuswahlLeeren() {
    setBulkAusgewaehlt([]);
  }

  async function bulkStatusSetzen(aktiv: boolean) {
    if (bulkAusgewaehlt.length === 0) return;
    if (
      !window.confirm(
        `${bulkAusgewaehlt.length} Person(en) wirklich ${
          aktiv ? "reaktivieren" : "deaktivieren"
        }?`
      )
    ) {
      return;
    }
    setBulkLaufend(true);
    const supabase = getSupabaseClient();
    await supabase.from("employees").update({ aktiv }).in("id", bulkAusgewaehlt);
    setBulkLaufend(false);
    setBulkAusgewaehlt([]);
    load();
  }

  async function bulkGruppeZuweisen() {
    if (bulkAusgewaehlt.length === 0) return;
    setBulkLaufend(true);
    const supabase = getSupabaseClient();
    await supabase
      .from("employees")
      .update({ gruppe_nr: bulkZielGruppe || null })
      .in("id", bulkAusgewaehlt);
    setBulkLaufend(false);
    setBulkAusgewaehlt([]);
    load();
  }

  function dokumenteStarten(emp: Employee) {
    setDokumenteId(emp.id);
    setDokumenteVertragsbeginn(emp.saison_beginn ?? "");
    setDokumenteVertragsende(emp.saison_ende ?? "");
    setDokumenteFehler(null);
  }

  function dokumenteAbbrechen() {
    setDokumenteId(null);
    setDokumenteFehler(null);
  }

  async function dokument(
    art: "arbeitsvertrag" | "werkmietvertrag" | "bankverbindung",
    emp: Employee
  ) {
    setDokumenteFehler(null);
    const dateiPrefix = `${emp.name}_${emp.vorname}`.replace(/\s+/g, "_");
    const gemeinsam = {
      Name: emp.name,
      Vorname: emp.vorname,
      Geburtsdatum: formatDatumDE(emp.geburtsdatum),
      Staatsangehoerigkeit: emp.nationalitaet ?? "",
      Personalnummer: emp.personal_nr,
    };
    try {
      if (art === "arbeitsvertrag") {
        await generiereDokument(
          "Arbeitsvertrag_Vorlage.docx",
          {
            ...gemeinsam,
            ArbeitsbeginnDatum: formatDatumDE(dokumenteVertragsbeginn),
            ArbeitsendeDatum: formatDatumDE(dokumenteVertragsende),
            Stundenlohn: formatEuro(emp.stundenlohn),
          },
          `Arbeitsvertrag_${dateiPrefix}.docx`
        );
      } else if (art === "werkmietvertrag") {
        await generiereDokument(
          "Werkmietvertrag_Vorlage.docx",
          {
            ...gemeinsam,
            TagessatzWohnen: formatEuro(verpflegungssatz?.wohnen),
            TagessatzVerpflegung: formatEuro(verpflegungssatz?.verpflegung),
          },
          `Werkmietvertrag_${dateiPrefix}.docx`
        );
      } else {
        await generiereDokument(
          "Bankverbindung_Vorlage.docx",
          {
            Vorname: emp.vorname,
            Name: emp.name,
            Personalnummer: emp.personal_nr,
            Kontoinhaber: emp.zahlungsempfaenger ?? "",
            IBAN: emp.iban ?? "",
            BIC: emp.bic ?? "",
          },
          `Bankverbindung_${dateiPrefix}.docx`
        );
      }
    } catch (err) {
      setDokumenteFehler(err instanceof Error ? err.message : String(err));
    }
  }

  function statuswechselStarten(emp: Employee) {
    setStatuswechselId(emp.id);
    setStatuswechselStichtag(todayIso());
    setStatuswechselAbrechnungsart("sozialversicherungspflichtig");
    setStatuswechselFehler(null);
  }

  function statuswechselAbbrechen() {
    setStatuswechselId(null);
    setStatuswechselFehler(null);
  }

  // Legt eine neue, mit der bestehenden Person verknüpfte Person mit "a" an
  // der Personalnummer an (z.B. bei Erreichen der 90-Tage-/15-Wochen-
  // Grenze: sozialversicherungsfrei -> -pflichtig). Stunden/Boni/Vorschüsse
  // bleiben strikt getrennt, weil sie technisch an die jeweilige
  // Personalnummer hängen - ergibt zwei komplett getrennte Zeilen in der
  // Lohnübersicht mit je eigener Netto-Berechnung passend zur jeweiligen
  // Abrechnungsart. Hochgeladene Dokumente wandern zur neuen Nummer mit
  // (dieselben Dokumente derselben Person), die alte Nummer wird wie bei
  // "Deaktivieren" nur deaktiviert, nicht gelöscht (ADR-011).
  async function statuswechselDurchfuehren() {
    const alt = employees.find((e) => e.id === statuswechselId);
    if (!alt) return;
    if (!statuswechselStichtag) {
      setStatuswechselFehler(
        "Bitte einen Stichtag angeben - ab diesem Datum werden die Stunden auf die neue Personalnummer übertragen."
      );
      return;
    }
    const neuePersonalNr = `${alt.personal_nr}a`;
    const konflikt = allePersonalNummern.find(
      (r) => r.personal_nr.trim().toLowerCase() === neuePersonalNr.toLowerCase()
    );
    if (konflikt) {
      setStatuswechselFehler(
        `Personalnummer "${neuePersonalNr}" ist bereits vergeben an ${konflikt.name}, ${konflikt.vorname}`
      );
      return;
    }
    setStatuswechselLaufend(true);
    setStatuswechselFehler(null);
    const supabase = getSupabaseClient();

    // Erst prüfen, ob der zu übertragende Zeitraum einen per Monatsabschluss
    // gesperrten Monat trifft - dann wird gar keine neue Personalnummer
    // angelegt (Nutzer-Vorgabe 2026-08-11: Statuswechsel bei gesperrtem
    // Monat komplett verweigern, nicht nur teilweise durchführen).
    const { data: gesperrterMonat, error: pruefFehler } = await supabase.rpc(
      "statuswechsel_gesperrter_monat",
      { p_employee_id: alt.id, p_stichtag: statuswechselStichtag }
    );
    if (pruefFehler) {
      setStatuswechselFehler(pruefFehler.message);
      setStatuswechselLaufend(false);
      return;
    }
    if (gesperrterMonat) {
      setStatuswechselFehler(
        `Monat ${gesperrterMonat} ist bereits per Monatsabschluss gesperrt - bitte zuerst unter „Stundenerfassung" entsperren, bevor der Statuswechsel durchgeführt wird.`
      );
      setStatuswechselLaufend(false);
      return;
    }

    const { data: neu, error: insertError } = await supabase
      .from("employees")
      .insert({
        personal_nr: neuePersonalNr,
        gruppe_nr: alt.gruppe_nr,
        herkunft: alt.herkunft,
        nationalitaet: alt.nationalitaet,
        name: alt.name,
        vorname: alt.vorname,
        geburtsdatum: alt.geburtsdatum,
        ort: alt.ort,
        land: alt.land,
        sozialversicherungsnummer: alt.sozialversicherungsnummer,
        steuer_id: alt.steuer_id,
        iban: alt.iban,
        bic: alt.bic,
        zahlungsempfaenger: alt.zahlungsempfaenger,
        stundenlohn: alt.stundenlohn,
        abrechnungsart: statuswechselAbrechnungsart,
        saison_beginn: statuswechselStichtag || null,
        saison_ende: alt.saison_ende,
        schwarze_liste: alt.schwarze_liste ?? false,
        schwarze_liste_grund: alt.schwarze_liste_grund ?? null,
        vorgaenger_employee_id: alt.id,
        aktiv: true,
      })
      .select("id")
      .single();

    if (insertError || !neu) {
      setStatuswechselFehler(insertError?.message ?? "unbekannter Fehler");
      setStatuswechselLaufend(false);
      return;
    }

    // Stunden AB DEM STICHTAG auf die neue Nummer übertragen (Nutzer-
    // Vorgabe 2026-08-11): ab dem Stichtag gilt die neue Abrechnungsart,
    // die Stunden müssen deshalb mitwandern, damit sie korrekt abgerechnet
    // werden. Vorschüsse und Prämien bleiben bewusst UNBERÜHRT - sie hängen
    // an der Auszahlung, nicht am Beschäftigungszeitraum. Die Funktion
    // prüft den gesperrten Monat sicherheitshalber noch einmal selbst
    // (Race Condition zwischen der Prüfung oben und hier ist mit einer
    // manuellen Admin-Aktion praktisch ausgeschlossen, aber nicht
    // unmöglich) - schlägt sie fehl, existiert die neue Personalnummer
    // zwar schon, aber noch ganz ohne Stunden; einfach den gemeldeten
    // Monat entsperren und den Statuswechsel-Dialog erneut mit demselben
    // Stichtag ausführen.
    const { data: uebertragen, error: uebertragFehler } = await supabase.rpc(
      "statuswechsel_stunden_uebertragen",
      {
        p_alt_employee_id: alt.id,
        p_neu_employee_id: neu.id,
        p_stichtag: statuswechselStichtag,
      }
    );
    if (uebertragFehler) {
      setStatuswechselFehler(
        `Neue Personalnummer ${neuePersonalNr} wurde angelegt, aber die Stunden konnten nicht übertragen werden: ${uebertragFehler.message}`
      );
      setStatuswechselLaufend(false);
      load();
      return;
    }

    // Hochgeladene Dokumente (Ausweiskopie etc.) auf die neue Nummer
    // umhängen - dieselben Dokumente derselben Person, kein Duplizieren.
    await supabase
      .from("employee_documents")
      .update({ employee_id: neu.id })
      .eq("employee_id", alt.id);

    await supabase.from("employees").update({ aktiv: false }).eq("id", alt.id);

    setStatuswechselLaufend(false);
    setStatuswechselId(null);
    window.alert(
      `Statuswechsel abgeschlossen: ${uebertragen ?? 0} Tag(e) mit Stunden auf ${neuePersonalNr} übertragen.`
    );
    load();
  }

  // Rückwärts-Suche: welche Person hat DIESE Person als Vorgänger (also:
  // wer ist die "Nachfolge"-Nummer)? Aus der aktuell geladenen Liste
  // berechnet - reicht aus, da eine frisch angelegte Nachfolge-Person immer
  // aktiv ist und damit unabhängig vom showInactive-Filter geladen wird.
  const nachfolgerMap: Record<
    string,
    { personal_nr: string; name: string; vorname: string }
  > = {};
  employees.forEach((e) => {
    if (e.vorgaenger_employee_id) nachfolgerMap[e.vorgaenger_employee_id] = e;
  });

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return (
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q)
    );
  });

  // Ausgelagert, damit dasselbe Formular sowohl oben (Neuanlegen) als auch
  // - beim Bearbeiten - direkt unter der betroffenen Zeile in der Tabelle
  // gerendert werden kann (Nutzer-Wunsch: nicht mehr nach oben scrollen
  // müssen, um die eigene Bearbeitung zu sehen).
  function mitarbeiterFormular() {
    return (
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-2 gap-3 rounded border border-neutral-200 bg-white p-4 sm:grid-cols-4"
      >
          <div className="col-span-2 flex flex-col gap-1">
            <div className="flex gap-2">
              <input
                placeholder="Personalnummer"
                required
                value={form.personal_nr}
                onChange={(e) =>
                  setForm({ ...form, personal_nr: e.target.value })
                }
              />
              {!editingId && (
                <>
                  <select
                    value={naechsteKreis}
                    onChange={(e) => setNaechsteKreis(e.target.value)}
                  >
                    {Array.from(
                      { length: ANZAHL_PERSONALNUMMERN_KREISE },
                      (_, i) => i + 1
                    ).map((k) => {
                      const [von, bis] = kreisBereich(k);
                      return (
                        <option key={k} value={k}>
                          Kreis {k} ({von}-{bis})
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    className="btn-secondary whitespace-nowrap text-xs"
                    onClick={naechsteFreieUebernehmen}
                  >
                    Nächste freie Nr.
                  </button>
                </>
              )}
            </div>
            {personalNrKonflikt && (
              <span className="text-xs text-red-600">
                Bereits vergeben an {personalNrKonflikt.name},{" "}
                {personalNrKonflikt.vorname}
              </span>
            )}
          </div>
          <select
            value={form.gruppe_nr}
            onChange={(e) => setForm({ ...form, gruppe_nr: e.target.value })}
          >
            <option value="">— keine Gruppe —</option>
            {gruppen.map((g) => (
              <option key={g.gruppe_nr} value={g.gruppe_nr}>
                {g.gruppe_nr} – {g.bezeichnung}
              </option>
            ))}
          </select>
          <select
            value={form.herkunft}
            onChange={(e) => setForm({ ...form, herkunft: e.target.value })}
          >
            <option value="">— keine Herkunft —</option>
            {herkuenfte.map((h) => (
              <option key={h.wert} value={h.wert}>
                {h.wert}
              </option>
            ))}
          </select>
          <input
            placeholder="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="Vorname"
            required
            value={form.vorname}
            onChange={(e) => setForm({ ...form, vorname: e.target.value })}
          />
          <input
            type="date"
            placeholder="Geburtsdatum"
            value={form.geburtsdatum}
            onChange={(e) =>
              setForm({ ...form, geburtsdatum: e.target.value })
            }
          />
          <input
            placeholder="Ort"
            value={form.ort}
            onChange={(e) => setForm({ ...form, ort: e.target.value })}
          />
          <input
            placeholder="Land"
            value={form.land}
            onChange={(e) => setForm({ ...form, land: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Stundenlohn €"
            value={form.stundenlohn}
            onChange={(e) =>
              setForm({ ...form, stundenlohn: e.target.value })
            }
          />
          <select
            value={form.abrechnungsart}
            onChange={(e) =>
              setForm({
                ...form,
                abrechnungsart: e.target.value as Abrechnungsart,
              })
            }
          >
            {Object.entries(ABRECHNUNGSART_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            placeholder="Sozialversicherungsnummer"
            value={form.sozialversicherungsnummer}
            onChange={(e) =>
              setForm({ ...form, sozialversicherungsnummer: e.target.value })
            }
          />
          <input
            placeholder="Steuer-ID"
            value={form.steuer_id}
            onChange={(e) => setForm({ ...form, steuer_id: e.target.value })}
          />
          <input
            placeholder="IBAN"
            value={form.iban}
            onChange={(e) => setForm({ ...form, iban: e.target.value })}
          />
          <input
            placeholder="BIC"
            value={form.bic}
            onChange={(e) => setForm({ ...form, bic: e.target.value })}
          />
          <input
            placeholder="Zahlungsempfänger"
            value={form.zahlungsempfaenger}
            onChange={(e) =>
              setForm({ ...form, zahlungsempfaenger: e.target.value })
            }
          />
          <div className="col-span-full flex flex-col gap-1 rounded border border-red-200 bg-red-50 p-2">
            <label className="flex items-center gap-2 text-sm font-medium text-red-800">
              <input
                type="checkbox"
                checked={form.schwarze_liste}
                onChange={(e) =>
                  setForm({ ...form, schwarze_liste: e.target.checked })
                }
              />
              Schwarze Liste – nicht mehr erwünscht
            </label>
            {form.schwarze_liste && (
              <input
                placeholder="Grund (wird bei Verknüpfung in der Personalplanung angezeigt)"
                value={form.schwarze_liste_grund}
                onChange={(e) =>
                  setForm({ ...form, schwarze_liste_grund: e.target.value })
                }
              />
            )}
          </div>
          <div className="col-span-full flex gap-2">
            <button
              type="submit"
              className="btn"
              disabled={saving || !!personalNrKonflikt}
            >
              {editingId ? "Speichern" : "Anlegen"}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn-secondary"
                onClick={resetForm}
              >
                Abbrechen
              </button>
            )}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
      </form>
    );
  }

  // Ebenfalls ausgelagert - wird direkt unter der betroffenen Zeile
  // gerendert (siehe Kommentar bei mitarbeiterFormular oben).
  function statuswechselFormular(statuswechselPerson: Employee) {
    return (
      <div className="flex flex-col gap-3 rounded border border-emerald-300 bg-emerald-50 p-4">
          <h2 className="text-sm font-semibold text-emerald-800">
            Statuswechsel für {statuswechselPerson.name},{" "}
            {statuswechselPerson.vorname} ({statuswechselPerson.personal_nr})
          </h2>
          <p className="text-xs text-neutral-600">
            Legt eine neue, verknüpfte Person mit der Personalnummer „
            {statuswechselPerson.personal_nr}a" an und deaktiviert{" "}
            {statuswechselPerson.personal_nr}. Stunden AB DEM STICHTAG werden
            auf die neue Nummer übertragen (sie unterliegen dann der neuen
            Abrechnungsart), Stunden davor bleiben an{" "}
            {statuswechselPerson.personal_nr} stehen. Vorschüsse und
            Prämien/Boni bleiben unverändert bei {statuswechselPerson.personal_nr} -
            sie hängen an der Auszahlung, nicht am Beschäftigungszeitraum.
            Liegt im zu übertragenden Zeitraum ein per Monatsabschluss
            gesperrter Monat, wird der Statuswechsel verweigert.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Stichtag (ab wann die neue Nummer gilt)
              <input
                type="date"
                value={statuswechselStichtag}
                onChange={(e) => setStatuswechselStichtag(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Neue Abrechnungsart
              <select
                value={statuswechselAbrechnungsart}
                onChange={(e) =>
                  setStatuswechselAbrechnungsart(
                    e.target.value as Abrechnungsart
                  )
                }
              >
                {Object.entries(ABRECHNUNGSART_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              disabled={statuswechselLaufend || !statuswechselStichtag}
              onClick={statuswechselDurchfuehren}
            >
              Statuswechsel durchführen
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={statuswechselAbbrechen}
            >
              Abbrechen
            </button>
            {statuswechselFehler && (
              <span className="text-sm text-red-600">
                {statuswechselFehler}
              </span>
            )}
          </div>
      </div>
    );
  }

  // Ebenfalls ausgelagert - Dokumente (Neu-)Drucken direkt aus dem
  // Personalstamm, unabhängig von der Anreiseliste (siehe Kommentar bei
  // dokumenteId oben).
  function dokumenteFormular(emp: Employee) {
    return (
      <div className="flex flex-col gap-3 rounded border border-neutral-300 bg-neutral-50 p-4">
        <h2 className="text-sm font-semibold text-emerald-800">
          Dokumente für {emp.name}, {emp.vorname} ({emp.personal_nr})
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
            Vertragsbeginn (für Arbeitsvertrag)
            <input
              type="date"
              value={dokumenteVertragsbeginn}
              onChange={(e) => setDokumenteVertragsbeginn(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
            Vertragsende (für Arbeitsvertrag)
            <input
              type="date"
              value={dokumenteVertragsende}
              onChange={(e) => setDokumenteVertragsende(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => dokument("arbeitsvertrag", emp)}
          >
            Arbeitsvertrag
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => dokument("werkmietvertrag", emp)}
          >
            Werkmietvertrag
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => dokument("bankverbindung", emp)}
          >
            Bankverbindung
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={dokumenteAbbrechen}
          >
            Schließen
          </button>
        </div>
        {dokumenteFehler && (
          <span className="text-sm text-red-600">{dokumenteFehler}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Personal</h1>
        <p className="text-sm text-neutral-500">
          Stammdaten der Mitarbeiter. Löschen ist nicht möglich - Personen
          werden bei Bedarf deaktiviert, die Historie bleibt erhalten.
        </p>
      </div>

      {canEdit && !editingId && mitarbeiterFormular()}

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex items-center gap-3 bg-neutral-50 py-2">
        <input
          placeholder="Suche nach Name oder Personalnummer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          inaktive anzeigen
        </label>
      </div>

      {canEdit && (
        <div className="flex flex-col gap-2 rounded border border-neutral-200 bg-white p-3">
          <p className="text-sm font-medium">
            Mehrfachauswahl (z.B. für "Alle Deaktivieren" nach einem
            Reimport):
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              value={bulkGruppenFilter}
              onChange={(e) => setBulkGruppenFilter(e.target.value)}
            >
              <option value="">Gruppe wählen…</option>
              {gruppen.map((g) => (
                <option key={g.gruppe_nr} value={g.gruppe_nr}>
                  {g.gruppe_nr} – {g.bezeichnung}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary whitespace-nowrap text-xs"
              onClick={bulkGruppeHinzufuegen}
            >
              Gruppe zur Auswahl hinzufügen
            </button>
            <select
              value={bulkHerkunftFilter}
              onChange={(e) => setBulkHerkunftFilter(e.target.value)}
            >
              <option value="">Herkunft wählen…</option>
              {herkuenfte.map((h) => (
                <option key={h.wert} value={h.wert}>
                  {h.wert}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary whitespace-nowrap text-xs"
              onClick={bulkHerkunftHinzufuegen}
            >
              Herkunft zur Auswahl hinzufügen
            </button>
          </div>
          {bulkAusgewaehlt.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-emerald-800">
                {bulkAusgewaehlt.length} ausgewählt
              </span>
              <button
                type="button"
                className="btn-danger text-xs"
                disabled={bulkLaufend}
                onClick={() => bulkStatusSetzen(false)}
              >
                Alle Deaktivieren
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={bulkLaufend}
                onClick={() => bulkStatusSetzen(true)}
              >
                Alle Reaktivieren
              </button>
              <select
                value={bulkZielGruppe}
                onChange={(e) => setBulkZielGruppe(e.target.value)}
              >
                <option value="">— keine Gruppe —</option>
                {gruppen.map((g) => (
                  <option key={g.gruppe_nr} value={g.gruppe_nr}>
                    {g.gruppe_nr} – {g.bezeichnung}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={bulkLaufend}
                onClick={bulkGruppeZuweisen}
              >
                Auswahl zu Gruppe hinzufügen
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={bulkAuswahlLeeren}
              >
                Auswahl leeren
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <table>
          <thead>
            <tr>
              {canEdit && <th></th>}
              <th>Pers.-Nr.</th>
              <th>Gruppe</th>
              <th>Herkunft</th>
              <th>Name</th>
              <th>Vorname</th>
              <th>Ort</th>
              <th>€/Std.</th>
              <th>Abrechnungsart</th>
              <th title="Allererster erfasster Arbeitstag dieser Person - folgt bei einem Statuswechsel (neue Personalnummer) der Vorgänger-Kette zurück, springt also nicht künstlich auf den Wechsel-Stichtag">
                Aktiv seit
              </th>
              <th title="Letzter bekannter Abrechnungszeitpunkt - entweder eine echte 'Jetzt Abrechnen'-Aktion in der App, oder ein manuell nachgetragener historischer Zeitpunkt (siehe Personal → Sozialversicherung → Abschnitts-Historie)">
                Zuletzt abgerechnet am
              </th>
              <th title="15 Wochen = 105 Kalendertage je Kalenderjahr. Summe aller Beschäftigungsabschnitte bei uns (Pausen zählen nicht mit) plus gemeldete Vorbeschäftigung bei anderen deutschen Arbeitgebern.">
                Rest bis 105 Tage
              </th>
              <th title="Das frühere von 15-Wochen-Ende und dem Ende des SV-freien Zeitraums laut Angaben (Personal → Sozialversicherung).">
                Austrittsdatum (empfohlen)
              </th>
              <th>SV-Status</th>
              <th>Führerschein</th>
              <th>Status</th>
              <th>Dokumente</th>
              <th>Verknüpfung</th>
              <th>Schwarze Liste</th>
              {istAdmin && (
                <th title="Letzte Änderung am Stammdatensatz dieser Person - vollständige Historie unter „Protokoll“">
                  Zuletzt geändert
                </th>
              )}
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp) => {
              const sv = svPruefung[emp.id];
              const fs = fuehrerschein[emp.id];
              return (
              <Fragment key={emp.id}>
              <tr className={emp.aktiv ? "" : "opacity-50"}>
                {canEdit && (
                  <td>
                    <input
                      type="checkbox"
                      checked={bulkAusgewaehlt.includes(emp.id)}
                      onChange={() => bulkToggle(emp.id)}
                    />
                  </td>
                )}
                <td>{emp.personal_nr}</td>
                <td>
                  {emp.gruppe_nr
                    ? `${emp.gruppe_nr} – ${
                        gruppenLabel[emp.gruppe_nr] ?? "?"
                      }`
                    : "—"}
                </td>
                <td>{emp.herkunft ?? "—"}</td>
                <td>{emp.name}</td>
                <td>{emp.vorname}</td>
                <td>{emp.ort}</td>
                <td>{emp.stundenlohn?.toFixed(2)}</td>
                <td>{ABRECHNUNGSART_LABELS[emp.abrechnungsart]}</td>
                <td>{formatDatumDE(aktivSeit[emp.id])}</td>
                <td>{formatDatumDE(letzteAbrechnung[emp.id])}</td>
                <td
                  title={sv ? tageAufschluesselung(sv, svAbschnitte) : undefined}
                >
                  {sv ? (
                    <>
                      {sv.rest_bis_105_tage}
                      {(sv.vorbeschaeftigung_deutschland_tage > 0 ||
                        sv.anzahl_abschnitte > 1) && (
                        <span className="ml-1 text-xs text-amber-600">*</span>
                      )}
                    </>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td>{sv ? formatDatumDE(sv.austrittsdatum_empfohlen) : "—"}</td>
                <td>
                  {sv ? (
                    sv.kritisch ? (
                      <span className="font-medium text-red-600">
                        ⚠ Überschritten
                      </span>
                    ) : (
                      <span className="text-emerald-700">OK</span>
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {fs && fs.length > 0 ? (
                    <span className="text-emerald-700">{fs.join(", ")}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{emp.aktiv ? "aktiv" : "inaktiv"}</td>
                <td>
                  {anreiselisteStatus[emp.id] === "vollstaendig" ? (
                    <span className="font-medium text-emerald-700">
                      Vollständig
                    </span>
                  ) : anreiselisteStatus[emp.id] === "offen" ? (
                    <span className="font-medium text-amber-700">Offen</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="text-xs">
                  {emp.vorgaenger_employee_id &&
                    alleEmployeesById[emp.vorgaenger_employee_id] && (
                      <div>
                        ← {alleEmployeesById[emp.vorgaenger_employee_id].personal_nr}
                      </div>
                    )}
                  {nachfolgerMap[emp.id] && (
                    <div>→ {nachfolgerMap[emp.id].personal_nr}</div>
                  )}
                  {!emp.vorgaenger_employee_id && !nachfolgerMap[emp.id] && "—"}
                </td>
                <td>
                  {emp.schwarze_liste ? (
                    <span
                      className="font-medium text-red-600"
                      title={emp.schwarze_liste_grund ?? undefined}
                    >
                      ⚠ Ja
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                {istAdmin && (
                  <td className="text-xs">
                    {letzteAenderung[emp.id] ? (
                      <>
                        {formatDatumDE(letzteAenderung[emp.id].occurred_at)}
                        <div className="text-neutral-500">
                          {letzteAenderung[emp.id].actor_name ?? "System"}
                        </div>
                      </>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                )}
                {canEdit && (
                  <td className="flex gap-2">
                    <button
                      className="btn-secondary"
                      onClick={() => startEdit(emp)}
                    >
                      Bearbeiten
                    </button>
                    <button
                      className={emp.aktiv ? "btn-danger" : "btn-secondary"}
                      onClick={() => toggleActive(emp)}
                    >
                      {emp.aktiv ? "Deaktivieren" : "Reaktivieren"}
                    </button>
                    {emp.aktiv &&
                      emp.abrechnungsart !== "sozialversicherungspflichtig" && (
                        <button
                          className="btn-secondary"
                          onClick={() => statuswechselStarten(emp)}
                        >
                          Statuswechsel
                        </button>
                      )}
                    <button
                      className="btn-secondary"
                      onClick={() => dokumenteStarten(emp)}
                    >
                      Dokumente
                    </button>
                  </td>
                )}
              </tr>
              {editingId === emp.id && (
                <tr>
                  <td colSpan={istAdmin ? 23 : 22}>{mitarbeiterFormular()}</td>
                </tr>
              )}
              {statuswechselId === emp.id && (
                <tr>
                  <td colSpan={istAdmin ? 23 : 22}>{statuswechselFormular(emp)}</td>
                </tr>
              )}
              {dokumenteId === emp.id && (
                <tr>
                  <td colSpan={istAdmin ? 23 : 22}>{dokumenteFormular(emp)}</td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
