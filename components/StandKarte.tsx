"use client";

// Karte der Verkaufsstände (Vertriebsplanung, Reiter "Karte"): jeder Stand
// als nummerierter Punkt mit seinem Radius (Standzone für die GPS-Auswertung).
// Der ausgewählte Stand lässt sich ziehen oder per Klick in die Karte
// versetzen (Nutzer-Wunsch 2026-11-25: Position auf dem Luftbild von Hand
// setzen, weil der Google-Export keine Koordinaten enthält und die
// Adress-Suche nur ungefähr trifft).
//
// Kartenaufbau (OSM/Satellit/Hessen-Luftbild) wie components/FeldKarte.tsx.

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { VtStand } from "@/lib/types";

const KARTEN = [
  { id: "osm", icon: "🗺️", titel: "OpenStreetMap" },
  { id: "satellit", icon: "🛰️", titel: "Satellit (Esri, oft 1-3 Jahre alt)" },
  { id: "hessen-dop", icon: "📷", titel: "Luftbild Hessen (HVBG, meist aktueller, nur Hessen)" },
] as const;

class BasiskartenControl implements maplibregl.IControl {
  private map?: maplibregl.Map;
  private container?: HTMLDivElement;
  private button?: HTMLButtonElement;
  private index = 1; // Start: Satellit - Stände sind auf dem Bild zu erkennen

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

export interface StandEntwurf {
  lat: number | null;
  lng: number | null;
  radius_m: number;
}

function kreis(lat: number, lng: number, r: number): [number, number][] {
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * 2 * Math.PI;
    return [lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)] as [number, number];
  });
  ring.push(ring[0]);
  return ring;
}

function markerElement(nummer: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "vt-stand-marker";
  el.textContent = String(nummer);
  el.style.cssText =
    "min-width:24px;height:24px;padding:0 4px;border-radius:12px;display:flex;align-items:center;" +
    "justify-content:center;font:600 11px/1 system-ui;color:#fff;cursor:pointer;" +
    "border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)";
  return el;
}

function markerFaerben(el: HTMLElement, ausgewaehlt: boolean) {
  el.style.background = ausgewaehlt ? "#b4235a" : "#2b711e";
  el.style.zIndex = ausgewaehlt ? "2" : "1";
  el.style.outline = ausgewaehlt ? "3px solid rgba(180,35,90,.35)" : "none";
}

export default function StandKarte({
  staende,
  auswahlId,
  entwurf,
  bearbeitbar,
  fokus,
  onWaehlen,
  onPosition,
  hoehe = "h-[70vh]",
}: {
  staende: VtStand[];
  auswahlId: number | null;
  /** Ungespeicherte Position/Radius des ausgewählten Stands */
  entwurf: StandEntwurf | null;
  bearbeitbar: boolean;
  /** Kartenausschnitt: neues Objekt (ts) je Aufruf */
  fokus: { lat: number; lng: number; zoom: number; ts: number } | null;
  onWaehlen: (id: number) => void;
  onPosition: (lat: number, lng: number) => void;
  hoehe?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef(new Map<number, maplibregl.Marker>());
  const [bereit, setBereit] = useState(false);
  const erstesEinpassen = useRef(false);
  // aktuelle Rückrufe/Werte für die einmalig registrierten Karten-Ereignisse
  const aktuell = useRef({ auswahlId, bearbeitbar, onWaehlen, onPosition });
  aktuell.current = { auswahlId, bearbeitbar, onWaehlen, onPosition };

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
      zoom: 8,
      maxZoom: 21,
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
        maxzoom: 19,
        attribution: "© Esri, Maxar, Earthstar Geographics",
      });
      map.addLayer({ id: "satellit", type: "raster", source: "satellit" }, "osm");
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

      map.addSource("radien", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "radien-flaeche",
        type: "fill",
        source: "radien",
        paint: {
          "fill-color": ["case", ["get", "auswahl"], "#b4235a", "#2b711e"],
          "fill-opacity": ["case", ["get", "auswahl"], 0.2, 0.12],
        },
      });
      map.addLayer({
        id: "radien-rand",
        type: "line",
        source: "radien",
        paint: {
          "line-color": ["case", ["get", "auswahl"], "#b4235a", "#2b711e"],
          "line-width": ["case", ["get", "auswahl"], 2.5, 1.5],
        },
      });
      setBereit(true);
    });

    // Klick in die Karte versetzt den ausgewählten Stand (nicht beim Klick
    // auf einen anderen Stand-Punkt - der wählt aus).
    map.on("click", (e) => {
      const ziel = e.originalEvent.target as HTMLElement | null;
      if (ziel?.closest(".vt-stand-marker")) return;
      const a = aktuell.current;
      if (a.auswahlId !== null && a.bearbeitbar) a.onPosition(e.lngLat.lat, e.lngLat.lng);
    });

    const marker = markerRef.current;
    return () => {
      marker.forEach((m) => m.remove());
      marker.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Punkte und Radien abgleichen
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const marker = markerRef.current;
    const position = (s: VtStand) =>
      s.id === auswahlId && entwurf ? { lat: entwurf.lat, lng: entwurf.lng } : { lat: s.lat, lng: s.lng };

    const gesehen = new Set<number>();
    for (const s of staende) {
      const p = position(s);
      if (p.lat === null || p.lng === null) continue;
      gesehen.add(s.id);
      let m = marker.get(s.id);
      if (!m) {
        const el = markerElement(s.nummer);
        el.title = s.name;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          aktuell.current.onWaehlen(s.id);
        });
        m = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
        m.on("dragend", () => {
          const ll = m!.getLngLat();
          aktuell.current.onPosition(ll.lat, ll.lng);
        });
        marker.set(s.id, m);
      }
      m.setLngLat([p.lng, p.lat]);
      const el = m.getElement();
      el.textContent = String(s.nummer);
      el.title = s.name;
      markerFaerben(el, s.id === auswahlId);
      m.setDraggable(s.id === auswahlId && bearbeitbar);
    }
    marker.forEach((m, id) => {
      if (!gesehen.has(id)) {
        m.remove();
        marker.delete(id);
      }
    });

    const features = staende.flatMap((s) => {
      const p = position(s);
      if (p.lat === null || p.lng === null) return [];
      const r = s.id === auswahlId && entwurf ? entwurf.radius_m : s.radius_m;
      return [
        {
          type: "Feature" as const,
          properties: { auswahl: s.id === auswahlId },
          geometry: { type: "Polygon" as const, coordinates: [kreis(p.lat, p.lng, r)] },
        },
      ];
    });
    (map.getSource("radien") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });

    // Beim ersten Laden alle Stände einpassen
    if (!erstesEinpassen.current) {
      const mitPos = staende.filter((s) => s.lat !== null && s.lng !== null);
      if (mitPos.length) {
        erstesEinpassen.current = true;
        const b = new maplibregl.LngLatBounds();
        mitPos.forEach((s) => b.extend([s.lng!, s.lat!]));
        map.fitBounds(b, { padding: 40, maxZoom: 16, duration: 0 });
      }
    }
  }, [staende, auswahlId, entwurf, bearbeitbar, bereit]);

  useEffect(() => {
    if (!fokus || !mapRef.current) return;
    mapRef.current.flyTo({ center: [fokus.lng, fokus.lat], zoom: fokus.zoom, speed: 1.6 });
  }, [fokus]);

  return <div ref={containerRef} className={`${hoehe} w-full overflow-hidden rounded border border-linie`} />;
}
