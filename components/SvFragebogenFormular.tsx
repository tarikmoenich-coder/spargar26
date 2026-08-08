"use client";

// Eingabeformular für den SV-Fragebogen ("Fragebogen zur Feststellung der
// Versicherungspflicht/Versicherungsfreiheit rumänischer
// Saisonarbeitnehmer") - eigenständige Komponente, da sowohl auf
// "Personal → Sozialversicherung" (freie Auswahl) als auch auf
// "Personal → Anreiseliste" (person für person, gruppenweise) genutzt.
// Lädt/speichert selbst anhand von employeeId + saisonJahr, damit beide
// Seiten sie einfach nur bedingt rendern müssen.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type {
  SvFragebogen,
  SvFragebogenAuswertung,
  SvFragebogenVorbeschaeftigung,
} from "@/lib/types";

// Felder, die vorjahresweise verglichen werden (Nutzer-Vorgabe 2026-08-08:
// prüfen, ob die Angaben weiterhin wahrheitsgemäß gemacht werden). Nur die
// Ja/Nein-Kernfragen, nicht jedes Detailfeld.
export const SV_VERGLEICHS_FELDER: { key: keyof SvFragebogen; label: string }[] =
  [
    { key: "beschaeftigt_heimatland", label: "Beschäftigung im Heimatland" },
    { key: "selbststaendig", label: "Selbstständigkeit" },
    { key: "arbeitslos", label: "Arbeitslos gemeldet" },
    { key: "schule_studium", label: "Schule/Studium" },
    { key: "rente", label: "Rentenbezug" },
    { key: "hausmann", label: "Hausfrau/Hausmann" },
  ];

export function jaNein(v: boolean | null | undefined): string {
  if (v === true) return "Ja";
  if (v === false) return "Nein";
  return "—";
}

// Leerer Entwurf für ein neues Formular (id/employee_id/saison_jahr/Meta
// werden beim Speichern ergänzt).
type Entwurf = Omit<
  SvFragebogen,
  | "id"
  | "employee_id"
  | "saison_jahr"
  | "erfasst_von"
  | "erfasst_am"
  | "updated_by"
  | "updated_at"
>;

const LEERER_ENTWURF: Entwurf = {
  beschaeftigt_heimatland: null,
  beschaeftigt_firma: null,
  beschaeftigt_taetigkeit: null,
  bezahlter_urlaub: null,
  bezahlter_urlaub_von: null,
  bezahlter_urlaub_bis: null,
  unbezahlter_urlaub: null,
  unbezahlter_urlaub_von: null,
  unbezahlter_urlaub_bis: null,
  freistellung: null,
  freistellung_von: null,
  freistellung_bis: null,
  freistellung_grund: null,
  selbststaendig: null,
  selbststaendig_seit: null,
  selbststaendig_taetigkeit: null,
  arbeitslos: null,
  arbeitslos_seit: null,
  arbeitsamt_name: null,
  arbeitsamt_aktenzeichen: null,
  schule_studium: null,
  schule_seit: null,
  schule_name: null,
  schule_ende: null,
  schulferien_waehrend_beschaeftigung: null,
  schulferien_von: null,
  schulferien_bis: null,
  rente: null,
  rente_seit: null,
  rente_art: null,
  rente_traeger: null,
  hausmann: null,
  hausmann_seit: null,
  lebensunterhalt_sonstiges: null,
  vorbeschaeftigung_deutschland_tage: null,
  vorbeschaeftigung_deutschland_arbeitgeber: null,
  ausgeloest_durch_lohnprogramm_hinweis: false,
  ausgefuellt_am: null,
};

// Live-Vorschau der Auswertung, identisch zur Logik der Sicht
// sv_fragebogen_auswertung in schema.sql - damit man beim Ausfüllen direkt
// sieht, wie sich die Angaben auswirken, ohne erst zu speichern.
export function bestandenVorschau(e: Entwurf): boolean {
  return (
    (!!e.beschaeftigt_heimatland ||
      !!e.selbststaendig ||
      !!e.schule_studium ||
      !!e.rente ||
      !!e.hausmann) &&
    !e.arbeitslos
  );
}

export default function SvFragebogenFormular({
  employeeId,
  saisonJahr,
  canEdit,
  titel,
  onGespeichert,
  onAbbrechen,
}: {
  employeeId: string;
  saisonJahr: number;
  canEdit: boolean;
  titel?: string;
  onGespeichert: () => void;
  onAbbrechen: () => void;
}) {
  const { profile } = useProfile();
  const [laden, setLaden] = useState(true);
  const [entwurf, setEntwurf] = useState<Entwurf>(LEERER_ENTWURF);
  const [fragebogenId, setFragebogenId] = useState<number | null>(null);
  const [vorjahr, setVorjahr] = useState<SvFragebogenAuswertung | null>(null);
  const [vorbeschaeftigung, setVorbeschaeftigung] = useState<
    SvFragebogenVorbeschaeftigung[]
  >([]);
  const [speichernLaeuft, setSpeichernLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLaden(true);
      const supabase = getSupabaseClient();
      const [{ data: bestehend }, { data: vj }] = await Promise.all([
        supabase
          .from("sv_fragebogen_auswertung")
          .select("*")
          .eq("employee_id", employeeId)
          .eq("saison_jahr", saisonJahr)
          .maybeSingle(),
        supabase
          .from("sv_fragebogen_auswertung")
          .select("*")
          .eq("employee_id", employeeId)
          .eq("saison_jahr", saisonJahr - 1)
          .maybeSingle(),
      ]);
      if (bestehend) {
        setEntwurf({ ...(bestehend as SvFragebogenAuswertung) });
        setFragebogenId((bestehend as SvFragebogenAuswertung).id);
        const { data: vb } = await supabase
          .from("sv_fragebogen_vorbeschaeftigung")
          .select("*")
          .eq("fragebogen_id", (bestehend as SvFragebogenAuswertung).id)
          .order("von");
        setVorbeschaeftigung((vb as SvFragebogenVorbeschaeftigung[]) ?? []);
      } else {
        setEntwurf(LEERER_ENTWURF);
        setFragebogenId(null);
        setVorbeschaeftigung([]);
      }
      setVorjahr((vj as SvFragebogenAuswertung) ?? null);
      setLaden(false);
    }
    load();
  }, [employeeId, saisonJahr]);

  function feld<K extends keyof Entwurf>(key: K, value: Entwurf[K]) {
    setEntwurf((prev) => ({ ...prev, [key]: value }));
  }

  function vorbeschaeftigungZeileHinzufuegen() {
    setVorbeschaeftigung((prev) => [
      ...prev,
      { von: "", bis: "", wochenstunden: null, taetigkeit: "", arbeitgeber: "" },
    ]);
  }

  function vorbeschaeftigungZeileAendern(
    idx: number,
    feldName: keyof SvFragebogenVorbeschaeftigung,
    wert: string
  ) {
    setVorbeschaeftigung((prev) =>
      prev.map((z, i) =>
        i === idx
          ? {
              ...z,
              [feldName]:
                feldName === "wochenstunden" ? (wert ? Number(wert) : null) : wert,
            }
          : z
      )
    );
  }

  function vorbeschaeftigungZeileEntfernen(idx: number) {
    setVorbeschaeftigung((prev) => prev.filter((_, i) => i !== idx));
  }

  async function speichern() {
    if (!profile) return;
    setSpeichernLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { data: gespeichert, error: upsertError } = await supabase
      .from("sv_fragebogen")
      .upsert(
        {
          ...entwurf,
          employee_id: employeeId,
          saison_jahr: saisonJahr,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "employee_id,saison_jahr" }
      )
      .select("id")
      .single();
    if (upsertError || !gespeichert) {
      setFehler(upsertError?.message ?? "Speichern fehlgeschlagen");
      setSpeichernLaeuft(false);
      return;
    }
    const neueFragebogenId = gespeichert.id as number;
    // Vorbeschäftigungs-Zeilen: einfach ersetzen (löschen + neu einfügen) -
    // bei einer kleinen, seltenen editierten Liste unkompliziert korrekt.
    await supabase
      .from("sv_fragebogen_vorbeschaeftigung")
      .delete()
      .eq("fragebogen_id", neueFragebogenId);
    const gueltigeZeilen = vorbeschaeftigung.filter((z) => z.von && z.bis);
    if (gueltigeZeilen.length > 0) {
      const { error: insertError } = await supabase
        .from("sv_fragebogen_vorbeschaeftigung")
        .insert(
          gueltigeZeilen.map((z) => ({
            fragebogen_id: neueFragebogenId,
            von: z.von,
            bis: z.bis,
            wochenstunden: z.wochenstunden,
            taetigkeit: z.taetigkeit || null,
            arbeitgeber: z.arbeitgeber || null,
          }))
        );
      if (insertError) {
        setFehler(insertError.message);
        setSpeichernLaeuft(false);
        return;
      }
    }
    setSpeichernLaeuft(false);
    onGespeichert();
  }

  function checkboxZeile(
    label: string,
    checked: boolean | null,
    onChange: (v: boolean) => void,
    kinder?: React.ReactNode
  ) {
    return (
      <div className="rounded border border-neutral-200 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={checked ?? false}
            onChange={(e) => onChange(e.target.checked)}
            disabled={!canEdit}
          />
          {label}
        </label>
        {checked && <div className="mt-2 flex flex-wrap gap-2 pl-6">{kinder}</div>}
      </div>
    );
  }

  if (laden) {
    return <p className="text-neutral-500">Lädt…</p>;
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-emerald-800">
          {titel ?? `SV-Fragebogen ${saisonJahr}`}
          {fragebogenId ? "" : " (neu)"}
        </h3>
        <span
          className={`text-sm font-medium ${
            bestandenVorschau(entwurf) ? "text-emerald-700" : "text-red-600"
          }`}
        >
          Vorschau: {bestandenVorschau(entwurf) ? "✓ Bestanden" : "⚠ Nicht bestanden"}
        </span>
      </div>

      {vorjahr && (
        <p className="text-xs text-neutral-600">
          Vorjahr ({saisonJahr - 1}):{" "}
          {SV_VERGLEICHS_FELDER.map(
            (v) => `${v.label}: ${jaNein(vorjahr[v.key] as boolean | null)}`
          ).join(" · ")}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {checkboxZeile(
          "1. Beschäftigung im Heimatland",
          entwurf.beschaeftigt_heimatland,
          (v) => feld("beschaeftigt_heimatland", v),
          <>
            <input
              placeholder="Firma"
              value={entwurf.beschaeftigt_firma ?? ""}
              onChange={(e) => feld("beschaeftigt_firma", e.target.value)}
              disabled={!canEdit}
            />
            <input
              placeholder="Tätigkeit"
              value={entwurf.beschaeftigt_taetigkeit ?? ""}
              onChange={(e) => feld("beschaeftigt_taetigkeit", e.target.value)}
              disabled={!canEdit}
            />
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={entwurf.bezahlter_urlaub ?? false}
                onChange={(e) => feld("bezahlter_urlaub", e.target.checked)}
                disabled={!canEdit}
              />
              bezahlter Urlaub
            </label>
            {entwurf.bezahlter_urlaub && (
              <>
                <input
                  type="date"
                  value={entwurf.bezahlter_urlaub_von ?? ""}
                  onChange={(e) => feld("bezahlter_urlaub_von", e.target.value)}
                  disabled={!canEdit}
                />
                <input
                  type="date"
                  value={entwurf.bezahlter_urlaub_bis ?? ""}
                  onChange={(e) => feld("bezahlter_urlaub_bis", e.target.value)}
                  disabled={!canEdit}
                />
              </>
            )}
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={entwurf.unbezahlter_urlaub ?? false}
                onChange={(e) => feld("unbezahlter_urlaub", e.target.checked)}
                disabled={!canEdit}
              />
              unbezahlter Urlaub
            </label>
            {entwurf.unbezahlter_urlaub && (
              <>
                <input
                  type="date"
                  value={entwurf.unbezahlter_urlaub_von ?? ""}
                  onChange={(e) => feld("unbezahlter_urlaub_von", e.target.value)}
                  disabled={!canEdit}
                />
                <input
                  type="date"
                  value={entwurf.unbezahlter_urlaub_bis ?? ""}
                  onChange={(e) => feld("unbezahlter_urlaub_bis", e.target.value)}
                  disabled={!canEdit}
                />
              </>
            )}
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={entwurf.freistellung ?? false}
                onChange={(e) => feld("freistellung", e.target.checked)}
                disabled={!canEdit}
              />
              Freistellung aus anderen Gründen
            </label>
            {entwurf.freistellung && (
              <>
                <input
                  type="date"
                  value={entwurf.freistellung_von ?? ""}
                  onChange={(e) => feld("freistellung_von", e.target.value)}
                  disabled={!canEdit}
                />
                <input
                  type="date"
                  value={entwurf.freistellung_bis ?? ""}
                  onChange={(e) => feld("freistellung_bis", e.target.value)}
                  disabled={!canEdit}
                />
                <input
                  placeholder="Grund"
                  value={entwurf.freistellung_grund ?? ""}
                  onChange={(e) => feld("freistellung_grund", e.target.value)}
                  disabled={!canEdit}
                />
              </>
            )}
          </>
        )}

        {checkboxZeile(
          "2. Selbstständigkeit im Heimatland",
          entwurf.selbststaendig,
          (v) => feld("selbststaendig", v),
          <>
            <input
              type="date"
              title="seit"
              value={entwurf.selbststaendig_seit ?? ""}
              onChange={(e) => feld("selbststaendig_seit", e.target.value)}
              disabled={!canEdit}
            />
            <input
              placeholder="Tätigkeit als"
              value={entwurf.selbststaendig_taetigkeit ?? ""}
              onChange={(e) => feld("selbststaendig_taetigkeit", e.target.value)}
              disabled={!canEdit}
            />
          </>
        )}

        {checkboxZeile(
          "3. Arbeitslosigkeit im Heimatland",
          entwurf.arbeitslos,
          (v) => feld("arbeitslos", v),
          <>
            <input
              type="date"
              title="seit"
              value={entwurf.arbeitslos_seit ?? ""}
              onChange={(e) => feld("arbeitslos_seit", e.target.value)}
              disabled={!canEdit}
            />
            <input
              placeholder="Arbeitsamt"
              value={entwurf.arbeitsamt_name ?? ""}
              onChange={(e) => feld("arbeitsamt_name", e.target.value)}
              disabled={!canEdit}
            />
            <input
              placeholder="Aktenzeichen"
              value={entwurf.arbeitsamt_aktenzeichen ?? ""}
              onChange={(e) => feld("arbeitsamt_aktenzeichen", e.target.value)}
              disabled={!canEdit}
            />
          </>
        )}

        {checkboxZeile(
          "4. Schulbesuch/Studium",
          entwurf.schule_studium,
          (v) => feld("schule_studium", v),
          <>
            <input
              type="date"
              title="seit"
              value={entwurf.schule_seit ?? ""}
              onChange={(e) => feld("schule_seit", e.target.value)}
              disabled={!canEdit}
            />
            <input
              placeholder="Einrichtung"
              value={entwurf.schule_name ?? ""}
              onChange={(e) => feld("schule_name", e.target.value)}
              disabled={!canEdit}
            />
            <input
              type="date"
              title="voraussichtliches Ende"
              value={entwurf.schule_ende ?? ""}
              onChange={(e) => feld("schule_ende", e.target.value)}
              disabled={!canEdit}
            />
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={entwurf.schulferien_waehrend_beschaeftigung ?? false}
                onChange={(e) =>
                  feld("schulferien_waehrend_beschaeftigung", e.target.checked)
                }
                disabled={!canEdit}
              />
              Schulferien während der Beschäftigung
            </label>
            {entwurf.schulferien_waehrend_beschaeftigung && (
              <>
                <input
                  type="date"
                  value={entwurf.schulferien_von ?? ""}
                  onChange={(e) => feld("schulferien_von", e.target.value)}
                  disabled={!canEdit}
                />
                <input
                  type="date"
                  value={entwurf.schulferien_bis ?? ""}
                  onChange={(e) => feld("schulferien_bis", e.target.value)}
                  disabled={!canEdit}
                />
              </>
            )}
          </>
        )}

        {checkboxZeile(
          "5. Rentenbezug im Heimatland",
          entwurf.rente,
          (v) => feld("rente", v),
          <>
            <input
              type="date"
              title="seit"
              value={entwurf.rente_seit ?? ""}
              onChange={(e) => feld("rente_seit", e.target.value)}
              disabled={!canEdit}
            />
            <input
              placeholder="Art der Rente"
              value={entwurf.rente_art ?? ""}
              onChange={(e) => feld("rente_art", e.target.value)}
              disabled={!canEdit}
            />
            <input
              placeholder="Versicherungsträger"
              value={entwurf.rente_traeger ?? ""}
              onChange={(e) => feld("rente_traeger", e.target.value)}
              disabled={!canEdit}
            />
          </>
        )}

        {checkboxZeile(
          "6. Hausfrau/Hausmann",
          entwurf.hausmann,
          (v) => feld("hausmann", v),
          <input
            type="date"
            title="seit"
            value={entwurf.hausmann_seit ?? ""}
            onChange={(e) => feld("hausmann_seit", e.target.value)}
            disabled={!canEdit}
          />
        )}
      </div>

      <div className="rounded border border-neutral-200 p-3">
        <p className="text-sm font-medium">
          7. Sonstiges - falls 1-6 alle "Nein"
        </p>
        <input
          placeholder="Wovon wird der Lebensunterhalt bestritten?"
          value={entwurf.lebensunterhalt_sonstiges ?? ""}
          onChange={(e) => feld("lebensunterhalt_sonstiges", e.target.value)}
          disabled={!canEdit}
          className="mt-2 w-full"
        />
      </div>

      <div className="rounded border border-amber-300 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-900">
          Bisherige Arbeitstage in Deutschland (dieses Kalenderjahr, bei
          anderen Arbeitgebern) - zählt für die 90-Tage-Grenze
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={0}
            placeholder="Tage"
            value={entwurf.vorbeschaeftigung_deutschland_tage ?? ""}
            onChange={(e) =>
              feld(
                "vorbeschaeftigung_deutschland_tage",
                e.target.value ? Number(e.target.value) : null
              )
            }
            disabled={!canEdit}
            className="w-24"
          />
          <input
            placeholder="bei welchem Arbeitgeber"
            value={entwurf.vorbeschaeftigung_deutschland_arbeitgeber ?? ""}
            onChange={(e) =>
              feld("vorbeschaeftigung_deutschland_arbeitgeber", e.target.value)
            }
            disabled={!canEdit}
          />
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={entwurf.ausgeloest_durch_lohnprogramm_hinweis}
              onChange={(e) =>
                feld("ausgeloest_durch_lohnprogramm_hinweis", e.target.checked)
              }
              disabled={!canEdit}
            />
            ausgelöst durch Rückmeldung vom Lohnprogramm
          </label>
        </div>
      </div>

      <div className="rounded border border-neutral-200 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            8. Bisherige Beschäftigungen im Kalenderjahr (In- oder Ausland,
            nur zur Dokumentation)
          </p>
          {canEdit && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={vorbeschaeftigungZeileHinzufuegen}
            >
              + Zeile
            </button>
          )}
        </div>
        {vorbeschaeftigung.length > 0 && (
          <table className="mt-2">
            <thead>
              <tr>
                <th>Von</th>
                <th>Bis</th>
                <th>Std./Woche</th>
                <th>Tätigkeit</th>
                <th>Arbeitgeber</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {vorbeschaeftigung.map((z, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      type="date"
                      value={z.von}
                      onChange={(e) =>
                        vorbeschaeftigungZeileAendern(idx, "von", e.target.value)
                      }
                      disabled={!canEdit}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={z.bis}
                      onChange={(e) =>
                        vorbeschaeftigungZeileAendern(idx, "bis", e.target.value)
                      }
                      disabled={!canEdit}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="w-16"
                      value={z.wochenstunden ?? ""}
                      onChange={(e) =>
                        vorbeschaeftigungZeileAendern(
                          idx,
                          "wochenstunden",
                          e.target.value
                        )
                      }
                      disabled={!canEdit}
                    />
                  </td>
                  <td>
                    <input
                      value={z.taetigkeit ?? ""}
                      onChange={(e) =>
                        vorbeschaeftigungZeileAendern(
                          idx,
                          "taetigkeit",
                          e.target.value
                        )
                      }
                      disabled={!canEdit}
                    />
                  </td>
                  <td>
                    <input
                      value={z.arbeitgeber ?? ""}
                      onChange={(e) =>
                        vorbeschaeftigungZeileAendern(
                          idx,
                          "arbeitgeber",
                          e.target.value
                        )
                      }
                      disabled={!canEdit}
                    />
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => vorbeschaeftigungZeileEntfernen(idx)}
                      >
                        Entfernen
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <label className="text-sm">
        Ausgefüllt am (Datum auf dem Papierformular){" "}
        <input
          type="date"
          value={entwurf.ausgefuellt_am ?? ""}
          onChange={(e) => feld("ausgefuellt_am", e.target.value)}
          disabled={!canEdit}
        />
      </label>

      {fehler && <p className="text-sm text-red-600">{fehler}</p>}

      {canEdit && (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            onClick={speichern}
            disabled={speichernLaeuft}
          >
            Speichern
          </button>
          <button type="button" className="btn-secondary" onClick={onAbbrechen}>
            Abbrechen
          </button>
        </div>
      )}
    </div>
  );
}
