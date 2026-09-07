"use client";

// Kassenbuch → Kassenprüfung. Seit den mehreren Kassenbüchern (Migration
// 2026-10-04, Phase 2) wird jedes Buch einzeln geprüft: oben eine Übersicht
// aller Bücher (aktueller Soll + letzte Prüfung), darunter das Prüf-Panel für
// das gewählte Buch (Soll/Ist-Abgleich, Freigabe, Wiedereröffnung). Für die
// Mömmel Lohnkasse ist die "Bewegungen seit letzter Prüfung"-Liste wie bisher
// (Vorschüsse/Korrekturen/Auszahlungen/Kautionen); für die übrigen Bücher sind
// es die kassenbuch_buchung-Zeilen des Buchs.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type {
  Advance,
  AuszahlungsbelegSummary,
  CashDeposit,
  Kassenbewegung,
  Kassenbuch,
  KassenbuchBuchung,
  Kautionsuebergabe,
  ProfilName,
} from "@/lib/types";
import KassenbuchTabs from "@/components/KassenbuchTabs";
import KassenSaldoKarte from "@/components/KassenSaldoKarte";

interface CashCheckRow {
  id: number;
  kassenbuch_id: number;
  check_zeit: string;
  period_from: string;
  period_to: string;
  opening: number;
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
  const canWrite = profile?.role === "admin" || profile?.role === "kasse";
  const canFreigeben = profile?.role === "admin" || profile?.role === "pruefer";

  const [buecher, setBuecher] = useState<Kassenbuch[]>([]);
  const [salden, setSalden] = useState<Record<number, number>>({});
  const [aktivBuchId, setAktivBuchId] = useState<number | null>(null);

  const [deposits, setDeposits] = useState<CashDeposit[]>([]);
  const [barVorschuesse, setBarVorschuesse] = useState<Advance[]>([]);
  const [auszahlungenBar, setAuszahlungenBar] = useState<AuszahlungsbelegSummary[]>([]);
  const [bewegungen, setBewegungen] = useState<Kassenbewegung[]>([]);
  const [kautionsuebergaben, setKautionsuebergaben] = useState<Kautionsuebergabe[]>([]);
  const [buchungen, setBuchungen] = useState<KassenbuchBuchung[]>([]);
  const [namenVon, setNamenVon] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<CashCheckRow[]>([]);
  const [toleranz, setToleranz] = useState(50);
  const [loading, setLoading] = useState(true);
  const [saldo, setSaldo] = useState(0);

  const [istBetrag, setIstBetrag] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aktivBuch = buecher.find((b) => b.id === aktivBuchId) ?? null;
  const istLohnkasse = aktivBuch?.typ === "lohnkasse";

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();

    const { data: buchDaten } = await supabase
      .from("kassenbuch")
      .select("*")
      .eq("aktiv", true)
      .order("reihenfolge");
    const liste = (buchDaten as Kassenbuch[]) ?? [];
    setBuecher(liste);
    const buchId =
      aktivBuchId && liste.some((b) => b.id === aktivBuchId)
        ? aktivBuchId
        : (liste.find((b) => b.typ === "lohnkasse") ?? liste[0])?.id ?? null;
    setAktivBuchId(buchId);

    const [
      { data: dep },
      { data: adv },
      { data: az },
      { data: bew },
      { data: kaution },
      { data: chk },
      { data: settings },
      { data: namen },
      { data: bch },
      ...saldoErgebnisse
    ] = await Promise.all([
      supabase.from("cash_deposits").select("*").order("datum", { ascending: false }).limit(100),
      supabase.from("advances").select("*").eq("zahlungsart", "BAR").order("datum", { ascending: false }).limit(200),
      supabase.from("auszahlungsbeleg_summary").select("*").eq("zahlungsart", "BAR").order("erstellt_am", { ascending: false }).limit(200),
      supabase.from("kassenbewegungen").select("*").order("zeitstempel", { ascending: false }).limit(100),
      supabase.from("kautionsuebergaben").select("*").eq("storniert", false).order("erstellt_am", { ascending: false }).limit(200),
      supabase.from("cash_checks").select("*").order("check_zeit", { ascending: false }).limit(60),
      supabase.from("kassenpruefung_einstellungen").select("toleranz_euro").single(),
      supabase.from("profile_namen").select("*"),
      buchId
        ? supabase.from("kassenbuch_buchung").select("*").eq("kassenbuch_id", buchId).order("datum", { ascending: false }).limit(200)
        : Promise.resolve({ data: [] as KassenbuchBuchung[] }),
      ...liste.map((b) =>
        supabase
          .rpc("kassenbuch_saldo_bis", { p_kassenbuch_id: b.id })
          .then(({ data }) => [b.id, data == null ? 0 : Number(data)] as const)
      ),
    ]);

    setDeposits((dep as CashDeposit[]) ?? []);
    setBarVorschuesse((adv as Advance[]) ?? []);
    setAuszahlungenBar((az as AuszahlungsbelegSummary[]) ?? []);
    setBewegungen((bew as Kassenbewegung[]) ?? []);
    setKautionsuebergaben((kaution as Kautionsuebergabe[]) ?? []);
    setChecks((chk as CashCheckRow[]) ?? []);
    setBuchungen((bch as KassenbuchBuchung[]) ?? []);
    if (settings) setToleranz(Number(settings.toleranz_euro));
    const map: Record<string, string> = {};
    ((namen as ProfilName[]) ?? []).forEach((p) => (map[p.id] = p.full_name));
    setNamenVon(map);
    setSalden(
      Object.fromEntries(saldoErgebnisse as (readonly [number, number])[])
    );
    setLoading(false);
  }, [aktivBuchId]);

  useEffect(() => {
    laden();
  }, [laden]);

  const checksAktiv = useMemo(
    () => checks.filter((c) => c.kassenbuch_id === aktivBuchId),
    [checks, aktivBuchId]
  );
  const letzterCheckZeit = checksAktiv[0]?.check_zeit ?? null;

  // Bewegungen seit der letzten Prüfung des gewählten Buchs.
  const bewegungenSeitPruefung: BewegungAnzeige[] = useMemo(() => {
    if (!aktivBuch) return [];
    if (istLohnkasse) {
      return [
        ...barVorschuesse
          .filter((a) => !a.storniert && (!letzterCheckZeit || a.datum > letzterCheckZeit))
          .map((a) => ({ key: `v-${a.id}`, datum: a.datum, art: "Vorschuss", belegnummer: a.belegnummer, betrag: -Number(a.betrag), bearbeiter_id: a.bearbeiter_id })),
        ...bewegungen
          .filter((b) => b.zahlungsart === "BAR" && (!letzterCheckZeit || b.zeitstempel > letzterCheckZeit))
          .map((b) => ({ key: `k-${b.id}`, datum: b.zeitstempel, art: b.art, belegnummer: b.belegnummer, betrag: -Number(b.delta), bearbeiter_id: b.bearbeiter_id })),
        ...auszahlungenBar
          .filter((ab) => !letzterCheckZeit || ab.erstellt_am > letzterCheckZeit)
          .map((ab) => ({ key: `a-${ab.id}`, datum: ab.erstellt_am, art: "Auszahlung", belegnummer: ab.belegnummer, betrag: -Number(ab.summe_auszahlungsbetrag ?? 0), bearbeiter_id: ab.erstellt_von })),
        ...kautionsuebergaben
          .filter((k) => !letzterCheckZeit || k.erstellt_am > letzterCheckZeit)
          .map((k) => ({ key: `ka-${k.id}`, datum: k.erstellt_am, art: "Kautionsübergabe", belegnummer: k.belegnummer, betrag: -Number(k.betrag_summe), bearbeiter_id: k.erstellt_von })),
      ].sort((x, y) => (x.datum < y.datum ? 1 : -1));
    }
    return buchungen
      .filter((b) => !b.storniert && (!letzterCheckZeit || b.datum > letzterCheckZeit))
      .map((b) => ({
        key: `b-${b.id}`,
        datum: b.datum,
        art: b.umbuchung_id ? "Umbuchung" : b.richtung === "eingang" ? "Einnahme" : "Ausgabe",
        belegnummer: b.belegnummer,
        betrag: b.richtung === "eingang" ? Number(b.betrag) : -Number(b.betrag),
        bearbeiter_id: b.bearbeiter_id,
      }))
      .sort((x, y) => (x.datum < y.datum ? 1 : -1));
  }, [aktivBuch, istLohnkasse, letzterCheckZeit, barVorschuesse, bewegungen, auszahlungenBar, kautionsuebergaben, buchungen]);

  async function runCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!aktivBuch) return;
    setChecking(true);
    setError(null);
    const letzter = checksAktiv[0];
    const ist = Number(istBetrag.replace(",", "."));
    const differenz = ist - saldo;
    const innerhalbToleranz = Math.abs(differenz) <= toleranz;

    const { error: insertError } = await getSupabaseClient()
      .from("cash_checks")
      .insert({
        kassenbuch_id: aktivBuch.id,
        period_from: letzter?.check_zeit ?? "1970-01-01T00:00:00Z",
        period_to: new Date().toISOString(),
        opening: letzter?.ist ?? aktivBuch.eroeffnungssaldo,
        summe_vorschuesse: 0,
        einzahlungen: 0,
        soll: saldo,
        ist,
        differenz,
        innerhalb_toleranz: innerhalbToleranz,
        status: innerhalbToleranz ? "Bestanden" : "Kassendifferenz",
      });
    if (insertError) setError(insertError.message);
    setIstBetrag("");
    setChecking(false);
    laden();
  }

  async function freigeben(c: CashCheckRow) {
    if (!profile) return;
    const { error: e } = await getSupabaseClient()
      .from("cash_checks")
      .update({
        freigegeben: true,
        freigegeben_von: profile.id,
        freigegeben_am: new Date().toISOString(),
        status: "Freigegeben",
      })
      .eq("id", c.id);
    if (e) setError(e.message);
    laden();
  }

  async function wiedereroeffnen(c: CashCheckRow) {
    const grund = window.prompt(
      "Grund für die Wiedereröffnung dieser Kassenprüfung (Pflichtfeld, wird protokolliert):"
    );
    if (!grund || !profile) return;
    const { error: e } = await getSupabaseClient()
      .from("cash_checks")
      .update({
        freigegeben: false,
        status: c.innerhalb_toleranz ? "Bestanden" : "Kassendifferenz",
        wiedereroeffnet_von: profile.id,
        wiedereroeffnet_am: new Date().toISOString(),
        wiedereroeffnung_grund: grund,
      })
      .eq("id", c.id);
    if (e) setError(e.message);
    laden();
  }

  return (
    <div className="flex flex-col gap-6">
      <KassenbuchTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Kassenbuch – Kassenprüfung
        </h1>
        <p className="text-sm text-neutral-500">
          Jedes Kassenbuch wird einzeln geprüft. Toleranz aktuell:{" "}
          {toleranz.toFixed(2)} € (konfigurierbar, siehe README). Eine
          freigegebene Prüfung sperrt die Belege dieses Buchs im geprüften
          Zeitraum gegen nachträgliche Änderung.
        </p>
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <>
          {/* Übersicht aller Bücher */}
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Kassenbuch</th>
                  <th>Aktueller Soll €</th>
                  <th>Letzte Prüfung</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {buecher.map((b) => {
                  const letzte = checks.find((c) => c.kassenbuch_id === b.id);
                  return (
                    <tr
                      key={b.id}
                      className={b.id === aktivBuchId ? "bg-emerald-50" : ""}
                    >
                      <td className="font-medium">{b.bezeichnung}</td>
                      <td>{(salden[b.id] ?? 0).toFixed(2)}</td>
                      <td>
                        {letzte
                          ? new Date(letzte.check_zeit).toLocaleDateString("de-DE")
                          : "—"}
                      </td>
                      <td>
                        {letzte ? (
                          <span
                            className={
                              letzte.freigegeben
                                ? "text-emerald-700"
                                : letzte.innerhalb_toleranz
                                  ? ""
                                  : "text-red-600"
                            }
                          >
                            {letzte.freigegeben ? "Freigegeben" : letzte.status}
                          </span>
                        ) : (
                          <span className="text-neutral-400">nie geprüft</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => {
                            setAktivBuchId(b.id);
                            setIstBetrag("");
                            setError(null);
                          }}
                        >
                          {b.id === aktivBuchId ? "gewählt" : "prüfen"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {aktivBuch && (
            <div className="flex flex-col gap-4 border-t border-linie pt-4">
              <h2 className="text-base font-semibold text-emerald-800">
                {aktivBuch.bezeichnung}
              </h2>

              <KassenSaldoKarte
                kassenbuchId={aktivBuch.id}
                onSaldoChange={setSaldo}
                titel={`Soll-Bestand ${aktivBuch.bezeichnung}`}
                hinweis={
                  istLohnkasse
                    ? undefined
                    : "Eröffnungssaldo + Einnahmen − Ausgaben (inklusive Umbuchungen), ohne stornierte Buchungen."
                }
              />

              {canWrite && (
                <form onSubmit={runCheck} className="flex flex-wrap items-center gap-3">
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

              <div>
                <h3 className="mb-1 text-sm font-semibold text-neutral-700">
                  Bewegungen seit letzter Prüfung
                  {letzterCheckZeit &&
                    ` (seit ${new Date(letzterCheckZeit).toLocaleString("de-DE")})`}
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
                            {b.bearbeiter_id ? namenVon[b.bearbeiter_id] ?? "—" : "—"}
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

              <div>
                <h3 className="mb-1 text-sm font-semibold text-neutral-700">
                  Prüfungs-Historie
                </h3>
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
                    {checksAktiv.map((c) => (
                      <tr key={c.id}>
                        <td>{new Date(c.check_zeit).toLocaleString("de-DE")}</td>
                        <td>{Number(c.soll).toFixed(2)}</td>
                        <td>{Number(c.ist).toFixed(2)}</td>
                        <td className={Number(c.differenz) !== 0 ? "text-red-600" : ""}>
                          {Number(c.differenz).toFixed(2)}
                        </td>
                        <td>{c.status}</td>
                        <td>
                          {c.freigegeben ? (
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-700">
                                ✓ Freigegeben
                                {c.freigegeben_am &&
                                  ` am ${new Date(c.freigegeben_am).toLocaleDateString("de-DE")}`}
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
                              {new Date(c.wiedereroeffnet_am).toLocaleDateString("de-DE")}
                              {c.wiedereroeffnet_von && namenVon[c.wiedereroeffnet_von]
                                ? ` von ${namenVon[c.wiedereroeffnet_von]}`
                                : ""}
                              {c.wiedereroeffnung_grund &&
                                ` – Grund: ${c.wiedereroeffnung_grund}`}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                    {checksAktiv.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center text-neutral-500">
                          Noch keine Prüfung für dieses Buch.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
