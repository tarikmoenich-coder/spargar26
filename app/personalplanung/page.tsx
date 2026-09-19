"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  ANZAHL_PERSONALNUMMERN_KREISE,
  kreisBereich,
  naechsteFreieNummer,
  parsePersonalNrNummer,
} from "@/lib/personalnummern";
import { formatDatumDE } from "@/lib/format";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { satzFuerJahr } from "@/lib/satzFuerJahr";
import {
  arbeitsendeAuto,
  endeFolgtBeginn,
  inBloecken,
} from "@/lib/planungTermine";
import { historieKurz } from "@/lib/saisonHistorie";
import {
  baueIndex,
  findeAehnliche,
  normalisiereName,
} from "@/lib/personalAehnlich";
import {
  FUEHRERSCHEIN_KATEGORIEN,
  type Employee,
  type EmployeeSaisonHistorieAgg,
  type Herkunft,
  type PersonalKandidat,
  type UnterkunftHerkunftKontingent,
  type VerpflegungsSatz,
} from "@/lib/types";
import PersonalTabs from "@/components/PersonalTabs";

const emptyForm = {
  personal_nr: "",
  name: "",
  vorname: "",
  geburtsdatum: "",
  nationalitaet: "",
  herkunft: "",
  stundenlohn: "",
  geplante_ankunft: "",
  arbeitsbeginn: "",
  arbeitsende: "",
  fuehrerschein: [] as string[],
  notiz: "",
};

export default function PersonalplanungPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

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
  // Für die Vorbelegung des Stundenlohns mit dem Mindestlohn (siehe
  // Einstellungen-Seite).
  const [saetze, setSaetze] = useState<VerpflegungsSatz[]>([]);
  // Einklappbare Herkunfts-Gruppen (Schlüssel = Herkunft bzw. "__ohne__").
  const [eingeklappt, setEingeklappt] = useState<Set<string>>(new Set());
  // Termine für alle setzen: Gruppen-Schlüssel oder "__alle__".
  const [terminePanel, setTerminePanel] = useState<string | null>(null);
  const [terminAnreise, setTerminAnreise] = useState("");
  const [terminBeginn, setTerminBeginn] = useState("");
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
  } | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [
      { data: kData },
      eList,
      { data: hData },
      { data: vData },
      { data: shData },
    ] = await Promise.all([
      supabase
        .from("personal_kandidaten")
        .select("*")
        .order("herkunft")
        .order("name"),
      // Seitenweise inkl. inaktiver Personen - sonst schneidet PostgREST bei
      // ~1000 Zeilen ab (seit dem Historie-Import tausende inaktive) und
      // Rückkehrer wären hier nicht mehr zu finden bzw. die "belegt"-Zählung
      // der Personalnummern wäre falsch.
      ladeAlleSeiten<Employee>((von, bis) =>
        supabase
          .from("employees")
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
      supabase.from("employee_saison_historie_agg").select("*"),
    ]);
    setKandidaten((kData as PersonalKandidat[]) ?? []);
    setEmployees(eList);
    setHerkuenfte((hData as Herkunft[]) ?? []);
    setSaetze((vData as VerpflegungsSatz[]) ?? []);
    const shMap: Record<string, EmployeeSaisonHistorieAgg> = {};
    ((shData as EmployeeSaisonHistorieAgg[] | null) ?? []).forEach((r) => {
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
        const n = parsePersonalNrNummer(k.personal_nr);
        if (n !== null) belegt.add(n);
      });
    return belegt;
  }, [employees, kandidaten]);

  // Vorbelegt den Stundenlohn für NEUE (nicht verknüpfte) Kandidaten mit dem
  // Mindestlohn des LAUFENDEN Jahres (nicht dem neuesten Eintrag - sonst gälte
  // schon der Satz des Folgejahres, sobald der angelegt ist). Nur ein
  // Vorschlag: bei "Anreise vorbereiten" gilt für alle Sätze das dann
  // aktuelle Jahr (siehe anreiseVorbereiten). Bleibt frei änderbar; läuft
  // auch nach jedem load() erneut (Formular-Reset).
  const heuteJahr = new Date().getFullYear();
  const lohnSatz = satzFuerJahr(saetze, heuteJahr);
  useEffect(() => {
    if (verknuepfterId) return;
    if (form.stundenlohn !== "") return;
    if (lohnSatz?.mindestlohn == null) return;
    setForm((f) => ({ ...f, stundenlohn: String(lohnSatz.mindestlohn) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saetze]);

  function naechsteFreieUebernehmen() {
    const frei = naechsteFreieNummer(belegteNummern, Number(naechsteKreis));
    if (frei !== null) {
      setForm((f) => ({ ...f, personal_nr: frei.toString() }));
    }
  }

  const personalNrKonflikt = (() => {
    const typed = form.personal_nr.trim().toLowerCase();
    if (!typed || verknuepfterId) return null;
    const inEmployees = employees.find(
      (e) => e.personal_nr.trim().toLowerCase() === typed
    );
    if (inEmployees) {
      return `${inEmployees.name}, ${inEmployees.vorname} (Personal)`;
    }
    const inKandidaten = kandidaten.find(
      (k) =>
        k.status !== "storniert" &&
        k.personal_nr.trim().toLowerCase() === typed
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (personalNrKonflikt) return;
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("personal_kandidaten").insert({
      personal_nr: form.personal_nr,
      name: form.name,
      vorname: form.vorname,
      geburtsdatum: form.geburtsdatum || null,
      nationalitaet: form.nationalitaet || null,
      herkunft: form.herkunft || null,
      verknuepfter_employee_id: verknuepfterId,
      stundenlohn: form.stundenlohn ? Number(form.stundenlohn) : null,
      geplante_ankunft: form.geplante_ankunft || null,
      arbeitsbeginn_datum: form.arbeitsbeginn || null,
      arbeitsende_datum: form.arbeitsende || null,
      fuehrerschein_kategorien:
        form.fuehrerschein.length > 0 ? form.fuehrerschein : null,
      notiz: form.notiz || null,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(emptyForm);
    setVerknuepfterId(null);
    load();
  }

  function toggleAusgewaehlt(id: string) {
    setAusgewaehlt((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // Erzeugt aus jedem ausgewählten Kandidaten einen echten employees-
  // Datensatz (bei einer Verknüpfung wird die bestehende, ggf. inaktive
  // Person reaktiviert - Historie bleibt an einer ID, ADR-011; sonst neu
  // angelegt mit der reservierten Personalnummer) und verschiebt ihn in die
  // Anreiseliste (Personal → Anreiseliste), wo Vertragszeitraum, Dokumente
  // und die weiteren Unterlagen erfasst werden.
  async function anreiseVorbereiten() {
    if (ausgewaehlt.length === 0) return;
    if (
      !window.confirm(
        `${ausgewaehlt.length} Kandidat(en) jetzt aktivieren und in die Anreiseliste verschieben?\n\nAb jetzt gilt für alle Sätze das aktuelle Jahr ${heuteJahr}: Stundenlohn (sofern nicht individuell abweichend) und Tagessätze Wohnen/Verpflegung.`
      )
    ) {
      return;
    }
    setAktivierenLaufend(true);
    setError(null);
    const supabase = getSupabaseClient();
    const fehlerListe: string[] = [];

    // Herkunfts-Stammplätze laden: die reservierten Wohneinheiten je
    // (Saison, Herkunft) und die aktuelle Belegung/Planung je Wohneinheit.
    const jahre = [
      ...new Set(
        ausgewaehlt.map((id) => {
          const k = kandidaten.find((x) => x.id === id);
          return k?.geplante_ankunft
            ? new Date(k.geplante_ankunft).getFullYear()
            : new Date().getFullYear();
        })
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

    // Ab der Anreise gilt für ALLE Sätze das aktuelle Jahr (Nutzer-Vorgabe
    // 2026-09-19). Der bei der Planung eingetragene Stundenlohn ist nur
    // vorläufig: entspricht er einem Standard-Mindestlohn (irgendeines Jahres,
    // auch leer), wird er auf den des aktuellen Jahres gesetzt. Ein bewusst
    // abweichender Lohn (z.B. Vorarbeiter) bleibt unangetastet.
    const mindestHeute =
      satzFuerJahr(saetze, heuteJahr)?.mindestlohn != null
        ? Number(satzFuerJahr(saetze, heuteJahr)!.mindestlohn)
        : null;
    const istStandardLohn = (lohn: number | null) =>
      lohn === null ||
      saetze.some(
        (sz) => sz.mindestlohn != null && Number(sz.mindestlohn) === Number(lohn)
      );

    for (const id of ausgewaehlt) {
      const k = kandidaten.find((x) => x.id === id);
      if (!k || k.status !== "geplant") continue;
      let employeeId: string | null = null;
      const lohn =
        mindestHeute !== null && istStandardLohn(k.stundenlohn)
          ? mindestHeute
          : k.stundenlohn;
      if (k.verknuepfter_employee_id) {
        const { error } = await supabase
          .from("employees")
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
          .from("employees")
          .insert({
            personal_nr: k.personal_nr,
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
      }
      await supabase
        .from("personal_kandidaten")
        .update({
          status: "anreiseliste",
          aktivierter_employee_id: employeeId,
          stundenlohn: lohn,
        })
        .eq("id", k.id);

      // Person in das nächste freie reservierte Haus ihrer Herkunft setzen
      // (geplante Zimmerzuordnung, Wohneinheits-Ebene). Zimmer regelt der
      // Hausmeister bei der Ankunft.
      if (employeeId && k.herkunft) {
        const saisonJ = k.geplante_ankunft
          ? new Date(k.geplante_ankunft).getFullYear()
          : new Date().getFullYear();
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
              k.geplante_ankunft ?? new Date().toISOString().slice(0, 10),
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
    setAusgewaehlt([]);
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
    load();
  }

  // Einzelne Termin-/Vertragsdaten eines geplanten Kandidaten direkt in der
  // Liste ändern. Ein neuer Arbeitsbeginn zieht das Arbeitsende automatisch
  // nach (Beginn + 104 Tage), außer es wurde bewusst abweichend gesetzt.
  async function vertragsfeldSpeichern(
    k: PersonalKandidat,
    feld:
      | "geplante_ankunft"
      | "arbeitsbeginn_datum"
      | "arbeitsende_datum"
      | "stundenlohn",
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
    if (
      feld === "arbeitsbeginn_datum" &&
      typeof neu === "string" &&
      endeFolgtBeginn(k.arbeitsbeginn_datum, k.arbeitsende_datum)
    ) {
      payload.arbeitsende_datum = arbeitsendeAuto(neu);
    }
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

  // Geplante Anreise und/oder Arbeitsbeginn für viele Kandidaten auf einmal
  // setzen (eine Herkunfts-Gruppe oder alle). Das Arbeitsende folgt dem
  // Arbeitsbeginn automatisch (+104 Tage); individuell abweichende Enden
  // bleiben stehen.
  async function termineSetzen(ziele: PersonalKandidat[]) {
    if (ziele.length === 0 || (!terminAnreise && !terminBeginn)) return;
    setTerminLaeuft(true);
    setError(null);
    const supabase = getSupabaseClient();
    const fehler: string[] = [];
    const schreibe = async (
      ids: string[],
      payload: Record<string, string | null>
    ) => {
      for (const block of inBloecken(ids)) {
        const { error } = await supabase
          .from("personal_kandidaten")
          .update(payload)
          .in("id", block);
        if (error) fehler.push(error.message);
      }
    };
    if (terminAnreise) {
      await schreibe(
        ziele.map((k) => k.id),
        { geplante_ankunft: terminAnreise }
      );
    }
    if (terminBeginn) {
      const folgt = ziele.filter((k) =>
        endeFolgtBeginn(k.arbeitsbeginn_datum, k.arbeitsende_datum)
      );
      const bleibt = ziele.filter(
        (k) => !endeFolgtBeginn(k.arbeitsbeginn_datum, k.arbeitsende_datum)
      );
      await schreibe(
        folgt.map((k) => k.id),
        {
          arbeitsbeginn_datum: terminBeginn,
          arbeitsende_datum: arbeitsendeAuto(terminBeginn),
        }
      );
      await schreibe(
        bleibt.map((k) => k.id),
        { arbeitsbeginn_datum: terminBeginn }
      );
    }
    setTerminLaeuft(false);
    if (fehler.length > 0) {
      setError([...new Set(fehler)].join(" · "));
    } else {
      setTerminePanel(null);
      setTerminAnreise("");
      setTerminBeginn("");
    }
    load();
  }

  function bearbeitenStarten(k: PersonalKandidat) {
    setBearbeitenId(k.id);
    setBearbeitenForm({
      name: k.name,
      vorname: k.vorname,
      geburtsdatum: k.geburtsdatum ?? "",
      nationalitaet: k.nationalitaet ?? "",
      herkunft: k.herkunft ?? "",
      notiz: k.notiz ?? "",
      fuehrerschein: k.fuehrerschein_kategorien ?? [],
    });
  }

  async function bearbeitenSpeichern() {
    if (!bearbeitenId || !bearbeitenForm) return;
    const f = bearbeitenForm;
    setSaving(true);
    setError(null);
    const { error } = await getSupabaseClient()
      .from("personal_kandidaten")
      .update({
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

  const geplante = kandidaten.filter((k) => k.status === "geplant");

  function aehnlicheZu(k: PersonalKandidat) {
    if (k.verknuepfter_employee_id) return [];
    return findeAehnliche(personenIndex, k);
  }

  const gruppen = useMemo(() => {
    const buckets = new Map<string, PersonalKandidat[]>();
    for (const k of geplante) {
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
    return keys.map((key) => ({
      key,
      anzeige: key === "__ohne__" ? "Ohne Herkunft" : key,
      liste: buckets.get(key)!,
    }));
  }, [geplante, herkuenfte]);

  function schwarzeListeVon(empId: string | null) {
    if (!empId) return null;
    const e = employees.find((x) => x.id === empId);
    return e?.schwarze_liste ? e : null;
  }

  // Kleines Formular "Termine für alle setzen" - einmal für alle Kandidaten
  // oder für eine Herkunfts-Gruppe.
  function terminePanelJsx(ziele: PersonalKandidat[], bezeichnung: string) {
    return (
      <div className="flex flex-col gap-2 rounded border border-emerald-300 bg-emerald-50 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
            Geplante Anreise
            <input
              type="date"
              value={terminAnreise}
              onChange={(e) => setTerminAnreise(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
            Arbeitsbeginn
            <input
              type="date"
              value={terminBeginn}
              onChange={(e) => setTerminBeginn(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn text-xs"
            disabled={terminLaeuft || (!terminAnreise && !terminBeginn)}
            onClick={() => termineSetzen(ziele)}
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
        <p className="text-xs text-neutral-600">
          Leere Felder bleiben unverändert. Das Arbeitsende wird automatisch auf
          Arbeitsbeginn + 104 Tage gesetzt; ein bewusst abweichendes Arbeitsende
          einzelner Personen bleibt stehen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Personalplanung
        </h1>
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
        </p>
      </div>

      {canEdit && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded border border-linie bg-white p-4"
        >
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
                          <span className="font-medium text-red-600">
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
              <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
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
                <span className="text-xs text-red-600">
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
              Arbeitsbeginn (Arbeitsvertrag)
              <input
                type="date"
                value={form.arbeitsbeginn}
                onChange={(e) => {
                  const beginn = e.target.value;
                  setForm((f) => ({
                    ...f,
                    arbeitsbeginn: beginn,
                    arbeitsende:
                      beginn && endeFolgtBeginn(f.arbeitsbeginn || null, f.arbeitsende || null)
                        ? arbeitsendeAuto(beginn)
                        : f.arbeitsende,
                  }));
                }}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Arbeitsende (automatisch Beginn + 104 Tage)
              <input
                type="date"
                value={form.arbeitsende}
                onChange={(e) =>
                  setForm({ ...form, arbeitsende: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Stundenlohn € (für Arbeitsvertrag)
              {lohnSatz?.mindestlohn != null && (
                <span className="text-[10px] text-neutral-400">
                  Vorschlag: Mindestlohn {lohnSatz.saison_jahr} (bei Anreise gilt
                  das dann aktuelle Jahr)
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

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="btn"
              disabled={saving || !!personalNrKonflikt}
            >
              Kandidat anlegen
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      )}

      {canEdit && ausgewaehlt.length > 0 && (
        <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex items-center gap-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2">
          <span className="text-sm font-medium text-emerald-800">
            {ausgewaehlt.length} ausgewählt
          </span>
          <button
            type="button"
            className="btn"
            disabled={aktivierenLaufend}
            onClick={anreiseVorbereiten}
          >
            Anreise vorbereiten
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : geplante.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Keine geplanten Kandidaten.
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
                Termine für ALLE setzen
              </button>
            )}
          </div>
          {terminePanel === "__alle__" &&
            terminePanelJsx(geplante, `alle ${geplante.length} Kandidaten`)}
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
              {canEdit && (
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() =>
                    setTerminePanel(terminePanel === g.key ? null : g.key)
                  }
                >
                  Termine für alle setzen
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
                  <th>Arbeitsbeginn</th>
                  <th>Arbeitsende</th>
                  <th>Stundenlohn €</th>
                  <th>Führerschein</th>
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
                  return (
                    <Fragment key={k.id}>
                    <tr>
                      {canEdit && (
                        <td>
                          <input
                            type="checkbox"
                            checked={ausgewaehlt.includes(k.id)}
                            onChange={() => toggleAusgewaehlt(k.id)}
                          />
                        </td>
                      )}
                      <td>{k.personal_nr}</td>
                      <td>
                        {k.name}
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
                      <td>{k.vorname}</td>
                      <td>{formatDatumDE(k.geburtsdatum)}</td>
                      {(
                        [
                          ["geplante_ankunft", "date"],
                          ["arbeitsbeginn_datum", "date"],
                          ["arbeitsende_datum", "date"],
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
                            k.stundenlohn ?? "—"
                          ) : (
                            formatDatumDE(k[feld])
                          )}
                        </td>
                      ))}
                      <td>
                        {k.fuehrerschein_kategorien &&
                        k.fuehrerschein_kategorien.length > 0
                          ? k.fuehrerschein_kategorien.join(", ")
                          : "—"}
                      </td>
                      <td>
                        {k.verknuepfter_employee_id ? (
                          blacklisted ? (
                            <span
                              className="font-medium text-red-600"
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
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() =>
                                bearbeitenId === k.id
                                  ? setBearbeitenId(null)
                                  : bearbeitenStarten(k)
                              }
                            >
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() => entfernen(k)}
                            >
                              Entfernen
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {bearbeitenId === k.id && bearbeitenForm && (
                      <tr>
                        <td colSpan={14}>
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
                            <p className="text-xs text-neutral-500">
                              Anreise, Arbeitsbeginn/-ende und Stundenlohn
                              lassen sich direkt in der Zeile ändern, die
                              Personalnummer bleibt fest.
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
    </div>
  );
}
