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
import { uebersetzung } from "@/lib/i18n";
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
  const t = uebersetzung(profile?.sprache);
  const artLabel = (a: string) =>
    a === "Gutschrift" ? t("konto.gutschrift") : a === "Freizeitausgleich" ? t("konto.freizeitausgleich") : a === "Korrektur" ? t("konto.korrektur") : a === "Auszahlung" ? t("konto.auszahlung") : a;
  const canBuchen = kannStundenkontoBuchen(profile);

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
      setFehler(t("konto.fehlerstunden"));
      return;
    }
    if (!datum) {
      setFehler(t("konto.fehlerdatum"));
      return;
    }
    if (Number(datum.slice(0, 4)) !== saisonJahr) {
      setFehler(t("konto.fehlerjahr", { jahr: saisonJahr }));
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
      t("konto.gebucht", { wert: `${wert > 0 ? "+" : ""}${formatMenge(wert, 2)}`, art: artLabel(art), datum: formatDatumDE(datum) })
    );
    setStunden("");
    setNotiz("");
    await neuLaden();
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <p className="text-sm font-semibold">
        {t("konto.kopf", { person: personLabel, jahr: saisonJahr, saldo: formatMenge(saldo, 2) })}
      </p>
      <p className="text-xs text-neutral-500">
        {t("konto.erklaerung", { jahr: saisonJahr })}
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
            {t("konto.datumpflicht")}
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
            {t("suche.art")}
            <select
              value={art}
              onChange={(e) => setArt(e.target.value as typeof art)}
            >
              <option value="Gutschrift">{t("konto.gutschrift")} (+)</option>
              <option value="Freizeitausgleich">{t("konto.freizeitausgleich")} (−)</option>
              <option value="Korrektur">{t("konto.korrekturoption")}</option>
            </select>
          </label>
          <label className="flex flex-col text-xs">
            {t("erfassung.stunden")}
            <input
              type="number"
              step="0.25"
              className="w-24"
              placeholder={t("konto.stundenplatzhalter")}
              value={stunden}
              onChange={(e) => setStunden(e.target.value)}
            />
          </label>
          <label className="flex flex-col text-xs">
            {t("gemeinsam.notiz")}
            <input
              type="text"
              className="w-48"
              placeholder={t("konto.optional")}
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
            {t("konto.buchen")}
          </button>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-neutral-600">
          {t("konto.letzte")}
        </p>
        {ladeHistorie ? (
          <p className="text-xs text-neutral-500">{t("gemeinsam.laedt")}</p>
        ) : historie.length === 0 ? (
          <p className="text-xs text-neutral-500">
            {t("konto.keine", { jahr: saisonJahr })}
          </p>
        ) : (
          <table className="text-xs">
            <thead>
              <tr>
                <th>{t("gemeinsam.datum")}</th>
                <th>{t("erfassung.stunden")}</th>
                <th>{t("suche.art")}</th>
                <th>{t("gemeinsam.notiz")}</th>
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
                          title={t("konto.unbestaetigttitel")}
                        >
                          ⚠ {t("konto.unbestaetigt")}
                        </span>
                      )}
                  </td>
                  <td className={b.stunden < 0 ? "text-beere-600" : ""}>
                    {b.stunden > 0 ? "+" : ""}
                    {formatMenge(Number(b.stunden), 2)}
                  </td>
                  <td>
                    {artLabel(b.art)}
                    {b.storniert && ` (${t("gemeinsam.storniert")})`}
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
