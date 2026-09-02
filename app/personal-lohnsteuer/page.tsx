"use client";

// "Personal → Lohnsteuer" (Nutzer-Vorgabe 2026-08-11): eigene Fachseite
// analog zu "Personal → Sozialversicherung". Bündelt alles zum
// Lohnsteuerabzug-Antrag an einer Stelle - Angaben aus der "Bestätigung für
// den Nachweis der doppelten Haushaltsführung" (Familienstand, Wohnsituation),
// und den Verfahrensstand beim Finanzamt. Das Formular selbst wird NICHT
// hochgeladen (Nutzer-Vorgabe 2026-08-11) - die hier erfassten Angaben
// sind der Nachweis.
// Diese Themen standen vorher verstreut auf der allgemeinen Dokumente-Seite.

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import PersonalTabs from "@/components/PersonalTabs";
import DoppelteHaushaltsfuehrungFormular from "@/components/DoppelteHaushaltsfuehrungFormular";
import FormularDokumentZelle from "@/components/FormularDokumentZelle";
import {
  FAMILIENSTAND_LABELS,
  LOHNSTEUER_STATUS_LABELS,
  WOHNSITUATION_LABELS,
  type DokumentKategorie,
  type DoppelteHaushaltsfuehrung,
  type Employee,
  type EmployeeDocument,
  type LohnsteuerStatus,
} from "@/lib/types";
import { formatDatumDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();
// Das Formular "Doppelte Haushaltsführung" wird seit 2026-08-11 NICHT mehr
// als Datei hochgeladen (Nutzer-Vorgabe) - die über das Eingabeformular
// erfassten Angaben sind der Nachweis. Die Hochzeitsurkunde bleibt ein
// echter Upload, sie ist ein fremdes Dokument.
const HOCHZEITSURKUNDE: DokumentKategorie = "Hochzeitsurkunde";
const EIN_JAHR_MS = 365 * 24 * 60 * 60 * 1000;

// Hochzeitsurkunde gilt als "ggf. erneut prüfen", wenn die zuletzt
// hochgeladene Kopie älter als ein Jahr ist - der Familienstand könnte sich
// seither geändert haben (Nutzer-Vorgabe 2026-08-08). Stand vorher auf der
// Dokumente-Seite; seit dem Umzug 2026-08-11 hier, weil der dafür nötige
// Familienstand ohnehin nur auf dieser Seite vorliegt. Nutzt hochgeladen_am
// als Näherung (kein separates Ausstellungsdatum auf den Dokumenten) -
// reicht für einen Hinweis, ersetzt keine echte Prüfung.
function hochzeitsurkundeVeraltet(docs: EmployeeDocument[]): boolean {
  const urkunden = docs.filter((d) => d.kategorie === HOCHZEITSURKUNDE);
  if (urkunden.length === 0) return false;
  const neuestes = Math.max(
    ...urkunden.map((d) => new Date(d.hochgeladen_am).getTime())
  );
  return Date.now() - neuestes > EIN_JAHR_MS;
}

// Farbe je Verfahrensstand - bewusst nur "Freibetrag erteilt" grün (der
// eigentliche Erfolgsfall), "Kein Freibetrag" rot (Ablehnung, ggf. Nachfrage
// nötig), die beiden Zwischenstände neutral bzw. dezent hervorgehoben.
function statusFarbe(status: LohnsteuerStatus): string {
  switch (status) {
    case "freibetrag_erteilt":
      return "font-medium text-emerald-700";
    case "kein_freibetrag":
      return "font-medium text-red-600";
    case "antrag_gestellt":
      return "font-medium text-amber-600";
    default:
      return "text-neutral-400";
  }
}

export default function LohnsteuerPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dhh, setDhh] = useState<Record<string, DoppelteHaushaltsfuehrung>>({});
  const [dokumente, setDokumente] = useState<
    Record<string, EmployeeDocument[]>
  >({});

  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase.from("employees").select("*").order("personal_nr");
    if (!showInactive) query = query.eq("aktiv", true);
    const [{ data: emps }, { data: dhhData }, { data: docs }] =
      await Promise.all([
        query,
        supabase
          .from("doppelte_haushaltsfuehrung")
          .select("*")
          .eq("saison_jahr", jahr),
        supabase
          .from("employee_documents")
          .select("*")
          .eq("kategorie", HOCHZEITSURKUNDE)
          .order("hochgeladen_am", { ascending: false }),
      ]);
    setEmployees((emps as Employee[]) ?? []);
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
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr, showInactive]);

  const gefiltert = employees.filter((e) => {
    const q = search.toLowerCase();
    return (
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Lohnsteuer</h1>
        <p className="text-sm text-neutral-500">
          Antrag auf Lohnsteuerabzug (doppelte Haushaltsführung): Angaben aus
          der „Bestätigung für den Nachweis der doppelten Haushaltsführung"
          (manuell vom gestempelten Papierformular abgetippt, ein Datensatz je
          Person und Saison-Jahr) sowie der Verfahrensstand beim Finanzamt.
          Wichtig: das Ausfüllen des Formulars ist noch kein gestellter Antrag –
          der Status wird deshalb immer manuell gesetzt.
        </p>
      </div>

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-4 bg-sand py-2 text-sm">
        <input
          placeholder="Suche nach Name oder Personalnummer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <label>
          Saison-Jahr{" "}
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-24"
          />
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          auch inaktive anzeigen
        </label>
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Familienstand</th>
                <th title="Laut Formular nur bei nicht verheirateten Personen abgefragt">
                  Wohnsituation
                </th>
                <th title="Verfahrensstand beim Finanzamt - wird manuell gesetzt, nicht aus dem Formular abgeleitet">
                  Status {jahr}
                </th>
                <th>Datum</th>
                <th title="Nachweis bei verheirateten Personen">
                  Hochzeitsurkunde
                </th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((emp) => {
                const d = dhh[emp.id];
                const empDocs = dokumente[emp.id] ?? [];
                return (
                  <Fragment key={emp.id}>
                    <tr className={emp.aktiv ? "" : "opacity-50"}>
                      <td>{emp.personal_nr}</td>
                      <td>
                        {emp.name}, {emp.vorname}
                      </td>
                      <td>
                        {d?.familienstand ? (
                          FAMILIENSTAND_LABELS[d.familienstand]
                        ) : (
                          <span className="text-neutral-400">
                            Nicht erfasst
                          </span>
                        )}
                      </td>
                      <td className="text-xs">
                        {!d?.familienstand ? (
                          <span className="text-neutral-400">—</span>
                        ) : d.familienstand === "verheiratet" ? (
                          <span
                            className="text-neutral-400"
                            title="Wird laut Formular nur bei nicht verheirateten Personen abgefragt"
                          >
                            entfällt
                          </span>
                        ) : d.wohnsituation ? (
                          WOHNSITUATION_LABELS[d.wohnsituation]
                        ) : (
                          <span className="text-neutral-400">
                            Nicht erfasst
                          </span>
                        )}
                      </td>
                      <td className={statusFarbe(d?.lohnsteuer_status ?? "kein_antrag")}>
                        {d
                          ? LOHNSTEUER_STATUS_LABELS[d.lohnsteuer_status]
                          : LOHNSTEUER_STATUS_LABELS.kein_antrag}
                      </td>
                      <td className="text-xs">
                        {d?.antrag_gestellt_am ? (
                          formatDatumDE(d.antrag_gestellt_am)
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td>
                        <FormularDokumentZelle
                          employeeId={emp.id}
                          kategorie={HOCHZEITSURKUNDE}
                          dokumente={empDocs}
                          canEdit={canEdit}
                          onGeaendert={load}
                        />
                        {d?.familienstand === "verheiratet" &&
                          hochzeitsurkundeVeraltet(empDocs) && (
                            <span
                              className="text-xs font-medium text-amber-800"
                              title="Letzte Kopie ist älter als ein Jahr - Familienstand ggf. erneut prüfen"
                            >
                              ⚠ ggf. erneut prüfen
                            </span>
                          )}
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() =>
                              setEditingId(editingId === emp.id ? null : emp.id)
                            }
                          >
                            {d ? "Bearbeiten" : "Erfassen"}
                          </button>
                        </td>
                      )}
                    </tr>
                    {editingId === emp.id && (
                      <tr>
                        <td colSpan={canEdit ? 8 : 7}>
                          <DoppelteHaushaltsfuehrungFormular
                            employeeId={emp.id}
                            saisonJahr={jahr}
                            canEdit={canEdit}
                            titel={`Doppelte Haushaltsführung ${jahr} - ${emp.name}, ${emp.vorname}`}
                            onGespeichert={() => {
                              setEditingId(null);
                              load();
                            }}
                            onAbbrechen={() => setEditingId(null)}
                          />
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
