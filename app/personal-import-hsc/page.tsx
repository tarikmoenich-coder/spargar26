"use client";

// Import Vertriebs-Personal aus HSC-Exporten (Stufe 4, 2026-11-25).
// Ablauf: CSV-Exporte wählen (je Datei die Firma) -> Prüfen (Vorschau mit
// allen Auffälligkeiten, nichts wird gespeichert) -> Importieren.
// Logik in lib/hscImport.ts (lokal gegen die echten Exporte getestet).
// Wiederholbar: bereits vorhandene V-Personalnummern werden übersprungen.

import PageHeader from "@/components/PageHeader";
import PersonalTabs from "@/components/PersonalTabs";
import { FileUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import {
  hscCsvLesen,
  hscDateiStand,
  hscDekodieren,
  hscZusammenfuehren,
  personSchluessel,
  type HscDatei,
  type HscPerson,
} from "@/lib/hscImport";
import { ABRECHNUNGSART_LABELS, type Abrechnungsart, type Firma } from "@/lib/types";

interface Vorhanden {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  geburtsdatum: string | null;
  bereich: string;
}

function firmaRaten(dateiname: string): string {
  const n = dateiname.toLowerCase();
  if (n.includes("anita")) return "AM";
  if (n.includes("mödi") || n.includes("moedi") || n.includes("direkt") || n.includes("modi")) return "MD";
  return "";
}

export default function PersonalImportHscPage() {
  const { profile } = useProfile();
  const darf = hatRolle(profile, "admin", "hr");
  const [firmen, setFirmen] = useState<Firma[]>([]);
  const [dateien, setDateien] = useState<HscDatei[]>([]);
  const [personen, setPersonen] = useState<HscPerson[] | null>(null);
  const [vorhanden, setVorhanden] = useState<Vorhanden[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState("");
  const [ergebnis, setErgebnis] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string[]>([]);

  useEffect(() => {
    getSupabaseClient()
      .from("firma")
      .select("*")
      .eq("bereich", "VT")
      .order("reihenfolge")
      .then(({ data }) => setFirmen((data as Firma[]) ?? []));
  }, []);

  async function dateienWaehlen(liste: FileList | null) {
    setPersonen(null);
    setErgebnis(null);
    const neu: HscDatei[] = [];
    for (const f of Array.from(liste ?? [])) {
      const zeilen = hscCsvLesen(hscDekodieren(new Uint8Array(await f.arrayBuffer())));
      neu.push({ name: f.name, firma: firmaRaten(f.name), stand: hscDateiStand(zeilen), zeilen });
    }
    setDateien(neu);
  }

  async function pruefen() {
    setFehler([]);
    setErgebnis(null);
    if (dateien.some((d) => !d.firma)) {
      setFehler(["Bitte zu jeder Datei die Firma wählen."]);
      return;
    }
    setLaeuft(true);
    setFortschritt("Bestehende Personen laden…");
    const supabase = getSupabaseClient();
    const v = await ladeAlleSeiten<Vorhanden>((von, bis) =>
      supabase
        .from("employee_personaldaten")
        .select("id, personal_nr, name, vorname, geburtsdatum, bereich")
        .order("id")
        .range(von, bis)
    );
    setVorhanden(v);
    const p = hscZusammenfuehren(dateien, new Date().getFullYear());
    // Abgleich mit dem bestehenden Stamm (v.a. Landwirtschaft)
    const lwNachSchluessel = new Map<string, Vorhanden[]>();
    v.filter((e) => e.bereich !== "VT").forEach((e) => {
      const k = personSchluessel(e.name, e.vorname, e.geburtsdatum);
      lwNachSchluessel.set(k, [...(lwNachSchluessel.get(k) ?? []), e]);
    });
    p.forEach((person) => {
      const treffer = lwNachSchluessel.get(person.schluessel);
      if (treffer && person.stamm.geburtsdatum) {
        const nrn = treffer.map((t) => t.personal_nr).join(", ");
        person.hinweise.push(`auch in der Landwirtschaft als ${nrn} - Hinweis in der Notiz`);
        person.stamm.notiz = `${person.stamm.notiz}; auch in der Landwirtschaft als ${nrn}`;
      }
    });
    setPersonen(p);
    setFortschritt("");
    setLaeuft(false);
  }

  const vorhandeneNummern = useMemo(() => new Set(vorhanden.map((e) => e.personal_nr)), [vorhanden]);
  const zuImportieren = (personen ?? []).filter(
    (p) => p.fehler.length === 0 && !vorhandeneNummern.has(p.personal_nr)
  );
  const zaehle = <T extends string>(werte: T[]) =>
    werte.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});

  async function importieren() {
    if (!personen || zuImportieren.length === 0) return;
    if (!window.confirm(`${zuImportieren.length} Personen in den Bereich Vertrieb importieren?`)) return;
    setLaeuft(true);
    setFehler([]);
    const supabase = getSupabaseClient();
    const meldungen: string[] = [];
    const idNachNr = new Map<string, string>();
    // 1) Personen
    for (let i = 0; i < zuImportieren.length; i += 50) {
      const block = zuImportieren.slice(i, i + 50);
      setFortschritt(`Personen ${i + 1}–${i + block.length} von ${zuImportieren.length}…`);
      const { data, error } = await supabase
        .from("employee_personaldaten")
        .insert(block.map((p) => p.stamm))
        .select("id, personal_nr");
      if (error) {
        meldungen.push(`Personen ${i + 1}–${i + block.length}: ${error.message}`);
        continue;
      }
      ((data as { id: string; personal_nr: string }[]) ?? []).forEach((r) => idNachNr.set(r.personal_nr, r.id));
    }
    // 2) Saisonjahre, Firma je Saison, Beschäftigungsabschnitte
    const praesenz: { employee_id: string; saison_jahr: number; quelle: string }[] = [];
    const saison: { employee_id: string; saison_jahr: number; firma: string }[] = [];
    const abschnitte: { employee_id: string; anmeldedatum: string; abmeldedatum: string | null; quelle: string }[] = [];
    zuImportieren.forEach((p) => {
      const id = idNachNr.get(p.personal_nr);
      if (!id) return;
      Object.entries(p.saisonFirma).forEach(([jahr, firma]) => {
        praesenz.push({ employee_id: id, saison_jahr: Number(jahr), quelle: "import" });
        saison.push({ employee_id: id, saison_jahr: Number(jahr), firma });
      });
      p.zeitraeume.forEach((t) =>
        abschnitte.push({ employee_id: id, anmeldedatum: t.von, abmeldedatum: t.bis, quelle: "import" })
      );
    });
    const schreiben = async (tabelle: string, zeilen: object[], konflikt?: string) => {
      for (let i = 0; i < zeilen.length; i += 200) {
        setFortschritt(`${tabelle}: ${i + 1}–${Math.min(i + 200, zeilen.length)} von ${zeilen.length}…`);
        const q = supabase.from(tabelle);
        const { error } = konflikt
          ? await q.upsert(zeilen.slice(i, i + 200), { onConflict: konflikt })
          : await q.insert(zeilen.slice(i, i + 200));
        if (error) meldungen.push(`${tabelle}: ${error.message}`);
      }
    };
    await schreiben("employee_saison_praesenz", praesenz, "employee_id,saison_jahr");
    await schreiben("employee_saison", saison, "employee_id,saison_jahr");
    await schreiben("employee_beschaeftigungsabschnitte", abschnitte);
    setFehler(meldungen);
    setErgebnis(
      `${idNachNr.size} Personen importiert, ${praesenz.length} Saisonjahre, ${abschnitte.length} Beschäftigungszeiträume.` +
        (meldungen.length ? " Es gab Fehler - siehe unten." : "")
    );
    setFortschritt("");
    setLaeuft(false);
    pruefen();
  }

  if (!darf) {
    return (
      <div className="flex flex-col gap-4">
        <PersonalTabs />
        <PageHeader icon={FileUp} titel="Import Vertrieb (HSC)" />
        <p className="text-sm text-neutral-500">Nur Administrator und Personal (HR).</p>
      </div>
    );
  }

  const mitHinweis = (personen ?? []).filter((p) => p.hinweise.length || p.fehler.length);

  return (
    <div className="flex flex-col gap-4">
      <PersonalTabs />
      <PageHeader
        icon={FileUp}
        titel="Import Vertrieb (HSC)"
        beschreibung="Personalstamm des Vertriebs aus HSC-Exporten (CSV) übernehmen - je Datei die Firma wählen, prüfen, dann importieren. Personalnummern bekommen das Präfix „V-“. Bereits vorhandene Nummern werden übersprungen."
      />

      <div className="card flex flex-col gap-3">
        <input type="file" accept=".csv,text/csv" multiple onChange={(e) => dateienWaehlen(e.target.files)} />
        {dateien.map((d, i) => (
          <div key={d.name} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{d.name}</span>
            <span className="text-neutral-500">{d.zeilen.length} Zeilen</span>
            <select
              value={d.firma}
              onChange={(e) =>
                setDateien((alt) => alt.map((x, j) => (j === i ? { ...x, firma: e.target.value } : x)))
              }
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
        {dateien.length > 0 && (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={laeuft} onClick={pruefen}>
              Prüfen (nichts wird gespeichert)
            </button>
            {personen && (
              <button
                type="button"
                className="btn"
                disabled={laeuft || zuImportieren.length === 0}
                onClick={importieren}
              >
                {zuImportieren.length} Personen importieren
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

      {personen && (
        <div className="card flex flex-col gap-2 text-sm">
          <h2 className="font-semibold text-emerald-800">Vorschau</h2>
          <p>
            {personen.length} Personen in den Dateien · {zuImportieren.length} neu ·{" "}
            {personen.filter((p) => vorhandeneNummern.has(p.personal_nr)).length} schon vorhanden (werden
            übersprungen) · {personen.filter((p) => p.fehler.length).length} mit Fehler (nicht importierbar) ·{" "}
            {personen.filter((p) => p.aktiv).length} aktiv
          </p>
          <p>
            Abrechnungsart:{" "}
            {Object.entries(zaehle(personen.map((p) => p.stamm.abrechnungsart as Abrechnungsart)))
              .map(([k, n]) => `${ABRECHNUNGSART_LABELS[k as Abrechnungsart] ?? k}: ${n}`)
              .join(" · ")}
          </p>
          <p>
            Saisonjahre:{" "}
            {Object.entries(
              zaehle(personen.flatMap((p) => Object.entries(p.saisonFirma).map(([j, f]) => `${j} ${f}`)))
            )
              .sort()
              .map(([k, n]) => `${k}: ${n}`)
              .join(" · ")}
          </p>
          {mitHinweis.length > 0 && (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th>Hinweise</th>
                  </tr>
                </thead>
                <tbody>
                  {mitHinweis.map((p) => (
                    <tr key={p.personal_nr}>
                      <td>{p.personal_nr}</td>
                      <td>
                        {String(p.stamm.name)}, {String(p.stamm.vorname)}
                      </td>
                      <td className={p.fehler.length ? "text-beere-600" : "text-neutral-600"}>
                        {[...p.fehler, ...p.hinweise].join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
