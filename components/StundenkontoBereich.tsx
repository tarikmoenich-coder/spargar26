"use client";

// Stundenkonto-Werkzeugleiste (Nutzer-Vorgabe 2026-08-20, erweitert
// 2026-08-21): laufendes Konto je Mitarbeiter/Saison-Jahr - Buchen
// (Gutschrift/Korrektur/Freizeitausgleich). Seit 2026-11-16 ("Stundenkonto
// ist immer Lohn"): der Saldo zählt sofort zum Bruttolohn, jede Buchung
// braucht ein bewusst gesetztes Datum (Monatszuordnung), der frühere
// Handknopf "In Auszahlung umwandeln" samt Storno ist entfallen - der
// Rest-Saldo wird beim Abrechnen automatisch umgewandelt (siehe
// saison_abrechnen_batch). Eigene, wiederverwendete
// Komponente, damit die Stundenerfassung UND das Controlling-
// Stundenmonitoring exakt dieselbe, geprüfte Logik nutzen - ein künftiger
// Fix (wie der if/elsif-Bug vom 2026-08-20) muss dann nur an EINER Stelle
// gemacht werden. Lädt Saldo/Historie selbst (unabhängig vom aufrufenden
// Kontext), meldet einen geänderten Saldo optional an den Aufrufer zurück
// (z.B. für eine kompakte Saldo-Spalte in der jeweiligen Übersicht).
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE, formatMenge } from "@/lib/format";
import { kannStundenkontoBuchen } from "@/lib/stundenkontoRechte";
import type { EmployeeStundenkontoSaldo, StundenkontoBewegung } from "@/lib/types";

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
  // einzelnen bearbeiteten Tag kennt) es weglassen können. Seit 2026-11-16
  // bleibt das Feld dort LEER statt "heute" - das Datum ist Pflicht und
  // soll bewusst gewählt werden, nicht versehentlich auf heute stehen.
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

  const [saldo, setSaldo] = useState(0);
  const [historie, setHistorie] = useState<StundenkontoBewegung[]>([]);
  const [ladeHistorie, setLadeHistorie] = useState(true);
  const [datum, setDatum] = useState(bearbeitetesDatum ?? "");
  const [stunden, setStunden] = useState("");
  const [art, setArt] = useState<
    "Gutschrift" | "Korrektur" | "Freizeitausgleich"
  >("Gutschrift");
  const [notiz, setNotiz] = useState("");
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
    setDatum(bearbeitetesDatum ?? "");
    setStunden("");
    setArt("Gutschrift");
    setNotiz("");
    neuLaden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, saisonJahr, bearbeitetesDatum]);

  async function buchen() {
    const wert = Number(stunden);
    if (!stunden || Number.isNaN(wert) || wert === 0) {
      setFehler("Bitte eine Stundenzahl ungleich 0 angeben.");
      return;
    }
    if (!datum) {
      setFehler(
        "Bitte ein Datum angeben - jede Buchung muss einem Tag zugeordnet sein."
      );
      return;
    }
    if (Number(datum.slice(0, 4)) !== saisonJahr) {
      setFehler(`Das Datum muss im Saisonjahr ${saisonJahr} liegen.`);
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
    setErfolg(
      `${wert > 0 ? "+" : ""}${formatMenge(wert, 2)} Std. (${art}) zum ${formatDatumDE(datum)} gebucht.`
    );
    setStunden("");
    setNotiz("");
    await neuLaden();
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <p className="text-sm font-semibold">
        Stundenkonto {personLabel} - Saison {saisonJahr}: aktueller Saldo{" "}
        {formatMenge(saldo, 2)} Std.
      </p>
      <p className="text-xs text-neutral-500">
        Buchungen für das Jahr {saisonJahr}. Der Saldo zählt sofort zum
        Bruttolohn (Stunden × Stundenlohn, Spalte „Zulage" in der
        Lohnübersicht). Jede Buchung braucht ein Datum - es bestimmt, zu
        welchem Monat die Stunden gehören. Was beim Abrechnen noch auf dem
        Konto steht, wird automatisch in Zulage umgewandelt.
      </p>

      {fehler && (
        <p className="text-sm font-medium text-beere-600">⚠ {fehler}</p>
      )}
      {erfolg && (
        <p className="text-sm font-medium text-emerald-700">✓ {erfolg}</p>
      )}

      {canBuchen && (
        <div className="flex flex-wrap items-end gap-2 rounded border border-linie bg-white p-2">
          <label className="flex flex-col text-xs">
            Datum (Pflicht)
            <input
              type="date"
              className="w-36"
              required
              min={`${saisonJahr}-01-01`}
              max={`${saisonJahr}-12-31`}
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
              </tr>
            </thead>
            <tbody>
              {historie.map((b) => (
                <tr key={b.id} className={b.storniert ? "opacity-50" : ""}>
                  <td>
                    {formatDatumDE(b.datum)}
                    {!b.datum_bestaetigt &&
                      b.art !== "Auszahlung" &&
                      !b.ist_storno && (
                        <span
                          className="ml-1 text-amber-600"
                          title="Buchung von vor der Pflichtdatum-Umstellung - das Datum wird beim Abrechnen abgefragt (bestätigen oder nachtragen)"
                        >
                          ⚠ unbestätigt
                        </span>
                      )}
                  </td>
                  <td className={b.stunden < 0 ? "text-beere-600" : ""}>
                    {b.stunden > 0 ? "+" : ""}
                    {formatMenge(Number(b.stunden), 2)}
                  </td>
                  <td>
                    {b.art}
                    {b.storniert && " (storniert)"}
                  </td>
                  <td>{b.notiz ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
