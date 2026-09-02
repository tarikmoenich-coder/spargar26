"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FahrzeugUebersicht } from "@/lib/types";

// Umschalter Straßenkarte (Standard) <-> Satellit. Kein API-Key: OSM-Raster
// + Esri World Imagery, wie im Pachtwesen-Modul.
class BasiskartenControl implements maplibregl.IControl {
  private map?: maplibregl.Map;
  private container?: HTMLDivElement;
  private satellitAktiv = false;

  onAdd(map: maplibregl.Map) {
    this.map = map;
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.title = "Zwischen Karte und Satellit wechseln";
    button.style.fontSize = "16px";
    button.textContent = "🛰️";
    button.onclick = () => {
      this.satellitAktiv = !this.satellitAktiv;
      this.map?.setLayoutProperty(
        "satellit",
        "visibility",
        this.satellitAktiv ? "visible" : "none"
      );
      this.map?.setLayoutProperty(
        "osm",
        "visibility",
        this.satellitAktiv ? "none" : "visible"
      );
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

function minutenHer(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function vorText(min: number | null): string {
  if (min === null) return "keine Meldung";
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  if (min < 1440) return `vor ${Math.round(min / 60)} h`;
  return `vor ${Math.round(min / 1440)} d`;
}

// grün = frisch (<10 min), bernstein = 10-60 min, grau = älter / keine.
function ampel(min: number | null): string {
  if (min === null || min >= 60) return "#9ca3af";
  if (min >= 10) return "#d97706";
  return "#16a34a";
}

export interface Trackpunkt {
  lng: number;
  lat: number;
}

export default function FahrzeugKarte({
  fahrzeuge,
  track,
  hoehe = "h-[70vh]",
}: {
  fahrzeuge: FahrzeugUebersicht[];
  track?: Trackpunkt[];
  hoehe?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const [bereit, setBereit] = useState(false);

  // Karte einmalig aufbauen.
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
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [8.6, 49.85],
      zoom: 10,
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
        attribution:
          "© Esri, Maxar, Earthstar Geographics",
      });
      map.addLayer(
        { id: "satellit", type: "raster", source: "satellit", layout: { visibility: "none" } },
        "osm"
      );
      map.addControl(new BasiskartenControl(), "top-right");

      map.addSource("track", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "track-linie",
        type: "line",
        source: "track",
        paint: { "line-color": "#2b711e", "line-width": 3, "line-opacity": 0.85 },
      });
      map.addSource("track-enden", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "track-enden",
        type: "circle",
        source: "track-enden",
        paint: {
          "circle-radius": 6,
          "circle-color": ["get", "farbe"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });
      setBereit(true);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setBereit(false);
    };
  }, []);

  // Fahrzeug-Marker synchronisieren.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;

    const mitPos = fahrzeuge.filter(
      (f) => f.lat != null && f.lng != null
    );
    const behalten = new Set<number>();

    for (const f of mitPos) {
      behalten.add(f.id);
      const min = minutenHer(f.pos_zeitpunkt);
      const farbe = ampel(min);
      const faehrt = (f.speed_kmh ?? 0) > 3;
      const titel = f.kennzeichen || f.bezeichnung;

      let marker = markersRef.current.get(f.id);
      let el: HTMLDivElement;
      if (!marker) {
        el = document.createElement("div");
        el.style.cursor = "pointer";
        marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([
          f.lng!,
          f.lat!,
        ]);
        const popup = new maplibregl.Popup({ offset: 14, maxWidth: "260px" });
        marker.setPopup(popup);
        marker.addTo(map);
        markersRef.current.set(f.id, marker);
      } else {
        el = marker.getElement() as HTMLDivElement;
        marker.setLngLat([f.lng!, f.lat!]);
      }

      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;transform:translateY(4px)">
          <span style="width:12px;height:12px;border-radius:9999px;background:${farbe};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></span>
          <span style="background:#fff;border:1px solid #e6e1d5;border-radius:6px;padding:1px 5px;font:600 11px/1.3 system-ui;box-shadow:0 1px 2px rgba(0,0,0,.15);white-space:nowrap">${
            titel
          }${
            faehrt && f.kurs != null
              ? ` <span style="display:inline-block;transform:rotate(${f.kurs}deg)">➤</span>`
              : ""
          }</span>
        </div>`;

      const popup = marker.getPopup();
      if (popup) {
        popup.setHTML(`
          <div style="font:400 12px/1.45 system-ui">
            <div style="font-weight:600">${f.bezeichnung}${
              f.kennzeichen ? ` · ${f.kennzeichen}` : ""
            }</div>
            <div>Fahrer: ${
              f.fahrer_name ? `${f.fahrer_name}, ${f.fahrer_vorname ?? ""}` : "—"
            }</div>
            <div>Tempo: ${
              f.speed_kmh != null ? `${Math.round(f.speed_kmh)} km/h` : "—"
            } · Zündung: ${
              f.zuendung == null ? "—" : f.zuendung ? "an" : "aus"
            }</div>
            ${
              f.batterie_prozent != null
                ? `<div>Batterie: ${Math.round(f.batterie_prozent)} %</div>`
                : ""
            }
            <div style="color:#6b7280">zuletzt: ${vorText(min)}</div>
          </div>`);
      }
    }

    // entfernte Fahrzeuge abräumen
    markersRef.current.forEach((m, id) => {
      if (!behalten.has(id)) {
        m.remove();
        markersRef.current.delete(id);
      }
    });

    // Auf die Marker zoomen, solange kein Track aktiv ist
    if ((!track || track.length === 0) && mitPos.length > 0) {
      const b = new maplibregl.LngLatBounds();
      mitPos.forEach((f) => b.extend([f.lng!, f.lat!]));
      map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 400 });
    }
  }, [fahrzeuge, bereit, track]);

  // Track (Streckenverlauf) zeichnen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const linie = map.getSource("track") as maplibregl.GeoJSONSource | undefined;
    const enden = map.getSource("track-enden") as maplibregl.GeoJSONSource | undefined;
    if (!linie || !enden) return;

    const pts = (track ?? []).map((p) => [p.lng, p.lat] as [number, number]);
    linie.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: pts },
      properties: {},
    });
    enden.setData({
      type: "FeatureCollection",
      features:
        pts.length >= 2
          ? [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: pts[0] },
                properties: { farbe: "#16a34a" },
              },
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: pts[pts.length - 1] },
                properties: { farbe: "#d6262a" },
              },
            ]
          : [],
    });

    if (pts.length > 0) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 400 });
    }
  }, [track, bereit]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${hoehe} overflow-hidden rounded-lg border border-linie`}
    />
  );
}
