"use client";

// Stundenkonto-Werkzeugleiste (Nutzer-Vorgabe 2026-08-20, erweitert
// 2026-08-21): laufendes Konto je Mitarbeiter/Saison-Jahr - Buchen
// (Gutschrift/Korrektur/Freizeitausgleich, keine Lohnwirkung) und "In
// Auszahlung umwandeln" (echter Lohnbestandteil). Eigene, wiederverwendete
// Komponente, damit die Stundenerfassung UND das Controlling-
// Stundenmonitoring exakt dieselbe, geprüfte Logik nutzen - ein künftiger
// Fix (wie der if/elsif-Bug vom 2026-08-20) muss dann nur an EINER Stelle
// gemacht werden. Lädt Saldo/Historie selbst (unabhängig vom aufrufenden
// Kontext), meldet einen geänderten Saldo optional an den Aufrufer zurück
// (z.B. für eine kompakte Saldo-Spalte in der jeweiligen Übersicht).
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import {
  kannStundenkontoAuszahlen,
  kannStundenkontoBuchen,
} from "@/lib/stundenkontoRechte";
import type { EmployeeStundenkontoSaldo, StundenkontoBewegung } from "@/lib/types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

interface StundenkontoBereichProps {
  employeeId: string;
  saisonJahr: number;
  // "Name, Vorname" - für die Überschrift/Meldungen.
  personLabel: string;
  onSaldoChange?: (saldo: number) => void;
  // Nutzer-Vorgabe 2026-08-23: Standard-Datum im "Buchen"-Feld soll den
  // Tag übernehmen, der im aufrufenden Kontext (Stundenerfassung) gerade
  // bearbeitet wird, statt immer auf heute zu stehen - optional, damit
  // andere Aufrufer (z.B. das Controlling-Stundenmonitoring, das keinen
  // einzelnen bearbeiteten Tag kennt) unverändert bei "heute" bleiben.
  bearbeitetesDatum?: string;
}

export default function StundenkontoBereich({
  employeeId,
  saisonJahr,
  personLabel,
  onSaldoChange,
  bearbeitetesDatum,
}: StundenkontoBereichProps) {
  const { profile } = useProfile();
  const canBuchen = kannStundenkontoBuchen(profile?.role);
  const canAuszahlen = kannStundenkontoAuszahlen(profile?.role);

  const [saldo, setSaldo] = useState(0);
  const [historie, setHistorie] = useState<StundenkontoBewegung[]>([]);
  const [ladeHistorie, setLadeHistorie] = useState(true);
  const [datum, setDatum] = useState(bearbeitetesDatum ?? todayIso());
  const [stunden, setStunden] = useState("");
  const [art, setArt] = useState<
    "Gutschrift" | "Korrektur" | "Freizeitausgleich"
  >("Gutschrift");
  const [notiz, setNotiz] = useState("");
  const [auszahlungStunden, setAuszahlungStunden] = useState("");
  const [auszahlungNotiz, setAuszahlungNotiz] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);

  async function neuLaden() {
    setLadeHistorie(true);
    const supabase = getSupabaseClient();
    const [{ data: saldoRow }, { data: hist }] = await Promise.all([
      supabase
        .from("employee_stundenkonto_saldo")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("saison_jahr", saisonJahr)
        .maybeSingle(),
      supabase
        .from("stundenkonto_bewegungen")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("saison_jahr", saisonJahr)
        .order("erstellt_am", { ascending: false })
        .limit(20),
    ]);
    const neuerSaldo = saldoRow
      ? Number((saldoRow as EmployeeStundenkontoSaldo).saldo)
      : 0;
    setSaldo(neuerSaldo);
    setHistorie((hist as StundenkontoBewegung[]) ?? []);
    setLadeHistorie(false);
    onSaldoChange?.(neuerSaldo);
  }

  useEffect(() => {
    setFehler(null);
    setErfolg(null);
    setDatum(bearbeitetesDatum ?? todayIso());
    setStunden("");
    setArt("Gutschrift");
    setNotiz("");
    setAuszahlungStunden("");
    setAuszahlungNotiz("");
    neuLaden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, saisonJahr, bearbeitetesDatum]);

  async function buchen() {
    const wert = Number(stunden);
    if (!stunden || Number.isNaN(wert) || wert === 0) {
      setFehler("Bitte eine Stundenzahl ungleich 0 angeben.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    setErfolg(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("stundenkonto_buchen", {
      p_employee_id: employeeId,
      p_saison_jahr: saisonJahr,
      p_datum: datum,
      p_stunden: wert,
      p_art: art,
      p_notiz: notiz || null,
    });
    setLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setErfolg(`${wert > 0 ? "+" : ""}${wert} Std. (${art}) gebucht.`);
    setStunden("");
    setNotiz("");
    await neuLaden();
  }

  async function auszahlen() {
    const wert = Number(auszahlungStunden);
    if (!auszahlungStunden || Number.isNaN(wert) || wert <= 0) {
      setFehler("Bitte eine Stundenzahl größer als 0 angeben.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    setErfolg(null);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc(
      "stundenkonto_in_auszahlung_umwandeln",
      {
        p_employee_id: employeeId,
        p_saison_jahr: saisonJahr,
        p_stunden: wert,
        p_notiz: auszahlungNotiz || null,
      }
    );
    setLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setErfolg(
      `${wert} Std. in ${Number(data ?? 0).toFixed(
        2
      )} € umgewandelt - erscheint auf der Lohnübersicht.`
    );
    setAuszahlungStunden("");
    setAuszahlungNotiz("");
    await neuLaden();
  }

  // Nutzer-Vorgabe 2026-08-28: "Ich habe ein Stundenkonto fälschlicherweise
  // in Auszahlung umgewandelt... ich bekomme sie nicht mehr raus" - bisher
  // gab es keinen Weg, das rückgängig zu machen.
  async function stornieren(b: StundenkontoBewegung) {
    const grund = window.prompt(
      "Grund für die Stornierung dieser Umwandlung (Pflichtfeld, wird protokolliert):"
    );
    if (!grund) return;
    setLaeuft(true);
    setFehler(null);
    setErfolg(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("stundenkonto_auszahlung_stornieren", {
      p_bewegung_id: b.id,
      p_grund: grund,
    });
    setLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setErfolg(
      `Umwandlung storniert - ${Math.abs(b.stunden).toFixed(2)} Std. sind wieder auf dem Stundenkonto.`
    );
    await neuLaden();
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <p className="text-sm font-semibold">
        Stundenkonto {personLabel} - Saison {saisonJahr}: aktueller Saldo{" "}
        {saldo.toFixed(2)} Std.
      </p>
      <p className="text-xs text-neutral-500">
        Unabhängig vom oben gewählten Tag - hier werden nur Buchungen für
        das Jahr {saisonJahr} angezeigt. Wirkt sich erst auf den Lohn aus,
        wenn Stunden "in Auszahlung" umgewandelt werden (dann wie eine
        Prämie, live bis zum Abrechnen).
      </p>

      {fehler && (
        <p className="text-sm font-medium text-red-600">⚠ {fehler}</p>
      )}
      {erfolg && (
        <p className="text-sm font-medium text-emerald-700">✓ {erfolg}</p>
      )}

      {canBuchen && (
        <div className="flex flex-wrap items-end gap-2 rounded border border-linie bg-white p-2">
          <label className="flex flex-col text-xs">
            Datum
            <input
              type="date"
              className="w-36"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
            />
          </label>
          <label className="flex flex-col text-xs">
            Art
            <select
              value={art}
              onChange={(e) => setArt(e.target.value as typeof art)}
            >
              <option value="Gutschrift">Gutschrift (+)</option>
              <option value="Freizeitausgleich">Freizeitausgleich (−)</option>
              <option value="Korrektur">Korrektur (± ohne Saldo-Prüfung)</option>
            </select>
          </label>
          <label className="flex flex-col text-xs">
            Stunden
            <input
              type="number"
              step="0.25"
              className="w-24"
              placeholder="z.B. 3 oder -8"
              value={stunden}
              onChange={(e) => setStunden(e.target.value)}
            />
          </label>
          <label className="flex flex-col text-xs">
            Notiz
            <input
              type="text"
              className="w-48"
              placeholder="optional"
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={laeuft}
            onClick={buchen}
          >
            Buchen
          </button>
        </div>
      )}

      {canAuszahlen && (
        <div className="flex flex-wrap items-end gap-2 rounded border border-emerald-200 bg-white p-2">
          <label className="flex flex-col text-xs">
            Stunden in Auszahlung umwandeln
            <input
              type="number"
              step="0.25"
              min={0}
              className="w-24"
              value={auszahlungStunden}
              onChange={(e) => setAuszahlungStunden(e.target.value)}
            />
          </label>
          <label className="flex flex-col text-xs">
            Notiz
            <input
              type="text"
              className="w-48"
              placeholder="optional"
              value={auszahlungNotiz}
              onChange={(e) => setAuszahlungNotiz(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn text-xs"
            disabled={laeuft}
            onClick={auszahlen}
          >
            In Auszahlung umwandeln
          </button>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-neutral-600">
          Letzte Buchungen
        </p>
        {ladeHistorie ? (
          <p className="text-xs text-neutral-500">Lädt…</p>
        ) : historie.length === 0 ? (
          <p className="text-xs text-neutral-500">
            Noch keine Buchungen für {saisonJahr}.
          </p>
        ) : (
          <table className="text-xs">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Stunden</th>
                <th>Art</th>
                <th>Notiz</th>
                {canAuszahlen && <th></th>}
              </tr>
            </thead>
            <tbody>
              {historie.map((b) => (
                <tr key={b.id} className={b.storniert ? "opacity-50" : ""}>
                  <td>{formatDatumDE(b.datum)}</td>
                  <td className={b.stunden < 0 ? "text-red-600" : ""}>
                    {b.stunden > 0 ? "+" : ""}
                    {Number(b.stunden).toFixed(2)}
                  </td>
                  <td>
                    {b.art}
                    {b.storniert && " (storniert)"}
                  </td>
                  <td>{b.notiz ?? "—"}</td>
                  {canAuszahlen && (
                    <td>
                      {b.art === "Auszahlung" && !b.storniert && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => stornieren(b)}
                        >
                          Stornieren
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
