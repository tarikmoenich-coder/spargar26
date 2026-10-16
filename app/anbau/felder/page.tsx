"use client";

// "Anbau → Felder" (Migration 2026-10-19): Stammdaten ALLER Felder,
// kulturübergreifend (vorher nur Erdbeeren, erdbeeren_parzellen). Geometrie
// (Brutto-Fläche) kommt entweder per Import aus Pachtwesen2026 (Knopf unten)
// oder über den Zeichnen-Editor auf der Detail-Seite (Link "Karte" je Zeile)
// - hier bleibt die Liste bewusst schlank: Reihen/Pflanzenzahl/Netto-ha
// ergeben sich aus der Planung je Saison unter "Anbau".

import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import {
  FELD_KULTUREN,
  FELD_KULTUR_LABELS,
  type FeldGeojson,
  type FeldKultur,
} from "@/lib/types";
import { formatMenge, formatZahlDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();

interface PachtwesenSchlag {
  schlag_id: string;
  schlag_name: string;
  hektar: number;
  geometrie_geojson: string;
  geometrie_hash: string;
}

interface PlanungsInfo {
  feld_id: number;
  saison_jahr: number;
  anzahl_abschnitte: number;
  anzahl_pflanzen: number;
}

export default function AnbauFelderPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" || profile?.role === "erntewirtschaft";

  const [felder, setFelder] = useState<FeldGeojson[]>([]);
  const [planung, setPlanung] = useState<Record<number, PlanungsInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const [kulturFilter, setKulturFilter] = useState<FeldKultur | "">("");

  const [neuName, setNeuName] = useState("");
  const [neuKultur, setNeuKultur] = useState<FeldKultur | "">("");
  const [laeuft, setLaeuft] = useState(false);

  // Import aus Pachtwesen2026 (Phase 2, Migration 2026-10-19) - Schlag-Ebene,
  // einmal pro Saison anstoßbar. Lässt eine bereits in spargar26 verfeinerte
  // Geometrie unangetastet, wenn sich am Schlag nichts geändert hat.
  const [importJahr, setImportJahr] = useState(CURRENT_YEAR);
  const [importLaeuft, setImportLaeuft] = useState(false);
  const [importMeldung, setImportMeldung] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: fData }, { data: pData }] = await Promise.all([
      supabase.from("feld_geojson").select("*").order("bezeichnung"),
      supabase
        .from("feld_anbau_uebersicht")
        .select("feld_id, saison_jahr, anzahl_abschnitte, anzahl_pflanzen"),
    ]);
    setFelder((fData as FeldGeojson[]) ?? []);
    const pMap: Record<number, PlanungsInfo[]> = {};
    ((pData as PlanungsInfo[]) ?? []).forEach((p) => {
      if (!pMap[p.feld_id]) pMap[p.feld_id] = [];
      pMap[p.feld_id].push(p);
    });
    Object.values(pMap).forEach((liste) =>
      liste.sort((a, b) => b.saison_jahr - a.saison_jahr)
    );
    setPlanung(pMap);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function anlegen() {
    if (!neuName.trim()) {
      setFehler("Bezeichnung ist ein Pflichtfeld.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("feld").insert({
      bezeichnung: neuName.trim(),
      kultur: neuKultur || null,
    });
    if (error) {
      setFehler(
        error.message.includes("feld_bezeichnung_key")
          ? "Ein Feld mit dieser Bezeichnung gibt es bereits."
          : error.message
      );
    } else {
      setNeuName("");
      setNeuKultur("");
    }
    setLaeuft(false);
    load();
  }

  async function aendern(
    id: number,
    feld: "bezeichnung" | "kultur" | "aktiv",
    wert: string | boolean
  ) {
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("feld")
      .update({
        [feld]:
          feld === "aktiv" ? wert : String(wert).trim() || null,
      })
      .eq("id", id);
    if (error) setFehler(error.message);
    load();
  }

  async function importierenAusPachtwesen() {
    setImportLaeuft(true);
    setFehler(null);
    setImportMeldung(null);
    try {
      const res = await fetch(`/api/pachtwesen-schlaege?jahr=${importJahr}`);
      const body = await res.json();
      if (!res.ok) {
        setFehler(body.error ?? "Import fehlgeschlagen.");
        return;
      }
      const schlaege: PachtwesenSchlag[] = body.schlaege ?? [];
      const supabase = getSupabaseClient();
      let neu = 0;
      let unveraendert = 0;
      let geaendertReview = 0;
      let fehlgeschlagen = 0;

      for (const s of schlaege) {
        const { data: bestehend } = await supabase
          .from("feld")
          .select("id, pachtwesen_geometrie_hash")
          .eq("pachtwesen_schlag_id", s.schlag_id)
          .maybeSingle();

        if (!bestehend) {
          const { data: neuesFeld, error: insertFehler } = await supabase
            .from("feld")
            .insert({ bezeichnung: s.schlag_name, pachtwesen_schlag_id: s.schlag_id })
            .select("id")
            .single();
          if (insertFehler || !neuesFeld) {
            fehlgeschlagen += 1;
            continue;
          }
          await supabase.rpc("feld_geometrie_setzen", {
            p_feld_id: neuesFeld.id,
            p_geojson: s.geometrie_geojson,
          });
          await supabase
            .from("feld")
            .update({ pachtwesen_geometrie_hash: s.geometrie_hash })
            .eq("id", neuesFeld.id);
          neu += 1;
        } else if (bestehend.pachtwesen_geometrie_hash === s.geometrie_hash) {
          unveraendert += 1;
        } else {
          // Geometrie hat sich am Schlag geändert - NICHT automatisch
          // überschreiben (könnte in spargar26 bereits verfeinert worden
          // sein), stattdessen zur Überprüfung zwischenspeichern.
          await supabase
            .from("feld")
            .update({
              pachtwesen_geometrie_hash_neu: s.geometrie_hash,
              pachtwesen_geometrie_geojson_neu: s.geometrie_geojson,
            })
            .eq("id", bestehend.id);
          geaendertReview += 1;
        }
      }

      setImportMeldung(
        `${neu} neu, ${unveraendert} unverändert, ${geaendertReview} mit Änderung zur Überprüfung` +
          `${fehlgeschlagen > 0 ? `, ${fehlgeschlagen} fehlgeschlagen` : ""}.`
      );
      load();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Import fehlgeschlagen.");
    } finally {
      setImportLaeuft(false);
    }
  }

  async function geometrieUebernehmen(f: FeldGeojson) {
    if (!f.pachtwesen_geometrie_geojson_neu || !f.pachtwesen_geometrie_hash_neu) return;
    setFehler(null);
    const supabase = getSupabaseClient();
    await supabase.rpc("feld_geometrie_setzen", {
      p_feld_id: f.id,
      p_geojson: f.pachtwesen_geometrie_geojson_neu,
    });
    await supabase
      .from("feld")
      .update({
        pachtwesen_geometrie_hash: f.pachtwesen_geometrie_hash_neu,
        pachtwesen_geometrie_hash_neu: null,
        pachtwesen_geometrie_geojson_neu: null,
      })
      .eq("id", f.id);
    load();
  }

  const sichtbar = felder.filter((f) => {
    if (!zeigeInaktive && !f.aktiv) return false;
    if (kulturFilter && f.kultur !== kulturFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div>
        <PageHeader icon={MapPin} titel="Felder" />
        <p className="text-sm text-neutral-500">
          Stammdaten aller Felder – kulturübergreifend. Was darauf wächst,
          steht nicht hier, sondern je Saison unter „Anbau": Abschnitte,
          Sorten und Pflanzenzahlen ergeben sich aus der Planung. Ein Feld
          wird nie gelöscht, sondern auf inaktiv gesetzt, damit die Historie
          und die erfassten Prämien erhalten bleiben.
        </p>
      </div>

      {canEdit && (
        <div className="rounded border border-linie bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-emerald-800">
            Neues Feld anlegen
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Bezeichnung{" "}
              <input
                className="w-40"
                value={neuName}
                onChange={(e) => setNeuName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Kultur{" "}
              <select
                value={neuKultur}
                onChange={(e) =>
                  setNeuKultur(e.target.value as FeldKultur | "")
                }
              >
                <option value="">—</option>
                {FELD_KULTUREN.map((k) => (
                  <option key={k} value={k}>
                    {FELD_KULTUR_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn text-xs"
              disabled={laeuft}
              onClick={anlegen}
            >
              Feld anlegen
            </button>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="rounded border border-linie bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-emerald-800">
            Aus Pachtwesen importieren/aktualisieren
          </h2>
          <p className="mb-2 text-xs text-neutral-500">
            Holt alle selbst bewirtschafteten Schläge der gewählten Saison aus
            Pachtwesen2026 (Name + Geometrie + Hektar). Neue Schläge werden als
            Feld angelegt; bereits importierte Felder bleiben unangetastet,
            solange sich am Schlag nichts geändert hat - bei einer Änderung
            erscheint unten ein Hinweis zum Prüfen statt stillschweigend zu
            überschreiben.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Saison{" "}
              <input
                type="number"
                className="w-24"
                value={importJahr}
                onChange={(e) => setImportJahr(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className="btn text-xs"
              disabled={importLaeuft}
              onClick={importierenAusPachtwesen}
            >
              {importLaeuft ? "Importiere …" : "Importieren/aktualisieren"}
            </button>
          </div>
          {importMeldung && (
            <p className="mt-2 text-sm text-emerald-700">{importMeldung}</p>
          )}
        </div>
      )}

      {fehler && (
        <p className="rounded border border-beere-300 bg-beere-50 p-2 text-sm text-beere-700">
          {fehler}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={zeigeInaktive}
            onChange={(e) => setZeigeInaktive(e.target.checked)}
          />
          auch inaktive anzeigen
        </label>
        <label className="flex items-center gap-1">
          Kultur{" "}
          <select
            value={kulturFilter}
            onChange={(e) => setKulturFilter(e.target.value as FeldKultur | "")}
          >
            <option value="">Alle</option>
            {FELD_KULTUREN.map((k) => (
              <option key={k} value={k}>
                {FELD_KULTUR_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : sichtbar.length === 0 ? (
        <p className="text-neutral-500">Noch keine Felder angelegt.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Bezeichnung</th>
                <th>Kultur</th>
                <th title="Fläche aus der Geometrie (ST_Area), nicht aus der Reihen-Planung">
                  Brutto ha
                </th>
                <th title="In welchen Saisons für dieses Feld eine Planung besteht">
                  Geplant
                </th>
                <th>Aktiv</th>
                <th title="Geometrie aus Pachtwesen2026 importiert?">Herkunft</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sichtbar.map((f) => {
                const p = planung[f.id] ?? [];
                return (
                  <tr key={f.id} className={f.aktiv ? "" : "opacity-50"}>
                    <td>
                      <input
                        defaultValue={f.bezeichnung}
                        disabled={!canEdit}
                        className="w-40"
                        onBlur={(e) => {
                          if (e.target.value.trim() !== f.bezeichnung) {
                            aendern(f.id, "bezeichnung", e.target.value);
                          }
                        }}
                      />
                    </td>
                    <td>
                      <select
                        defaultValue={f.kultur ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => aendern(f.id, "kultur", e.target.value)}
                      >
                        <option value="">—</option>
                        {FELD_KULTUREN.map((k) => (
                          <option key={k} value={k}>
                            {FELD_KULTUR_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-neutral-600">
                      {f.flaeche_brutto_ha != null ? formatMenge(f.flaeche_brutto_ha, 4) : "—"}
                    </td>
                    <td className="text-xs">
                      {p.length === 0 ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        p
                          .map(
                            (x) =>
                              `${x.saison_jahr} (${x.anzahl_abschnitte} Abschnitte, ${formatZahlDE(x.anzahl_pflanzen)} Pfl.)`
                          )
                          .join(" · ")
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={f.aktiv}
                        disabled={!canEdit}
                        onChange={(e) =>
                          aendern(f.id, "aktiv", e.target.checked)
                        }
                      />
                    </td>
                    <td className="text-xs">
                      {f.pachtwesen_geometrie_hash_neu ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="badge badge-warn"
                            title="Der Schlag in Pachtwesen2026 hat sich geändert - diese Übernahme ersetzt die Feld-Geometrie hier."
                          >
                            Quelle geändert
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() => geometrieUebernehmen(f)}
                            >
                              übernehmen
                            </button>
                          )}
                        </span>
                      ) : f.pachtwesen_schlag_id ? (
                        <span className="text-neutral-400">Pachtwesen</span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td>
                      <Link href={`/anbau/felder/${f.id}`} className="text-xs text-emerald-700 underline">
                        Karte
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
