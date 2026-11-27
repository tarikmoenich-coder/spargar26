"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { personalNrFuerBereich, useBereiche } from "@/lib/useBereiche";
import { firmaKurz, standardFirma } from "@/lib/firmen";
import {
  ANZAHL_PERSONALNUMMERN_KREISE,
  kreisBereich,
  naechsteFreieNummer,
  parsePersonalNrNummer,
} from "@/lib/personalnummern";
import { formatDatumDE, formatEuro } from "@/lib/format";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { satzFuerJahr } from "@/lib/satzFuerJahr";
import { inBloecken } from "@/lib/planungTermine";
import { historieKurz } from "@/lib/saisonHistorie";
import {
  baueIndex,
  findeAehnliche,
  normalisiereName,
} from "@/lib/personalAehnlich";
import {
  FUEHRERSCHEIN_KATEGORIEN,
  type BenannterKandidat,
  type Einsatzbereich,
  type Firma,
  type EinsatzbereichZeitraum,
  type Employee,
  type EmployeeSaisonHistorieAgg,
  type Herkunft,
  type PersonalKandidat,
  type UnterkunftHerkunftKontingent,
  type UnterkunftHerkunftPlan,
  type VerpflegungsSatz,
} from "@/lib/types";
import {
  bereichFarbe,
  fuehrerscheinZiel,
  hatFuehrerscheinB,
  istZugesagt,
  standardPlanungsJahr,
} from "@/lib/personalplanung";
import PersonalplanungSoll from "@/components/PersonalplanungSoll";
import PersonalplanungZeitstrahl from "@/components/PersonalplanungZeitstrahl";
import PersonalTabs from "@/components/PersonalTabs";
import PageHeader from "@/components/PageHeader";
import DokumentKameraAufnahme from "@/components/DokumentKameraAufnahme";
import { CalendarRange, Pencil, Trash2 } from "lucide-react";

import { darf } from "@/lib/rollen";
import { heuteLokalIso } from "@/lib/datum";
const emptyForm = {
  personal_nr: "",
  name: "",
  vorname: "",
  geburtsdatum: "",
  nationalitaet: "",
  herkunft: "",
  stundenlohn: "",
  geplante_ankunft: "",
  fuehrerschein: [] as string[],
  einsatzbereich: "",
  // geplante Firma (Stufe 3a); leer = Standard (Mömmel Agrar / Mönich Direkt)
  firma: "",
  notiz: "",
};

export default function PersonalplanungPage() {
  const { profile } = useProfile();
  const bereiche = useBereiche(profile);
  const canEdit = darf(profile, "personal.planung:S");

  const [kandidaten, setKandidaten] = useState<PersonalKandidat[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  // employee_id -> Saison-Historie (wann war die Person schon da)
  const [saisonHistorie, setSaisonHistorie] = useState<
    Record<string, EmployeeSaisonHistorieAgg>
  >({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  // Falls diese Person schon einmal hier war: Verknüpfung zu ihrer
  // (ggf. inaktiven) employees-Zeile - siehe Kommentar in schema.sql bei
  // personal_kandidaten.verknuepfter_employee_id.
  const [verknuepfterId, setVerknuepfterId] = useState<string | null>(null);
  const [employeeSuche, setEmployeeSuche] = useState("");
  const [naechsteKreis, setNaechsteKreis] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ausgewaehlt, setAusgewaehlt] = useState<string[]>([]);
  const [aktivierenLaufend, setAktivierenLaufend] = useState(false);
  // Warteschlange frisch angelegter (NICHT reaktivierter) Mitarbeiter, deren
  // Ausweisfoto direkt bei der Anreise aufgenommen werden soll (Nutzer-
  // Vorgabe 2026-10-22) - siehe anreiseVorbereiten() und
  // DokumentKameraAufnahme weiter unten.
  const [fotoWarteschlange, setFotoWarteschlange] = useState<
    { id: string; name: string; vorname: string }[]
  >([]);
  // Für die Vorbelegung des Stundenlohns mit dem Mindestlohn (siehe
  // Einstellungen-Seite).
  const [saetze, setSaetze] = useState<VerpflegungsSatz[]>([]);
  // Einklappbare Herkunfts-Gruppen (Schlüssel = Herkunft bzw. "__ohne__").
  const [eingeklappt, setEingeklappt] = useState<Set<string>>(new Set());
  // Termine für alle setzen: Gruppen-Schlüssel oder "__alle__".
  const [terminePanel, setTerminePanel] = useState<string | null>(null);
  const [terminAnreise, setTerminAnreise] = useState("");
  const [terminLaeuft, setTerminLaeuft] = useState(false);
  // Bearbeiten einzelner Kandidaten (Führerschein, Name, ...).
  const [bearbeitenId, setBearbeitenId] = useState<string | null>(null);
  const [bearbeitenForm, setBearbeitenForm] = useState<{
    name: string;
    vorname: string;
    geburtsdatum: string;
    nationalitaet: string;
    herkunft: string;
    notiz: string;
    fuehrerschein: string[];
    // änderbar nur, solange der Kandidat nicht mit dem Personalstamm
    // verknüpft/aktiviert ist (2026-11-25, nach dem HSC-Abgleich: reservierte
    // Nummern, die in HSC schon jemand anderem gehören)
    personal_nr: string;
  } | null>(null);
  // Nutzer-Vorgabe 2026-11-21: Saisonjahr, Ansichten (Namensliste / Soll /
  // Zeitstrahl), Platzhalter, Reserve, Einsatzbereich, Sammelaktionen.
  const [saisonJahr, setSaisonJahr] = useState(standardPlanungsJahr());
  const [ansicht, setAnsicht] = useState<"liste" | "soll" | "zeitstrahl">(
    "liste"
  );
  const [einsatzbereiche, setEinsatzbereiche] = useState<Einsatzbereich[]>([]);
  const [sollPlan, setSollPlan] = useState<UnterkunftHerkunftPlan[]>([]);
  const [zeitraeume, setZeitraeume] = useState<EinsatzbereichZeitraum[]>([]);
  // Namensliste auf einen Einsatzbereich filtern (Klick auf die Legende);
  // "__ohne__" = Personen ohne Bereich.
  const [bereichFilter, setBereichFilter] = useState<string | null>(null);
  // Platzhalter, in den das Formular oben gerade den Namen einträgt.
  const [platzhalterZielId, setPlatzhalterZielId] = useState<string | null>(
    null
  );
  // Neue Person ersetzt automatisch einen Platzhalter derselben Herkunft.
  const [platzhalterErsetzen, setPlatzhalterErsetzen] = useState(true);
  // Für Shift-Klick (Bereich markieren).
  const [letzteAuswahl, setLetzteAuswahl] = useState<string | null>(null);
  const [sammelDatum, setSammelDatum] = useState("");
  const [sammelBereich, setSammelBereich] = useState("");
  const [sammelFirma, setSammelFirma] = useState("");
  const [firmen, setFirmen] = useState<Firma[]>([]);
  const [sammelLaeuft, setSammelLaeuft] = useState(false);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [
      kData,
      eList,
      { data: hData },
      { data: vData },
      shData,
      { data: ebData },
      { data: spData },
      { data: zrData },
      { data: firmaData },
    ] = await Promise.all([
      // Seitenweise (alle Saisonjahre zusammen können über 1000 Zeilen haben)
      ladeAlleSeiten<PersonalKandidat>((von, bis) =>
        supabase
          .from("personal_kandidaten")
          .select("*")
          .order("herkunft")
          .order("name")
          .order("id")
          .range(von, bis)
      ),
      // Seitenweise inkl. inaktiver Personen - sonst schneidet PostgREST bei
      // ~1000 Zeilen ab (seit dem Historie-Import tausende inaktive) und
      // Rückkehrer wären hier nicht mehr zu finden bzw. die "belegt"-Zählung
      // der Personalnummern wäre falsch.
      ladeAlleSeiten<Employee>((von, bis) =>
        supabase
          .from("employee_personaldaten")
          .select("*")
          .order("name")
          .order("vorname")
          .order("personal_nr")
          .range(von, bis)
      ),
      supabase.from("herkuenfte").select("*").order("reihenfolge"),
      supabase
        .from("verpflegungssaetze")
        .select("*")
        .order("saison_jahr", { ascending: false }),
      // Eine Zeile je Person mit Historie (tausende) - seitenweise.
      ladeAlleSeiten<EmployeeSaisonHistorieAgg>((von, bis) =>
        supabase
          .from("employee_saison_historie_agg")
          .select("*")
          .order("employee_id")
          .range(von, bis)
      ),
      supabase.from("einsatzbereiche").select("*").order("reihenfolge"),
      supabase.from("unterkunft_herkunft_plan").select("*"),
      supabase.from("einsatzbereich_zeitraum").select("*"),
      supabase.from("firma").select("*").order("reihenfolge"),
    ]);
    setZeitraeume((zrData as EinsatzbereichZeitraum[]) ?? []);
    setFirmen((firmaData as Firma[]) ?? []);
    setEinsatzbereiche((ebData as Einsatzbereich[]) ?? []);
    setSollPlan((spData as UnterkunftHerkunftPlan[]) ?? []);
    setKandidaten(kData);
    setEmployees(eList);
    setHerkuenfte((hData as Herkunft[]) ?? []);
    setSaetze((vData as VerpflegungsSatz[]) ?? []);
    const shMap: Record<string, EmployeeSaisonHistorieAgg> = {};
    shData.forEach((r) => {
      shMap[r.employee_id] = r;
    });
    setSaisonHistorie(shMap);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // "Belegt" zählt employees UND alle nicht-stornierten Kandidaten - eine
  // stornierte Reservierung gibt ihre Nummer sofort wieder frei (siehe
  // Kommentar in schema.sql).
  const belegteNummern = useMemo(() => {
    const belegt = new Set<number>();
    employees.forEach((e) => {
      const n = parsePersonalNrNummer(e.personal_nr);
      if (n !== null) belegt.add(n);
    });
    kandidaten
      .filter((k) => k.status !== "storniert")
      .forEach((k) => {
        if (!k.personal_nr) return; // Platzhalter
        const n = parsePersonalNrNummer(k.personal_nr);
        if (n !== null) belegt.add(n);
      });
    return belegt;
  }, [employees, kandidaten]);

  // Vorbelegt den Stundenlohn für NEUE (nicht verknüpfte) Kandidaten mit dem
  // Mindestlohn der GEWÄHLTEN Saison (Nutzer-Meldung 2026-11-21: bei der
  // Planung für 2027 galt sonst noch der Satz 2026). Ein noch unveränderter
  // Standard-Mindestlohn im Formular folgt beim Saisonwechsel mit; ein
  // bewusst abweichender Lohn bleibt stehen.
  const heuteJahr = new Date().getFullYear();
  const lohnSatz = satzFuerJahr(saetze, saisonJahr);
  const istStandardLohn = (lohn: number | null) =>
    lohn === null ||
    saetze.some(
      (sz) => sz.mindestlohn != null && Number(sz.mindestlohn) === Number(lohn)
    );
  const mindestlohnFuer = (jahr: number): number | null => {
    const m = satzFuerJahr(saetze, jahr)?.mindestlohn;
    return m != null ? Number(m) : null;
  };
  useEffect(() => {
    if (verknuepfterId) return;
    if (lohnSatz?.mindestlohn == null) return;
    setForm((f) =>
      f.stundenlohn === "" || istStandardLohn(Number(f.stundenlohn))
        ? { ...f, stundenlohn: String(lohnSatz.mindestlohn) }
        : f
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saetze, saisonJahr]);

  function naechsteFreieUebernehmen() {
    const frei = naechsteFreieNummer(belegteNummern, Number(naechsteKreis));
    if (frei !== null) {
      setForm((f) => ({ ...f, personal_nr: frei.toString() }));
    }
  }

  const personalNrKonflikt = (() => {
    // Mit Bereichs-Präfix vergleichen ("123" im Vertrieb = "V-123").
    const roh = form.personal_nr.trim();
    if (!roh || verknuepfterId) return null;
    const zielBereich = platzhalterZielId
      ? kandidaten.find((k) => k.id === platzhalterZielId)?.bereich ?? bereiche.standard
      : bereiche.standard;
    const typed = personalNrFuerBereich(roh, bereiche.praefix(zielBereich)).toLowerCase();
    const inEmployees = employees.find(
      (e) => e.personal_nr.trim().toLowerCase() === typed
    );
    if (inEmployees) {
      return `${inEmployees.name}, ${inEmployees.vorname} (Personal)`;
    }
    const inKandidaten = kandidaten.find(
      (k) =>
        k.status !== "storniert" &&
        (k.personal_nr ?? "").trim().toLowerCase() === typed
    );
    if (inKandidaten) {
      return `${inKandidaten.name}, ${inKandidaten.vorname} (bereits geplant)`;
    }
    return null;
  })();

  // Suche nach Name (ohne Akzente, auch "Name Vorname"), Personalnummer und
  // Geburtsdatum (TT.MM.JJJJ, auch teilweise wie "14.03." oder "1990").
  const suchIndex = useMemo(
    () =>
      employees.map((e) => {
        const n = normalisiereName(e.name);
        const v = normalisiereName(e.vorname);
        return {
          e,
          n,
          v,
          voll: n + v,
          vollUmgekehrt: v + n,
          pn: e.personal_nr.toLowerCase(),
          gdDe: e.geburtsdatum ? formatDatumDE(e.geburtsdatum) : "",
        };
      }),
    [employees]
  );

  const employeeTreffer = useMemo(() => {
    const roh = employeeSuche.trim();
    if (roh.length < 2) return [];
    const q = normalisiereName(roh);
    const rohKlein = roh.toLowerCase();
    const datumQuery = /^[\d.\-/\s]{4,}$/.test(roh) ? roh.replace(/\s/g, "") : null;
    return suchIndex
      .filter((x) => {
        if (
          q &&
          (x.n.includes(q) ||
            x.v.includes(q) ||
            x.voll.includes(q) ||
            x.vollUmgekehrt.includes(q))
        ) {
          return true;
        }
        if (x.pn.includes(rohKlein)) return true;
        if (datumQuery && x.e.geburtsdatum) {
          return (
            x.gdDe.includes(datumQuery) || x.e.geburtsdatum.includes(datumQuery)
          );
        }
        return false;
      })
      .slice(0, 12)
      .map((x) => x.e);
  }, [employeeSuche, suchIndex]);

  const verknuepfterEmployee = verknuepfterId
    ? employees.find((e) => e.id === verknuepfterId) ?? null
    : null;

  // "Neu" = die Person war noch nie hier: nicht mit einer bestehenden
  // (ggf. inaktiven) Person verknüpft UND keine ähnliche Person im
  // Personalstamm (gleicher Name auch mit anderer Schreibweise/vertauscht,
  // oder gleiches Geburtsdatum + ähnlicher Name) - siehe
  // lib/personalAehnlich.ts. So erscheint "neu" nicht fälschlich, wenn
  // jemand einen Rückkehrer nicht verknüpft hat.
  const personenIndex = useMemo(() => baueIndex(employees), [employees]);

  const formAehnliche = useMemo(
    () =>
      verknuepfterId || !form.name.trim() || !form.vorname.trim()
        ? []
        : findeAehnliche(personenIndex, {
            name: form.name,
            vorname: form.vorname,
            geburtsdatum: form.geburtsdatum || null,
          }),
    [verknuepfterId, form.name, form.vorname, form.geburtsdatum, personenIndex]
  );

  function personVerknuepfen(emp: Employee) {
    setVerknuepfterId(emp.id);
    setForm((f) => ({
      ...f,
      personal_nr: emp.personal_nr,
      name: emp.name,
      vorname: emp.vorname,
      geburtsdatum: emp.geburtsdatum ?? "",
      nationalitaet: emp.nationalitaet ?? "",
      herkunft: emp.herkunft ?? "",
      // Vorbelegt aus dem letzten Einsatz, aber bewusst editierbar - der
      // Lohn kann sich zur neuen Saison geändert haben.
      stundenlohn: emp.stundenlohn?.toString() ?? "",
    }));
    setEmployeeSuche("");
  }

  function verknuepfungLoesen() {
    setVerknuepfterId(null);
    setForm(emptyForm);
  }

  function toggleFuehrerschein(kategorie: string) {
    setForm((f) => ({
      ...f,
      fuehrerschein: f.fuehrerschein.includes(kategorie)
        ? f.fuehrerschein.filter((k) => k !== kategorie)
        : [...f.fuehrerschein, kategorie],
    }));
  }

  // Freier Platzhalter derselben Herkunft für eine neue Person: bevorzugt
  // einer mit passender Führerschein-Planung (B ja/nein), sonst der älteste.
  function freierPlatzhalter(
    herkunft: string,
    mitFuehrerschein: boolean
  ): PersonalKandidat | null {
    const frei = kandidaten
      .filter(
        (k) =>
          k.platzhalter &&
          k.status === "geplant" &&
          k.saison_jahr === saisonJahr &&
          k.herkunft === herkunft
      )
      .sort((a, b) => a.erstellt_am.localeCompare(b.erstellt_am));
    return (
      frei.find((k) => hatFuehrerscheinB(k) === mitFuehrerschein) ??
      frei[0] ??
      null
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (personalNrKonflikt) return;
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    const ziel = platzhalterZielId
      ? kandidaten.find((k) => k.id === platzhalterZielId) ?? null
      : platzhalterErsetzen && form.herkunft
        ? freierPlatzhalter(form.herkunft, form.fuehrerschein.length > 0)
        : null;
    // Bereich (Stufe 2): Platzhalter behalten ihren, neue Kandidaten nehmen
    // die gewählte Ansicht bzw. den einzigen erlaubten Bereich.
    const kandidatBereich = ziel?.bereich ?? bereiche.standard;
    const daten = {
      personal_nr: personalNrFuerBereich(form.personal_nr, bereiche.praefix(kandidatBereich)),
      name: form.name,
      vorname: form.vorname,
      geburtsdatum: form.geburtsdatum || null,
      nationalitaet: form.nationalitaet || null,
      herkunft: form.herkunft || null,
      verknuepfter_employee_id: verknuepfterId,
      stundenlohn: form.stundenlohn ? Number(form.stundenlohn) : null,
      fuehrerschein_kategorien:
        form.fuehrerschein.length > 0 ? form.fuehrerschein : null,
    };
    // Wird ein Platzhalter befüllt, bleiben seine Planungsangaben (Anreise,
    // Einsatzbereich, Firma, Notiz) stehen, sofern im Formular nichts anderes steht.
    const { error } = ziel
      ? await supabase
          .from("personal_kandidaten")
          .update({
            ...daten,
            platzhalter: false,
            geplante_ankunft: form.geplante_ankunft || ziel.geplante_ankunft,
            einsatzbereich: form.einsatzbereich || ziel.einsatzbereich,
            firma: form.firma || ziel.firma,
            notiz: form.notiz || ziel.notiz,
          })
          .eq("id", ziel.id)
          .eq("platzhalter", true)
      : await supabase.from("personal_kandidaten").insert({
          ...daten,
          bereich: kandidatBereich,
          saison_jahr: saisonJahr,
          geplante_ankunft: form.geplante_ankunft || null,
          einsatzbereich: form.einsatzbereich || null,
          firma: form.firma || null,
          notiz: form.notiz || null,
        });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(emptyForm);
    setVerknuepfterId(null);
    setPlatzhalterZielId(null);
    load();
  }

  // "Namen eintragen" an einer Platzhalter-Zeile: das Formular oben wird mit
  // den Planungsangaben des Platzhalters vorbelegt und schreibt beim
  // Speichern in genau diese Zeile (inkl. Verknüpfen mit bekannter Person).
  function platzhalterBefuellen(k: PersonalKandidat) {
    setPlatzhalterZielId(k.id);
    setVerknuepfterId(null);
    setForm({
      ...emptyForm,
      herkunft: k.herkunft ?? "",
      geplante_ankunft: k.geplante_ankunft ?? "",
      einsatzbereich: k.einsatzbereich ?? "",
      stundenlohn: k.stundenlohn?.toString() ?? "",
      fuehrerschein: k.fuehrerschein_kategorien ?? [],
      notiz: k.notiz ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function platzhalterBefuellenAbbrechen() {
    setPlatzhalterZielId(null);
    setVerknuepfterId(null);
    setForm(emptyForm);
  }

  // Einzelfeld einer Zeile direkt speichern (Bereich, Reserve, geplanter
  // Führerschein eines Platzhalters).
  async function zeileSpeichern(
    k: PersonalKandidat,
    payload: Partial<PersonalKandidat>
  ) {
    setError(null);
    const { error } = await getSupabaseClient()
      .from("personal_kandidaten")
      .update(payload)
      .eq("id", k.id);
    if (error) {
      setError(error.message);
      return;
    }
    setKandidaten((prev) =>
      prev.map((x) => (x.id === k.id ? { ...x, ...payload } : x))
    );
  }

  // Sammelaktion für alle markierten Zeilen.
  async function sammelSpeichern(payload: Partial<PersonalKandidat>) {
    if (ausgewaehlt.length === 0) return;
    setSammelLaeuft(true);
    setError(null);
    const supabase = getSupabaseClient();
    const fehler: string[] = [];
    for (const block of inBloecken(ausgewaehlt)) {
      const { error } = await supabase
        .from("personal_kandidaten")
        .update(payload)
        .in("id", block);
      if (error) fehler.push(error.message);
    }
    setSammelLaeuft(false);
    if (fehler.length > 0) setError([...new Set(fehler)].join(" · "));
    load();
  }

  async function sammelEntfernenPlatzhalter() {
    const ids = ausgewaehlt.filter(
      (id) => kandidaten.find((k) => k.id === id)?.platzhalter
    );
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length} markierte Platzhalter entfernen?`)) return;
    setSammelLaeuft(true);
    const supabase = getSupabaseClient();
    const fehler: string[] = [];
    for (const block of inBloecken(ids)) {
      const { error } = await supabase
        .from("personal_kandidaten")
        .delete()
        .in("id", block)
        .eq("platzhalter", true);
      if (error) fehler.push(error.message);
    }
    setSammelLaeuft(false);
    setAusgewaehlt((prev) => prev.filter((id) => !ids.includes(id)));
    if (fehler.length > 0) setError([...new Set(fehler)].join(" · "));
    load();
  }

  function toggleAusgewaehlt(id: string, mitShift = false) {
    // Shift-Klick markiert alles zwischen dem zuletzt angeklickten und
    // diesem Kandidaten (in der angezeigten Reihenfolge, über Gruppen
    // hinweg).
    if (mitShift && letzteAuswahl && letzteAuswahl !== id) {
      const reihenfolge = gruppen.flatMap((g) => g.liste.map((k) => k.id));
      const a = reihenfolge.indexOf(letzteAuswahl);
      const b = reihenfolge.indexOf(id);
      if (a >= 0 && b >= 0) {
        const bereich = reihenfolge.slice(Math.min(a, b), Math.max(a, b) + 1);
        setAusgewaehlt((prev) => [...new Set([...prev, ...bereich])]);
        setLetzteAuswahl(id);
        return;
      }
    }
    setAusgewaehlt((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setLetzteAuswahl(id);
  }

  // Erzeugt aus jedem ausgewählten Kandidaten einen echten employees-
  // Datensatz (bei einer Verknüpfung wird die bestehende, ggf. inaktive
  // Person reaktiviert - Historie bleibt an einer ID, ADR-011; sonst neu
  // angelegt mit der reservierten Personalnummer) und verschiebt ihn in die
  // Anreiseliste (Personal → Anreiseliste), wo Vertragszeitraum, Dokumente
  // und die weiteren Unterlagen erfasst werden.
  async function anreiseVorbereiten() {
    // Platzhalter (noch ohne Namen) und Reserve können nicht anreisen.
    const bereit = ausgewaehlt.filter((id) => {
      const k = kandidaten.find((x) => x.id === id);
      return k && k.status === "geplant" && !k.platzhalter && !k.reserve;
    });
    const uebersprungen = ausgewaehlt.length - bereit.length;
    if (bereit.length === 0) {
      setError(
        "Unter den markierten Zeilen ist niemand, der anreisen kann – Platzhalter brauchen erst einen Namen, Reserve muss erst zugesagt werden."
      );
      return;
    }
    if (
      !window.confirm(
        `${bereit.length} Kandidat(en) jetzt aktivieren${uebersprungen > 0 ? ` (${uebersprungen} Platzhalter/Reserve werden übersprungen)` : ""} und in die Anreiseliste verschieben?\n\nEs gelten die Sätze der jeweiligen Saison (${[...new Set(bereit.map((id) => kandidaten.find((x) => x.id === id)?.saison_jahr ?? saisonJahr))].join(", ")}): Mindestlohn (sofern nicht individuell abweichend) und Tagessätze Wohnen/Verpflegung.`
      )
    ) {
      return;
    }
    setAktivierenLaufend(true);
    setError(null);
    const supabase = getSupabaseClient();
    const fehlerListe: string[] = [];
    // Nur ECHT neu angelegte (nicht reaktivierte) Personen bekommen die
    // Foto-Aufnahme vorgeschlagen - eine reaktivierte Person hatte ggf.
    // schon ein Foto aus einer früheren Saison.
    const neuAngelegt: { id: string; name: string; vorname: string }[] = [];

    // Herkunfts-Stammplätze laden: die reservierten Wohneinheiten je
    // (Saison, Herkunft) und die aktuelle Belegung/Planung je Wohneinheit.
    const jahre = [
      ...new Set(
        bereit.map(
          (id) =>
            kandidaten.find((x) => x.id === id)?.saison_jahr ?? saisonJahr
        )
      ),
    ];
    const [{ data: kontData }, { data: ueberData }] = await Promise.all([
      supabase
        .from("unterkunft_herkunft_kontingent")
        .select("*")
        .in("saison_jahr", jahre)
        .order("reihenfolge"),
      supabase
        .from("unterkunft_wohneinheit_uebersicht")
        .select("wohneinheit_id, betten, fest, geplant"),
    ]);
    const kontingentByHerkunft = new Map<string, UnterkunftHerkunftKontingent[]>();
    ((kontData as UnterkunftHerkunftKontingent[]) ?? []).forEach((k) => {
      const key = `${k.saison_jahr}|${k.herkunft}`;
      if (!kontingentByHerkunft.has(key)) kontingentByHerkunft.set(key, []);
      kontingentByHerkunft.get(key)!.push(k);
    });
    const weUeber = new Map<
      number,
      { betten: number; fest: number; geplant: number }
    >(
      ((ueberData as { wohneinheit_id: number; betten: number; fest: number; geplant: number }[]) ??
        []).map((u) => [u.wohneinheit_id, u])
    );
    const platziertProWe = new Map<number, number>();
    const ohnePlatz = new Map<string, number>();

    // Ab der Anreise gelten die Sätze der SAISON des Kandidaten (seit
    // 2026-11-21 saison_jahr; vorher das Kalenderjahr, wodurch bei der
    // Planung für 2027 noch der Mindestlohn 2026 griff). Der bei der Planung
    // eingetragene Stundenlohn ist nur vorläufig: entspricht er einem
    // Standard-Mindestlohn (irgendeines Jahres, auch leer), wird er auf den
    // der Saison gesetzt. Ein bewusst abweichender Lohn (z.B. Vorarbeiter)
    // bleibt unangetastet.

    for (const id of bereit) {
      const k = kandidaten.find((x) => x.id === id) as
        | BenannterKandidat
        | undefined;
      if (!k || k.status !== "geplant") continue;
      let employeeId: string | null = null;
      const mindestSaison = mindestlohnFuer(k.saison_jahr);
      const lohn =
        mindestSaison !== null && istStandardLohn(k.stundenlohn)
          ? mindestSaison
          : k.stundenlohn;
      if (k.verknuepfter_employee_id) {
        const { error } = await supabase
          .from("employee_personaldaten")
          .update({
            aktiv: true,
            name: k.name,
            vorname: k.vorname,
            geburtsdatum: k.geburtsdatum,
            nationalitaet: k.nationalitaet,
            herkunft: k.herkunft,
            ...(lohn !== null ? { stundenlohn: lohn } : {}),
          })
          .eq("id", k.verknuepfter_employee_id);
        if (error) {
          fehlerListe.push(`${k.name}, ${k.vorname}: ${error.message}`);
          continue;
        }
        employeeId = k.verknuepfter_employee_id;
      } else {
        const { data, error } = await supabase
          .from("employee_personaldaten")
          .insert({
            personal_nr: personalNrFuerBereich(k.personal_nr, bereiche.praefix(k.bereich)),
            bereich: k.bereich ?? "LW",
            name: k.name,
            vorname: k.vorname,
            geburtsdatum: k.geburtsdatum,
            nationalitaet: k.nationalitaet,
            herkunft: k.herkunft,
            stundenlohn: lohn,
            aktiv: true,
          })
          .select("id")
          .single();
        if (error || !data) {
          fehlerListe.push(
            `${k.name}, ${k.vorname}: ${error?.message ?? "unbekannter Fehler"}`
          );
          continue;
        }
        employeeId = data.id;
        if (employeeId) {
          neuAngelegt.push({ id: employeeId, name: k.name, vorname: k.vorname });
        }
      }
      const { error: statusFehler } = await supabase
        .from("personal_kandidaten")
        .update({
          status: "anreiseliste",
          aktivierter_employee_id: employeeId,
          stundenlohn: lohn,
        })
        .eq("id", k.id);
      if (statusFehler) {
        fehlerListe.push(
          `${k.name}, ${k.vorname}: aktiviert, aber nicht in die Anreiseliste verschoben - ${statusFehler.message}`
        );
      }

      // Geplante Firma für die Saison übernehmen (Stufe 3a) - ohne Angabe
      // gilt die Standard-Firma des Bereichs, kein Eintrag nötig.
      if (employeeId && k.firma) {
        const { error: firmaFehler } = await supabase
          .from("employee_saison")
          .upsert(
            { employee_id: employeeId, saison_jahr: k.saison_jahr, firma: k.firma },
            { onConflict: "employee_id,saison_jahr" }
          );
        if (firmaFehler) {
          fehlerListe.push(`${k.name}, ${k.vorname}: Firma nicht übernommen - ${firmaFehler.message}`);
        }
      }

      // Expliziter Beschäftigungsabschnitt (Nutzer-Vorgabe 2026-11-04/05):
      // arbeitsbeginn_datum ist an dieser Stelle in aller Regel noch leer
      // (wird erst auf der Anreiseliste erfasst, siehe dort
      // vertragszeitraumSpeichern/beginnFuerGruppeSetzen - die aktualisieren
      // das Anmeldedatum nachträglich) - heute als Platzhalter reicht, damit
      // nie ein aktiver Mitarbeiter ganz ohne offenen Abschnitt dasteht.
      if (employeeId) {
        const { error: anmeldenFehler } = await supabase.rpc(
          "employee_beschaeftigung_anmelden",
          {
            p_employee_id: employeeId,
            p_anmeldedatum: k.arbeitsbeginn_datum || heuteLokalIso(),
            p_quelle: k.verknuepfter_employee_id ? "reaktivierung" : "aktivierung",
          }
        );
        if (anmeldenFehler) {
          fehlerListe.push(`${k.name}, ${k.vorname}: ${anmeldenFehler.message}`);
        }
      }

      // Person in das nächste freie reservierte Haus ihrer Herkunft setzen
      // (geplante Zimmerzuordnung, Wohneinheits-Ebene). Zimmer regelt der
      // Hausmeister bei der Ankunft.
      if (employeeId && k.herkunft) {
        const saisonJ = k.saison_jahr;
        const kont = kontingentByHerkunft.get(`${saisonJ}|${k.herkunft}`) ?? [];
        let platziert = false;
        for (const we of kont) {
          const u = weUeber.get(we.wohneinheit_id);
          const betten = u?.betten ?? 0;
          const belegtJetzt =
            (u ? u.fest + u.geplant : 0) +
            (platziertProWe.get(we.wohneinheit_id) ?? 0);
          if (belegtJetzt >= betten) continue;
          const { error } = await supabase.from("unterkunft_zuordnung").insert({
            employee_id: employeeId,
            wohneinheit_id: we.wohneinheit_id,
            geplant_ab:
              k.geplante_ankunft ?? heuteLokalIso(),
          });
          if (!error) {
            platziertProWe.set(
              we.wohneinheit_id,
              (platziertProWe.get(we.wohneinheit_id) ?? 0) + 1
            );
            platziert = true;
          } else if (error.code === "23505") {
            platziert = true; // schon einer Wohneinheit zugeordnet
          } else {
            fehlerListe.push(`${k.name}: Zuordnung – ${error.message}`);
            platziert = true;
          }
          break;
        }
        if (!platziert) {
          ohnePlatz.set(k.herkunft, (ohnePlatz.get(k.herkunft) ?? 0) + 1);
        }
      }
    }
    setAktivierenLaufend(false);
    setAusgewaehlt((prev) => prev.filter((id) => !bereit.includes(id)));
    if (ohnePlatz.size > 0) {
      fehlerListe.push(
        "Ohne reservierten Platz: " +
          [...ohnePlatz.entries()]
            .map(([h, n]) => `${n}× ${h}`)
            .join(" · ") +
          " – Kontingent in der Herkunfts-Planung erweitern."
      );
    }
    if (fehlerListe.length > 0) setError(fehlerListe.join(" · "));
    // Fotos der neu angelegten Personen direkt jetzt aufnehmen (Nutzer-
    // Vorgabe 2026-10-22) - load() erst, wenn die Warteschlange fertig ist,
    // damit die Kandidatenliste währenddessen nicht unter dem Kamera-Dialog
    // wegspringt.
    if (neuAngelegt.length > 0) {
      setFotoWarteschlange(neuAngelegt);
    } else {
      load();
    }
  }

  function fotoWarteschlangeWeiter() {
    setFotoWarteschlange((prev) => {
      const rest = prev.slice(1);
      if (rest.length === 0) load();
      return rest;
    });
  }

  function fotoWarteschlangeAbbrechen() {
    setFotoWarteschlange([]);
    load();
  }

  // Geplante Anreise bzw. Stundenlohn eines geplanten Kandidaten direkt in
  // der Liste ändern. (Arbeitsbeginn/-ende werden erst in der Anreiseliste
  // erfasst - Nutzer-Vorgabe 2026-09-19.)
  async function vertragsfeldSpeichern(
    k: PersonalKandidat,
    feld: "geplante_ankunft" | "stundenlohn",
    wert: string
  ) {
    const neu =
      feld === "stundenlohn"
        ? wert === ""
          ? null
          : Number(wert)
        : wert || null;
    if (neu === k[feld]) return;
    const payload: Partial<PersonalKandidat> = { [feld]: neu };
    const { error } = await getSupabaseClient()
      .from("personal_kandidaten")
      .update(payload)
      .eq("id", k.id);
    if (error) {
      setError(error.message);
      return;
    }
    setKandidaten((prev) =>
      prev.map((x) => (x.id === k.id ? { ...x, ...payload } : x))
    );
  }

  // Geplante Anreise für viele Kandidaten auf einmal setzen (eine
  // Herkunfts-Gruppe oder alle).
  async function anreiseSetzen(
    ziele: PersonalKandidat[],
    datum: string = terminAnreise
  ) {
    if (ziele.length === 0 || !datum) return;
    setTerminLaeuft(true);
    setError(null);
    const supabase = getSupabaseClient();
    const fehler: string[] = [];
    for (const block of inBloecken(ziele.map((k) => k.id))) {
      const { error } = await supabase
        .from("personal_kandidaten")
        .update({ geplante_ankunft: datum })
        .in("id", block);
      if (error) fehler.push(error.message);
    }
    setTerminLaeuft(false);
    if (fehler.length > 0) {
      setError([...new Set(fehler)].join(" · "));
    } else {
      setTerminePanel(null);
      setTerminAnreise("");
    }
    load();
  }

  // Alle Kandidaten einer Herkunfts-Gruppe an-/abwählen.
  function toggleGruppeAuswahl(liste: PersonalKandidat[]) {
    const ids = liste.map((k) => k.id);
    setAusgewaehlt((prev) =>
      ids.every((id) => prev.includes(id))
        ? prev.filter((id) => !ids.includes(id))
        : [...new Set([...prev, ...ids])]
    );
  }

  function bearbeitenStarten(k: PersonalKandidat) {
    setBearbeitenId(k.id);
    setBearbeitenForm({
      name: k.name ?? "",
      vorname: k.vorname ?? "",
      geburtsdatum: k.geburtsdatum ?? "",
      nationalitaet: k.nationalitaet ?? "",
      herkunft: k.herkunft ?? "",
      notiz: k.notiz ?? "",
      fuehrerschein: k.fuehrerschein_kategorien ?? [],
      personal_nr: k.personal_nr ?? "",
    });
  }

  // Personalnummer schon vergeben? (Personalstamm + nicht stornierte
  // Kandidaten, außer dem Kandidaten selbst)
  function nrVergebenAn(nr: string, ausserKandidat: string | null): string | null {
    const t = nr.trim().toLowerCase();
    if (!t) return null;
    const e = employees.find((x) => x.personal_nr.trim().toLowerCase() === t);
    if (e) return `${e.name}, ${e.vorname} (Personal)`;
    const k = kandidaten.find(
      (x) => x.id !== ausserKandidat && x.status !== "storniert" && (x.personal_nr ?? "").trim().toLowerCase() === t
    );
    return k ? `${k.name}, ${k.vorname} (bereits geplant)` : null;
  }
  function naechsteFreieFuer(nr: string): string | null {
    const n = parsePersonalNrNummer(nr);
    const kreis = n === null || n < 1000 ? 1 : Math.floor(n / 1000) + 1;
    const frei = naechsteFreieNummer(belegteNummern, Math.min(kreis, ANZAHL_PERSONALNUMMERN_KREISE));
    return frei === null ? null : String(frei);
  }

  async function bearbeitenSpeichern() {
    if (!bearbeitenId || !bearbeitenForm) return;
    const f = bearbeitenForm;
    const k = kandidaten.find((x) => x.id === bearbeitenId);
    const nrAenderbar = !!k && !k.aktivierter_employee_id && !k.verknuepfter_employee_id;
    const neueNr =
      nrAenderbar && f.personal_nr.trim() && f.personal_nr.trim() !== (k!.personal_nr ?? "")
        ? personalNrFuerBereich(f.personal_nr.trim(), bereiche.praefix(k!.bereich))
        : null;
    if (neueNr) {
      const vergeben = nrVergebenAn(neueNr, k!.id);
      if (vergeben) {
        setError(`Personalnummer ${neueNr} ist schon vergeben an ${vergeben}.`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    const { error } = await getSupabaseClient()
      .from("personal_kandidaten")
      .update({
        ...(neueNr ? { personal_nr: neueNr } : {}),
        name: f.name,
        vorname: f.vorname,
        geburtsdatum: f.geburtsdatum || null,
        nationalitaet: f.nationalitaet || null,
        herkunft: f.herkunft || null,
        notiz: f.notiz || null,
        fuehrerschein_kategorien:
          f.fuehrerschein.length > 0 ? f.fuehrerschein : null,
      })
      .eq("id", bearbeitenId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setBearbeitenId(null);
    setBearbeitenForm(null);
    load();
  }

  function toggleGruppe(key: string) {
    setEingeklappt((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Ohne Begründung und ohne Rückfrage (Nutzer-Vorgabe 2026-09-19: Kandidaten
  // sollen sich in der Planung locker rein- und rausnehmen lassen). Die
  // Nummer ist danach sofort wieder frei; das Löschen steht im Audit-Log.
  async function entfernen(k: PersonalKandidat) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("personal_kandidaten")
      .delete()
      .eq("id", k.id);
    if (error) {
      setError(error.message);
      return;
    }
    setAusgewaehlt((prev) => prev.filter((x) => x !== k.id));
    load();
  }

  // Alle nicht stornierten Kandidaten des gewählten Saisonjahres (für
  // Soll/Zeitstrahl - inkl. der schon auf der Anreiseliste) und die noch
  // geplanten davon (Namensliste).
  const saisonKandidaten = kandidaten.filter(
    (k) => k.saison_jahr === saisonJahr && k.status !== "storniert"
  );
  const geplante = saisonKandidaten.filter((k) => k.status === "geplant");
  const saisonJahre = [
    ...new Set([
      heuteJahr,
      heuteJahr + 1,
      saisonJahr,
      ...kandidaten.map((k) => k.saison_jahr),
    ]),
  ].sort((a, b) => a - b);
  const sollVon = (herkunft: string) =>
    sollPlan.find((p) => p.saison_jahr === saisonJahr && p.herkunft === herkunft)
      ?.soll_anzahl ?? 0;
  const zielPlatzhalter = platzhalterZielId
    ? kandidaten.find((k) => k.id === platzhalterZielId) ?? null
    : null;
  const freieAutoPlatzhalter =
    !platzhalterZielId && form.herkunft
      ? geplante.filter((k) => k.platzhalter && k.herkunft === form.herkunft)
          .length
      : 0;

  // Geplante Personen dieser Saison mit dem Standard-Mindestlohn eines
  // ANDEREN Jahres (z.B. 2027 geplant, aber noch mit dem Satz 2026 angelegt).
  const mindestlohnSaison = mindestlohnFuer(saisonJahr);
  const veralteterLohn =
    mindestlohnSaison === null
      ? []
      : geplante.filter(
          (k) =>
            k.stundenlohn !== null &&
            istStandardLohn(k.stundenlohn) &&
            Number(k.stundenlohn) !== mindestlohnSaison
        );

  async function mindestlohnSaisonUebernehmen() {
    if (mindestlohnSaison === null || veralteterLohn.length === 0) return;
    setSammelLaeuft(true);
    setError(null);
    const supabase = getSupabaseClient();
    const fehler: string[] = [];
    for (const block of inBloecken(veralteterLohn.map((k) => k.id))) {
      const { error } = await supabase
        .from("personal_kandidaten")
        .update({ stundenlohn: mindestlohnSaison })
        .in("id", block);
      if (error) fehler.push(error.message);
    }
    setSammelLaeuft(false);
    if (fehler.length > 0) setError([...new Set(fehler)].join(" · "));
    load();
  }

  function aehnlicheZu(k: PersonalKandidat) {
    if (k.verknuepfter_employee_id || k.platzhalter || !k.name || !k.vorname) {
      return [];
    }
    return findeAehnliche(personenIndex, {
      name: k.name,
      vorname: k.vorname,
      geburtsdatum: k.geburtsdatum,
    });
  }

  const gruppen = useMemo(() => {
    const buckets = new Map<string, PersonalKandidat[]>();
    const gefiltert = bereichFilter
      ? geplante.filter((k) =>
          bereichFilter === "__ohne__"
            ? !k.einsatzbereich
            : k.einsatzbereich === bereichFilter
        )
      : geplante;
    for (const k of gefiltert) {
      const key = k.herkunft ?? "__ohne__";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(k);
    }
    const reihenfolge = new Map(herkuenfte.map((h) => [h.wert, h.reihenfolge]));
    const keys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === "__ohne__") return 1;
      if (b === "__ohne__") return -1;
      return (reihenfolge.get(a) ?? 0) - (reihenfolge.get(b) ?? 0);
    });
    // In der Gruppe: nach Einsatzbereich (Reihenfolge der Einstellungen,
    // ohne Bereich zuletzt), darin Namen vor Platzhaltern; Reserve ganz unten.
    const bereichRang = new Map(einsatzbereiche.map((b, i) => [b.wert, i]));
    const rangBereich = (k: PersonalKandidat) =>
      k.einsatzbereich ? bereichRang.get(k.einsatzbereich) ?? 998 : 999;
    const rang = (k: PersonalKandidat) => (k.reserve ? 2 : 0);
    return keys.map((key) => ({
      key,
      anzeige: key === "__ohne__" ? "Ohne Herkunft" : key,
      liste: buckets
        .get(key)!
        .slice()
        .sort(
          (a, b) =>
            rang(a) - rang(b) ||
            rangBereich(a) - rangBereich(b) ||
            Number(a.platzhalter) - Number(b.platzhalter) ||
            (a.name ?? "").localeCompare(b.name ?? "") ||
            a.erstellt_am.localeCompare(b.erstellt_am)
        ),
    }));
  }, [geplante, herkuenfte, einsatzbereiche, bereichFilter]);

  function schwarzeListeVon(empId: string | null) {
    if (!empId) return null;
    const e = employees.find((x) => x.id === empId);
    return e?.schwarze_liste ? e : null;
  }

  // Kleines Formular "Anreise für alle setzen" - einmal für alle Kandidaten
  // oder für eine Herkunfts-Gruppe.
  function terminePanelJsx(ziele: PersonalKandidat[], bezeichnung: string) {
    return (
      <div className="flex flex-wrap items-end gap-3 rounded border border-emerald-300 bg-emerald-50 p-3">
        <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
          Geplante Anreise
          <input
            type="date"
            value={terminAnreise}
            onChange={(e) => setTerminAnreise(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn text-xs"
          disabled={terminLaeuft || !terminAnreise}
          onClick={() => anreiseSetzen(ziele)}
        >
          Für {bezeichnung} setzen
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setTerminePanel(null)}
        >
          Abbrechen
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <PageHeader icon={CalendarRange} titel="Personalplanung" />
        <p className="text-sm text-neutral-500">
          Kandidaten für die kommende Saison vorab anlegen, bevor sie
          tatsächlich anreisen. Personalnummern werden dabei nur reserviert,
          nicht final vergeben – Kandidaten lassen sich jederzeit ohne
          Begründung wieder entfernen, die Nummer ist dann sofort wieder frei.
          Ein „neu" neben dem Namen zeigt Personen, die noch nie hier
          waren. Über „Anreise vorbereiten" wird aus einem Kandidaten
          ein echter Mitarbeiter unter „Personal" und er wandert in die{" "}
          <a href="/personal-anreiseliste" className="underline">
            Anreiseliste
          </a>{" "}
          weiter, wo Vertragszeitraum und Unterlagen erfasst werden.
          Solange ein Vermittler nur eine Zahl meldet, planst du mit
          Platzhaltern (Ansicht „Soll &amp; Übersicht"); die echten Namen
          werden später in die Platzhalter eingetragen.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          Saison
          <select
            value={saisonJahr}
            onChange={(e) => {
              setSaisonJahr(Number(e.target.value));
              setAusgewaehlt([]);
              platzhalterBefuellenAbbrechen();
            }}
          >
            {saisonJahre.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <div className="flex overflow-hidden rounded border border-linie">
          {(
            [
              ["liste", "Namensliste"],
              ["soll", "Soll & Übersicht"],
              ["zeitstrahl", "Anreise-Zeitstrahl"],
            ] as const
          ).map(([a, text]) => (
            <button
              key={a}
              type="button"
              className={`px-3 py-1.5 text-sm ${ansicht === a ? "bg-emerald-700 text-white" : "bg-white text-neutral-700 hover:bg-emerald-50"}`}
              onClick={() => setAnsicht(a)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {ansicht === "soll" &&
        (loading ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : (
          <PersonalplanungSoll
            saisonJahr={saisonJahr}
            herkuenfte={herkuenfte}
            einsatzbereiche={einsatzbereiche}
            kandidaten={saisonKandidaten}
            sollPlan={sollPlan}
            zeitraeume={zeitraeume}
            canEdit={canEdit}
            bereich={bereiche.standard}
            onGeaendert={load}
          />
        ))}

      {ansicht === "zeitstrahl" &&
        (loading ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : (
          <PersonalplanungZeitstrahl
            saisonJahr={saisonJahr}
            herkuenfte={herkuenfte}
            kandidaten={saisonKandidaten}
            sollGesamt={sollPlan
              .filter((p) => p.saison_jahr === saisonJahr)
              .reduce((sm, p) => sm + p.soll_anzahl, 0)}
            einsatzbereiche={einsatzbereiche}
            zeitraeume={zeitraeume}
          />
        ))}

      {canEdit && ansicht === "liste" && (
        <form
          onSubmit={handleSubmit}
          className={`flex flex-col gap-3 rounded border bg-white p-4 ${zielPlatzhalter ? "border-emerald-400 ring-2 ring-emerald-200" : "border-linie"}`}
        >
          {zielPlatzhalter && (
            <div className="flex flex-wrap items-center gap-2 rounded bg-emerald-50 px-2 py-1.5 text-sm text-emerald-900">
              Namen für einen Platzhalter
              {zielPlatzhalter.herkunft ? ` (${zielPlatzhalter.herkunft})` : ""}{" "}
              eintragen – Anreise, Einsatzbereich und Notiz des Platzhalters bleiben
              erhalten.
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={platzhalterBefuellenAbbrechen}
              >
                Abbrechen
              </button>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-neutral-700">
              Bereits einmal hier gewesen?
            </label>
            {verknuepfterEmployee ? (
              <div className="flex flex-col gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  Verknüpft mit {verknuepfterEmployee.name},{" "}
                  {verknuepfterEmployee.vorname} (
                  {verknuepfterEmployee.personal_nr}
                  {!verknuepfterEmployee.aktiv ? ", inaktiv" : ""})
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={verknuepfungLoesen}
                  >
                    Verknüpfung lösen
                  </button>
                </div>
                <div className="text-xs text-neutral-600">
                  {historieKurz(saisonHistorie[verknuepfterEmployee.id]) ??
                    "keine Saison-Historie hinterlegt"}
                </div>
              </div>
            ) : (
              <div className="relative">
                <input
                  placeholder="Name, Personalnummer oder Geburtsdatum (TT.MM.JJJJ) suchen, um eine bekannte Person zu verknüpfen…"
                  value={employeeSuche}
                  onChange={(e) => setEmployeeSuche(e.target.value)}
                  className="w-full"
                />
                {employeeTreffer.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded border border-linie bg-white shadow-md">
                    {employeeTreffer.map((e) => (
                      <button
                        type="button"
                        key={e.id}
                        className="flex w-full items-center justify-between px-2 py-1 text-left text-sm hover:bg-emerald-50"
                        onClick={() => personVerknuepfen(e)}
                      >
                        <span>
                          {e.name}, {e.vorname} ({e.personal_nr})
                          {e.geburtsdatum
                            ? ` · geb. ${formatDatumDE(e.geburtsdatum)}`
                            : ""}
                          {!e.aktiv ? " · inaktiv" : ""}
                          {historieKurz(saisonHistorie[e.id]) && (
                            <span className="text-neutral-500">
                              {" "}
                              · {historieKurz(saisonHistorie[e.id])}
                            </span>
                          )}
                        </span>
                        {e.schwarze_liste && (
                          <span className="font-medium text-beere-600">
                            ⚠ Schwarze Liste
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!verknuepfterEmployee && formAehnliche.length > 0 && (
              <div className="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm text-amber-900">
                <span className="font-medium">
                  Ähnliche Person im Personalstamm gefunden – war sie schon
                  einmal hier?
                </span>
                {formAehnliche.map(({ emp, grund }) => (
                  <div key={emp.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {emp.name}, {emp.vorname} ({emp.personal_nr}
                      {emp.geburtsdatum
                        ? `, geb. ${formatDatumDE(emp.geburtsdatum)}`
                        : ""}
                      {!emp.aktiv ? ", inaktiv" : ""})
                      <span className="text-xs text-amber-700">
                        {" "}
                        –{" "}
                        {grund === "name"
                          ? "gleicher Name"
                          : "gleiches Geburtsdatum, ähnlicher Name"}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => personVerknuepfen(emp)}
                    >
                      Verknüpfen
                    </button>
                  </div>
                ))}
              </div>
            )}
            {verknuepfterEmployee?.schwarze_liste && (
              <p className="rounded border border-beere-300 bg-beere-50 px-3 py-2 text-sm font-medium text-beere-800">
                ⚠ Diese Person steht auf der Schwarzen Liste
                {verknuepfterEmployee.schwarze_liste_grund
                  ? `: ${verknuepfterEmployee.schwarze_liste_grund}`
                  : "."}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 flex flex-col gap-1">
              <div className="flex gap-2">
                <input
                  placeholder="Personalnummer (reserviert)"
                  required
                  value={form.personal_nr}
                  disabled={!!verknuepfterId}
                  onChange={(e) =>
                    setForm({ ...form, personal_nr: e.target.value })
                  }
                />
                {!verknuepfterId && (
                  <>
                    <select
                      value={naechsteKreis}
                      onChange={(e) => setNaechsteKreis(e.target.value)}
                    >
                      {Array.from(
                        { length: ANZAHL_PERSONALNUMMERN_KREISE },
                        (_, i) => i + 1
                      ).map((kreis) => {
                        const [von, bis] = kreisBereich(kreis);
                        return (
                          <option key={kreis} value={kreis}>
                            Kreis {kreis} ({von}-{bis})
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
                <span className="text-xs text-beere-600">
                  Bereits vergeben an {personalNrKonflikt}
                </span>
              )}
            </div>
            <input
              placeholder="Name"
              required
              disabled={!!verknuepfterId}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              placeholder="Vorname"
              required
              disabled={!!verknuepfterId}
              value={form.vorname}
              onChange={(e) => setForm({ ...form, vorname: e.target.value })}
            />
            <input
              type="date"
              placeholder="Geburtsdatum"
              disabled={!!verknuepfterId}
              value={form.geburtsdatum}
              onChange={(e) =>
                setForm({ ...form, geburtsdatum: e.target.value })
              }
            />
            <input
              placeholder="Staatsangehörigkeit"
              value={form.nationalitaet}
              onChange={(e) =>
                setForm({ ...form, nationalitaet: e.target.value })
              }
            />
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
            <select
              value={form.einsatzbereich}
              onChange={(e) =>
                setForm({ ...form, einsatzbereich: e.target.value })
              }
            >
              <option value="">— Einsatzbereich —</option>
              {einsatzbereiche.map((b) => (
                <option key={b.wert} value={b.wert}>
                  {b.wert}
                </option>
              ))}
            </select>
            {firmen.filter((f) => f.bereich === bereiche.standard && f.aktiv !== false).length > 1 && (
              <select
                value={form.firma}
                onChange={(e) => setForm({ ...form, firma: e.target.value })}
                title="Firma, bei der die Person in dieser Saison angestellt wird"
              >
                <option value="">
                  Firma: Standard ({firmaKurz(firmen, standardFirma(firmen, bereiche.standard)?.kuerzel)})
                </option>
                {firmen
                  .filter((f) => f.bereich === bereiche.standard && f.aktiv !== false)
                  .map((f) => (
                    <option key={f.kuerzel} value={f.kuerzel}>
                      {firmaKurz(firmen, f.kuerzel)}
                    </option>
                  ))}
              </select>
            )}
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Geplante Ankunft
              <input
                type="date"
                value={form.geplante_ankunft}
                onChange={(e) =>
                  setForm({ ...form, geplante_ankunft: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Stundenlohn € (für Arbeitsvertrag)
              {lohnSatz?.mindestlohn != null && (
                <span className="text-[10px] text-neutral-400">
                  Vorschlag: Mindestlohn {lohnSatz.saison_jahr} (Saison{" "}
                  {saisonJahr})
                </span>
              )}
              <input
                type="number"
                step="0.01"
                value={form.stundenlohn}
                onChange={(e) =>
                  setForm({ ...form, stundenlohn: e.target.value })
                }
              />
            </label>
            <div className="col-span-2 flex flex-col gap-1">
              <span className="text-xs text-neutral-500">
                Führerschein (Selbstauskunft)
              </span>
              <div className="flex flex-wrap gap-3">
                {FUEHRERSCHEIN_KATEGORIEN.map((kategorie) => (
                  <label key={kategorie} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={form.fuehrerschein.includes(kategorie)}
                      onChange={() => toggleFuehrerschein(kategorie)}
                    />
                    {kategorie}
                  </label>
                ))}
              </div>
            </div>
            <input
              placeholder="Notiz"
              className="col-span-2"
              value={form.notiz}
              onChange={(e) => setForm({ ...form, notiz: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="btn"
              disabled={saving || !!personalNrKonflikt}
            >
              {zielPlatzhalter
                ? "In Platzhalter eintragen"
                : `Kandidat anlegen (Saison ${saisonJahr})`}
            </button>
            {!zielPlatzhalter && freieAutoPlatzhalter > 0 && (
              <label className="flex items-center gap-1 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={platzhalterErsetzen}
                  onChange={(e) => setPlatzhalterErsetzen(e.target.checked)}
                />
                ersetzt einen der {freieAutoPlatzhalter} Platzhalter von{" "}
                {form.herkunft}
              </label>
            )}
            {error && <span className="text-sm text-beere-600">{error}</span>}
          </div>
        </form>
      )}

      {canEdit && ansicht === "liste" && ausgewaehlt.length > 0 && (
        <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2">
          <span className="text-sm font-medium text-emerald-800">
            {ausgewaehlt.length} markiert
          </span>
          <span className="flex items-center gap-1">
            <input
              type="date"
              value={sammelDatum}
              onChange={(e) => setSammelDatum(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={sammelLaeuft || !sammelDatum}
              onClick={() =>
                anreiseSetzen(
                  kandidaten.filter((k) => ausgewaehlt.includes(k.id)),
                  sammelDatum
                )
              }
            >
              Anreise setzen
            </button>
          </span>
          <span className="flex items-center gap-1">
            <select
              value={sammelBereich}
              onChange={(e) => setSammelBereich(e.target.value)}
            >
              <option value="">— Einsatzbereich —</option>
              {einsatzbereiche.map((b) => (
                <option key={b.wert} value={b.wert}>
                  {b.wert}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={sammelLaeuft || !sammelBereich}
              onClick={() => sammelSpeichern({ einsatzbereich: sammelBereich })}
            >
              Einsatzbereich setzen
            </button>
          </span>
          {firmen.length > 1 && (
            <span className="flex items-center gap-1">
              <select value={sammelFirma} onChange={(e) => setSammelFirma(e.target.value)}>
                <option value="">Firma: Standard</option>
                {firmen
                  .filter(
                    (f) =>
                      f.aktiv !== false &&
                      ausgewaehlt.every(
                        (id) =>
                          (kandidaten.find((k) => k.id === id)?.bereich ?? "LW") === f.bereich
                      )
                  )
                  .map((f) => (
                  <option key={f.kuerzel} value={f.kuerzel}>
                    {firmaKurz(firmen, f.kuerzel)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={sammelLaeuft}
                onClick={() => sammelSpeichern({ firma: sammelFirma || null })}
                title="Geplante Firma der markierten Kandidaten (wird bei 'Anreise vorbereiten' für die Saison übernommen)"
              >
                Firma setzen
              </button>
            </span>
          )}
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={sammelLaeuft}
            onClick={() => sammelSpeichern({ reserve: true })}
          >
            Als Reserve
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={sammelLaeuft}
            onClick={() => sammelSpeichern({ reserve: false })}
          >
            Zusagen
          </button>
          {ausgewaehlt.some(
            (id) => kandidaten.find((k) => k.id === id)?.platzhalter
          ) && (
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={sammelLaeuft}
              onClick={sammelEntfernenPlatzhalter}
            >
              Platzhalter entfernen
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={aktivierenLaufend}
            onClick={anreiseVorbereiten}
          >
            Anreise vorbereiten
          </button>
          <button
            type="button"
            className="text-xs text-neutral-600 underline"
            onClick={() => setAusgewaehlt([])}
          >
            Markierung aufheben
          </button>
          {error && <span className="text-sm text-beere-600">{error}</span>}
        </div>
      )}

      {ansicht !== "liste" ? null : loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : geplante.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Keine geplanten Kandidaten für die Saison {saisonJahr}. Mit Zahlen
          der Vermittler planen: Ansicht „Soll &amp; Übersicht" → Platzhalter
          anlegen.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() =>
                setEingeklappt(new Set(gruppen.map((gr) => gr.key)))
              }
            >
              Alle einklappen
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setEingeklappt(new Set())}
            >
              Alle ausklappen
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() =>
                  setTerminePanel(terminePanel === "__alle__" ? null : "__alle__")
                }
              >
                Anreise für ALLE setzen
              </button>
            )}
            {canEdit && veralteterLohn.length > 0 && mindestlohnSaison !== null && (
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={sammelLaeuft}
                title="Personen dieser Saison, die noch den Mindestlohn eines anderen Jahres stehen haben (bewusst abweichende Löhne bleiben unberührt)"
                onClick={mindestlohnSaisonUebernehmen}
              >
                Mindestlohn {saisonJahr} übernehmen ({veralteterLohn.length})
              </button>
            )}
          </div>
          {terminePanel === "__alle__" &&
            terminePanelJsx(geplante, `alle ${geplante.length} Kandidaten`)}
          {/* Farblegende der Einsatzbereiche - Klick filtert die Liste */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-1 text-neutral-500">Einsatzbereich:</span>
            {[
              ...einsatzbereiche.map((b) => ({
                wert: b.wert,
                text: b.wert,
                n: geplante.filter((k) => k.einsatzbereich === b.wert).length,
              })),
              {
                wert: "__ohne__",
                text: "ohne Bereich",
                n: geplante.filter((k) => !k.einsatzbereich).length,
              },
            ]
              .filter((x) => x.n > 0 || bereichFilter === x.wert)
              .map((x) => {
                const aktiv = bereichFilter === x.wert;
                return (
                  <button
                    key={x.wert}
                    type="button"
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${aktiv ? "border-emerald-700 bg-emerald-700 text-white" : "border-linie bg-white text-neutral-700 hover:bg-emerald-50"}`}
                    onClick={() => setBereichFilter(aktiv ? null : x.wert)}
                    title={aktiv ? "Filter aufheben" : `Nur ${x.text} anzeigen`}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{
                        background: bereichFarbe(
                          einsatzbereiche,
                          x.wert === "__ohne__" ? null : x.wert
                        ),
                      }}
                    />
                    {x.text} ({x.n})
                  </button>
                );
              })}
            {bereichFilter && (
              <button
                type="button"
                className="ml-1 text-neutral-600 underline"
                onClick={() => setBereichFilter(null)}
              >
                alle zeigen
              </button>
            )}
          </div>
          {gruppen.map((g) => {
            const zu = eingeklappt.has(g.key);
            const anreisen = [
              ...new Set(
                g.liste
                  .map((k) => k.geplante_ankunft)
                  .filter((d): d is string => !!d)
              ),
            ].sort();
            const anreiseText =
              anreisen.length === 0
                ? "nicht gesetzt"
                : anreisen.length === 1
                  ? formatDatumDE(anreisen[0])
                  : `${formatDatumDE(anreisen[0])} – ${formatDatumDE(anreisen[anreisen.length - 1])} (${anreisen.length} Termine)`;
            return (
          <div key={g.key} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="flex items-center gap-2 text-left"
                aria-expanded={!zu}
                onClick={() => toggleGruppe(g.key)}
              >
                <span className="w-4 text-emerald-700">{zu ? "▸" : "▾"}</span>
                <h2 className="text-base font-semibold text-emerald-800">
                  {g.anzeige} ({g.liste.length})
                </h2>
              </button>
              <span className="text-sm text-neutral-600">
                Geplante Anreise: {anreiseText}
              </span>
              {g.key !== "__ohne__" &&
                (() => {
                  const soll = sollVon(g.key);
                  const alle = saisonKandidaten.filter(
                    (k) => k.herkunft === g.key
                  );
                  const zu = alle.filter(istZugesagt);
                  const ph = zu.filter((k) => k.platzhalter).length;
                  const res = alle.filter((k) => k.reserve).length;
                  const fs = zu.filter(hatFuehrerscheinB).length;
                  const fsZiel = fuehrerscheinZiel(soll > 0 ? soll : zu.length);
                  const diff = zu.length - soll;
                  return (
                    <span className="flex flex-wrap gap-x-3 text-sm">
                      <span
                        className={
                          soll === 0
                            ? "text-neutral-500"
                            : diff === 0
                              ? "text-emerald-700"
                              : diff < 0
                                ? "text-amber-700"
                                : "text-beere-600"
                        }
                        title="Zugesagt (Namen + Platzhalter, inkl. schon auf der Anreiseliste) / Soll"
                      >
                        {zu.length} / Soll {soll || "—"}
                        {soll > 0 && diff !== 0 && ` (${diff > 0 ? "+" : ""}${diff})`}
                      </span>
                      {ph > 0 && (
                        <span className="text-neutral-500">
                          {ph} Platzhalter
                        </span>
                      )}
                      {res > 0 && (
                        <span className="text-neutral-500">{res} Reserve</span>
                      )}
                      {fsZiel > 0 && (
                        <span
                          className={
                            fs >= fsZiel ? "text-emerald-700" : "text-amber-700"
                          }
                          title="Führerschein B (oder höher): vorhanden / Ziel (pro 5 Personen eine)"
                        >
                          {fs >= fsZiel ? "✓" : "⚠"} Führerschein {fs}/{fsZiel}
                        </span>
                      )}
                    </span>
                  );
                })()}
              {canEdit && (
                <label className="flex items-center gap-1 text-xs text-neutral-600">
                  <input
                    type="checkbox"
                    checked={g.liste.every((k) => ausgewaehlt.includes(k.id))}
                    ref={(el) => {
                      if (el) {
                        const n = g.liste.filter((k) =>
                          ausgewaehlt.includes(k.id)
                        ).length;
                        el.indeterminate = n > 0 && n < g.liste.length;
                      }
                    }}
                    onChange={() => toggleGruppeAuswahl(g.liste)}
                  />
                  alle auswählen
                </label>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() =>
                    setTerminePanel(terminePanel === g.key ? null : g.key)
                  }
                >
                  Anreise für alle setzen
                </button>
              )}
            </div>
            {terminePanel === g.key &&
              terminePanelJsx(g.liste, `alle ${g.liste.length} in ${g.anzeige}`)}
            {!zu && (
            <table>
              <thead>
                <tr>
                  {canEdit && <th></th>}
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Vorname</th>
                  <th>Geburtsdatum</th>
                  <th>Geplante Ankunft</th>
                  <th>Stundenlohn €</th>
                  <th>Einsatzbereich</th>
                  <th title="Geplante Firma für die Saison (leer = Standard-Firma des Bereichs)">
                    Firma
                  </th>
                  <th>Führerschein</th>
                  <th title="Mehr Namen als Soll: Reserve zählt nicht ins Ist, den Zeitstrahl und die Bettenplanung">
                    Reserve
                  </th>
                  <th>Verknüpft</th>
                  <th>Notiz</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {g.liste.map((k) => {
                  const blacklisted = schwarzeListeVon(
                    k.verknuepfter_employee_id
                  );
                  const platzhalterNr =
                    g.liste.filter((x) => x.platzhalter).indexOf(k) + 1;
                  return (
                    <Fragment key={k.id}>
                    <tr
                      className={k.reserve ? "opacity-60" : undefined}
                      style={
                        k.einsatzbereich
                          ? {
                              backgroundColor: `${bereichFarbe(einsatzbereiche, k.einsatzbereich)}1f`,
                            }
                          : undefined
                      }
                    >
                      {canEdit && (
                        <td
                          style={{
                            borderLeft: `5px solid ${k.einsatzbereich ? bereichFarbe(einsatzbereiche, k.einsatzbereich) : "transparent"}`,
                          }}
                        >
                          <input
                            type="checkbox"
                            title="Shift-Klick markiert einen ganzen Bereich"
                            checked={ausgewaehlt.includes(k.id)}
                            readOnly
                            onClick={(e) => toggleAusgewaehlt(k.id, e.shiftKey)}
                          />
                        </td>
                      )}
                      <td
                        style={
                          canEdit
                            ? undefined
                            : {
                                borderLeft: `5px solid ${k.einsatzbereich ? bereichFarbe(einsatzbereiche, k.einsatzbereich) : "transparent"}`,
                              }
                        }
                      >
                        {k.personal_nr ?? "—"}
                      </td>
                      <td>
                        {k.platzhalter ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="italic text-neutral-500">
                              N.N. – Platzhalter {platzhalterNr}
                            </span>
                            {canEdit && (
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => platzhalterBefuellen(k)}
                              >
                                Namen eintragen
                              </button>
                            )}
                          </span>
                        ) : (
                          k.name
                        )}
                        {k.reserve && (
                          <span className="ml-1.5 rounded bg-neutral-200 px-1 py-0.5 align-middle text-[10px] font-semibold uppercase text-neutral-700">
                            Reserve
                          </span>
                        )}
                        {(() => {
                          if (k.verknuepfter_employee_id) return null;
                          const aehnlich = aehnlicheZu(k);
                          if (aehnlich.length === 0) {
                            return (
                              <span
                                className="ml-1.5 rounded bg-emerald-100 px-1 py-0.5 align-middle text-[10px] font-semibold uppercase text-emerald-800"
                                title="Noch nie hier gewesen"
                              >
                                neu
                              </span>
                            );
                          }
                          const a = aehnlich[0].emp;
                          return (
                            <span
                              className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 align-middle text-[10px] font-semibold text-amber-800"
                              title={`Ähnliche Person im Personalstamm: ${a.name}, ${a.vorname} (${a.personal_nr}${a.geburtsdatum ? `, geb. ${formatDatumDE(a.geburtsdatum)}` : ""}) - evtl. war die Person schon hier, dann bitte verknüpfen`}
                            >
                              schon bekannt?
                            </span>
                          );
                        })()}
                      </td>
                      <td>{k.vorname ?? ""}</td>
                      <td>{formatDatumDE(k.geburtsdatum)}</td>
                      {(
                        [
                          ["geplante_ankunft", "date"],
                          ["stundenlohn", "number"],
                        ] as const
                      ).map(([feld, typ]) => (
                        <td key={feld}>
                          {canEdit ? (
                            <input
                              key={`${k.id}-${feld}-${k[feld] ?? ""}`}
                              type={typ}
                              step={typ === "number" ? "0.01" : undefined}
                              defaultValue={k[feld] ?? ""}
                              className={typ === "number" ? "w-20" : undefined}
                              onBlur={(e) =>
                                vertragsfeldSpeichern(k, feld, e.target.value)
                              }
                            />
                          ) : feld === "stundenlohn" ? (
                            k.stundenlohn != null ? formatEuro(k.stundenlohn) : "—"
                          ) : (
                            formatDatumDE(k[feld])
                          )}
                        </td>
                      ))}
                      <td>
                        {canEdit ? (
                          <select
                            value={k.einsatzbereich ?? ""}
                            onChange={(e) =>
                              zeileSpeichern(k, {
                                einsatzbereich: e.target.value || null,
                              })
                            }
                          >
                            <option value="">—</option>
                            {einsatzbereiche.map((b) => (
                              <option key={b.wert} value={b.wert}>
                                {b.wert}
                              </option>
                            ))}
                          </select>
                        ) : (
                          k.einsatzbereich ?? "—"
                        )}
                      </td>
                      <td className="text-xs">
                        {k.firma ? firmaKurz(firmen, k.firma) : "Standard"}
                      </td>
                      <td>
                        {k.platzhalter && canEdit ? (
                          <label
                            className="flex items-center gap-1 text-xs"
                            title="Für diesen Platzhalter eine Person mit Führerschein B einplanen"
                          >
                            <input
                              type="checkbox"
                              checked={hatFuehrerscheinB(k)}
                              onChange={(e) =>
                                zeileSpeichern(k, {
                                  fuehrerschein_kategorien: e.target.checked
                                    ? ["B"]
                                    : null,
                                })
                              }
                            />
                            B geplant
                          </label>
                        ) : k.fuehrerschein_kategorien &&
                          k.fuehrerschein_kategorien.length > 0 ? (
                          k.fuehrerschein_kategorien.join(", ")
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {canEdit ? (
                          <input
                            type="checkbox"
                            checked={k.reserve}
                            onChange={(e) =>
                              zeileSpeichern(k, { reserve: e.target.checked })
                            }
                          />
                        ) : k.reserve ? (
                          "Ja"
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {k.verknuepfter_employee_id ? (
                          blacklisted ? (
                            <span
                              className="font-medium text-beere-600"
                              title={blacklisted.schwarze_liste_grund ?? undefined}
                            >
                              ⚠ Schwarze Liste
                            </span>
                          ) : (
                            <span className="text-emerald-700">Ja</span>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{k.notiz ?? "—"}</td>
                      {canEdit && (
                        <td>
                          <div className="flex gap-1">
                            {!k.platzhalter && (
                            <button
                              type="button"
                              className="btn-secondary px-2 py-1"
                              title="Bearbeiten"
                              aria-label="Bearbeiten"
                              onClick={() =>
                                bearbeitenId === k.id
                                  ? setBearbeitenId(null)
                                  : bearbeitenStarten(k)
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            )}
                            <button
                              type="button"
                              className="btn-secondary px-2 py-1 text-beere-600"
                              title="Entfernen"
                              aria-label="Entfernen"
                              onClick={() => entfernen(k)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {bearbeitenId === k.id && bearbeitenForm && (
                      <tr>
                        <td colSpan={15}>
                          <div className="flex flex-col gap-3 rounded border border-linie bg-sand p-3">
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                Name
                                <input
                                  value={bearbeitenForm.name}
                                  onChange={(e) =>
                                    setBearbeitenForm({
                                      ...bearbeitenForm,
                                      name: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                Vorname
                                <input
                                  value={bearbeitenForm.vorname}
                                  onChange={(e) =>
                                    setBearbeitenForm({
                                      ...bearbeitenForm,
                                      vorname: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                Geburtsdatum
                                <input
                                  type="date"
                                  value={bearbeitenForm.geburtsdatum}
                                  onChange={(e) =>
                                    setBearbeitenForm({
                                      ...bearbeitenForm,
                                      geburtsdatum: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                Staatsangehörigkeit
                                <input
                                  value={bearbeitenForm.nationalitaet}
                                  onChange={(e) =>
                                    setBearbeitenForm({
                                      ...bearbeitenForm,
                                      nationalitaet: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                Herkunft
                                <select
                                  value={bearbeitenForm.herkunft}
                                  onChange={(e) =>
                                    setBearbeitenForm({
                                      ...bearbeitenForm,
                                      herkunft: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">— keine Herkunft —</option>
                                  {herkuenfte.map((h) => (
                                    <option key={h.wert} value={h.wert}>
                                      {h.wert}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div className="col-span-2 flex flex-col gap-1">
                                <span className="text-xs text-neutral-500">
                                  Führerschein (Selbstauskunft)
                                </span>
                                <div className="flex flex-wrap gap-3">
                                  {FUEHRERSCHEIN_KATEGORIEN.map((kategorie) => (
                                    <label
                                      key={kategorie}
                                      className="flex items-center gap-1 text-sm"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={bearbeitenForm.fuehrerschein.includes(
                                          kategorie
                                        )}
                                        onChange={() =>
                                          setBearbeitenForm({
                                            ...bearbeitenForm,
                                            fuehrerschein:
                                              bearbeitenForm.fuehrerschein.includes(
                                                kategorie
                                              )
                                                ? bearbeitenForm.fuehrerschein.filter(
                                                    (x) => x !== kategorie
                                                  )
                                                : [
                                                    ...bearbeitenForm.fuehrerschein,
                                                    kategorie,
                                                  ],
                                          })
                                        }
                                      />
                                      {kategorie}
                                    </label>
                                  ))}
                                </div>
                              </div>
                              <label className="col-span-2 flex flex-col gap-0.5 text-xs text-neutral-500">
                                Notiz
                                <input
                                  value={bearbeitenForm.notiz}
                                  onChange={(e) =>
                                    setBearbeitenForm({
                                      ...bearbeitenForm,
                                      notiz: e.target.value,
                                    })
                                  }
                                />
                              </label>
                            </div>
                            {!k.aktivierter_employee_id && !k.verknuepfter_employee_id && (
                              <div className="flex flex-wrap items-end gap-2">
                                <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                  Personalnummer
                                  <input
                                    value={bearbeitenForm.personal_nr}
                                    onChange={(e) =>
                                      setBearbeitenForm({
                                        ...bearbeitenForm,
                                        personal_nr: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="btn-secondary text-xs"
                                  onClick={() => {
                                    const frei = naechsteFreieFuer(bearbeitenForm.personal_nr);
                                    if (frei) setBearbeitenForm({ ...bearbeitenForm, personal_nr: frei });
                                  }}
                                >
                                  nächste freie im Kreis
                                </button>
                                {bearbeitenForm.personal_nr.trim() !== (k.personal_nr ?? "") &&
                                  nrVergebenAn(bearbeitenForm.personal_nr, k.id) && (
                                    <span className="text-xs text-beere-600">
                                      schon vergeben an {nrVergebenAn(bearbeitenForm.personal_nr, k.id)}
                                    </span>
                                  )}
                              </div>
                            )}
                            <p className="text-xs text-neutral-500">
                              Geplante Anreise und Stundenlohn lassen sich
                              direkt in der Zeile ändern. Die Personalnummer
                              lässt sich nur ändern, solange der Kandidat noch
                              nicht mit dem Personalstamm verknüpft ist.
                              Arbeitsbeginn/-ende werden in der Anreiseliste
                              erfasst.
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="btn text-xs"
                                disabled={saving}
                                onClick={bearbeitenSpeichern}
                              >
                                Speichern
                              </button>
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => setBearbeitenId(null)}
                              >
                                Abbrechen
                              </button>
                            </div>
                          </div>
                        </td>
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
          })}
        </>
      )}

      {fotoWarteschlange.length > 0 && (
        <DokumentKameraAufnahme
          key={fotoWarteschlange[0].id}
          employeeId={fotoWarteschlange[0].id}
          name={fotoWarteschlange[0].name}
          vorname={fotoWarteschlange[0].vorname}
          modus="ausweis"
          dokumentKategorie="Ausweiskopie"
          onFertig={fotoWarteschlangeWeiter}
          onAbbrechen={fotoWarteschlangeAbbrechen}
        />
      )}
    </div>
  );
}
