"use client";

// HSC-Abgleich Landwirtschaft (2026-11-25): der Landwirtschafts-Stamm
// (bisher aus einer teils unvollständigen Excel) wird gegen die HSC-Exporte
// von Mömmel und Mönich Landwirtschaft abgeglichen. HSC hat bei der
// Personalnummer Vorrang. Ablauf: beide CSV-Exporte wählen -> Prüfen
// (Vorschau, nichts wird gespeichert) -> Übernehmen.
// Logik in lib/hscImportLw.ts (lokal gegen die echten Exporte getestet),
// Datenbank-Funktionen in migration_2026-11-25f.
// Wiederholbar: ein zweiter Lauf findet nur noch, was sich seitdem geändert hat.

import PageHeader from "@/components/PageHeader";
import PersonalTabs from "@/components/PersonalTabs";
import { FileUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { hscCsvLesen, hscDekodieren, normName } from "@/lib/hscImport";
import {
  LW_FELDER,
  LW_GRUPPEN,
  lwAbgleich,
  lwPlanPruefen,
  lwSaetzeLesen,
  nrEndung,
  nrNorm,
  type LwAppPerson,
  type LwFeldGruppe,
  type LwHscDatei,
  type LwKlaerungArt,
  type LwPlan,
} from "@/lib/hscImportLw";
import { ABRECHNUNGSART_LABELS, type Abrechnungsart, type Firma } from "@/lib/types";

const KLAERUNG_LABEL: Record<LwKlaerungArt, string> = {
  vermischt: "Evtl. vermischte Datensätze",
  dublette: "Dubletten im Stamm",
  nr_kollision: "HSC-Nummer in beiden Firmen vergeben",
  datum: "Unplausibles Datum in HSC",
  unsicher: "Unsichere Zuordnung",
  nicht_in_hsc: "Nicht in HSC",
};
const KLAERUNG_TEXT: Record<LwKlaerungArt, string> = {
  vermischt:
    "Die Person trug eine Nummer, die laut HSC jemand anderem gehört. Beim alten Excel-Import können dadurch Saisonjahre der anderen Person an diesem Datensatz hängen. Klären unter Personal → Zusammenführen → „Saisonjahre verschieben“.",
  dublette:
    "Dieselbe Person steht mehrfach im Stamm (nicht als Statuswechsel). Klären unter Personal → Zusammenführen - bis dahin bleiben beide Datensätze, der zweite ggf. mit „-alt“.",
  nr_kollision: "Wer jünger eingetreten ist, bekommt die Nummer, der andere die Nummer mit Firmenzusatz.",
  datum: "Bitte in HSC korrigieren - in der App wird nur das Eintrittsjahr gezählt.",
  unsicher:
    "Zugeordnet über Nummer, SV-Nummer oder Steuer-ID, aber Name oder Geburtsdatum weichen ab (Tippfehler, Heirat …). Wird so übernommen - bitte kurz drüberschauen.",
  nicht_in_hsc: "In keinem der beiden Exporte gefunden. Bleibt unverändert (Nummer ggf. mit „-alt“).",
};

const KANDIDAT_AKTIV = (status: string) => status !== "storniert";

function firmaRaten(dateiname: string): string {
  const n = dateiname
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (n.includes("moemmel") || n.includes("mommel")) return "MA";
  if (n.includes("moenich") || n.includes("monich")) return "ML";
  return "";
}

interface Saisonzeile {
  employee_id: string;
  saison_jahr: number;
}
interface Firmenzeile extends Saisonzeile {
  firma: string;
}
interface Abschnitt {
  employee_id: string;
  anmeldedatum: string;
  abmeldedatum: string | null;
}
interface Kandidat {
  personal_nr: string;
  name: string;
  vorname: string;
  status: string;
  aktivierter_employee_id: string | null;
  verknuepfter_employee_id: string | null;
}

interface Bestand {
  app: LwAppPerson[];
  vtNummern: Set<string>;
  jahre: Map<string, number[]>;
  firmen: Firmenzeile[];
  abschnitte: Abschnitt[];
  abgerechnet: Set<string>; // employee_id|jahr
  kandidaten: Kandidat[];
  ausweis: Set<string>;
}

function csvLaden(name: string, kopf: string[], zeilen: string[][]) {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const text = "﻿" + [kopf, ...zeilen].map((z) => z.map(esc).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
}

export default function PersonalImportHscLwPage() {
  const { profile } = useProfile();
  const darf = hatRolle(profile, "admin", "hr");
  const ansichtNurVt = profile?.bereich_ansicht === "VT";
  const [firmen, setFirmen] = useState<Firma[]>([]);
  const [dateien, setDateien] = useState<LwHscDatei[]>([]);
  const [plan, setPlan] = useState<LwPlan | null>(null);
  const [bestand, setBestand] = useState<Bestand | null>(null);
  const [ueberschreiben, setUeberschreiben] = useState<Set<LwFeldGruppe>>(new Set());
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState("");
  const [ergebnis, setErgebnis] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string[]>([]);
  const [zeigeNeu, setZeigeNeu] = useState(false);

  useEffect(() => {
    getSupabaseClient()
      .from("firma")
      .select("*")
      .eq("bereich", "LW")
      .order("reihenfolge")
      .then(({ data }) => setFirmen((data as Firma[]) ?? []));
  }, []);
  const standardFirma = firmen.find((f) => f.ist_standard)?.kuerzel ?? "MA";

  async function dateienWaehlen(liste: FileList | null) {
    setPlan(null);
    setErgebnis(null);
    const neu: LwHscDatei[] = [];
    for (const f of Array.from(liste ?? [])) {
      const zeilen = hscCsvLesen(hscDekodieren(new Uint8Array(await f.arrayBuffer())));
      neu.push({ name: f.name, firma: firmaRaten(f.name), zeilen });
    }
    setDateien(neu);
  }

  async function bestandLaden(): Promise<Bestand> {
    const supabase = getSupabaseClient();
    const felder = Array.from(new Set(["id", "personal_nr", "name", "vorname", "geburtsdatum",
      "sozialversicherungsnummer", "steuer_id", "aktiv", "notiz", "vorgaenger_employee_id", "bereich",
      ...LW_FELDER.map((f) => f.feld)])).join(", ");
    setFortschritt("Personalstamm laden…");
    const alle = await ladeAlleSeiten<LwAppPerson & { bereich: string }>((von, bis) =>
      supabase.from("employee_personaldaten").select(felder).order("id").range(von, bis)
    );
    const app = alle.filter((p) => p.bereich === "LW");
    const lwIds = new Set(app.map((p) => p.id));
    setFortschritt("Saisonjahre laden…");
    const praesenz = await ladeAlleSeiten<Saisonzeile>((von, bis) =>
      supabase.from("employee_saison_praesenz").select("employee_id, saison_jahr")
        .order("employee_id").order("saison_jahr").range(von, bis)
    );
    const jahre = new Map<string, number[]>();
    praesenz.forEach((z) => lwIds.has(z.employee_id) && jahre.set(z.employee_id, [...(jahre.get(z.employee_id) ?? []), z.saison_jahr]));
    const firmenZeilen = await ladeAlleSeiten<Firmenzeile>((von, bis) =>
      supabase.from("employee_saison").select("employee_id, saison_jahr, firma")
        .order("employee_id").order("saison_jahr").range(von, bis)
    );
    setFortschritt("Beschäftigungszeiträume und Abrechnungen laden…");
    const abschnitte = await ladeAlleSeiten<Abschnitt>((von, bis) =>
      supabase.from("employee_beschaeftigungsabschnitte").select("employee_id, anmeldedatum, abmeldedatum")
        .order("id").range(von, bis)
    );
    const abr = await ladeAlleSeiten<Saisonzeile>((von, bis) =>
      supabase.from("saison_abrechnungen").select("employee_id, saison_jahr").order("id").range(von, bis)
    );
    const kandidaten = await ladeAlleSeiten<Kandidat>((von, bis) =>
      supabase.from("personal_kandidaten")
        .select("personal_nr, name, vorname, status, aktivierter_employee_id, verknuepfter_employee_id")
        .order("id").range(von, bis)
    );
    const ausweis = await ladeAlleSeiten<{ employee_id: string }>((von, bis) =>
      supabase.from("ernte_ausweis").select("employee_id").order("employee_id").range(von, bis)
    );
    return {
      app: app.map((p) => ({ ...p, sozialversicherungsnummer: p.sozialversicherungsnummer ?? null })),
      vtNummern: new Set(alle.filter((p) => p.bereich !== "LW").map((p) => nrNorm(p.personal_nr))),
      jahre,
      firmen: firmenZeilen.filter((z) => lwIds.has(z.employee_id)),
      abschnitte: abschnitte.filter((z) => lwIds.has(z.employee_id)),
      abgerechnet: new Set(abr.map((z) => `${z.employee_id}|${z.saison_jahr}`)),
      kandidaten,
      ausweis: new Set(ausweis.map((z) => z.employee_id)),
    };
  }

  // nachImport: automatische zweite Prüfung - Ergebnis-Meldung bleibt stehen
  async function pruefen(nachImport = false) {
    setFehler([]);
    if (!nachImport) setErgebnis(null);
    if (dateien.some((d) => !d.firma)) {
      setFehler(["Bitte zu jeder Datei die Firma wählen."]);
      return;
    }
    if (new Set(dateien.map((d) => d.firma)).size !== dateien.length) {
      setFehler(["Jede Firma nur einmal - bitte die Zuordnung prüfen."]);
      return;
    }
    setLaeuft(true);
    try {
      const b = await bestandLaden();
      setBestand(b);
      setFortschritt("Abgleich…");
      const p = lwAbgleich(lwSaetzeLesen(dateien), b.app, b.jahre, b.vtNummern, new Date().getFullYear());
      const pruef = lwPlanPruefen(p, b.app);
      if (pruef.length) setFehler(pruef);
      setPlan(p);
    } catch (e) {
      setFehler([e instanceof Error ? e.message : String(e)]);
    }
    setFortschritt("");
    setLaeuft(false);
  }

  // --- abgeleitete Listen -------------------------------------------------------
  const kandidatenKonflikte = useMemo(() => {
    if (!plan || !bestand) return [];
    const ziel = new Map<string, string>(); // nr -> wer
    const zielName = new Map<string, string>(); // nr -> normierter Name
    plan.umnummerierungen.forEach((u) => {
      ziel.set(nrNorm(u.neu), `${u.name} (umnummeriert)`);
      zielName.set(nrNorm(u.neu), normName(u.name));
    });
    plan.neu.forEach((n) => {
      ziel.set(nrNorm(String(n.stamm.personal_nr)), `${n.stamm.name}, ${n.stamm.vorname} (neu)`);
      zielName.set(nrNorm(String(n.stamm.personal_nr)), normName(`${n.stamm.name}, ${n.stamm.vorname}`));
    });
    const umIds = new Set(plan.umnummerierungen.map((u) => u.id));
    return bestand.kandidaten
      .filter((k) => KANDIDAT_AKTIV(k.status) && ziel.has(nrNorm(k.personal_nr)))
      // Rückkehrer: Kandidat ist dieselbe Person - kein Konflikt
      .filter((k) => zielName.get(nrNorm(k.personal_nr)) !== normName(`${k.name}, ${k.vorname}`))
      .filter((k) => !(k.aktivierter_employee_id && umIds.has(k.aktivierter_employee_id)))
      .map((k) => `Kandidat ${k.name}, ${k.vorname} (Planung, ${k.status}) hat Nummer ${k.personal_nr} - bekommt jetzt ${ziel.get(nrNorm(k.personal_nr))}`);
  }, [plan, bestand]);

  const firmaHinweise = useMemo(() => {
    if (!plan || !bestand) return [] as string[];
    const vorhanden = new Map(bestand.firmen.map((z) => [`${z.employee_id}|${z.saison_jahr}`, z.firma]));
    const name = new Map(bestand.app.map((p) => [p.id, `${p.personal_nr} ${p.name}, ${p.vorname}`]));
    const out: string[] = [];
    plan.saison.forEach((s) => {
      if (s.employeeKey.startsWith("neu:")) return;
      Object.entries(s.saisonFirma).forEach(([j, f]) => {
        const k = `${s.employeeKey}|${j}`;
        const ist = vorhanden.get(k) ?? standardFirma;
        if (ist !== f && (vorhanden.has(k) || bestand.abgerechnet.has(k))) {
          out.push(`${name.get(s.employeeKey)}: Saison ${j} in der App ${ist}, laut HSC ${f}${bestand.abgerechnet.has(k) ? " (schon abgerechnet)" : ""} - bleibt ${ist}`);
        }
      });
    });
    return out;
  }, [plan, bestand, standardFirma]);

  const ergaenzZahlen = useMemo(() => {
    if (!plan) return { personen: 0, felder: 0 };
    let felder = 0;
    let personen = 0;
    plan.ergaenzungen.forEach((e) => {
      const n = Object.keys(e.leer).length +
        Object.keys(e.abweichend).filter((f) => ueberschreiben.has(LW_FELDER.find((x) => x.feld === f)!.gruppe)).length +
        (e.notizZusatz ? 1 : 0);
      felder += n;
      if (n) personen++;
    });
    return { personen, felder };
  }, [plan, ueberschreiben]);

  // --- Übernehmen ---------------------------------------------------------------
  async function uebernehmen() {
    if (!plan || !bestand) return;
    if (
      !window.confirm(
        `${plan.umnummerierungen.length} Personalnummern ändern, ${plan.neu.length} Personen neu anlegen und ` +
          `${ergaenzZahlen.felder} Felder bei ${ergaenzZahlen.personen} Personen ergänzen?`
      )
    )
      return;
    setLaeuft(true);
    setFehler([]);
    const supabase = getSupabaseClient();
    const meldungen: string[] = [];
    try {
      // 1) Umnummerieren - in einem Schritt
      if (plan.umnummerierungen.length) {
        setFortschritt("Personalnummern ändern…");
        const { error } = await supabase.rpc("lw_personal_nr_umnummerieren", {
          p_paare: plan.umnummerierungen.map((u) => ({ id: u.id, neu: u.neu })),
        });
        if (error) throw new Error(`Umnummerieren: ${error.message} - es wurde nichts geändert.`);
      }

      // 2) Stammfelder ergänzen
      const notizAlt = new Map(bestand.app.map((p) => [p.id, p.notiz]));
      const patches = plan.ergaenzungen
        .map((e) => {
          const patch: Record<string, string> = { ...e.leer };
          Object.entries(e.abweichend).forEach(([f, v]) => {
            if (ueberschreiben.has(LW_FELDER.find((x) => x.feld === f)!.gruppe)) patch[f] = v;
          });
          if (e.notizZusatz) patch.notiz = [notizAlt.get(e.id), e.notizZusatz].filter(Boolean).join("; ");
          return { id: e.id, patch };
        })
        .filter((x) => Object.keys(x.patch).length);
      for (let i = 0; i < patches.length; i += 200) {
        setFortschritt(`Stammdaten ergänzen ${i + 1}–${Math.min(i + 200, patches.length)} von ${patches.length}…`);
        const { error } = await supabase.rpc("lw_stamm_ergaenzen", { p_daten: patches.slice(i, i + 200) });
        if (error) meldungen.push(`Ergänzen ${i + 1}–${i + 200}: ${error.message}`);
      }

      // 3) Neue Personen - Statuswechsel-Nummern (1234a) nach ihrem Vorgänger
      const umn = new Map(plan.umnummerierungen.map((u) => [u.id, u.neu]));
      const idNachNr = new Map<string, string>(
        bestand.app.map((p) => [nrNorm(umn.get(p.id) ?? p.personal_nr), p.id])
      );
      const nachEndung = new Map<string, typeof plan.neu>();
      plan.neu.forEach((n) => {
        const e = nrEndung(String(n.stamm.personal_nr));
        nachEndung.set(e, [...(nachEndung.get(e) ?? []), n]);
      });
      const endungen = Array.from(nachEndung.keys()).sort((a, b) => a.length - b.length || a.localeCompare(b));
      let angelegt = 0;
      for (const e of endungen) {
        const liste = nachEndung.get(e)!;
        for (let i = 0; i < liste.length; i += 50) {
          setFortschritt(`Neue Personen anlegen (${angelegt + 1}–${angelegt + Math.min(50, liste.length - i)} von ${plan.neu.length})…`);
          const block = liste.slice(i, i + 50).map((n) => ({
            ...n.stamm,
            vorgaenger_employee_id: n.vorgaengerNr ? idNachNr.get(nrNorm(n.vorgaengerNr)) ?? null : null,
          }));
          const { data, error } = await supabase.from("employee_personaldaten").insert(block).select("id, personal_nr");
          if (error) {
            meldungen.push(`Neue Personen: ${error.message}`);
            continue;
          }
          ((data as { id: string; personal_nr: string }[]) ?? []).forEach((r) => {
            idNachNr.set(nrNorm(r.personal_nr), r.id);
            angelegt++;
          });
        }
      }

      // 4) Saisonjahre, Firma je Saison, Beschäftigungszeiträume
      const vorhFirma = new Set(bestand.firmen.map((z) => `${z.employee_id}|${z.saison_jahr}`));
      const offen = new Map<string, Abschnitt[]>();
      bestand.abschnitte.forEach((a) => offen.set(a.employee_id, [...(offen.get(a.employee_id) ?? []), a]));
      const praesenz: { employee_id: string; saison_jahr: number; quelle: string }[] = [];
      const saison: { employee_id: string; saison_jahr: number; firma: string }[] = [];
      const abschnitte: { employee_id: string; anmeldedatum: string; abmeldedatum: string | null; quelle: string }[] = [];
      plan.saison.forEach((s) => {
        const id = s.employeeKey.startsWith("neu:") ? idNachNr.get(nrNorm(s.employeeKey.slice(4))) : s.employeeKey;
        if (!id) return;
        Object.entries(s.saisonFirma).forEach(([j, f]) => {
          const k = `${id}|${j}`;
          praesenz.push({ employee_id: id, saison_jahr: Number(j), quelle: "import" });
          // Firma nur, wo noch nichts steht und nicht abgerechnet wurde
          if (!vorhFirma.has(k) && !bestand.abgerechnet.has(k)) saison.push({ employee_id: id, saison_jahr: Number(j), firma: f });
        });
        const liste = offen.get(id) ?? [];
        s.zeitraeume.forEach((t) => {
          if (t.plausibel === false) return;
          const ende = (x: string | null) => x ?? "9999-12-31";
          const ueberlappt = liste.some((a) => a.anmeldedatum <= ende(t.bis) && t.von <= ende(a.abmeldedatum));
          const zweitesOffenes = t.bis === null && liste.some((a) => a.abmeldedatum === null);
          if (ueberlappt || zweitesOffenes) return;
          const neu = { employee_id: id, anmeldedatum: t.von, abmeldedatum: t.bis };
          liste.push(neu);
          abschnitte.push({ ...neu, quelle: "import" });
        });
        offen.set(id, liste);
      });
      const schreiben = async (tabelle: string, zeilen: object[], ergaenzen: boolean) => {
        for (let i = 0; i < zeilen.length; i += 200) {
          setFortschritt(`${tabelle}: ${i + 1}–${Math.min(i + 200, zeilen.length)} von ${zeilen.length}…`);
          const teil = zeilen.slice(i, i + 200);
          const q = supabase.from(tabelle);
          const { error } = ergaenzen
            ? await q.upsert(teil, { onConflict: "employee_id,saison_jahr", ignoreDuplicates: true })
            : await q.insert(teil);
          if (error) meldungen.push(`${tabelle}: ${error.message}`);
        }
      };
      await schreiben("employee_saison_praesenz", praesenz, true);
      await schreiben("employee_saison", saison, true);
      await schreiben("employee_beschaeftigungsabschnitte", abschnitte, false);

      setErgebnis(
        `${plan.umnummerierungen.length} Nummern geändert · ${angelegt} Personen neu angelegt · ` +
          `${patches.length} Personen ergänzt · ${saison.length} Firma-je-Saison-Einträge · ` +
          `${abschnitte.length} Beschäftigungszeiträume neu.` +
          (meldungen.length ? " Es gab Fehler - siehe unten." : "")
      );
    } catch (e) {
      meldungen.push(e instanceof Error ? e.message : String(e));
    }
    setFehler(meldungen);
    setFortschritt("");
    setLaeuft(false);
    if (!meldungen.length) await pruefen(true);
  }

  function klaerungCsv() {
    if (!plan) return;
    csvLaden(
      "hsc-abgleich-klaerung.csv",
      ["Art", "Personalnummer", "Name", "Hinweis"],
      plan.klaerung.map((k) => [KLAERUNG_LABEL[k.art], k.personal_nr, k.name, k.text])
    );
  }

  if (!darf) {
    return (
      <div className="flex flex-col gap-4">
        <PersonalTabs />
        <PageHeader icon={FileUp} titel="HSC-Abgleich Landwirtschaft" />
        <p className="text-sm text-neutral-500">Nur Administrator und Personal (HR).</p>
      </div>
    );
  }

  const ausweisBetroffen = plan && bestand
    ? plan.umnummerierungen.filter((u) => bestand.ausweis.has(u.id))
    : [];
  const klaerungNachArt = (plan?.klaerung ?? []).reduce<Record<string, LwPlan["klaerung"]>>(
    (a, k) => ((a[k.art] = [...(a[k.art] ?? []), k]), a),
    {}
  );
  const abrZaehlung = (plan?.neu ?? []).reduce<Record<string, number>>((a, n) => {
    const k = String(n.stamm.abrechnungsart);
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <PersonalTabs />
      <PageHeader
        icon={FileUp}
        titel="HSC-Abgleich Landwirtschaft"
        beschreibung="Personalstamm der Landwirtschaft mit den HSC-Exporten (Mömmel und Mönich Landwirtschaft) abgleichen. HSC hat bei der Personalnummer Vorrang. Erst prüfen - es wird nichts gespeichert -, dann übernehmen."
      />

      <div className="card flex flex-col gap-3">
        {ansichtNurVt && (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            Oben ist der Bereich „Vertrieb“ gewählt - dadurch ist die Landwirtschaft ausgeblendet. Bitte oben auf
            „Alle Bereiche“ oder „Landwirtschaft“ umstellen.
          </p>
        )}
        <input type="file" accept=".csv,text/csv" multiple onChange={(e) => dateienWaehlen(e.target.files)} />
        {dateien.map((d, i) => (
          <div key={d.name} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{d.name}</span>
            <span className="text-neutral-500">{d.zeilen.length} Zeilen</span>
            <select
              value={d.firma}
              onChange={(e) => setDateien((alt) => alt.map((x, j) => (j === i ? { ...x, firma: e.target.value } : x)))}
            >
              <option value="">Firma wählen…</option>
              {firmen.map((f) => (
                <option key={f.kuerzel} value={f.kuerzel}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        ))}
        {dateien.length === 1 && (
          <p className="text-xs text-amber-800">
            Nur eine Datei gewählt - für einen vollständigen Abgleich bitte beide Exporte (Mömmel und Mönich
            Landwirtschaft) gemeinsam wählen, sonst gelten Personen der anderen Firma als „nicht in HSC“.
          </p>
        )}
        {dateien.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={laeuft} onClick={() => pruefen()}>
              Prüfen (nichts wird gespeichert)
            </button>
            {plan && (
              <button
                type="button"
                className="btn"
                disabled={laeuft || (plan.umnummerierungen.length + plan.neu.length + ergaenzZahlen.felder === 0)}
                onClick={uebernehmen}
              >
                Übernehmen
              </button>
            )}
            {plan && plan.klaerung.length > 0 && (
              <button type="button" className="btn-secondary" onClick={klaerungCsv}>
                Klärungsliste als CSV
              </button>
            )}
          </div>
        )}
        {fortschritt && <p className="text-sm text-neutral-500">{fortschritt}</p>}
        {ergebnis && <p className="text-sm text-emerald-800">{ergebnis}</p>}
        {fehler.map((f) => (
          <p key={f} className="text-sm text-beere-600">
            ⚠ {f}
          </p>
        ))}
      </div>

      {plan && (
        <>
          <div className="card flex flex-col gap-2 text-sm">
            <h2 className="font-semibold text-emerald-800">Ergebnis des Abgleichs</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["HSC-Datensätze", plan.saetze],
                ["Personen laut HSC", plan.personenHsc],
                ["Bestätigt (Nummer stimmt)", plan.bestaetigt],
                ["Nummer ändern", plan.umnummerierungen.length],
                ["Neu anlegen", plan.neu.length],
                ["Felder ergänzen", ergaenzZahlen.felder],
                ["Abweichungen", plan.abweichungen.length],
                ["Zum Klären", plan.klaerung.length],
              ].map(([l, n]) => (
                <div key={String(l)} className="rounded border border-linie p-2">
                  <div className="text-lg font-semibold">{Number(n).toLocaleString("de-DE")}</div>
                  <div className="text-xs text-neutral-500">{l}</div>
                </div>
              ))}
            </div>
            {kandidatenKonflikte.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                <p className="font-medium">Personalplanung: reservierte Nummern werden jetzt vergeben</p>
                {kandidatenKonflikte.map((k) => (
                  <p key={k}>{k}</p>
                ))}
                <p className="text-xs">Diesen Kandidaten vor der Aktivierung eine neue Nummer geben.</p>
              </div>
            )}
          </div>

          {plan.umnummerierungen.length > 0 && (
            <div className="card flex flex-col gap-2 text-sm">
              <h2 className="font-semibold text-emerald-800">Personalnummern ändern ({plan.umnummerierungen.length})</h2>
              {ausweisBetroffen.length > 0 && (
                <p className="text-amber-800">
                  ⚠ {ausweisBetroffen.length} davon haben einen Erntewirtschafts-Ausweis - der QR-Code enthält die
                  Personalnummer, der Ausweis muss neu gedruckt werden.
                </p>
              )}
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Bisher</th>
                      <th>Neu</th>
                      <th>Name</th>
                      <th>Grund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.umnummerierungen.map((u) => (
                      <tr key={u.id}>
                        <td>{u.alt}</td>
                        <td className="font-medium">{u.neu}</td>
                        <td>
                          {u.name}
                          {bestand?.ausweis.has(u.id) ? " 🪪" : ""}
                        </td>
                        <td className="text-neutral-600">{u.grund}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {plan.abweichungen.length > 0 && (
            <div className="card flex flex-col gap-2 text-sm">
              <h2 className="font-semibold text-emerald-800">Abweichungen App ↔ HSC ({plan.abweichungen.length})</h2>
              <p className="text-neutral-600">
                Leere Felder werden immer aus HSC gefüllt. Abweichende Werte bleiben, wie sie in der App stehen - außer
                du hakst die Gruppe hier an:
              </p>
              <div className="flex flex-wrap gap-3">
                {(Object.keys(LW_GRUPPEN) as LwFeldGruppe[]).map((g) => {
                  const n = plan.abweichungen.filter((a) => LW_FELDER.find((f) => f.label === a.feld)?.gruppe === g).length;
                  if (!n) return null;
                  return (
                    <label key={g} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={ueberschreiben.has(g)}
                        onChange={(e) =>
                          setUeberschreiben((alt) => {
                            const neu = new Set(alt);
                            if (e.target.checked) neu.add(g);
                            else neu.delete(g);
                            return neu;
                          })
                        }
                      />
                      {LW_GRUPPEN[g]} mit HSC überschreiben ({n})
                    </label>
                  );
                })}
              </div>
              <div className="max-h-96 overflow-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Pers.-Nr.</th>
                      <th>Name</th>
                      <th>Feld</th>
                      <th>App</th>
                      <th>HSC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.abweichungen.map((a, i) => (
                      <tr key={i}>
                        <td>{a.personal_nr}</td>
                        <td>{a.name}</td>
                        <td>{a.feld}</td>
                        <td>{a.app}</td>
                        <td className="font-medium">{a.hsc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {plan.neu.length > 0 && (
            <div className="card flex flex-col gap-2 text-sm">
              <h2 className="font-semibold text-emerald-800">Neu anlegen ({plan.neu.length}, inaktiv)</h2>
              <p>
                Abrechnungsart:{" "}
                {Object.entries(abrZaehlung)
                  .map(([k, n]) => `${ABRECHNUNGSART_LABELS[k as Abrechnungsart] ?? k}: ${n}`)
                  .join(" · ")}
                {" · "}davon Statuswechsel-Nummern mit Vorgänger: {plan.neu.filter((n) => n.vorgaengerNr).length}
              </p>
              <button type="button" className="self-start text-emerald-700 underline" onClick={() => setZeigeNeu((z) => !z)}>
                {zeigeNeu ? "Liste ausblenden" : "Liste anzeigen"}
              </button>
              {zeigeNeu && (
                <div className="max-h-96 overflow-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>Pers.-Nr.</th>
                        <th>Name</th>
                        <th>Geburtsdatum</th>
                        <th>HSC</th>
                        <th>Eintritt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.neu.map((n) => (
                        <tr key={String(n.stamm.personal_nr)}>
                          <td>
                            {String(n.stamm.personal_nr)}
                            {n.vorgaengerNr ? ` (nach ${n.vorgaengerNr})` : ""}
                          </td>
                          <td>
                            {String(n.stamm.name)}, {String(n.stamm.vorname)}
                          </td>
                          <td>{String(n.stamm.geburtsdatum ?? "")}</td>
                          <td>{Array.from(new Set(n.slot.hsc.map((s) => `${s.firma} ${s.nr}`))).join(", ")}</td>
                          <td>{n.slot.hsc[0].von ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {firmaHinweise.length > 0 && (
            <div className="card flex flex-col gap-1 text-sm">
              <h2 className="font-semibold text-emerald-800">Firma je Saison weicht ab ({firmaHinweise.length})</h2>
              <p className="text-neutral-600">
                Bei diesen Saisons steht in der App schon eine Firma oder es wurde bereits abgerechnet - sie werden nicht
                geändert. Falls HSC recht hat, in der Stammkarte unter „Firma je Saison“ anpassen.
              </p>
              <div className="max-h-64 overflow-auto">
                {firmaHinweise.map((h) => (
                  <p key={h}>{h}</p>
                ))}
              </div>
            </div>
          )}

          {plan.klaerung.length > 0 && (
            <div className="card flex flex-col gap-3 text-sm">
              <h2 className="font-semibold text-emerald-800">Klärungsliste ({plan.klaerung.length})</h2>
              {(Object.keys(KLAERUNG_LABEL) as LwKlaerungArt[]).map((art) =>
                klaerungNachArt[art]?.length ? (
                  <details key={art} open={art === "vermischt" || art === "dublette"}>
                    <summary className="cursor-pointer font-medium">
                      {KLAERUNG_LABEL[art]} ({klaerungNachArt[art].length})
                    </summary>
                    <p className="my-1 text-neutral-600">{KLAERUNG_TEXT[art]}</p>
                    <div className="max-h-80 overflow-auto">
                      <table>
                        <tbody>
                          {klaerungNachArt[art].map((k, i) => (
                            <tr key={i}>
                              <td className="whitespace-nowrap">{k.personal_nr}</td>
                              <td className="whitespace-nowrap">{k.name}</td>
                              <td className="text-neutral-600">{k.text}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ) : null
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
