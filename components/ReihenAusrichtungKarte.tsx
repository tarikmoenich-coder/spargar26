"use client";

// Werkzeug zum Einzeichnen der ERSTEN und LETZTEN Spargel-Reihe eines
// Abschnitts (jeweils exakt auf der echten Reihe) und zum serverseitigen
// Berechnen aller dazwischenliegenden, parallelen Reihen (RPC
// feld_reihen_aus_ausrichtung_berechnen) - liefert exakte Reihenzahl,
// Laufmeter gesamt und Reihenlänge Min/Max/Ø aus der echten, auch unförmigen
// Geometrie statt einer groben Schätzung.
//
// Nutzer-Vorgabe 2026-10-31: statt EINER Ausrichtungslinie + einem pauschalen
// 3m-Randabstand (der bei unförmigen Konturen mal zu viel, mal zu wenig
// abschnitt) zeichnet der Nutzer die erste UND die letzte echte Reihe von
// Hand nach - die Reihenzahl ergibt sich dann aus dem Abstand zwischen
// beiden Linien geteilt durch den Reihenabstand, die Zwischen-Reihen liegen
// exakt gleichmäßig dazwischen. Robust, weil beide Außengrenzen echte,
// nachgezeichnete Reihen sind statt einer geschätzten Marge.
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
  linieErsteGeojson: string;
  linieLetzteGeojson: string;
  versatzM: number;
}

export interface ReihenAusrichtungKarteProps {
  feldId: number;
  feldGeometrieGeojson: string | null;
  reihenabstandM: number | null;
  bestehendeErsteLinieGeojson?: string | null;
  bestehendeLetzteLinieGeojson?: string | null;
  /** Zuletzt übernommener seitlicher Versatz (10cm-Schritte) - beim
   *  erneuten Öffnen voreingestellt, damit nicht wieder bei 0 begonnen wird. */
  bestehenderVersatzM?: number;
  onUebernehmen: (ergebnis: ReihenErgebnis) => void;
}

const VERSATZ_SCHRITT_M = 0.1;

function aussenringe(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Position[][] {
  return geom.type === "MultiPolygon"
    ? geom.coordinates.map((polygon) => polygon[0] ?? [])
    : [geom.coordinates?.[0] ?? []];
}

type ZeichnenModus = "erste" | "letzte" | null;

export default function ReihenAusrichtungKarte({
  feldId,
  feldGeometrieGeojson,
  reihenabstandM,
  bestehendeErsteLinieGeojson,
  bestehendeLetzteLinieGeojson,
  bestehenderVersatzM,
  onUebernehmen,
}: ReihenAusrichtungKarteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [bereit, setBereit] = useState(false);
  const [zeichnenModus, setZeichnenModus] = useState<ZeichnenModus>(null);
  const zeichnenModusRef = useRef<ZeichnenModus>(null);
  const [punkteErste, setPunkteErste] = useState<[number, number][]>([]);
  const punkteErsteRef = useRef<[number, number][]>([]);
  const [punkteLetzte, setPunkteLetzte] = useState<[number, number][]>([]);
  const punkteLetzteRef = useRef<[number, number][]>([]);
  const [versatz, setVersatz] = useState(bestehenderVersatzM ?? 0);
  const [teilstuecke, setTeilstuecke] = useState<FeldReihenTeilstueck[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    zeichnenModusRef.current = zeichnenModus;
  }, [zeichnenModus]);
  useEffect(() => {
    punkteErsteRef.current = punkteErste;
  }, [punkteErste]);
  useEffect(() => {
    punkteLetzteRef.current = punkteLetzte;
  }, [punkteLetzte]);

  // Beim Öffnen mit schon gespeicherten Linien direkt die zuletzt
  // berechneten Reihen (inkl. Versatz) anzeigen, statt den Nutzer zum
  // erneuten Zeichnen zu zwingen. Ist nur die erste Linie vorhanden (ältere,
  // vor dieser Umstellung berechnete Abschnitte), wird nur sie vorbelegt -
  // der Nutzer zeichnet dann nur noch die letzte Reihe neu.
  useEffect(() => {
    try {
      if (bestehendeErsteLinieGeojson) {
        const geomA = JSON.parse(bestehendeErsteLinieGeojson) as GeoJSON.LineString;
        const pktA = geomA.coordinates as [number, number][];
        if (pktA.length === 2) {
          setPunkteErste(pktA);
          punkteErsteRef.current = pktA;
        }
      }
      if (bestehendeLetzteLinieGeojson) {
        const geomB = JSON.parse(bestehendeLetzteLinieGeojson) as GeoJSON.LineString;
        const pktB = geomB.coordinates as [number, number][];
        if (pktB.length === 2) {
          setPunkteLetzte(pktB);
          punkteLetzteRef.current = pktB;
        }
      }
      if (punkteErsteRef.current.length === 2 && punkteLetzteRef.current.length === 2) {
        berechnenMit(punkteErsteRef.current, punkteLetzteRef.current, bestehenderVersatzM ?? 0);
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

      // Erste Reihe - blau gestrichelt (auch als Referenz beim erneuten
      // Öffnen, siehe Mount-Effekt oben).
      map.addSource("linie-erste", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: "linie-erste",
        type: "line",
        source: "linie-erste",
        paint: { "line-color": "#1d4ed8", "line-width": 2, "line-dasharray": [2, 1] },
      });
      map.addSource("punkte-erste", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "punkte-erste",
        type: "circle",
        source: "punkte-erste",
        paint: { "circle-radius": 5, "circle-color": "#1d4ed8", "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
      });

      // Letzte Reihe - orange gestrichelt.
      map.addSource("linie-letzte", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: "linie-letzte",
        type: "line",
        source: "linie-letzte",
        paint: { "line-color": "#d97706", "line-width": 2, "line-dasharray": [2, 1] },
      });
      map.addSource("punkte-letzte", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "punkte-letzte",
        type: "circle",
        source: "punkte-letzte",
        paint: { "circle-radius": 5, "circle-color": "#d97706", "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
      });

      map.on("click", (e) => {
        const modus = zeichnenModusRef.current;
        if (!modus) return;
        const punkt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (modus === "erste") {
          const neu = [...punkteErsteRef.current, punkt];
          punkteErsteRef.current = neu;
          setPunkteErste(neu);
          if (neu.length >= 2) {
            zeichnenModusRef.current = null;
            setZeichnenModus(null);
          }
        } else {
          const neu = [...punkteLetzteRef.current, punkt];
          punkteLetzteRef.current = neu;
          setPunkteLetzte(neu);
          if (neu.length >= 2) {
            zeichnenModusRef.current = null;
            setZeichnenModus(null);
          }
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
    map.getCanvas().style.cursor = zeichnenModus ? "crosshair" : "";
  }, [zeichnenModus, bereit]);

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

  // Erste Reihe (live beim Zeichnen + als Referenz nach dem Laden).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const linieSrc = map.getSource("linie-erste") as maplibregl.GeoJSONSource | undefined;
    const punkteSrc = map.getSource("punkte-erste") as maplibregl.GeoJSONSource | undefined;
    if (!linieSrc || !punkteSrc) return;
    punkteSrc.setData({
      type: "FeatureCollection",
      features: punkteErste.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} })),
    });
    linieSrc.setData({ type: "Feature", geometry: { type: "LineString", coordinates: punkteErste }, properties: {} });
  }, [punkteErste, bereit]);

  // Letzte Reihe (live beim Zeichnen + als Referenz nach dem Laden).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bereit) return;
    const linieSrc = map.getSource("linie-letzte") as maplibregl.GeoJSONSource | undefined;
    const punkteSrc = map.getSource("punkte-letzte") as maplibregl.GeoJSONSource | undefined;
    if (!linieSrc || !punkteSrc) return;
    punkteSrc.setData({
      type: "FeatureCollection",
      features: punkteLetzte.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} })),
    });
    linieSrc.setData({ type: "Feature", geometry: { type: "LineString", coordinates: punkteLetzte }, properties: {} });
  }, [punkteLetzte, bereit]);

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

  // Kompletter Neustart - beide Linien verwerfen, erste Reihe zuerst.
  function zeichnenStarten() {
    setZeichnenModus("erste");
    setPunkteErste([]);
    setPunkteLetzte([]);
    setTeilstuecke([]);
    setVersatz(0);
    setFehler(null);
  }

  function letzteZeichnenStarten() {
    setZeichnenModus("letzte");
    setPunkteLetzte([]);
    setTeilstuecke([]);
    setFehler(null);
  }

  function zeichnenAbbrechen() {
    if (zeichnenModus === "erste") setPunkteErste([]);
    else if (zeichnenModus === "letzte") setPunkteLetzte([]);
    setZeichnenModus(null);
  }

  // Zentrale Berechnen-Funktion - sowohl für den ersten "Berechnen"-Klick
  // nach dem Zeichnen beider Linien als auch für jeden Pfeiltasten-Versatz-
  // Schritt (gleiche gezeichnete Linien, nur ein anderer p_versatz_m).
  async function berechnenMit(erste: [number, number][], letzte: [number, number][], versatzWert: number) {
    if (erste.length !== 2 || letzte.length !== 2 || !reihenabstandM) return;
    setLaeuft(true);
    setFehler(null);
    const { data, error } = await getSupabaseClient().rpc("feld_reihen_aus_ausrichtung_berechnen", {
      p_feld_id: feldId,
      p_linie_erste_geojson: JSON.stringify({ type: "LineString", coordinates: erste }),
      p_linie_letzte_geojson: JSON.stringify({ type: "LineString", coordinates: letzte }),
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
      setFehler("Keine Reihen gefunden - liegen beide Linien auf dem Feld, oder wurde zu weit verschoben?");
      return;
    }
    setVersatz(versatzWert);
    setTeilstuecke(liste);
  }

  function berechnen() {
    berechnenMit(punkteErste, punkteLetzte, 0);
  }

  function versatzAendern(richtung: 1 | -1) {
    if (punkteErste.length !== 2 || punkteLetzte.length !== 2) return;
    berechnenMit(punkteErste, punkteLetzte, Math.round((versatz + richtung * VERSATZ_SCHRITT_M) * 100) / 100);
  }

  const laengen = teilstuecke.map((t) => t.laenge_m);
  const laufmeterGesamt = laengen.reduce((s, l) => s + l, 0);
  const laengeAvg = laengen.length > 0 ? laufmeterGesamt / laengen.length : 0;
  const laengeMin = laengen.length > 0 ? Math.min(...laengen) : 0;
  const laengeMax = laengen.length > 0 ? Math.max(...laengen) : 0;

  function uebernehmen() {
    if (punkteErste.length !== 2 || punkteLetzte.length !== 2 || teilstuecke.length === 0) return;
    onUebernehmen({
      reihenAnzahl: teilstuecke.length,
      laengeMin,
      laengeMax,
      laengeAvg,
      laufmeterGesamt,
      linieErsteGeojson: JSON.stringify({ type: "LineString", coordinates: punkteErste }),
      linieLetzteGeojson: JSON.stringify({ type: "LineString", coordinates: punkteLetzte }),
      versatzM: versatz,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {zeichnenModus === null && punkteErste.length < 2 && (
          <button type="button" className="btn-secondary text-xs" onClick={zeichnenStarten}>
            📍 Erste Reihe einzeichnen
          </button>
        )}
        {zeichnenModus === "erste" && (
          <>
            <span className="text-xs text-neutral-500">
              Entlang der <strong>ersten</strong> echten Reihe auf die Karte klicken ({punkteErste.length}/2 Punkte
              gesetzt).
            </span>
            <button type="button" className="btn-secondary text-xs" onClick={zeichnenAbbrechen}>
              Abbrechen
            </button>
          </>
        )}
        {zeichnenModus === null && punkteErste.length === 2 && punkteLetzte.length < 2 && (
          <>
            <button type="button" className="btn-secondary text-xs" onClick={letzteZeichnenStarten}>
              📍 Letzte Reihe einzeichnen
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={zeichnenStarten}>
              Von vorn
            </button>
          </>
        )}
        {zeichnenModus === "letzte" && (
          <>
            <span className="text-xs text-neutral-500">
              Entlang der <strong>letzten</strong> echten Reihe auf die Karte klicken ({punkteLetzte.length}/2 Punkte
              gesetzt).
            </span>
            <button type="button" className="btn-secondary text-xs" onClick={zeichnenAbbrechen}>
              Abbrechen
            </button>
          </>
        )}
        {zeichnenModus === null && punkteErste.length === 2 && punkteLetzte.length === 2 && teilstuecke.length === 0 && (
          <>
            <button type="button" className="btn text-xs" disabled={laeuft || !reihenabstandM} onClick={berechnen}>
              {laeuft ? "Berechnet…" : "Berechnen"}
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={zeichnenStarten}>
              Neu zeichnen
            </button>
          </>
        )}
        {zeichnenModus === null && teilstuecke.length > 0 && (
          <button type="button" className="btn-secondary text-xs" onClick={zeichnenStarten}>
            Neu zeichnen
          </button>
        )}
      </div>
      {teilstuecke.length === 0 && (
        <p className="text-xs text-neutral-500">
          Erste (blau) und letzte (orange) echte Reihe exakt nachzeichnen - alle Reihen dazwischen werden im
          eingetragenen Reihenabstand errechnet, ohne pauschale Randmarge.
        </p>
      )}
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
          <span className="flex items-center gap-1 border-l border-linie pl-3">
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs"
              disabled={laeuft}
              title="Alle Reihen gemeinsam um 10cm verschieben (z.B. näher zum/weiter vom Nachbarn weg) - Reihen, die dadurch ganz aus dem Feld wandern, verschwinden aus der Liste."
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
          <button type="button" className="btn text-xs" onClick={uebernehmen}>
            Übernehmen
          </button>
        </div>
      )}
    </div>
  );
}
