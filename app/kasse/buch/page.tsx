"use client";

// Journal eines einzelnen "allgemeinen" Kassenbuchs (Migration 2026-10-03,
// Phase 1). Aufruf: /kasse/buch?id=<kassenbuch_id>. Reine Einnahme-/Ausgabe-
// Buchungen plus Umbuchungen von/zu anderen Büchern, jeweils mit laufendem
// Saldo ab dem Jahres-Eröffnungssaldo. Die "Mömmel Lohnkasse" hat ihr eigenes
// Journal unter /kasse - hierher gerät man mit ihr nur über einen alten Link.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { formatMenge } from "@/lib/format";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type {
  Kassenbuch,
  KassenbuchBuchung,
  KassenbuchRichtung,
  ProfilName,
} from "@/lib/types";
import KassenbuchTabs from "@/components/KassenbuchTabs";
import UmbuchungForm from "@/components/UmbuchungForm";

const CURRENT_YEAR = new Date().getFullYear();
const JAHRE = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

function heute() {
  return new Date().toISOString().slice(0, 10);
}

function BuchJournalInner() {
  const params = useSearchParams();
  const buchId = Number(params.get("id"));
  const { profile } = useProfile();
  const canWrite = profile?.role === "admin" || profile?.role === "kasse";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [buch, setBuch] = useState<Kassenbuch | null>(null);
  const [buecher, setBuecher] = useState<Kassenbuch[]>([]);
  const [buchungen, setBuchungen] = useState<KassenbuchBuchung[]>([]);
  const [eroeffnung, setEroeffnung] = useState(0);
  const [namenVon, setNamenVon] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [richtung, setRichtung] = useState<KassenbuchRichtung>("eingang");
  const [betrag, setBetrag] = useState("");
  const [datum, setDatum] = useState(heute());
  const [zweck, setZweck] = useState("");
  const [saving, setSaving] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    if (!buchId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = getSupabaseClient();
    const jahresAnfang = `${jahr}-01-01T00:00:00Z`;
    const jahresEnde = `${jahr + 1}-01-01T00:00:00Z`;
    const [{ data: alle }, { data: bch }, { data: er }, { data: namen }] =
      await Promise.all([
        supabase.from("kassenbuch").select("*").order("reihenfolge"),
        supabase
          .from("kassenbuch_buchung")
          .select("*")
          .eq("kassenbuch_id", buchId)
          .gte("datum", jahresAnfang)
          .lt("datum", jahresEnde)
          .order("datum", { ascending: true }),
        supabase.rpc("kassenbuch_saldo_bis", {
          p_kassenbuch_id: buchId,
          p_bis: jahresAnfang,
        }),
        supabase.from("profile_namen").select("*"),
      ]);
    const liste = (alle as Kassenbuch[]) ?? [];
    setBuecher(liste);
    setBuch(liste.find((b) => b.id === buchId) ?? null);
    setBuchungen((bch as KassenbuchBuchung[]) ?? []);
    setEroeffnung(er == null ? 0 : Number(er));
    const map: Record<string, string> = {};
    ((namen as ProfilName[]) ?? []).forEach((p) => (map[p.id] = p.full_name));
    setNamenVon(map);
    setLoading(false);
  }, [buchId, jahr]);

  useEffect(() => {
    laden();
  }, [laden]);

  async function buchen(e: React.FormEvent) {
    e.preventDefault();
    const betragZahl = Number(betrag.replace(",", "."));
    if (!betragZahl || betragZahl <= 0) {
      setFehler("Betrag muss größer als 0 sein.");
      return;
    }
    setSaving(true);
    setFehler(null);
    const { error } = await getSupabaseClient().rpc("kassenbuch_buchen", {
      p_kassenbuch_id: buchId,
      p_richtung: richtung,
      p_betrag: betragZahl,
      p_datum_kassenbuch: datum,
      p_verwendungszweck: zweck || null,
    });
    setSaving(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setBetrag("");
    setZweck("");
    setDatum(heute());
    laden();
  }

  async function stornieren(b: KassenbuchBuchung) {
    const grund = window.prompt(
      `Buchung ${b.belegnummer} stornieren – Grund:`
    );
    if (grund == null || grund.trim() === "") return;
    const { error } = await getSupabaseClient().rpc(
      "kassenbuch_buchung_stornieren",
      { p_buchung_id: b.id, p_grund: grund.trim() }
    );
    if (error) {
      setFehler(error.message);
      return;
    }
    laden();
  }

  // Laufender Saldo: chronologisch aufsteigend fortschreiben, für die Anzeige
  // umdrehen (neueste zuerst, wie im Lohnkasse-Journal).
  const zeilen = useMemo(() => {
    let saldo = eroeffnung;
    const asc = buchungen.map((b) => {
      const delta = b.storniert
        ? 0
        : b.richtung === "eingang"
          ? Number(b.betrag)
          : -Number(b.betrag);
      saldo += delta;
      return { b, delta, saldo };
    });
    return asc.reverse();
  }, [buchungen, eroeffnung]);

  const endsaldo = eroeffnung + zeilen.reduce((s, z) => s + z.delta, 0);

  if (!buchId) {
    return (
      <div className="flex flex-col gap-6">
        <KassenbuchTabs />
        <p className="text-neutral-500">
          Kein Kassenbuch gewählt. Zur{" "}
          <Link href="/kasse/uebersicht" className="text-emerald-700 underline">
            Übersicht
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <KassenbuchTabs aktivBuchId={buchId} />

      {loading && !buch ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : !buch ? (
        <p className="text-neutral-500">Kassenbuch nicht gefunden.</p>
      ) : buch.typ === "lohnkasse" ? (
        <p className="text-neutral-500">
          Die {buch.bezeichnung} hat ihr eigenes Journal –{" "}
          <Link href="/kasse" className="text-emerald-700 underline">
            hier öffnen
          </Link>
          .
        </p>
      ) : (
        <>
          <div>
            <h1 className="text-lg font-semibold text-emerald-800">
              {buch.bezeichnung} – Journal
            </h1>
            <p className="text-sm text-neutral-500">
              Einnahmen und Ausgaben chronologisch mit laufendem Saldo ab dem
              Jahres-Eröffnungssaldo. Umbuchungen von/zu anderen Kassenbüchern
              erscheinen als eigene Zeile.
            </p>
          </div>

          {fehler && <p className="text-sm text-red-600">⚠ {fehler}</p>}

          {canWrite && (
            <form
              onSubmit={buchen}
              className="flex flex-wrap items-end gap-3 rounded border border-linie bg-white p-4"
            >
              <label className="text-sm">
                Art
                <select
                  className="mt-1 block"
                  value={richtung}
                  onChange={(e) =>
                    setRichtung(e.target.value as KassenbuchRichtung)
                  }
                >
                  <option value="eingang">Einnahme</option>
                  <option value="ausgang">Ausgabe</option>
                </select>
              </label>
              <label className="text-sm">
                Betrag €
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className="mt-1 block w-28"
                  value={betrag}
                  onChange={(e) => setBetrag(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Datum
                <input
                  type="date"
                  className="mt-1 block"
                  value={datum}
                  onChange={(e) => setDatum(e.target.value)}
                />
              </label>
              <label className="flex-1 text-sm">
                Verwendungszweck
                <input
                  className="mt-1 block w-full"
                  value={zweck}
                  onChange={(e) => setZweck(e.target.value)}
                />
              </label>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? "Bucht…" : "Buchen"}
              </button>
            </form>
          )}

          {canWrite && buecher.length > 1 && (
            <UmbuchungForm
              buecher={buecher}
              quelleFest={buchId}
              onDone={laden}
            />
          )}

          <label className="text-sm">
            Jahr{" "}
            <select
              value={jahr}
              onChange={(e) => setJahr(Number(e.target.value))}
            >
              {JAHRE.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>

          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Beleg-Nr.</th>
                  <th>Verwendungszweck</th>
                  <th>Eingang €</th>
                  <th>Ausgang €</th>
                  <th>Laufender Saldo €</th>
                  <th>Anwender</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                <tr className="font-semibold">
                  <td colSpan={5} className="text-right">
                    Eröffnungssaldo {jahr} (Stand 1.1.)
                  </td>
                  <td>{formatMenge(eroeffnung, 2)}</td>
                  <td colSpan={canWrite ? 2 : 1}></td>
                </tr>
                {zeilen.map(({ b, saldo }) => (
                  <tr key={b.id} className={b.storniert ? "opacity-50" : ""}>
                    <td>
                      {new Date(b.datum).toLocaleDateString("de-DE")}
                    </td>
                    <td>{b.belegnummer}</td>
                    <td className="text-neutral-600">
                      {b.umbuchung_id ? "↔ " : ""}
                      {b.verwendungszweck ?? ""}
                      {b.storniert && " (storniert)"}
                    </td>
                    <td className="text-emerald-700">
                      {!b.storniert && b.richtung === "eingang"
                        ? formatMenge(Number(b.betrag), 2)
                        : ""}
                    </td>
                    <td className="text-red-600">
                      {!b.storniert && b.richtung === "ausgang"
                        ? formatMenge(Number(b.betrag), 2)
                        : ""}
                    </td>
                    <td className="font-medium">{formatMenge(saldo, 2)}</td>
                    <td className="text-neutral-500">
                      {b.bearbeiter_id ? namenVon[b.bearbeiter_id] ?? "—" : "—"}
                    </td>
                    {canWrite && (
                      <td>
                        {!b.storniert && (
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => stornieren(b)}
                          >
                            Storno
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {zeilen.length === 0 && (
                  <tr>
                    <td
                      colSpan={canWrite ? 8 : 7}
                      className="text-center text-neutral-500"
                    >
                      Keine Buchungen in {jahr}.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={5} className="text-right">
                    Endsaldo {jahr}
                    {jahr === CURRENT_YEAR && " (= aktueller Saldo)"}
                  </td>
                  <td>{formatMenge(endsaldo, 2)}</td>
                  <td colSpan={canWrite ? 2 : 1}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function BuchJournalPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-neutral-500">Lädt…</p>}>
      <BuchJournalInner />
    </Suspense>
  );
}
