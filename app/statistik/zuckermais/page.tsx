"use client";

// Statistik Zuckermais (Nutzer-Vorgabe 2026-08-09) - Tagesstatistik über
// alle Mitarbeiter, aus der Sicht zuckermais_statistik_tag. Kosten/Kolben
// rechnet mit dem für das Saisonjahr gepflegten Mindestlohn
// (Einstellungen), nicht mit einem festen Wert und bewusst nicht mit dem
// individuellen Stundenlohn je Person - berechnet in der Datenbank-Sicht.
//
// "Kulturkosten" (Nutzer-Vorgabe 2026-08-12, mit Abstand + eigener
// Überschrift dargestellt): rechnet statt mit den Prämien-Stunden mit den
// Stunden aus der ALLGEMEINEN Stundenerfassung aller Arbeitsgruppen, die
// unter Einstellungen der Kultur "Zuckermais" zugeordnet sind - damit
// zählen z.B. auch Sortierer/Träger mit, die nicht einzeln in der
// Prämien-Erfassung stehen. Die Tagesprämien fließen mit ein (sonst fehlen
// sie bei Betrachtung der reinen Gruppenkosten, Nutzer-Hinweis).
//
// Die Saison-Summen-Zeile rechnet mit dem Mindestlohn-Wert der Sicht
// selbst (zeilen[0]?.mindestlohn), NICHT mehr mit einem fest verdrahteten
// Wert - das Frontend darf verpflegungssaetze selbst nicht direkt lesen
// (admin-only per RLS).

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import StatistikTabs from "@/components/StatistikTabs";
import { formatDatumDE } from "@/lib/format";
import type { Employee, ZuckermaisPraemieTag, ZuckermaisStatistikTag } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

function fmt(n: number | null | undefined, nachkomma = 2) {
  return n === null || n === undefined ? "—" : n.toFixed(nachkomma);
}

// Personenauswertung (Nutzer-Vorgabe 2026-08-23: "wen schicke ich zuerst
// nach Hause" - siehe Konzept "Wer kostet am meisten?"). Wer mit weniger
// als dieser Stundenzahl im gewählten Zeitraum erfasst ist, bekommt eine
// zu verrauschte Auslastung (z.B. 2 Std. an einem Regentag) und wird aus
// der Liste ausgeblendet statt eine irreführende Zahl zu zeigen.
const MINDEST_STUNDEN_PERSONENAUSWERTUNG = 5;

interface PersonenZeile {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  herkunft: string;
  stunden: number;
  kolben: number;
  proStunde: number;
  // null, wenn im Zeitraum kein Satz mit Norm hinterlegt war (kann bei
  // zuckermais_saetze theoretisch vorkommen) - dann keine Auslastung
  // berechenbar statt mit 0 zu rechnen.
  auslastung: number | null;
  lohnkosten: number;
  praemie: number;
  negativpraemie: number;
  kostenProKolben: number | null;
}

type PersonenSortKey = keyof Pick<
  PersonenZeile,
  | "name"
  | "herkunft"
  | "stunden"
  | "kolben"
  | "proStunde"
  | "auslastung"
  | "lohnkosten"
  | "praemie"
  | "negativpraemie"
  | "kostenProKolben"
>;

export default function StatistikZuckermaisPage() {
  const { profile } = useProfile();
  // Nutzer-Vorgabe 2026-08-23: individueller Stundenlohn (nicht der
  // Mindestlohn wie beim Rest dieser Seite) fließt hier ein - deshalb enger
  // gefasst als die übrige Statistikseite (dort zusätzlich lohnabrechnung/
  // erntewirtschaft, siehe zuckermais_statistik_tag).
  const kannPersonenauswertungSehen =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "management";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [zeilen, setZeilen] = useState<ZuckermaisStatistikTag[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("zuckermais_statistik_tag")
      .select("*")
      .gte("datum", `${jahr}-01-01`)
      .lte("datum", `${jahr}-12-31`)
      .order("datum", { ascending: false });
    if (!error) setZeilen((data as ZuckermaisStatistikTag[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  // Personenauswertung: eigener, frei wählbarer Zeitraum (Konzept-Vorgabe:
  // "vor allem wenn ich es mir über einen längeren Zeitraum anschauen
  // kann") statt des Saison-Jahr-Filters oben - Standardwert trotzdem an
  // "jahr" angelehnt (1. Januar bis heute bzw. bis Jahresende).
  const [personenVon, setPersonenVon] = useState(`${CURRENT_YEAR}-01-01`);
  const [personenBis, setPersonenBis] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [praemieZeilen, setPraemieZeilen] = useState<ZuckermaisPraemieTag[]>([]);
  const [mitarbeiterMap, setMitarbeiterMap] = useState<
    Record<
      string,
      Pick<Employee, "personal_nr" | "name" | "vorname" | "stundenlohn" | "herkunft">
    >
  >({});
  const [personenLoading, setPersonenLoading] = useState(false);
  const [personenSort, setPersonenSort] = useState<{
    key: PersonenSortKey;
    dir: 1 | -1;
  }>({ key: "auslastung", dir: 1 });

  async function loadPersonenauswertung() {
    if (!kannPersonenauswertungSehen) return;
    setPersonenLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: praemie, error }, { data: mitarbeiter }] = await Promise.all([
      supabase
        .from("zuckermais_praemie_tag")
        .select("*")
        .gte("datum", personenVon)
        .lte("datum", personenBis),
      // Kein aktiv-Filter: eine Person, die inzwischen deaktiviert wurde
      // (z.B. schon nach Hause geschickt), soll für einen zurückliegenden
      // Zeitraum weiterhin korrekt ausgewertet werden können.
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname, stundenlohn, herkunft"),
    ]);
    if (!error) setPraemieZeilen((praemie as ZuckermaisPraemieTag[]) ?? []);
    const map: Record<
      string,
      Pick<Employee, "personal_nr" | "name" | "vorname" | "stundenlohn" | "herkunft">
    > = {};
    ((mitarbeiter as Employee[]) ?? []).forEach((m) => {
      map[m.id] = m;
    });
    setMitarbeiterMap(map);
    setPersonenLoading(false);
  }

  useEffect(() => {
    loadPersonenauswertung();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kannPersonenauswertungSehen, personenVon, personenBis]);

  // Aggregation je Person (Konzept "Wer kostet am meisten?", 2026-08-23):
  // Auslastung/Negativprämie zeilenweise mit dem am jeweiligen Tag
  // gültigen Satz berechnet und dann summiert - nicht aus Tages-
  // Durchschnitten gemittelt, damit Norm-/Satzänderungen im Zeitraum
  // korrekt gewichtet einfließen (gleiches Prinzip wie praemie selbst,
  // das die Sicht zuckermais_praemie_tag schon zeilenweise liefert).
  const personenZeilen = useMemo<PersonenZeile[]>(() => {
    const zwischenstand: Record<
      string,
      {
        stunden: number;
        kolben: number;
        normKolben: number;
        praemie: number;
        negativpraemie: number;
      }
    > = {};
    praemieZeilen.forEach((z) => {
      const norm = Number(z.norm_kolben_pro_stunde ?? 0);
      const satz = Number(z.satz_pro_kolben ?? 0);
      const stunden = Number(z.stunden);
      const kolben = Number(z.kolben);
      const normKolbenZeile = stunden * norm;
      const eintrag = zwischenstand[z.employee_id] ?? {
        stunden: 0,
        kolben: 0,
        normKolben: 0,
        praemie: 0,
        negativpraemie: 0,
      };
      eintrag.stunden += stunden;
      eintrag.kolben += kolben;
      eintrag.normKolben += normKolbenZeile;
      eintrag.praemie += Number(z.praemie);
      eintrag.negativpraemie += Math.max((normKolbenZeile - kolben) * satz, 0);
      zwischenstand[z.employee_id] = eintrag;
    });

    return Object.entries(zwischenstand)
      .filter(([, v]) => v.stunden >= MINDEST_STUNDEN_PERSONENAUSWERTUNG)
      .map(([employeeId, v]) => {
        const mitarbeiter = mitarbeiterMap[employeeId];
        const stundenlohn = Number(mitarbeiter?.stundenlohn ?? 0);
        const lohnkosten = v.stunden * stundenlohn;
        return {
          employee_id: employeeId,
          personal_nr: mitarbeiter?.personal_nr ?? "—",
          name: mitarbeiter?.name ?? "—",
          vorname: mitarbeiter?.vorname ?? "",
          herkunft: mitarbeiter?.herkunft ?? "—",
          stunden: v.stunden,
          kolben: v.kolben,
          proStunde: v.stunden > 0 ? v.kolben / v.stunden : 0,
          auslastung: v.normKolben > 0 ? (v.kolben / v.normKolben) * 100 : null,
          lohnkosten,
          praemie: v.praemie,
          negativpraemie: v.negativpraemie,
          kostenProKolben: v.kolben > 0 ? lohnkosten / v.kolben : null,
        };
      });
  }, [praemieZeilen, mitarbeiterMap]);

  const personenZeilenSortiert = useMemo(() => {
    const kopie = [...personenZeilen];
    kopie.sort((a, b) => {
      const av = a[personenSort.key];
      const bv = b[personenSort.key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv), "de") * personenSort.dir;
      }
      return ((av as number) - (bv as number)) * personenSort.dir;
    });
    return kopie;
  }, [personenZeilen, personenSort]);

  const summeNegativpraemie = personenZeilen.reduce(
    (s, z) => s + z.negativpraemie,
    0
  );

  function personenSpalteKlicken(key: PersonenSortKey) {
    setPersonenSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }
    );
  }

  function auslastungKlasse(a: number | null) {
    if (a === null) return "";
    if (a < 90) return "text-red-600 font-medium";
    if (a < 105) return "text-amber-600";
    return "text-emerald-700";
  }

  const summeKisten = zeilen.reduce((s, z) => s + Number(z.summe_kisten), 0);
  const summeKolben = zeilen.reduce((s, z) => s + Number(z.summe_kolben), 0);
  const summeStunden = zeilen.reduce((s, z) => s + Number(z.summe_stunden), 0);
  const summePraemie = zeilen.reduce((s, z) => s + Number(z.summe_praemie), 0);
  const summeGruppenStunden = zeilen.reduce(
    (s, z) => s + Number(z.gruppen_stunden ?? 0),
    0
  );
  // Mindestlohn kommt aus der Sicht selbst mit (das Frontend darf
  // verpflegungssaetze nicht direkt lesen) - alle Zeilen desselben
  // Saison-Jahrs tragen denselben Wert.
  const mindestlohn = zeilen.find((z) => z.mindestlohn != null)?.mindestlohn ?? null;
  const gesamtKolbenProStunde = summeStunden > 0 ? summeKolben / summeStunden : null;
  const gesamtKostenProKolben =
    summeKolben > 0 && mindestlohn != null
      ? (mindestlohn * summeStunden + summePraemie) / summeKolben
      : null;
  const gesamtKostenProKolbenGruppen =
    summeKolben > 0 && mindestlohn != null
      ? (mindestlohn * summeGruppenStunden + summePraemie) / summeKolben
      : null;

  return (
    <div className="flex flex-col gap-4">
      <StatistikTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Statistik – Zuckermais
        </h1>
        <p className="text-sm text-neutral-500">
          Tagesstatistik über alle Mitarbeiter. Kosten/Kolben ={" "}
          (Mindestlohn × Summe Stunden + Summe Prämien) / Summe Kolben –
          gerechnet mit dem Mindestlohn, der für dieses Saison-Jahr unter
          Einstellungen hinterlegt ist. Kulturkosten (Kosten/Kolben, Gruppen)
          = (Mindestlohn × Gruppen-Stunden + Summe Prämien) / Summe Kolben –
          Gruppen-Stunden sind die Stunden aus der allgemeinen
          Stundenerfassung aller Arbeitsgruppen, die unter Einstellungen der
          Kultur "Zuckermais" zugeordnet sind (auch Personen, die nicht
          einzeln in der Prämien-Erfassung stehen).
        </p>
      </div>

      <label className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 block bg-neutral-50 py-2 text-sm">
        Saison-Jahr{" "}
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
          className="w-24"
        />
      </label>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : zeilen.length === 0 ? (
        <p className="text-neutral-500">Keine Einträge für {jahr}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>Datum</th>
                <th rowSpan={2}>Summe Kisten</th>
                <th rowSpan={2}>Summe Kolben</th>
                <th rowSpan={2}>Summe Stunden</th>
                <th rowSpan={2}>Summe Prämien €</th>
                <th rowSpan={2}>Durchschnitt Kolben/Std.</th>
                <th rowSpan={2}>Kosten/Kolben €</th>
                <th colSpan={2} className="border-l-2 border-neutral-300 pl-4">
                  Kulturkosten
                </th>
              </tr>
              <tr>
                <th className="border-l-2 border-neutral-300 pl-4">
                  Gruppen-Stunden
                </th>
                <th>Kosten/Kolben €</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.datum}>
                  <td>{formatDatumDE(z.datum)}</td>
                  <td>{fmt(z.summe_kisten)}</td>
                  <td>{fmt(z.summe_kolben)}</td>
                  <td>{fmt(z.summe_stunden)}</td>
                  <td>{fmt(z.summe_praemie)}</td>
                  <td>{fmt(z.kolben_pro_stunde)}</td>
                  <td className="font-medium">{fmt(z.kosten_pro_kolben, 4)}</td>
                  <td className="border-l-2 border-neutral-300 pl-4">
                    {fmt(z.gruppen_stunden)}
                  </td>
                  <td className="font-medium">
                    {fmt(z.kosten_pro_kolben_gruppen, 4)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Saison {jahr}</td>
                <td>{fmt(summeKisten)}</td>
                <td>{fmt(summeKolben)}</td>
                <td>{fmt(summeStunden)}</td>
                <td>{fmt(summePraemie)}</td>
                <td>{fmt(gesamtKolbenProStunde)}</td>
                <td>{fmt(gesamtKostenProKolben, 4)}</td>
                <td className="border-l-2 border-neutral-300 pl-4">
                  {fmt(summeGruppenStunden)}
                </td>
                <td>{fmt(gesamtKostenProKolbenGruppen, 4)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {kannPersonenauswertungSehen && (
        <div className="mt-4 flex flex-col gap-3 border-t border-neutral-200 pt-6">
          <div>
            <h2 className="text-base font-semibold text-emerald-800">
              Personenauswertung
            </h2>
            <p className="text-sm text-neutral-500">
              Auslastung = Ausbeute/Std. ÷ die im Zeitraum jeweils gültige
              Norm × 100 % – über Normänderungen hinweg korrekt gewichtet.
              Negativprämie ist das Spiegelbild der Prämie (derselbe Satz,
              nur unterhalb der Norm statt darüber) und zeigt in Euro, was
              durch Unterschreitung fehlt. Lohnkosten/Kosten je Kolben
              rechnen – anders als oben – mit dem individuellen Stundenlohn,
              deshalb nur für admin/hr/management sichtbar. Personen mit
              weniger als {MINDEST_STUNDEN_PERSONENAUSWERTUNG} Std. im
              Zeitraum werden ausgeblendet (zu verrauschte Auslastung).
              Spaltenköpfe sind klickbar.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label>
              Von{" "}
              <input
                type="date"
                value={personenVon}
                onChange={(e) => setPersonenVon(e.target.value)}
              />
            </label>
            <label>
              Bis{" "}
              <input
                type="date"
                value={personenBis}
                onChange={(e) => setPersonenBis(e.target.value)}
              />
            </label>
          </div>

          {personenLoading ? (
            <p className="text-neutral-500">Lädt…</p>
          ) : personenZeilen.length === 0 ? (
            <p className="text-neutral-500">
              Keine Personen mit ausreichend Stunden in diesem Zeitraum.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    {(
                      [
                        ["name", "Name"],
                        ["herkunft", "Herkunft"],
                        ["stunden", "Std."],
                        ["kolben", "Kolben"],
                        ["proStunde", "Kolben/Std."],
                        ["auslastung", "Auslastung %"],
                        ["lohnkosten", "Lohnkosten €"],
                        ["praemie", "Prämie €"],
                        ["negativpraemie", "Negativprämie €"],
                        ["kostenProKolben", "Kosten/Kolben €"],
                      ] as [PersonenSortKey, string][]
                    ).map(([key, label]) => (
                      <th
                        key={key}
                        className="cursor-pointer select-none"
                        onClick={() => personenSpalteKlicken(key)}
                        title="Klicken zum Sortieren"
                      >
                        {label}{" "}
                        {personenSort.key === key
                          ? personenSort.dir === 1
                            ? "▲"
                            : "▼"
                          : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {personenZeilenSortiert.map((z) => (
                    <tr key={z.employee_id}>
                      <td>
                        {z.name}, {z.vorname}
                      </td>
                      <td>{z.herkunft}</td>
                      <td>{fmt(z.stunden)}</td>
                      <td>{fmt(z.kolben)}</td>
                      <td>{fmt(z.proStunde)}</td>
                      <td className={auslastungKlasse(z.auslastung)}>
                        {z.auslastung === null ? "—" : `${fmt(z.auslastung)} %`}
                      </td>
                      <td>{fmt(z.lohnkosten)}</td>
                      <td>{fmt(z.praemie)}</td>
                      <td className={z.negativpraemie > 0 ? "text-red-600" : ""}>
                        {fmt(z.negativpraemie)}
                      </td>
                      <td className="font-medium">{fmt(z.kostenProKolben, 4)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan={8} className="text-right">
                      Summe Negativprämie im Zeitraum
                    </td>
                    <td className="text-red-600">{fmt(summeNegativpraemie)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
