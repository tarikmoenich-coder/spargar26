"use client";

// Vertrieb → Stände (Vertriebsplanung V1, docs/vertriebsplanung-plan.md).
// Stammdaten der Verkaufsstände mit Öffnungszeiten je Wochentag und Halbtag
// (Vormittag/Nachmittag). Uhrzeiten sind je Stand UND je Wochentag
// verschieden (Nutzer-Vorgabe 2026-11-25). Rechte: lesen admin/hr/
// lohnabrechnung/management/pruefer, pflegen admin/hr - jeweils nur mit
// Bereich Vertrieb (vt_darf()).

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Store } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleMitFehler } from "@/lib/ladeAlle";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import VertriebTabs from "@/components/VertriebTabs";
import type { VtHalbtag, VtStand, VtStandZeit, VtTour, VtTourStand } from "@/lib/types";
import {
  HALBTAGE,
  WOCHENTAGE,
  koordinatenLesen,
  zeitInput,
  zeitKurz,
} from "@/lib/vertrieb";

type ZeitFeld = { offen: boolean; von: string; bis: string };
type ZeitRaster = Record<string, ZeitFeld>; // Schlüssel "1-VM"

interface StandForm {
  nummer: string;
  name: string;
  adresse: string;
  koordinaten: string;
  radius_m: string;
  aktiv: boolean;
  notiz: string;
  zeiten: ZeitRaster;
}

const STANDARD_ZEIT: Record<VtHalbtag, { von: string; bis: string }> = {
  VM: { von: "08:00", bis: "13:00" },
  NM: { von: "13:00", bis: "18:00" },
};

function schluessel(tag: number, halbtag: VtHalbtag) {
  return `${tag}-${halbtag}`;
}

function leeresRaster(): ZeitRaster {
  const r: ZeitRaster = {};
  for (const t of WOCHENTAGE)
    for (const h of HALBTAGE) r[schluessel(t.nr, h.wert)] = { offen: false, ...STANDARD_ZEIT[h.wert] };
  return r;
}

function leereForm(naechsteNummer: number): StandForm {
  return {
    nummer: String(naechsteNummer),
    name: "",
    adresse: "",
    koordinaten: "",
    radius_m: "100",
    aktiv: true,
    notiz: "",
    zeiten: leeresRaster(),
  };
}

function ausStand(s: VtStand, zeiten: VtStandZeit[]): StandForm {
  const raster = leeresRaster();
  for (const z of zeiten.filter((z) => z.stand_id === s.id))
    raster[schluessel(z.wochentag, z.halbtag)] = { offen: true, von: zeitInput(z.von), bis: zeitInput(z.bis) };
  return {
    nummer: String(s.nummer),
    name: s.name,
    adresse: s.adresse ?? "",
    koordinaten: s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : "",
    radius_m: String(s.radius_m),
    aktiv: s.aktiv,
    notiz: s.notiz ?? "",
    zeiten: raster,
  };
}

export default function VertriebStaendePage() {
  const { profile } = useProfile();
  const darfPflegen = hatRolle(profile, "admin", "hr");

  const [staende, setStaende] = useState<VtStand[]>([]);
  const [zeiten, setZeiten] = useState<VtStandZeit[]>([]);
  const [touren, setTouren] = useState<VtTour[]>([]);
  const [tourStaende, setTourStaende] = useState<VtTourStand[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [nurAktive, setNurAktive] = useState(true);

  // Bearbeiten: null = zu, "neu" = Neuanlage, sonst id
  const [bearbeite, setBearbeite] = useState<number | "neu" | null>(null);
  const [form, setForm] = useState<StandForm>(leereForm(1));
  const [speichert, setSpeichert] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabaseClient();
    const [s, z, t, ts] = await Promise.all([
      sb.from("vt_stand").select("*").order("nummer"),
      ladeAlleMitFehler<VtStandZeit>((von, bis) => sb.from("vt_stand_zeit").select("*").order("id").range(von, bis)),
      sb.from("vt_tour").select("*").order("nummer"),
      sb.from("vt_tour_stand").select("*"),
    ]);
    const err = s.error ?? z.error ?? t.error ?? ts.error;
    setFehler(err ? err.message : null);
    setStaende((s.data as VtStand[]) ?? []);
    setZeiten((z.data as VtStandZeit[]) ?? []);
    setTouren((t.data as VtTour[]) ?? []);
    setTourStaende((ts.data as VtTourStand[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const zeitenJeStand = useMemo(() => {
    const m = new Map<number, Map<string, VtStandZeit>>();
    for (const z of zeiten) {
      if (!m.has(z.stand_id)) m.set(z.stand_id, new Map());
      m.get(z.stand_id)!.set(schluessel(z.wochentag, z.halbtag), z);
    }
    return m;
  }, [zeiten]);

  const tourVon = useCallback(
    (standId: number, tagesart: "MO_SA" | "SO") => {
      const ts = tourStaende.find((x) => x.stand_id === standId && x.tagesart === tagesart);
      if (!ts) return null;
      const t = touren.find((x) => x.id === ts.tour_id);
      return t ? { tour: t, pos: ts.reihenfolge, nurWare: ts.nur_ware } : null;
    },
    [tourStaende, touren]
  );

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return staende.filter(
      (s) =>
        (!nurAktive || s.aktiv) &&
        (!q ||
          String(s.nummer) === q ||
          s.name.toLowerCase().includes(q) ||
          (s.adresse ?? "").toLowerCase().includes(q))
    );
  }, [staende, suche, nurAktive]);

  function neu() {
    const max = staende.reduce((m, s) => Math.max(m, s.nummer), 0);
    setForm(leereForm(max + 1));
    setFormFehler(null);
    setBearbeite("neu");
  }

  function bearbeiten(s: VtStand) {
    setForm(ausStand(s, zeiten));
    setFormFehler(null);
    setBearbeite(s.id);
  }

  function zeitSetzen(tag: number, halbtag: VtHalbtag, teil: Partial<ZeitFeld>) {
    const k = schluessel(tag, halbtag);
    setForm((f) => ({ ...f, zeiten: { ...f.zeiten, [k]: { ...f.zeiten[k], ...teil } } }));
  }

  // Montag auf Dienstag-Samstag übertragen (Sonntag bleibt eigen).
  function montagUebertragen() {
    setForm((f) => {
      const z = { ...f.zeiten };
      for (const tag of [2, 3, 4, 5, 6])
        for (const h of HALBTAGE) z[schluessel(tag, h.wert)] = { ...f.zeiten[schluessel(1, h.wert)] };
      return { ...f, zeiten: z };
    });
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    setFormFehler(null);
    const nummer = Number(form.nummer);
    if (!Number.isInteger(nummer) || nummer <= 0) return setFormFehler("Standnummer muss eine positive ganze Zahl sein.");
    if (!form.name.trim()) return setFormFehler("Name fehlt.");
    let koord: { lat: number; lng: number } | null = null;
    if (form.koordinaten.trim()) {
      koord = koordinatenLesen(form.koordinaten);
      if (!koord) return setFormFehler('Koordinaten nicht lesbar - bitte als "50.123, 8.654" eingeben.');
    }
    const offen = Object.entries(form.zeiten).filter(([, z]) => z.offen);
    for (const [k, z] of offen) {
      if (!z.von || !z.bis || z.bis <= z.von) {
        const [tag, h] = k.split("-");
        const tn = WOCHENTAGE.find((w) => w.nr === Number(tag))!.lang;
        return setFormFehler(`${tn} ${h === "VM" ? "Vormittag" : "Nachmittag"}: "bis" muss nach "von" liegen.`);
      }
    }

    setSpeichert(true);
    const sb = getSupabaseClient();
    const daten = {
      nummer,
      name: form.name.trim(),
      adresse: form.adresse.trim() || null,
      lat: koord?.lat ?? null,
      lng: koord?.lng ?? null,
      radius_m: Number(form.radius_m) || 100,
      aktiv: form.aktiv,
      notiz: form.notiz.trim() || null,
    };
    const res =
      bearbeite === "neu"
        ? await sb.from("vt_stand").insert(daten).select("id").single()
        : await sb.from("vt_stand").update(daten).eq("id", bearbeite as number).select("id").single();
    if (res.error) {
      setSpeichert(false);
      return setFormFehler(
        res.error.code === "23505" ? `Standnummer ${nummer} ist schon vergeben.` : res.error.message
      );
    }
    const standId = (res.data as { id: number }).id;

    // Öffnungszeiten: erst geöffnete Halbtage schreiben, dann die übrigen
    // löschen - schlägt das Schreiben fehl, bleibt der alte Stand erhalten.
    const zeilen = offen.map(([k, z]) => {
      const [tag, h] = k.split("-");
      return { stand_id: standId, wochentag: Number(tag), halbtag: h, von: z.von, bis: z.bis };
    });
    if (zeilen.length) {
      const up = await sb.from("vt_stand_zeit").upsert(zeilen, { onConflict: "stand_id,wochentag,halbtag" });
      if (up.error) {
        setSpeichert(false);
        return setFormFehler(`Stand gespeichert, Öffnungszeiten nicht: ${up.error.message}`);
      }
    }
    const offenKeys = new Set(offen.map(([k]) => k));
    const weg = zeiten
      .filter((z) => z.stand_id === standId && !offenKeys.has(schluessel(z.wochentag, z.halbtag)))
      .map((z) => z.id);
    if (weg.length) {
      const del = await sb.from("vt_stand_zeit").delete().in("id", weg);
      if (del.error) {
        setSpeichert(false);
        return setFormFehler(`Geschlossene Halbtage nicht entfernt: ${del.error.message}`);
      }
    }
    setSpeichert(false);
    setBearbeite(null);
    load();
  }

  async function loeschen() {
    if (typeof bearbeite !== "number") return;
    const s = staende.find((x) => x.id === bearbeite);
    if (!s) return;
    if (!confirm(`Stand ${s.nummer} "${s.name}" endgültig löschen? (Besser: auf inaktiv setzen.)`)) return;
    const { error } = await getSupabaseClient().from("vt_stand").delete().eq("id", s.id);
    if (error) return setFormFehler(error.message);
    setBearbeite(null);
    load();
  }

  const formular = bearbeite !== null && darfPflegen && (
    <form onSubmit={speichern} className="card flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-emerald-900">
          {bearbeite === "neu" ? "Neuer Stand" : `Stand ${form.nummer} bearbeiten`}
        </h2>
        <button type="button" className="btn-secondary" onClick={() => setBearbeite(null)}>
          Schließen
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Nr.
          <input type="number" min={1} required value={form.nummer} onChange={(e) => setForm({ ...form, nummer: e.target.value })} />
        </label>
        <label className="col-span-1 flex flex-col gap-1 text-sm sm:col-span-3">
          Name
          <input required placeholder="z.B. Darmstadt Rewe" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          Adresse
          <input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Koordinaten
          <input
            placeholder="50.123, 8.654"
            title="Aus Google Maps: Rechtsklick auf den Stand -> Koordinaten kopieren"
            value={form.koordinaten}
            onChange={(e) => setForm({ ...form, koordinaten: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          GPS-Radius (m)
          <input type="number" min={10} max={2000} value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: e.target.value })} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-3">
          Notiz
          <input value={form.notiz} onChange={(e) => setForm({ ...form, notiz: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={form.aktiv} onChange={(e) => setForm({ ...form, aktiv: e.target.checked })} />
          aktiv
        </label>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Öffnungszeiten</h3>
          <button type="button" className="btn-secondary text-xs" onClick={montagUebertragen}>
            Montag auf Di–Sa übertragen
          </button>
        </div>
        <div className="overflow-x-auto">
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
                    const z = form.zeiten[schluessel(t.nr, h.wert)];
                    return (
                      <td key={h.wert}>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            title="geöffnet"
                            checked={z.offen}
                            onChange={(e) => zeitSetzen(t.nr, h.wert, { offen: e.target.checked })}
                          />
                          <input
                            type="time"
                            className="w-24"
                            disabled={!z.offen}
                            value={z.von}
                            onChange={(e) => zeitSetzen(t.nr, h.wert, { von: e.target.value })}
                          />
                          <span className="text-neutral-400">–</span>
                          <input
                            type="time"
                            className="w-24"
                            disabled={!z.offen}
                            value={z.bis}
                            onChange={(e) => zeitSetzen(t.nr, h.wert, { bis: e.target.value })}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn" disabled={speichert}>
          {speichert ? "Speichert…" : "Speichern"}
        </button>
        {bearbeite !== "neu" && (
          <button type="button" className="btn-danger" onClick={loeschen}>
            Löschen
          </button>
        )}
        {formFehler && <span className="text-sm text-beere-600">{formFehler}</span>}
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-6">
      <VertriebTabs />
      <PageHeader
        icon={Store}
        titel="Stände"
        beschreibung="Verkaufsstände mit Öffnungszeiten je Wochentag (Vormittag / Nachmittag) und Tour-Zuordnung."
        aktionen={
          darfPflegen && (
            <div className="flex flex-wrap gap-2">
              <Link href="/vertrieb/import" className="btn-secondary">
                Ständeliste importieren
              </Link>
              <button className="btn" onClick={neu}>
                Neuer Stand
              </button>
            </div>
          )
        }
      />

      {fehler && <p className="text-sm text-beere-600">{fehler}</p>}
      {bearbeite === "neu" && formular}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input placeholder="Suchen (Nr., Name, Adresse)" value={suche} onChange={(e) => setSuche(e.target.value)} />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={nurAktive} onChange={(e) => setNurAktive(e.target.checked)} />
          nur aktive
        </label>
        <span className="text-neutral-500">
          {sichtbar.length} von {staende.length} Ständen
        </span>
      </div>

      {!loading && staende.length === 0 ? (
        <EmptyState
          icon={Store}
          text="Noch keine Stände angelegt."
          hinweis={darfPflegen ? "Ständeliste aus dem Google-Unternehmensprofil importieren oder Stände einzeln anlegen." : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Name</th>
                <th>Tour Mo–Sa</th>
                <th>Tour So</th>
                {WOCHENTAGE.map((t) => (
                  <th key={t.nr} className="text-center">
                    {t.kurz}
                  </th>
                ))}
                <th>GPS</th>
                {darfPflegen && <th></th>}
              </tr>
            </thead>
            <tbody>
              {sichtbar.map((s) => {
                const zs = zeitenJeStand.get(s.id);
                const tourZelle = (ta: "MO_SA" | "SO") => {
                  const t = tourVon(s.id, ta);
                  return t ? (
                    <span>
                      Tour {t.tour.nummer}
                      <span className="text-neutral-500"> · {t.pos}.</span>
                      {t.nurWare && <span className="badge-neutral ml-1">nur Ware</span>}
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  );
                };
                return (
                  <Fragment key={s.id}>
                    <tr className={s.aktiv ? "" : "opacity-50"}>
                      <td className="font-medium">{s.nummer}</td>
                      <td>
                        <div>{s.name}</div>
                        {s.adresse && <div className="text-xs text-neutral-500">{s.adresse}</div>}
                      </td>
                      <td className="whitespace-nowrap">{tourZelle("MO_SA")}</td>
                      <td className="whitespace-nowrap">{tourZelle("SO")}</td>
                      {WOCHENTAGE.map((t) => (
                        <td key={t.nr} className="whitespace-nowrap text-center text-xs leading-tight">
                          {HALBTAGE.map((h) => {
                            const z = zs?.get(schluessel(t.nr, h.wert));
                            return (
                              <div key={h.wert} className={z ? "" : "text-neutral-300"}>
                                {z ? `${zeitKurz(z.von)}–${zeitKurz(z.bis)}` : "zu"}
                              </div>
                            );
                          })}
                        </td>
                      ))}
                      <td>
                        <Link href={`/vertrieb/karte?stand=${s.id}`} title="Auf der Karte zeigen und Position setzen">
                          {s.lat != null ? (
                            <span className="badge-ok">✓ Karte</span>
                          ) : (
                            <span className="badge-warn" title="Koordinaten fehlen - nötig für die GPS-Auswertung">
                              fehlt
                            </span>
                          )}
                        </Link>
                      </td>
                      {darfPflegen && (
                        <td>
                          <button className="btn-secondary" onClick={() => bearbeiten(s)}>
                            Bearbeiten
                          </button>
                        </td>
                      )}
                    </tr>
                    {bearbeite === s.id && (
                      <tr>
                        <td colSpan={darfPflegen ? 13 : 12}>{formular}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
