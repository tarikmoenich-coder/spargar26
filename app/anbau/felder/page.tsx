"use client";

// "Anbau → Felder" (Migration 2026-10-19): Stammdaten ALLER Felder,
// kulturübergreifend (vorher nur Erdbeeren, erdbeeren_parzellen). Geometrie
// (Brutto-Fläche, Pachtwesen2026-Import) kommt in einer späteren Ausbaustufe
// dazu - hier erstmal Bezeichnung/Kultur/Status, wie zuvor bewusst schlank:
// Reihen/Pflanzenzahl/Netto-ha ergeben sich aus der Planung je Saison unter
// "Anbau".

import PageHeader from "@/components/PageHeader";
import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import {
  FELD_KULTUREN,
  FELD_KULTUR_LABELS,
  type Feld,
  type FeldKultur,
} from "@/lib/types";
import { formatZahlDE } from "@/lib/format";

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

  const [felder, setFelder] = useState<Feld[]>([]);
  const [planung, setPlanung] = useState<Record<number, PlanungsInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const [kulturFilter, setKulturFilter] = useState<FeldKultur | "">("");

  const [neuName, setNeuName] = useState("");
  const [neuKultur, setNeuKultur] = useState<FeldKultur | "">("");
  const [laeuft, setLaeuft] = useState(false);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: fData }, { data: pData }] = await Promise.all([
      supabase.from("feld").select("*").order("bezeichnung"),
      supabase
        .from("feld_anbau_uebersicht")
        .select("feld_id, saison_jahr, anzahl_abschnitte, anzahl_pflanzen"),
    ]);
    setFelder((fData as Feld[]) ?? []);
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
                <th title="In welchen Saisons für dieses Feld eine Planung besteht">
                  Geplant
                </th>
                <th>Aktiv</th>
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
