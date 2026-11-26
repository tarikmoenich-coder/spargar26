"use client";

// Vertriebsplanung: Stände auf der Karte. Position jedes Stands auf dem
// Luftbild von Hand setzen (Punkt ziehen oder in die Karte klicken) und den
// Radius der Standzone einstellen - Grundlage für die GPS-Auswertung
// (Nutzer-Wunsch 2026-11-25). Lesen: Bereich Vertrieb (vt_darf()).
// Position/Radius setzen nur Admin und Management (Nutzer 2026-11-26) über
// rpc vt_stand_position_setzen (Migration 2026-11-26).

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import PageHeader from "@/components/PageHeader";
import VertriebTabs from "@/components/VertriebTabs";
import type { StandEntwurf } from "@/components/StandKarte";
import type { VtStand } from "@/lib/types";

const StandKarte = dynamic(() => import("@/components/StandKarte"), {
  ssr: false,
  loading: () => <div className="h-[70vh] animate-pulse rounded bg-neutral-100" />,
});

const RADIUS_MIN = 10;
const RADIUS_MAX = 2000;

export default function VertriebKartePage() {
  const { profile } = useProfile();
  const darfPflegen = hatRolle(profile, "admin", "management");

  const [staende, setStaende] = useState<VtStand[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [nurOhnePos, setNurOhnePos] = useState(false);

  const [auswahlId, setAuswahlId] = useState<number | null>(null);
  const [entwurf, setEntwurf] = useState<StandEntwurf | null>(null);
  const [fokus, setFokus] = useState<{ lat: number; lng: number; zoom: number; ts: number } | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await getSupabaseClient().from("vt_stand").select("*").order("nummer");
    setFehler(error ? error.message : null);
    setStaende((data as VtStand[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ?stand=<id> aus der Ständeliste
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("stand"));
    if (id && staende.some((s) => s.id === id) && auswahlId === null) waehlen(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staende]);

  const auswahl = staende.find((s) => s.id === auswahlId) ?? null;
  const geaendert =
    !!auswahl &&
    !!entwurf &&
    (entwurf.lat !== auswahl.lat || entwurf.lng !== auswahl.lng || entwurf.radius_m !== auswahl.radius_m);

  const ohnePos = staende.filter((s) => s.lat === null || s.lng === null).length;

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return staende.filter(
      (s) =>
        (!nurOhnePos || s.lat === null || s.lng === null) &&
        (!q ||
          String(s.nummer) === q ||
          s.name.toLowerCase().includes(q) ||
          (s.adresse ?? "").toLowerCase().includes(q))
    );
  }, [staende, suche, nurOhnePos]);

  async function waehlen(id: number) {
    if (id === auswahlId) return;
    if (geaendert && !confirm("Die Änderung am bisher gewählten Stand ist noch nicht gespeichert. Verwerfen?")) return;
    const s = staende.find((x) => x.id === id);
    if (!s) return;
    setAuswahlId(id);
    setEntwurf({ lat: s.lat, lng: s.lng, radius_m: s.radius_m });
    setHinweis(null);
    if (s.lat !== null && s.lng !== null) {
      setFokus({ lat: s.lat, lng: s.lng, zoom: 18, ts: Date.now() });
      return;
    }
    // Ohne Position: zur Adresse fliegen (nur Kartenausschnitt, nichts wird gesetzt)
    setHinweis(
      darfPflegen
        ? "Noch keine Position - in die Karte klicken, wo der Stand steht."
        : "Für diesen Stand ist noch keine Position hinterlegt."
    );
    // ohne Adresse (Stand ohne Google-Profil): nach dem Namen = Ort suchen
    const suchtext = s.adresse || s.name;
    try {
      const p = new URLSearchParams({ q: suchtext, countrycodes: "de", format: "jsonv2", limit: "1" });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${p.toString()}`);
      const d = res.ok ? ((await res.json()) as { lat: string; lon: string; place_rank?: number }[]) : [];
      if (d.length) {
        setFokus({
          lat: Number(d[0].lat),
          lng: Number(d[0].lon),
          zoom: (d[0].place_rank ?? 0) >= 26 ? 18 : 14,
          ts: Date.now(),
        });
      }
    } catch {
      // Adresse nicht gefunden - Nutzer navigiert selbst
    }
  }

  function positionSetzen(lat: number, lng: number) {
    if (!darfPflegen) return;
    setEntwurf((e) => ({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      radius_m: e?.radius_m ?? auswahl?.radius_m ?? 100,
    }));
    setHinweis(null);
  }

  function radiusSetzen(wert: string) {
    const r = Math.round(Number(wert));
    if (!Number.isFinite(r)) return;
    setEntwurf((e) => (e ? { ...e, radius_m: r } : e));
  }

  async function speichern() {
    if (!auswahl || !entwurf) return;
    const r = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, entwurf.radius_m));
    setSpeichert(true);
    const { error } = await getSupabaseClient().rpc("vt_stand_position_setzen", {
      p_stand_id: auswahl.id,
      p_lat: entwurf.lat,
      p_lng: entwurf.lng,
      p_radius_m: r,
    });
    setSpeichert(false);
    if (error) {
      setFehler(`Speichern: ${error.message}`);
      return;
    }
    setFehler(null);
    setStaende((alt) =>
      alt.map((s) => (s.id === auswahl.id ? { ...s, lat: entwurf.lat, lng: entwurf.lng, radius_m: r } : s))
    );
    setEntwurf({ ...entwurf, radius_m: r });
  }

  function verwerfen() {
    if (!auswahl) return;
    setEntwurf({ lat: auswahl.lat, lng: auswahl.lng, radius_m: auswahl.radius_m });
    if (auswahl.lat !== null && auswahl.lng !== null) {
      setFokus({ lat: auswahl.lat, lng: auswahl.lng, zoom: 18, ts: Date.now() });
    }
  }

  function naechsterOhnePos() {
    const start = auswahl ? staende.findIndex((s) => s.id === auswahl.id) : -1;
    const reihe = [...staende.slice(start + 1), ...staende.slice(0, start + 1)];
    const n = reihe.find((s) => (s.lat === null || s.lng === null) && s.id !== auswahlId);
    if (n) waehlen(n.id);
  }

  return (
    <div className="space-y-4">
      <VertriebTabs />
      <PageHeader
        icon={MapPin}
        titel="Stände auf der Karte"
        beschreibung={
          darfPflegen
            ? "Stand in der Liste oder auf der Karte anklicken, dann den Punkt an die richtige Stelle ziehen oder in die Karte klicken. Der Kreis ist die Standzone für die GPS-Auswertung - Radius mit dem Regler einstellen. Kartenhintergrund oben rechts umschalten (Satellit, Luftbild Hessen, Straßenkarte)."
            : "Lage und Standzone (Kreis) der Verkaufsstände."
        }
        aktionen={
          <Link href="/vertrieb" className="btn-secondary">
            ← Ständeliste
          </Link>
        }
      />

      {fehler && <p className="text-sm text-beere-600">{fehler}</p>}

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-3">
          {auswahl && entwurf && (
            <div className="card space-y-3">
              <div>
                <div className="text-xs text-neutral-500">Stand {auswahl.nummer}</div>
                <div className="font-semibold">{auswahl.name}</div>
                {auswahl.adresse && <div className="text-sm text-neutral-600">{auswahl.adresse}</div>}
              </div>
              {hinweis && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">{hinweis}</p>}
              <div className="text-sm tabular-nums text-neutral-600">
                {entwurf.lat !== null && entwurf.lng !== null
                  ? `${entwurf.lat.toFixed(6)}, ${entwurf.lng.toFixed(6)}`
                  : "keine Position"}
              </div>
              <label className="block text-sm">
                <span className="flex items-center justify-between">
                  <span>Radius</span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      className="w-20"
                      min={RADIUS_MIN}
                      max={RADIUS_MAX}
                      value={entwurf.radius_m}
                      disabled={!darfPflegen}
                      onChange={(e) => radiusSetzen(e.target.value)}
                    />
                    m
                  </span>
                </span>
                <input
                  type="range"
                  className="mt-2 w-full"
                  min={RADIUS_MIN}
                  max={300}
                  step={5}
                  value={Math.min(entwurf.radius_m, 300)}
                  disabled={!darfPflegen}
                  onChange={(e) => radiusSetzen(e.target.value)}
                />
              </label>
              {darfPflegen && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn" onClick={speichern} disabled={!geaendert || speichert || entwurf.lat === null}>
                    {speichert ? "Speichert…" : "Speichern"}
                  </button>
                  <button className="btn-secondary" onClick={verwerfen} disabled={!geaendert}>
                    Verwerfen
                  </button>
                </div>
              )}
              {darfPflegen && ohnePos > 0 && (
                <button className="text-sm text-emerald-700 underline" onClick={naechsterOhnePos}>
                  Nächster Stand ohne Position →
                </button>
              )}
            </div>
          )}

          <div className="card space-y-2">
            <input
              type="search"
              className="w-full"
              placeholder="Nr., Name oder Adresse"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={nurOhnePos} onChange={(e) => setNurOhnePos(e.target.checked)} />
              nur ohne Position ({ohnePos})
            </label>
            <ul className="max-h-[50vh] divide-y divide-linie overflow-y-auto text-sm">
              {sichtbar.map((s) => (
                <li key={s.id}>
                  <button
                    className={`flex w-full items-baseline gap-2 px-1 py-1.5 text-left hover:bg-sand ${
                      s.id === auswahlId ? "bg-beere-50 font-medium" : ""
                    }`}
                    onClick={() => waehlen(s.id)}
                  >
                    <span className="w-8 shrink-0 tabular-nums text-neutral-500">{s.nummer}</span>
                    <span className="flex-1">
                      {s.name}
                      {!s.aktiv && <span className="ml-1 text-xs text-neutral-400">inaktiv</span>}
                    </span>
                    {s.lat === null || s.lng === null ? (
                      <span className="badge-warn">fehlt</span>
                    ) : (
                      <span className="text-xs text-neutral-400">{s.radius_m} m</span>
                    )}
                  </button>
                </li>
              ))}
              {sichtbar.length === 0 && <li className="py-2 text-neutral-500">Keine Stände.</li>}
            </ul>
          </div>
        </div>

        <StandKarte
          staende={staende}
          auswahlId={auswahlId}
          entwurf={entwurf}
          bearbeitbar={darfPflegen}
          fokus={fokus}
          onWaehlen={waehlen}
          onPosition={positionSetzen}
        />
      </div>
    </div>
  );
}
