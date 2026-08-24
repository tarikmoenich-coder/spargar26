"use client";

// Kassenbuch → Journal (Nutzer-Vorgabe 2026-08-24: "Ein Journal mit
// laufendem Saldo. So könnte ich schneller nachvollziehen bei welcher
// Kassenbewegung ich in eine Kassendifferenz gerutscht bin"). Ersetzt die
// früheren, getrennten Tabellen "Einzahlungen" und "Kassenbewegungen
// (Korrekturen)" - beide gehen hier chronologisch zusammen mit den
// Bar-Vorschüssen/-Auszahlungen/Kautionsübergaben auf. Wie ein echtes
// Kassenbuch jahresweise mit Eröffnungssaldo (1. Januar) statt einer
// beliebigen Von-Bis-Spanne, damit der Eröffnungssaldo eindeutig und ohne
// weitere Rückfrage berechenbar ist (kassenbestand_bis() in schema.sql).
//
// Wichtig für die Korrektheit: eine Korrektur (kassenbewegungen, z.B.
// nachträglich geänderter Vorschuss-Betrag) bewegt den laufenden Saldo
// NICHT zusätzlich - der korrigierte Betrag steckt schon im aktuellen
// Vorschuss-/Auszahlungsbetrag selbst (advances.betrag bzw.
// auszahlungsbeleg_summary.summe_auszahlungsbetrag werden von den
// Korrektur-Funktionen direkt aktualisiert). Eine Korrektur erscheint hier
// nur als informative Zeile (eigene Spalte "Korrektur €"), damit sichtbar
// bleibt, WANN und WARUM sich ein Betrag nachträglich geändert hat - ohne
// ihn doppelt zu zählen.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type {
  Advance,
  AuszahlungsbelegSummary,
  CashDeposit,
  Kassenbewegung,
  Kautionsuebergabe,
  ProfilName,
} from "@/lib/types";
import KassenbuchTabs from "@/components/KassenbuchTabs";
import KassenSaldoKarte from "@/components/KassenSaldoKarte";

function monatsSchluessel(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `EZ-${mm}-${d.getFullYear()}`;
}

// Nur die im Journal benötigten Felder aus cash_checks - Nutzer-Vorgabe
// 2026-08-24 ("Kannst du noch kenntlich machen im Journal, wann eine
// Kassenprüfung stattgefunden hat?"): jede Prüfung erscheint als eigene,
// hervorgehobene Trennzeile an ihrem check_zeit, damit sofort sichtbar
// ist, bis wohin die Kasse bereits gezählt/geprüft (und ggf. freigegeben,
// also gegen Korrekturen gesperrt - siehe ist_kassenpruefung_gesperrt in
// schema.sql) wurde.
interface CashCheckZeile {
  id: number;
  check_zeit: string;
  soll: number;
  ist: number;
  differenz: number;
  status: string;
  freigegeben: boolean;
}

const CURRENT_YEAR = new Date().getFullYear();
// Einfache, feste Auswahl statt einer eigenen Abfrage nach den tatsächlich
// vorhandenen Jahren - die App läuft seit 2026, eine Handvoll Jahre
// rückwirkend reicht für die Auswahl.
const JAHRE_OPTIONEN = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

// Eine Zeile im Journal - entweder eine "echte" Bewegung (bewegt den
// laufenden Saldo) oder eine Korrektur (rein informativ, siehe oben).
interface JournalZeile {
  key: string;
  datum: string;
  art: string;
  belegnummer: string;
  // Vorzeichenbehafteter Betrag der Bewegung selbst - null bei einer
  // Korrektur-Zeile (die zeigt stattdessen "korrekturDelta").
  betrag: number | null;
  korrekturDelta: number | null;
  storniert: boolean;
  hinweis: string | null;
  bearbeiter_id: string | null;
  // Saldo NACH dieser Zeile - null bei einer Korrektur-Zeile (siehe oben).
  laufenderSaldo: number | null;
  // Nur bei einer Kassenprüfungs-Trennzeile gesetzt (siehe CashCheckZeile
  // oben) - eigene, breite Darstellung statt der normalen Spalten.
  pruefung: CashCheckZeile | null;
}

export default function KassenbuchJournalPage() {
  const { profile } = useProfile();
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [eroeffnungssaldo, setEroeffnungssaldo] = useState<number | null>(null);
  const [deposits, setDeposits] = useState<CashDeposit[]>([]);
  const [barVorschuesse, setBarVorschuesse] = useState<Advance[]>([]);
  const [auszahlungenBar, setAuszahlungenBar] = useState<
    AuszahlungsbelegSummary[]
  >([]);
  const [kautionsuebergaben, setKautionsuebergaben] = useState<
    Kautionsuebergabe[]
  >([]);
  const [korrekturen, setKorrekturen] = useState<Kassenbewegung[]>([]);
  const [pruefungen, setPruefungen] = useState<CashCheckZeile[]>([]);
  const [namenVon, setNamenVon] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [betrag, setBetrag] = useState("");
  const [zweck, setZweck] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = profile?.role === "admin" || profile?.role === "kasse";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const jahresAnfang = `${jahr}-01-01T00:00:00Z`;
    const jahresEnde = `${jahr + 1}-01-01T00:00:00Z`;
    const [
      { data: eroeffnung },
      { data: dep },
      { data: adv },
      { data: az },
      { data: kaution },
      { data: bew },
      { data: chk },
      { data: namen },
    ] = await Promise.all([
      supabase.rpc("kassenbestand_bis", { p_bis: jahresAnfang }),
      supabase
        .from("cash_deposits")
        .select("*")
        .gte("datum", jahresAnfang)
        .lt("datum", jahresEnde)
        .order("datum", { ascending: true }),
      supabase
        .from("advances")
        .select("*")
        .eq("zahlungsart", "BAR")
        .gte("datum", jahresAnfang)
        .lt("datum", jahresEnde)
        .order("datum", { ascending: true }),
      supabase
        .from("auszahlungsbeleg_summary")
        .select("*")
        .eq("zahlungsart", "BAR")
        .gte("erstellt_am", jahresAnfang)
        .lt("erstellt_am", jahresEnde)
        .order("erstellt_am", { ascending: true }),
      supabase
        .from("kautionsuebergaben")
        .select("*")
        .eq("storniert", false)
        .gte("erstellt_am", jahresAnfang)
        .lt("erstellt_am", jahresEnde)
        .order("erstellt_am", { ascending: true }),
      supabase
        .from("kassenbewegungen")
        .select("*")
        .eq("zahlungsart", "BAR")
        .gte("zeitstempel", jahresAnfang)
        .lt("zeitstempel", jahresEnde)
        .order("zeitstempel", { ascending: true }),
      supabase
        .from("cash_checks")
        .select("id, check_zeit, soll, ist, differenz, status, freigegeben")
        .gte("check_zeit", jahresAnfang)
        .lt("check_zeit", jahresEnde)
        .order("check_zeit", { ascending: true }),
      supabase.from("profile_namen").select("*"),
    ]);
    setEroeffnungssaldo(
      eroeffnung === null || eroeffnung === undefined ? 0 : Number(eroeffnung)
    );
    setDeposits((dep as CashDeposit[]) ?? []);
    setBarVorschuesse((adv as Advance[]) ?? []);
    setAuszahlungenBar((az as AuszahlungsbelegSummary[]) ?? []);
    setKautionsuebergaben((kaution as Kautionsuebergabe[]) ?? []);
    setKorrekturen((bew as Kassenbewegung[]) ?? []);
    setPruefungen((chk as CashCheckZeile[]) ?? []);
    const namenMap: Record<string, string> = {};
    ((namen as ProfilName[]) ?? []).forEach((p) => {
      namenMap[p.id] = p.full_name;
    });
    setNamenVon(namenMap);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  async function addDeposit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    const { data: belegnummer, error: belegError } = await supabase.rpc(
      "naechste_belegnummer",
      { prefix_monat: monatsSchluessel(new Date()) }
    );
    if (belegError) {
      setError(belegError.message);
      setSaving(false);
      return;
    }
    const { error: insertError } = await supabase.from("cash_deposits").insert({
      belegnummer,
      betrag: Number(betrag),
      verwendungszweck: zweck,
    });
    if (insertError) setError(insertError.message);
    setBetrag("");
    setZweck("");
    setSaving(false);
    load();
  }

  // Baut das Journal: "echte" Bewegungen zuerst aufsteigend nach Datum
  // sortiert, laufenden Saldo dabei fortschreiben, danach Korrektur-Zeilen
  // an der richtigen chronologischen Stelle einsortieren (ohne eigenen
  // Saldo-Sprung), zuletzt für die Anzeige umgedreht (neueste zuerst, wie
  // überall sonst in der App).
  const bewegungsZeilen: JournalZeile[] = [
    ...deposits.map((d) => ({
      key: `einzahlung-${d.id}`,
      datum: d.datum,
      art: "Einzahlung",
      belegnummer: d.belegnummer,
      betrag: d.storniert ? 0 : Number(d.betrag),
      korrekturDelta: null,
      storniert: d.storniert,
      hinweis: d.verwendungszweck,
      bearbeiter_id: d.bearbeiter_id,
      laufenderSaldo: null,
      pruefung: null,
    })),
    ...barVorschuesse.map((a) => ({
      key: `vorschuss-${a.id}`,
      datum: a.datum,
      art: a.art === "Strafe/Rechnung" ? "Strafe/Rechnung" : "Vorschuss",
      belegnummer: a.belegnummer,
      betrag: a.storniert ? 0 : -Number(a.betrag),
      korrekturDelta: null,
      storniert: a.storniert,
      hinweis: a.begruendung,
      bearbeiter_id: a.bearbeiter_id,
      laufenderSaldo: null,
      pruefung: null,
    })),
    ...auszahlungenBar.map((ab) => ({
      key: `auszahlung-${ab.id}`,
      datum: ab.erstellt_am,
      art: "Auszahlung",
      belegnummer: ab.belegnummer,
      betrag: -Number(ab.summe_auszahlungsbetrag ?? 0),
      korrekturDelta: null,
      storniert: false,
      hinweis: null,
      bearbeiter_id: ab.erstellt_von,
      laufenderSaldo: null,
      pruefung: null,
    })),
    ...kautionsuebergaben.map((k) => ({
      key: `kaution-${k.id}`,
      datum: k.erstellt_am,
      art: "Kautionsübergabe",
      belegnummer: k.belegnummer,
      betrag: -Number(k.betrag_summe),
      korrekturDelta: null,
      storniert: false,
      hinweis: `an ${k.uebergeben_an}`,
      bearbeiter_id: k.erstellt_von,
      laufenderSaldo: null,
      pruefung: null,
    })),
  ].sort((a, b) => (a.datum < b.datum ? -1 : 1));

  // Korrektur-Zeilen separat, chronologisch dazwischengemischt - eigener
  // Schritt, damit ihr "laufenderSaldo" beim Durchrechnen unten korrekt den
  // Stand DAVOR übernimmt (nicht Teil der Saldo-fortschreibenden Liste).
  const korrekturZeilenRoh: JournalZeile[] = korrekturen.map((b) => ({
    key: `korrektur-${b.id}`,
    datum: b.zeitstempel,
    art: b.art,
    belegnummer: b.belegnummer,
    betrag: null,
    korrekturDelta: Number(b.delta),
    storniert: false,
    hinweis: b.hinweis,
    bearbeiter_id: b.bearbeiter_id,
    laufenderSaldo: null,
    pruefung: null,
  }));

  let laufend = eroeffnungssaldo ?? 0;
  const zeilenMitSaldo: JournalZeile[] = bewegungsZeilen.map((z) => {
    laufend += z.betrag ?? 0;
    return { ...z, laufenderSaldo: laufend };
  });

  // Jede Korrektur-Zeile bekommt den Saldo-Stand der zeitlich zuletzt
  // vorangegangenen echten Bewegung (oder den Eröffnungssaldo, falls noch
  // keine Bewegung davor liegt) - rein zur Einordnung in der Anzeige, der
  // Wert selbst bewegt sich dadurch nicht.
  const korrekturZeilen: JournalZeile[] = korrekturZeilenRoh.map((k) => {
    const vorherige = [...zeilenMitSaldo]
      .filter((z) => z.datum <= k.datum)
      .pop();
    return { ...k, laufenderSaldo: vorherige?.laufenderSaldo ?? eroeffnungssaldo };
  });

  // Kassenprüfungs-Trennzeilen - reine Markierung, bewegen den laufenden
  // Saldo nicht und brauchen deshalb keine "vorherige"-Zuordnung wie die
  // Korrektur-Zeilen: sie zeigen ihren eigenen, zum Prüfzeitpunkt
  // eingefrorenen Soll/Ist-Wert.
  const pruefungZeilen: JournalZeile[] = pruefungen.map((p) => ({
    key: `pruefung-${p.id}`,
    datum: p.check_zeit,
    art: "Kassenprüfung",
    belegnummer: "",
    betrag: null,
    korrekturDelta: null,
    storniert: false,
    hinweis: null,
    bearbeiter_id: null,
    laufenderSaldo: null,
    pruefung: p,
  }));

  const journal = [...zeilenMitSaldo, ...korrekturZeilen, ...pruefungZeilen]
    .sort((a, b) => (a.datum < b.datum ? -1 : 1))
    .reverse();

  const endsaldo = zeilenMitSaldo.length > 0
    ? zeilenMitSaldo[zeilenMitSaldo.length - 1].laufenderSaldo
    : eroeffnungssaldo;

  return (
    <div className="flex flex-col gap-6">
      <KassenbuchTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Kassenbuch – Journal
        </h1>
        <p className="text-sm text-neutral-500">
          Alle Bargeldbewegungen chronologisch mit laufendem Saldo, wie ein
          klassisches Kassenbuch mit Jahres-Eröffnungssaldo. Korrekturen
          (grau, kursiv) bewegen den Saldo nicht zusätzlich - der geänderte
          Betrag steckt bereits in der ursprünglichen Zeile. Kassenprüfungen
          erscheinen als eigene, hervorgehobene Trennzeile mit ihrem
          damaligen Soll/Ist-Stand.
        </p>
      </div>

      <KassenSaldoKarte />

      {canWrite && (
        <form
          onSubmit={addDeposit}
          className="flex flex-wrap gap-3 rounded border border-neutral-200 bg-white p-4"
        >
          <input
            type="number"
            step="0.01"
            placeholder="Betrag €"
            required
            value={betrag}
            onChange={(e) => setBetrag(e.target.value)}
          />
          <input
            placeholder="Verwendungszweck / Quelle"
            value={zweck}
            onChange={(e) => setZweck(e.target.value)}
            className="flex-1"
          />
          <button type="submit" className="btn" disabled={saving}>
            Einzahlung erfassen
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </form>
      )}

      <label className="text-sm">
        Jahr{" "}
        <select
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
        >
          {JAHRE_OPTIONEN.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </label>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Art</th>
                <th>Beleg-Nr.</th>
                <th>Betrag €</th>
                <th>Korrektur €</th>
                <th>Laufender Saldo €</th>
                <th>Anwender</th>
                <th>Hinweis</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-semibold">
                <td colSpan={5} className="text-right">
                  Eröffnungssaldo {jahr} (Stand 1.1.)
                </td>
                <td>{(eroeffnungssaldo ?? 0).toFixed(2)}</td>
                <td colSpan={2}></td>
              </tr>
              {journal.map((z) =>
                z.pruefung ? (
                  <tr key={z.key} className="bg-emerald-50">
                    <td
                      colSpan={8}
                      className="py-2 text-center text-sm font-semibold text-emerald-800"
                    >
                      🔍 Kassenprüfung {new Date(z.datum).toLocaleString(
                        "de-DE"
                      )} — Soll {Number(z.pruefung.soll).toFixed(2)} € / Ist{" "}
                      {Number(z.pruefung.ist).toFixed(2)} € / Differenz{" "}
                      {Number(z.pruefung.differenz).toFixed(2)} € —{" "}
                      {z.pruefung.status}
                      {z.pruefung.freigegeben && " (freigegeben, gesperrt)"}
                    </td>
                  </tr>
                ) : (
                <tr
                  key={z.key}
                  className={
                    z.korrekturDelta !== null
                      ? "italic text-neutral-500"
                      : z.storniert
                        ? "opacity-50"
                        : ""
                  }
                >
                  <td>{new Date(z.datum).toLocaleString("de-DE")}</td>
                  <td>
                    {z.art}
                    {z.storniert && " (storniert)"}
                  </td>
                  <td>{z.belegnummer}</td>
                  <td className={(z.betrag ?? 0) < 0 ? "text-red-600" : ""}>
                    {z.betrag === null
                      ? "—"
                      : `${z.betrag > 0 ? "+" : ""}${z.betrag.toFixed(2)}`}
                  </td>
                  <td
                    className={
                      z.korrekturDelta !== null && z.korrekturDelta < 0
                        ? "text-red-600"
                        : ""
                    }
                  >
                    {z.korrekturDelta === null
                      ? "—"
                      : `${z.korrekturDelta > 0 ? "+" : ""}${z.korrekturDelta.toFixed(2)}`}
                  </td>
                  <td className="font-medium">
                    {z.korrekturDelta !== null
                      ? "—"
                      : z.laufenderSaldo?.toFixed(2)}
                  </td>
                  <td>
                    {z.bearbeiter_id ? namenVon[z.bearbeiter_id] ?? "—" : "—"}
                  </td>
                  <td className="text-neutral-500">{z.hinweis ?? ""}</td>
                </tr>
                )
              )}
              {journal.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-neutral-500">
                    Keine Bewegungen in {jahr}.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={5} className="text-right">
                  Endsaldo {jahr}
                  {jahr === CURRENT_YEAR && " (= aktueller Kassensaldo)"}
                </td>
                <td>{(endsaldo ?? 0).toFixed(2)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
