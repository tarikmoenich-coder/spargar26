"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { ABRECHNUNGSART_LABELS, type SeasonSummaryRow } from "@/lib/types";
import { formatDatumDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();

function fmt(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : Number(n).toFixed(2);
}

export default function UebersichtPage() {
  const { profile } = useProfile();
  const [rows, setRows] = useState<SeasonSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<string>>(new Set());
  const [abrechnenLaeuft, setAbrechnenLaeuft] = useState(false);
  const [abrechnenFehler, setAbrechnenFehler] = useState<string | null>(null);

  const canEdit =
    profile?.role === "admin" || profile?.role === "lohnabrechnung";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("season_summary")
      .select("*")
      .eq("saison_jahr", jahr)
      .order("name");
    if (!error) setRows((data as SeasonSummaryRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    setAusgewaehlt(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  function toggleAuswahl(employeeId: string) {
    setAusgewaehlt((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function alleTogglen() {
    const alleAktivenIds = rows.filter((r) => r.aktiv).map((r) => r.employee_id);
    const alleAusgewaehlt = alleAktivenIds.every((id) => ausgewaehlt.has(id));
    setAusgewaehlt(alleAusgewaehlt ? new Set() : new Set(alleAktivenIds));
  }

  async function jetztAbrechnen() {
    if (ausgewaehlt.size === 0) return;
    const namen = rows
      .filter((r) => ausgewaehlt.has(r.employee_id))
      .map((r) => `${r.name}, ${r.vorname}`);
    const bestaetigt = window.confirm(
      `${ausgewaehlt.size} Person(en) für Saison ${jahr} jetzt abrechnen?\n\n` +
        `${namen.join("\n")}\n\n` +
        `Diese Personen werden danach auf "inaktiv" gesetzt (können bei Bedarf ` +
        `später wieder reaktiviert werden).`
    );
    if (!bestaetigt) return;

    setAbrechnenLaeuft(true);
    setAbrechnenFehler(null);
    const supabase = getSupabaseClient();
    const ergebnisse = await Promise.all(
      Array.from(ausgewaehlt).map((employee_id) =>
        supabase.rpc("saison_abrechnen", {
          p_employee_id: employee_id,
          p_saison_jahr: jahr,
        })
      )
    );
    const fehler = ergebnisse.find((r) => r.error)?.error;
    if (fehler) setAbrechnenFehler(fehler.message);
    setAusgewaehlt(new Set());
    setAbrechnenLaeuft(false);
    load();
  }

  async function nettoExternSpeichern(row: SeasonSummaryRow, wert: string) {
    const supabase = getSupabaseClient();
    const netto_extern = wert.trim() === "" ? null : Number(wert);
    await supabase.from("season_bonuses").upsert(
      {
        employee_id: row.employee_id,
        saison_jahr: row.saison_jahr,
        netto_extern,
      },
      { onConflict: "employee_id,saison_jahr" }
    );
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Saison-Lohnübersicht
        </h1>
        <p className="text-sm text-neutral-500">
          Automatisch aus Stunden, Prämien, Verpflegungs-/Wohnen-Abzügen und
          Vorschüssen berechnet. <strong>Erster Entwurf</strong> - vor echten
          Auszahlungen unbedingt gegen die bisherige Excel-Datei prüfen
          (siehe README, offener Punkt OI-009).
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          Bei Abrechnungsart „Lohnsteuerklasse 1" und
          „Sozialversicherungspflichtig" kann die App die Lohnsteuer nicht
          selbst berechnen - hier bitte den Netto-Betrag aus dem
          Lohnprogramm eintragen (entspricht der früheren Excel-Spalte
          „Netto-Summe (HSC)"). Ohne diesen Wert bleibt der
          Auszahlungsbetrag leer.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Saison-Jahr{" "}
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-24"
          />
        </label>
        {canEdit && (
          <button
            type="button"
            className="btn"
            disabled={ausgewaehlt.size === 0 || abrechnenLaeuft}
            onClick={jetztAbrechnen}
          >
            {ausgewaehlt.size > 0
              ? `${ausgewaehlt.size} Person(en) jetzt abrechnen`
              : "Jetzt Abrechnen"}
          </button>
        )}
        {abrechnenFehler && (
          <span className="text-sm text-red-600">{abrechnenFehler}</span>
        )}
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {canEdit && (
                  <th>
                    <input
                      type="checkbox"
                      onChange={alleTogglen}
                      checked={
                        rows.some((r) => r.aktiv) &&
                        rows
                          .filter((r) => r.aktiv)
                          .every((r) => ausgewaehlt.has(r.employee_id))
                      }
                    />
                  </th>
                )}
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Std.</th>
                <th>Tage</th>
                <th>Abrechnungsart</th>
                <th>Brutto €</th>
                <th>Lohnsteuer (pauschal) €</th>
                <th>Netto €</th>
                <th>Verpfl./Unterkunft €</th>
                <th>Vorschüsse €</th>
                <th>Auszahlungsbetrag €</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id} className={r.aktiv ? "" : "opacity-60"}>
                  {canEdit && (
                    <td>
                      <input
                        type="checkbox"
                        checked={ausgewaehlt.has(r.employee_id)}
                        disabled={!r.aktiv}
                        onChange={() => toggleAuswahl(r.employee_id)}
                      />
                    </td>
                  )}
                  <td>{r.personal_nr}</td>
                  <td>
                    {r.name}, {r.vorname}
                  </td>
                  <td>{Number(r.gesamt_stunden).toFixed(2)}</td>
                  <td>{r.anwesenheitstage}</td>
                  <td>{ABRECHNUNGSART_LABELS[r.abrechnungsart]}</td>
                  <td>{Number(r.bruttolohn).toFixed(2)}</td>
                  <td>{Number(r.lohnsteuer_pauschal).toFixed(2)}</td>
                  <td>
                    {r.abrechnungsart === "pauschal" ? (
                      fmt(r.netto)
                    ) : canEdit ? (
                      <input
                        type="number"
                        step="0.01"
                        className="w-24"
                        defaultValue={r.netto_extern ?? ""}
                        placeholder="aus Lohnprogramm"
                        key={`${r.employee_id}-${r.netto_extern ?? ""}`}
                        onBlur={(e) =>
                          nettoExternSpeichern(r, e.target.value)
                        }
                      />
                    ) : (
                      fmt(r.netto)
                    )}
                  </td>
                  <td>
                    {(
                      Number(r.abzug_verpflegung) + Number(r.abzug_wohnen)
                    ).toFixed(2)}
                  </td>
                  <td>{Number(r.vorschuss_summe).toFixed(2)}</td>
                  <td className="font-medium">{fmt(r.auszahlungsbetrag)}</td>
                  <td>
                    {r.aktiv ? "aktiv" : "inaktiv"}
                    {r.abgerechnet_am && (
                      <>
                        <br />
                        <span className="text-xs text-neutral-500">
                          abgerechnet {formatDatumDE(r.abgerechnet_am)}
                        </span>
                      </>
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
