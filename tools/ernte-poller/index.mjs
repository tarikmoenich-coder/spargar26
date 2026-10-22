// Ernte-Poller: holt Positionen der Erntemaschinen (Spinnen) aus Traccar und
// schreibt sie gedrosselt (POSITION_RATE_S) nach Supabase (ernte_position),
// dann Spatial-Join gegen `feld` per DB-Funktion. Läuft als systemd-Timer auf
// dem Hetzner-Server (neben Traccar), NICHT im Vercel-Frontend. Schreibt mit
// dem Supabase-Service-Key (umgeht RLS) - ernte_position hat deshalb keine
// Insert-Policy (siehe migration_2026-10-20_erntewirtschaft_kisten_zyklus.sql).
//
// Traccar führt Fahrzeuge UND Erntemaschinen in derselben Instanz (Teil A des
// Plans schlug dafür eine eigene Traccar-Gruppe/Namensschema vor) - dieser
// Poller braucht das nicht: er erkennt "seine" Geräte selbst daran, dass die
// Traccar-uniqueId (IMEI) mit einer `ernte_maschine.box_seriennummer`
// übereinstimmt, und trägt `traccar_unique_id` dann automatisch nach. Jedes
// andere Gerät (Fahrzeug-Tracker) wird stillschweigend ignoriert.
//
// Ein Durchlauf je Aufruf (Type=oneshot). Env aus /etc/ernte-poller.env.

import { createClient } from "@supabase/supabase-js";

const {
  TRACCAR_URL = "http://localhost:8082",
  TRACCAR_TOKEN,
  TRACCAR_USER,
  TRACCAR_PASSWORD,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  POSITION_RATE_S = "5",
  RETENTION_DAYS = "365",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen.");
  process.exit(1);
}

const authHeader = TRACCAR_TOKEN
  ? `Bearer ${TRACCAR_TOKEN}`
  : TRACCAR_USER
    ? `Basic ${Buffer.from(`${TRACCAR_USER}:${TRACCAR_PASSWORD ?? ""}`).toString("base64")}`
    : null;
if (!authHeader) {
  console.error("Weder TRACCAR_TOKEN noch TRACCAR_USER/TRACCAR_PASSWORD gesetzt.");
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RATE_S = Number(POSITION_RATE_S) || 5;

async function traccar(pfad) {
  const res = await fetch(`${TRACCAR_URL}${pfad}`, {
    headers: { Authorization: authHeader, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Traccar ${pfad} -> HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function num(v, faktor = 1, stellen = 2) {
  return v === null || v === undefined || Number.isNaN(Number(v))
    ? null
    : Number((Number(v) * faktor).toFixed(stellen));
}

// Eine Traccar-Position in eine ernte_position-Zeile, oder null, wenn das
// Gerät keiner bekannten Maschine zugeordnet ist oder keine Koordinate hat.
function positionRow(p, uidVonDevice, maschineVon) {
  const uid = uidVonDevice.get(p.deviceId);
  const maschineId = uid ? maschineVon.get(uid) : undefined;
  if (!maschineId || p.latitude == null || p.longitude == null) return null;
  const a = p.attributes ?? {};
  return {
    maschine_id: maschineId,
    traccar_unique_id: uid,
    zeitpunkt: p.fixTime,
    lat: p.latitude,
    lng: p.longitude,
    hoehe_m: num(p.altitude, 1, 1),
    speed_kmh: num(p.speed, 1.852),
    kurs: num(p.course, 1, 1),
    fix_qualitaet: typeof a.sat === "number" ? a.sat : null,
    hdop: num(a.hdop, 1, 2),
  };
}

async function lauf() {
  const [devices, positions] = await Promise.all([
    traccar("/api/devices"),
    traccar("/api/positions"),
  ]);
  const uidVonDevice = new Map(devices.map((d) => [d.id, String(d.uniqueId)]));

  // 1. Bekannte Maschinen laden + Geräte-Zuordnung selbst herstellen/
  //    nachziehen (Match über die IMEI = box_seriennummer).
  const { data: maschinen, error: mErr } = await supa
    .from("ernte_maschine")
    .select("id, box_seriennummer, traccar_unique_id");
  if (mErr) throw new Error(`ernte_maschine select: ${mErr.message}`);

  const maschineVon = new Map();
  for (const m of maschinen) {
    if (m.traccar_unique_id) maschineVon.set(m.traccar_unique_id, m.id);
  }
  for (const d of devices) {
    const uid = String(d.uniqueId);
    if (maschineVon.has(uid)) continue;
    const treffer = maschinen.find((m) => m.box_seriennummer === uid);
    if (!treffer) continue; // kein uns bekanntes Gerät (z.B. Fahrzeug-Tracker)
    const { error } = await supa
      .from("ernte_maschine")
      .update({ traccar_unique_id: uid })
      .eq("id", treffer.id);
    if (error) {
      console.error(`[maschine] traccar_unique_id nachtragen (${uid}):`, error.message);
      continue;
    }
    maschineVon.set(uid, treffer.id);
  }

  if (maschineVon.size === 0) {
    console.log(
      `[${new Date().toISOString()}] keine bekannte Maschine unter den ${devices.length} Traccar-Geräten`
    );
    return;
  }

  // 2. Jüngste gespeicherte Position je bekannter Maschine (Throttle-Start +
  //    Ausgangspunkt für den Lücken-Nachzug per Route-Report).
  const { data: letzte, error: lErr } = await supa
    .from("ernte_position")
    .select("maschine_id, zeitpunkt")
    .in("maschine_id", [...maschineVon.values()])
    .order("zeitpunkt", { ascending: false });
  if (lErr) throw new Error(`ernte_position select: ${lErr.message}`);
  const letzterZeitpunkt = new Map();
  for (const r of letzte) {
    if (!letzterZeitpunkt.has(r.maschine_id)) {
      letzterZeitpunkt.set(r.maschine_id, new Date(r.zeitpunkt));
    }
  }

  // 3. Lücken seit dem letzten Lauf per Route-Report nachziehen (wie beim
  //    Fahrzeug-Poller), aber nur für unsere Geräte - damit bestimmt das
  //    1-s-Meldeintervall des TRB246 die Dichte, nicht der Poller-Takt.
  const bekannteDeviceIds = devices
    .filter((d) => maschineVon.has(String(d.uniqueId)))
    .map((d) => d.id);

  let route = [];
  if (bekannteDeviceIds.length) {
    const to = new Date();
    const maxRueck = new Date(Date.now() - 6 * 3600 * 1000);
    const bekannteZeiten = [...letzterZeitpunkt.values()];
    let von = bekannteZeiten.length
      ? new Date(Math.min(...bekannteZeiten.map((d) => d.getTime())) - 60000)
      : new Date(Date.now() - 15 * 60000);
    if (von < maxRueck) von = maxRueck;

    const q = new URLSearchParams();
    q.set("from", von.toISOString());
    q.set("to", to.toISOString());
    bekannteDeviceIds.forEach((id) => q.append("deviceId", id));
    try {
      route = await traccar(`/api/reports/route?${q}`);
    } catch (e) {
      console.error("[route] übersprungen, nehme nur /api/positions:", e.message);
    }
  }

  // 4. Rohpunkte je Gerät sammeln (Route-Nachzug + aktuellste /api/positions,
  //    deren letzter Punkt sich oft überschneidet - gesehen-Set filtert das),
  //    sortieren, dann mit POSITION_RATE_S throtteln.
  const jeGeraet = new Map();
  for (const p of [...route, ...positions]) {
    const uid = uidVonDevice.get(p.deviceId);
    if (!uid || !maschineVon.has(uid)) continue;
    if (!jeGeraet.has(p.deviceId)) jeGeraet.set(p.deviceId, []);
    jeGeraet.get(p.deviceId).push(p);
  }

  const rows = [];
  for (const [deviceId, punkte] of jeGeraet) {
    punkte.sort((a, b) => new Date(a.fixTime) - new Date(b.fixTime));
    const uid = uidVonDevice.get(deviceId);
    const maschineId = maschineVon.get(uid);
    let letzt = letzterZeitpunkt.get(maschineId) ?? null;
    const gesehen = new Set();
    for (const p of punkte) {
      if (gesehen.has(p.fixTime)) continue;
      gesehen.add(p.fixTime);
      const t = new Date(p.fixTime);
      if (letzt && t - letzt < RATE_S * 1000) continue;
      const row = positionRow(p, uidVonDevice, maschineVon);
      if (!row) continue;
      rows.push(row);
      letzt = t;
    }
  }

  // 5. Schreiben (Duplikate überspringen).
  if (rows.length) {
    const { error } = await supa.from("ernte_position").upsert(rows, {
      onConflict: "traccar_unique_id,zeitpunkt",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`ernte_position upsert: ${error.message}`);
  }

  // 6. Feld-Zuordnung per Spatial-Join (DB-Funktion, Migration 2026-10-22) -
  //    best effort, blockiert die Positionen nicht, falls die Migration noch
  //    fehlt.
  let zugeordnet = 0;
  try {
    const { data, error } = await supa.rpc("ernte_position_feld_zuordnen");
    if (error) throw error;
    zugeordnet = data ?? 0;
  } catch (e) {
    console.error("[feld] Zuordnung übersprungen:", e.message);
  }

  // 7. Aufräumen (max. 1x/Tag).
  const { data: st } = await supa
    .from("ernte_poller_state")
    .select("letzte_bereinigung")
    .eq("id", 1)
    .maybeSingle();
  const last = st?.letzte_bereinigung ? new Date(st.letzte_bereinigung).getTime() : 0;
  if (Date.now() - last > 20 * 3600 * 1000) {
    const grenze = new Date(Date.now() - Number(RETENTION_DAYS) * 86400000).toISOString();
    const { error } = await supa.from("ernte_position").delete().lt("zeitpunkt", grenze);
    if (!error) {
      await supa
        .from("ernte_poller_state")
        .update({ letzte_bereinigung: new Date().toISOString() })
        .eq("id", 1);
      console.log(`[cleanup] Positionen älter als ${RETENTION_DAYS} Tage gelöscht`);
    }
  }

  const stateUpdate = { letzter_lauf: new Date().toISOString() };
  if (rows.length) {
    stateUpdate.letzte_position_zeit = rows
      .map((r) => r.zeitpunkt)
      .sort()
      .at(-1);
  }
  await supa.from("ernte_poller_state").update(stateUpdate).eq("id", 1);

  console.log(
    `[${new Date().toISOString()}] ${maschineVon.size} Maschine(n) bekannt, ${rows.length} Position(en) geschrieben, ${zugeordnet} Feld-Zuordnung(en)`
  );
}

lauf().catch((e) => {
  console.error(`[${new Date().toISOString()}] Fehler:`, e.message);
  process.exit(1);
});
