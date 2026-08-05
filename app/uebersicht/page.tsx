"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { ABRECHNUNGSART_LABELS, type SeasonSummaryRow } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

function fmt(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : Number(n).toFixed(2);
}

export default function UebersichtPage() {
  const { profile } = useProfile();
  const [rows, setRows] = useState<SeasonSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [jahr, setJahr] = useState(CURRENT_YEAR);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

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

      <label className="text-sm">
        Saison-Jahr{" "}
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
          className="w-24"
        />
      </label>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id}>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
