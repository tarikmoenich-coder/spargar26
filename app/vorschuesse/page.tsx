"use client";

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type {
  Advance,
  AdvanceRecipientDetail,
  Arbeitsgruppe,
  Employee,
  FirmenBankdaten,
  Herkunft,
} from "@/lib/types";
import LohnTabs from "@/components/LohnTabs";
import { erzeugeSepaXml, sepaDateiHerunterladen } from "@/lib/sepa";

function heuteIsoDatum() {
  return new Date().toISOString().slice(0, 10);
}

function monatsSchluessel(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${mm}-${d.getFullYear()}`;
}

const MONATSNAMEN = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

interface AusgewaehltePerson {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  betrag: string;
  // Nur bei Zahlungsart "BÜ" (Überweisung) relevant - aus den
  // Personalstammdaten vorbefüllt, aber änderbar (Nutzer-Vorgabe
  // 2026-08-14: "zwingend immer abgefragt").
  zahlungsempfaenger: string;
  iban: string;
  bic: string;
}

interface Beleg {
  belegnummer: string;
  datum: string;
  zahlungsart: string;
  art: string;
  storniert: boolean;
  begruendung: string | null;
  uebergeben_an: string | null;
  beleg_dateiname: string | null;
  empfaenger: AdvanceRecipientDetail[];
}

const VORSCHUSS_BUCKET = "vorschuss-belege";

interface BelastungOffen {
  id: number;
  betrag: number;
  employee_id: string;
  mangel_id: number;
  employees: { vorname: string; name: string; personal_nr: string } | null;
  unterkunft_mangel: {
    beschreibung: string;
    unterkunft_zimmer: {
      nummer: string;
      art: string;
      unterkunft_gebaeude: { name: string } | null;
    } | null;
  } | null;
}

export default function VorschuessePage() {
  const { profile } = useProfile();
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  const [loading, setLoading] = useState(true);

  const [basisBetrag, setBasisBetrag] = useState("");
  const [zahlungsart, setZahlungsart] = useState("BAR");
  // Vorschussart (Nutzer-Vorgabe 2026-08-18): "Strafe/Rechnung" ist auf
  // genau eine Person beschränkt und braucht einen Beleg-Upload, siehe
  // handleSubmit.
  const [art, setArt] = useState<"Vorschuss" | "Strafe/Rechnung">("Vorschuss");
  const [belegDatei, setBelegDatei] = useState<File | null>(null);
  const [begruendung, setBegruendung] = useState("");
  // Person (z.B. Gruppenleiter), die das Geld zur Verteilung an die
  // einzelnen Empfänger bekommt - erscheint auf dem separaten
  // Übergabe-Beleg beim Drucken.
  const [uebergebenAn, setUebergebenAn] = useState("");
  const [ausgewaehlt, setAusgewaehlt] = useState<AusgewaehltePerson[]>([]);
  const [gruppenFilter, setGruppenFilter] = useState("");
  const [herkunftFilter, setHerkunftFilter] = useState("");
  const [suche, setSuche] = useState("");
  const [jahrFilter, setJahrFilter] = useState<number | "alle">("alle");
  const [monatFilter, setMonatFilter] = useState<number | "alle">("alle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Nutzer-Vorgabe 2026-08-24: bei den gerade ausgewählten Personen sehen,
  // wann sie den letzten Vorschuss bekommen haben und wie viel insgesamt -
  // damit sich vor der Bestätigung schnell einschätzen lässt, ob ein
  // weiterer Vorschuss angemessen ist. Nur nicht-stornierte Vorschüsse
  // zählen mit.
  const [vorschussHistorie, setVorschussHistorie] = useState<
    Record<string, { letztesDatum: string | null; summe: number }>
  >({});

  const [letzterBeleg, setLetzterBeleg] = useState<Beleg | null>(null);
  const [druckBeleg, setDruckBeleg] = useState<Beleg | null>(null);

  // Offene Belastungs-Vorschläge aus dem Reparaturen-Board (Unterkunft-Modul).
  // Erst nach Bestätigung hier entsteht ein Vorschuss (Strafe/Rechnung).
  const [belastungOffen, setBelastungOffen] = useState<BelastungOffen[]>([]);
  const [belastungLaeuft, setBelastungLaeuft] = useState<number | null>(null);

  // SEPA-Überweisungsdatei (Nutzer-Vorgabe 2026-08-25): Auftraggeber-Konto
  // kommt aus den Einstellungen (firmen_bankdaten), Zahlungsdatum ist frei
  // wählbar (Standard: heute).
  const [firmenBankdaten, setFirmenBankdaten] =
    useState<FirmenBankdaten | null>(null);
  const [sepaDatum, setSepaDatum] = useState(heuteIsoDatum());
  const [sepaFehler, setSepaFehler] = useState<string | null>(null);

  // Nachträgliche Korrektur eines bereits bestätigten Vorschuss-Betrags.
  const [bearbeitenAdvanceId, setBearbeitenAdvanceId] = useState<
    number | null
  >(null);
  const [bearbeitenEmpfaenger, setBearbeitenEmpfaenger] = useState<
    AdvanceRecipientDetail[]
  >([]);
  const [korrekturBetraege, setKorrekturBetraege] = useState<
    Record<string, string>
  >({});
  const [korrekturLaeuft, setKorrekturLaeuft] = useState<string | null>(null);

  const canWrite = profile?.role === "admin" || profile?.role === "kasse";
  // Deckt sich mit der RLS-Policy "advance_recipients_rw" - management sieht
  // zwar die Vorschuss-Liste, aber keine Empfänger-Details.
  const canSeeDetails =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "kasse" ||
    profile?.role === "lohnabrechnung" ||
    profile?.role === "pruefer";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [
      { data: adv },
      { data: emp },
      { data: gr },
      { data: hk },
      { data: bankdaten },
    ] = await Promise.all([
      supabase
        .from("advances")
        .select("*")
        .order("datum", { ascending: false })
        .limit(100),
      supabase
        .from("employees")
        .select(
          "id, personal_nr, name, vorname, aktiv, gruppe_nr, herkunft, zahlungsempfaenger, iban, bic"
        )
        .eq("aktiv", true)
        .order("name"),
      supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
      supabase.from("herkuenfte").select("*").order("reihenfolge"),
      // Kein Fehler, falls RLS den Zugriff verweigert (nicht admin/kasse) -
      // dann bleibt firmenBankdaten einfach null und der SEPA-Button prüft
      // das selbst ab.
      supabase.from("firmen_bankdaten").select("*").eq("id", 1).maybeSingle(),
    ]);
    setAdvances((adv as Advance[]) ?? []);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    setHerkuenfte((hk as Herkunft[]) ?? []);
    setFirmenBankdaten((bankdaten as FirmenBankdaten) ?? null);
    await ladeBelastungen();
    setLoading(false);
  }

  async function ladeBelastungen() {
    const { data } = await getSupabaseClient()
      .from("unterkunft_belastung")
      .select(
        "id, betrag, employee_id, mangel_id, " +
          "employees(vorname, name, personal_nr), " +
          "unterkunft_mangel(beschreibung, unterkunft_zimmer(nummer, art, unterkunft_gebaeude(name)))"
      )
      .eq("status", "offen")
      .order("erstellt_am", { ascending: true });
    setBelastungOffen((data as unknown as BelastungOffen[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  // Nutzer-Vorgabe 2026-08-24: Vorschuss-Historie (letztes Datum + Summe)
  // für genau die aktuell ausgewählten Personen nachladen - eigene Abfrage
  // statt aus der bereits geladenen (auf 100 Belege begrenzten) advances-
  // Liste abzuleiten, damit auch ältere Vorschüsse mitzählen.
  const ausgewaehlteIds = ausgewaehlt.map((p) => p.employee_id).join(",");
  useEffect(() => {
    if (!ausgewaehlteIds) {
      setVorschussHistorie({});
      return;
    }
    async function ladeHistorie() {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("advance_recipients")
        .select("employee_id, anteil, advances!inner(datum, storniert)")
        .in("employee_id", ausgewaehlteIds.split(","))
        .eq("advances.storniert", false);
      const map: Record<string, { letztesDatum: string | null; summe: number }> =
        {};
      ((data as any[]) ?? []).forEach((row) => {
        const eintrag = map[row.employee_id] ?? {
          letztesDatum: null,
          summe: 0,
        };
        eintrag.summe += Number(row.anteil ?? 0);
        const datum = row.advances?.datum as string | undefined;
        if (datum && (!eintrag.letztesDatum || datum > eintrag.letztesDatum)) {
          eintrag.letztesDatum = datum;
        }
        map[row.employee_id] = eintrag;
      });
      setVorschussHistorie(map);
    }
    ladeHistorie();
  }, [ausgewaehlteIds]);

  // Nach dem Öffnen des Druckdialogs (oder Abbruch) Druckauswahl zurücksetzen.
  useEffect(() => {
    function handleAfterPrint() {
      setDruckBeleg(null);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  useEffect(() => {
    if (druckBeleg === null) return;
    const id = setTimeout(() => window.print(), 50);
    return () => clearTimeout(id);
  }, [druckBeleg]);

  function istAusgewaehlt(id: string) {
    return ausgewaehlt.some((p) => p.employee_id === id);
  }

  function personZuEintrag(emp: Employee): AusgewaehltePerson {
    return {
      employee_id: emp.id,
      personal_nr: emp.personal_nr,
      name: emp.name,
      vorname: emp.vorname,
      betrag: basisBetrag || "0",
      zahlungsempfaenger: emp.zahlungsempfaenger ?? "",
      iban: emp.iban ?? "",
      bic: emp.bic ?? "",
    };
  }

  function personHinzufuegen(emp: Employee) {
    if (istAusgewaehlt(emp.id)) return;
    // Strafe/Rechnung: genau eine Person (Nutzer-Vorgabe 2026-08-18) - eine
    // neue Auswahl ersetzt die bisherige, statt sie zu ergänzen.
    if (art === "Strafe/Rechnung") {
      setAusgewaehlt([personZuEintrag(emp)]);
      return;
    }
    setAusgewaehlt((prev) => [...prev, personZuEintrag(emp)]);
  }

  function personEntfernen(id: string) {
    setAusgewaehlt((prev) => prev.filter((p) => p.employee_id !== id));
  }

  function toggleEinzeln(emp: Employee) {
    if (istAusgewaehlt(emp.id)) personEntfernen(emp.id);
    else personHinzufuegen(emp);
  }

  function gruppeHinzufuegen() {
    if (!gruppenFilter) return;
    employees
      .filter((e) => e.gruppe_nr === gruppenFilter)
      .forEach(personHinzufuegen);
  }

  function herkunftHinzufuegen() {
    if (!herkunftFilter) return;
    employees
      .filter((e) => e.herkunft === herkunftFilter)
      .forEach(personHinzufuegen);
  }

  function betragAendern(id: string, wert: string) {
    setAusgewaehlt((prev) =>
      prev.map((p) => (p.employee_id === id ? { ...p, betrag: wert } : p))
    );
  }

  function bankfeldAendern(
    id: string,
    feld: "zahlungsempfaenger" | "iban" | "bic",
    wert: string
  ) {
    setAusgewaehlt((prev) =>
      prev.map((p) => (p.employee_id === id ? { ...p, [feld]: wert } : p))
    );
  }

  function basisBetragAufAlleAnwenden() {
    setAusgewaehlt((prev) => prev.map((p) => ({ ...p, betrag: basisBetrag || "0" })));
  }

  function auswahlLeeren() {
    setAusgewaehlt([]);
  }

  const summeAusgewaehlt = ausgewaehlt.reduce(
    (sum, p) => sum + (Number(p.betrag) || 0),
    0
  );

  function empfaengerTextAus(personen: AusgewaehltePerson[]) {
    const namen = personen.map((p) => `${p.name}, ${p.vorname}`);
    if (namen.length <= 6) return namen.join(" · ");
    return `${namen.slice(0, 3).join(" · ")} + ${namen.length - 3} weitere`;
  }

  const gefilterteEmployees = employees.filter((e) => {
    const q = suche.toLowerCase();
    return (
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q)
    );
  });

  const jahreOptionen = Array.from(
    new Set(advances.map((a) => new Date(a.datum).getFullYear()))
  ).sort((a, b) => b - a);

  const advancesGefiltert = advances.filter((a) => {
    const d = new Date(a.datum);
    if (jahrFilter !== "alle" && d.getFullYear() !== jahrFilter) return false;
    if (monatFilter !== "alle" && d.getMonth() + 1 !== monatFilter) return false;
    return true;
  });

  // --- Belastungen aus Reparaturen ---------------------------------------
  function belastungLabel(b: BelastungOffen) {
    const z = b.unterkunft_mangel?.unterkunft_zimmer;
    const geb = z?.unterkunft_gebaeude?.name ?? "?";
    const raum =
      z == null
        ? "Zimmer ?"
        : z.art === "zimmer"
          ? `Zimmer ${z.nummer}`
          : z.nummer;
    return `${geb} · ${raum}: ${b.unterkunft_mangel?.beschreibung ?? "Reparatur"}`;
  }

  async function belastungBestaetigen(b: BelastungOffen) {
    setBelastungLaeuft(b.id);
    setError(null);
    const supabase = getSupabaseClient();
    const { data: belegnummer, error: belegError } = await supabase.rpc(
      "naechste_belegnummer",
      { prefix_monat: monatsSchluessel(new Date()) }
    );
    if (belegError) {
      setError(belegError.message);
      setBelastungLaeuft(null);
      return;
    }
    const person = b.employees
      ? `${b.employees.name}, ${b.employees.vorname}`
      : "";
    const { data: inserted, error: insErr } = await supabase
      .from("advances")
      .insert({
        belegnummer,
        betrag: b.betrag,
        empfaenger_text: person,
        begruendung: `Reparatur-Belastung – ${belastungLabel(
          b
        )} (Nachweis: Unterkunft-Modul)`,
        zahlungsart: "N/A",
        art: "Strafe/Rechnung",
      })
      .select()
      .single();
    if (insErr) {
      setError(insErr.message);
      setBelastungLaeuft(null);
      return;
    }
    const { error: recErr } = await supabase
      .from("advance_recipients")
      .insert({
        advance_id: inserted.id,
        employee_id: b.employee_id,
        anteil: b.betrag,
      });
    if (recErr) {
      setError(recErr.message);
      setBelastungLaeuft(null);
      return;
    }
    const { error: updErr } = await supabase
      .from("unterkunft_belastung")
      .update({
        status: "bestaetigt",
        advance_id: inserted.id,
        bestaetigt_von: profile?.id ?? null,
        bestaetigt_am: new Date().toISOString(),
      })
      .eq("id", b.id);
    if (updErr) {
      setError(
        `Vorschuss gebucht, aber Belastung nicht als bestätigt markiert: ${updErr.message}`
      );
    }
    setBelastungLaeuft(null);
    await load();
  }

  async function belastungAblehnen(b: BelastungOffen) {
    if (!window.confirm("Diese Belastung ablehnen? Es entsteht kein Vorschuss."))
      return;
    setBelastungLaeuft(b.id);
    setError(null);
    const { error: e } = await getSupabaseClient()
      .from("unterkunft_belastung")
      .update({
        status: "abgelehnt",
        bestaetigt_von: profile?.id ?? null,
        bestaetigt_am: new Date().toISOString(),
      })
      .eq("id", b.id);
    if (e) setError(e.message);
    setBelastungLaeuft(null);
    await ladeBelastungen();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (ausgewaehlt.length === 0) {
      setError("Bitte mindestens eine Person auswählen.");
      return;
    }
    if (ausgewaehlt.some((p) => !(Number(p.betrag) > 0))) {
      setError("Bitte für jede ausgewählte Person einen Betrag > 0 eintragen.");
      return;
    }
    // Nutzer-Vorgabe 2026-08-18: Strafe/Rechnung nur für genau eine Person,
    // mit Pflicht-Beleg (Strafzettel/Rechnung).
    if (art === "Strafe/Rechnung") {
      if (ausgewaehlt.length !== 1) {
        setError(
          "Strafe/Rechnung kann nur für genau eine Person erfasst werden."
        );
        return;
      }
      if (!belegDatei) {
        setError(
          "Bitte den zugehörigen Beleg (Strafzettel/Rechnung) hochladen."
        );
        return;
      }
    }
    // Kein Geld fließt bei Strafe/Rechnung (siehe schema.sql) - zahlungsart
    // 'N/A' statt der ausgewählten BAR/BÜ, damit diese Belege korrekt aus
    // dem physischen Kassenbestand herausfallen.
    const effektiveZahlungsart = art === "Strafe/Rechnung" ? "N/A" : zahlungsart;
    // Nutzer-Vorgabe 2026-08-14: bei Überweisung sind Zahlungsempfänger/
    // IBAN/BIC zwingend erforderlich - kein Beleg ohne vollständige
    // Kontodaten.
    if (
      effektiveZahlungsart === "BÜ" &&
      ausgewaehlt.some(
        (p) => !p.zahlungsempfaenger.trim() || !p.iban.trim() || !p.bic.trim()
      )
    ) {
      setError(
        "Bitte für jede ausgewählte Person Zahlungsempfänger, IBAN und BIC eintragen."
      );
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();

    // Belegnummer wird serverseitig atomar vergeben (ADR-010), damit
    // gleichzeitige Erfassung durch mehrere Nutzer keine Duplikate erzeugt.
    const { data: belegnummer, error: belegError } = await supabase.rpc(
      "naechste_belegnummer",
      { prefix_monat: monatsSchluessel(new Date()) }
    );
    if (belegError) {
      setError(belegError.message);
      setSaving(false);
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("advances")
      .insert({
        belegnummer,
        betrag: summeAusgewaehlt,
        empfaenger_text: empfaengerTextAus(ausgewaehlt),
        begruendung,
        uebergeben_an: art === "Strafe/Rechnung" ? null : uebergebenAn || null,
        zahlungsart: effektiveZahlungsart,
        art,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    const { error: recipientsError } = await supabase
      .from("advance_recipients")
      .insert(
        ausgewaehlt.map((p) => ({
          advance_id: inserted.id,
          employee_id: p.employee_id,
          anteil: Number(p.betrag),
          // Nur bei Überweisung befüllt - Schnappschuss der Kontodaten
          // zum Erfassungszeitpunkt, siehe advance_recipients in schema.sql.
          zahlungsempfaenger:
            effektiveZahlungsart === "BÜ" ? p.zahlungsempfaenger : null,
          iban: effektiveZahlungsart === "BÜ" ? p.iban : null,
          bic: effektiveZahlungsart === "BÜ" ? p.bic : null,
        }))
      );

    if (recipientsError) {
      setError(recipientsError.message);
      setSaving(false);
      return;
    }

    // Beleg-Upload erst NACH dem Anlegen der advances-Zeile, da der Pfad die
    // erzeugte id enthält (wie personal-dokumente, nur umgekehrt bezogen -
    // hier gehört der Beleg zum Beleg selbst, nicht zu einem Mitarbeiter).
    let belegDateinameGespeichert: string | null = null;
    if (art === "Strafe/Rechnung" && belegDatei) {
      const pfad = `${inserted.id}/${Date.now()}_${belegDatei.name}`;
      const { error: uploadError } = await supabase.storage
        .from(VORSCHUSS_BUCKET)
        .upload(pfad, belegDatei);
      if (uploadError) {
        setError(
          `Vorschuss erfasst, aber Beleg-Upload fehlgeschlagen: ${uploadError.message}`
        );
        setSaving(false);
        load();
        return;
      }
      const { error: belegUpdateError } = await supabase
        .from("advances")
        .update({ beleg_storage_path: pfad, beleg_dateiname: belegDatei.name })
        .eq("id", inserted.id);
      if (belegUpdateError) {
        setError(
          `Vorschuss erfasst, aber Beleg konnte nicht verknüpft werden: ${belegUpdateError.message}`
        );
      } else {
        belegDateinameGespeichert = belegDatei.name;
      }
    }

    setLetzterBeleg({
      belegnummer,
      datum: inserted.datum,
      zahlungsart: effektiveZahlungsart,
      art,
      storniert: false,
      begruendung: begruendung || null,
      uebergeben_an: art === "Strafe/Rechnung" ? null : uebergebenAn || null,
      beleg_dateiname: belegDateinameGespeichert,
      empfaenger: ausgewaehlt.map((p) => ({
        employee_id: p.employee_id,
        personal_nr: p.personal_nr,
        name: p.name,
        vorname: p.vorname,
        anteil: Number(p.betrag),
        zahlungsempfaenger:
          effektiveZahlungsart === "BÜ" ? p.zahlungsempfaenger : null,
        iban: effektiveZahlungsart === "BÜ" ? p.iban : null,
        bic: effektiveZahlungsart === "BÜ" ? p.bic : null,
      })),
    });

    setBasisBetrag("");
    setBegruendung("");
    setUebergebenAn("");
    setAusgewaehlt([]);
    setBelegDatei(null);
    setSaving(false);
    load();
  }

  async function belegAnsehen(pfad: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(VORSCHUSS_BUCKET)
      .createSignedUrl(pfad, 60);
    if (error || !data) {
      window.alert("Beleg konnte nicht geöffnet werden.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function storno(adv: Advance) {
    const grund = window.prompt(
      "Begründung für die Stornierung (Pflichtfeld, wird protokolliert):"
    );
    if (!grund) return;
    const supabase = getSupabaseClient();
    const { data, error: stornoError } = await supabase
      .from("advances")
      .update({
        storniert: true,
        storno_grund: grund,
        storniert_am: new Date().toISOString(),
      })
      .eq("id", adv.id)
      .select("id");
    if (stornoError) {
      setError(stornoError.message);
    } else if (!data || data.length === 0) {
      // RLS lässt die Zeile still ungeändert, wenn sie zu einer bereits
      // freigegebenen Kassenprüfung gehört (siehe ist_kassenpruefung_gesperrt
      // in schema.sql) - ohne diese Prüfung würde der Button scheinbar
      // wirkungslos bleiben.
      setError(
        "Dieser Beleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr storniert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen."
      );
    }
    load();
  }

  async function belegDrucken(adv: Advance) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("advance_recipients")
      .select(
        "employee_id, anteil, zahlungsempfaenger, iban, bic, employees(personal_nr, name, vorname)"
      )
      .eq("advance_id", adv.id);
    if (error || !data) return;
    const empfaenger: AdvanceRecipientDetail[] = data.map((row: any) => ({
      employee_id: row.employee_id,
      personal_nr: row.employees?.personal_nr ?? "",
      name: row.employees?.name ?? "",
      vorname: row.employees?.vorname ?? "",
      anteil: Number(row.anteil ?? 0),
      zahlungsempfaenger: row.zahlungsempfaenger,
      iban: row.iban,
      bic: row.bic,
    }));
    setDruckBeleg({
      belegnummer: adv.belegnummer,
      datum: adv.datum,
      zahlungsart: adv.zahlungsart,
      art: adv.art,
      storniert: adv.storniert,
      begruendung: adv.begruendung,
      uebergeben_an: adv.uebergeben_an,
      beleg_dateiname: adv.beleg_dateiname,
      empfaenger,
    });
  }

  // SEPA-Überweisungsdatei erstellen (Nutzer-Vorgabe 2026-08-25): eine
  // Zahlung je Empfänger dieses Belegs, Verwendungszweck exakt
  // "[Belegnummer], [Nachname], [Vorname]" wie vom Nutzer vorgegeben. Bricht
  // mit einer klaren Fehlermeldung ab statt Empfänger ohne IBAN/BIC
  // stillschweigend zu überspringen - sonst würde eine Person unbemerkt
  // nicht bezahlt.
  function sepaErstellen(beleg: Beleg) {
    setSepaFehler(null);
    if (!firmenBankdaten?.iban || !firmenBankdaten?.bic) {
      setSepaFehler(
        "Bitte zuerst IBAN/BIC von Mömmel Agrar unter Einstellungen hinterlegen."
      );
      return;
    }
    const ohneIban = beleg.empfaenger.filter((p) => !p.iban || !p.bic);
    if (ohneIban.length > 0) {
      setSepaFehler(
        `Fehlende IBAN/BIC bei: ${ohneIban
          .map((p) => `${p.name}, ${p.vorname}`)
          .join("; ")} - bitte zuerst im Personalstamm nachtragen.`
      );
      return;
    }
    const xml = erzeugeSepaXml(
      {
        name: firmenBankdaten.name,
        iban: firmenBankdaten.iban,
        bic: firmenBankdaten.bic,
      },
      beleg.empfaenger.map((p) => ({
        employeeId: p.employee_id,
        name: p.zahlungsempfaenger || `${p.vorname} ${p.name}`,
        iban: p.iban as string,
        bic: p.bic as string,
        betrag: p.anteil,
        verwendungszweck: `${beleg.belegnummer}, ${p.name}, ${p.vorname}`,
      })),
      sepaDatum,
      beleg.belegnummer
    );
    sepaDateiHerunterladen(xml, `SEPA_${beleg.belegnummer}_${sepaDatum}.xml`);
  }

  async function toggleBearbeiten(adv: Advance) {
    if (bearbeitenAdvanceId === adv.id) {
      setBearbeitenAdvanceId(null);
      return;
    }
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("advance_recipients")
      .select("employee_id, anteil, employees(personal_nr, name, vorname)")
      .eq("advance_id", adv.id);
    if (error || !data) return;
    const empfaenger: AdvanceRecipientDetail[] = data.map((row: any) => ({
      employee_id: row.employee_id,
      personal_nr: row.employees?.personal_nr ?? "",
      name: row.employees?.name ?? "",
      vorname: row.employees?.vorname ?? "",
      anteil: Number(row.anteil ?? 0),
    }));
    setBearbeitenEmpfaenger(empfaenger);
    setKorrekturBetraege(
      Object.fromEntries(empfaenger.map((p) => [p.employee_id, String(p.anteil)]))
    );
    setBearbeitenAdvanceId(adv.id);
  }

  async function betragKorrigieren(
    advanceId: number,
    p: AdvanceRecipientDetail
  ) {
    const neuerWert = korrekturBetraege[p.employee_id];
    const neuerBetrag = Number(neuerWert);
    if (!neuerWert || !(neuerBetrag > 0)) return;
    if (neuerBetrag === p.anteil) return; // keine Änderung
    const hinweis = window.prompt(
      `Grund für die Korrektur von ${p.anteil.toFixed(2)} € auf ${neuerBetrag.toFixed(
        2
      )} € bei ${p.name}, ${p.vorname} (Pflichtfeld, wird protokolliert):`
    );
    if (!hinweis) return;

    setKorrekturLaeuft(p.employee_id);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("vorschuss_korrigieren", {
      p_advance_id: advanceId,
      p_employee_id: p.employee_id,
      p_neuer_betrag: neuerBetrag,
      p_hinweis: hinweis,
    });
    setKorrekturLaeuft(null);
    if (error) {
      window.alert(`Korrektur fehlgeschlagen: ${error.message}`);
      return;
    }
    setBearbeitenAdvanceId(null);
    load();
  }

  const anzeigeBeleg = druckBeleg ?? letzterBeleg;

  return (
    <div className="flex flex-col gap-6">
      <LohnTabs />
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">Vorschüsse</h1>
        <p className="text-sm text-neutral-500">
          Einzeln, gruppenweise oder nach Herkunft auswählen. Bestätigte
          Vorschüsse werden nicht gelöscht, sondern storniert - die
          Belegnummer und Historie bleiben nachvollziehbar.
        </p>
      </div>

      {canSeeDetails && belastungOffen.length > 0 && (
        <section className="rounded border border-amber-300 bg-amber-50 p-4 print:hidden">
          <h2 className="font-semibold text-amber-900">
            Belastungen aus Reparaturen – zur Bestätigung ({belastungOffen.length})
          </h2>
          <p className="mt-0.5 text-sm text-amber-800">
            Anteilige Reparaturkosten (vom Bewohner verschuldet). Erst mit
            „Bestätigen" entsteht ein Vorschuss (Strafe/Rechnung) und der Betrag
            wird vom Lohn abgezogen.
          </p>
          <ul className="mt-2 divide-y divide-amber-200">
            {belastungOffen.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="font-medium">
                  {b.employees
                    ? `${b.employees.vorname} ${b.employees.name}`
                    : b.employee_id}
                </span>
                <span className="font-semibold tabular-nums text-red-700">
                  {b.betrag.toFixed(2)} €
                </span>
                <span className="text-neutral-600">{belastungLabel(b)}</span>
                {canWrite && (
                  <span className="ml-auto flex gap-2">
                    <button
                      className="btn"
                      disabled={belastungLaeuft === b.id}
                      onClick={() => belastungBestaetigen(b)}
                    >
                      {belastungLaeuft === b.id ? "…" : "Bestätigen"}
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={belastungLaeuft === b.id}
                      onClick={() => belastungAblehnen(b)}
                    >
                      Ablehnen
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!canWrite && (
            <p className="mt-2 text-xs text-amber-700">
              Bestätigen kann nur admin / kasse.
            </p>
          )}
        </section>
      )}

      {canWrite && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded border border-neutral-200 bg-white p-4 print:hidden"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input
              type="number"
              step="0.01"
              placeholder="Betrag € pro Person"
              value={basisBetrag}
              onChange={(e) => setBasisBetrag(e.target.value)}
            />
            <select
              value={art}
              onChange={(e) => {
                setArt(e.target.value as "Vorschuss" | "Strafe/Rechnung");
                // Auswahl zurücksetzen - vermeidet eine Mehrfachauswahl, die
                // beim Wechsel zu Strafe/Rechnung (genau eine Person) nicht
                // mehr gültig wäre.
                setAusgewaehlt([]);
                setBelegDatei(null);
              }}
            >
              <option value="Vorschuss">Vorschuss</option>
              <option value="Strafe/Rechnung">Strafe/Rechnung</option>
            </select>
            {art !== "Strafe/Rechnung" && (
              <select
                value={zahlungsart}
                onChange={(e) => setZahlungsart(e.target.value)}
              >
                <option value="BAR">BAR</option>
                <option value="BÜ">Überweisung (BÜ)</option>
              </select>
            )}
            {art !== "Strafe/Rechnung" && <div className="col-span-1" />}

            {art === "Strafe/Rechnung" && (
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-sm font-medium">
                  Beleg (Strafzettel/Rechnung) - Pflicht
                </label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) =>
                    setBelegDatei(e.target.files?.[0] ?? null)
                  }
                />
                {belegDatei && (
                  <p className="text-xs text-neutral-500">
                    Ausgewählt: {belegDatei.name}
                  </p>
                )}
              </div>
            )}

            {art !== "Strafe/Rechnung" && (
              <>
                <div className="col-span-2 flex gap-2">
                  <select
                    value={gruppenFilter}
                    onChange={(e) => setGruppenFilter(e.target.value)}
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
                    onClick={gruppeHinzufuegen}
                  >
                    Gruppe hinzufügen
                  </button>
                </div>
                <div className="col-span-2 flex gap-2">
                  <select
                    value={herkunftFilter}
                    onChange={(e) => setHerkunftFilter(e.target.value)}
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
                    onClick={herkunftHinzufuegen}
                  >
                    Herkunft hinzufügen
                  </button>
                </div>
              </>
            )}
          </div>
          {art === "Strafe/Rechnung" && (
            <p className="text-xs text-neutral-500">
              Strafe/Rechnung ist auf genau eine Person beschränkt, da der
              Beleg zu einer bestimmten Person gehört - unten einzeln
              auswählen.
            </p>
          )}

          <div>
            <p className="mb-1 text-sm font-medium">
              Einzeln hinzufügen (Suche nach Name oder Personalnummer):
            </p>
            <input
              placeholder="Suchen…"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              className="mb-2 w-72"
            />
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded border border-neutral-100 p-2">
              {gefilterteEmployees.map((emp) => (
                <label
                  key={emp.id}
                  className="flex items-center gap-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={istAusgewaehlt(emp.id)}
                    onChange={() => toggleEinzeln(emp)}
                  />
                  {emp.personal_nr} {emp.name}, {emp.vorname}
                </label>
              ))}
            </div>
          </div>

          {ausgewaehlt.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium">
                  Ausgewählt: {ausgewaehlt.length} Person(en), Summe:{" "}
                  {summeAusgewaehlt.toFixed(2)} €
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={basisBetragAufAlleAnwenden}
                  >
                    Betrag auf alle anwenden
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={auswahlLeeren}
                  >
                    Auswahl leeren
                  </button>
                </div>
              </div>
              {art !== "Strafe/Rechnung" && zahlungsart === "BÜ" && (
                <p className="mb-2 text-xs text-neutral-500">
                  Bei Überweisung sind Zahlungsempfänger, IBAN und BIC
                  Pflichtangaben - aus den Personalstammdaten vorbefüllt,
                  bei Bedarf änderbar. Erscheinen mit auf dem Belegdruck.
                </p>
              )}
              <table>
                <thead>
                  <tr>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th title="Datum des letzten nicht stornierten Vorschusses dieser Person (über alle Belege, nicht nur die letzten 100)">
                      Letzter Vorschuss
                    </th>
                    <th title="Summe aller nicht stornierten Vorschüsse dieser Person insgesamt">
                      Bisher insgesamt €
                    </th>
                    {art !== "Strafe/Rechnung" && zahlungsart === "BÜ" && (
                      <>
                        <th>Zahlungsempfänger</th>
                        <th>IBAN</th>
                        <th>BIC</th>
                      </>
                    )}
                    <th>Betrag €</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ausgewaehlt.map((p) => {
                    const historie = vorschussHistorie[p.employee_id];
                    return (
                    <tr key={p.employee_id}>
                      <td>{p.personal_nr}</td>
                      <td>
                        {p.name}, {p.vorname}
                      </td>
                      <td className="text-sm">
                        {historie?.letztesDatum
                          ? new Date(historie.letztesDatum).toLocaleDateString(
                              "de-DE"
                            )
                          : "—"}
                      </td>
                      <td className="text-sm">
                        {(historie?.summe ?? 0).toFixed(2)}
                      </td>
                      {art !== "Strafe/Rechnung" && zahlungsart === "BÜ" && (
                        <>
                          <td>
                            <input
                              className="w-40"
                              value={p.zahlungsempfaenger}
                              onChange={(e) =>
                                bankfeldAendern(
                                  p.employee_id,
                                  "zahlungsempfaenger",
                                  e.target.value
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="w-44"
                              value={p.iban}
                              onChange={(e) =>
                                bankfeldAendern(
                                  p.employee_id,
                                  "iban",
                                  e.target.value
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="w-28"
                              value={p.bic}
                              onChange={(e) =>
                                bankfeldAendern(
                                  p.employee_id,
                                  "bic",
                                  e.target.value
                                )
                              }
                            />
                          </td>
                        </>
                      )}
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          className="w-24"
                          value={p.betrag}
                          onChange={(e) =>
                            betragAendern(p.employee_id, e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => personEntfernen(p.employee_id)}
                        >
                          Entfernen
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <input
            placeholder="Begründung (optional)"
            value={begruendung}
            onChange={(e) => setBegruendung(e.target.value)}
          />

          {/* Nur bei BAR sinnvoll - bei Überweisung wird kein Bargeld an
              eine dritte Person zur Verteilung übergeben (Nutzer-Vorgabe
              2026-08-14). Bei Strafe/Rechnung ebenfalls nicht sinnvoll -
              kein Bargeld fließt (Nutzer-Vorgabe 2026-08-18). */}
          {art !== "Strafe/Rechnung" && zahlungsart === "BAR" && (
            <div className="flex flex-col gap-1">
              <input
                placeholder="Übergeben an (optional, z.B. Gruppenleiter)"
                value={uebergebenAn}
                onChange={(e) => setUebergebenAn(e.target.value)}
              />
              <p className="text-xs text-neutral-500">
                Falls jemand das Geld zur Verteilung an die einzelnen
                Empfänger bekommt: erscheint auf dem separaten
                Übergabe-Beleg beim Drucken (siehe unten).
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="submit" className="btn" disabled={saving}>
              Vorschuss bestätigen
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      )}

      {letzterBeleg && (
        <div className="flex flex-col gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 print:hidden">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-emerald-800">
              Beleg {letzterBeleg.belegnummer} erfasst, Summe{" "}
              {letzterBeleg.empfaenger
                .reduce((s, p) => s + p.anteil, 0)
                .toFixed(2)}{" "}
              €.
            </span>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setDruckBeleg(letzterBeleg)}
            >
              Auszahlungsliste drucken
            </button>
            {/* Nur bei Banküberweisung sinnvoll - bei Bar/Strafe-Rechnung
                fließt kein Geld per SEPA (Nutzer-Vorgabe 2026-08-25). */}
            {letzterBeleg.zahlungsart === "BÜ" && (
              <>
                <label className="text-xs text-emerald-800">
                  Zahlungsdatum{" "}
                  <input
                    type="date"
                    value={sepaDatum}
                    onChange={(e) => setSepaDatum(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => sepaErstellen(letzterBeleg)}
                >
                  SEPA-Datei erstellen
                </button>
              </>
            )}
          </div>
          {sepaFehler && (
            <span className="text-sm text-red-600">{sepaFehler}</span>
          )}
        </div>
      )}

      {!loading && advances.length > 0 && (
        <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-3 bg-neutral-50 py-2 print:hidden">
          <label className="text-sm">
            Jahr{" "}
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
            {advancesGefiltert.length} von {advances.length} Beleg(en)
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500 print:hidden">Lädt…</p>
      ) : advances.length === 0 ? (
        <p className="text-neutral-500 print:hidden">
          Noch keine Vorschüsse erfasst.
        </p>
      ) : advancesGefiltert.length === 0 ? (
        <p className="text-neutral-500 print:hidden">
          Keine Vorschüsse für diesen Filter.
        </p>
      ) : (
        <table className="print:hidden">
          <thead>
            <tr>
              <th>Beleg-Nr.</th>
              <th>Datum</th>
              <th>Betrag €</th>
              <th>Empfänger</th>
              <th>Begründung</th>
              <th>Art</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {advancesGefiltert.map((a) => (
              <Fragment key={a.id}>
                <tr className={a.storniert ? "opacity-50" : ""}>
                  <td>{a.belegnummer}</td>
                  <td>{new Date(a.datum).toLocaleString("de-DE")}</td>
                  <td>{Number(a.betrag).toFixed(2)}</td>
                  <td>{a.empfaenger_text}</td>
                  <td>{a.begruendung}</td>
                  <td>{a.art === "Strafe/Rechnung" ? a.art : a.zahlungsart}</td>
                  <td>{a.storniert ? `storniert: ${a.storno_grund}` : "aktiv"}</td>
                  <td className="flex gap-2">
                    {canSeeDetails && a.beleg_storage_path && (
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => belegAnsehen(a.beleg_storage_path!)}
                      >
                        Beleg ansehen
                      </button>
                    )}
                    {canSeeDetails && (
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => belegDrucken(a)}
                      >
                        Drucken
                      </button>
                    )}
                    {canWrite && !a.storniert && (
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => toggleBearbeiten(a)}
                      >
                        {bearbeitenAdvanceId === a.id ? "Schließen" : "Bearbeiten"}
                      </button>
                    )}
                    {canWrite && !a.storniert && (
                      <button
                        className="btn-danger text-xs"
                        onClick={() => storno(a)}
                      >
                        Stornieren
                      </button>
                    )}
                  </td>
                </tr>
                {bearbeitenAdvanceId === a.id && (
                  <tr>
                    <td colSpan={8} className="bg-neutral-50">
                      <p className="mb-2 text-xs text-neutral-500">
                        Betrag ändern und auf „Speichern" klicken - Grund wird
                        abgefragt und protokolliert (wer, wann, Differenz).
                        Wirkt sich sofort auf den Kassenbestand aus.
                      </p>
                      <table>
                        <thead>
                          <tr>
                            <th>Pers.-Nr.</th>
                            <th>Name</th>
                            <th>Betrag €</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {bearbeitenEmpfaenger.map((p) => (
                            <tr key={p.employee_id}>
                              <td>{p.personal_nr}</td>
                              <td>
                                {p.name}, {p.vorname}
                              </td>
                              <td>
                                <input
                                  type="number"
                                  step="0.01"
                                  className="w-24"
                                  value={korrekturBetraege[p.employee_id] ?? ""}
                                  onChange={(e) =>
                                    setKorrekturBetraege((prev) => ({
                                      ...prev,
                                      [p.employee_id]: e.target.value,
                                    }))
                                  }
                                  disabled={korrekturLaeuft === p.employee_id}
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-secondary text-xs"
                                  disabled={korrekturLaeuft === p.employee_id}
                                  onClick={() => betragKorrigieren(a.id, p)}
                                >
                                  Speichern
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {/* Druckblätter - nur im Druck sichtbar. Bei Überweisung (BÜ) ein
          eigenständiges, einseitiges Layout mit Kontodaten je Person
          (Nutzer-Vorgabe 2026-08-14) - kein Bargeld wechselt den Besitzer,
          daher weder Erhalt- noch Übergabe-Unterschriften, sondern eine
          Bestätigung JEDER Person, dass ihre eigenen Kontodaten korrekt
          sind, VOR Ausführung der Überweisung. Bei BAR wie bisher zwei
          Blätter: 1) Mitarbeiter-Unterschriftenliste (Erhalt, ohne Summe),
          2) Übergabe-Beleg (nur falls "Übergeben an" ausgefüllt ist). */}
      {anzeigeBeleg && anzeigeBeleg.zahlungsart === "BÜ" && (
        <div className="hidden print:block">
          <h2 className="text-xl font-semibold">
            Vorschuss-Überweisung{anzeigeBeleg.storniert ? " (STORNIERT)" : ""}
          </h2>
          <p className="mt-1 text-base">
            Belegnummer: {anzeigeBeleg.belegnummer} · Datum:{" "}
            {new Date(anzeigeBeleg.datum).toLocaleDateString("de-DE")} ·
            Überweisung
          </p>
          <p className="text-base">
            Begründung: {anzeigeBeleg.begruendung || "-"}
          </p>
          <p className="mt-1 text-sm">
            Mit der Unterschrift bestätigt die jeweilige Person, dass die
            eigenen Kontodaten korrekt sind - die Überweisung wird erst
            danach ausgeführt.
          </p>
          <table className="mt-4 print-form-table">
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Zahlungsempfänger</th>
                <th>IBAN / BIC</th>
                <th>Betrag €</th>
                <th>Kontodaten korrekt, Unterschrift</th>
              </tr>
            </thead>
            <tbody>
              {anzeigeBeleg.empfaenger.map((p) => (
                <tr key={p.employee_id}>
                  <td>{p.personal_nr}</td>
                  <td>
                    {p.name}, {p.vorname}
                  </td>
                  <td>{p.zahlungsempfaenger || "-"}</td>
                  <td>
                    {p.iban || "-"}
                    <br />
                    <span className="text-xs">{p.bic || "-"}</span>
                  </td>
                  <td>{p.anteil.toFixed(2)}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right font-semibold">
                  Summe
                </td>
                <td className="font-semibold">
                  {anzeigeBeleg.empfaenger
                    .reduce((s, p) => s + p.anteil, 0)
                    .toFixed(2)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {anzeigeBeleg && anzeigeBeleg.zahlungsart !== "BÜ" && (
        <div className="hidden print:block">
          <h2 className="text-xl font-semibold">
            {anzeigeBeleg.art === "Strafe/Rechnung"
              ? "Strafe/Rechnung"
              : "Vorschuss-Auszahlung"}
            {anzeigeBeleg.storniert ? " (STORNIERT)" : ""}
          </h2>
          <p className="mt-1 text-base">
            Belegnummer: {anzeigeBeleg.belegnummer} · Datum:{" "}
            {new Date(anzeigeBeleg.datum).toLocaleDateString("de-DE")}
            {anzeigeBeleg.art !== "Strafe/Rechnung" && " · Bar"}
          </p>
          <p className="text-base">
            Begründung: {anzeigeBeleg.begruendung || "-"}
            {anzeigeBeleg.art !== "Strafe/Rechnung" && (
              <> · Übergeben an: {anzeigeBeleg.uebergeben_an || "-"}</>
            )}
          </p>
          {anzeigeBeleg.art === "Strafe/Rechnung" && (
            <p className="text-base">
              Beleg: {anzeigeBeleg.beleg_dateiname || "-"}
            </p>
          )}
          <table className="mt-4 print-form-table">
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Betrag €</th>
                <th>Unterschrift</th>
              </tr>
            </thead>
            <tbody>
              {anzeigeBeleg.empfaenger.map((p) => (
                <tr key={p.employee_id}>
                  <td>{p.personal_nr}</td>
                  <td>
                    {p.name}, {p.vorname}
                  </td>
                  <td>{p.anteil.toFixed(2)}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Nur wenn "Übergeben an" tatsächlich ausgefüllt ist - sonst gibt
              es niemanden, der diesen Beleg entgegennimmt/unterschreibt
              (Nutzer-Vorgabe 2026-08-14: die zweite Seite wurde bisher immer
              gedruckt, auch ohne "Übergeben an"). */}
          {anzeigeBeleg.uebergeben_an && (
            <div className="print-page-break">
              <h2 className="text-xl font-semibold">Vorschuss-Übergabe</h2>
              <p className="mt-1 text-base">
                Belegnummer: {anzeigeBeleg.belegnummer} · Datum:{" "}
                {new Date(anzeigeBeleg.datum).toLocaleDateString("de-DE")} · Bar
              </p>
              <p className="text-base">
                Begründung: {anzeigeBeleg.begruendung || "-"} · Übergeben an:{" "}
                {anzeigeBeleg.uebergeben_an}
              </p>
              <table className="mt-4 print-form-table">
                <thead>
                  <tr>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th>Betrag €</th>
                  </tr>
                </thead>
                <tbody>
                  {anzeigeBeleg.empfaenger.map((p) => (
                    <tr key={p.employee_id}>
                      <td>{p.personal_nr}</td>
                      <td>
                        {p.name}, {p.vorname}
                      </td>
                      <td>{p.anteil.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="text-right font-semibold">
                      Summe
                    </td>
                    <td className="font-semibold">
                      {anzeigeBeleg.empfaenger
                        .reduce((s, p) => s + p.anteil, 0)
                        .toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="mt-6 text-base">
                Übergeben an: {anzeigeBeleg.uebergeben_an}
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
