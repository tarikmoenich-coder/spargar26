"use client";

// Werkzeug zum Einzeichnen einer "Ausrichtungslinie" (Position + Richtung
// EINER Spargel-Reihe) auf der echten Feldkontur und zum serverseitigen
// Berechnen aller dazu parallelen Reihen (RPC
// feld_reihen_aus_ausrichtung_berechnen) - liefert exakte Reihenzahl,
// Laufmeter gesamt und Reihenlänge Min/Max/Ø aus der echten, auch unförmigen
// Geometrie statt einer groben Schätzung (Nutzer-Vorgabe 2026-10-29).
//
// Eigene, schlanke Kopie der Kartenbausteine aus components/FeldKarte.tsx
// (OSM/Satellit-Umschalter, Klick-für-Klick-Zeichnen) - bewusst dupliziert
// statt FeldKarte mit einem zweiten, fachlich andersartigen Zweck (Reihen-
// Ausrichtung statt Feldgrenze zeichnen) zu überladen, siehe Begründung dort.

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatMenge } from "@/lib/format";
import type { FeldReihenTeilstueck } from "@/lib/types";

class BasiskartenControl implements maplibregl.IControl {
  private map?: maplibregl.Map;
  private container?: HTMLDivElement;
  private satellitAktiv = true;

  onAdd(map: maplibregl.Map) {
    this.map = map;
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.title = "Zwischen Karte und Satellit wechseln";
    button.style.fontSize = "16px";
    button.textContent = "🗺️";
    button.onclick = () => {
      this.satellitAktiv = !this.satellitAktiv;
      this.map?.setLayoutProperty("satellit", "visibility", this.satellitAktiv ? "visible" : "none");
      this.map?.setLayoutProperty("osm", "visibility", this.satellitAktiv ? "none" : "visible");
      button.textContent = this.satellitAktiv ? "🗺️" : "🛰️";
    };
    this.container.appendChild(button);
    return this.container;
  }

  onRemove() {
    this.container?.parentNode?.removeChild(this.container);
    this.map = undefined;
  }
}

export interface ReihenErgebnis {
  reihenAnzahl: number;
  laengeMin: number;
  laengeMax: number;
  laengeAvg: number;
  laufmeterGesamt: number;
  linieGeojson: string;
}

export interface ReihenAusrichtungKarteProps {
  feldId: number;
  feldGeometrieGeojson: string | null;
  reihenabstandM: number | null;
  bestehendeLinieGeojson?: string | null;
  onUebernehmen: (ergebnis: ReihenErgebnis) => void;
}

function aussenringe(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Position[][] {
  return geom.type === "MultiPolygon"
    ? geom.coordinates.map((polygon) => polygon[0] ?? [])
    : [geom.coordinates?.[0] ?? []];
}

export default function ReihenAusrichtungKarte({
  feldId,
  feldGeometrieGeojson,
  reihenabstandM,
  bestehendeLinieGeojson,
  onUebernehmen,
}: ReihenAusrichtungKarteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [bereit, setBereit] = useState(false);
  const [zeichnen, setZeichnen] = useState(false);
  const [punkte, setPunkte] = useState<[number, number][]>([]);
  const zeichnenRef = useRef(false);
  const punkteRef = useRef<[number, number][]>([]);
  const [linie, setLinie] = useState<string | null>(bestehendeLinieGeojson ?? null);
  const [teilstuecke, setTeilstuecke] = useState<FeldReihenTeilstueck[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    zeichnenRef.current = zeichnen;
  }, [zeichnen]);
  useEffect(() => {
    punkteRef.current = punkte;
  }, [punkte]);

  // Karte einmalig aufbauen - 1:1 Muster aus FeldKarte.tsx.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap-Mitwirkende",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm", layout: { visibility: "none" } }],
      },
      center: [8.6, 49.85],
      zoom: 15,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl(), "bottom-left");

    map.on("load", () => {
      map.addSource("satellit", {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "© Esri, Maxar, Earthstar Geographics",
      });
      map.addLayer({ id: "satellit", type: "raster", source: "satellit" }, "osm");
      map.addControl(new BasiskartenControl(), "top-right");

      // Bestehende Feldkontur - grün, read-only (reiner Kontext zum Zeichnen).
      map.addSource("feld", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "feld-flaeche",
        type: "fill",
        source: "feld",
        paint: { "fill-color": "#2b711e", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "feld-rand",
        type: "line",
        source: "feld",
        paint: { "line-color": "#2b711e", "line-width": 2 },
      });

      // Berechnete Reihen - kräftiges Grün, erscheinen nach "Berechnen".
      map.addSource("berechnet", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "berechnet-linien",
        type: "line",
        source: "berechnet",
        paint: { "line-color": "#15803d", "line-width": 2 },
      });

      // Laufender Linien-Entwurf - rot, gestrichelt (gleiches Muster wie
      // FeldKarte's Polygon-Entwurf, hier als Linie statt Fläche).
      map.addSource("entwurf-linie", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: "entwurf-linie",
        type: "line",
        source: "entwurf-linie",
        paint: { "line-color": "#d6262a", "line-width": 2, "line-dasharray": [2, 1] },
      });
      map.addSource("entwurf-punkte", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "entwurf-punkte",
        type: "circle",
        source: "entwurf-punkte",
        paint: {
          "circle-radius": 5,
          "circle-color": "#d6262a",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      // Zuletzt gespeicherte Ausrichtungslinie (falls vorhanden) - blau,
      // nur zur Orientierung beim erneuten Öffnen.
      map.addSource("gespeicherte-linie", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "gespeicherte-linie",
        type: "line",
        source: "gespeicherte-linie",
        paint: { "line-color": "#1d4ed8", "line-width": 2, "line-dasharray": [1, 1] },
      });

      map.on("click", (e) => {
        if (!zeichnenRef.current) return;
        const neu: [number, number][] = [...punkteRef.current, [e.lngLat.lng, e.lngLat.lat]];
        punkteRef.current = neu;
        setPunkte(neu);
        if (neu.length >= 2) {
          // Genau 2 Punkte nötig (Position + Richtung EINER Reihe) -
          // Zeichnen-Modus endet automatisch nach dem zweiten Klick.
          zeichnenRef.current = false;
          setZeichnen(false);
        }
      });

      setBereit(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setBereit(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    map.getCanvas().style.cursor = zeichnen ? "crosshair" : "";
  }, [zeichnen, bereit]);

  // Bestehende Feldkontur anzeigen + draufzoomen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const src = map.getSource("feld") as maplibregl.GeoJSONSource | undefined;
    if (!src || !feldGeometrieGeojson) return;
    try {
      const geom = JSON.parse(feldGeometrieGeojson) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      src.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] });
      const alleKoordinaten = aussenringe(geom).flat();
      if (alleKoordinaten.length > 0) {
        const b = new maplibregl.LngLatBounds();
        alleKoordinaten.forEach((c) => b.extend(c as [number, number]));
        map.fitBounds(b, { padding: 40, maxZoom: 18, duration: 0 });
      }
    } catch {
      // ungültiges/leeres GeoJSON - ignorieren.
    }
  }, [feldGeometrieGeojson, bereit]);

  // Bereits gespeicherte Ausrichtungslinie (falls vorhanden) zur Orientierung.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const src = map.getSource("gespeicherte-linie") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!bestehendeLinieGeojson) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    try {
      const geom = JSON.parse(bestehendeLinieGeojson) as GeoJSON.LineString;
      src.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] });
    } catch {
      // ignorieren
    }
  }, [bestehendeLinieGeojson, bereit]);

  // Laufender Linien-Entwurf.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const linieSrc = map.getSource("entwurf-linie") as maplibregl.GeoJSONSource | undefined;
    const punkteSrc = map.getSource("entwurf-punkte") as maplibregl.GeoJSONSource | undefined;
    if (!linieSrc || !punkteSrc) return;
    punkteSrc.setData({
      type: "FeatureCollection",
      features: punkte.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} })),
    });
    linieSrc.setData({ type: "Feature", geometry: { type: "LineString", coordinates: punkte }, properties: {} });
  }, [punkte, bereit]);

  // Berechnete Reihen-Teilstücke auf der Karte.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const src = map.getSource("berechnet") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: teilstuecke.map((t) => ({
        type: "Feature",
        geometry: JSON.parse(t.geom_geojson) as GeoJSON.LineString,
        properties: {},
      })),
    });
  }, [teilstuecke, bereit]);

  function zeichnenStarten() {
    setZeichnen(true);
    setPunkte([]);
    setTeilstuecke([]);
    setFehler(null);
  }

  function zeichnenAbbrechen() {
    setZeichnen(false);
    setPunkte([]);
  }

  async function berechnen() {
    if (punkte.length !== 2 || !reihenabstandM) return;
    setLaeuft(true);
    setFehler(null);
    const linieGeojson = JSON.stringify({ type: "LineString", coordinates: punkte });
    const { data, error } = await getSupabaseClient().rpc("feld_reihen_aus_ausrichtung_berechnen", {
      p_feld_id: feldId,
      p_linie_geojson: linieGeojson,
      p_reihenabstand_m: reihenabstandM,
    });
    setLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    const liste = (data as FeldReihenTeilstueck[]) ?? [];
    if (liste.length === 0) {
      setFehler("Keine Reihen gefunden - liegt die Linie auf dem Feld?");
      return;
    }
    setLinie(linieGeojson);
    setTeilstuecke(liste);
  }

  const laengen = teilstuecke.map((t) => t.laenge_m);
  const laufmeterGesamt = laengen.reduce((s, l) => s + l, 0);
  const laengeAvg = laengen.length > 0 ? laufmeterGesamt / laengen.length : 0;
  const laengeMin = laengen.length > 0 ? Math.min(...laengen) : 0;
  const laengeMax = laengen.length > 0 ? Math.max(...laengen) : 0;

  function uebernehmen() {
    if (!linie || teilstuecke.length === 0) return;
    onUebernehmen({
      reihenAnzahl: teilstuecke.length,
      laengeMin,
      laengeMax,
      laengeAvg,
      laufmeterGesamt,
      linieGeojson: linie,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!zeichnen && punkte.length < 2 && (
          <button type="button" className="btn-secondary text-xs" onClick={zeichnenStarten}>
            📍 Ausrichtungslinie zeichnen
          </button>
        )}
        {zeichnen && (
          <>
            <span className="text-xs text-neutral-500">
              Entlang einer echten Reihe auf die Karte klicken ({punkte.length}/2 Punkte gesetzt).
            </span>
            <button type="button" className="btn-secondary text-xs" onClick={zeichnenAbbrechen}>
              Abbrechen
            </button>
          </>
        )}
        {!zeichnen && punkte.length === 2 && (
          <>
            <button type="button" className="btn text-xs" disabled={laeuft || !reihenabstandM} onClick={berechnen}>
              {laeuft ? "Berechnet…" : "Berechnen"}
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={zeichnenStarten}>
              Neu zeichnen
            </button>
          </>
        )}
      </div>
      {!reihenabstandM && (
        <p className="text-xs text-beere-700">Bitte zuerst einen Reihenabstand für diese Zeile eintragen.</p>
      )}
      {fehler && <p className="text-sm text-beere-700">{fehler}</p>}
      <div ref={containerRef} className="h-[50vh] w-full overflow-hidden rounded-lg border border-linie" />
      {teilstuecke.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-linie bg-sand p-2 text-sm">
          <span>
            <strong>{teilstuecke.length}</strong> Reihen(-teilstücke)
          </span>
          <span>
            Ø {formatMenge(laengeAvg, 1)} m ({formatMenge(laengeMin, 1)}–{formatMenge(laengeMax, 1)} m)
          </span>
          <span>Σ {formatMenge(laufmeterGesamt, 1)} lfm</span>
          <button type="button" className="btn text-xs" onClick={uebernehmen}>
            Übernehmen
          </button>
        </div>
      )}
    </div>
  );
}
