"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE, formatEuro } from "@/lib/format";
import {
  generiereDokument,
  generiereKombiniertesDokument,
  type DokumentSpezifikation,
} from "@/lib/dokumentGenerator";
import type {
  Employee,
  PersonalKandidat,
  PersonalKandidatChecklisteRow,
  VerpflegungsSatz,
} from "@/lib/types";
import PersonalTabs from "@/components/PersonalTabs";
import SvFragebogenFormular from "@/components/SvFragebogenFormular";

// Saison-Jahr für den SV-Fragebogen eines Kandidaten: aus dem geplanten
// Ankunftsdatum abgeleitet (personal_kandidaten hat kein eigenes
// Saison-Jahr-Feld) - per String-Slice statt new Date(...).getFullYear(),
// um den bekannten Timezone-Stolperstein bei Datumswerten zu vermeiden.
function svSaisonJahrFuer(k: PersonalKandidat): number | null {
  return k.geplante_ankunft ? Number(k.geplante_ankunft.slice(0, 4)) : null;
}

const CURRENT_YEAR = new Date().getFullYear();

interface Vertragsfeld {
  beginn: string;
  ende: string;
}

export default function AnreiselistePage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [kandidaten, setKandidaten] = useState<PersonalKandidat[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [checkliste, setCheckliste] = useState<
    Record<string, PersonalKandidatChecklisteRow>
  >({});
  const [verpflegungssatz, setVerpflegungssatz] =
    useState<VerpflegungsSatz | null>(null);
  const [loading, setLoading] = useState(true);
  const [showVollstaendig, setShowVollstaendig] = useState(false);
  const [dokumentFehler, setDokumentFehler] = useState<string | null>(null);
  // Lokale Eingabefelder für Vertragszeitraum/Buskosten - erst beim
  // Verlassen des Feldes (onBlur) bzw. per Speichern-Klick übernommen.
  const [vertragsfelder, setVertragsfelder] = useState<
    Record<string, Vertragsfeld>
  >({});
  const [busfelder, setBusfelder] = useState<Record<string, string>>({});
  // Kandidat, für den gerade der SV-Fragebogen inline erfasst/bearbeitet
  // wird (person für person, siehe svSaisonJahrFuer).
  const [svEditingId, setSvEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [
      { data: kData },
      eData,
      { data: cData },
      { data: vData },
      { data: bData },
    ] = await Promise.all([
      supabase
        .from("personal_kandidaten")
        .select("*")
        .eq("status", "anreiseliste")
        .order("geplante_ankunft")
        .order("name"),
      ladeAlleSeiten<Employee>((von, bis) =>
        supabase
          .from("employees")
          .select("*")
          .order("personal_nr")
          .order("id")
          .range(von, bis)
      ),
      supabase.from("personal_kandidaten_checkliste").select("*"),
      supabase
        .from("verpflegungssaetze")
        .select("*")
        .order("saison_jahr", { ascending: false })
        .limit(1),
      supabase
        .from("season_bonuses")
        .select("employee_id, bus_hin")
        .eq("saison_jahr", CURRENT_YEAR),
    ]);
    const kandidatenListe = (kData as PersonalKandidat[]) ?? [];
    setKandidaten(kandidatenListe);
    setEmployees(eData);
    const cMap: Record<string, PersonalKandidatChecklisteRow> = {};
    ((cData as PersonalKandidatChecklisteRow[]) ?? []).forEach((row) => {
      cMap[row.kandidat_id] = row;
    });
    setCheckliste(cMap);
    setVerpflegungssatz(((vData as VerpflegungsSatz[]) ?? [])[0] ?? null);
    const busMap: Record<string, number> = {};
    (
      (bData as { employee_id: string; bus_hin: number }[]) ?? []
    ).forEach((row) => {
      busMap[row.employee_id] = row.bus_hin;
    });
    // Lokale Eingabefelder nur befüllen, wenn noch keine vorhanden sind -
    // sonst würde ein gerade eingetippter, noch ungespeicherter Wert beim
    // nächsten load() überschrieben werden.
    setVertragsfelder((prev) => {
      const next = { ...prev };
      kandidatenListe.forEach((k) => {
        if (!next[k.id]) {
          next[k.id] = {
            beginn: k.arbeitsbeginn_datum ?? "",
            ende: k.arbeitsende_datum ?? "",
          };
        }
      });
      return next;
    });
    setBusfelder((prev) => {
      const next = { ...prev };
      kandidatenListe.forEach((k) => {
        if (next[k.id] === undefined) {
          const bestehend = k.aktivierter_employee_id
            ? busMap[k.aktivierter_employee_id]
            : undefined;
          next[k.id] = bestehend !== undefined ? bestehend.toString() : "";
        }
      });
      return next;
    });
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function vollstaendig(k: PersonalKandidat): boolean {
    const c = checkliste[k.id];
    if (!c) return false;
    return (
      c.sv_fragebogen_bestanden &&
      c.buskosten_erfasst &&
      c.ausweiskopie_vorhanden &&
      c.fuehrerschein_erfuellt &&
      c.hochzeitsurkunde_erfuellt &&
      c.lohnsteuerabzug_erfuellt
    );
  }

  function vertragszeitraumBereit(k: PersonalKandidat): boolean {
    const f = vertragsfelder[k.id];
    return !!f && !!f.beginn && !!f.ende;
  }

  async function vertragszeitraumSpeichern(k: PersonalKandidat) {
    const werte = vertragsfelder[k.id];
    const supabase = getSupabaseClient();
    await supabase
      .from("personal_kandidaten")
      .update({
        arbeitsbeginn_datum: werte?.beginn || null,
        arbeitsende_datum: werte?.ende || null,
      })
      .eq("id", k.id);
    load();
  }

  async function checklistFeldSpeichern(
    k: PersonalKandidat,
    feld: "verheiratet_laut_fragebogen" | "lohnsteuerabzug_antrag_gewuenscht",
    wert: boolean
  ) {
    const supabase = getSupabaseClient();
    await supabase
      .from("personal_kandidaten")
      .update({ [feld]: wert })
      .eq("id", k.id);
    load();
  }

  async function buskostenSpeichern(k: PersonalKandidat) {
    const wert = busfelder[k.id];
    if (wert === undefined || wert.trim() === "") return;
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("kandidat_buskosten_setzen", {
      p_kandidat_id: k.id,
      p_bus_hin: Number(wert),
    });
    if (error) {
      setDokumentFehler(error.message);
      return;
    }
    load();
  }

  // Person reist doch nicht an (z.B. im letzten Moment abgesprungen) -
  // deaktiviert den inzwischen angelegten Mitarbeiter wieder (wie
  // "Deaktivieren" im Personalstamm - ADR-011: kein Löschen, die Historie
  // und die Personalnummer bleiben ihr dauerhaft zugeordnet) und entfernt
  // die Person aus der Anreiseliste.
  async function zurueckziehen(k: PersonalKandidat) {
    const grund = window.prompt(
      "Grund, warum die Person doch nicht anreist (Pflichtfeld, wird protokolliert):"
    );
    if (!grund) return;
    const supabase = getSupabaseClient();
    if (k.aktivierter_employee_id) {
      await supabase
        .from("employees")
        .update({ aktiv: false })
        .eq("id", k.aktivierter_employee_id);
    }
    await supabase
      .from("personal_kandidaten")
      .update({ status: "storniert", storniert_grund: grund })
      .eq("id", k.id);
    load();
  }

  async function markiereGedruckt(k: PersonalKandidat) {
    if (k.gedruckt) return;
    const supabase = getSupabaseClient();
    await supabase
      .from("personal_kandidaten")
      .update({ gedruckt: true, gedruckt_am: new Date().toISOString() })
      .eq("id", k.id);
    load();
  }

  // Baut die drei Dokument-Spezifikationen (Vorlage + Werte) für einen
  // Kandidaten - identisch zum Vorgehen in der Personalplanung, nur mit dem
  // inzwischen erfassten Vertragszeitraum aus dieser Seite.
  function dokumentSpezifikationenFuer(
    k: PersonalKandidat
  ): Record<
    "arbeitsvertrag" | "werkmietvertrag" | "bankverbindung",
    DokumentSpezifikation
  > {
    const verknuepft = k.verknuepfter_employee_id
      ? employees.find((e) => e.id === k.verknuepfter_employee_id) ?? null
      : null;
    const f = vertragsfelder[k.id];
    const gemeinsam = {
      Name: k.name,
      Vorname: k.vorname,
      Geburtsdatum: formatDatumDE(k.geburtsdatum),
      Staatsangehoerigkeit: k.nationalitaet ?? "",
      Personalnummer: k.personal_nr,
    };
    return {
      arbeitsvertrag: {
        vorlage: "Arbeitsvertrag_Vorlage.docx",
        werte: {
          ...gemeinsam,
          ArbeitsbeginnDatum: formatDatumDE(f?.beginn),
          ArbeitsendeDatum: formatDatumDE(f?.ende),
          Stundenlohn: formatEuro(k.stundenlohn),
        },
      },
      werkmietvertrag: {
        vorlage: "Werkmietvertrag_Vorlage.docx",
        werte: {
          ...gemeinsam,
          TagessatzWohnen: formatEuro(verpflegungssatz?.wohnen),
          TagessatzVerpflegung: formatEuro(verpflegungssatz?.verpflegung),
        },
      },
      bankverbindung: {
        vorlage: "Bankverbindung_Vorlage.docx",
        werte: {
          Vorname: k.vorname,
          Name: k.name,
          Personalnummer: k.personal_nr,
          Kontoinhaber: verknuepft?.zahlungsempfaenger ?? "",
          IBAN: verknuepft?.iban ?? "",
          BIC: verknuepft?.bic ?? "",
        },
      },
    };
  }

  async function dokument(
    art: "arbeitsvertrag" | "werkmietvertrag" | "bankverbindung",
    k: PersonalKandidat
  ) {
    if (!vertragszeitraumBereit(k)) return;
    setDokumentFehler(null);
    const dateiPrefix = `${k.name}_${k.vorname}`.replace(/\s+/g, "_");
    const spec = dokumentSpezifikationenFuer(k)[art];
    const artLabel =
      art === "arbeitsvertrag"
        ? "Arbeitsvertrag"
        : art === "werkmietvertrag"
          ? "Werkmietvertrag"
          : "Bankverbindung";
    try {
      await generiereDokument(
        spec.vorlage,
        spec.werte,
        `${artLabel}_${dateiPrefix}.docx`
      );
      await markiereGedruckt(k);
    } catch (err) {
      setDokumentFehler(err instanceof Error ? err.message : String(err));
    }
  }

  // Alle drei Dokumente aller Personen dieser Anreisegruppe (gleiches
  // geplantes Ankunftsdatum) in einem Dokument - nur für Personen, die schon
  // einen vollständigen Vertragszeitraum haben; fehlt er noch, wird das
  // gemeldet, statt die ganze Gruppe zu blockieren.
  async function gruppeDokumenteDrucken(gruppe: PersonalKandidat[]) {
    setDokumentFehler(null);
    const bereit = gruppe.filter((k) => vertragszeitraumBereit(k));
    const uebersprungen = gruppe.filter((k) => !vertragszeitraumBereit(k));
    if (bereit.length === 0) {
      setDokumentFehler(
        "Kein Vertragszeitraum erfasst - bitte erst Vertragsbeginn/-ende eintragen."
      );
      return;
    }
    try {
      const dokumente: DokumentSpezifikation[] = [];
      for (const k of bereit) {
        const spec = dokumentSpezifikationenFuer(k);
        dokumente.push(
          spec.arbeitsvertrag,
          spec.werkmietvertrag,
          spec.bankverbindung
        );
      }
      const datum = gruppe[0]?.geplante_ankunft ?? "unbekannt";
      await generiereKombiniertesDokument(
        dokumente,
        `Anreisegruppe_${datum}.docx`
      );
      for (const k of bereit) {
        await markiereGedruckt(k);
      }
      if (uebersprungen.length > 0) {
        setDokumentFehler(
          `Ohne Vertragszeitraum übersprungen: ${uebersprungen
            .map((k) => `${k.name}, ${k.vorname}`)
            .join(" · ")}`
        );
      }
    } catch (err) {
      setDokumentFehler(err instanceof Error ? err.message : String(err));
    }
  }

  const offene = kandidaten.filter((k) => !vollstaendig(k));
  const vollstaendigeListe = kandidaten.filter((k) => vollstaendig(k));

  const gruppen = useMemo(() => {
    const buckets = new Map<string, PersonalKandidat[]>();
    for (const k of offene) {
      const key = k.geplante_ankunft ?? "__ohne__";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(k);
    }
    const keys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === "__ohne__") return 1;
      if (b === "__ohne__") return -1;
      return a.localeCompare(b);
    });
    return keys.map((key) => ({
      key,
      anzeige: key === "__ohne__" ? "Ohne geplantes Ankunftsdatum" : formatDatumDE(key),
      liste: buckets.get(key)!,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offene, checkliste]);

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Anreiseliste
        </h1>
        <p className="text-sm text-neutral-500">
          Personen, die über „Anreise vorbereiten" aus der{" "}
          <a href="/personalplanung" className="underline">
            Personalplanung
          </a>{" "}
          aktiviert wurden - gruppiert nach geplantem Ankunftsdatum. Vor dem
          Drucken müssen Vertragsbeginn und -ende erfasst sein. Nach der
          tatsächlichen Anreise hier die weiteren Unterlagen abhaken - erst
          wenn alles erfüllt ist, springt der Status auf „Vollständig" (auch
          im Personalstamm sichtbar).
        </p>
      </div>

      {dokumentFehler && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {dokumentFehler}
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : offene.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Keine offenen Personen in der Anreiseliste.
        </p>
      ) : (
        gruppen.map((g) => (
          <div
            key={g.key}
            className="flex flex-col gap-3 rounded border border-linie bg-white p-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-emerald-800">
                Anreise {g.anzeige} ({g.liste.length})
              </h2>
              {canEdit && (
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => gruppeDokumenteDrucken(g.liste)}
                >
                  Alle Dokumente dieser Anreisegruppe drucken
                </button>
              )}
            </div>

            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Vertragsbeginn</th>
                  <th>Vertragsende</th>
                  {canEdit && <th>Dokumente</th>}
                  <th>Gedruckt</th>
                  <th>SV-Fragebogen</th>
                  <th>Verheiratet</th>
                  <th>Lohnsteuerabzug-Antrag</th>
                  <th>Buskosten Hinfahrt €</th>
                  <th>Checkliste</th>
                  <th>Status</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {g.liste.map((k) => {
                  const c = checkliste[k.id];
                  const f = vertragsfelder[k.id] ?? { beginn: "", ende: "" };
                  const bereit = vertragszeitraumBereit(k);
                  const svJahr = svSaisonJahrFuer(k);
                  return (
                    <Fragment key={k.id}>
                    <tr>
                      <td>
                        {k.name}, {k.vorname} ({k.personal_nr})
                      </td>
                      <td>
                        <input
                          type="date"
                          disabled={!canEdit}
                          value={f.beginn}
                          onChange={(e) =>
                            setVertragsfelder((prev) => ({
                              ...prev,
                              [k.id]: { ...f, beginn: e.target.value },
                            }))
                          }
                          onBlur={() => vertragszeitraumSpeichern(k)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          disabled={!canEdit}
                          value={f.ende}
                          onChange={(e) =>
                            setVertragsfelder((prev) => ({
                              ...prev,
                              [k.id]: { ...f, ende: e.target.value },
                            }))
                          }
                          onBlur={() => vertragszeitraumSpeichern(k)}
                        />
                      </td>
                      {canEdit && (
                        <td className="flex gap-1">
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={!bereit}
                            title={
                              bereit
                                ? "Arbeitsvertrag herunterladen"
                                : "Erst Vertragsbeginn/-ende eintragen"
                            }
                            onClick={() => dokument("arbeitsvertrag", k)}
                          >
                            AV
                          </button>
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={!bereit}
                            title={
                              bereit
                                ? "Werkmiet- und Bewirtungsvertrag herunterladen"
                                : "Erst Vertragsbeginn/-ende eintragen"
                            }
                            onClick={() => dokument("werkmietvertrag", k)}
                          >
                            Miete
                          </button>
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={!bereit}
                            title={
                              bereit
                                ? "Bankverbindungs-Erfassungsbogen herunterladen"
                                : "Erst Vertragsbeginn/-ende eintragen"
                            }
                            onClick={() => dokument("bankverbindung", k)}
                          >
                            Bank
                          </button>
                        </td>
                      )}
                      <td>
                        {k.gedruckt ? (
                          <span
                            className="text-emerald-700"
                            title={
                              k.gedruckt_am
                                ? `Gedruckt am ${formatDatumDE(k.gedruckt_am)}`
                                : undefined
                            }
                          >
                            ✓
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {c ? (
                          c.sv_fragebogen_bestanden ? (
                            <span className="font-medium text-emerald-700">
                              ✓ Bestanden
                            </span>
                          ) : c.sv_fragebogen_unvollstaendig_fehlerhaft ? (
                            <span className="font-medium text-red-600">
                              ⚠ Unvollständig/Fehlerhaft
                            </span>
                          ) : c.sv_fragebogen_erfasst ? (
                            <span className="font-medium text-red-600">
                              ⚠ Nicht bestanden
                            </span>
                          ) : (
                            <span className="text-neutral-400">
                              Nicht erfasst
                            </span>
                          )
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                        {canEdit && k.aktivierter_employee_id && svJahr && (
                          <div>
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() =>
                                setSvEditingId(
                                  svEditingId === k.id ? null : k.id
                                )
                              }
                            >
                              {c?.sv_fragebogen_erfasst ? "Bearbeiten" : "Erfassen"}
                            </button>
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={k.verheiratet_laut_fragebogen ?? false}
                          onChange={(e) =>
                            checklistFeldSpeichern(
                              k,
                              "verheiratet_laut_fragebogen",
                              e.target.checked
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={k.lohnsteuerabzug_antrag_gewuenscht}
                          onChange={(e) =>
                            checklistFeldSpeichern(
                              k,
                              "lohnsteuerabzug_antrag_gewuenscht",
                              e.target.checked
                            )
                          }
                        />
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            className="w-20"
                            disabled={!canEdit || !k.aktivierter_employee_id}
                            value={busfelder[k.id] ?? ""}
                            onChange={(e) =>
                              setBusfelder((prev) => ({
                                ...prev,
                                [k.id]: e.target.value,
                              }))
                            }
                          />
                          {canEdit && (
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() => buskostenSpeichern(k)}
                            >
                              ✓
                            </button>
                          )}
                          {k.buskosten_erfasst && (
                            <span className="text-emerald-700" title="Erfasst">
                              ✓
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-xs">
                        {c ? (
                          <span
                            title={[
                              `Ausweiskopie: ${c.ausweiskopie_vorhanden ? "vorhanden" : "fehlt"}`,
                              `Führerscheinkopie: ${c.fuehrerschein_erfuellt ? "OK/entfällt" : "fehlt"}`,
                              `Hochzeitsurkunde: ${c.hochzeitsurkunde_erfuellt ? "OK/entfällt" : "fehlt"}`,
                              `Formular Doppelte Haushaltsführung: ${c.lohnsteuerabzug_erfuellt ? "OK/entfällt" : "fehlt"}`,
                            ].join(" · ")}
                          >
                            {[
                              c.ausweiskopie_vorhanden ? "Ausweis ✓" : "Ausweis ✗",
                              c.fuehrerschein_erfuellt ? "" : "Führerschein ✗",
                              c.hochzeitsurkunde_erfuellt ? "" : "Heiratsurk. ✗",
                              c.lohnsteuerabzug_erfuellt ? "" : "DHH-Formular ✗",
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        ) : (
                          "—"
                        )}
                        <div>
                          <a href="/personal-dokumente" className="underline">
                            Dokumente hochladen →
                          </a>
                        </div>
                      </td>
                      <td>
                        {vollstaendig(k) ? (
                          <span className="font-medium text-emerald-700">
                            Vollständig
                          </span>
                        ) : (
                          <span className="font-medium text-amber-700">
                            Offen
                          </span>
                        )}
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            type="button"
                            className="btn-danger text-xs"
                            onClick={() => zurueckziehen(k)}
                            title="Person reist doch nicht an - deaktiviert den Mitarbeiter wieder und entfernt sie aus der Anreiseliste"
                          >
                            Zurückziehen
                          </button>
                        </td>
                      )}
                    </tr>
                    {svEditingId === k.id &&
                      k.aktivierter_employee_id &&
                      svJahr && (
                        <tr>
                          <td colSpan={14}>
                            <SvFragebogenFormular
                              employeeId={k.aktivierter_employee_id}
                              saisonJahr={svJahr}
                              canEdit={canEdit}
                              titel={`SV-Fragebogen ${svJahr} - ${k.name}, ${k.vorname}`}
                              onGespeichert={() => {
                                setSvEditingId(null);
                                load();
                              }}
                              onAbbrechen={() => setSvEditingId(null)}
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
        ))
      )}

      {vollstaendigeListe.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn-secondary w-fit text-xs"
            onClick={() => setShowVollstaendig((v) => !v)}
          >
            {showVollstaendig
              ? "Vollständige ausblenden"
              : `Vollständige anzeigen (${vollstaendigeListe.length})`}
          </button>
          {showVollstaendig && (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Geplante Ankunft</th>
                  <th>Vertragszeitraum</th>
                  <th>Status</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {vollstaendigeListe.map((k) => (
                  <tr key={k.id}>
                    <td>
                      {k.name}, {k.vorname} ({k.personal_nr})
                    </td>
                    <td>{formatDatumDE(k.geplante_ankunft)}</td>
                    <td>
                      {formatDatumDE(k.arbeitsbeginn_datum)} –{" "}
                      {formatDatumDE(k.arbeitsende_datum)}
                    </td>
                    <td className="font-medium text-emerald-700">
                      Vollständig
                    </td>
                    {canEdit && (
                      <td>
                        <button
                          type="button"
                          className="btn-danger text-xs"
                          onClick={() => zurueckziehen(k)}
                          title="Person reist doch nicht an - deaktiviert den Mitarbeiter wieder und entfernt sie aus der Anreiseliste"
                        >
                          Zurückziehen
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
