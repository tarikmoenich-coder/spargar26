"use client";

// Kartenansicht für die Spargelspinnen (docs/erntewirtschaft-plan.md Teil F,
// Nutzer-Vorgabe 2026-10-27: "besonders wichtig"). Erste, bewusst schlanke
// Scheibe - nur Marker + Online/Offline-Ampel + Popup, noch KEINE Clusterung
// (heute 1 Pilotmaschine, Clusterung ist ein eigener, späterer Ausbauschritt
// für den 140er-Rollout, siehe components/FahrzeugKarte.tsx für das Muster,
// sobald es gebraucht wird).
//
// Eigene, kleine Kopie von BasiskartenControl statt einer gemeinsamen Basis
// mit FahrzeugKarte.tsx/FeldKarte.tsx - gleiche Konvention wie dort (siehe
// deren eigene Begründungskommentare): jede Karte ist für sich klein genug,
// dass ein Teilen mehr Kopplung als Nutzen bringt.

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatMenge } from "@/lib/format";
import type { FeldGeojson } from "@/lib/types";

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
  private index = 0; // Start: OpenStreetMap (bisheriges Verhalten).

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

// Schwellen aus ernte_konfig.offline_warn_min/offline_alarm_min (5/10) -
// hier als Konstante statt eines eigenen Requests, die Werte ändern sich in
// der Praxis quasi nie; bei Bedarf später aus ernte_konfig nachladbar.
const OFFLINE_WARN_MIN = 5;
const OFFLINE_ALARM_MIN = 10;

function ampel(min: number | null): string {
  if (min === null || min >= OFFLINE_ALARM_MIN) return "#9ca3af";
  if (min >= OFFLINE_WARN_MIN) return "#d97706";
  return "#16a34a";
}

// Label-Punkt für den Feldnamen - bewusst die Mitte der Bounding-Box statt
// eines echten Flaechenschwerpunkts (keine zusaetzliche Geometrie-Bibliothek
// noetig, fuer die meist recht kompakten Feldformen eine gute Naeherung).
// Gleiche Ring-Extraktion wie in components/FeldKarte.tsx ("aussenringe"),
// bei MultiPolygon ueber alle Teilflaechen hinweg - ein Label je Feld.
function feldMittelpunkt(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] | null {
  const aussenringe: GeoJSON.Position[][] =
    geom.type === "MultiPolygon"
      ? geom.coordinates.map((polygon) => polygon[0] ?? [])
      : [geom.coordinates?.[0] ?? []];
  const alle = aussenringe.flat();
  if (alle.length === 0) return null;
  const lngs = alle.map((p) => p[0]);
  const lats = alle.map((p) => p[1]);
  return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

export interface MaschineLive {
  maschine_id: number;
  nummer: string;
  bezeichnung: string | null;
  max_personen: number;
  lat: number | null;
  lng: number | null;
  position_zeitpunkt: string | null;
  aktive_personen: number;
  kg_heute: number;
}

interface AngemeldetePerson {
  name: string;
  vorname: string;
  personal_nr: string;
  fotoUrl: string | null;
}

const FOTO_BUCKET = "mitarbeiter-fotos";

async function ladeAngemeldetePersonen(maschineId: number): Promise<AngemeldetePerson[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ernte_schicht")
    .select("employees(name, vorname, personal_nr, foto_pfad)")
    .eq("maschine_id", maschineId)
    .is("ende", null);
  if (error || !data) return [];

  const zeilen = data as unknown as {
    employees: { name: string; vorname: string; personal_nr: string; foto_pfad: string | null } | null;
  }[];

  return Promise.all(
    zeilen
      .filter((z) => z.employees)
      .map(async (z) => {
        const e = z.employees!;
        let fotoUrl: string | null = null;
        if (e.foto_pfad) {
          const { data: signiert } = await supabase.storage
            .from(FOTO_BUCKET)
            .createSignedUrl(e.foto_pfad, 60);
          fotoUrl = signiert?.signedUrl ?? null;
        }
        return { name: e.name, vorname: e.vorname, personal_nr: e.personal_nr, fotoUrl };
      })
  );
}

function popupHtmlGeruest(m: MaschineLive): string {
  return `
    <div style="font:400 12px/1.45 system-ui">
      <div style="font-weight:600">${m.bezeichnung || m.nummer}</div>
      <div>kg heute: ${formatMenge(m.kg_heute, 1)}</div>
      <div>${m.aktive_personen}/${m.max_personen} angemeldet</div>
      <div style="color:#6b7280">zuletzt: ${vorText(minutenHer(m.position_zeitpunkt))}</div>
      <div data-personen style="margin-top:6px">Lädt…</div>
    </div>`;
}

function personenHtml(personen: AngemeldetePerson[]): string {
  if (personen.length === 0) return `<div style="color:#6b7280">Niemand angemeldet</div>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:6px">${personen
    .map(
      (p) => `
        <div style="display:flex;flex-direction:column;align-items:center;width:56px">
          ${
            p.fotoUrl
              ? `<img src="${p.fotoUrl}" alt="" style="width:40px;height:40px;border-radius:9999px;object-fit:cover;border:1px solid #e6e1d5" />`
              : `<div style="width:40px;height:40px;border-radius:9999px;background:#f1efe8;border:1px solid #e6e1d5"></div>`
          }
          <div style="font-size:10px;text-align:center;line-height:1.2;margin-top:2px">${p.vorname} ${p.name}</div>
        </div>`
    )
    .join("")}</div>`;
}

export default function ErnteMaschinenKarte({
  maschinen,
  felder,
}: {
  maschinen: MaschineLive[];
  felder: FeldGeojson[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const feldLabelMarkersRef = useRef<maplibregl.Marker[]>([]);
  // Nur beim allerersten Laden mit Positionsdaten auf die Flotte zoomen -
  // sonst wuerde jeder 15s-Refresh (Nutzer-Meldung 2026-10-28) den
  // Kartenausschnitt zuruecksetzen, waehrend man gerade selbst navigiert.
  const autoGezoomtRef = useRef(false);
  const [bereit, setBereit] = useState(false);

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
      zoom: 13,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

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
        { id: "satellit", type: "raster", source: "satellit", layout: { visibility: "none" } },
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

      // Feld-Geometrien aus /anbau/felder (Nutzer-Vorgabe 2026-10-28) - reine
      // Orientierungsflächen, nicht anklickbar/kein Popup. Der Feldname wird
      // NICHT per MapLibre-Symbol-Layer gesetzt (bräuchte eine "glyphs"-
      // Schriftquelle in der Style-Definition, die diese Karte - wie
      // FahrzeugKarte/FeldKarte auch - bewusst nicht hat), sondern wie die
      // Maschinen-Labels als einfacher HTML-Marker in der Mitte der Fläche
      // (siehe feldLabelsRef unten).
      map.addSource("felder", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "felder-flaeche",
        type: "fill",
        source: "felder",
        paint: { "fill-color": "#2b711e", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "felder-rand",
        type: "line",
        source: "felder",
        paint: { "line-color": "#2b711e", "line-width": 1.5, "line-opacity": 0.6 },
      });

      map.addControl(new BasiskartenControl(), "top-right");
      setBereit(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setBereit(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;

    const mitPosition = maschinen.filter((m) => m.lat != null && m.lng != null);
    const behalten = new Set<number>();

    for (const m of mitPosition) {
      behalten.add(m.maschine_id);
      const farbe = ampel(minutenHer(m.position_zeitpunkt));

      let marker = markersRef.current.get(m.maschine_id);
      let el: HTMLDivElement;
      if (!marker) {
        el = document.createElement("div");
        el.style.cursor = "pointer";
        marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([
          m.lng!,
          m.lat!,
        ]);
        const popup = new maplibregl.Popup({ offset: 14, maxWidth: "240px" });
        marker.setPopup(popup);
        popup.on("open", () => {
          void ladeAngemeldetePersonen(m.maschine_id).then((personen) => {
            const el2 = popup.getElement()?.querySelector("[data-personen]");
            if (el2) el2.outerHTML = `<div data-personen>${personenHtml(personen)}</div>`;
          });
        });
        marker.addTo(map);
        markersRef.current.set(m.maschine_id, marker);
      } else {
        el = marker.getElement() as HTMLDivElement;
        marker.setLngLat([m.lng!, m.lat!]);
      }

      el.innerHTML = `
        <div style="width:16px;height:16px;border-radius:9999px;background:${farbe};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>
        <div style="position:absolute;left:22px;top:50%;transform:translateY(-50%);background:#fff;border:1px solid #e6e1d5;border-radius:6px;padding:1px 5px;font:600 11px/1.3 system-ui;box-shadow:0 1px 2px rgba(0,0,0,.15);white-space:nowrap">${
          m.bezeichnung || m.nummer
        }${m.max_personen > 1 ? ` · ${m.aktive_personen}/${m.max_personen}` : ""}</div>`;

      // Waehrend ein Popup offen ist, dessen Inhalt nicht per Refresh
      // ueberschreiben - sonst faellt die schon nachgeladene Personen-Liste
      // zurueck auf "Laedt...", weil das "open"-Ereignis nur einmal feuert.
      const popup = marker.getPopup();
      if (popup && !popup.isOpen()) {
        popup.setHTML(popupHtmlGeruest(m));
      }
    }

    markersRef.current.forEach((marker, id) => {
      if (!behalten.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    if (!autoGezoomtRef.current && mitPosition.length > 0) {
      autoGezoomtRef.current = true;
      const b = new maplibregl.LngLatBounds();
      mitPosition.forEach((m) => b.extend([m.lng!, m.lat!]));
      map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 0 });
    }
  }, [maschinen, bereit]);

  // Feld-Geometrien + Namens-Label in der Mitte jeder Fläche.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const quelle = map.getSource("felder") as maplibregl.GeoJSONSource | undefined;
    if (!quelle) return;

    feldLabelMarkersRef.current.forEach((m) => m.remove());
    feldLabelMarkersRef.current = [];

    const features: GeoJSON.Feature[] = [];
    for (const f of felder) {
      if (!f.geometrie_geojson) continue;
      let geom: GeoJSON.Polygon | GeoJSON.MultiPolygon;
      try {
        geom = JSON.parse(f.geometrie_geojson);
      } catch {
        continue;
      }
      features.push({ type: "Feature", geometry: geom, properties: { id: f.id } });

      const mitte = feldMittelpunkt(geom);
      if (!mitte) continue;
      const el = document.createElement("div");
      el.style.pointerEvents = "none";
      el.style.whiteSpace = "nowrap";
      el.style.font = "600 11px/1.3 system-ui";
      el.style.color = "#1f4d16";
      el.style.textShadow =
        "0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff";
      el.textContent = f.bezeichnung;
      const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(mitte).addTo(map);
      feldLabelMarkersRef.current.push(marker);
    }
    quelle.setData({ type: "FeatureCollection", features });
  }, [felder, bereit]);

  return (
    <div
      ref={containerRef}
      className="h-[60vh] w-full overflow-hidden rounded-lg border border-linie"
    />
  );
}
