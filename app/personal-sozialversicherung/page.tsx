"use client";

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import PersonalTabs from "@/components/PersonalTabs";
import SvFragebogenFormular, {
  SV_VERGLEICHS_FELDER,
} from "@/components/SvFragebogenFormular";
import type { Employee, SvFragebogenAuswertung } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

export default function SozialversicherungPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [fragebogen, setFragebogen] = useState<
    Record<string, SvFragebogenAuswertung>
  >({});
  const [fragebogenVorjahr, setFragebogenVorjahr] = useState<
    Record<string, SvFragebogenAuswertung>
  >({});

  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase.from("employees").select("*").order("personal_nr");
    if (!showInactive) query = query.eq("aktiv", true);
    const [{ data: emps }, { data: frag }, { data: fragVorjahr }] =
      await Promise.all([
        query,
        supabase
          .from("sv_fragebogen_auswertung")
          .select("*")
          .eq("saison_jahr", jahr),
        supabase
          .from("sv_fragebogen_auswertung")
          .select("*")
          .eq("saison_jahr", jahr - 1),
      ]);
    setEmployees((emps as Employee[]) ?? []);
    const map: Record<string, SvFragebogenAuswertung> = {};
    ((frag as SvFragebogenAuswertung[]) ?? []).forEach((f) => {
      map[f.employee_id] = f;
    });
    setFragebogen(map);
    const mapVorjahr: Record<string, SvFragebogenAuswertung> = {};
    ((fragVorjahr as SvFragebogenAuswertung[]) ?? []).forEach((f) => {
      mapVorjahr[f.employee_id] = f;
    });
    setFragebogenVorjahr(mapVorjahr);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr, showInactive]);

  return (
    <div className="flex flex-col gap-4">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Sozialversicherung
        </h1>
        <p className="text-sm text-neutral-500">
          SV-Fragebogen ("Fragebogen zur Feststellung der
          Versicherungspflicht/Versicherungsfreiheit rumänischer
          Saisonarbeitnehmer") - manuell vom ausgefüllten Papierformular
          abgetippt, ein Datensatz je Person und Saison-Jahr. Die
          Auswertung ist eine Einschätzung nach der allgemeinen
          Berufsmäßigkeits-Regel, keine steuerberaterlich geprüfte
          Rechtsauskunft - als Warnung gedacht, keine automatische Sperre.
        </p>
      </div>

      <div className="sticky top-14 z-30 flex flex-wrap items-center gap-4 bg-neutral-50 py-2 text-sm">
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
        <table>
          <thead>
            <tr>
              <th>Pers.-Nr.</th>
              <th>Name</th>
              <th>Status {jahr}</th>
              <th>Vorbeschäftigung Deutschland (Tage)</th>
              <th>Angaben {jahr}</th>
              <th>Zum Vorjahr ({jahr - 1})</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              const f = fragebogen[emp.id];
              const fVorjahr = fragebogenVorjahr[emp.id];
              const aenderungen = fVorjahr
                ? SV_VERGLEICHS_FELDER.filter(
                    (v) => !!f?.[v.key] !== !!fVorjahr[v.key]
                  )
                : [];
              // Rechtlich kann/darf nur genau einer der Blöcke 1/2/3/4/5/6
              // zutreffen (Nutzer-Vorgabe 2026-08-08) - hier nur den
              // zutreffenden zeigen statt aller Ja/Nein-Werte. Mehr als
              // einer wäre ein Dateneingabe-Fehler und wird als solcher
              // markiert statt ihn stillschweigend zu verstecken.
              const zutreffendeFelder = f
                ? SV_VERGLEICHS_FELDER.filter((v) => f[v.key] === true)
                : [];
              return (
                <Fragment key={emp.id}>
                  <tr className={emp.aktiv ? "" : "opacity-50"}>
                    <td>{emp.personal_nr}</td>
                    <td>
                      {emp.name}, {emp.vorname}
                    </td>
                    <td>
                      {!f ? (
                        <span className="text-neutral-400">Nicht erfasst</span>
                      ) : f.bestanden ? (
                        <span className="font-medium text-emerald-700">
                          ✓ Bestanden
                        </span>
                      ) : f.unvollstaendig_fehlerhaft ? (
                        <span
                          className="font-medium text-red-600"
                          title={f.unvollstaendig_fehlerhaft_grund ?? undefined}
                        >
                          ⚠ Unvollständig/Fehlerhaft
                        </span>
                      ) : (
                        <span className="font-medium text-red-600">
                          ⚠ Nicht bestanden
                        </span>
                      )}
                    </td>
                    <td>{f?.vorbeschaeftigung_deutschland_tage ?? "—"}</td>
                    <td className="text-xs">
                      {!f ? (
                        <span className="text-neutral-400">—</span>
                      ) : zutreffendeFelder.length === 0 ? (
                        <span className="text-neutral-400">
                          keine Angabe mit "Ja"
                        </span>
                      ) : zutreffendeFelder.length > 1 ? (
                        <span
                          className="font-medium text-red-600"
                          title='Mehrere Angaben mit "Ja" gleichzeitig - rechtlich nicht möglich, bitte Eingabe prüfen'
                        >
                          ⚠ {zutreffendeFelder.map((v) => v.label).join(", ")}
                        </span>
                      ) : (
                        zutreffendeFelder[0].label
                      )}
                    </td>
                    <td>
                      {!fVorjahr ? (
                        <span className="text-neutral-400">
                          kein Vorjahresdatensatz
                        </span>
                      ) : aenderungen.length === 0 ? (
                        <span className="text-neutral-500">unverändert</span>
                      ) : (
                        <span className="text-amber-600">
                          Geändert: {aenderungen.map((a) => a.label).join(", ")}
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
                          {f ? "Bearbeiten" : "Erfassen"}
                        </button>
                      </td>
                    )}
                  </tr>
                  {editingId === emp.id && (
                    <tr>
                      <td colSpan={7}>
                        <SvFragebogenFormular
                          employeeId={emp.id}
                          saisonJahr={jahr}
                          canEdit={canEdit}
                          titel={`SV-Fragebogen ${jahr} - ${emp.name}, ${emp.vorname}`}
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
      )}
    </div>
  );
}
