"use client";

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import PersonalTabs from "@/components/PersonalTabs";
import SvFragebogenFormular, {
  SV_VERGLEICHS_FELDER,
} from "@/components/SvFragebogenFormular";
import type { Employee, SvFragebogenAuswertung, SvPruefung } from "@/lib/types";
import { formatDatumDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();

// Zeigt das tatsächlich geltende Ende des SV-freien Zeitraums an - NIE
// pauschal "unbefristet" (Nutzer-Vorgabe 2026-08-10: irreführend, da immer
// durch die 15-Wochen-Grenze - bzw. bei Vorbeschäftigung/Rückkehr die
// 90-Tage-Grenze kombiniert - begrenzt). Braucht dafür den tatsächlichen
// Arbeitsbeginn (aus employee_sv_pruefung, nur vorhanden sobald mindestens
// ein Arbeitstag mit Stunden > 0 erfasst ist) - ohne den lässt sich kein
// konkretes Datum nennen, dafür aber die geltende Regel.
function svFreiZeitraumAnzeige(
  f: SvFragebogenAuswertung,
  p: SvPruefung | undefined
): { bis: string | null; label: string; hinweis?: string } {
  const vorbeschaeftigt = (f.vorbeschaeftigung_deutschland_tage ?? 0) > 0;
  const hinweis90 = vorbeschaeftigt
    ? `Bei Vorbeschäftigung/Rückkehr gilt zusätzlich die 90-Tage-Grenze kombiniert (bereits ${f.vorbeschaeftigung_deutschland_tage} Tage angegeben)`
    : undefined;

  if (p) {
    // Arbeitsbeginn bekannt: austrittsdatum_empfohlen ist bereits das
    // frühere von 15-Wochen-Ende und dem Ende laut Angaben (sv_frei_bis,
    // NULL-sicher), siehe employee_sv_pruefung in schema.sql.
    const laut15Wochen =
      !f.sv_frei_bis || p.austrittsdatum_15_wochen <= f.sv_frei_bis;
    return {
      bis: p.austrittsdatum_empfohlen,
      label: laut15Wochen
        ? "15-Wochen-Grenze ab Arbeitsbeginn"
        : "laut Angaben",
      hinweis: hinweis90,
    };
  }
  if (f.sv_frei_bis) {
    return {
      bis: f.sv_frei_bis,
      label: "laut Angaben",
      hinweis:
        "Zusätzlich befristet auf 15 Wochen ab Arbeitsbeginn" +
        (hinweis90 ? " · " + hinweis90 : ""),
    };
  }
  return {
    bis: null,
    label: "Befristet auf 15 Wochen ab Arbeitsbeginn in Deutschland",
    hinweis: hinweis90,
  };
}

export default function SozialversicherungPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [fragebogen, setFragebogen] = useState<
    Record<string, SvFragebogenAuswertung>
  >({});
  const [fragebogenVorjahr, setFragebogenVorjahr] = useState<
    Record<string, SvFragebogenAuswertung>
  >({});
  // Tatsächlicher Beschäftigungszeitraum (nur vorhanden, wenn schon
  // mindestens ein Arbeitstag mit Stunden > 0 erfasst ist - siehe
  // employee_sv_pruefung in schema.sql) - nötig, um die 15-Wochen-Grenze
  // ab Arbeitsbeginn korrekt anzuzeigen statt fälschlich "unbefristet"
  // (Nutzer-Vorgabe 2026-08-10).
  const [pruefung, setPruefung] = useState<Record<string, SvPruefung>>({});

  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase.from("employees").select("*").order("personal_nr");
    if (!showInactive) query = query.eq("aktiv", true);
    const [{ data: emps }, { data: frag }, { data: fragVorjahr }, { data: pr }] =
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
        supabase
          .from("employee_sv_pruefung")
          .select("*")
          .eq("saison_jahr", jahr),
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
    const mapPruefung: Record<string, SvPruefung> = {};
    ((pr as SvPruefung[]) ?? []).forEach((p) => {
      mapPruefung[p.employee_id] = p;
    });
    setPruefung(mapPruefung);
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
        <table>
          <thead>
            <tr>
              <th>Pers.-Nr.</th>
              <th>Name</th>
              <th>Status {jahr}</th>
              <th>Vorbeschäftigung Deutschland (Tage)</th>
              <th title="Aus den Angaben abgeleiteter Zeitraum, in dem eine Beschäftigung in Deutschland sozialversicherungsfrei möglich ist">
                SV-freier Zeitraum
              </th>
              <th>Angaben {jahr}</th>
              <th>Zum Vorjahr ({jahr - 1})</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {gefiltert.map((emp) => {
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
              const svFreiAnzeige = f
                ? svFreiZeitraumAnzeige(f, pruefung[emp.id])
                : null;
              return (
                <Fragment key={emp.id}>
                  <tr className={emp.aktiv ? "" : "opacity-50"}>
                    <td>{emp.personal_nr}</td>
                    <td>
                      {emp.name}, {emp.vorname}
                    </td>
                    <td>
                      {emp.abrechnungsart === "sozialversicherungspflichtig" ? (
                        // Eine SV-Freiheits-Feststellung ergibt für bereits
                        // sozialversicherungspflichtig beschäftigte Personen
                        // keinen Sinn mehr (Nutzer-Vorgabe 2026-08-09) - der
                        // Status zeigt hier direkt die Abrechnungsart statt
                        // der Fragebogen-Auswertung.
                        <span
                          className="font-medium text-neutral-700"
                          title="Abrechnungsart: sozialversicherungspflichtig - eine Feststellung zur SV-Freiheit ist hier nicht relevant"
                        >
                          SV-Pflicht.
                        </span>
                      ) : !f ? (
                        <span className="text-neutral-400">Nicht erfasst</span>
                      ) : f.bestanden ? (
                        <span className="font-medium text-emerald-700">
                          ✓ SV-Frei
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
                      {!f || !f.sv_frei_von || !svFreiAnzeige ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        <>
                          {formatDatumDE(f.sv_frei_von)} –{" "}
                          {svFreiAnzeige.bis
                            ? formatDatumDE(svFreiAnzeige.bis)
                            : "…"}
                          <div className="text-neutral-500">
                            ({svFreiAnzeige.label})
                          </div>
                          {svFreiAnzeige.hinweis && (
                            <div className="text-amber-700">
                              {svFreiAnzeige.hinweis}
                            </div>
                          )}
                          {f.sv_frei_luecke && (
                            <div
                              className="text-amber-700"
                              title="Lücke zwischen Bezahltem Urlaub und Freistellung - in diesem Zeitraum nicht SV-frei"
                            >
                              ⚠ Lücke:{" "}
                              {formatDatumDE(f.sv_frei_luecke_von)} –{" "}
                              {formatDatumDE(f.sv_frei_luecke_bis)}
                            </div>
                          )}
                        </>
                      )}
                    </td>
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
                      <td colSpan={8}>
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
