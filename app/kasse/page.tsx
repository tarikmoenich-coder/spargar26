"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type { Advance, CashDeposit } from "@/lib/types";

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
}

function monatsSchluessel(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `EZ-${mm}-${d.getFullYear()}`;
}

export default function KassePage() {
  const { profile } = useProfile();
  const [deposits, setDeposits] = useState<CashDeposit[]>([]);
  const [barVorschuesse, setBarVorschuesse] = useState<Advance[]>([]);
  const [checks, setChecks] = useState<CashCheckRow[]>([]);
  const [toleranz, setToleranz] = useState(50);
  const [loading, setLoading] = useState(true);

  const [betrag, setBetrag] = useState("");
  const [zweck, setZweck] = useState("");
  const [saving, setSaving] = useState(false);
  const [istBetrag, setIstBetrag] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = profile?.role === "admin" || profile?.role === "kasse";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: dep }, { data: adv }, { data: chk }, { data: settings }] =
      await Promise.all([
        supabase
          .from("cash_deposits")
          .select("*")
          .order("datum", { ascending: false })
          .limit(100),
        // Nur Bar-Vorschüsse mindern den physischen Kassenbestand -
        // Überweisungen (AZ) verlassen die Kasse nicht.
        supabase
          .from("advances")
          .select("*")
          .eq("zahlungsart", "BAR")
          .order("datum", { ascending: false })
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
      ]);
    setDeposits((dep as CashDeposit[]) ?? []);
    setBarVorschuesse((adv as Advance[]) ?? []);
    setChecks((chk as CashCheckRow[]) ?? []);
    if (settings) setToleranz(Number(settings.toleranz_euro));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const einzahlungenSumme = deposits
    .filter((d) => !d.storniert)
    .reduce((sum, d) => sum + Number(d.betrag), 0);
  const vorschuesseSumme = barVorschuesse
    .filter((a) => !a.storniert)
    .reduce((sum, a) => sum + Number(a.betrag), 0);
  const saldo = einzahlungenSumme - vorschuesseSumme;

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Kassenbuch</h1>
        <p className="text-sm text-neutral-500">
          Einzahlungen und Kassenprüfungen. Toleranz aktuell:{" "}
          {toleranz.toFixed(2)} € (konfigurierbar, siehe README).
        </p>
      </div>

      <div className="rounded border border-neutral-200 bg-white p-4">
        <p className="text-sm text-neutral-500">Aktueller Kassensaldo</p>
        <p className="text-2xl font-semibold text-emerald-800">
          {saldo.toFixed(2)} €
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Einzahlungen {einzahlungenSumme.toFixed(2)} € − Bar-Vorschüsse{" "}
          {vorschuesseSumme.toFixed(2)} € (Überweisungen zählen nicht zum
          Kassenbestand)
        </p>
      </div>

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
        </form>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Beleg-Nr.</th>
                <th>Datum</th>
                <th>Betrag €</th>
                <th>Zweck</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id} className={d.storniert ? "opacity-50" : ""}>
                  <td>{d.belegnummer}</td>
                  <td>{new Date(d.datum).toLocaleString("de-DE")}</td>
                  <td>{Number(d.betrag).toFixed(2)}</td>
                  <td>{d.verwendungszweck}</td>
                  <td>{d.storniert ? "storniert" : "aktiv"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <h2 className="mb-2 text-base font-semibold text-emerald-800">
              Kassenprüfung
            </h2>
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
            <table>
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Soll €</th>
                  <th>Ist €</th>
                  <th>Differenz €</th>
                  <th>Status</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
