"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { useProfile } from "@/lib/useProfile";
import { uebersetzung } from "@/lib/i18n";
import type {
  Employee,
  EmployeeAuslagenHistorie,
  EmployeeStundenkontoSaldo,
  ErdbeerenPraemieTag,
  StundenkontoBewegung,
  UnterkunftBelegungPerson,
  VorschussHistorieEintrag,
  WorkEntry,
  ZuckermaisPraemieTag,
} from "@/lib/types";
import { formatDatumDE } from "@/lib/format";

const VORSCHUSS_BUCKET = "vorschuss-belege";

// Eine anzeigefertige Zeile für die Vorschüsse-Tabelle - vereint echte
// Vorschüsse (inkl. Strafe/Rechnung) UND die aus season_bonuses
// abgeleiteten Auslagen (Bus/Kaution/Arbeitskleidung, Nutzer-Vorgabe
// 2026-08-18). Letztere haben kein echtes Datum (season_bonuses.updated_at
// ist nur ein gemeinsamer Zeitstempel je Mitarbeiter+Jahr, siehe
// schema.sql) - daher "Saison {Jahr}" statt eines Datums.
interface VorschussAnzeigeZeile {
  key: string;
  sortDatum: string;
  datumAnzeige: string;
  betrag: number;
  artLabel: string;
  begruendung: string;
  storniert: boolean;
  belegStoragePath: string | null;
  belegDateiname: string | null;
}

// Für die Suche reicht die eingeschränkte Sicht (keine sensiblen Felder) -
// alle Rollen dürfen hier lesen, siehe employees_public/employees-Grant.
type SucheEmployee = Pick<
  Employee,
  "id" | "personal_nr" | "name" | "vorname" | "aktiv"
>;

function jetzigeSaison() {
  return new Date().getFullYear();
}

const WOCHENTAGE = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

// Kürzel für die interaktive Arbeitsstunden-Liste (Nutzer-Vorgabe
// 2026-08-21) - dieselbe Reihenfolge wie WOCHENTAGE (0 = Montag).
const WOCHENTAGE_KUERZEL = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Reine Kalendertag-Arithmetik auf Basis von "YYYY-MM-DD" - bewusst über
// UTC-Millisekunden statt lokaler Zeitzone (gleicher Fallstrick wie beim
// xlsx-Datumsimport, siehe Erinnerung "xlsx-datum-timezone-bug" - eine
// lokale Berechnung könnte je nach Zeitzone/Sommerzeit auf den falschen
// Tag springen).
function addTageIso(iso: string, delta: number): string {
  const [j, m, t] = iso.split("-").map(Number);
  const ms = Date.UTC(j, m - 1, t) + delta * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// 0 = Montag ... 6 = Sonntag (deutsche Wochenordnung - JS selbst zählt
// Sonntag als 0).
function wochentagIndex(iso: string): number {
  const [j, m, t] = iso.split("-").map(Number);
  const jsTag = new Date(Date.UTC(j, m - 1, t)).getUTCDay();
  return (jsTag + 6) % 7;
}

function montagDerWoche(iso: string): string {
  return addTageIso(iso, -wochentagIndex(iso));
}

// Wochentag-Kürzel für ein Datum, z.B. "Do" für einen Donnerstag.
function wochentagKuerzel(iso: string): string {
  return WOCHENTAGE_KUERZEL[wochentagIndex(iso)];
}

// "18.08." statt vollem Datum - die Spaltenüberschrift nennt bereits den
// Wochentag, siehe WOCHENTAGE.
function tagMonat(iso: string): string {
  const [, m, t] = iso.split("-");
  return `${t}.${m}.`;
}

// Nur für den Ausdruck (Nutzer-Vorgabe 2026-08-21): eine Zeile je
// Kalenderwoche, eine Spalte je Wochentag, statt einer Zeile pro Arbeitstag
// - bei einer vollen Saison sonst 100+ Zeilen.
interface Wochentagzelle {
  datum: string;
  entry: WorkEntry | undefined;
}
interface Wochenzeile {
  montag: string;
  tage: Wochentagzelle[];
  summe: number;
}

export default function SuchePage() {
  const { profile } = useProfile();
  const t = uebersetzung(profile?.sprache);
  const [alle, setAlle] = useState<SucheEmployee[]>([]);
  const [suchtext, setSuchtext] = useState("");
  const [ausgewaehlt, setAusgewaehlt] = useState<SucheEmployee | null>(null);
  const [saisonJahr, setSaisonJahr] = useState(jetzigeSaison());
  const [stunden, setStunden] = useState<WorkEntry[]>([]);
  const [vorschuesse, setVorschuesse] = useState<VorschussHistorieEintrag[]>([]);
  const [auslagen, setAuslagen] = useState<EmployeeAuslagenHistorie[]>([]);
  // Stundenkonto (Nutzer-Vorgabe 2026-08-20: "muss für Mitarbeiter
  // transparent sein") - pro Saisonjahr wie das Konto selbst.
  const [stundenkontoSaldo, setStundenkontoSaldo] = useState(0);
  const [stundenkontoBewegungen, setStundenkontoBewegungen] = useState<
    StundenkontoBewegung[]
  >([]);
  const [zuckermais, setZuckermais] = useState<ZuckermaisPraemieTag[]>([]);
  const [erdbeeren, setErdbeeren] = useState<ErdbeerenPraemieTag[]>([]);
  // Unterkunft: alle Belegungszeiträume der Person (Nutzer-Vorgabe
  // 2026-08-30 - auch der hausmeister sucht hier nach). Nicht saison-
  // gefiltert, jede Zeile trägt ihren eigenen Zeitraum.
  const [unterkunft, setUnterkunft] = useState<UnterkunftBelegungPerson[]>([]);
  const [ladenListe, setLadenListe] = useState(true);
  const [ladenDetail, setLadenDetail] = useState(false);

  useEffect(() => {
    async function ladeMitarbeiter() {
      setLadenListe(true);
      const supabase = getSupabaseClient();
      // Seitenweise, sonst schneidet PostgREST bei ~1000 Zeilen ab (seit dem
      // Historie-Import tausende inaktive employees) und die Suche fände
      // Personen dahinter nicht mehr.
      const alle = await ladeAlleSeiten<SucheEmployee>((von, bis) =>
        supabase
          .from("employees")
          .select("id, personal_nr, name, vorname, aktiv")
          .order("name")
          .order("vorname")
          .order("personal_nr")
          .range(von, bis)
      );
      setAlle(alle);
      setLadenListe(false);
    }
    ladeMitarbeiter();
  }, []);

  const treffer = useMemo(() => {
    const q = suchtext.trim().toLowerCase();
    if (!q) return [];
    return alle
      .filter(
        (m) =>
          m.personal_nr.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.vorname.toLowerCase().includes(q) ||
          `${m.name} ${m.vorname}`.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [alle, suchtext]);

  async function waehleAus(m: SucheEmployee) {
    setAusgewaehlt(m);
    setLadenDetail(true);
    const supabase = getSupabaseClient();
    const [
      { data: we },
      { data: vh },
      { data: al },
      { data: sk },
      { data: skb },
      { data: zm },
      { data: eb },
      { data: ub },
    ] = await Promise.all([
      supabase
        .from("work_entries")
        .select("*")
        .eq("employee_id", m.id)
        .gte("datum", `${saisonJahr}-01-01`)
        .lte("datum", `${saisonJahr}-12-31`)
        .order("datum"),
      supabase
        .from("employee_vorschuss_historie")
        .select("*")
        .eq("employee_id", m.id)
        .order("datum"),
      // Bewusst ohne Saisonjahr-Filter (wie Vorschüsse) - zeigt alle
      // Jahre, jede Zeile trägt ihr eigenes saison_jahr.
      supabase
        .from("employee_auslagen_historie")
        .select("*")
        .eq("employee_id", m.id),
      supabase
        .from("employee_stundenkonto_saldo")
        .select("*")
        .eq("employee_id", m.id)
        .eq("saison_jahr", saisonJahr)
        .maybeSingle(),
      supabase
        .from("stundenkonto_bewegungen")
        .select("*")
        .eq("employee_id", m.id)
        .eq("saison_jahr", saisonJahr)
        .order("erstellt_am", { ascending: false }),
      supabase
        .from("zuckermais_praemie_tag")
        .select("*")
        .eq("employee_id", m.id)
        .gte("datum", `${saisonJahr}-01-01`)
        .lte("datum", `${saisonJahr}-12-31`)
        .order("datum"),
      supabase
        .from("erdbeeren_praemie_tag")
        .select("*")
        .eq("employee_id", m.id)
        .gte("datum", `${saisonJahr}-01-01`)
        .lte("datum", `${saisonJahr}-12-31`)
        .order("datum"),
      supabase
        .from("unterkunft_belegung_person")
        .select("*")
        .eq("employee_id", m.id)
        .order("von", { ascending: false }),
    ]);
    setStunden((we as WorkEntry[]) ?? []);
    setVorschuesse((vh as VorschussHistorieEintrag[]) ?? []);
    setAuslagen((al as EmployeeAuslagenHistorie[]) ?? []);
    setStundenkontoSaldo(
      sk ? Number((sk as EmployeeStundenkontoSaldo).saldo) : 0
    );
    setStundenkontoBewegungen((skb as StundenkontoBewegung[]) ?? []);
    setZuckermais((zm as ZuckermaisPraemieTag[]) ?? []);
    setErdbeeren((eb as ErdbeerenPraemieTag[]) ?? []);
    setUnterkunft((ub as UnterkunftBelegungPerson[]) ?? []);
    setLadenDetail(false);
  }

  async function belegAnsehen(pfad: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(VORSCHUSS_BUCKET)
      .createSignedUrl(pfad, 60);
    if (error || !data) {
      window.alert("Beleg konnte nicht geöffnet werden.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  // Bei Saisonjahr-Wechsel Arbeitsstunden neu laden, falls jemand
  // ausgewählt ist.
  useEffect(() => {
    if (ausgewaehlt) waehleAus(ausgewaehlt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisonJahr]);

  const stundenGesamt = stunden.reduce((s, e) => s + Number(e.stunden ?? 0), 0);
  const tageGesamt = stunden.filter(
    (e) => e.stunden !== null || e.markierung !== null
  ).length;
  const vorschussGesamt = vorschuesse
    .filter((v) => !v.storniert)
    .reduce((s, v) => s + Number(v.betrag), 0);

  // Vereint echte Vorschüsse (inkl. Strafe/Rechnung) und die aus
  // season_bonuses abgeleiteten Auslagen (Bus/Kaution/Arbeitskleidung) zu
  // einer gemeinsamen, anzeigefertigen Liste (Nutzer-Vorgabe 2026-08-18).
  // Bewusst NICHT in vorschussGesamt eingerechnet - das bleibt die Summe
  // der echten Vorschüsse, genau wie season_summary.vorschuss_summe.
  const vorschussZeilen = useMemo<VorschussAnzeigeZeile[]>(() => {
    const echte: VorschussAnzeigeZeile[] = vorschuesse.map((v, i) => ({
      key: `v-${v.datum}-${i}`,
      sortDatum: v.datum,
      datumAnzeige: formatDatumDE(v.datum),
      betrag: Number(v.betrag),
      artLabel:
        v.art === "Strafe/Rechnung"
          ? v.art
          : v.zahlungsart === "BAR"
          ? t("gemeinsam.bar")
          : t("gemeinsam.ueberweisung"),
      begruendung: v.begruendung ?? "—",
      storniert: v.storniert,
      belegStoragePath: v.beleg_storage_path,
      belegDateiname: v.beleg_dateiname,
    }));

    const auslagenZeilen: VorschussAnzeigeZeile[] = [];
    auslagen.forEach((a) => {
      const posten: [number, string][] = [
        [Number(a.bus_kosten), "Buskosten"],
        [Number(a.fahrer_kaution), "Fahrerkaution"],
        [Number(a.zimmer_kaution), "Zimmerkaution"],
        [Number(a.kleidung_hose_betrag), "Arbeitskleidung (Hose)"],
        [Number(a.kleidung_jacke_betrag), "Arbeitskleidung (Jacke)"],
        [Number(a.kleidung_stiefel_betrag), "Arbeitskleidung (Stiefel)"],
      ];
      posten.forEach(([betrag, begruendung]) => {
        if (betrag > 0) {
          auslagenZeilen.push({
            key: `a-${a.saison_jahr}-${begruendung}`,
            sortDatum: `${a.saison_jahr}-12-31T23:59:59`,
            datumAnzeige: `Saison ${a.saison_jahr}`,
            betrag,
            artLabel: "Auslage",
            begruendung,
            storniert: false,
            belegStoragePath: null,
            belegDateiname: null,
          });
        }
      });
    });

    return [...echte, ...auslagenZeilen].sort((x, y) =>
      x.sortDatum.localeCompare(y.sortDatum)
    );
  }, [vorschuesse, auslagen, t]);
  const zuckermaisGesamt = zuckermais.reduce(
    (s, z) => s + Number(z.praemie ?? 0),
    0
  );
  const erdbeerenGesamt = erdbeeren.reduce(
    (s, e) => s + Number(e.praemie ?? 0),
    0
  );

  // Nur für den Ausdruck (Nutzer-Vorgabe 2026-08-21: "stark aufgebläht") -
  // die interaktive Ansicht bleibt unverändert vollständig. Tage ganz ohne
  // Eintrag (gleiche Bedingung wie tageGesamt oben) bzw. Prämientage mit
  // 0 € tragen für ein Aushändigungs-Blatt keine Information bei und
  // blähen bei einer vollen Saison nur unnötig die Seitenzahl auf.
  const stundenDruck = stunden.filter(
    (e) => e.stunden !== null || e.markierung !== null
  );
  const zuckermaisDruck = zuckermais.filter((z) => Number(z.praemie ?? 0) > 0);
  const erdbeerenDruck = erdbeeren.filter((e) => Number(e.praemie ?? 0) > 0);

  // Wochenraster für den Ausdruck (Nutzer-Vorgabe 2026-08-21): eine Zeile
  // je Kalenderwoche (Montag-Sonntag) von der ersten bis zur letzten
  // tatsächlichen Buchung - nicht das ganze Kalenderjahr, sonst stünden
  // Wochen vor Saisonbeginn/nach Saisonende leer mit da.
  const stundenWochen = useMemo<Wochenzeile[]>(() => {
    if (stundenDruck.length === 0) return [];
    const byDatum = new Map(stundenDruck.map((e) => [e.datum, e]));
    const daten = stundenDruck.map((e) => e.datum).sort();
    const letzterTag = daten[daten.length - 1];
    const wochen: Wochenzeile[] = [];
    let montag = montagDerWoche(daten[0]);
    while (montag <= letzterTag) {
      const tage: Wochentagzelle[] = Array.from({ length: 7 }, (_, i) => {
        const datum = addTageIso(montag, i);
        return { datum, entry: byDatum.get(datum) };
      });
      const summe = tage.reduce(
        (s, tag) => s + Number(tag.entry?.stunden ?? 0),
        0
      );
      wochen.push({ montag, tage, summe });
      montag = addTageIso(montag, 7);
    }
    return wochen;
  }, [stundenDruck]);

  const jahreOptionen = Array.from(
    { length: 5 },
    (_, i) => jetzigeSaison() - i
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">
          {t("suche.title")}
        </h1>
        <p className="text-sm text-neutral-500">{t("suche.untertitel")}</p>
      </div>

      <div className="rounded border border-linie bg-white p-4 print:hidden">
        <input
          autoFocus
          placeholder={t("suche.platzhalter")}
          value={suchtext}
          onChange={(e) => {
            setSuchtext(e.target.value);
            setAusgewaehlt(null);
          }}
          className="w-full"
        />
        {ladenListe ? (
          <p className="mt-2 text-sm text-neutral-500">
            {t("gemeinsam.laedt")}
          </p>
        ) : (
          suchtext.trim() !== "" &&
          !ausgewaehlt && (
            <ul className="mt-2 flex flex-col divide-y divide-neutral-100 rounded border border-linie">
              {treffer.length === 0 ? (
                <li className="p-2 text-sm text-neutral-500">
                  {t("suche.keinetreffer")}
                </li>
              ) : (
                treffer.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between p-2 text-left text-sm hover:bg-emerald-50"
                      onClick={() => waehleAus(m)}
                    >
                      <span>
                        {m.name}, {m.vorname}{" "}
                        <span className="text-neutral-400">
                          ({m.personal_nr})
                        </span>
                      </span>
                      {!m.aktiv && (
                        <span className="text-xs text-neutral-400">
                          {t("gemeinsam.inaktiv")}
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )
        )}
      </div>

      {ausgewaehlt && (
        <div className="flex flex-col gap-4 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-linie bg-white p-4">
            <div>
              <p className="text-base font-semibold">
                {ausgewaehlt.name}, {ausgewaehlt.vorname}
              </p>
              <p className="text-sm text-neutral-500">
                {t("suche.personalnummer", { nr: ausgewaehlt.personal_nr })}
                {!ausgewaehlt.aktiv && ` · ${t("gemeinsam.inaktiv")}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-neutral-500">
                {t("suche.saisonjahr")}
              </label>
              <select
                value={saisonJahr}
                onChange={(e) => setSaisonJahr(Number(e.target.value))}
              >
                {jahreOptionen.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => window.print()}
              >
                {t("gemeinsam.drucken")}
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => {
                  setAusgewaehlt(null);
                  setSuchtext("");
                }}
              >
                {t("suche.neuesuche")}
              </button>
            </div>
          </div>

          {ladenDetail ? (
            <p className="text-neutral-500">{t("gemeinsam.laedt")}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded border border-linie bg-white p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-emerald-800">
                    {t("suche.arbeitsstunden", { jahr: saisonJahr })}
                  </h2>
                  <span className="text-sm text-neutral-500">
                    {t("suche.stdtage", {
                      std: stundenGesamt.toFixed(2),
                      tage: tageGesamt,
                    })}
                  </span>
                </div>
                {stunden.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    {t("suche.keineeintraege")}
                  </p>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("gemeinsam.datum")}</th>
                          <th>{t("gemeinsam.std")}</th>
                          <th>{t("gemeinsam.markierung")}</th>
                          <th>{t("gemeinsam.notiz")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stunden.map((e) => (
                          <tr key={e.id}>
                            <td>
                              {wochentagKuerzel(e.datum)}, {formatDatumDE(e.datum)}
                            </td>
                            <td>{e.stunden ?? "—"}</td>
                            <td>{e.markierung ?? "—"}</td>
                            <td className="text-neutral-500">{e.notiz}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded border border-linie bg-white p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-emerald-800">
                    {t("suche.vorschuesse")}
                  </h2>
                  <span className="text-sm text-neutral-500">
                    {t("suche.betragaktiv", {
                      betrag: vorschussGesamt.toFixed(2),
                    })}
                  </span>
                </div>
                {vorschussZeilen.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    {t("suche.keinevorschuesse")}
                  </p>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("gemeinsam.datum")}</th>
                          <th>{t("suche.betrageuro")}</th>
                          <th>{t("suche.art")}</th>
                          <th>{t("suche.begruendung")}</th>
                          <th>{t("suche.status")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vorschussZeilen.map((z) => (
                          <tr key={z.key} className={z.storniert ? "opacity-50" : ""}>
                            <td>{z.datumAnzeige}</td>
                            <td>{z.betrag.toFixed(2)}</td>
                            <td>{z.artLabel}</td>
                            <td>
                              {z.begruendung}
                              {z.belegStoragePath && (
                                <button
                                  type="button"
                                  className="ml-2 text-xs text-emerald-700 underline"
                                  onClick={() =>
                                    belegAnsehen(z.belegStoragePath!)
                                  }
                                >
                                  Beleg
                                </button>
                              )}
                            </td>
                            <td>
                              {z.storniert
                                ? t("gemeinsam.storniert")
                                : t("gemeinsam.aktiv")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded border border-linie bg-white p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-emerald-800">
                    Stundenkonto ({saisonJahr})
                  </h2>
                  <span
                    className={
                      stundenkontoSaldo < 0
                        ? "text-sm font-medium text-red-600"
                        : "text-sm font-medium text-neutral-700"
                    }
                  >
                    Saldo: {stundenkontoSaldo.toFixed(2)} Std.
                  </span>
                </div>
                {stundenkontoBewegungen.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    Keine Buchungen für {saisonJahr}.
                  </p>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("gemeinsam.datum")}</th>
                          <th>Stunden</th>
                          <th>Art</th>
                          <th>{t("gemeinsam.notiz")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stundenkontoBewegungen.map((b) => (
                          <tr key={b.id}>
                            <td>{formatDatumDE(b.datum)}</td>
                            <td className={b.stunden < 0 ? "text-red-600" : ""}>
                              {b.stunden > 0 ? "+" : ""}
                              {Number(b.stunden).toFixed(2)}
                            </td>
                            <td>{b.art}</td>
                            <td className="text-neutral-500">
                              {b.notiz ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded border border-linie bg-white p-4">
                <h2 className="mb-2 text-base font-semibold text-emerald-800">
                  Unterkunft
                </h2>
                {unterkunft.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    Keine Belegung erfasst.
                  </p>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>Zeitraum</th>
                          <th>Gebäude</th>
                          <th>Zimmer</th>
                          <th>{t("gemeinsam.notiz")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unterkunft.map((u) => {
                          const heute = new Date().toISOString().slice(0, 10);
                          const laeuft = u.von <= heute && (!u.bis || u.bis >= heute);
                          return (
                            <tr key={u.id}>
                              <td>
                                {formatDatumDE(u.von)} –{" "}
                                {u.bis ? formatDatumDE(u.bis) : "offen"}
                                {laeuft && (
                                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                                    aktuell
                                  </span>
                                )}
                              </td>
                              <td>
                                {u.gebaeude_name}
                                {u.wohneinheit_name ? ` · ${u.wohneinheit_name}` : ""}
                              </td>
                              <td>{u.zimmer_nummer}</td>
                              <td className="text-neutral-500">{u.notiz ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {zuckermais.length > 0 && (
                <div className="rounded border border-linie bg-white p-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-base font-semibold text-emerald-800">
                      {t("suche.zuckermaispraemien", { jahr: saisonJahr })}
                    </h2>
                    <span className="text-sm text-neutral-500">
                      {t("suche.praemiegesamt", {
                        betrag: zuckermaisGesamt.toFixed(2),
                      })}
                    </span>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("gemeinsam.datum")}</th>
                          <th>{t("gemeinsam.kisten")}</th>
                          <th>{t("gemeinsam.std")}</th>
                          <th
                            title="Erwartete Kolbenzahl bei der an diesem Tag gültigen Norm (Stunden × Norm/Std.) - erst darüber gibt es eine Prämie"
                          >
                            {t("gemeinsam.kolbennorm")}
                          </th>
                          <th>{t("gemeinsam.praemieeuro")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zuckermais.map((z) => (
                          <tr key={z.id}>
                            <td>{formatDatumDE(z.datum)}</td>
                            <td>{z.kisten}</td>
                            <td>{z.stunden}</td>
                            <td className="text-neutral-500">
                              {(
                                Number(z.stunden) *
                                Number(z.norm_kolben_pro_stunde ?? 0)
                              ).toFixed(2)}
                            </td>
                            <td className="font-medium">
                              {Number(z.praemie).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {erdbeeren.length > 0 && (
                <div className="rounded border border-linie bg-white p-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-base font-semibold text-emerald-800">
                      {t("suche.erdbeerenpraemien", { jahr: saisonJahr })}
                    </h2>
                    <span className="text-sm text-neutral-500">
                      {t("suche.praemiegesamt", {
                        betrag: erdbeerenGesamt.toFixed(2),
                      })}
                    </span>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("gemeinsam.datum")}</th>
                          <th>{t("gemeinsam.parzelle")}</th>
                          <th>{t("gemeinsam.steigen")}</th>
                          <th>{t("gemeinsam.std")}</th>
                          <th>{t("gemeinsam.sut")}</th>
                          <th>{t("gemeinsam.praemieeuro")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {erdbeeren.map((e) => (
                          <tr key={e.id}>
                            <td>{formatDatumDE(e.datum)}</td>
                            <td>{e.parzelle_name}</td>
                            <td>{e.steigen}</td>
                            <td>{e.stunden}</td>
                            <td className="text-neutral-500">{e.sut}</td>
                            <td className="font-medium">
                              {Number(e.praemie).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Übersicht zum Aushändigen an den Mitarbeiter - nur im Druck sichtbar. */}
      {ausgewaehlt && !ladenDetail && (
        <div className="hidden print:block">
          <h2 className="text-xl font-semibold">
            Arbeitsstunden &amp; Vorschüsse – {ausgewaehlt.name},{" "}
            {ausgewaehlt.vorname}
          </h2>
          <p className="mt-1 text-base">
            Personalnummer: {ausgewaehlt.personal_nr} · Saison-Jahr:{" "}
            {saisonJahr} · Gedruckt am: {formatDatumDE(new Date().toISOString())}
          </p>

          <h3 className="mt-4 text-base font-semibold">
            Arbeitsstunden ({stundenGesamt.toFixed(2)} Std. · {tageGesamt} Tage)
          </h3>
          {stundenWochen.length === 0 ? (
            <p className="mt-1 text-sm">Keine Einträge in diesem Jahr.</p>
          ) : (
            <table className="mt-2 print-form-table print-dense-table print-wochenraster">
              <thead>
                <tr>
                  {WOCHENTAGE.map((w) => (
                    <th key={w}>{w}</th>
                  ))}
                  <th>Summe</th>
                </tr>
              </thead>
              <tbody>
                {stundenWochen.map((woche) => (
                  <tr key={woche.montag}>
                    {woche.tage.map((tag) => (
                      <td key={tag.datum}>
                        {/* Nutzer-Vorgabe 2026-08-28: "Datum links oben in
                            die Ecke ... die Stunden in Fett mittig ins Feld"
                            - vorher stand beides zentriert übereinander, was
                            "etwas unübersichtlich" war. Die Zelle selbst
                            bleibt zentriert (siehe .print-wochenraster in
                            globals.css), nur das Datum bekommt ein eigenes
                            text-left (überschreibt das geerbte center, da
                            es eine eigene Regel auf dem Element selbst ist -
                            kein Spezifitätskonflikt mit der Tabellen-Regel).
                            Als erstes Element im obenausgerichteten Feld
                            landet es dadurch oben links. */}
                        <div className="text-left text-neutral-500">
                          {tagMonat(tag.datum)}
                        </div>
                        <div className="font-bold">
                          {tag.entry?.stunden != null
                            ? Number(tag.entry.stunden).toFixed(2)
                            : tag.entry?.markierung ?? "–"}
                        </div>
                        {tag.entry?.notiz && (
                          <div className="italic text-neutral-500">
                            {tag.entry.notiz}
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="font-semibold">{woche.summe.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 text-base font-semibold">
            Vorschüsse ({vorschussGesamt.toFixed(2)} € aktiv)
          </h3>
          {vorschussZeilen.length === 0 ? (
            <p className="mt-1 text-sm">Keine Vorschüsse erfasst.</p>
          ) : (
            <table className="mt-2 print-form-table print-dense-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Betrag €</th>
                  <th>Art</th>
                  <th>Begründung</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vorschussZeilen.map((z) => (
                  <tr key={z.key}>
                    <td>{z.datumAnzeige}</td>
                    <td>{z.betrag.toFixed(2)}</td>
                    <td>{z.artLabel}</td>
                    <td>
                      {z.begruendung}
                      {z.belegDateiname && ` (Beleg: ${z.belegDateiname})`}
                    </td>
                    <td>{z.storniert ? "storniert" : "aktiv"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 text-base font-semibold">
            Stundenkonto {saisonJahr} (Saldo: {stundenkontoSaldo.toFixed(2)}{" "}
            Std.)
          </h3>
          {stundenkontoBewegungen.length === 0 ? (
            <p className="mt-1 text-sm">Keine Buchungen für {saisonJahr}.</p>
          ) : (
            <table className="mt-2 print-form-table print-dense-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Stunden</th>
                  <th>Art</th>
                  <th>Notiz</th>
                </tr>
              </thead>
              <tbody>
                {stundenkontoBewegungen.map((b) => (
                  <tr key={b.id}>
                    <td>{formatDatumDE(b.datum)}</td>
                    <td>
                      {b.stunden > 0 ? "+" : ""}
                      {Number(b.stunden).toFixed(2)}
                    </td>
                    <td>{b.art}</td>
                    <td>{b.notiz ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {zuckermaisDruck.length > 0 && (
            <>
              <h3 className="mt-6 text-base font-semibold">
                Zuckermais-Prämien ({zuckermaisGesamt.toFixed(2)} € gesamt)
              </h3>
              <table className="mt-2 print-form-table print-dense-table">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Kisten</th>
                    <th>Std.</th>
                    <th>Kolben Norm</th>
                    <th>Prämie €</th>
                  </tr>
                </thead>
                <tbody>
                  {zuckermaisDruck.map((z) => (
                    <tr key={z.id}>
                      <td>{formatDatumDE(z.datum)}</td>
                      <td>{z.kisten}</td>
                      <td>{z.stunden}</td>
                      <td>
                        {(
                          Number(z.stunden) *
                          Number(z.norm_kolben_pro_stunde ?? 0)
                        ).toFixed(2)}
                      </td>
                      <td>{Number(z.praemie).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {erdbeerenDruck.length > 0 && (
            <>
              <h3 className="mt-6 text-base font-semibold">
                Erdbeeren-Prämien ({erdbeerenGesamt.toFixed(2)} € gesamt)
              </h3>
              <table className="mt-2 print-form-table print-dense-table">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Parzelle</th>
                    <th>Steigen</th>
                    <th>Std.</th>
                    <th>Sut</th>
                    <th>Prämie €</th>
                  </tr>
                </thead>
                <tbody>
                  {erdbeerenDruck.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDatumDE(e.datum)}</td>
                      <td>{e.parzelle_name}</td>
                      <td>{e.steigen}</td>
                      <td>{e.stunden}</td>
                      <td>{e.sut}</td>
                      <td>{Number(e.praemie).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
