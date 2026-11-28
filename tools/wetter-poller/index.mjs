// Wetter-Poller: holt die DWD-MOSMIX_L-Vorhersage (stündlich, 10 Tage,
// 4x täglich neu) für die nächstgelegenen Vorhersagepunkte der Felder und
// schreibt sie nach Supabase (wetter_station, wetter_stunde, wetter_feld).
// Konzept: docs/wetter-konzept.md. Läuft als systemd-Timer auf dem
// Hetzner-Server, schreibt mit dem Service-Key (die Tabellen haben bewusst
// keine Schreib-Policy).
//
// Quelle: Deutscher Wetterdienst, Open Data (https://opendata.dwd.de) -
// Quellenangabe in der App ist Pflicht (GeoNutzV).
//
// Ein Durchlauf je Aufruf (Type=oneshot). Lädt eine Station nur neu, wenn der
// DWD eine neue Ausgabe hat. DRY_RUN=1: nichts schreiben, nur ausgeben
// (zusammen mit TEST_LAT/TEST_LNG ohne Supabase lauffähig).

import { inflateRawSync } from "node:zlib";
import { readFile, writeFile, stat } from "node:fs/promises";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  STANDORT_LAT,
  STANDORT_LNG,
  AUFBEWAHRUNG_TAGE = "3",
  DRY_RUN,
  TEST_LAT,
  TEST_LNG,
  KATALOG_CACHE = "/var/tmp/mosmix_stationskatalog.cfg",
} = process.env;

const KATALOG_URL =
  "https://www.dwd.de/DE/leistungen/met_verfahren_mosmix/mosmix_stationskatalog.cfg?view=nasPublication&nn=16102";
const KMZ_URL = (id) =>
  `https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/${id}/kml/MOSMIX_L_LATEST_${id}.kmz`;
// nicht weiter als so weit weg nach einem Vorhersagepunkt suchen
const MAX_KM = 40;
const UA = { "User-Agent": "spargar-wetter-poller/1.0" };

const trocken = DRY_RUN === "1";
let supa = null;
if (!trocken || !TEST_LAT) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen.");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function km(a, b) {
  const r = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

// Katalog-Koordinaten stehen als Grad.Minuten (50.03 = 50° 03').
function gradMinuten(x) {
  const v = Number(x);
  const s = Math.sign(v) || 1;
  const a = Math.abs(v);
  const g = Math.trunc(a);
  return s * (g + (Math.round((a - g) * 100) / 60));
}

async function stationsKatalog() {
  let text = null;
  try {
    const st = await stat(KATALOG_CACHE);
    if (Date.now() - st.mtimeMs < 7 * 86400e3) text = await readFile(KATALOG_CACHE, "utf8");
  } catch {}
  if (!text) {
    const res = await fetch(KATALOG_URL, { headers: UA });
    if (!res.ok) throw new Error(`Stationskatalog HTTP ${res.status}`);
    text = await res.text();
    try {
      await writeFile(KATALOG_CACHE, text);
    } catch {}
  }
  const stationen = [];
  for (const zeile of text.split(/\r?\n/)) {
    const m = zeile.match(/^(.{5}) (.{4}) (.{20})\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+)/);
    if (!m) continue;
    stationen.push({
      id: m[1].trim(),
      name: m[3].trim(),
      lat: gradMinuten(m[4]),
      lng: gradMinuten(m[5]),
      hoehe_m: Number(m[6]),
    });
  }
  if (stationen.length < 1000) throw new Error(`Stationskatalog unvollständig (${stationen.length} Einträge)`);
  return stationen;
}

// Ein Punkt je Feld: Mittel der Eckpunkte des größten äußeren Rings (reicht
// für die Zuordnung zum nächsten Vorhersagepunkt völlig).
function feldPunkt(geojsonText) {
  if (!geojsonText) return null;
  const g = JSON.parse(geojsonText);
  const ringe =
    g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : [];
  const ring = ringe.sort((a, b) => b.length - a.length)[0];
  if (!ring || ring.length === 0) return null;
  const n = ring.length;
  return {
    lng: ring.reduce((s, p) => s + p[0], 0) / n,
    lat: ring.reduce((s, p) => s + p[1], 0) / n,
  };
}

// KMZ = ZIP mit einer KML-Datei. Zentrales Verzeichnis lesen, ersten Eintrag
// entpacken (Deflate oder unkomprimiert).
function kmzEntpacken(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("KMZ: kein ZIP-Verzeichnis");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("KMZ: Verzeichnis defekt");
  const methode = buf.readUInt16LE(cd + 10);
  const groesse = buf.readUInt32LE(cd + 20);
  const lokal = buf.readUInt32LE(cd + 42);
  const nameLen = buf.readUInt16LE(lokal + 26);
  const extraLen = buf.readUInt16LE(lokal + 28);
  const daten = buf.subarray(lokal + 30 + nameLen + extraLen, lokal + 30 + nameLen + extraLen + groesse);
  if (methode === 0) return daten.toString("utf8");
  if (methode === 8) return inflateRawSync(daten).toString("utf8");
  throw new Error(`KMZ: Kompression ${methode} nicht unterstützt`);
}

function zahl(v) {
  if (v === undefined || v === "-" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function kmlLesen(kml) {
  const ausgabe = kml.match(/<dwd:IssueTime>([^<]+)<\/dwd:IssueTime>/)?.[1];
  const zeiten = [...kml.matchAll(/<dwd:TimeStep>([^<]+)<\/dwd:TimeStep>/g)].map((m) => m[1]);
  const werte = {};
  for (const m of kml.matchAll(/<dwd:Forecast dwd:elementName="([^"]+)">\s*<dwd:value>([^<]*)<\/dwd:value>/g)) {
    werte[m[1]] = m[2].trim().split(/\s+/);
  }
  const koord = kml.match(/<kml:coordinates>([^<]+)<\/kml:coordinates>/)?.[1]?.split(",").map(Number);
  if (!ausgabe || zeiten.length === 0) throw new Error("KML: Ausgabezeit oder Zeitschritte fehlen");
  const K = (e, i) => {
    const v = zahl(werte[e]?.[i]);
    return v === null ? null : Math.round((v - 273.15) * 100) / 100;
  };
  const stunden = zeiten.map((zeit, i) => ({
    zeit,
    t2m: K("TTT", i),
    t5cm: K("T5cm", i),
    td: K("Td", i),
    regen_mm: zahl(werte.RR1c?.[i]),
    regen_wahrsch: zahl(werte.R101?.[i]),
    sonne_min: zahl(werte.SunD1?.[i]) === null ? null : Math.round(zahl(werte.SunD1[i]) / 60),
    wolken_proz: zahl(werte.N?.[i]) === null ? null : Math.round(zahl(werte.N[i])),
    wind_ms: zahl(werte.FF?.[i]),
  }));
  return { ausgabe, stunden, lng: koord?.[0], lat: koord?.[1] };
}

async function kmzLaden(id) {
  const res = await fetch(KMZ_URL(id), { headers: UA });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`MOSMIX ${id} HTTP ${res.status}`);
  return kmlLesen(kmzEntpacken(Buffer.from(await res.arrayBuffer())));
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

const katalog = await stationsKatalog();

// Punkte, für die eine Vorhersage gebraucht wird
const punkte = []; // { feld_id|null, lat, lng }
if (trocken && TEST_LAT) {
  punkte.push({ feld_id: null, lat: Number(TEST_LAT), lng: Number(TEST_LNG) });
} else {
  const { data, error } = await supa
    .from("feld_geojson")
    .select("id, aktiv, geometrie_geojson")
    .eq("aktiv", true)
    .not("geometrie_geojson", "is", null);
  if (error) throw new Error(`Felder laden: ${error.message}`);
  for (const f of data ?? []) {
    try {
      const p = feldPunkt(f.geometrie_geojson);
      if (p) punkte.push({ feld_id: f.id, ...p });
    } catch (e) {
      console.warn(`Feld ${f.id}: Geometrie nicht lesbar (${e.message})`);
    }
  }
  if (punkte.length === 0 && STANDORT_LAT && STANDORT_LNG) {
    punkte.push({ feld_id: null, lat: Number(STANDORT_LAT), lng: Number(STANDORT_LNG) });
  }
}
if (punkte.length === 0) {
  console.log("Keine Felder mit Geometrie und kein STANDORT_LAT/LNG - nichts zu tun.");
  process.exit(0);
}

// Je Punkt den nächsten Katalog-Eintrag MIT MOSMIX_L-Datei finden.
const geladen = new Map(); // id -> Vorhersage | null (keine Datei)
const zuordnung = []; // { feld_id, lat, lng, station, km }
const bekannteAusgabe = new Map();
if (supa && !trocken) {
  const { data } = await supa.from("wetter_station").select("id, ausgabe");
  for (const s of data ?? []) bekannteAusgabe.set(s.id, s.ausgabe);
}

for (const p of punkte) {
  const kandidaten = katalog
    .map((s) => ({ s, d: km(p, s) }))
    .filter((x) => x.d <= MAX_KM)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);
  let gefunden = null;
  for (const { s, d } of kandidaten) {
    if (!geladen.has(s.id)) {
      try {
        geladen.set(s.id, await kmzLaden(s.id));
      } catch (e) {
        console.warn(`Station ${s.id}: ${e.message}`);
        geladen.set(s.id, null);
      }
    }
    if (geladen.get(s.id)) {
      gefunden = { s, d };
      break;
    }
  }
  if (!gefunden) {
    console.warn(`Kein Vorhersagepunkt im Umkreis von ${MAX_KM} km für ${p.feld_id ?? "Standort"} (${p.lat}, ${p.lng})`);
    continue;
  }
  zuordnung.push({ ...p, station: gefunden.s, km: Math.round(gefunden.d * 10) / 10 });
}

const genutzt = [...new Set(zuordnung.map((z) => z.station.id))];
let neu = 0;
for (const id of genutzt) {
  const v = geladen.get(id);
  const kat = katalog.find((s) => s.id === id);
  const station = {
    id,
    name: kat.name,
    lat: v.lat ?? kat.lat,
    lng: v.lng ?? kat.lng,
    hoehe_m: kat.hoehe_m,
    ausgabe: v.ausgabe,
    geladen_am: new Date().toISOString(),
  };
  if (trocken) {
    const naechste = v.stunden.slice(0, 6).map((h) => `${h.zeit.slice(11, 16)} ${h.t2m}°/${h.t5cm}° Td ${h.td} R ${h.regen_mm} S ${h.sonne_min}`);
    console.log(`[DRY] ${id} ${station.name} Ausgabe ${v.ausgabe}, ${v.stunden.length} Stunden\n  ` + naechste.join("\n  "));
    continue;
  }
  const { error: e1 } = await supa.from("wetter_station").upsert(station);
  if (e1) throw new Error(`wetter_station ${id}: ${e1.message}`);
  if (bekannteAusgabe.get(id) && new Date(bekannteAusgabe.get(id)).getTime() === new Date(v.ausgabe).getTime()) continue;
  const zeilen = v.stunden.map((h) => ({ station_id: id, ...h }));
  for (let i = 0; i < zeilen.length; i += 500) {
    const { error } = await supa.from("wetter_stunde").upsert(zeilen.slice(i, i + 500));
    if (error) throw new Error(`wetter_stunde ${id}: ${error.message}`);
  }
  neu++;
}

if (!trocken) {
  const feldZeilen = zuordnung
    .filter((z) => z.feld_id !== null)
    .map((z) => ({
      feld_id: z.feld_id,
      lat: z.lat,
      lng: z.lng,
      station_id: z.station.id,
      entfernung_km: z.km,
      aktualisiert: new Date().toISOString(),
    }));
  if (feldZeilen.length) {
    const { error } = await supa.from("wetter_feld").upsert(feldZeilen);
    if (error) throw new Error(`wetter_feld: ${error.message}`);
    const ids = feldZeilen.map((f) => f.feld_id);
    await supa.from("wetter_feld").delete().not("feld_id", "in", `(${ids.join(",")})`);
  }
  const grenze = new Date(Date.now() - Number(AUFBEWAHRUNG_TAGE) * 86400e3).toISOString();
  await supa.from("wetter_stunde").delete().lt("zeit", grenze);
}

console.log(
  `${new Date().toISOString()} ${punkte.length} Punkte, ${genutzt.length} Vorhersagepunkte (${genutzt.join(", ")}), ${neu} neu geladen`
);
