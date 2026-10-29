"use client";

// Werkzeug zum Einzeichnen EINER Richtungslinie (Position + Richtung einer
// Spargel-Reihe) und zum serverseitigen Erzeugen ALLER dazu parallelen
// Reihen übers ganze Feld (RPC feld_reihen_aus_ausrichtung_berechnen) -
// anschließend wählt der Nutzer per Mausklick auf der Karte die erste und
// letzte ECHTE Reihe aus, alles außerhalb dieser Auswahl entfällt. Liefert
// so exakte Reihenzahl, Laufmeter gesamt und Reihenlänge Min/Max/Ø aus der
// echten, auch unförmigen Geometrie statt einer groben Schätzung.
//
// Nutzer-Vorgabe 2026-10-31: einfacher und robuster als sowohl ein
// pauschaler 3m-Randabstand (ST_Buffer) als auch das Von-Hand-Nachzeichnen
// zweier Grenz-Reihen - eine Linie genügt für die Richtung, die Grenzen
// werden aus dem bereits berechneten, echten Streifen ausgewählt statt neu
// (und evtl. ungenau) nachgezeichnet. Der seitliche Versatz (Pfeiltasten)
// bleibt vor UND nach der Auswahl nutzbar.
//
// Eigene, schlanke Kopie der Kartenbausteine aus components/FeldKarte.tsx
// (OSM/Satellit-Umschalter, Klick-für-Klick-Zeichnen) - bewusst dupliziert
// statt FeldKarte mit einem zweiten, fachlich andersartigen Zweck (Reihen-
// Ausrichtung statt Feldgrenze zeichnen) zu überladen, siehe Begründung dort.

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatMenge } from "@/lib/format";
import type { FeldReihenTeilstueck } from "@/lib/types";

// Drei Kartenhintergründe zum Durchklicken - Esri-Satellit ist oft 1-3 Jahre
// alt; das amtliche Hessen-Luftbild (HVBG, Open Data) ist für Flurstücke in
// Hessen meist aktueller und höher aufgelöst (Nutzer-Anfrage 2026-10-31) -
// gerade hier wichtig, um die gezeichnete Richtungslinie wirklich auf die
// echten, aktuellen Reihen zu legen.
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

export interface ReihenErgebnis {
  reihenAnzahl: number;
  laengeMin: number;
  laengeMax: number;
  laengeAvg: number;
  laufmeterGesamt: number;
  linieGeojson: string;
  versatzM: number;
  ersterIndex: number;
  letzterIndex: number;
}

export interface ReihenAusrichtungKarteProps {
  feldId: number;
  feldGeometrieGeojson: string | null;
  reihenabstandM: number | null;
  bestehendeLinieGeojson?: string | null;
  /** Zuletzt übernommener seitlicher Versatz (10cm-Schritte) - beim
   *  erneuten Öffnen voreingestellt, damit nicht wieder bei 0 begonnen wird. */
  bestehenderVersatzM?: number;
  /** Zuletzt übernommene Auswahl (reihen_index) - beim erneuten Öffnen
   *  direkt wieder angewandt, statt neu auswählen zu müssen. */
  bestehenderErsterIndex?: number | null;
  bestehenderLetzterIndex?: number | null;
  onUebernehmen: (ergebnis: ReihenErgebnis) => void;
}

const VERSATZ_SCHRITT_M = 0.1;

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
  bestehenderVersatzM,
  bestehenderErsterIndex,
  bestehenderLetzterIndex,
  onUebernehmen,
}: ReihenAusrichtungKarteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [bereit, setBereit] = useState(false);
  const [zeichnen, setZeichnen] = useState(false);
  const [punkte, setPunkte] = useState<[number, number][]>([]);
  const zeichnenRef = useRef(false);
  const punkteRef = useRef<[number, number][]>([]);
  const [linie, setLinie] = useState<string | null>(null);
  const [versatz, setVersatz] = useState(bestehenderVersatzM ?? 0);
  const [alleTeilstuecke, setAlleTeilstuecke] = useState<FeldReihenTeilstueck[]>([]);
  const [ersterIndex, setErsterIndex] = useState<number | null>(null);
  const [letzterIndex, setLetzterIndex] = useState<number | null>(null);
  const [bestaetigt, setBestaetigt] = useState(false);
  const ersterIndexRef = useRef<number | null>(null);
  const letzterIndexRef = useRef<number | null>(null);
  const bestaetigtRef = useRef(false);
  const alleTeilstueckeRef = useRef<FeldReihenTeilstueck[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    zeichnenRef.current = zeichnen;
  }, [zeichnen]);
  useEffect(() => {
    punkteRef.current = punkte;
  }, [punkte]);
  useEffect(() => {
    ersterIndexRef.current = ersterIndex;
  }, [ersterIndex]);
  useEffect(() => {
    letzterIndexRef.current = letzterIndex;
  }, [letzterIndex]);
  useEffect(() => {
    bestaetigtRef.current = bestaetigt;
  }, [bestaetigt]);
  useEffect(() => {
    alleTeilstueckeRef.current = alleTeilstuecke;
  }, [alleTeilstuecke]);

  const ausgewaehlt = useMemo(() => {
    if (ersterIndex === null || letzterIndex === null) return [];
    const min = Math.min(ersterIndex, letzterIndex);
    const max = Math.max(ersterIndex, letzterIndex);
    return alleTeilstuecke.filter((t) => t.reihen_index >= min && t.reihen_index <= max);
  }, [alleTeilstuecke, ersterIndex, letzterIndex]);

  // Beim Öffnen mit einer schon gespeicherten Richtungslinie direkt den
  // Streifen neu erzeugen und - falls vorhanden - die zuletzt übernommene
  // Auswahl (inkl. Versatz) wieder anwenden, statt den Nutzer zum erneuten
  // Zeichnen/Auswählen zu zwingen.
  useEffect(() => {
    if (!bestehendeLinieGeojson) return;
    try {
      const geom = JSON.parse(bestehendeLinieGeojson) as GeoJSON.LineString;
      const pkte = geom.coordinates as [number, number][];
      if (pkte.length === 2) {
        setPunkte(pkte);
        punkteRef.current = pkte;
        streifenErzeugen(pkte, bestehenderVersatzM ?? 0).then(() => {
          if (bestehenderErsterIndex != null && bestehenderLetzterIndex != null) {
            setErsterIndex(bestehenderErsterIndex);
            setLetzterIndex(bestehenderLetzterIndex);
            setBestaetigt(true);
          }
        });
      }
    } catch {
      // ungültiges/leeres GeoJSON - ignorieren, Nutzer zeichnet neu.
    }
    // Nur beim Mounten/Öffnen des Panels relevant - läuft bewusst nicht bei
    // jeder Prop-Änderung erneut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        "osm",
      );

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

      // Der ganze erzeugte Streifen (vor Auswahl) bzw. nur noch die
      // ausgewählten Reihen (nach Auswahl) - grün, anklickbar zur Auswahl.
      map.addSource("berechnet", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "berechnet-linien",
        type: "line",
        source: "berechnet",
        paint: { "line-color": "#15803d", "line-width": 2 },
      });

      // Hervorhebung der per Klick gewählten ersten (blau) / letzten
      // (orange) Reihe - bleibt auch nach dem Zuschneiden als Orientierung.
      map.addSource("auswahl-marker", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "auswahl-marker",
        type: "line",
        source: "auswahl-marker",
        paint: {
          "line-color": ["match", ["get", "rolle"], "erste", "#1d4ed8", "letzte", "#d97706", "#999999"],
          "line-width": 4,
        },
      });

      // Laufender Richtungslinien-Entwurf - rot, gestrichelt (gleiches
      // Muster wie FeldKarte's Polygon-Entwurf, hier als Linie statt Fläche).
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

      map.on("click", (e) => {
        if (zeichnenRef.current) {
          const neu: [number, number][] = [...punkteRef.current, [e.lngLat.lng, e.lngLat.lat]];
          punkteRef.current = neu;
          setPunkte(neu);
          if (neu.length >= 2) {
            // Genau 2 Punkte nötig (Position + Richtung) - Zeichnen-Modus
            // endet automatisch, der Streifen wird sofort erzeugt.
            zeichnenRef.current = false;
            setZeichnen(false);
            streifenErzeugen(neu, 0);
          }
          return;
        }

        // Auswahl-Modus: auf eine bereits berechnete Reihe klicken, um sie
        // als erste/letzte Grenze zu markieren. Nach dem Bestätigen
        // ("Berechnen") sind Klicks gesperrt - erst "Auswahl ändern" öffnet
        // sie wieder.
        if (bestaetigtRef.current || alleTeilstueckeRef.current.length === 0) return;
        const feats = map.queryRenderedFeatures(
          [
            [e.point.x - 5, e.point.y - 5],
            [e.point.x + 5, e.point.y + 5],
          ],
          { layers: ["berechnet-linien"] },
        );
        if (feats.length === 0) return;
        const idx = feats[0].properties?.reihen_index;
        if (typeof idx !== "number") return;
        if (ersterIndexRef.current === null) {
          ersterIndexRef.current = idx;
          setErsterIndex(idx);
        } else {
          // Letzte Reihe setzen/nachjustieren - erste bleibt stehen, bis
          // explizit über "Auswahl zurücksetzen" verworfen.
          letzterIndexRef.current = idx;
          setLetzterIndex(idx);
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

  // Laufender Richtungslinien-Entwurf.
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

  // Der ganze Streifen (vor Auswahl) bzw. nur die Auswahl (danach).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const src = map.getSource("berechnet") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const anzeigen = ausgewaehlt.length > 0 ? ausgewaehlt : alleTeilstuecke;
    src.setData({
      type: "FeatureCollection",
      features: anzeigen.map((t) => ({
        type: "Feature",
        geometry: JSON.parse(t.geom_geojson) as GeoJSON.LineString,
        properties: { reihen_index: t.reihen_index },
      })),
    });
  }, [alleTeilstuecke, ausgewaehlt, bereit]);

  // Hervorhebung der gewählten ersten/letzten Reihe.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const src = map.getSource("auswahl-marker") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const feats: GeoJSON.Feature[] = [];
    if (ersterIndex !== null) {
      const t = alleTeilstuecke.find((x) => x.reihen_index === ersterIndex);
      if (t) feats.push({ type: "Feature", geometry: JSON.parse(t.geom_geojson), properties: { rolle: "erste" } });
    }
    if (letzterIndex !== null) {
      const t = alleTeilstuecke.find((x) => x.reihen_index === letzterIndex);
      if (t) feats.push({ type: "Feature", geometry: JSON.parse(t.geom_geojson), properties: { rolle: "letzte" } });
    }
    src.setData({ type: "FeatureCollection", features: feats });
  }, [ersterIndex, letzterIndex, alleTeilstuecke, bereit]);

  function zeichnenStarten() {
    setZeichnen(true);
    setPunkte([]);
    setLinie(null);
    setAlleTeilstuecke([]);
    setErsterIndex(null);
    setLetzterIndex(null);
    setBestaetigt(false);
    setVersatz(0);
    setFehler(null);
  }

  function zeichnenAbbrechen() {
    setZeichnen(false);
    setPunkte([]);
  }

  // Erzeugt (bzw. nach Versatz-Änderung: erneuert) den ganzen Streifen für
  // die gezeichnete Richtungslinie - unabhängig von einer eventuell schon
  // getroffenen Auswahl (die reihen_index-Werte bleiben über Versatz-
  // Änderungen hinweg stabil, die Auswahl bleibt also gültig).
  async function streifenErzeugen(linienPunkte: [number, number][], versatzWert: number) {
    if (linienPunkte.length !== 2 || !reihenabstandM) return;
    setLaeuft(true);
    setFehler(null);
    const linieGeojson = JSON.stringify({ type: "LineString", coordinates: linienPunkte });
    const { data, error } = await getSupabaseClient().rpc("feld_reihen_aus_ausrichtung_berechnen", {
      p_feld_id: feldId,
      p_linie_geojson: linieGeojson,
      p_reihenabstand_m: reihenabstandM,
      p_versatz_m: versatzWert,
    });
    setLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    const liste = (data as FeldReihenTeilstueck[]) ?? [];
    if (liste.length === 0) {
      setFehler("Keine Reihen gefunden - liegt die Richtungslinie auf dem Feld, oder wurde zu weit verschoben?");
      return;
    }
    setLinie(linieGeojson);
    setVersatz(versatzWert);
    setAlleTeilstuecke(liste);
  }

  function versatzAendern(richtung: 1 | -1) {
    if (!linie) return;
    try {
      const geom = JSON.parse(linie) as GeoJSON.LineString;
      streifenErzeugen(geom.coordinates as [number, number][], Math.round((versatz + richtung * VERSATZ_SCHRITT_M) * 100) / 100);
    } catch {
      // ungültiges linie-JSON sollte nicht vorkommen - ignorieren.
    }
  }

  function auswahlZuruecksetzen() {
    setErsterIndex(null);
    setLetzterIndex(null);
    setBestaetigt(false);
  }

  function berechnen() {
    if (ausgewaehlt.length === 0) return;
    setBestaetigt(true);
  }

  function auswahlAendern() {
    setBestaetigt(false);
  }

  const laengen = ausgewaehlt.map((t) => t.laenge_m);
  const laufmeterGesamt = laengen.reduce((s, l) => s + l, 0);
  const laengeAvg = laengen.length > 0 ? laufmeterGesamt / laengen.length : 0;
  const laengeMin = laengen.length > 0 ? Math.min(...laengen) : 0;
  const laengeMax = laengen.length > 0 ? Math.max(...laengen) : 0;

  function uebernehmen() {
    if (!linie || ersterIndex === null || letzterIndex === null || ausgewaehlt.length === 0) return;
    onUebernehmen({
      reihenAnzahl: ausgewaehlt.length,
      laengeMin,
      laengeMax,
      laengeAvg,
      laufmeterGesamt,
      linieGeojson: linie,
      versatzM: versatz,
      ersterIndex: Math.min(ersterIndex, letzterIndex),
      letzterIndex: Math.max(ersterIndex, letzterIndex),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!zeichnen && punkte.length < 2 && (
          <button type="button" className="btn-secondary text-xs" onClick={zeichnenStarten}>
            📍 Richtungslinie zeichnen
          </button>
        )}
        {zeichnen && (
          <>
            <span className="text-xs text-neutral-500">
              Entlang einer echten Reihe auf die Karte klicken ({punkte.length}/2 Punkte gesetzt) - Richtung und
              ungefähre Lage genügen, der Streifen wird danach übers ganze Feld erzeugt.
            </span>
            <button type="button" className="btn-secondary text-xs" onClick={zeichnenAbbrechen}>
              Abbrechen
            </button>
          </>
        )}
        {!zeichnen && alleTeilstuecke.length > 0 && (
          <button type="button" className="btn-secondary text-xs" onClick={zeichnenStarten}>
            Neu zeichnen
          </button>
        )}
      </div>
      {!reihenabstandM && (
        <p className="text-xs text-beere-700">Bitte zuerst einen Reihenabstand für diese Zeile eintragen.</p>
      )}
      {fehler && <p className="text-sm text-beere-700">{fehler}</p>}
      <div ref={containerRef} className="h-[50vh] w-full overflow-hidden rounded-lg border border-linie" />

      {!zeichnen && alleTeilstuecke.length > 0 && !bestaetigt && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-linie bg-sand p-2 text-sm">
          <span className="text-xs text-neutral-600">
            Auf der Karte zuerst die <strong className="text-blue-700">erste</strong>, dann die{" "}
            <strong className="text-amber-700">letzte</strong> echte Reihe anklicken.
          </span>
          <span className="flex items-center gap-2 text-xs">
            <span>Erste: {ersterIndex === null ? "—" : `#${ersterIndex}`}</span>
            <span>Letzte: {letzterIndex === null ? "—" : `#${letzterIndex}`}</span>
          </span>
          {(ersterIndex !== null || letzterIndex !== null) && (
            <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={auswahlZuruecksetzen}>
              Auswahl zurücksetzen
            </button>
          )}
          <span className="flex items-center gap-1 border-l border-linie pl-3">
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs"
              disabled={laeuft}
              title="Den ganzen Streifen um 10cm verschieben (z.B. näher zum/weiter vom Nachbarn weg)"
              onClick={() => versatzAendern(-1)}
            >
              ◀
            </button>
            <span className="text-xs text-neutral-500">Versatz {formatMenge(versatz * 100, 0)} cm</span>
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs"
              disabled={laeuft}
              onClick={() => versatzAendern(1)}
            >
              ▶
            </button>
          </span>
          <button type="button" className="btn text-xs" disabled={ausgewaehlt.length === 0} onClick={berechnen}>
            Berechnen
          </button>
        </div>
      )}

      {bestaetigt && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-linie bg-sand p-2 text-sm">
          <span>
            <strong>{ausgewaehlt.length}</strong> Reihen(-teilstücke)
          </span>
          <span>
            Ø {formatMenge(laengeAvg, 1)} m ({formatMenge(laengeMin, 1)}–{formatMenge(laengeMax, 1)} m)
          </span>
          <span>Σ {formatMenge(laufmeterGesamt, 1)} lfm</span>
          <span className="flex items-center gap-1 border-l border-linie pl-3">
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs"
              disabled={laeuft}
              title="Den ganzen Streifen um 10cm verschieben (z.B. näher zum/weiter vom Nachbarn weg)"
              onClick={() => versatzAendern(-1)}
            >
              ◀
            </button>
            <span className="text-xs text-neutral-500">Versatz {formatMenge(versatz * 100, 0)} cm</span>
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs"
              disabled={laeuft}
              onClick={() => versatzAendern(1)}
            >
              ▶
            </button>
          </span>
          <button type="button" className="btn-secondary text-xs" onClick={auswahlAendern}>
            Auswahl ändern
          </button>
          <button type="button" className="btn text-xs" onClick={uebernehmen}>
            Übernehmen
          </button>
        </div>
      )}
    </div>
  );
}
