"use client";

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import PersonalTabs from "@/components/PersonalTabs";
import SvFragebogenFormular, {
  SV_VERGLEICHS_FELDER,
} from "@/components/SvFragebogenFormular";
import AbrechnungsHistorie from "@/components/AbrechnungsHistorie";
import type {
  Employee,
  EmployeeStatusChain,
  Herkunft,
  SvAbschnitt,
  SvFragebogenAuswertung,
  SvPruefung,
} from "@/lib/types";
import { formatDatumDE } from "@/lib/format";
import {
  angewendeteRegel,
  resttageFarbeClass,
  resttageText,
  svFreiheitResttage,
  tageAufschluesselung,
} from "@/lib/svPruefung";

const CURRENT_YEAR = new Date().getFullYear();
// Das Formular zur Feststellung der Versicherungspflicht wird seit
// 2026-08-11 NICHT mehr hochgeladen (Nutzer-Vorgabe) - der über das
// Fragebogen-Formular erfasste Inhalt ist der Nachweis.

// Ein Tag vor einem gegebenen ISO-Datum - für "Status war ... bis" (der
// Tag vor Beginn des Nachfolge-Status). Über UTC-Millisekunden statt
// lokaler Zeitzone (gleicher Fallstrick wie beim xlsx-Datumsimport).
function vortag(iso: string): string {
  const [j, m, t] = iso.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1, t) - 86400000).toISOString().slice(0, 10);
}

export default function SozialversicherungPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  // Nutzer-Vorgabe 2026-08-21: Filter nach Herkunft, wie auf der
  // Personalstamm-Seite (app/mitarbeiter/page.tsx).
  const [herkunftFilter, setHerkunftFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
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
  // Für die Tage-Aufschlüsselung im Tooltip bei "Angewendete Regel"
  // (Nutzer-Vorgabe 2026-08-15) - ungruppiert, tageAufschluesselung()
  // filtert selbst je Person.
  const [svAbschnitte, setSvAbschnitte] = useState<SvAbschnitt[]>([]);
  // Nutzer-Vorgabe 2026-08-24: verknüpft eine Personalnummer mit ihrer
  // Vorgänger-/Nachfolge-Nummer aus einem Statuswechsel, damit "Überschritten
  // seit X Tagen" auf einer inzwischen inaktiven Nummer nicht wie ein
  // weiterhin offenes Problem wirkt, wenn sie längst korrekt auf
  // sozialversicherungspflichtig umgestellt wurde.
  const [statusChain, setStatusChain] = useState<
    Record<string, EmployeeStatusChain>
  >({});

  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase.from("employees").select("*").order("personal_nr");
    if (!showInactive) query = query.eq("aktiv", true);
    const [
      { data: emps },
      { data: frag },
      { data: fragVorjahr },
      { data: pr },
      { data: abschnitte },
      { data: herkunftData },
      { data: chain },
    ] = await Promise.all([
      query,
      supabase
        .from("sv_fragebogen_auswertung")
        .select("*")
        .eq("saison_jahr", jahr),
      supabase
        .from("sv_fragebogen_auswertung")
        .select("*")
        .eq("saison_jahr", jahr - 1),
      supabase.from("employee_sv_pruefung").select("*").eq("saison_jahr", jahr),
      supabase
        .from("employee_sv_abschnitte")
        .select("*")
        .eq("saison_jahr", jahr),
      supabase.from("herkuenfte").select("*").order("reihenfolge"),
      supabase.from("employee_status_chain").select("*"),
    ]);
    setSvAbschnitte((abschnitte as SvAbschnitt[]) ?? []);
    setEmployees((emps as Employee[]) ?? []);
    setHerkuenfte((herkunftData as Herkunft[]) ?? []);
    const mapChain: Record<string, EmployeeStatusChain> = {};
    ((chain as EmployeeStatusChain[]) ?? []).forEach((c) => {
      mapChain[c.employee_id] = c;
    });
    setStatusChain(mapChain);
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
    const passtSuche =
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q);
    const passtHerkunft = !herkunftFilter || e.herkunft === herkunftFilter;
    return passtSuche && passtHerkunft;
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

      <div className="sticky top-14 z-30 flex flex-wrap items-center gap-4 bg-sand py-2 text-sm">
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
        <label>
          Herkunft{" "}
          <select
            value={herkunftFilter}
            onChange={(e) => setHerkunftFilter(e.target.value)}
          >
            <option value="">Alle</option>
            {herkuenfte.map((h) => (
              <option key={h.wert} value={h.wert}>
                {h.wert}
              </option>
            ))}
          </select>
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
              <th>Herkunft</th>
              <th>Status {jahr}</th>
              <th title="Status vor einem Statuswechsel (diese Nummer hat eine Vorgänger-Nummer)">
                Status war
              </th>
              <th title="Datum, seit dem der aktuelle Status gilt (bei einer Nachfolge-Nummer aus einem Statuswechsel) bzw. seit dem eine Nachfolge-Nummer für diese Person läuft">
                … seit
              </th>
              <th>Vorbeschäftigung Deutschland (Tage)</th>
              <th title="15 Wochen = 105 Kalendertage je Kalenderjahr, über alle Beschäftigungsabschnitte und alle deutschen Arbeitgeber zusammengerechnet">
                Angewendete Regel
              </th>
              <th title="Aus den Angaben abgeleiteter Zeitraum, in dem eine Beschäftigung in Deutschland sozialversicherungsfrei möglich ist">
                SV-freier Zeitraum
              </th>
              <th title="Resttage bis zum empfohlenen Austrittsdatum (das frühere von 15-Wochen-Ende und SV-frei-Ende laut Angaben) - erst berechenbar, sobald mindestens ein Arbeitstag erfasst ist">
                Ende der SV-Freiheit (Tage)
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
              const svPruefung = pruefung[emp.id];
              const resttage = svPruefung ? svFreiheitResttage(svPruefung) : null;
              // Bei bereits sozialversicherungspflichtiger Abrechnung sind
              // ALLE Prüfungen auf SV-Freiheit gegenstandslos - die Person
              // ist ja pflichtversichert (Nutzer-Vorgabe 2026-08-11). Ein
              // vorhandener Fragebogen aus der Zeit davor darf dann keine
              // Zeiträume oder Regeln mehr anzeigen, sonst wirkt es, als
              // gäbe es noch etwas zu prüfen.
              const svPflichtig =
                emp.abrechnungsart === "sozialversicherungspflichtig";
              const chain = statusChain[emp.id];
              return (
                <Fragment key={emp.id}>
                  <tr className={emp.aktiv ? "" : "opacity-50"}>
                    <td>{emp.personal_nr}</td>
                    <td>
                      {emp.name}, {emp.vorname}
                    </td>
                    <td>{emp.herkunft ?? "—"}</td>
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
                    <td className="text-xs">
                      {/* Nutzer-Vorgabe 2026-08-24: "Zeitraum war von:
                          Kurzfristig/SV-Frei/SV-Pflichtig" - nur befüllt,
                          wenn diese Nummer selbst aus einem Statuswechsel
                          entstanden ist (hat einen Vorgänger). */}
                      {chain?.vorheriger_status ? (
                        <span
                          title={
                            chain.aktueller_status_seit
                              ? `bis ${formatDatumDE(vortag(chain.aktueller_status_seit))}`
                              : undefined
                          }
                        >
                          {chain.vorheriger_status}
                        </span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="text-xs">
                      {/* Nutzer-Vorgabe 2026-08-24, mit Feinschliff noch am
                          selben Tag ("von...bis" statt nur "seit"): entweder
                          das eigene Startdatum (diese Nummer ist eine
                          Nachfolge-Nummer, Status läuft noch) oder, falls
                          diese Nummer selbst eine Nachfolge-Nummer hat
                          (jetzt inaktiv, per Statuswechsel abgelöst), der
                          abgeschlossene Zeitraum "von eigenem
                          Beschäftigungsbeginn bis Vortag des Wechsels" plus
                          ein kleiner Verweis auf die neue Nummer - genau das
                          fehlte bisher: "Überschritten seit X Tagen" auf
                          einer inaktiven Nummer wirkte wie ein weiterhin
                          offenes Problem, obwohl die Person längst korrekt
                          auf die neue Nummer umgestellt wurde. */}
                      {chain?.aktueller_status_seit ? (
                        formatDatumDE(chain.aktueller_status_seit)
                      ) : chain?.nachfolger_status ? (
                        <>
                          {chain.eigener_erster_arbeitstag &&
                          chain.nachfolger_seit ? (
                            <span className="font-medium">
                              von {formatDatumDE(chain.eigener_erster_arbeitstag)}{" "}
                              bis {formatDatumDE(vortag(chain.nachfolger_seit))}
                            </span>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                          <span
                            className="ml-1 text-neutral-500"
                            title={`Neue Personalnummer ${chain.nachfolger_personal_nr ?? "—"}`}
                          >
                            (→ {chain.nachfolger_status} ab{" "}
                            {chain.nachfolger_seit
                              ? formatDatumDE(chain.nachfolger_seit)
                              : "—"}
                            )
                          </span>
                        </>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td
                      title={
                        f?.vorbeschaeftigung_deutschland_von &&
                        f?.vorbeschaeftigung_deutschland_bis
                          ? `Aus dem Zeitraum ${formatDatumDE(f.vorbeschaeftigung_deutschland_von)} – ${formatDatumDE(f.vorbeschaeftigung_deutschland_bis)} berechnet`
                          : undefined
                      }
                    >
                      {svPflichtig ? (
                        <span className="text-neutral-400">entfällt</span>
                      ) : !f ||
                        f.vorbeschaeftigung_deutschland_tage_effektiv === 0 ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        <>
                          {f.vorbeschaeftigung_deutschland_tage_effektiv}
                          {f.vorbeschaeftigung_deutschland_von &&
                            f.vorbeschaeftigung_deutschland_bis && (
                              <span className="ml-1 text-xs text-neutral-500">
                                (Zeitraum)
                              </span>
                            )}
                        </>
                      )}
                    </td>
                    <td className="text-xs">
                      {svPflichtig ? (
                        <span
                          className="text-neutral-400"
                          title="Die Person ist sozialversicherungspflichtig - eine Tage-Grenze für SV-Freiheit gibt es hier nicht"
                        >
                          entfällt
                        </span>
                      ) : svPruefung ? (
                        <span title={tageAufschluesselung(svPruefung, svAbschnitte)}>
                          {angewendeteRegel(svPruefung)}
                        </span>
                      ) : (
                        <span className="text-neutral-400">
                          15 Wochen (105 Tage)
                        </span>
                      )}
                    </td>
                    <td className="text-xs">
                      {svPflichtig ? (
                        <span
                          className="text-neutral-400"
                          title="Die Person ist sozialversicherungspflichtig - ein SV-freier Zeitraum ist damit gegenstandslos"
                        >
                          entfällt
                        </span>
                      ) : !f || !f.sv_frei_von ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        <>
                          {/* Bei den offenen Zuständen (Hausfrau/Rente/
                              Selbstständigkeit) ist f.sv_frei_von nur das
                              Nachweis-Datum aus dem Formular - der Zeitraum
                              beginnt dort mit dem Arbeitsbeginn
                              (Nutzer-Korrektur 2026-08-11). Die Sicht
                              employee_sv_pruefung liefert genau das bereits
                              richtig; ohne erfassten Arbeitstag gibt es sie
                              noch nicht, dann der Regeltext. */}
                          {f.sv_frei_offen ? (
                            svPruefung?.sv_frei_von ? (
                              <span title="Beginn = erster Arbeitstag; das Datum im Formular weist nur nach, seit wann der Zustand besteht">
                                {formatDatumDE(svPruefung.sv_frei_von)}
                              </span>
                            ) : (
                              <span
                                className="text-neutral-500"
                                title="Beginnt mit dem ersten Arbeitstag - steht fest, sobald Stunden erfasst sind"
                              >
                                ab Arbeitsbeginn
                              </span>
                            )
                          ) : (
                            formatDatumDE(f.sv_frei_von)
                          )}{" "}
                          –{" "}
                          {/* Immer das TATSÄCHLICH geltende Ende zeigen, nie
                              "unbefristet"/"offen" (Nutzer-Vorgabe
                              2026-08-10): austrittsdatum_empfohlen vereint
                              bereits 15-Wochen-Ende, Ende laut Angaben und
                              (bei Vorbeschäftigung) das 90-Tage-kombiniert-
                              Ende. Nur wenn noch kein Arbeitstag erfasst ist
                              UND die Angaben kein Ende nennen, lässt sich
                              kein Datum bilden - dann der Regeltext. */}
                          {svPruefung?.austrittsdatum_empfohlen ? (
                            <span
                              title={
                                f.sv_frei_bis &&
                                svPruefung.austrittsdatum_empfohlen ===
                                  f.sv_frei_bis
                                  ? "Ende laut Angaben (liegt vor der 15-Wochen-/90-Tage-Grenze)"
                                  : "Begrenzt durch die Tage-Grenze (siehe Spalte „Angewendete Regel“), nicht durch die Angaben"
                              }
                            >
                              {formatDatumDE(
                                svPruefung.austrittsdatum_empfohlen
                              )}
                            </span>
                          ) : f.sv_frei_bis ? (
                            formatDatumDE(f.sv_frei_bis)
                          ) : (
                            <span
                              className="text-neutral-500"
                              title="Enddatum steht erst fest, sobald der erste Arbeitstag erfasst ist - es ergibt sich dann aus der 15-Wochen- bzw. 90-Tage-Grenze ab Arbeitsbeginn"
                            >
                              15 Wochen ab Arbeitsbeginn
                            </span>
                          )}
                          {/* Nutzer-Feedback 2026-08-15: "Wie kann das sein,
                              wenn der SV-freie Zeitraum nur bis zum
                              19.07.2026 geht?" - die Lücke wurde als
                              eigener, konkurrierender Zeitraum gelesen
                              statt als Ausnahme INNERHALB des oben
                              gezeigten Zeitraums. Deshalb jetzt "Davon
                              NICHT SV-frei" statt nur "Lücke", und
                              Farbe/Text unterscheiden, ob in dieser Lücke
                              tatsächlich gearbeitet wurde (dann zählt sie
                              wirklich, siehe ueberschritten_sv_frei_luecke)
                              oder ob sie bisher nur eine Angaben-Lücke ohne
                              echte Auswirkung ist. */}
                          {f.sv_frei_luecke && (
                            <div
                              className={
                                svPruefung?.ueberschritten_sv_frei_luecke
                                  ? "font-medium text-red-600"
                                  : "text-amber-700"
                              }
                              title={
                                svPruefung?.ueberschritten_sv_frei_luecke
                                  ? "Innerhalb des oben gezeigten Zeitraums, aber NICHT SV-frei (zwischen Bezahltem Urlaub und Freistellung) - in diesem Teil-Zeitraum wurde tatsächlich gearbeitet"
                                  : "Innerhalb des oben gezeigten Zeitraums, aber NICHT SV-frei (zwischen Bezahltem Urlaub und Freistellung) - bisher wurde in diesem Teil-Zeitraum nicht gearbeitet"
                              }
                            >
                              {svPruefung?.ueberschritten_sv_frei_luecke
                                ? "⚠ "
                                : ""}
                              Davon NICHT SV-frei:{" "}
                              {formatDatumDE(f.sv_frei_luecke_von)} –{" "}
                              {formatDatumDE(f.sv_frei_luecke_bis)}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td
                      className={
                        !svPflichtig && resttage !== null
                          ? resttageFarbeClass(resttage)
                          : "text-xs"
                      }
                    >
                      {svPflichtig ? (
                        <span className="text-neutral-400">entfällt</span>
                      ) : !f ? (
                        <span className="text-neutral-400">—</span>
                      ) : resttage !== null ? (
                        resttageText(resttage)
                      ) : (
                        <span
                          className="text-neutral-400"
                          title="Erst berechenbar, sobald mindestens ein Arbeitstag mit Stunden > 0 erfasst ist"
                        >
                          —
                        </span>
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
                          {svPflichtig ? "Historie" : f ? "Bearbeiten" : "Erfassen"}
                        </button>
                      </td>
                    )}
                  </tr>
                  {editingId === emp.id && (
                    <tr>
                      <td colSpan={13}>
                        {/* Nutzer-Vorgabe 2026-08-24: Erfassen/Bearbeiten des
                            SV-Fragebogens entfällt bei sozialversicherungs-
                            pflichtig komplett - die Feststellung prüft SV-
                            Freiheit, die für diese Personen gegenstandslos
                            ist (wie schon bei den übrigen Spalten). Ein
                            evtl. vorhandener Fragebogen aus der Zeit davor
                            bleibt in der Datenbank erhalten, wird hier nur
                            nicht mehr zum Bearbeiten angeboten. */}
                        {svPflichtig ? (
                          <p className="p-2 text-sm text-neutral-500">
                            SV-Fragebogen entfällt (sozialversicherungspflichtig)
                            - unten nur die Abrechnungs-Historie.
                          </p>
                        ) : (
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
                        )}
                        {/* Bewusst IMMER anzeigen, unabhängig von
                            svPflichtig - die Abschnitts-Historie ist ein
                            reines Fakten-Protokoll (wann wurde real
                            abgerechnet), keine SV-Freiheits-Prüfung. Genau
                            die Personen, die wegen der fehlenden
                            historischen Abrechnung fälschlich schon auf
                            "sozialversicherungspflichtig" umgestellt
                            wurden, brauchen dieses Werkzeug am dringendsten
                            - ein Ausblenden wäre hier kontraproduktiv. */}
                        <AbrechnungsHistorie
                          employeeId={emp.id}
                          saisonJahr={jahr}
                          canEdit={canEdit}
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
