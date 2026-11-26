"use client";

// Öffnungszeiten + Eröffnung/Schluss der Saison eines Stands bearbeiten -
// direkt aus dem Grundplan (Klick auf den Standnamen, Nutzer 2026-11-26),
// damit man dafür nicht zur Ständeliste wechseln muss. Gleiche Regeln wie
// das Stand-Formular in app/vertrieb/page.tsx.

import { useState } from "react";
import { X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { VtHalbtag, VtStand, VtStandSaison, VtStandZeit } from "@/lib/types";
import { HALBTAGE, WOCHENTAGE, zeitInput } from "@/lib/vertrieb";

type ZeitFeld = { offen: boolean; von: string; bis: string };
const STANDARD: Record<VtHalbtag, { von: string; bis: string }> = {
  VM: { von: "08:00", bis: "13:00" },
  NM: { von: "13:00", bis: "18:00" },
};
const k = (tag: number, h: VtHalbtag) => `${tag}-${h}`;

export default function StandZeitenDialog({
  stand,
  zeiten,
  standSaison,
  saison,
  onSchliessen,
  onGespeichert,
}: {
  stand: VtStand;
  zeiten: VtStandZeit[]; // alle (werden auf den Stand gefiltert)
  standSaison: VtStandSaison | undefined;
  saison: number;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const [raster, setRaster] = useState<Record<string, ZeitFeld>>(() => {
    const r: Record<string, ZeitFeld> = {};
    for (const t of WOCHENTAGE) for (const h of HALBTAGE) r[k(t.nr, h.wert)] = { offen: false, ...STANDARD[h.wert] };
    for (const z of zeiten.filter((z) => z.stand_id === stand.id)) r[k(z.wochentag, z.halbtag)] = { offen: true, von: zeitInput(z.von), bis: zeitInput(z.bis) };
    return r;
  });
  const [eroeffnung, setEroeffnung] = useState(standSaison?.eroeffnung ?? "");
  const [schluss, setSchluss] = useState(standSaison?.schluss ?? "");
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const setzen = (tag: number, h: VtHalbtag, teil: Partial<ZeitFeld>) => setRaster((r) => ({ ...r, [k(tag, h)]: { ...r[k(tag, h)], ...teil } }));
  function montagUebertragen() {
    setRaster((r) => {
      const n = { ...r };
      for (const tag of [2, 3, 4, 5, 6]) for (const h of HALBTAGE) n[k(tag, h.wert)] = { ...r[k(1, h.wert)] };
      return n;
    });
  }

  async function speichern() {
    setFehler(null);
    if (eroeffnung && schluss && schluss < eroeffnung) return setFehler("„geöffnet bis“ liegt vor „geöffnet ab“.");
    const offen = Object.entries(raster).filter(([, z]) => z.offen);
    for (const [key, z] of offen)
      if (!z.von || !z.bis || z.bis <= z.von) {
        const [tag, h] = key.split("-");
        return setFehler(`${WOCHENTAGE.find((w) => w.nr === Number(tag))!.lang} ${h === "VM" ? "Vormittag" : "Nachmittag"}: „bis“ muss nach „von“ liegen.`);
      }
    setSpeichert(true);
    const sb = getSupabaseClient();
    // Erst geöffnete Halbtage schreiben, dann die übrigen löschen
    const zeilen = offen.map(([key, z]) => {
      const [tag, h] = key.split("-");
      return { stand_id: stand.id, wochentag: Number(tag), halbtag: h, von: z.von, bis: z.bis };
    });
    if (zeilen.length) {
      const up = await sb.from("vt_stand_zeit").upsert(zeilen, { onConflict: "stand_id,wochentag,halbtag" });
      if (up.error) return setSpeichert(false), setFehler(up.error.message);
    }
    const offenKeys = new Set(offen.map(([key]) => key));
    const weg = zeiten.filter((z) => z.stand_id === stand.id && !offenKeys.has(k(z.wochentag, z.halbtag))).map((z) => z.id);
    if (weg.length) {
      const del = await sb.from("vt_stand_zeit").delete().in("id", weg);
      if (del.error) return setSpeichert(false), setFehler(del.error.message);
    }
    if (eroeffnung || schluss) {
      const up = await sb
        .from("vt_stand_saison")
        .upsert(
          { stand_id: stand.id, saison_jahr: saison, eroeffnung: eroeffnung || null, schluss: schluss || null, geaendert_am: new Date().toISOString() },
          { onConflict: "stand_id,saison_jahr" }
        );
      if (up.error) return setSpeichert(false), setFehler(up.error.message);
    } else if (standSaison) {
      const del = await sb.from("vt_stand_saison").delete().eq("id", standSaison.id);
      if (del.error) return setSpeichert(false), setFehler(del.error.message);
    }
    setSpeichert(false);
    onGespeichert();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/30 p-4 print:hidden" onClick={onSchliessen}>
      <div
        className="mt-10 flex w-full max-w-2xl flex-col gap-4 rounded-lg border border-linie bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onSchliessen()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-emerald-900">
              {stand.nummer} {stand.name}
            </h2>
            <p className="text-sm text-neutral-500">Öffnungszeiten und Saison {saison}</p>
          </div>
          <button className="rounded p-1 hover:bg-neutral-100" onClick={onSchliessen} title="schließen (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Saison {saison}: geöffnet ab
            <input type="date" value={eroeffnung} onChange={(e) => setEroeffnung(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            geöffnet bis (letzter Tag)
            <input type="date" value={schluss} onChange={(e) => setSchluss(e.target.value)} />
          </label>
          <p className="text-xs text-neutral-500 sm:col-span-2">
            Leer lassen = ganze Saison. Vorher/nachher ist der Stand in Woche und Tagesplan zu und fällt aus seiner Tour.
          </p>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Öffnungszeiten</h3>
            <button type="button" className="btn-secondary text-xs" onClick={montagUebertragen}>
              Montag auf Di–Sa übertragen
            </button>
          </div>
          <table className="text-sm">
            <thead>
              <tr>
                <th>Tag</th>
                {HALBTAGE.map((h) => (
                  <th key={h.wert}>{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WOCHENTAGE.map((t) => (
                <tr key={t.nr}>
                  <td className="font-medium">{t.kurz}</td>
                  {HALBTAGE.map((h) => {
                    const z = raster[k(t.nr, h.wert)];
                    return (
                      <td key={h.wert}>
                        <div className="flex items-center gap-1.5">
                          <input type="checkbox" title="geöffnet" checked={z.offen} onChange={(e) => setzen(t.nr, h.wert, { offen: e.target.checked })} />
                          <input type="time" className="w-24" disabled={!z.offen} value={z.von} onChange={(e) => setzen(t.nr, h.wert, { von: e.target.value })} />
                          <span className="text-neutral-400">–</span>
                          <input type="time" className="w-24" disabled={!z.offen} value={z.bis} onChange={(e) => setzen(t.nr, h.wert, { bis: e.target.value })} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-neutral-500">
            Halbtag abwählen = geschlossen. Wer dort im Grundplan eingeplant ist, bleibt stehen und wird als Hinweis angezeigt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={speichern} disabled={speichert}>
            {speichert ? "Speichert…" : "Speichern"}
          </button>
          <button className="btn-secondary" onClick={onSchliessen}>
            Abbrechen
          </button>
          {fehler && <span className="text-sm text-beere-600">{fehler}</span>}
        </div>
      </div>
    </div>
  );
}
