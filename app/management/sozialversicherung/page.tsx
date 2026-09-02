"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ABRECHNUNGSART_LABELS, type SvAbschnitt, type SvPruefung } from "@/lib/types";
import { formatDatumDE } from "@/lib/format";
import {
  angewendeteRegel,
  resttageFarbeClass,
  resttageText,
  svFreiheitResttage,
  svFreiZeitraumUeberschritten,
  tageAufschluesselung,
} from "@/lib/svPruefung";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";

const CURRENT_YEAR = new Date().getFullYear();

export default function ControllingSozialversicherungPage() {
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [faelle, setFaelle] = useState<SvPruefung[]>([]);
  const [svAbschnitte, setSvAbschnitte] = useState<SvAbschnitt[]>([]);
  const [baldEndend, setBaldEndend] = useState<SvPruefung[]>([]);
  const [svFreiheitDiskrepanz, setSvFreiheitDiskrepanz] = useState<SvPruefung[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = getSupabaseClient();
      const [{ data, error }, { data: abschnitteData }] = await Promise.all([
        supabase
          .from("employee_sv_pruefung")
          .select("*")
          .eq("saison_jahr", jahr)
          .order("beschaeftigungstage", { ascending: false }),
        supabase
          .from("employee_sv_abschnitte")
          .select("*")
          .eq("saison_jahr", jahr),
      ]);
      setSvAbschnitte((abschnitteData as SvAbschnitt[]) ?? []);
      const alle = (data as SvPruefung[]) ?? [];
      if (!error) {
        setFaelle(alle.filter((f) => f.kritisch));
        setBaldEndend(
          [...alle]
            .filter((f) => f.aktiv && f.austrittsdatum_empfohlen)
            .sort((a, b) =>
              (a.austrittsdatum_empfohlen ?? "").localeCompare(
                b.austrittsdatum_empfohlen ?? ""
              )
            )
            .slice(0, 10)
        );
        setSvFreiheitDiskrepanz(
          alle.filter((f) => !f.aktiv && svFreiZeitraumUeberschritten(f))
        );
      }
      setLoading(false);
    }
    load();
  }, [jahr]);

  return (
    <div className="flex flex-col gap-4">
      <ControllingTabs />
      <PageHeader
        icon={ShieldAlert}
        titel="Sozialversicherung (105-Tage)"
        beschreibung="15-Wochen-Kontrolle (105 Kalendertage je Kalenderjahr) plus Abgleich mit dem SV-freien Zeitraum laut den Angaben auf „Personal → Sozialversicherung“. Reine Tage-/Datums-Prüfung – ersetzt nicht die rechtliche Prüfung der Sozialversicherungsbefreiung selbst."
      />

      <p className="text-sm text-neutral-600">
        {loading ? (
          "…"
        ) : (
          <>
            <span className="font-medium text-red-600">{faelle.length}</span>{" "}
            kritische Fälle ·{" "}
            <span className="font-medium text-amber-600">
              {baldEndend.length}
            </span>{" "}
            bald endend ·{" "}
            <span className="font-medium text-neutral-600">
              {svFreiheitDiskrepanz.length}
            </span>{" "}
            Diskrepanz(en)
          </>
        )}
      </p>

      <label className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 block bg-sand py-2 text-sm">
        Saison-Jahr{" "}
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
          className="w-24"
        />
      </label>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-emerald-800">
          15-Wochen-Kontrolle (105 Tage) – kritische Fälle
        </h3>
        {loading ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : faelle.length === 0 ? (
          <p className="text-neutral-500">Keine kritischen Fälle für {jahr}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Abrechnungsart</th>
                  <th title="Allererster Arbeitstag in diesem Kalenderjahr, über ALLE Abschnitte hinweg - nicht der Beginn des aktuellen Abschnitts (siehe dort)">
                    1. Arbeitstag (Saison)
                  </th>
                  <th>Letzter Arbeitstag</th>
                  <th title="Summe der Kalendertage aller Beschäftigungsabschnitte bei uns in diesem Kalenderjahr - Pausen zwischen zwei Einsätzen zählen nicht mit">
                    Beschäftigungstage (bei uns)
                  </th>
                  <th title="Anzahl getrennter Beschäftigungsabschnitte (getrennt jeweils durch eine Abrechnung - echt in der App oder manuell nachgetragen, siehe Personal → Sozialversicherung). 1 = durchgehend.">
                    Abschnitte
                  </th>
                  <th title="Beginn des GERADE LAUFENDEN Abschnitts - maßgeblich für die 105-Tage-Berechnung, nicht der allererste Tag der Saison (siehe Spalte '1. Arbeitstag (Saison)')">
                    Aktueller Abschnitt seit
                  </th>
                  <th title="Bisherige Beschäftigungstage in Deutschland bei anderen Arbeitgebern laut SV-Fragebogen (Personal → Sozialversicherung)">
                    Vorbeschäftigung Deutschland
                  </th>
                  <th>Kombinierte Tage</th>
                  <th title="105 Kalendertage (15 Wochen) je Kalenderjahr, über alle Abschnitte und alle deutschen Arbeitgeber zusammengerechnet">
                    Rest bis 105 Tage
                  </th>
                  <th title="SV-freier Zeitraum laut Angaben (Personal → Sozialversicherung), abgeleitet aus Bezahlter Urlaub/Freistellung bzw. Schulferien/offenem Zeitraum">
                    SV-freier Zeitraum (Angaben)
                  </th>
                  <th title="Das frühere von 15-Wochen-Ende und dem Ende des SV-freien Zeitraums laut Angaben">
                    Austrittsdatum (empfohlen)
                  </th>
                  <th>Grund</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {faelle.map((f) => (
                  <tr key={f.employee_id}>
                    <td>{f.personal_nr}</td>
                    <td>
                      {f.name}, {f.vorname}
                      {!f.aktiv && (
                        <span className="ml-1 text-xs text-neutral-500">
                          (inaktiv)
                        </span>
                      )}
                    </td>
                    <td>{ABRECHNUNGSART_LABELS[f.abrechnungsart]}</td>
                    <td>{formatDatumDE(f.erster_arbeitstag)}</td>
                    <td>{formatDatumDE(f.letzter_arbeitstag)}</td>
                    <td>{f.beschaeftigungstage}</td>
                    <td
                      className={
                        f.anzahl_abschnitte > 1
                          ? "font-medium text-amber-600"
                          : ""
                      }
                    >
                      {f.anzahl_abschnitte}
                    </td>
                    <td>{formatDatumDE(f.aktueller_abschnitt_seit)}</td>
                    <td>{f.vorbeschaeftigung_deutschland_tage}</td>
                    <td>{f.kombinierte_tage}</td>
                    <td title={tageAufschluesselung(f, svAbschnitte)}>
                      {f.rest_bis_105_tage}
                    </td>
                    <td className="text-sm">
                      {f.sv_frei_von || f.sv_frei_bis ? (
                        <>
                          {formatDatumDE(f.sv_frei_von)} –{" "}
                          {f.sv_frei_bis
                            ? formatDatumDE(f.sv_frei_bis)
                            : "unbefristet"}
                          {f.sv_frei_luecke && (
                            <span
                              className="ml-1 text-amber-700"
                              title={`Lücke zwischen Bezahltem Urlaub und Freistellung: ${formatDatumDE(f.sv_frei_luecke_von)} – ${formatDatumDE(f.sv_frei_luecke_bis)}`}
                            >
                              ⚠ Lücke
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-neutral-400">keine Angaben</span>
                      )}
                    </td>
                    <td>{formatDatumDE(f.austrittsdatum_empfohlen)}</td>
                    <td className="text-sm">
                      {[
                        f.ueberschritten_105_tage
                          ? f.vorbeschaeftigung_deutschland_tage > 0
                            ? "15-Wochen-Grenze (mit Vorbeschäftigung)"
                            : "15-Wochen-Grenze"
                          : null,
                        f.ueberschritten_sv_frei_beginn
                          ? "SV-freier Zeitraum (Angaben) beginnt zu spät"
                          : null,
                        f.ueberschritten_sv_frei_ende
                          ? "SV-freier Zeitraum (Angaben) überschritten"
                          : null,
                        f.ueberschritten_sv_frei_luecke
                          ? "Lücke im SV-freien Zeitraum"
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" + ")}
                    </td>
                    <td className="font-medium text-red-600">
                      ⚠ Überschritten
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-emerald-800">
          Nächste 10, deren SV-freier Zeitraum endet
        </h3>
        <p className="mb-2 text-sm text-neutral-500">
          Proaktive Vorausschau (unabhängig davon, ob bereits kritisch) -
          sortiert nach empfohlenem Austrittsdatum, das nächste zuerst.
        </p>
        {loading ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : baldEndend.length === 0 ? (
          <p className="text-neutral-500">
            Keine Fälle mit bekanntem Austrittsdatum für {jahr}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Abrechnungsart</th>
                  <th>Angewendete Regel</th>
                  <th>Austrittsdatum (empfohlen)</th>
                  <th>Ende der SV-Freiheit (Tage)</th>
                </tr>
              </thead>
              <tbody>
                {baldEndend.map((f) => {
                  const tage = svFreiheitResttage(f);
                  return (
                    <tr key={f.employee_id}>
                      <td>{f.personal_nr}</td>
                      <td>
                        {f.name}, {f.vorname}
                      </td>
                      <td>{ABRECHNUNGSART_LABELS[f.abrechnungsart]}</td>
                      <td>{angewendeteRegel(f)}</td>
                      <td>{formatDatumDE(f.austrittsdatum_empfohlen)}</td>
                      <td
                        className={
                          tage !== null ? resttageFarbeClass(tage) : ""
                        }
                      >
                        {tage !== null ? resttageText(tage) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-emerald-800">
          SV-Freiheit Diskrepanz
        </h3>
        <p className="mb-2 text-sm text-neutral-500">
          Rein dokumentierend (keine akute Handlungsaufforderung mehr): bereits
          inaktive Personen, bei denen die tatsächliche Beschäftigung den
          SV-freien Zeitraum laut Angaben überschritten hat.
        </p>
        {loading ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : svFreiheitDiskrepanz.length === 0 ? (
          <p className="text-neutral-500">
            Keine Diskrepanzen bei inaktiven Personen für {jahr}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th title="Allererster Arbeitstag in diesem Kalenderjahr, über ALLE Abschnitte hinweg">
                    1. Arbeitstag (Saison)
                  </th>
                  <th>Letzter Arbeitstag</th>
                  <th title="Aus den Angaben abgeleiteter Zeitraum, in dem eine Beschäftigung in Deutschland sozialversicherungsfrei möglich ist">
                    SV-freier Zeitraum (Angaben)
                  </th>
                  <th>Grund</th>
                </tr>
              </thead>
              <tbody>
                {svFreiheitDiskrepanz.map((f) => (
                  <tr key={f.employee_id}>
                    <td>{f.personal_nr}</td>
                    <td>
                      {f.name}, {f.vorname}
                      <span className="ml-1 text-xs text-neutral-500">
                        (inaktiv)
                      </span>
                    </td>
                    <td>{formatDatumDE(f.erster_arbeitstag)}</td>
                    <td>{formatDatumDE(f.letzter_arbeitstag)}</td>
                    <td className="text-sm">
                      {f.sv_frei_von || f.sv_frei_bis ? (
                        <>
                          {formatDatumDE(f.sv_frei_von)} –{" "}
                          {f.sv_frei_bis ? formatDatumDE(f.sv_frei_bis) : "offen"}
                        </>
                      ) : (
                        <span className="text-neutral-400">keine Angaben</span>
                      )}
                    </td>
                    <td className="text-sm">
                      {[
                        f.ueberschritten_sv_frei_beginn
                          ? "SV-freier Zeitraum (Angaben) beginnt zu spät"
                          : null,
                        f.ueberschritten_sv_frei_ende
                          ? "SV-freier Zeitraum (Angaben) überschritten"
                          : null,
                        f.ueberschritten_sv_frei_luecke
                          ? "Lücke im SV-freien Zeitraum"
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" + ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
