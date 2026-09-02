// Fahrzeug-Poller: holt alle ~30 s die aktuellen Positionen aus Traccar und
// schreibt sie nach Supabase. Läuft als systemd-Timer auf dem Hetzner-Server
// (neben Traccar), NICHT im Vercel-Frontend. Schreibt mit dem Supabase-
// Service-Key (umgeht RLS) - deshalb hat fahrzeug_position keine Insert-Policy.
//
// Ein Durchlauf je Aufruf (Type=oneshot). Env aus /etc/fahrzeug-poller.env.

import { createClient } from "@supabase/supabase-js";

const {
  TRACCAR_URL = "http://localhost:8082",
  TRACCAR_TOKEN,
  TRACCAR_USER,
  TRACCAR_PASSWORD,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  RETENTION_DAYS = "90",
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

async function lauf() {
  const [devices, positions] = await Promise.all([
    traccar("/api/devices"),
    traccar("/api/positions"),
  ]);

  // 1. Tracker-Zeilen aktualisieren (nur Sync-Felder, fahrzeug_id/geraetetyp
  //    bleiben unberührt).
  if (devices.length) {
    const { error } = await supa.from("fahrzeug_tracker").upsert(
      devices.map((d) => ({
        traccar_unique_id: String(d.uniqueId),
        traccar_device_id: d.id,
        bezeichnung: d.name ?? null,
        status: d.status ?? null,
        zuletzt_gesehen: d.lastUpdate ?? null,
      })),
      { onConflict: "traccar_unique_id" }
    );
    if (error) throw new Error(`fahrzeug_tracker upsert: ${error.message}`);
  }

  // 2. Zuordnung traccar_unique_id -> fahrzeug_id / geraetetyp
  const { data: trk, error: trkErr } = await supa
    .from("fahrzeug_tracker")
    .select("traccar_unique_id, fahrzeug_id, geraetetyp");
  if (trkErr) throw new Error(`fahrzeug_tracker select: ${trkErr.message}`);
  const fahrzeugVon = new Map(trk.map((t) => [t.traccar_unique_id, t.fahrzeug_id]));
  const typVon = new Map(trk.map((t) => [t.traccar_unique_id, t.geraetetyp]));
  const uidVonDevice = new Map(devices.map((d) => [d.id, String(d.uniqueId)]));

  // 3. Positionen aufbereiten
  const rows = [];
  const typUpdates = new Map(); // uid -> geraetetyp (nur falls bisher null)
  for (const p of positions) {
    const uid = uidVonDevice.get(p.deviceId);
    if (!uid || p.latitude == null || p.longitude == null) continue;
    const a = p.attributes ?? {};
    rows.push({
      traccar_unique_id: uid,
      fahrzeug_id: fahrzeugVon.get(uid) ?? null,
      zeitpunkt: p.fixTime,
      server_zeit: p.serverTime,
      lat: p.latitude,
      lng: p.longitude,
      gueltig: !!p.valid,
      speed_kmh: num(p.speed, 1.852),
      kurs: num(p.course, 1, 1),
      hoehe: num(p.altitude, 1, 1),
      zuendung: typeof a.ignition === "boolean" ? a.ignition : null,
      bewegung: typeof a.motion === "boolean" ? a.motion : null,
      batterie_prozent: num(a.batteryLevel, 1, 1),
      gesamt_km: num(a.totalDistance, 0.001, 1),
      attribute: a,
    });
    if (!typVon.get(uid) && !typUpdates.has(uid)) {
      const gt =
        p.protocol === "teltonika"
          ? "fmb920"
          : p.protocol === "watch"
            ? "tk905b"
            : p.protocol || null;
      if (gt) typUpdates.set(uid, gt);
    }
  }

  // 4. Positionen schreiben (Duplikate = gleicher Fix -> überspringen)
  if (rows.length) {
    const { error } = await supa.from("fahrzeug_position").upsert(rows, {
      onConflict: "traccar_unique_id,zeitpunkt",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`fahrzeug_position upsert: ${error.message}`);
  }

  // 5. Gerätetyp nachtragen
  for (const [uid, gt] of typUpdates) {
    await supa
      .from("fahrzeug_tracker")
      .update({ geraetetyp: gt })
      .eq("traccar_unique_id", uid)
      .is("geraetetyp", null);
  }

  // 6. Aufräumen (max. 1x / ~Tag)
  const { data: st } = await supa
    .from("fahrzeug_poller_state")
    .select("letzte_bereinigung")
    .eq("id", 1)
    .maybeSingle();
  const last = st?.letzte_bereinigung
    ? new Date(st.letzte_bereinigung).getTime()
    : 0;
  if (Date.now() - last > 20 * 3600 * 1000) {
    const grenze = new Date(
      Date.now() - Number(RETENTION_DAYS) * 86400000
    ).toISOString();
    const { error } = await supa
      .from("fahrzeug_position")
      .delete()
      .lt("server_zeit", grenze);
    if (!error) {
      await supa
        .from("fahrzeug_poller_state")
        .update({ letzte_bereinigung: new Date().toISOString() })
        .eq("id", 1);
      console.log(`[cleanup] Positionen älter als ${RETENTION_DAYS} Tage gelöscht`);
    }
  }

  console.log(
    `[${new Date().toISOString()}] ${devices.length} Geräte, ${rows.length} Positionen geschrieben`
  );
}

lauf().catch((e) => {
  console.error(`[${new Date().toISOString()}] Fehler:`, e.message);
  process.exit(1);
});
