"use client";

// "Anbau → Felder" (Nutzer-Vorgabe 2026-08-11): Stammdaten der Erdbeer-
// Felder. Stand vorher unter "Prämien → Erdbeeren", was seit der
// Anbauplanung nicht mehr passt - dort gehören nur noch die Sätze
// (Norm/Bonus) hin, weil die Planung hier stattfindet.
//
// Bewusst schlank: Name, Größe, aktiv. Sorte und Pflanzenzahl standen
// früher ebenfalls hier - beides ergibt sich jetzt aus der Planung je
// Tunnel und Sorte und wäre als Zweitangabe nur eine zweite Wahrheit.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import AnbauTabs from "@/components/AnbauTabs";
import type { ErdbeerenParzelle } from "@/lib/types";
import { formatZahlDE } from "@/lib/format";

interface PlanungsInfo {
  parzelle_id: number;
  saison_jahr: number;
  anzahl_tunnel: number;
  anzahl_pflanzen: number;
}

export default function AnbauFelderPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" || profile?.role === "erntewirtschaft";

  const [felder, setFelder] = useState<ErdbeerenParzelle[]>([]);
  const [planung, setPlanung] = useState<Record<number, PlanungsInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zeigeInaktive, setZeigeInaktive] = useState(false);

  const [neuName, setNeuName] = useState("");
  const [neuGroesse, setNeuGroesse] = useState("");
  const [laeuft, setLaeuft] = useState(false);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: fData }, { data: pData }] = await Promise.all([
      supabase.from("erdbeeren_parzellen").select("*").order("name"),
      supabase
        .from("erdbeeren_anbau_uebersicht")
        .select("parzelle_id, saison_jahr, anzahl_tunnel, anzahl_pflanzen"),
    ]);
    setFelder((fData as ErdbeerenParzelle[]) ?? []);
    const pMap: Record<number, PlanungsInfo[]> = {};
    ((pData as PlanungsInfo[]) ?? []).forEach((p) => {
      if (!pMap[p.parzelle_id]) pMap[p.parzelle_id] = [];
      pMap[p.parzelle_id].push(p);
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
      setFehler("Name ist ein Pflichtfeld.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("erdbeeren_parzellen").insert({
      name: neuName.trim(),
      groesse_ha: neuGroesse ? Number(neuGroesse) : null,
    });
    if (error) {
      setFehler(
        error.message.includes("erdbeeren_parzellen_name_key")
          ? "Ein Feld mit diesem Namen gibt es bereits."
          : error.message
      );
    } else {
      setNeuName("");
      setNeuGroesse("");
    }
    setLaeuft(false);
    load();
  }

  async function aendern(
    id: number,
    feld: "name" | "groesse_ha" | "aktiv",
    wert: string | boolean
  ) {
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("erdbeeren_parzellen")
      .update({
        [feld]:
          feld === "groesse_ha"
            ? wert
              ? Number(wert)
              : null
            : feld === "aktiv"
              ? wert
              : String(wert).trim() || null,
      })
      .eq("id", id);
    if (error) setFehler(error.message);
    load();
  }

  const sichtbar = felder.filter((f) => zeigeInaktive || f.aktiv);

  return (
    <div className="flex flex-col gap-4">
      <AnbauTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Felder</h1>
        <p className="text-sm text-neutral-500">
          Stammdaten der Erdbeer-Felder – Name und Größe. Was darauf wächst,
          steht nicht hier, sondern je Saison unter „Erdbeeren": Tunnel,
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
              Name{" "}
              <input
                className="w-40"
                value={neuName}
                onChange={(e) => setNeuName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Größe (ha){" "}
              <input
                type="number"
                step="0.01"
                className="w-24"
                value={neuGroesse}
                onChange={(e) => setNeuGroesse(e.target.value)}
              />
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
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {fehler}
        </p>
      )}

      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={zeigeInaktive}
          onChange={(e) => setZeigeInaktive(e.target.checked)}
        />
        auch inaktive anzeigen
      </label>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : sichtbar.length === 0 ? (
        <p className="text-neutral-500">Noch keine Felder angelegt.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Größe (ha)</th>
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
                        defaultValue={f.name}
                        disabled={!canEdit}
                        className="w-40"
                        onBlur={(e) => {
                          if (e.target.value.trim() !== f.name) {
                            aendern(f.id, "name", e.target.value);
                          }
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={f.groesse_ha ?? ""}
                        disabled={!canEdit}
                        className="w-24"
                        onBlur={(e) =>
                          aendern(f.id, "groesse_ha", e.target.value)
                        }
                      />
                    </td>
                    <td className="text-xs">
                      {p.length === 0 ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        p
                          .map(
                            (x) =>
                              `${x.saison_jahr} (${x.anzahl_tunnel} Tunnel, ${formatZahlDE(x.anzahl_pflanzen)} Pfl.)`
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
