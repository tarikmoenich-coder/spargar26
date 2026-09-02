"use client";

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  DOKUMENT_KATEGORIEN,
  FUEHRERSCHEIN_KATEGORIEN,
  type DokumentKategorie,
  type EmployeeDocument,
} from "@/lib/types";
import { formatDatumDE } from "@/lib/format";
import PersonalTabs from "@/components/PersonalTabs";

const DOKUMENTE_BUCKET = "mitarbeiter-dokumente";
const FUEHRERSCHEIN_KATEGORIE: DokumentKategorie = "Führerschein Kopie";

// Die beiden Fach-Formulare ("Doppelte Haushaltsführung" und "Feststellung
// der Versicherungspflicht") wurden 2026-08-11 als Dokument-Kategorie ganz
// entfernt: sie werden nicht mehr hochgeladen, sondern ausschließlich über
// ihre Eingabemaske erfasst (Personal → Lohnsteuer bzw.
// Sozialversicherung). Die dort erfassten Angaben sind der Nachweis, und
// die Anreiseliste-Checkliste prüft entsprechend diese Angaben.
// Die Hochzeitsurkunde bleibt hier (allgemeiner Personalnachweis) und ist
// zusätzlich auf der Lohnsteuer-Seite sichtbar, wo sie gebraucht wird.
const SICHTBARE_KATEGORIEN: DokumentKategorie[] = [...DOKUMENT_KATEGORIEN];

interface Row {
  id: string;
  personal_nr: string;
  herkunft: string | null;
  name: string;
  vorname: string;
  ort: string | null;
  aktiv: boolean;
}

export default function PersonalDokumentePage() {
  const { profile } = useProfile();
  const canView = profile?.role === "admin" || profile?.role === "hr";

  const [employees, setEmployees] = useState<Row[]>([]);
  const [dokumente, setDokumente] = useState<Record<string, EmployeeDocument[]>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [offenId, setOffenId] = useState<string | null>(null);
  const [kategorie, setKategorie] = useState<DokumentKategorie>(
    SICHTBARE_KATEGORIEN[0]
  );
  const [fuehrerscheinAuswahl, setFuehrerscheinAuswahl] = useState<string[]>(
    []
  );
  const [datei, setDatei] = useState<File | null>(null);
  const [dateiSchluessel, setDateiSchluessel] = useState(0);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: docs }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, personal_nr, herkunft, name, vorname, ort, aktiv")
        .order("name"),
      supabase
        .from("employee_documents")
        .select("*")
        .order("hochgeladen_am", { ascending: false }),
    ]);
    setEmployees((emp as Row[]) ?? []);
    const map: Record<string, EmployeeDocument[]> = {};
    ((docs as EmployeeDocument[]) ?? []).forEach((d) => {
      if (!map[d.employee_id]) map[d.employee_id] = [];
      map[d.employee_id].push(d);
    });
    setDokumente(map);
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
    setKategorie(SICHTBARE_KATEGORIEN[0]);
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

  // 5 Identitäts-Spalten + sichtbare Dokument-Kategorien + 1 Aktions-Spalte.
  const spaltenAnzahl = 5 + SICHTBARE_KATEGORIEN.length + 1;

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
          Allgemeine Personaldokumente je Mitarbeiter und Kategorie. Leere
          Felder bedeuten: für diese Kategorie wurde noch nichts hochgeladen.
          Downloads laufen über zeitlich begrenzte Links. Die beiden
          Fach-Formulare („Doppelte Haushaltsführung" und „Feststellung der
          Versicherungspflicht") werden nicht mehr hochgeladen, sondern
          ausschließlich über ihre Eingabemaske erfasst – unter Personal →
          Lohnsteuer bzw. Personal → Sozialversicherung.
        </p>
      </div>

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 bg-sand py-2">
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
                {SICHTBARE_KATEGORIEN.map((k) => (
                  <th key={k}>{k}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => {
                const empDocs = dokumente[emp.id] ?? [];
                return (
                  <Fragment key={emp.id}>
                    <tr className={emp.aktiv ? "" : "opacity-50"}>
                      <td>{emp.personal_nr}</td>
                      <td>{emp.herkunft ?? "—"}</td>
                      <td>{emp.name}</td>
                      <td>{emp.vorname}</td>
                      <td>{emp.ort}</td>
                      {SICHTBARE_KATEGORIEN.map((k) => {
                        const treffer = empDocs.filter(
                          (d) => d.kategorie === k
                        );
                        return (
                          <td key={k} className="text-sm">
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
                              </div>
                            )}
                          </td>
                        );
                      })}
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
                    {offenId === emp.id && (
                      <tr>
                        <td colSpan={spaltenAnzahl} className="bg-sand">
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
                                {SICHTBARE_KATEGORIEN.map((k) => (
                                  <option key={k} value={k}>
                                    {k}
                                  </option>
                                ))}
                              </select>
                              {kategorie === FUEHRERSCHEIN_KATEGORIE && (
                                <div className="flex items-center gap-2 rounded border border-linie px-2 py-1">
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
