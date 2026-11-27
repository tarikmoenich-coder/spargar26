"use client";

// Vertriebsplanung: Stände auf der Karte. Position jedes Stands auf dem
// Luftbild von Hand setzen (Punkt ziehen oder in die Karte klicken) und den
// Radius der Standzone einstellen - Grundlage für die GPS-Auswertung
// (Nutzer-Wunsch 2026-11-25). Lesen: Bereich Vertrieb (vt_darf()).
// Position/Radius setzen nur Admin und Management (Nutzer 2026-11-26) über
// rpc vt_stand_position_setzen (Migration 2026-11-26).

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Car, MapPin } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { darf } from "@/lib/rollen";
import PageHeader from "@/components/PageHeader";
import VertriebTabs from "@/components/VertriebTabs";
import type { KartenFokus, StandEntwurf, TourLinie } from "@/components/StandKarte";
import type { VtGrundplan, VtStand, VtStandZeit, VtTagesart, VtTour, VtTourStand } from "@/lib/types";
import { ladeAlleMitFehler } from "@/lib/ladeAlle";
import { TAGESARTEN, WOCHENTAGE, fahrerStandId, planungsSaison } from "@/lib/vertrieb";

const StandKarte = dynamic(() => import("@/components/StandKarte"), {
  ssr: false,
  loading: () => <div className="h-[70vh] animate-pulse rounded bg-neutral-100" />,
});

// Tourfarben (bewusst ohne Rot - Rot = ausgewählter Stand, Grün = Standard)
const TOUR_FARBEN = ["#2563eb", "#ea580c", "#9333ea", "#0d9488", "#ca8a04", "#4f46e5", "#65a30d", "#0891b2", "#a16207", "#7c3aed", "#475569", "#be185d"];
const OHNE_TOUR_FARBE = "#9ca3af";

function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Öffnungstage kompakt: "Mo–Fr VM+NM · Sa VM"
function oeffnungText(zeiten: VtStandZeit[]): string {
  const muster = WOCHENTAGE.map((w) => {
    const h = ["VM", "NM"].filter((x) => zeiten.some((z) => z.wochentag === w.nr && z.halbtag === x));
    return { kurz: w.kurz, m: h.join("+") };
  });
  const teile: string[] = [];
  let i = 0;
  while (i < muster.length) {
    let j = i;
    while (j + 1 < muster.length && muster[j + 1].m === muster[i].m) j++;
    if (muster[i].m) teile.push(`${muster[i].kurz}${j > i ? `–${muster[j].kurz}` : ""} ${muster[i].m}`);
    i = j + 1;
  }
  return teile.length ? teile.join(" · ") : "keine Öffnungszeiten";
}

const RADIUS_MIN = 10;
const RADIUS_MAX = 2000;

export default function VertriebKartePage() {
  const { profile } = useProfile();
  const darfPflegen = darf(profile, "vertrieb.planung:S");

  const [staende, setStaende] = useState<VtStand[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [nurOhnePos, setNurOhnePos] = useState(false);

  const [auswahlId, setAuswahlId] = useState<number | null>(null);
  const [entwurf, setEntwurf] = useState<StandEntwurf | null>(null);
  const [fokus, setFokus] = useState<KartenFokus | null>(null);

  // Tourenplanung auf der Karte
  const [touren, setTouren] = useState<VtTour[]>([]);
  const [tourStaende, setTourStaende] = useState<VtTourStand[]>([]);
  const [zeiten, setZeiten] = useState<VtStandZeit[]>([]);
  const [grundplan, setGrundplan] = useState<VtGrundplan[]>([]);
  const [namen, setNamen] = useState<Map<string, string>>(new Map());
  const [tourenAn, setTourenAn] = useState(false);
  const [tagesart, setTagesart] = useState<VtTagesart>("MO_SA");
  const [tourHervor, setTourHervor] = useState<number | null>(null);
  const saison = planungsSaison();
  const urlTourErledigt = useRef(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabaseClient();
    const [st, t, ts, z, g] = await Promise.all([
      sb.from("vt_stand").select("*").order("nummer"),
      sb.from("vt_tour").select("*").order("nummer"),
      sb.from("vt_tour_stand").select("*").order("reihenfolge"),
      ladeAlleMitFehler<VtStandZeit>((von, bis) => sb.from("vt_stand_zeit").select("*").order("id").range(von, bis)),
      ladeAlleMitFehler<VtGrundplan>((von, bis) =>
        sb.from("vt_grundplan").select("*").eq("saison_jahr", saison).order("id").range(von, bis)
      ),
    ]);
    const err = st.error ?? t.error ?? ts.error ?? z.error ?? g.error;
    setFehler(err ? err.message : null);
    setStaende((st.data as VtStand[]) ?? []);
    setTouren((t.data as VtTour[]) ?? []);
    setTourStaende((ts.data as VtTourStand[]) ?? []);
    setZeiten(z.data);
    setGrundplan(g.data);
    // Namen der eingeplanten Verkäufer (für die Info beim Überfahren)
    const ids = [...new Set(g.data.map((x) => x.employee_id))];
    const m = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from("employees").select("id, name, vorname").in("id", ids.slice(i, i + 200));
      for (const e of (data as { id: string; name: string; vorname: string | null }[]) ?? [])
        m.set(e.id, `${e.vorname ? `${e.vorname} ` : ""}${e.name}`);
    }
    setNamen(m);
  }, [saison]);

  useEffect(() => {
    load();
  }, [load]);

  // ?tour=<id> aus der Tourenplanung: Touren einblenden, Tour hervorheben
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("tour"));
    const t = touren.find((x) => x.id === id);
    if (!t || urlTourErledigt.current) return;
    urlTourErledigt.current = true;
    setTourenAn(true);
    setTagesart(t.tagesart);
    tourZeigen(t.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touren, tourStaende, staende]);

  // ?stand=<id> aus der Ständeliste
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("stand"));
    if (id && staende.some((s) => s.id === id) && auswahlId === null) waehlen(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staende]);

  const standById = useMemo(() => new Map(staende.map((x) => [x.id, x])), [staende]);
  const tourenDerArt = useMemo(
    () => touren.filter((t) => t.tagesart === tagesart && t.aktiv).sort((a, b) => a.nummer - b.nummer),
    [touren, tagesart]
  );
  const tourFarbe = useMemo(() => {
    const m = new Map<number, string>();
    touren
      .slice()
      .sort((a, b) => a.nummer - b.nummer)
      .forEach((t) => {
        const i = touren.filter((x) => x.tagesart === t.tagesart && x.nummer < t.nummer).length;
        m.set(t.id, TOUR_FARBEN[i % TOUR_FARBEN.length]);
      });
    return m;
  }, [touren]);
  const eintraegeVon = useCallback(
    (tourId: number) => tourStaende.filter((x) => x.tour_id === tourId).sort((a, b) => a.reihenfolge - b.reihenfolge),
    [tourStaende]
  );

  function tourZeigen(tourId: number | null) {
    setTourHervor(tourId);
    if (tourId === null) return;
    const pts = eintraegeVon(tourId)
      .map((e) => standById.get(e.stand_id))
      .filter((x): x is VtStand => !!x && x.lat !== null && x.lng !== null);
    if (!pts.length) return;
    const lng = pts.map((p) => p.lng!);
    const lat = pts.map((p) => p.lat!);
    setFokus({ bounds: [[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]], ts: Date.now() });
  }

  const tourLinien: TourLinie[] = useMemo(() => {
    if (!tourenAn) return [];
    return tourenDerArt.map((t) => ({
      tourId: t.id,
      farbe: tourFarbe.get(t.id) ?? OHNE_TOUR_FARBE,
      coords: eintraegeVon(t.id)
        .map((e) => {
          // ausgewählter Stand: ungespeicherte Position mitziehen
          const st = standById.get(e.stand_id);
          if (st && st.id === auswahlId && entwurf && entwurf.lat !== null && entwurf.lng !== null)
            return [entwurf.lng, entwurf.lat] as [number, number];
          return st && st.lat !== null && st.lng !== null ? ([st.lng, st.lat] as [number, number]) : null;
        })
        .filter((x): x is [number, number] => !!x),
      hervorgehoben: tourHervor === t.id,
      gedimmt: tourHervor !== null && tourHervor !== t.id,
    }));
  }, [tourenAn, tourenDerArt, tourFarbe, eintraegeVon, standById, tourHervor, auswahlId, entwurf]);

  const tourVonStand = useMemo(() => {
    const m = new Map<string, VtTourStand>();
    for (const x of tourStaende) m.set(`${x.tagesart}|${x.stand_id}`, x);
    return m;
  }, [tourStaende]);

  const markerFarbe = useCallback(
    (standId: number) => {
      if (!tourenAn) return null;
      const ts = tourVonStand.get(`${tagesart}|${standId}`);
      if (!ts) return OHNE_TOUR_FARBE;
      if (tourHervor !== null && ts.tour_id !== tourHervor) return OHNE_TOUR_FARBE;
      return tourFarbe.get(ts.tour_id) ?? OHNE_TOUR_FARBE;
    },
    [tourenAn, tourVonStand, tagesart, tourFarbe, tourHervor]
  );

  // Platz in der Tour am Punkt: 1 = erster Halt, Auto = Fahrer-Stand (letzter
  // mitfahrender Stand, dort steigt der Fahrer aus und holt später alle ab)
  const markerSchild = useCallback(
    (standId: number) => {
      if (!tourenAn) return null;
      const ts = tourVonStand.get(`${tagesart}|${standId}`);
      if (!ts) return null;
      if (tourHervor !== null && ts.tour_id !== tourHervor) return null;
      const liste = eintraegeVon(ts.tour_id);
      const platz = liste.findIndex((x) => x.stand_id === standId) + 1;
      const fahrer = fahrerStandId(liste) === standId;
      const farbe = tourFarbe.get(ts.tour_id) ?? OHNE_TOUR_FARBE;
      return { text: ts.nur_ware ? `${platz}·W` : String(platz), farbe, fahrer };
    },
    [tourenAn, tourVonStand, tagesart, tourHervor, eintraegeVon, tourFarbe]
  );

  const zeitenJeStand = useMemo(() => {
    const m = new Map<number, VtStandZeit[]>();
    for (const z of zeiten) m.set(z.stand_id, [...(m.get(z.stand_id) ?? []), z]);
    return m;
  }, [zeiten]);
  const grundplanJeStand = useMemo(() => {
    const m = new Map<number, VtGrundplan[]>();
    for (const g of grundplan) m.set(g.stand_id, [...(m.get(g.stand_id) ?? []), g]);
    return m;
  }, [grundplan]);

  // Info beim Überfahren: Stand der Planung
  const hoverHtml = useCallback(
    (standId: number): string => {
      const st = standById.get(standId);
      if (!st) return "";
      const z = zeitenJeStand.get(standId) ?? [];
      const zeilen: string[] = [];
      zeilen.push(`<div style="font-weight:600">${st.nummer} ${esc(st.name)}${st.aktiv ? "" : " (inaktiv)"}</div>`);
      if (st.adresse) zeilen.push(`<div style="color:#666">${esc(st.adresse)}</div>`);
      zeilen.push(`<div style="margin-top:4px">Geöffnet: ${esc(oeffnungText(z))}</div>`);
      for (const ta of TAGESARTEN) {
        const offen = z.some((x) => ta.tage.includes(x.wochentag));
        const ts = tourVonStand.get(`${ta.wert}|${standId}`);
        let text: string;
        if (ts) {
          const t = touren.find((x) => x.id === ts.tour_id);
          const liste = eintraegeVon(ts.tour_id);
          const rolle =
            fahrerStandId(liste) === standId ? "Fahrer" : ts.nur_ware ? "nur Ware" : "fährt mit";
          text = `Tour ${t?.nummer ?? "?"}${t?.name ? ` ${esc(t.name)}` : ""} · Platz ${ts.reihenfolge}/${liste.length} · ${rolle}`;
        } else {
          text = offen ? '<span style="color:#b45309">keine Tour</span>' : '<span style="color:#999">geschlossen</span>';
        }
        zeilen.push(`<div>${ta.wert === "SO" ? "Sonntag" : "Mo–Sa"}: ${text}</div>`);
      }
      const soll = z.length;
      if (soll) {
        const gp = grundplanJeStand.get(standId) ?? [];
        const besetzt = new Set(gp.map((g) => `${g.wochentag}|${g.halbtag}`)).size;
        const leute = [...new Set(gp.map((g) => namen.get(g.employee_id) ?? "?"))];
        zeilen.push(
          `<div style="margin-top:4px">Grundplan ${saison}: ${besetzt} von ${soll} Halbtagen besetzt${
            besetzt < soll ? ' <span style="color:#b45309">⚠</span>' : " ✓"
          }</div>`
        );
        if (leute.length) zeilen.push(`<div style="color:#666">${leute.map(esc).join(", ")}</div>`);
      }
      zeilen.push(
        `<div style="color:#666;margin-top:4px">${
          st.lat !== null ? `Standzone ${st.radius_m} m` : "keine Position"
        }</div>`
      );
      return `<div style="font:400 12px/1.45 system-ui">${zeilen.join("")}</div>`;
    },
    [standById, zeitenJeStand, tourVonStand, touren, eintraegeVon, grundplanJeStand, namen, saison]
  );

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
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={tourenAn}
                onChange={(e) => {
                  setTourenAn(e.target.checked);
                  setTourHervor(null);
                }}
              />
              Touren anzeigen
            </label>
            {tourenAn && (
              <>
                <div className="flex gap-1">
                  {TAGESARTEN.map((ta) => (
                    <button
                      key={ta.wert}
                      className={tagesart === ta.wert ? "btn px-2 py-1 text-xs" : "btn-secondary px-2 py-1 text-xs"}
                      onClick={() => {
                        setTagesart(ta.wert);
                        setTourHervor(null);
                      }}
                    >
                      {ta.wert === "SO" ? "Sonntag" : "Mo–Sa"}
                    </button>
                  ))}
                </div>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto text-sm">
                  {tourenDerArt.map((t) => {
                    const n = eintraegeVon(t.id).length;
                    return (
                      <li key={t.id}>
                        <button
                          className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-sand ${
                            tourHervor === t.id ? "bg-sand font-medium" : ""
                          }`}
                          onClick={() => tourZeigen(tourHervor === t.id ? null : t.id)}
                        >
                          <span className="h-1.5 w-5 shrink-0 rounded" style={{ background: tourFarbe.get(t.id) }} />
                          <span className="flex-1">
                            Tour {t.nummer}
                            {t.name && <span className="text-neutral-500"> · {t.name}</span>}
                          </span>
                          <span className="text-xs text-neutral-400">{n}</span>
                        </button>
                      </li>
                    );
                  })}
                  {tourenDerArt.length === 0 && <li className="text-neutral-500">Keine aktiven Touren.</li>}
                </ul>
                <p className="text-xs text-neutral-500">
                  Schild am Punkt = Reihenfolge der Tour (1 = erster Halt), <Car className="inline h-3 w-3" /> = Fahrer-Stand
                  (letzter Halt, der Fahrer setzt alle anderen vorher ab), W = nur Ware. Graue Punkte: ohne Tour. Tour anklicken = hervorheben. Info
                  zum Stand: Maus 1 Sekunde auf dem Punkt halten.
                </p>
              </>
            )}
          </div>

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
          tourLinien={tourLinien}
          markerFarbe={markerFarbe}
          markerSchild={markerSchild}
          hoverHtml={hoverHtml}
        />
      </div>
    </div>
  );
}
