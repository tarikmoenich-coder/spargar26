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

// Marker-Stil einmal pro Seite injizieren: solange das Detail-Popup offen ist,
// blenden wir das Foto aus (Klasse .fzm-detail auf dem Marker-Element).
let markerStilGesetzt = false;
function markerStilEinmalig() {
  if (markerStilGesetzt || typeof document === "undefined") return;
  markerStilGesetzt = true;
  const s = document.createElement("style");
  s.textContent = ".fzm-detail .fzm-foto{display:none}";
  document.head.appendChild(s);
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

export interface KartenGeofence {
  name: string | null;
  area: string | null;
  ist_hof: boolean;
}

// Traccar-WKT ("CIRCLE (lat lng, radius)" / "POLYGON ((lat lng, ...))",
// Reihenfolge lat vor lng) -> GeoJSON-Ring [lng, lat].
function wktZuRing(area: string): [number, number][] | null {
  const zahlen = area.match(/-?\d+(\.\d+)?/g)?.map(Number);
  if (!zahlen || zahlen.length < 3) return null;
  if (/^\s*CIRCLE/i.test(area)) {
    const [lat, lng, r] = zahlen;
    const dLat = r / 111320;
    const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
    return Array.from({ length: 48 }, (_, i) => {
      const t = (i / 48) * 2 * Math.PI;
      return [lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)] as [
        number,
        number,
      ];
    });
  }
  const ring: [number, number][] = [];
  for (let i = 0; i + 1 < zahlen.length; i += 2) {
    ring.push([zahlen[i + 1], zahlen[i]]);
  }
  if (ring.length >= 3) {
    const [a] = ring;
    const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) ring.push(a);
    return ring;
  }
  return null;
}

export default function FahrzeugKarte({
  fahrzeuge,
  track,
  geofences,
  bilder,
  fokus,
  aktiv = true,
  hoehe = "h-[70vh]",
}: {
  fahrzeuge: FahrzeugUebersicht[];
  track?: Trackpunkt[];
  geofences?: KartenGeofence[];
  /** Fahrzeug-ID -> Foto als data-URL, wird über dem Kennzeichen gezeigt. */
  bilder?: Record<number, string>;
  /** "Auf Karte zeigen" aus der Liste: auf dieses Fahrzeug zoomen + Popup
   *  öffnen. Neues Objekt (ts) bei jedem Klick, damit ein erneuter Klick auf
   *  dasselbe Fahrzeug wieder auslöst. Solange gesetzt: kein Auto-Fit. */
  fokus?: { id: number; ts: number } | null;
  /** Ob die Karte gerade sichtbar ist (Umschalter Karte/Liste). Beim
   *  Einblenden muss maplibre neu vermessen werden. */
  aktiv?: boolean;
  hoehe?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const [bereit, setBereit] = useState(false);

  // Karte einmalig aufbauen.
  useEffect(() => {
    if (!containerRef.current) return;
    markerStilEinmalig();
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

      map.addSource("geofences", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "geofences-flaeche",
        type: "fill",
        source: "geofences",
        paint: {
          "fill-color": ["case", ["get", "hof"], "#2b711e", "#6b7280"],
          "fill-opacity": 0.12,
        },
      });
      map.addLayer({
        id: "geofences-rand",
        type: "line",
        source: "geofences",
        paint: {
          "line-color": ["case", ["get", "hof"], "#2b711e", "#6b7280"],
          "line-width": 1.5,
          "line-dasharray": [2, 1],
        },
      });

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
      // "grauer Punkt" = seit >= 60 min keine Meldung / gar keine Position.
      // Dann auf der Karte nur noch das Kennzeichen zeigen, kein Foto
      // (Nutzer-Vorgabe) - im Detail-Popup bleibt das Foto.
      const veraltet = farbe === "#9ca3af";
      const faehrt = (f.speed_kmh ?? 0) > 3;
      const titel = f.kennzeichen || f.bezeichnung;

      let marker = markersRef.current.get(f.id);
      let el: HTMLDivElement;
      if (!marker) {
        el = document.createElement("div");
        el.style.cursor = "pointer";
        // WICHTIG: kein eigenes position setzen - maplibre-gl.css gibt
        // .maplibregl-marker { position:absolute } vor; ein inline "relative"
        // bricht die Positionierung (Marker fliegt beim Zoomen weg). Das
        // absolute el ist zugleich der Bezugsrahmen für Plakette/Foto darunter.
        // anchor "center": nur der 14px-Punkt bestimmt die Ankergröße, Plakette
        // und Foto sind absolut positioniert und verschieben den Bezugspunkt
        // nicht - so sitzt die Koordinate exakt auf dem Punkt, auch beim Zoomen.
        marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([
          f.lng!,
          f.lat!,
        ]);
        const popup = new maplibregl.Popup({ offset: 14, maxWidth: "260px" });
        marker.setPopup(popup);
        // Klick aufs Kennzeichen öffnet das Popup (maplibre-Standard); dann Foto
        // ausblenden, beim Schließen wieder zeigen.
        popup.on("open", () => el.classList.add("fzm-detail"));
        popup.on("close", () => el.classList.remove("fzm-detail"));
        marker.addTo(map);
        markersRef.current.set(f.id, marker);
      } else {
        el = marker.getElement() as HTMLDivElement;
        marker.setLngLat([f.lng!, f.lat!]);
      }

      const fotoUrl = bilder?.[f.id];
      const pfeil =
        faehrt && f.kurs != null
          ? ` <span style="display:inline-block;transform:rotate(${f.kurs}deg)">➤</span>`
          : "";
      el.innerHTML = `
        <div style="width:14px;height:14px;border-radius:9999px;background:${farbe};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>
        <div style="position:absolute;left:20px;top:50%;transform:translateY(-50%);background:#fff;border:1px solid #e6e1d5;border-radius:6px;padding:1px 5px;font:600 11px/1.3 system-ui;box-shadow:0 1px 2px rgba(0,0,0,.15);white-space:nowrap">${titel}${pfeil}</div>
        ${
          fotoUrl && !veraltet
            ? `<img class="fzm-foto" src="${fotoUrl}" alt="" style="position:absolute;left:20px;bottom:22px;width:70px;max-width:none;height:48px;object-fit:cover;border-radius:5px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);background:#fff;pointer-events:none" />`
            : ""
        }`;

      const popup = marker.getPopup();
      if (popup) {
        popup.setHTML(`
          <div style="font:400 12px/1.45 system-ui">
            ${
              fotoUrl
                ? `<img src="${fotoUrl}" alt="" style="width:100%;display:block;border-radius:6px;margin-bottom:6px" />`
                : ""
            }
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
            ${
              f.tracker_position
                ? `<div>📍 Tracker verbaut: ${f.tracker_position}</div>`
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

    // Auf die Marker zoomen, solange kein Track aktiv ist und kein einzelnes
    // Fahrzeug fokussiert wurde (sonst zieht der 20-s-Poll den Zoom wieder
    // auf die ganze Flotte zurück).
    if ((!track || track.length === 0) && mitPos.length > 0 && !fokus) {
      const b = new maplibregl.LngLatBounds();
      mitPos.forEach((f) => b.extend([f.lng!, f.lat!]));
      map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 400 });
    }
  }, [fahrzeuge, bereit, track, bilder, fokus]);

  // Karte beim Einblenden (Umschalter Karte/Liste) neu vermessen - eine im
  // display:none aufgebaute maplibre-Karte rendert sonst mit 0 Größe.
  useEffect(() => {
    if (aktiv && bereit) mapRef.current?.resize();
  }, [aktiv, bereit]);

  // "Auf Karte zeigen" aus der Liste: hinfliegen + Popup öffnen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit || !fokus) return;
    const f = fahrzeuge.find((x) => x.id === fokus.id);
    if (!f || f.lat == null || f.lng == null) return;
    map.resize();
    map.flyTo({
      center: [f.lng, f.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 600,
    });
    const marker = markersRef.current.get(fokus.id);
    const popup = marker?.getPopup();
    if (marker && popup && !popup.isOpen()) marker.togglePopup();
  }, [fokus, bereit, fahrzeuge]);

  // Geofences (Höfe) zeichnen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const src = map.getSource("geofences") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    const features = (geofences ?? [])
      .map((g) => {
        const ring = g.area ? wktZuRing(g.area) : null;
        if (!ring) return null;
        return {
          type: "Feature" as const,
          geometry: { type: "Polygon" as const, coordinates: [ring] },
          properties: { hof: g.ist_hof, name: g.name ?? "" },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    src.setData({ type: "FeatureCollection", features });
  }, [geofences, bereit]);

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
