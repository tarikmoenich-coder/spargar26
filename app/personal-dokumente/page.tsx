"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  DOKUMENT_KATEGORIEN,
  FUEHRERSCHEIN_KATEGORIEN,
  FAMILIENSTAND_LABELS,
  type DokumentKategorie,
  type DoppelteHaushaltsfuehrung,
  type EmployeeDocument,
  type SvFragebogenAuswertung,
} from "@/lib/types";
import { formatDatumDE } from "@/lib/format";
import PersonalTabs from "@/components/PersonalTabs";
import DoppelteHaushaltsfuehrungFormular from "@/components/DoppelteHaushaltsfuehrungFormular";

const DOKUMENTE_BUCKET = "mitarbeiter-dokumente";
const FUEHRERSCHEIN_KATEGORIE: DokumentKategorie = "Führerschein Kopie";
const CURRENT_YEAR = new Date().getFullYear();
const EIN_JAHR_MS = 365 * 24 * 60 * 60 * 1000;

// Farbliche Gruppierung der Dokument-Kategorien (Nutzer-Vorgabe
// 2026-08-08): allgemeine Personaldokumente neutral, Lohnsteuer-Themen
// sanftes Gelb, Sozialversicherungs-Themen sanftes Orange - damit
// thematisch zusammengehörige Spalten auf einen Blick erkennbar sind.
// Reihenfolge hier bestimmt auch die Spaltenreihenfolge in der Tabelle
// (Kategorien nach Gruppe sortiert statt in DOKUMENT_KATEGORIEN-Reihenfolge).
const NEUTRAL_KATEGORIEN: DokumentKategorie[] = [
  "Ausweiskopie",
  "Führerschein Kopie",
  "Arbeitsvertrag",
  "Werks- und Mietvertrag",
  "Sonstiges",
];
const GELB_KATEGORIEN: DokumentKategorie[] = [
  "Hochzeitsurkunde",
  'Formular "Doppelte Haushaltsführung"',
];
const ORANGE_KATEGORIEN: DokumentKategorie[] = [
  "Formular zur Feststellung der Versicherungspflicht",
];
const SPALTEN_REIHENFOLGE: DokumentKategorie[] = [
  ...NEUTRAL_KATEGORIEN,
  ...GELB_KATEGORIEN,
  ...ORANGE_KATEGORIEN,
];

const GELB_BG = "bg-amber-50";
const GELB_TH = "bg-amber-100";
const ORANGE_BG = "bg-orange-50";
const ORANGE_TH = "bg-orange-100";

function spaltenFarbe(k: DokumentKategorie): { bg: string; th: string } | null {
  if (GELB_KATEGORIEN.includes(k)) return { bg: GELB_BG, th: GELB_TH };
  if (ORANGE_KATEGORIEN.includes(k)) return { bg: ORANGE_BG, th: ORANGE_TH };
  return null;
}

interface Row {
  id: string;
  personal_nr: string;
  herkunft: string | null;
  name: string;
  vorname: string;
  ort: string | null;
  aktiv: boolean;
}

// Hochzeitsurkunde gilt als "ggf. erneut prüfen" markiert, wenn die
// zuletzt hochgeladene Kopie älter als ein Jahr ist - der Familienstand
// könnte sich seither geändert haben (Nutzer-Vorgabe 2026-08-08). Nutzt
// hochgeladen_am als Näherung (kein separates Ausstellungsdatum auf den
// Dokumenten) - reicht für einen Hinweis, ersetzt keine echte Prüfung.
function hochzeitsurkundeVeraltet(docs: EmployeeDocument[]): boolean {
  const urkunden = docs.filter((d) => d.kategorie === "Hochzeitsurkunde");
  if (urkunden.length === 0) return false;
  const neuesteDatum = Math.max(
    ...urkunden.map((d) => new Date(d.hochgeladen_am).getTime())
  );
  return Date.now() - neuesteDatum > EIN_JAHR_MS;
}

export default function PersonalDokumentePage() {
  const { profile } = useProfile();
  const canView = profile?.role === "admin" || profile?.role === "hr";

  const [employees, setEmployees] = useState<Row[]>([]);
  const [dokumente, setDokumente] = useState<Record<string, EmployeeDocument[]>>(
    {}
  );
  const [dhh, setDhh] = useState<Record<string, DoppelteHaushaltsfuehrung>>({});
  const [svFragebogen, setSvFragebogen] = useState<
    Record<string, SvFragebogenAuswertung>
  >({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [offenId, setOffenId] = useState<string | null>(null);
  const [kategorie, setKategorie] = useState<DokumentKategorie>(
    DOKUMENT_KATEGORIEN[0]
  );
  const [fuehrerscheinAuswahl, setFuehrerscheinAuswahl] = useState<string[]>(
    []
  );
  const [datei, setDatei] = useState<File | null>(null);
  const [dateiSchluessel, setDateiSchluessel] = useState(0);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  // Getrennt vom Upload-Panel (offenId) - eigenes DHH-Formular je Person.
  const [dhhEditingId, setDhhEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: docs }, { data: dhhData }, { data: svData }] =
      await Promise.all([
        supabase
          .from("employees")
          .select("id, personal_nr, herkunft, name, vorname, ort, aktiv")
          .order("name"),
        supabase
          .from("employee_documents")
          .select("*")
          .order("hochgeladen_am", { ascending: false }),
        supabase
          .from("doppelte_haushaltsfuehrung")
          .select("*")
          .eq("saison_jahr", CURRENT_YEAR),
        supabase
          .from("sv_fragebogen_auswertung")
          .select("*")
          .eq("saison_jahr", CURRENT_YEAR),
      ]);
    setEmployees((emp as Row[]) ?? []);
    const map: Record<string, EmployeeDocument[]> = {};
    ((docs as EmployeeDocument[]) ?? []).forEach((d) => {
      if (!map[d.employee_id]) map[d.employee_id] = [];
      map[d.employee_id].push(d);
    });
    setDokumente(map);
    const dhhMap: Record<string, DoppelteHaushaltsfuehrung> = {};
    ((dhhData as DoppelteHaushaltsfuehrung[]) ?? []).forEach((d) => {
      dhhMap[d.employee_id] = d;
    });
    setDhh(dhhMap);
    const svMap: Record<string, SvFragebogenAuswertung> = {};
    ((svData as SvFragebogenAuswertung[]) ?? []).forEach((f) => {
      svMap[f.employee_id] = f;
    });
    setSvFragebogen(svMap);
    setLoading(false);
  }

  useEffect(() => {
    if (canView) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  function toggleOffen(empId: string) {
    setOffenId((prev) => (prev === empId ? null : empId));
    setFehler(null);
    setDatei(null);
    setKategorie(DOKUMENT_KATEGORIEN[0]);
    setFuehrerscheinAuswahl([]);
  }

  function toggleFuehrerscheinKlasse(klasse: string) {
    setFuehrerscheinAuswahl((prev) =>
      prev.includes(klasse)
        ? prev.filter((k) => k !== klasse)
        : [...prev, klasse]
    );
  }

  async function hochladen(employeeId: string) {
    if (!datei) return;
    if (kategorie === FUEHRERSCHEIN_KATEGORIE && fuehrerscheinAuswahl.length === 0) {
      setFehler("Bitte mindestens eine Führerschein-Klasse auswählen.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const pfad = `${employeeId}/${Date.now()}_${datei.name}`;
    const { error: uploadError } = await supabase.storage
      .from(DOKUMENTE_BUCKET)
      .upload(pfad, datei);
    if (uploadError) {
      setFehler(uploadError.message);
      setLaeuft(false);
      return;
    }
    const { error: insertError } = await supabase
      .from("employee_documents")
      .insert({
        employee_id: employeeId,
        kategorie,
        dateiname: datei.name,
        storage_path: pfad,
        fuehrerschein_kategorien:
          kategorie === FUEHRERSCHEIN_KATEGORIE ? fuehrerscheinAuswahl : null,
      });
    if (insertError) {
      setFehler(insertError.message);
      // Bereits hochgeladene Datei wieder entfernen, damit keine verwaiste
      // Datei ohne Datenbank-Eintrag im Bucket liegen bleibt.
      await supabase.storage.from(DOKUMENTE_BUCKET).remove([pfad]);
      setLaeuft(false);
      return;
    }
    setDatei(null);
    setDateiSchluessel((k) => k + 1);
    setFuehrerscheinAuswahl([]);
    setLaeuft(false);
    load();
  }

  async function herunterladen(doc: EmployeeDocument) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(DOKUMENTE_BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (error || !data) {
      window.alert(
        `Download fehlgeschlagen: ${error?.message ?? "unbekannter Fehler"}`
      );
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function loeschen(doc: EmployeeDocument) {
    if (
      !window.confirm(`"${doc.dateiname}" (${doc.kategorie}) wirklich löschen?`)
    ) {
      return;
    }
    const supabase = getSupabaseClient();
    const { error: storageError } = await supabase.storage
      .from(DOKUMENTE_BUCKET)
      .remove([doc.storage_path]);
    if (storageError) {
      window.alert(`Löschen fehlgeschlagen: ${storageError.message}`);
      return;
    }
    await supabase.from("employee_documents").delete().eq("id", doc.id);
    setDokumente((prev) => ({
      ...prev,
      [doc.employee_id]: (prev[doc.employee_id] ?? []).filter(
        (d) => d.id !== doc.id
      ),
    }));
  }

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return (
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q)
    );
  });

  // 5 Identitäts-Spalten + Dokument-Kategorien + 2 neue DHH-Spalten +
  // 1 neue SV-Spalte + 1 Aktions-Spalte.
  const spaltenAnzahl = 5 + DOKUMENT_KATEGORIEN.length + 4;

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <PersonalTabs />
        <p className="text-neutral-500">
          Dokumente sind wie andere sensible Personaldaten (SV-Nr., IBAN)
          nur für admin/hr sichtbar.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Dokumente</h1>
        <p className="text-sm text-neutral-500">
          Hochgeladene Dokumente je Mitarbeiter und Kategorie. Leere Felder
          bedeuten: für diese Kategorie wurde noch nichts hochgeladen.
          Downloads laufen über zeitlich begrenzte Links. Farblich
          gruppiert: neutral = allgemeine Personaldokumente,{" "}
          <span className="rounded bg-amber-100 px-1">gelb = Lohnsteuer</span>
          , <span className="rounded bg-orange-100 px-1">orange = Sozialversicherung</span>{" "}
          (Stand jeweils Saison-Jahr {CURRENT_YEAR}).
        </p>
      </div>

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 bg-neutral-50 py-2">
        <input
          placeholder="Suche nach Name oder Personalnummer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Herkunft</th>
                <th>Name</th>
                <th>Vorname</th>
                <th>Ort</th>
                {SPALTEN_REIHENFOLGE.map((k) => {
                  const farbe = spaltenFarbe(k);
                  return (
                    <th key={k} className={farbe?.th}>
                      {k}
                    </th>
                  );
                })}
                <th className={GELB_TH}>Doppelte Haushaltsführung - Status</th>
                <th className={GELB_TH}>Antrag gestellt</th>
                <th className={ORANGE_TH}>SV-Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => {
                const empDocs = dokumente[emp.id] ?? [];
                const empDhh = dhh[emp.id];
                const empSv = svFragebogen[emp.id];
                const urkundeVeraltet =
                  empDhh?.familienstand === "verheiratet" &&
                  hochzeitsurkundeVeraltet(empDocs);
                return (
                  <Fragment key={emp.id}>
                    <tr className={emp.aktiv ? "" : "opacity-50"}>
                      <td>{emp.personal_nr}</td>
                      <td>{emp.herkunft ?? "—"}</td>
                      <td>{emp.name}</td>
                      <td>{emp.vorname}</td>
                      <td>{emp.ort}</td>
                      {SPALTEN_REIHENFOLGE.map((k) => {
                        const farbe = spaltenFarbe(k);
                        const treffer = empDocs.filter(
                          (d) => d.kategorie === k
                        );
                        return (
                          <td key={k} className={`text-sm ${farbe?.bg ?? ""}`}>
                            {treffer.length === 0 ? (
                              <span className="text-neutral-300">—</span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                {treffer.map((d) => (
                                  <button
                                    key={d.id}
                                    type="button"
                                    className="text-left text-emerald-700 underline"
                                    onClick={() => herunterladen(d)}
                                    title={formatDatumDE(d.hochgeladen_am)}
                                  >
                                    {d.dateiname}
                                    {d.fuehrerschein_kategorien &&
                                      d.fuehrerschein_kategorien.length > 0 &&
                                      ` (${d.fuehrerschein_kategorien.join(", ")})`}
                                  </button>
                                ))}
                                {k === "Hochzeitsurkunde" && urkundeVeraltet && (
                                  <span
                                    className="text-xs font-medium text-amber-800"
                                    title="Letzte Kopie ist älter als ein Jahr - Familienstand ggf. erneut prüfen"
                                  >
                                    ⚠ ggf. erneut prüfen
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className={`text-sm ${GELB_BG}`}>
                        {empDhh?.familienstand ? (
                          FAMILIENSTAND_LABELS[empDhh.familienstand]
                        ) : (
                          <span className="text-neutral-400">
                            Nicht erfasst
                          </span>
                        )}
                        <div>
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() =>
                              setDhhEditingId(
                                dhhEditingId === emp.id ? null : emp.id
                              )
                            }
                          >
                            {empDhh ? "Bearbeiten" : "Erfassen"}
                          </button>
                        </div>
                      </td>
                      <td className={`text-sm ${GELB_BG}`}>
                        {empDhh?.antrag_gestellt ? (
                          <span className="font-medium text-emerald-700">
                            ✓ Ja
                            {empDhh.antrag_gestellt_am &&
                              ` (${formatDatumDE(empDhh.antrag_gestellt_am)})`}
                          </span>
                        ) : (
                          <span className="text-neutral-400">Nein</span>
                        )}
                      </td>
                      <td className={`text-sm ${ORANGE_BG}`}>
                        {!empSv ? (
                          <span className="text-neutral-400">
                            Nicht erfasst
                          </span>
                        ) : empSv.bestanden ? (
                          <span className="font-medium text-emerald-700">
                            ✓ Bestanden
                          </span>
                        ) : empSv.unvollstaendig_fehlerhaft ? (
                          <span
                            className="font-medium text-red-600"
                            title={empSv.unvollstaendig_fehlerhaft_grund ?? undefined}
                          >
                            ⚠ Unvollständig/Fehlerhaft
                          </span>
                        ) : (
                          <span className="font-medium text-red-600">
                            ⚠ Nicht bestanden
                          </span>
                        )}
                        <div>
                          <Link
                            href="/personal-sozialversicherung"
                            className="text-xs underline"
                          >
                            Bearbeiten →
                          </Link>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => toggleOffen(emp.id)}
                        >
                          {offenId === emp.id ? "Schließen" : "Dokumente"}
                        </button>
                      </td>
                    </tr>
                    {dhhEditingId === emp.id && (
                      <tr>
                        <td colSpan={spaltenAnzahl}>
                          <DoppelteHaushaltsfuehrungFormular
                            employeeId={emp.id}
                            saisonJahr={CURRENT_YEAR}
                            canEdit={canView}
                            titel={`Doppelte Haushaltsführung ${CURRENT_YEAR} - ${emp.name}, ${emp.vorname}`}
                            onGespeichert={() => {
                              setDhhEditingId(null);
                              load();
                            }}
                            onAbbrechen={() => setDhhEditingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                    {offenId === emp.id && (
                      <tr>
                        <td colSpan={spaltenAnzahl} className="bg-neutral-50">
                          <div className="flex flex-col gap-3 py-2">
                            <p className="text-xs text-neutral-500">
                              Neues Dokument für {emp.name}, {emp.vorname}{" "}
                              hochladen.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={kategorie}
                                onChange={(e) => {
                                  setKategorie(
                                    e.target.value as DokumentKategorie
                                  );
                                  setFuehrerscheinAuswahl([]);
                                }}
                              >
                                {DOKUMENT_KATEGORIEN.map((k) => (
                                  <option key={k} value={k}>
                                    {k}
                                  </option>
                                ))}
                              </select>
                              {kategorie === FUEHRERSCHEIN_KATEGORIE && (
                                <div className="flex items-center gap-2 rounded border border-neutral-200 px-2 py-1">
                                  <span className="text-xs text-neutral-500">
                                    Klassen:
                                  </span>
                                  {FUEHRERSCHEIN_KATEGORIEN.map((k) => (
                                    <label
                                      key={k}
                                      className="flex items-center gap-1 text-xs"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={fuehrerscheinAuswahl.includes(
                                          k
                                        )}
                                        onChange={() =>
                                          toggleFuehrerscheinKlasse(k)
                                        }
                                      />
                                      {k}
                                    </label>
                                  ))}
                                </div>
                              )}
                              <input
                                key={dateiSchluessel}
                                type="file"
                                onChange={(e) =>
                                  setDatei(e.target.files?.[0] ?? null)
                                }
                              />
                              <button
                                type="button"
                                className="btn text-xs"
                                disabled={!datei || laeuft}
                                onClick={() => hochladen(emp.id)}
                              >
                                Hochladen
                              </button>
                              {fehler && (
                                <span className="text-sm text-red-600">
                                  {fehler}
                                </span>
                              )}
                            </div>

                            {empDocs.length > 0 && (
                              <table>
                                <thead>
                                  <tr>
                                    <th>Kategorie</th>
                                    <th>Dateiname</th>
                                    <th>Hochgeladen am</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {empDocs.map((d) => (
                                    <tr key={d.id}>
                                      <td>{d.kategorie}</td>
                                      <td>
                                        <button
                                          type="button"
                                          className="text-emerald-700 underline"
                                          onClick={() => herunterladen(d)}
                                        >
                                          {d.dateiname}
                                        </button>
                                        {d.fuehrerschein_kategorien &&
                                          d.fuehrerschein_kategorien.length >
                                            0 && (
                                            <span className="ml-1 text-neutral-500">
                                              ({d.fuehrerschein_kategorien.join(", ")})
                                            </span>
                                          )}
                                      </td>
                                      <td>{formatDatumDE(d.hochgeladen_am)}</td>
                                      <td>
                                        <button
                                          type="button"
                                          className="btn-danger text-xs"
                                          onClick={() => loeschen(d)}
                                        >
                                          Löschen
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
