"use client";

// "Anbau → Spargel" (Nutzer-Vorgabe 2026-10-19). Bewusst viel schlanker als
// "Anbau → Erdbeeren": Spargelfelder stehen über ~8 Jahre praktisch
// unverändert (keine Sortenrotation, kein Tunnelsystem), deshalb hier EIN
// Abschnitt je Feld+Saison statt Erdbeerens Feld→Tunnel→Bepflanzung-Baum.
// Die Saison-Planung soll beim Großteil der Felder ein einziger Klick sein:
// "Aus Vorjahr übernehmen" (feld_anbau_vorjahr_uebernehmen, generisch -
// dieselbe RPC wie bei Erdbeeren).

import PageHeader from "@/components/PageHeader";
import { Sprout } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import type { Feld, FeldAnbauAbschnitt, FeldAnbauUebersicht } from "@/lib/types";
import { formatMenge, formatZahlDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();

export default function AnbauSpargelPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "erntewirtschaft";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  const [felder, setFelder] = useState<Feld[]>([]);
  const [uebersicht, setUebersicht] = useState<FeldAnbauUebersicht[]>([]);
  const [abschnitte, setAbschnitte] = useState<Record<number, FeldAnbauAbschnitt[]>>({});
  const [laeuft, setLaeuft] = useState(false);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: fData }, { data: uData }] = await Promise.all([
      supabase.from("feld").select("*").eq("aktiv", true).eq("kultur", "spargel").order("bezeichnung"),
      supabase
        .from("feld_anbau_uebersicht")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("kultur", "spargel")
        .order("feld_bezeichnung"),
    ]);
    setFelder((fData as Feld[]) ?? []);
    const ueb = (uData as FeldAnbauUebersicht[]) ?? [];
    setUebersicht(ueb);

    const anbauIds = ueb.map((u) => u.anbau_id);
    if (anbauIds.length > 0) {
      const { data: aData } = await supabase
        .from("feld_anbau_abschnitt")
        .select("*")
        .in("feld_anbau_id", anbauIds)
        .order("id");
      const aMap: Record<number, FeldAnbauAbschnitt[]> = {};
      ((aData as FeldAnbauAbschnitt[]) ?? []).forEach((a) => {
        if (!aMap[a.feld_anbau_id]) aMap[a.feld_anbau_id] = [];
        aMap[a.feld_anbau_id].push(a);
      });
      setAbschnitte(aMap);
    } else {
      setAbschnitte({});
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  async function anbauAnlegen(feldId: number) {
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("feld_anbau")
      .insert({ feld_id: feldId, saison_jahr: jahr })
      .select("id")
      .single();
    if (error) {
      setFehler(error.message);
      setLaeuft(false);
      return;
    }
    // Direkt den einen, üblichen Abschnitt mit anlegen - erspart bei
    // Spargel den separaten "Abschnitt hinzufügen"-Klick im Normalfall.
    await supabase.from("feld_anbau_abschnitt").insert({
      feld_anbau_id: data.id,
      bezeichnung: "1",
    });
    setLaeuft(false);
    load();
  }

  async function vorjahrUebernehmen() {
    if (
      !window.confirm(
        `Alle Spargelfelder aus ${jahr - 1} nach ${jahr} übernehmen? ` +
          `Felder, die für ${jahr} schon geplant sind, bleiben unverändert.`
      )
    ) {
      return;
    }
    setLaeuft(true);
    setFehler(null);
    setMeldung(null);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("feld_anbau_vorjahr_uebernehmen", {
      p_saison_jahr: jahr,
      p_quelle_jahr: jahr - 1,
    });
    setLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setMeldung(`${data ?? 0} Feld(er) aus ${jahr - 1} übernommen.`);
    load();
  }

  async function anbauAendern(
    anbauId: number,
    feld: "erntefenster_von" | "erntefenster_bis" | "rodung_geplant" | "notiz",
    wert: string
  ) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("feld_anbau")
      .update({ [feld]: wert || null })
      .eq("id", anbauId);
    if (error) setFehler(error.message);
    load();
  }

  async function abschnittAendern(
    id: number,
    feld: "reihen_anzahl" | "reihenlaenge_m" | "reihenabstand_m" | "pflanzen_pro_lfm" | "standjahr" | "pflanzdatum",
    wert: string
  ) {
    const supabase = getSupabaseClient();
    const zahlFelder = ["reihen_anzahl", "reihenlaenge_m", "reihenabstand_m", "pflanzen_pro_lfm", "standjahr"];
    const { error } = await supabase
      .from("feld_anbau_abschnitt")
      .update({ [feld]: zahlFelder.includes(feld) ? (wert ? Number(wert) : null) : wert || null })
      .eq("id", id);
    if (error) setFehler(error.message);
    load();
  }

  async function abschnittHinzufuegen(anbauId: number) {
    const bezeichnung = window.prompt(
      "Bezeichnung für den zusätzlichen Abschnitt (z.B. bei unterschiedlichem Standjahr auf demselben Feld):",
      String((abschnitte[anbauId]?.length ?? 0) + 1)
    );
    if (!bezeichnung) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("feld_anbau_abschnitt")
      .insert({ feld_anbau_id: anbauId, bezeichnung: bezeichnung.trim() });
    if (error) setFehler(error.message);
    load();
  }

  async function abschnittLoeschen(id: number) {
    if (!window.confirm("Diesen Abschnitt wirklich entfernen?")) return;
    const supabase = getSupabaseClient();
    await supabase.from("feld_anbau_abschnitt").delete().eq("id", id);
    load();
  }

  const geplanteIds = new Set(uebersicht.map((u) => u.feld_id));
  const nochNichtGeplant = felder.filter((f) => !geplanteIds.has(f.id));

  const gesamtNettoHa = uebersicht.reduce((s, u) => s + (u.netto_ha ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div>
        <PageHeader icon={Sprout} titel="Anbauplanung Spargel" />
        <p className="text-sm text-neutral-500">
          Je Feld die Reihen-Daten (Anzahl, Länge, Abstand, Pflanzen je
          laufendem Meter) und das Standjahr. Netto-Hektarfläche und
          Pflanzenzahl werden gerechnet. Spargelfelder ändern sich über
          mehrere Jahre kaum – meist reicht „Aus Vorjahr übernehmen" statt
          erneuter Eingabe (Standjahr zählt dabei automatisch eins hoch).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>
          Saison{" "}
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
            className="btn-secondary text-xs"
            onClick={vorjahrUebernehmen}
            disabled={laeuft}
            title={`Felder + Reihen-Daten aus ${jahr - 1} übernehmen, Standjahr +1`}
          >
            Aus {jahr - 1} übernehmen
          </button>
        )}
        <span className="text-neutral-500">
          {uebersicht.length} Feld(er) · {formatMenge(gesamtNettoHa, 4)} ha netto
        </span>
      </div>

      {fehler && (
        <p className="rounded border border-beere-300 bg-beere-50 p-2 text-sm text-beere-700">{fehler}</p>
      )}
      {meldung && <p className="text-sm text-emerald-700">{meldung}</p>}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : uebersicht.length === 0 ? (
        <p className="text-neutral-500">
          Für {jahr} ist noch nichts geplant. Übernimm den Vorjahrgang oder füge unten ein Feld hinzu.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Feld</th>
                <th>Reihen</th>
                <th>Länge m</th>
                <th title="Abstand zwischen den Reihen - treibt die Netto-Hektarfläche">Abstand m</th>
                <th title="Pflanzen je laufendem Meter (optional)">Pfl./lfm</th>
                <th>Standjahr</th>
                <th title="Aus Reihen × Länge × Abstand">Netto ha</th>
                <th>Pflanzen</th>
                <th>Erntefenster</th>
                <th>Rodung geplant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {uebersicht.map((u) => {
                const liste = abschnitte[u.anbau_id] ?? [];
                return (
                  <Fragment key={u.anbau_id}>
                    {liste.length === 0 ? (
                      <tr>
                        <td className="font-medium">{u.feld_bezeichnung}</td>
                        <td colSpan={9} className="text-sm text-neutral-500">
                          Noch kein Abschnitt angelegt.{" "}
                          {canEdit && (
                            <button
                              type="button"
                              className="text-emerald-700 underline"
                              onClick={() => abschnittHinzufuegen(u.anbau_id)}
                            >
                              Abschnitt anlegen
                            </button>
                          )}
                        </td>
                      </tr>
                    ) : (
                      liste.map((a, i) => (
                        <tr key={a.id}>
                          <td className="font-medium">
                            {i === 0 ? u.feld_bezeichnung : <span className="text-xs text-neutral-400">↳ {a.bezeichnung}</span>}
                          </td>
                          <td>
                            <input
                              type="number"
                              defaultValue={a.reihen_anzahl ?? ""}
                              disabled={!canEdit}
                              className="w-16"
                              onBlur={(e) => abschnittAendern(a.id, "reihen_anzahl", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={a.reihenlaenge_m ?? ""}
                              disabled={!canEdit}
                              className="w-20"
                              onBlur={(e) => abschnittAendern(a.id, "reihenlaenge_m", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={a.reihenabstand_m ?? ""}
                              disabled={!canEdit}
                              className="w-20"
                              onBlur={(e) => abschnittAendern(a.id, "reihenabstand_m", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={a.pflanzen_pro_lfm ?? ""}
                              disabled={!canEdit}
                              className="w-20"
                              onBlur={(e) => abschnittAendern(a.id, "pflanzen_pro_lfm", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              defaultValue={a.standjahr ?? ""}
                              disabled={!canEdit}
                              className="w-16"
                              onBlur={(e) => abschnittAendern(a.id, "standjahr", e.target.value)}
                            />
                          </td>
                          {i === 0 ? (
                            <>
                              <td>{formatMenge(u.netto_ha, 4)}</td>
                              <td>{formatZahlDE(u.anzahl_pflanzen)}</td>
                              <td className="text-xs">
                                <input
                                  type="date"
                                  defaultValue={u.erntefenster_von ?? ""}
                                  disabled={!canEdit}
                                  className="w-32"
                                  onBlur={(e) => anbauAendern(u.anbau_id, "erntefenster_von", e.target.value)}
                                />
                                <input
                                  type="date"
                                  defaultValue={u.erntefenster_bis ?? ""}
                                  disabled={!canEdit}
                                  className="mt-1 w-32"
                                  onBlur={(e) => anbauAendern(u.anbau_id, "erntefenster_bis", e.target.value)}
                                />
                              </td>
                              <td>
                                <input
                                  type="date"
                                  defaultValue={u.rodung_geplant ?? ""}
                                  disabled={!canEdit}
                                  className="w-32"
                                  title="Nach ca. 8-10 Jahren wird ein Spargelfeld gerodet und neu angelegt"
                                  onBlur={(e) => anbauAendern(u.anbau_id, "rodung_geplant", e.target.value)}
                                />
                              </td>
                            </>
                          ) : (
                            <td colSpan={4}></td>
                          )}
                          <td>
                            <div className="flex items-center gap-2">
                              {canEdit && i === liste.length - 1 && (
                                <button
                                  type="button"
                                  className="text-xs text-emerald-700 underline"
                                  onClick={() => abschnittHinzufuegen(u.anbau_id)}
                                  title="Weiteren Abschnitt anlegen (z.B. bei unterschiedlichem Standjahr auf demselben Feld)"
                                >
                                  + Abschnitt
                                </button>
                              )}
                              {canEdit && liste.length > 1 && (
                                <button
                                  type="button"
                                  className="text-xs text-neutral-400 hover:text-beere-600"
                                  onClick={() => abschnittLoeschen(a.id)}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && nochNichtGeplant.length > 0 && (
        <div className="rounded border border-linie bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-emerald-800">Feld für {jahr} hinzufügen</h2>
          <div className="flex flex-wrap gap-2">
            {nochNichtGeplant.map((f) => (
              <button
                key={f.id}
                type="button"
                className="btn-secondary text-xs"
                disabled={laeuft}
                onClick={() => anbauAnlegen(f.id)}
              >
                + {f.bezeichnung}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Neue Felder werden im Reiter „Felder" angelegt (Kultur „Spargel").
          </p>
        </div>
      )}
    </div>
  );
}
