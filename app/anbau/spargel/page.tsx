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
import { Fragment, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import ReihenAusrichtungKarte, { type ReihenErgebnis } from "@/components/ReihenAusrichtungKarte";
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

  // Feldkonturen für "Reihen aus Karte berechnen" (Nutzer-Vorgabe 2026-10-29) -
  // ändern sich kaum, darum einmalig geladen statt bei jedem Saisonwechsel neu,
  // gleiches Muster wie app/erntewirtschaft/page.tsx.
  const [felderGeo, setFelderGeo] = useState<Record<number, string | null>>({});
  const [reihenKarte, setReihenKarte] = useState<{ abschnitt: FeldAnbauAbschnitt; feldId: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient()
        .from("feld_geojson")
        .select("id, geometrie_geojson")
        .eq("aktiv", true)
        .eq("kultur", "spargel");
      const geo: Record<number, string | null> = {};
      ((data as { id: number; geometrie_geojson: string | null }[]) ?? []).forEach((f) => {
        geo[f.id] = f.geometrie_geojson;
      });
      setFelderGeo(geo);
    })();
  }, []);

  // Für den "Länge aus Fläche schätzen"-Knopf: liest die aktuell im Feld
  // stehenden Werte (Reihenzahl/-abstand) direkt aus dem DOM, ohne diese
  // Inputs in kontrollierte React-State umzubauen (gleiches Muster wie der
  // Rest der Seite: unkontrollierte Inputs + onBlur).
  const reihenRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const abstandRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const laengeRefs = useRef<Record<number, HTMLInputElement | null>>({});

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
    feld: "rodung_geplant" | "notiz" | "ertrag_erwartet",
    wert: string
  ) {
    const supabase = getSupabaseClient();
    // Zielertrag ist auf dieser Seite immer kg/ha - Einheit mit setzen, damit
    // spätere generische Auswertungen (z.B. Teil F3 Zielertrag-Alarm) den Wert
    // nicht versehentlich als "steigen" (Erdbeeren-Default) interpretieren.
    const payload: Record<string, number | string | null> =
      feld === "ertrag_erwartet"
        ? { ertrag_erwartet: wert ? Number(wert) : null, ertrag_einheit: wert ? "kg_ha" : null }
        : { [feld]: wert || null };
    const { error } = await supabase.from("feld_anbau").update(payload).eq("id", anbauId);
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

  // "Länge aus Fläche schätzen" (Nutzer-Vorgabe 2026-10-20): bei stark
  // verwinkelten Feldern mit vielen unterschiedlich langen Reihen ist eine
  // einzelne, repräsentative Reihenlänge kaum sinnvoll einzutippen -
  // Brutto-Fläche (aus der echten Geometrie) ÷ Reihenabstand ergibt die
  // gesamte Laufmeter-Summe unabhängig von der genauen Form des Feldes;
  // geteilt durch die (echte) Reihenzahl ergibt eine effektive
  // Durchschnittslänge, die in die bestehende Formel
  // (Reihenzahl × Reihenlänge = laufende Meter) passt.
  function laengeAusFlaecheSchaetzen(a: FeldAnbauAbschnitt, brutoHa: number | null) {
    if (!brutoHa) {
      setFehler("Für dieses Feld ist keine Brutto-Fläche hinterlegt (Geometrie fehlt).");
      return;
    }
    const reihen = Number(reihenRefs.current[a.id]?.value || a.reihen_anzahl || 0);
    const abstand = Number(abstandRefs.current[a.id]?.value || a.reihenabstand_m || 0);
    if (!reihen || !abstand) {
      setFehler("Bitte zuerst Reihenzahl und Reihenabstand eintragen.");
      return;
    }
    const laufmeterGesamt = (brutoHa * 10000) / abstand;
    const laenge = Math.round((laufmeterGesamt / reihen) * 100) / 100;
    const input = laengeRefs.current[a.id];
    if (input) input.value = String(laenge);
    abschnittAendern(a.id, "reihenlaenge_m", String(laenge));
  }

  async function reihenUebernehmen(ergebnis: ReihenErgebnis) {
    if (!reihenKarte) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("feld_anbau_abschnitt")
      .update({
        reihen_anzahl: ergebnis.reihenAnzahl,
        reihenlaenge_m: Math.round(ergebnis.laengeAvg * 100) / 100,
        reihenlaenge_min_m: Math.round(ergebnis.laengeMin * 100) / 100,
        reihenlaenge_max_m: Math.round(ergebnis.laengeMax * 100) / 100,
        laufmeter_gesamt_m: Math.round(ergebnis.laufmeterGesamt * 100) / 100,
        ausrichtungslinie_geojson: ergebnis.linieGeojson,
        reihen_versatz_m: ergebnis.versatzM,
        reihen_erster_index: ergebnis.ersterIndex,
        reihen_letzter_index: ergebnis.letzterIndex,
        reihen_fahrgassen: ergebnis.fahrgassen,
      })
      .eq("id", reihenKarte.abschnitt.id);
    if (error) setFehler(error.message);
    setReihenKarte(null);
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
                <th>
                  Länge m
                  <br />
                  <span className="text-xs font-normal text-neutral-400">⌀, s. 📐</span>
                </th>
                <th title="Abstand zwischen den Reihen - treibt die Netto-Hektarfläche">Abstand m</th>
                <th title="Pflanzen je laufendem Meter (optional)">Pfl./lfm</th>
                <th>Standjahr</th>
                <th title="Aus der echten Geometrie (ST_Area), unabhängig von der Reihen-Planung">
                  Brutto ha
                </th>
                <th title="Aus Reihen × Länge × Abstand">Netto ha</th>
                <th>Pflanzen</th>
                <th title="Geplanter Ertrag je Hektar, für Planung/Vergleich mit dem tatsächlichen Wiege-Ertrag">
                  Zielertrag kg/ha
                </th>
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
                        <td colSpan={11} className="text-sm text-neutral-500">
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
                              ref={(el) => {
                                reihenRefs.current[a.id] = el;
                              }}
                              type="number"
                              defaultValue={a.reihen_anzahl ?? ""}
                              disabled={!canEdit}
                              className="w-16"
                              onBlur={(e) => abschnittAendern(a.id, "reihen_anzahl", e.target.value)}
                            />
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              <input
                                ref={(el) => {
                                  laengeRefs.current[a.id] = el;
                                }}
                                type="number"
                                step="0.01"
                                defaultValue={a.reihenlaenge_m ?? ""}
                                disabled={!canEdit}
                                className="w-20"
                                onBlur={(e) => abschnittAendern(a.id, "reihenlaenge_m", e.target.value)}
                              />
                              {canEdit && i === 0 && (
                                <button
                                  type="button"
                                  className="text-neutral-400 hover:text-emerald-700"
                                  title="Effektive Durchschnittslänge aus Brutto-Fläche ÷ Reihenabstand ÷ Reihenzahl schätzen - praktisch bei stark verwinkelten Feldern mit vielen unterschiedlich langen Reihen"
                                  onClick={() => laengeAusFlaecheSchaetzen(a, u.flaeche_brutto_ha)}
                                >
                                  📐
                                </button>
                              )}
                              {canEdit && i === 0 && (
                                <button
                                  type="button"
                                  className="text-neutral-400 hover:text-emerald-700"
                                  title="Reihen aus der echten Feldkontur berechnen - eine Ausrichtungslinie einzeichnen, alle parallelen Reihen werden an der Kontur beschnitten (genaue Länge je Reihe statt Schätzung)"
                                  onClick={() => setReihenKarte({ abschnitt: a, feldId: u.feld_id })}
                                >
                                  🧭
                                </button>
                              )}
                            </div>
                            {a.reihenlaenge_min_m != null && a.reihenlaenge_max_m != null && (
                              <div className="text-[10px] text-neutral-400">
                                {formatMenge(a.reihenlaenge_min_m, 1)}–{formatMenge(a.reihenlaenge_max_m, 1)} m
                              </div>
                            )}
                          </td>
                          <td>
                            <input
                              ref={(el) => {
                                abstandRefs.current[a.id] = el;
                              }}
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
                              <td>
                                {u.flaeche_brutto_ha != null ? formatMenge(u.flaeche_brutto_ha, 4) : "—"}
                              </td>
                              <td>{formatMenge(u.netto_ha, 4)}</td>
                              <td>{formatZahlDE(u.anzahl_pflanzen)}</td>
                              <td>
                                <input
                                  type="number"
                                  step="1"
                                  defaultValue={u.ertrag_erwartet ?? ""}
                                  disabled={!canEdit}
                                  className="w-24"
                                  onBlur={(e) => anbauAendern(u.anbau_id, "ertrag_erwartet", e.target.value)}
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
                            <td colSpan={5}></td>
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

      {reihenKarte && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-lg bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-emerald-800">Reihen aus der Feldkontur berechnen</h2>
              <button
                type="button"
                aria-label="Schließen"
                className="text-neutral-500"
                onClick={() => setReihenKarte(null)}
              >
                ✕
              </button>
            </div>
            <ReihenAusrichtungKarte
              feldId={reihenKarte.feldId}
              feldGeometrieGeojson={felderGeo[reihenKarte.feldId] ?? null}
              reihenabstandM={reihenKarte.abschnitt.reihenabstand_m}
              bestehendeLinieGeojson={reihenKarte.abschnitt.ausrichtungslinie_geojson}
              bestehenderVersatzM={reihenKarte.abschnitt.reihen_versatz_m}
              bestehenderErsterIndex={reihenKarte.abschnitt.reihen_erster_index}
              bestehenderLetzterIndex={reihenKarte.abschnitt.reihen_letzter_index}
              bestehendeFahrgassen={reihenKarte.abschnitt.reihen_fahrgassen}
              onUebernehmen={reihenUebernehmen}
            />
          </div>
        </div>
      )}
    </div>
  );
}
