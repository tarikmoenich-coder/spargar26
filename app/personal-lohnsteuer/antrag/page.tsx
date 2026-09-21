"use client";

// Lohnsteuerabzug-Sammelantrag (Nutzer-Vorgabe 2026-09-17): erzeugt die vom
// Finanzamt Bensheim gelieferte Excel-Vorlage aus den Personaldaten, bündelt
// Personen zu einem Antrag je Steuerjahr, prüft die Vollständigkeit
// (Familienstand erfasst, Bescheinigung Doppelte Haushaltsführung als Scan
// bei allen, Hochzeitsurkunde/Ausweiskopie bei Bedarf, Heimatadresse/
// Geburtsdatum vorhanden) und erfasst nach Rückmeldung des Finanzamts
// genehmigt/abgelehnt je Person. Baut auf der bestehenden "Personal →
// Lohnsteuer"-Seite auf (doppelte_haushaltsfuehrung) - der Verfahrensstand
// dort wird beim Verschicken/bei der Rückmeldung automatisch mitgesetzt,
// keine zweite Statuslogik.
//
// Versand ans Finanzamt bleibt manuell (Nutzer-Entscheidung 2026-09-17): diese
// Seite erzeugt nur das Datei-Paket (Excel + hochgeladene Scans der
// Anlagen), verschickt wird per E-Mail/Post außerhalb der App.
//
// Korrektur 2026-09-17: die Bescheinigung Doppelte Haushaltsführung wurde
// zunächst als generierte Druckansicht aus den erfassten Angaben geplant
// (konsistent mit der 2026-08-11-Entscheidung "kein Upload nötig") - das
// Finanzamt braucht aber tatsächlich den unterschriebenen Original-Scan,
// daher jetzt ein echter Upload (eigene Dokument-Kategorie).

import PageHeader from "@/components/PageHeader";
import { FileText } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { useProfile } from "@/lib/useProfile";
import PersonalTabs from "@/components/PersonalTabs";
import FormularDokumentZelle from "@/components/FormularDokumentZelle";
import { formatDatumDE, formatEuro } from "@/lib/format";
import { berechneFreibetrag } from "@/lib/lohnsteuerantrag";
import { erzeugeLohnsteuerantragExcel } from "@/lib/lohnsteuerantragExcel";
import {
  LOHNSTEUERANTRAG_ERGEBNIS_LABELS,
  LOHNSTEUERANTRAG_STATUS_LABELS,
  type DoppelteHaushaltsfuehrung,
  type Employee,
  type EmployeeDocument,
  type FirmenBankdaten,
  type Lohnsteuerantrag,
  type LohnsteuerantragErgebnis,
  type LohnsteuerantragPosition,
} from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

interface Checkpunkt {
  ok: boolean;
  text: string;
}

function checkliste(
  position: LohnsteuerantragPosition,
  emp: Employee | undefined,
  dokumenteEmp: EmployeeDocument[],
  dhhEmp: DoppelteHaushaltsfuehrung | undefined
): Checkpunkt[] {
  const punkte: Checkpunkt[] = [];
  punkte.push({
    ok: !!dhhEmp?.familienstand,
    text: "Familienstand erfasst (Personal → Lohnsteuer)",
  });
  punkte.push({
    ok: dokumenteEmp.some(
      (d) => d.kategorie === "Doppelte Haushaltsführung Bescheinigung"
    ),
    text: "Bescheinigung Doppelte Haushaltsführung hochgeladen (Scan)",
  });
  if (dhhEmp?.familienstand === "verheiratet") {
    punkte.push({
      ok: dokumenteEmp.some((d) => d.kategorie === "Hochzeitsurkunde"),
      text: "Hochzeitsurkunde hochgeladen",
    });
  }
  if (!emp?.steuer_id) {
    punkte.push({
      ok: dokumenteEmp.some((d) => d.kategorie === "Ausweiskopie"),
      text: "Ausweiskopie hochgeladen (keine Steuer-ID vorhanden)",
    });
  }
  punkte.push({ ok: !!emp?.geburtsdatum, text: "Geburtsdatum erfasst" });
  punkte.push({
    ok: !!(emp?.strasse && emp?.plz && emp?.ort && emp?.land),
    text: "Heimatadresse vollständig (Straße/PLZ/Ort/Land)",
  });
  punkte.push({ ok: position.tage > 0, text: "Aufenthaltszeitraum gültig" });
  return punkte;
}

function positionBereit(punkte: Checkpunkt[]): boolean {
  return punkte.every((p) => p.ok);
}

interface PositionEntwurf {
  aufenthalt_von: string;
  aufenthalt_bis: string;
  an_abreisetage: string;
  eigener_hausstand: boolean;
  gefahrene_km: string;
  unterkunftskosten: string;
  sonstige_werbungskosten: string;
  vorherige_zeitraeume: string;
}

interface RueckmeldungEntwurf {
  ergebnis: LohnsteuerantragErgebnis;
  bescheid_freibetrag: string;
  bescheid_gueltig_von: string;
  bescheid_gueltig_bis: string;
  bescheid_datum: string;
  bescheid_notiz: string;
}

function positionZuEntwurf(p: LohnsteuerantragPosition): PositionEntwurf {
  return {
    aufenthalt_von: p.aufenthalt_von,
    aufenthalt_bis: p.aufenthalt_bis,
    an_abreisetage: String(p.an_abreisetage),
    eigener_hausstand: p.eigener_hausstand,
    gefahrene_km: String(p.gefahrene_km),
    unterkunftskosten: String(p.unterkunftskosten),
    sonstige_werbungskosten: String(p.sonstige_werbungskosten),
    vorherige_zeitraeume: p.vorherige_zeitraeume ?? "",
  };
}

function rueckmeldungZuEntwurf(p: LohnsteuerantragPosition): RueckmeldungEntwurf {
  return {
    ergebnis: p.ergebnis,
    bescheid_freibetrag: p.bescheid_freibetrag?.toString() ?? "",
    bescheid_gueltig_von: p.bescheid_gueltig_von ?? "",
    bescheid_gueltig_bis: p.bescheid_gueltig_bis ?? "",
    bescheid_datum: p.bescheid_datum ?? "",
    bescheid_notiz: p.bescheid_notiz ?? "",
  };
}

export default function LohnsteuerantragPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [antraege, setAntraege] = useState<Lohnsteuerantrag[]>([]);
  const [aktivId, setAktivId] = useState<number | null>(null);
  const aktiv = antraege.find((a) => a.id === aktivId) ?? null;

  const [loading, setLoading] = useState(true);
  const [positionen, setPositionen] = useState<LohnsteuerantragPosition[]>([]);
  const [employees, setEmployees] = useState<Record<string, Employee>>({});
  const [alleAktiven, setAlleAktiven] = useState<Employee[]>([]);
  const [dhh, setDhh] = useState<Record<string, DoppelteHaushaltsfuehrung>>({});
  const [dokumente, setDokumente] = useState<Record<string, EmployeeDocument[]>>(
    {}
  );
  const [firma, setFirma] = useState<FirmenBankdaten | null>(null);
  const [fruehereGenehmigt, setFruehereGenehmigt] = useState<Set<string>>(
    new Set()
  );

  const [editingPositionId, setEditingPositionId] = useState<number | null>(
    null
  );
  const [positionEntwurf, setPositionEntwurf] =
    useState<PositionEntwurf | null>(null);
  const [rueckmeldungEntwurf, setRueckmeldungEntwurf] =
    useState<RueckmeldungEntwurf | null>(null);
  const [speichernFehler, setSpeichernFehler] = useState<string | null>(null);
  const [speichern, setSpeichern] = useState(false);

  const [hinzufuegenOffen, setHinzufuegenOffen] = useState(false);
  const [hinzufuegenSuche, setHinzufuegenSuche] = useState("");
  const [hinzufuegenAusgewaehlt, setHinzufuegenAusgewaehlt] = useState<
    Set<string>
  >(new Set());
  const [hinzufuegenLaeuft, setHinzufuegenLaeuft] = useState(false);

  async function ladeAntraege() {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("lohnsteuerantrag")
      .select("*")
      .eq("jahr", jahr)
      .order("id");
    setAntraege((data as Lohnsteuerantrag[]) ?? []);
  }

  useEffect(() => {
    ladeAntraege();
    setAktivId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  async function ladeDetails(antragId: number) {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: posData }, { data: firmaData }, aktivEmployees] =
      await Promise.all([
        supabase
          .from("lohnsteuerantrag_position")
          .select("*")
          .eq("antrag_id", antragId)
          .order("id"),
        supabase.from("firmen_bankdaten").select("*").eq("id", 1).maybeSingle(),
        ladeAlleSeiten<Employee>((von, bis) =>
          supabase
            .from("employees")
            .select("*")
            .eq("aktiv", true)
            .order("name")
            .range(von, bis)
        ),
      ]);
    const pos = (posData as LohnsteuerantragPosition[]) ?? [];
    setPositionen(pos);
    setFirma((firmaData as FirmenBankdaten) ?? null);
    setAlleAktiven(aktivEmployees);
    const empMap: Record<string, Employee> = {};
    aktivEmployees.forEach((e) => {
      empMap[e.id] = e;
    });
    setEmployees(empMap);

    const employeeIds = pos.map((p) => p.employee_id);
    if (employeeIds.length > 0) {
      const [{ data: dhhData }, { data: docs }, { data: fruehere }] =
        await Promise.all([
          supabase
            .from("doppelte_haushaltsfuehrung")
            .select("*")
            .eq("saison_jahr", jahr)
            .in("employee_id", employeeIds),
          supabase
            .from("employee_documents")
            .select("*")
            .in("employee_id", employeeIds)
            .in("kategorie", [
              "Hochzeitsurkunde",
              "Ausweiskopie",
              "Doppelte Haushaltsführung Bescheinigung",
            ]),
          supabase
            .from("lohnsteuerantrag_position")
            .select("employee_id, ergebnis, lohnsteuerantrag!inner(jahr)")
            .eq("ergebnis", "genehmigt")
            .lt("lohnsteuerantrag.jahr", jahr)
            .in("employee_id", employeeIds),
        ]);
      const dhhMap: Record<string, DoppelteHaushaltsfuehrung> = {};
      ((dhhData as DoppelteHaushaltsfuehrung[]) ?? []).forEach((d) => {
        dhhMap[d.employee_id] = d;
      });
      setDhh(dhhMap);
      const docMap: Record<string, EmployeeDocument[]> = {};
      ((docs as EmployeeDocument[]) ?? []).forEach((d) => {
        if (!docMap[d.employee_id]) docMap[d.employee_id] = [];
        docMap[d.employee_id].push(d);
      });
      setDokumente(docMap);
      setFruehereGenehmigt(
        new Set(
          ((fruehere as { employee_id: string }[]) ?? []).map(
            (f) => f.employee_id
          )
        )
      );
    } else {
      setDhh({});
      setDokumente({});
      setFruehereGenehmigt(new Set());
    }
    setLoading(false);
  }

  useEffect(() => {
    if (aktivId) {
      ladeDetails(aktivId);
    } else {
      setPositionen([]);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktivId]);

  async function neuerAntrag() {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("lohnsteuerantrag")
      .insert({ jahr })
      .select()
      .single();
    if (error || !data) {
      window.alert(`Anlegen fehlgeschlagen: ${error?.message}`);
      return;
    }
    await ladeAntraege();
    setAktivId((data as Lohnsteuerantrag).id);
  }

  async function antragLoeschen(a: Lohnsteuerantrag) {
    if (
      !window.confirm(
        `Entwurf "${LOHNSTEUERANTRAG_STATUS_LABELS[a.status]} ${a.jahr}" wirklich löschen?`
      )
    )
      return;
    await getSupabaseClient().from("lohnsteuerantrag").delete().eq("id", a.id);
    setAktivId(null);
    ladeAntraege();
  }

  const positionsEmployeeIds = useMemo(
    () => new Set(positionen.map((p) => p.employee_id)),
    [positionen]
  );

  const hinzufuegenKandidaten = useMemo(() => {
    const q = hinzufuegenSuche.toLowerCase();
    return alleAktiven.filter((e) => {
      if (positionsEmployeeIds.has(e.id)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.vorname.toLowerCase().includes(q) ||
        e.personal_nr.toLowerCase().includes(q)
      );
    });
  }, [alleAktiven, positionsEmployeeIds, hinzufuegenSuche]);

  async function personenHinzufuegen() {
    if (!aktivId || hinzufuegenAusgewaehlt.size === 0) return;
    setHinzufuegenLaeuft(true);
    const supabase = getSupabaseClient();
    const ids = Array.from(hinzufuegenAusgewaehlt);
    const [{ data: dhhData }, { data: praesenzData }] = await Promise.all([
      supabase
        .from("doppelte_haushaltsfuehrung")
        .select("*")
        .eq("saison_jahr", jahr)
        .in("employee_id", ids),
      supabase
        .from("employee_saison_praesenz")
        .select("employee_id, saison_jahr")
        .in("employee_id", ids),
    ]);
    const dhhMap: Record<string, DoppelteHaushaltsfuehrung> = {};
    ((dhhData as DoppelteHaushaltsfuehrung[]) ?? []).forEach((d) => {
      dhhMap[d.employee_id] = d;
    });
    const jahreMap: Record<string, number[]> = {};
    ((praesenzData as { employee_id: string; saison_jahr: number }[]) ?? []).forEach(
      (p) => {
        if (!jahreMap[p.employee_id]) jahreMap[p.employee_id] = [];
        jahreMap[p.employee_id].push(p.saison_jahr);
      }
    );

    const zeilen = ids.map((id) => {
      const emp = employees[id];
      const d = dhhMap[id];
      const von = emp?.saison_beginn ?? `${jahr}-01-01`;
      const bis = emp?.saison_ende ?? `${jahr}-12-31`;
      const anAbreisetage = 2;
      const berechnet = berechneFreibetrag({
        aufenthaltVon: von,
        aufenthaltBis: bis,
        anAbreisetage,
        gefahreneKm: 0,
        unterkunftskosten: 0,
        sonstigeWerbungskosten: 0,
      });
      const eigenerHausstand = d
        ? d.familienstand === "verheiratet" ||
          d.wohnsituation === "eigentuemer_mieter"
        : true;
      const jahre = (jahreMap[id] ?? []).sort((a, b) => a - b);
      return {
        antrag_id: aktivId,
        employee_id: id,
        aufenthalt_von: von,
        aufenthalt_bis: bis,
        an_abreisetage: anAbreisetage,
        eigener_hausstand: eigenerHausstand,
        gefahrene_km: 0,
        unterkunftskosten: 0,
        sonstige_werbungskosten: 0,
        vorherige_zeitraeume: jahre.length > 0 ? jahre.join(", ") : null,
        tage: berechnet.tage,
        verpflegungsmehraufwand: berechnet.verpflegungsmehraufwand,
        fahrtkosten_absetzbar: berechnet.fahrtkostenAbsetzbar,
        werbungskosten_gesamt: berechnet.werbungskostenGesamt,
        pauschbetrag_anteilig: berechnet.pauschbetragAnteilig,
        freibetrag_beantragt: berechnet.freibetragBeantragt,
      };
    });

    const { error } = await supabase
      .from("lohnsteuerantrag_position")
      .insert(zeilen);
    setHinzufuegenLaeuft(false);
    if (error) {
      window.alert(`Hinzufügen fehlgeschlagen: ${error.message}`);
      return;
    }
    setHinzufuegenAusgewaehlt(new Set());
    setHinzufuegenOffen(false);
    ladeDetails(aktivId);
  }

  function positionBearbeiten(p: LohnsteuerantragPosition) {
    setEditingPositionId(p.id);
    setPositionEntwurf(positionZuEntwurf(p));
    setRueckmeldungEntwurf(rueckmeldungZuEntwurf(p));
    setSpeichernFehler(null);
  }

  const positionBerechnetVorschau = useMemo(() => {
    if (!positionEntwurf) return null;
    return berechneFreibetrag({
      aufenthaltVon: positionEntwurf.aufenthalt_von,
      aufenthaltBis: positionEntwurf.aufenthalt_bis,
      anAbreisetage: Number(positionEntwurf.an_abreisetage) || 0,
      gefahreneKm: Number(positionEntwurf.gefahrene_km) || 0,
      unterkunftskosten: Number(positionEntwurf.unterkunftskosten) || 0,
      sonstigeWerbungskosten: Number(positionEntwurf.sonstige_werbungskosten) || 0,
    });
  }, [positionEntwurf]);

  async function positionSpeichern() {
    if (!editingPositionId || !positionEntwurf || !positionBerechnetVorschau)
      return;
    setSpeichern(true);
    setSpeichernFehler(null);
    const supabase = getSupabaseClient();
    const position = positionen.find((p) => p.id === editingPositionId);
    const payload: Record<string, unknown> = {
      aufenthalt_von: positionEntwurf.aufenthalt_von,
      aufenthalt_bis: positionEntwurf.aufenthalt_bis,
      an_abreisetage: Number(positionEntwurf.an_abreisetage) || 0,
      eigener_hausstand: positionEntwurf.eigener_hausstand,
      gefahrene_km: Number(positionEntwurf.gefahrene_km) || 0,
      unterkunftskosten: Number(positionEntwurf.unterkunftskosten) || 0,
      sonstige_werbungskosten:
        Number(positionEntwurf.sonstige_werbungskosten) || 0,
      vorherige_zeitraeume: positionEntwurf.vorherige_zeitraeume || null,
      tage: positionBerechnetVorschau.tage,
      verpflegungsmehraufwand: positionBerechnetVorschau.verpflegungsmehraufwand,
      fahrtkosten_absetzbar: positionBerechnetVorschau.fahrtkostenAbsetzbar,
      werbungskosten_gesamt: positionBerechnetVorschau.werbungskostenGesamt,
      pauschbetrag_anteilig: positionBerechnetVorschau.pauschbetragAnteilig,
      freibetrag_beantragt: positionBerechnetVorschau.freibetragBeantragt,
    };
    if (aktiv?.status === "verschickt" && rueckmeldungEntwurf) {
      payload.ergebnis = rueckmeldungEntwurf.ergebnis;
      payload.bescheid_freibetrag = rueckmeldungEntwurf.bescheid_freibetrag
        ? Number(rueckmeldungEntwurf.bescheid_freibetrag)
        : null;
      payload.bescheid_gueltig_von =
        rueckmeldungEntwurf.bescheid_gueltig_von || null;
      payload.bescheid_gueltig_bis =
        rueckmeldungEntwurf.bescheid_gueltig_bis || null;
      payload.bescheid_datum = rueckmeldungEntwurf.bescheid_datum || null;
      payload.bescheid_notiz = rueckmeldungEntwurf.bescheid_notiz || null;
    }
    const { error } = await supabase
      .from("lohnsteuerantrag_position")
      .update(payload)
      .eq("id", editingPositionId);
    if (error) {
      setSpeichern(false);
      setSpeichernFehler(error.message);
      return;
    }
    // Rückmeldung spiegelt sich im bestehenden Verfahrensstand auf
    // "Personal → Lohnsteuer" (doppelte_haushaltsfuehrung.lohnsteuer_status) -
    // keine zweite Statuslogik.
    if (
      aktiv?.status === "verschickt" &&
      rueckmeldungEntwurf &&
      position &&
      rueckmeldungEntwurf.ergebnis !== "offen"
    ) {
      await supabase.from("doppelte_haushaltsfuehrung").upsert(
        {
          employee_id: position.employee_id,
          saison_jahr: jahr,
          lohnsteuer_status:
            rueckmeldungEntwurf.ergebnis === "genehmigt"
              ? "freibetrag_erteilt"
              : "kein_freibetrag",
        },
        { onConflict: "employee_id,saison_jahr" }
      );
    }
    setSpeichern(false);
    setEditingPositionId(null);
    if (aktivId) ladeDetails(aktivId);
  }

  async function positionLoeschen(p: LohnsteuerantragPosition) {
    if (!window.confirm("Person aus diesem Antrag entfernen?")) return;
    await getSupabaseClient()
      .from("lohnsteuerantrag_position")
      .delete()
      .eq("id", p.id);
    if (aktivId) ladeDetails(aktivId);
  }

  const positionenMitCheck = useMemo(
    () =>
      positionen.map((p) => {
        const emp = employees[p.employee_id];
        const punkte = checkliste(p, emp, dokumente[p.employee_id] ?? [], dhh[p.employee_id]);
        return { position: p, emp, punkte, bereit: positionBereit(punkte) };
      }),
    [positionen, employees, dokumente, dhh]
  );

  const antragBereit =
    positionenMitCheck.length > 0 && positionenMitCheck.every((p) => p.bereit);

  async function alsBereitMarkieren() {
    if (!aktiv) return;
    await getSupabaseClient()
      .from("lohnsteuerantrag")
      .update({ status: "bereit" })
      .eq("id", aktiv.id);
    ladeAntraege();
  }

  async function alsVerschicktMarkieren() {
    if (!aktiv) return;
    if (
      !window.confirm(
        "Als verschickt markieren? Der Verfahrensstand aller Personen auf \"Personal → Lohnsteuer\" wird dabei auf \"Antrag gestellt\" gesetzt."
      )
    )
      return;
    const supabase = getSupabaseClient();
    await supabase
      .from("lohnsteuerantrag")
      .update({
        status: "verschickt",
        verschickt_von: profile?.id ?? null,
        verschickt_am: new Date().toISOString(),
      })
      .eq("id", aktiv.id);
    const heute = new Date().toISOString().slice(0, 10);
    await Promise.all(
      positionen.map((p) =>
        supabase.from("doppelte_haushaltsfuehrung").upsert(
          {
            employee_id: p.employee_id,
            saison_jahr: jahr,
            lohnsteuer_status: "antrag_gestellt",
            antrag_gestellt_am: heute,
          },
          { onConflict: "employee_id,saison_jahr" }
        )
      )
    );
    ladeAntraege();
  }

  function excelErzeugen() {
    if (!aktiv || !firma) return;
    const zeilen = positionen.map((p, i) => {
      const emp = employees[p.employee_id];
      const d = dhh[p.employee_id];
      return {
        lfdNr: i + 1,
        name: emp?.name ?? "",
        vorname: emp?.vorname ?? "",
        geburtsdatum: emp?.geburtsdatum ?? null,
        steuerId: emp?.steuer_id ?? null,
        vorherigeZeitraeume: p.vorherige_zeitraeume,
        verheiratetSeit: emp?.hochzeitsdatum ?? null,
        bescheinigungFrueherErteilt: fruehereGenehmigt.has(p.employee_id),
        aufenthaltVon: p.aufenthalt_von,
        aufenthaltBis: p.aufenthalt_bis,
        tage: p.tage,
        anAbreisetage: p.an_abreisetage,
        beschaeftigtAls: emp?.funktion ?? null,
        heimatStrasse: emp?.strasse ?? null,
        heimatHausnummer: emp?.hausnummer ?? null,
        heimatPlz: emp?.plz ?? null,
        heimatOrt: emp?.ort ?? null,
        heimatLand: emp?.land ?? null,
        verpflegungsmehraufwand: p.verpflegungsmehraufwand,
        eigenerHausstand: p.eigener_hausstand,
        gefahreneKm: p.gefahrene_km,
        fahrtkostenAbsetzbar: p.fahrtkosten_absetzbar,
        unterkunftskosten: p.unterkunftskosten,
        sonstigeWerbungskosten: p.sonstige_werbungskosten,
        werbungskostenGesamt: p.werbungskosten_gesamt,
        pauschbetragAnteilig: p.pauschbetrag_anteilig,
        freibetragBeantragt: p.freibetrag_beantragt,
      };
    });
    erzeugeLohnsteuerantragExcel(
      jahr,
      {
        name: firma.name,
        steuernummer: firma.steuernummer,
        strasse: firma.strasse,
        hausnummer: firma.hausnummer,
        plz: firma.plz,
        ort: firma.ort,
      },
      zeilen
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PersonalTabs />
      <div>
        <PageHeader icon={FileText} titel="Sammelantrag Lohnsteuerabzug" />
        <p className="text-sm text-neutral-500">
          Antrag auf (Sammel-)Bescheinigung für den Lohnsteuerabzug bei
          beschränkt einkommensteuerpflichtigen Arbeitnehmern (Finanzamt
          Bensheim). Erzeugt die Excel-Datei + Anlagen zum Versand - Versand
          selbst läuft außerhalb der App per E-Mail/Post.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Steuerjahr{" "}
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-24"
          />
        </label>
        {antraege.map((a) => (
          <button
            key={a.id}
            type="button"
            className={a.id === aktivId ? "btn text-xs" : "btn-secondary text-xs"}
            onClick={() => setAktivId(a.id)}
          >
            Antrag #{a.id} · {LOHNSTEUERANTRAG_STATUS_LABELS[a.status]}
          </button>
        ))}
        {canEdit && (
          <button type="button" className="btn-secondary text-xs" onClick={neuerAntrag}>
            + Neuer Antrag {jahr}
          </button>
        )}
      </div>

      {!aktiv ? (
        <p className="text-neutral-500">
          {antraege.length === 0
            ? `Noch kein Antrag für ${jahr}.`
            : "Antrag oben auswählen."}
        </p>
      ) : loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 rounded border border-linie bg-white p-3">
            <span className="text-sm">
              Status: <strong>{LOHNSTEUERANTRAG_STATUS_LABELS[aktiv.status]}</strong>
              {aktiv.verschickt_am && (
                <> am {formatDatumDE(aktiv.verschickt_am.slice(0, 10))}</>
              )}
            </span>
            <span className="text-sm text-neutral-500">
              {positionenMitCheck.filter((p) => p.bereit).length}/
              {positionenMitCheck.length} Personen vollständig
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {canEdit && aktiv.status === "entwurf" && (
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setHinzufuegenOffen((v) => !v)}
                >
                  + Personen hinzufügen
                </button>
              )}
              {canEdit && aktiv.status === "entwurf" && (
                <button
                  type="button"
                  className="btn text-xs"
                  disabled={!antragBereit}
                  onClick={alsBereitMarkieren}
                  title={
                    antragBereit
                      ? undefined
                      : "Erst möglich, wenn alle Personen vollständig sind"
                  }
                >
                  Als bereit markieren
                </button>
              )}
              {(aktiv.status === "bereit" || aktiv.status === "verschickt") && (
                <button type="button" className="btn text-xs" onClick={excelErzeugen}>
                  Excel erzeugen
                </button>
              )}
              {canEdit && aktiv.status === "bereit" && (
                <button
                  type="button"
                  className="btn text-xs"
                  onClick={alsVerschicktMarkieren}
                >
                  Als verschickt markieren
                </button>
              )}
              {canEdit && aktiv.status === "entwurf" && (
                <button
                  type="button"
                  className="btn-danger text-xs"
                  onClick={() => antragLoeschen(aktiv)}
                >
                  Antrag löschen
                </button>
              )}
            </div>
          </div>

          {hinzufuegenOffen && (
            <div className="flex flex-col gap-2 rounded border border-linie bg-white p-3">
              <input
                placeholder="Suche nach Name oder Personalnummer…"
                value={hinzufuegenSuche}
                onChange={(e) => setHinzufuegenSuche(e.target.value)}
                className="w-72"
              />
              <div className="max-h-64 overflow-y-auto">
                {hinzufuegenKandidaten.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={hinzufuegenAusgewaehlt.has(e.id)}
                      onChange={(ev) => {
                        const next = new Set(hinzufuegenAusgewaehlt);
                        if (ev.target.checked) next.add(e.id);
                        else next.delete(e.id);
                        setHinzufuegenAusgewaehlt(next);
                      }}
                    />
                    {e.personal_nr} – {e.name}, {e.vorname}
                  </label>
                ))}
                {hinzufuegenKandidaten.length === 0 && (
                  <p className="text-sm text-neutral-400">Keine Treffer.</p>
                )}
              </div>
              <div>
                <button
                  type="button"
                  className="btn text-xs"
                  disabled={hinzufuegenAusgewaehlt.size === 0 || hinzufuegenLaeuft}
                  onClick={personenHinzufuegen}
                >
                  {hinzufuegenAusgewaehlt.size} Person(en) hinzufügen
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Zeitraum</th>
                  <th>Tage</th>
                  <th>Verpflegung</th>
                  <th>Freibetrag</th>
                  <th>Checkliste</th>
                  {aktiv.status === "verschickt" && <th>Ergebnis</th>}
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {positionenMitCheck.map(({ position: p, emp, punkte, bereit }) => (
                  <Fragment key={p.id}>
                    <tr>
                      <td>
                        {emp ? `${emp.name}, ${emp.vorname}` : p.employee_id}
                      </td>
                      <td className="text-xs">
                        {formatDatumDE(p.aufenthalt_von)} – {formatDatumDE(p.aufenthalt_bis)}
                      </td>
                      <td>{p.tage}</td>
                      <td>{formatEuro(p.verpflegungsmehraufwand)}</td>
                      <td className="font-medium">
                        {formatEuro(p.freibetrag_beantragt)}
                      </td>
                      <td>
                        {bereit ? (
                          <span className="text-emerald-700">✓ vollständig</span>
                        ) : (
                          <span
                            className="text-amber-700"
                            title={punkte
                              .filter((pt) => !pt.ok)
                              .map((pt) => pt.text)
                              .join(" · ")}
                          >
                            ⚠ {punkte.filter((pt) => !pt.ok).length} offen
                          </span>
                        )}
                      </td>
                      {aktiv.status === "verschickt" && (
                        <td>
                          {LOHNSTEUERANTRAG_ERGEBNIS_LABELS[p.ergebnis]}
                          {p.bescheid_freibetrag != null && (
                            <> ({formatEuro(p.bescheid_freibetrag)})</>
                          )}
                        </td>
                      )}
                      {canEdit && (
                        <td className="flex gap-1">
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => positionBearbeiten(p)}
                          >
                            Bearbeiten
                          </button>
                          {aktiv.status === "entwurf" && (
                            <button
                              type="button"
                              className="text-neutral-400 hover:text-beere-600"
                              onClick={() => positionLoeschen(p)}
                              title="Aus Antrag entfernen"
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {editingPositionId === p.id &&
                      positionEntwurf &&
                      positionBerechnetVorschau && (
                        <tr>
                          <td colSpan={aktiv.status === "verschickt" ? 8 : 7}>
                            <div className="flex flex-col gap-3 rounded border border-linie bg-sand p-3">
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                  Aufenthalt von
                                  <input
                                    type="date"
                                    value={positionEntwurf.aufenthalt_von}
                                    onChange={(e) =>
                                      setPositionEntwurf({
                                        ...positionEntwurf,
                                        aufenthalt_von: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                  Aufenthalt bis
                                  <input
                                    type="date"
                                    value={positionEntwurf.aufenthalt_bis}
                                    onChange={(e) =>
                                      setPositionEntwurf({
                                        ...positionEntwurf,
                                        aufenthalt_bis: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                  An-/Abreisetage
                                  <input
                                    type="number"
                                    value={positionEntwurf.an_abreisetage}
                                    onChange={(e) =>
                                      setPositionEntwurf({
                                        ...positionEntwurf,
                                        an_abreisetage: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="flex items-center gap-2 pt-4 text-xs text-neutral-500">
                                  <input
                                    type="checkbox"
                                    checked={positionEntwurf.eigener_hausstand}
                                    onChange={(e) =>
                                      setPositionEntwurf({
                                        ...positionEntwurf,
                                        eigener_hausstand: e.target.checked,
                                      })
                                    }
                                  />
                                  eigener Hausstand
                                </label>
                                <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                  Gefahrene km
                                  <input
                                    type="number"
                                    value={positionEntwurf.gefahrene_km}
                                    onChange={(e) =>
                                      setPositionEntwurf({
                                        ...positionEntwurf,
                                        gefahrene_km: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                  Unterkunftskosten
                                  <input
                                    type="number"
                                    value={positionEntwurf.unterkunftskosten}
                                    onChange={(e) =>
                                      setPositionEntwurf({
                                        ...positionEntwurf,
                                        unterkunftskosten: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                  Sonstige Werbungskosten
                                  <input
                                    type="number"
                                    value={positionEntwurf.sonstige_werbungskosten}
                                    onChange={(e) =>
                                      setPositionEntwurf({
                                        ...positionEntwurf,
                                        sonstige_werbungskosten: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="col-span-2 flex flex-col gap-0.5 text-xs text-neutral-500">
                                  Vorherige Zeiträume in Deutschland
                                  <input
                                    value={positionEntwurf.vorherige_zeitraeume}
                                    onChange={(e) =>
                                      setPositionEntwurf({
                                        ...positionEntwurf,
                                        vorherige_zeitraeume: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                              </div>
                              <p className="text-xs text-neutral-500">
                                Berechnet: {positionBerechnetVorschau.tage} Tage ·
                                Verpflegung {formatEuro(positionBerechnetVorschau.verpflegungsmehraufwand)} ·
                                Werbungskosten gesamt {formatEuro(positionBerechnetVorschau.werbungskostenGesamt)} ·
                                Pauschbetrag {formatEuro(positionBerechnetVorschau.pauschbetragAnteilig)} ·{" "}
                                <strong>Freibetrag {formatEuro(positionBerechnetVorschau.freibetragBeantragt)}</strong>
                              </p>

                              <div className="flex flex-col gap-1 text-xs">
                                <span className="font-medium text-neutral-600">Checkliste</span>
                                {punkte.map((pt, i) => (
                                  <span key={i} className={pt.ok ? "text-emerald-700" : "text-amber-700"}>
                                    {pt.ok ? "✓" : "⚠"} {pt.text}
                                  </span>
                                ))}
                                {emp && (
                                  <div className="mt-1 flex gap-4">
                                    <div>
                                      <span className="block text-neutral-500">
                                        Doppelte Haushaltsführung (Scan)
                                      </span>
                                      <FormularDokumentZelle
                                        employeeId={emp.id}
                                        kategorie="Doppelte Haushaltsführung Bescheinigung"
                                        dokumente={dokumente[emp.id] ?? []}
                                        canEdit={canEdit}
                                        onGeaendert={() => aktivId && ladeDetails(aktivId)}
                                      />
                                    </div>
                                    {dhh[emp.id]?.familienstand === "verheiratet" && (
                                      <div>
                                        <span className="block text-neutral-500">Hochzeitsurkunde</span>
                                        <FormularDokumentZelle
                                          employeeId={emp.id}
                                          kategorie="Hochzeitsurkunde"
                                          dokumente={dokumente[emp.id] ?? []}
                                          canEdit={canEdit}
                                          onGeaendert={() => aktivId && ladeDetails(aktivId)}
                                        />
                                      </div>
                                    )}
                                    {!emp.steuer_id && (
                                      <div>
                                        <span className="block text-neutral-500">Ausweiskopie</span>
                                        <FormularDokumentZelle
                                          employeeId={emp.id}
                                          kategorie="Ausweiskopie"
                                          dokumente={dokumente[emp.id] ?? []}
                                          canEdit={canEdit}
                                          onGeaendert={() => aktivId && ladeDetails(aktivId)}
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {aktiv.status === "verschickt" && rueckmeldungEntwurf && (
                                <div className="flex flex-col gap-2 border-t border-linie pt-3">
                                  <span className="text-xs font-medium text-neutral-600">
                                    Rückmeldung Finanzamt
                                  </span>
                                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                      Ergebnis
                                      <select
                                        value={rueckmeldungEntwurf.ergebnis}
                                        onChange={(e) =>
                                          setRueckmeldungEntwurf({
                                            ...rueckmeldungEntwurf,
                                            ergebnis: e.target.value as LohnsteuerantragErgebnis,
                                          })
                                        }
                                      >
                                        {Object.entries(LOHNSTEUERANTRAG_ERGEBNIS_LABELS).map(
                                          ([wert, label]) => (
                                            <option key={wert} value={wert}>
                                              {label}
                                            </option>
                                          )
                                        )}
                                      </select>
                                    </label>
                                    <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                      Freibetrag lt. Bescheid
                                      <input
                                        type="number"
                                        value={rueckmeldungEntwurf.bescheid_freibetrag}
                                        onChange={(e) =>
                                          setRueckmeldungEntwurf({
                                            ...rueckmeldungEntwurf,
                                            bescheid_freibetrag: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                      Gültig von
                                      <input
                                        type="date"
                                        value={rueckmeldungEntwurf.bescheid_gueltig_von}
                                        onChange={(e) =>
                                          setRueckmeldungEntwurf({
                                            ...rueckmeldungEntwurf,
                                            bescheid_gueltig_von: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                      Gültig bis
                                      <input
                                        type="date"
                                        value={rueckmeldungEntwurf.bescheid_gueltig_bis}
                                        onChange={(e) =>
                                          setRueckmeldungEntwurf({
                                            ...rueckmeldungEntwurf,
                                            bescheid_gueltig_bis: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
                                      Bescheid vom
                                      <input
                                        type="date"
                                        value={rueckmeldungEntwurf.bescheid_datum}
                                        onChange={(e) =>
                                          setRueckmeldungEntwurf({
                                            ...rueckmeldungEntwurf,
                                            bescheid_datum: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label className="col-span-2 flex flex-col gap-0.5 text-xs text-neutral-500">
                                      Notiz
                                      <input
                                        value={rueckmeldungEntwurf.bescheid_notiz}
                                        onChange={(e) =>
                                          setRueckmeldungEntwurf({
                                            ...rueckmeldungEntwurf,
                                            bescheid_notiz: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="btn text-xs"
                                  disabled={speichern}
                                  onClick={positionSpeichern}
                                >
                                  Speichern
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary text-xs"
                                  onClick={() => setEditingPositionId(null)}
                                >
                                  Abbrechen
                                </button>
                                {speichernFehler && (
                                  <span className="text-xs text-beere-600">{speichernFehler}</span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                  </Fragment>
                ))}
                {positionen.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-neutral-400">
                      Noch keine Personen in diesem Antrag.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
