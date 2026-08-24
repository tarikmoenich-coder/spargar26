"use client";

// Kassenbuch → Kassenprüfung (Nutzer-Vorgabe 2026-08-24: Aufteilung des
// Kassenbuchs in Untermenüpunkte, damit das neue Journal nicht überladen
// wird). Enthält die Prüfung selbst (Soll/Ist-Abgleich, Toleranz,
// Freigabe/Wiedereröffnung) - Einzahlungen und Korrekturen sind jetzt Teil
// des Journals (app/kasse/page.tsx) und werden hier nicht mehr separat
// aufgelistet.

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

interface CashCheckRow {
  id: number;
  check_zeit: string;
  period_from: string;
  period_to: string;
  opening: number;
  summe_vorschuesse: number;
  einzahlungen: number;
  soll: number;
  ist: number;
  differenz: number;
  innerhalb_toleranz: boolean;
  status: string;
  freigegeben: boolean;
  freigegeben_von: string | null;
  freigegeben_am: string | null;
  wiedereroeffnet_von: string | null;
  wiedereroeffnet_am: string | null;
  wiedereroeffnung_grund: string | null;
}

// Eine Zeile in der Liste "Bewegungen seit letzter Prüfung" - vereinheitlicht
// Vorschüsse, Vorschuss-Korrekturen und Bar-Auszahlungen, damit sie vor
// einer Kassenprüfung gemeinsam durchgesehen werden können. Betrag ist
// vorzeichenbehaftet (negativ = Geld hat die Kasse verlassen).
interface BewegungAnzeige {
  key: string;
  datum: string;
  art: string;
  belegnummer: string;
  betrag: number;
  bearbeiter_id: string | null;
}

export default function KassenpruefungPage() {
  const { profile } = useProfile();
  const [deposits, setDeposits] = useState<CashDeposit[]>([]);
  const [barVorschuesse, setBarVorschuesse] = useState<Advance[]>([]);
  const [auszahlungenBar, setAuszahlungenBar] = useState<
    AuszahlungsbelegSummary[]
  >([]);
  const [bewegungen, setBewegungen] = useState<Kassenbewegung[]>([]);
  const [kautionsuebergaben, setKautionsuebergaben] = useState<
    Kautionsuebergabe[]
  >([]);
  const [namenVon, setNamenVon] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<CashCheckRow[]>([]);
  const [toleranz, setToleranz] = useState(50);
  const [loading, setLoading] = useState(true);
  const [saldo, setSaldo] = useState(0);

  const [istBetrag, setIstBetrag] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = profile?.role === "admin" || profile?.role === "kasse";
  const canFreigeben =
    profile?.role === "admin" || profile?.role === "pruefer";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [
      { data: dep },
      { data: adv },
      { data: az },
      { data: bew },
      { data: kaution },
      { data: chk },
      { data: settings },
      { data: namen },
    ] = await Promise.all([
      supabase
        .from("cash_deposits")
        .select("*")
        .order("datum", { ascending: false })
        .limit(100),
      supabase
        .from("advances")
        .select("*")
        .eq("zahlungsart", "BAR")
        .order("datum", { ascending: false })
        .limit(200),
      supabase
        .from("auszahlungsbeleg_summary")
        .select("*")
        .eq("zahlungsart", "BAR")
        .order("erstellt_am", { ascending: false })
        .limit(200),
      supabase
        .from("kassenbewegungen")
        .select("*")
        .order("zeitstempel", { ascending: false })
        .limit(100),
      supabase
        .from("kautionsuebergaben")
        .select("*")
        .eq("storniert", false)
        .order("erstellt_am", { ascending: false })
        .limit(200),
      supabase
        .from("cash_checks")
        .select("*")
        .order("check_zeit", { ascending: false })
        .limit(20),
      supabase
        .from("kassenpruefung_einstellungen")
        .select("toleranz_euro")
        .single(),
      supabase.from("profile_namen").select("*"),
    ]);
    setDeposits((dep as CashDeposit[]) ?? []);
    setBarVorschuesse((adv as Advance[]) ?? []);
    setAuszahlungenBar((az as AuszahlungsbelegSummary[]) ?? []);
    setBewegungen((bew as Kassenbewegung[]) ?? []);
    setKautionsuebergaben((kaution as Kautionsuebergabe[]) ?? []);
    setChecks((chk as CashCheckRow[]) ?? []);
    if (settings) setToleranz(Number(settings.toleranz_euro));
    const namenMap: Record<string, string> = {};
    ((namen as ProfilName[]) ?? []).forEach((p) => {
      namenMap[p.id] = p.full_name;
    });
    setNamenVon(namenMap);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Nur für die informativen "summe_vorschuesse"/"einzahlungen"-Spalten der
  // Kassenprüfung-Historie - der eigentliche Soll-Betrag (saldo) kommt aus
  // KassenSaldoKarte (kassenbestand_bis(), ohne Zeilenlimit).
  const einzahlungenSumme = deposits
    .filter((d) => !d.storniert)
    .reduce((sum, d) => sum + Number(d.betrag), 0);
  const vorschuesseSumme = barVorschuesse
    .filter((a) => !a.storniert)
    .reduce((sum, a) => sum + Number(a.betrag), 0);

  // Bewegungen seit der letzten Kassenprüfung, für die Durchsicht vor einer
  // neuen Prüfung - vereinheitlicht Vorschüsse, Vorschuss-Korrekturen (nur
  // Bar) und Bar-Auszahlungen, neueste zuerst.
  const letzterCheckZeit = checks[0]?.check_zeit ?? null;
  const bewegungenSeitPruefung: BewegungAnzeige[] = [
    ...barVorschuesse
      .filter(
        (a) => !a.storniert && (!letzterCheckZeit || a.datum > letzterCheckZeit)
      )
      .map((a) => ({
        key: `vorschuss-${a.id}`,
        datum: a.datum,
        art: "Vorschuss",
        belegnummer: a.belegnummer,
        betrag: -Number(a.betrag),
        bearbeiter_id: a.bearbeiter_id,
      })),
    ...bewegungen
      .filter(
        (b) =>
          b.zahlungsart === "BAR" &&
          (!letzterCheckZeit || b.zeitstempel > letzterCheckZeit)
      )
      .map((b) => ({
        key: `korrektur-${b.id}`,
        datum: b.zeitstempel,
        art: b.art,
        belegnummer: b.belegnummer,
        betrag: -Number(b.delta),
        bearbeiter_id: b.bearbeiter_id,
      })),
    ...auszahlungenBar
      .filter(
        (ab) => !letzterCheckZeit || ab.erstellt_am > letzterCheckZeit
      )
      .map((ab) => ({
        key: `auszahlung-${ab.id}`,
        datum: ab.erstellt_am,
        art: "Auszahlung",
        belegnummer: ab.belegnummer,
        betrag: -Number(ab.summe_auszahlungsbetrag ?? 0),
        bearbeiter_id: ab.erstellt_von,
      })),
    ...kautionsuebergaben
      .filter(
        (k) => !letzterCheckZeit || k.erstellt_am > letzterCheckZeit
      )
      .map((k) => ({
        key: `kaution-${k.id}`,
        datum: k.erstellt_am,
        art: "Kautionsübergabe",
        belegnummer: k.belegnummer,
        betrag: -Number(k.betrag_summe),
        bearbeiter_id: k.erstellt_von,
      })),
  ].sort((a, b) => (a.datum < b.datum ? 1 : -1));

  async function runCheck(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    const supabase = getSupabaseClient();
    const letzterCheck = checks[0];
    const periodFrom = letzterCheck?.check_zeit ?? "1970-01-01T00:00:00Z";
    const opening = letzterCheck?.ist ?? 0;
    const ist = Number(istBetrag);
    const differenz = ist - saldo;
    const innerhalbToleranz = Math.abs(differenz) <= toleranz;

    const { error: insertError } = await supabase.from("cash_checks").insert({
      period_from: periodFrom,
      period_to: new Date().toISOString(),
      opening,
      summe_vorschuesse: vorschuesseSumme,
      einzahlungen: einzahlungenSumme,
      soll: saldo,
      ist,
      differenz,
      innerhalb_toleranz: innerhalbToleranz,
      status: innerhalbToleranz ? "Bestanden" : "Kassendifferenz",
    });
    if (insertError) setError(insertError.message);
    setIstBetrag("");
    setChecking(false);
    load();
  }

  // Sperrt alle Belege (Vorschüsse, Einzahlungen, Korrekturen) im geprüften
  // Zeitraum gegen nachträgliche Änderung (siehe ist_kassenpruefung_gesperrt
  // in schema.sql) - analog zur Monatsabschluss-Sperre.
  async function freigeben(c: CashCheckRow) {
    if (!profile) return;
    const supabase = getSupabaseClient();
    const { error: freigabeError } = await supabase
      .from("cash_checks")
      .update({
        freigegeben: true,
        freigegeben_von: profile.id,
        freigegeben_am: new Date().toISOString(),
        status: "Freigegeben",
      })
      .eq("id", c.id);
    if (freigabeError) setError(freigabeError.message);
    load();
  }

  async function wiedereroeffnen(c: CashCheckRow) {
    const grund = window.prompt(
      "Grund für die Wiedereröffnung dieser Kassenprüfung (Pflichtfeld, wird protokolliert):"
    );
    if (!grund) return;
    if (!profile) return;
    const supabase = getSupabaseClient();
    const { error: reopenError } = await supabase
      .from("cash_checks")
      .update({
        freigegeben: false,
        status: c.innerhalb_toleranz ? "Bestanden" : "Kassendifferenz",
        wiedereroeffnet_von: profile.id,
        wiedereroeffnet_am: new Date().toISOString(),
        wiedereroeffnung_grund: grund,
      })
      .eq("id", c.id);
    if (reopenError) setError(reopenError.message);
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <KassenbuchTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Kassenbuch – Kassenprüfung
        </h1>
        <p className="text-sm text-neutral-500">
          Soll/Ist-Abgleich, Freigabe und Wiedereröffnung. Toleranz aktuell:{" "}
          {toleranz.toFixed(2)} € (konfigurierbar, siehe README).
        </p>
      </div>

      <KassenSaldoKarte onSaldoChange={setSaldo} />

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div>
          {canWrite && (
            <form onSubmit={runCheck} className="mb-3 flex items-center gap-3">
              <input
                type="number"
                step="0.01"
                placeholder="Gezählter Ist-Betrag €"
                required
                value={istBetrag}
                onChange={(e) => setIstBetrag(e.target.value)}
              />
              <button type="submit" className="btn" disabled={checking}>
                Prüfung durchführen
              </button>
              {error && <span className="text-sm text-red-600">{error}</span>}
            </form>
          )}

          <div className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-neutral-700">
              Bewegungen seit letzter Prüfung
              {checks[0] &&
                ` (seit ${new Date(checks[0].check_zeit).toLocaleString(
                  "de-DE"
                )})`}
            </h3>
            {bewegungenSeitPruefung.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Keine Bewegungen seit der letzten Prüfung.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Art</th>
                    <th>Beleg-Nr.</th>
                    <th>Betrag €</th>
                    <th>Anwender</th>
                  </tr>
                </thead>
                <tbody>
                  {bewegungenSeitPruefung.map((b) => (
                    <tr key={b.key}>
                      <td>{new Date(b.datum).toLocaleString("de-DE")}</td>
                      <td>{b.art}</td>
                      <td>{b.belegnummer}</td>
                      <td className={b.betrag < 0 ? "text-red-600" : ""}>
                        {b.betrag > 0 ? "+" : ""}
                        {b.betrag.toFixed(2)}
                      </td>
                      <td>
                        {b.bearbeiter_id
                          ? namenVon[b.bearbeiter_id] ?? "—"
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="text-right font-semibold">
                      Summe
                    </td>
                    <td className="font-semibold">
                      {bewegungenSeitPruefung
                        .reduce((s, b) => s + b.betrag, 0)
                        .toFixed(2)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          <table>
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Soll €</th>
                <th>Ist €</th>
                <th>Differenz €</th>
                <th>Status</th>
                <th>Freigabe</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.id}>
                  <td>{new Date(c.check_zeit).toLocaleString("de-DE")}</td>
                  <td>{Number(c.soll).toFixed(2)}</td>
                  <td>{Number(c.ist).toFixed(2)}</td>
                  <td>{Number(c.differenz).toFixed(2)}</td>
                  <td>{c.status}</td>
                  <td>
                    {c.freigegeben ? (
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-700">
                          ✓ Freigegeben
                          {c.freigegeben_am &&
                            ` am ${new Date(
                              c.freigegeben_am
                            ).toLocaleDateString("de-DE")}`}
                          {c.freigegeben_von && namenVon[c.freigegeben_von]
                            ? ` von ${namenVon[c.freigegeben_von]}`
                            : ""}
                        </span>
                        {canFreigeben && (
                          <button
                            className="btn-secondary text-xs"
                            onClick={() => wiedereroeffnen(c)}
                          >
                            Wiedereröffnen
                          </button>
                        )}
                      </div>
                    ) : canFreigeben ? (
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => freigeben(c)}
                      >
                        Freigeben
                      </button>
                    ) : (
                      <span className="text-neutral-400">offen</span>
                    )}
                    {!c.freigegeben && c.wiedereroeffnet_am && (
                      <p className="mt-1 text-xs text-neutral-500">
                        Wiedereröffnet am{" "}
                        {new Date(c.wiedereroeffnet_am).toLocaleDateString(
                          "de-DE"
                        )}
                        {c.wiedereroeffnet_von &&
                        namenVon[c.wiedereroeffnet_von]
                          ? ` von ${namenVon[c.wiedereroeffnet_von]}`
                          : ""}
                        {c.wiedereroeffnung_grund &&
                          ` – Grund: ${c.wiedereroeffnung_grund}`}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
