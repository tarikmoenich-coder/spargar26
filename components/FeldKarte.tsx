"use client";

// Kleines Zeichnen-Werkzeug für Feld-Geometrien (Phase 3, Migration
// 2026-10-19): Klick-für-Klick-Polygon auf Satellit/Straßenkarte, für
// Felder ohne Pachtwesen2026-Bezug oder zum Nachziehen einer importierten
// Geometrie.
//
// Bewusst ein EIGENES, schlankes Kartenbauteil statt einer gemeinsamen
// Basis mit components/FahrzeugKarte.tsx: FahrzeugKarte ist ein komplexes,
// aktiv genutztes Bauteil (Clustering, Marker, Streckenverlauf) - eine
// Extraktion für dieses kleine, einmalige Zeichnen-Werkzeug wäre riskanter
// als den ~30 Zeilen großen Kartenaufbau (OSM/Satellit-Umschalter) zu
// duplizieren. Der Umschalter selbst ist wortgleich zu FahrzeugKarte.

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Drei Kartenhintergründe zum Durchklicken - Esri-Satellit ist oft 1-3 Jahre
// alt; das amtliche Hessen-Luftbild (HVBG, Open Data) ist für Flurstücke in
// Hessen meist aktueller und höher aufgelöst (Nutzer-Anfrage 2026-10-31).
const KARTEN = [
  { id: "osm", icon: "🗺️", titel: "OpenStreetMap" },
  { id: "satellit", icon: "🛰️", titel: "Satellit (Esri, oft 1-3 Jahre alt)" },
  { id: "hessen-dop", icon: "📷", titel: "Luftbild Hessen (HVBG, meist aktueller)" },
] as const;

class BasiskartenControl implements maplibregl.IControl {
  private map?: maplibregl.Map;
  private container?: HTMLDivElement;
  private button?: HTMLButtonElement;
  private index = 1; // Start: Satellit (bisheriges Verhalten).

  onAdd(map: maplibregl.Map) {
    this.map = map;
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.style.fontSize = "16px";
    this.button.onclick = () => {
      this.index = (this.index + 1) % KARTEN.length;
      KARTEN.forEach((k, i) => {
        this.map?.setLayoutProperty(k.id, "visibility", i === this.index ? "visible" : "none");
      });
      this.beschriften();
    };
    this.beschriften();
    this.container.appendChild(this.button);
    return this.container;
  }

  private beschriften() {
    if (!this.button) return;
    const aktuell = KARTEN[this.index];
    const naechste = KARTEN[(this.index + 1) % KARTEN.length];
    this.button.textContent = naechste.icon;
    this.button.title = `Kartenhintergrund: ${aktuell.titel} - Klicken für ${naechste.titel}`;
  }

  onRemove() {
    this.container?.parentNode?.removeChild(this.container);
    this.map = undefined;
  }
}

export interface FeldKarteProps {
  /** Bestehende Geometrie (GeoJSON-Polygon als String) - wird grün angezeigt. */
  geometrieGeojson?: string | null;
  /** Aufgerufen, sobald ein neues Polygon fertig gezeichnet wurde (≥ 3 Punkte). */
  onGezeichnet: (geojson: string) => void;
  hoehe?: string;
  /** Nur Anzeige, kein Zeichnen-Werkzeug (fehlendes Schreibrecht). */
  readOnly?: boolean;
}

export default function FeldKarte({
  geometrieGeojson,
  onGezeichnet,
  hoehe = "h-[60vh]",
  readOnly = false,
}: FeldKarteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [bereit, setBereit] = useState(false);
  const [zeichnen, setZeichnen] = useState(false);
  const [punkte, setPunkte] = useState<[number, number][]>([]);
  const zeichnenRef = useRef(false);
  const punkteRef = useRef<[number, number][]>([]);

  useEffect(() => {
    zeichnenRef.current = zeichnen;
  }, [zeichnen]);
  useEffect(() => {
    punkteRef.current = punkte;
  }, [punkte]);

  // Karte einmalig aufbauen - Start standardmäßig auf Satellit (Felder sind
  // auf einer reinen Straßenkarte kaum erkennbar, anders als Fahrzeuge).
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
      map.addLayer(
        { id: "satellit", type: "raster", source: "satellit" },
        "osm"
      );

      // Amtliches Luftbild Hessen (DOP20, HVBG/Geoportal Hessen) - Open Data,
      // für Hessen meist aktueller als Esri. WMS-GetMap als Tile-Quelle über
      // den {bbox-epsg-3857}-Platzhalter (von MapLibre unterstützt).
      map.addSource("hessen-dop", {
        type: "raster",
        tiles: [
          "https://gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=he_dop20_rgb&STYLES=&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&TRANSPARENT=FALSE&BBOX={bbox-epsg-3857}",
        ],
        tileSize: 256,
        attribution: "Geobasisdaten © Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG)",
      });
      map.addLayer(
        { id: "hessen-dop", type: "raster", source: "hessen-dop", layout: { visibility: "none" } },
        "osm"
      );

      map.addControl(new BasiskartenControl(), "top-right");

      // Bestehende (gespeicherte) Geometrie - grün.
      map.addSource("bestehend", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "bestehend-flaeche",
        type: "fill",
        source: "bestehend",
        paint: { "fill-color": "#2b711e", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "bestehend-rand",
        type: "line",
        source: "bestehend",
        paint: { "line-color": "#2b711e", "line-width": 2 },
      });

      // Laufender Entwurf - rot, gestrichelt.
      map.addSource("entwurf-flaeche", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "entwurf-flaeche",
        type: "fill",
        source: "entwurf-flaeche",
        paint: { "fill-color": "#d6262a", "fill-opacity": 0.15 },
      });
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
      map.addSource("entwurf-punkte", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
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

      map.on("click", (e) => {
        if (!zeichnenRef.current) return;
        const neu: [number, number][] = [
          ...punkteRef.current,
          [e.lngLat.lng, e.lngLat.lat],
        ];
        punkteRef.current = neu;
        setPunkte(neu);
      });

      setBereit(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setBereit(false);
    };
  }, []);

  // Zeichnen-Cursor.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    map.getCanvas().style.cursor = zeichnen ? "crosshair" : "";
  }, [zeichnen, bereit]);

  // Bestehende Geometrie anzeigen + draufzoomen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const src = map.getSource("bestehend") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!geometrieGeojson) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    try {
      const geom = JSON.parse(geometrieGeojson) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      src.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: geom, properties: {} }],
      });
      // Aeussere Ringe je Teilflaeche - bei "Polygon" genau einer, bei
      // "MultiPolygon" (seit 2026-10-27: alle aus Pachtwesen importierten
      // Felder, sobald ein Schlag aus mehreren, nicht zusammenhaengenden
      // Flurstuecken besteht) einer je Teilflaeche. Vorher nahm der Code
      // immer "coordinates[0]" an, was bei MultiPolygon eine Ebene zu
      // flach griff (keine Koordinaten, sondern ein Ring-Array) - die
      // Bounds-Berechnung bekam dadurch Unsinn und zoomte auf die Welt
      // heraus, statt auf die Flaeche.
      const aussenringe: GeoJSON.Position[][] =
        geom.type === "MultiPolygon"
          ? geom.coordinates.map((polygon) => polygon[0] ?? [])
          : [geom.coordinates?.[0] ?? []];
      const alleKoordinaten = aussenringe.flat();
      if (alleKoordinaten.length > 0) {
        const b = new maplibregl.LngLatBounds();
        alleKoordinaten.forEach((c) => b.extend(c as [number, number]));
        map.fitBounds(b, { padding: 40, maxZoom: 18, duration: 0 });
      }
    } catch {
      // ungültiges/leeres GeoJSON - ignorieren.
    }
  }, [geometrieGeojson, bereit]);

  // Laufenden Entwurf zeichnen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const flaeche = map.getSource("entwurf-flaeche") as maplibregl.GeoJSONSource | undefined;
    const linie = map.getSource("entwurf-linie") as maplibregl.GeoJSONSource | undefined;
    const pkte = map.getSource("entwurf-punkte") as maplibregl.GeoJSONSource | undefined;
    if (!flaeche || !linie || !pkte) return;

    pkte.setData({
      type: "FeatureCollection",
      features: punkte.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: p },
        properties: {},
      })),
    });
    linie.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: punkte },
      properties: {},
    });
    flaeche.setData(
      punkte.length >= 3
        ? {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [[...punkte, punkte[0]]] },
            properties: {},
          }
        : { type: "FeatureCollection", features: [] }
    );
  }, [punkte, bereit]);

  function zeichnenStarten() {
    setZeichnen(true);
    setPunkte([]);
  }
  function zeichnenAbbrechen() {
    setZeichnen(false);
    setPunkte([]);
  }
  function letzterPunktEntfernen() {
    setPunkte((prev) => prev.slice(0, -1));
  }
  function fertig() {
    if (punkte.length < 3) return;
    const ring = [...punkte, punkte[0]];
    onGezeichnet(JSON.stringify({ type: "Polygon", coordinates: [ring] }));
    setZeichnen(false);
    setPunkte([]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {readOnly ? null : !zeichnen ? (
          <button type="button" className="btn-secondary text-xs" onClick={zeichnenStarten}>
            📍 Fläche zeichnen
          </button>
        ) : (
          <>
            <span className="text-xs text-neutral-500">
              Auf die Karte klicken, um Eckpunkte zu setzen ({punkte.length} gesetzt, mind. 3 nötig).
            </span>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={punkte.length === 0}
              onClick={letzterPunktEntfernen}
            >
              Letzten Punkt entfernen
            </button>
            <button type="button" className="btn text-xs" disabled={punkte.length < 3} onClick={fertig}>
              Fertig
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={zeichnenAbbrechen}>
              Abbrechen
            </button>
          </>
        )}
      </div>
      <div
        ref={containerRef}
        className={`w-full ${hoehe} overflow-hidden rounded-lg border border-linie`}
      />
    </div>
  );
}
