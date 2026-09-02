// Fahrzeug-Poller: holt alle ~30 s Positionen + Geofences + Events aus Traccar
// und schreibt sie nach Supabase. Läuft als systemd-Timer auf dem Hetzner-
// Server (neben Traccar), NICHT im Vercel-Frontend. Schreibt mit dem Supabase-
// Service-Key (umgeht RLS) - deshalb haben fahrzeug_position/fahrzeug_ereignis
// keine Insert-Policy.
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
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TIMEZONE = "Europe/Berlin",
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

const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// Wochentag (0=Mo) + Minuten seit Mitternacht in der konfigurierten Zeitzone.
function lokalTeile(iso) {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
  }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return {
    wochentag: WD[wd],
    minuten: Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)),
  };
}

function istAusserhalb(iso, azByWd) {
  const { wochentag, minuten } = lokalTeile(iso);
  const az = azByWd.get(wochentag);
  if (!az || !az.aktiv) return true;
  const [vh, vm] = az.von.split(":").map(Number);
  const [bh, bm] = az.bis.split(":").map(Number);
  return minuten < vh * 60 + vm || minuten >= bh * 60 + bm;
}

async function telegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[alarm] (kein Telegram konfiguriert)", text.replace(/\n/g, " | "));
    return true;
  }
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
    }
  );
  if (!res.ok) {
    console.error("[alarm] Telegram HTTP", res.status, await res.text());
    return false;
  }
  return true;
}

const TYP_TEXT = {
  geofenceExit: "Hof verlassen",
  geofenceEnter: "zurück am Hof",
  deviceMoving: "in Bewegung",
  deviceStopped: "gestoppt",
};

async function lauf() {
  const [devices, positions] = await Promise.all([
    traccar("/api/devices"),
    traccar("/api/positions"),
  ]);

  // 1. Tracker-Zeilen aktualisieren (nur Sync-Felder).
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
  const typUpdates = new Map();
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

  // 4. Positionen schreiben (Duplikate überspringen)
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

  // 6.-8. Geofences + Events + Alarm (best effort: blockiert die Positionen
  //       nicht, falls Migration 2026-09-26 noch fehlt).
  let ereignisse = 0;
  let alarme = 0;
  try {
    ({ ereignisse, alarme } = await geofencesUndEvents(devices, uidVonDevice, fahrzeugVon));
  } catch (e) {
    console.error("[stufe2] übersprungen:", e.message);
  }

  // 9. Aufräumen (max. 1x / ~Tag)
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
    `[${new Date().toISOString()}] ${devices.length} Geräte, ${rows.length} Positionen, ${ereignisse} Ereignisse, ${alarme} Alarm(e)`
  );
}

async function geofencesUndEvents(devices, uidVonDevice, fahrzeugVon) {
  // --- Geofences spiegeln ---
  const geofences = await traccar("/api/geofences");
  if (geofences.length) {
    const { error } = await supa.from("fahrzeug_geofence").upsert(
      geofences.map((g) => ({
        traccar_geofence_id: g.id,
        name: g.name ?? null,
        beschreibung: g.description ?? null,
        area: g.area ?? null,
      })),
      { onConflict: "traccar_geofence_id" }
    );
    if (error) throw new Error(`fahrzeug_geofence upsert: ${error.message}`);
  }
  const { data: gfRows } = await supa
    .from("fahrzeug_geofence")
    .select("traccar_geofence_id, name, ist_hof");
  const gfName = new Map((gfRows ?? []).map((g) => [g.traccar_geofence_id, g.name]));
  const hofIds = new Set(
    (gfRows ?? []).filter((g) => g.ist_hof).map((g) => g.traccar_geofence_id)
  );

  // --- Arbeitszeiten ---
  const { data: azRows } = await supa
    .from("fahrzeug_arbeitszeit")
    .select("wochentag, aktiv, von, bis");
  const azByWd = new Map((azRows ?? []).map((a) => [a.wochentag, a]));

  // --- Events seit dem letzten Abruf ---
  const { data: state } = await supa
    .from("fahrzeug_poller_state")
    .select("letzter_event_abruf")
    .eq("id", 1)
    .maybeSingle();
  const to = new Date();
  const seit = state?.letzter_event_abruf
    ? new Date(state.letzter_event_abruf)
    : new Date(Date.now() - 5 * 60000);
  const from = new Date(seit.getTime() - 2 * 60000);

  let neueEreignisse = 0;
  if (devices.length) {
    const typen = ["geofenceEnter", "geofenceExit", "deviceMoving", "deviceStopped"];
    const q = new URLSearchParams();
    q.set("from", from.toISOString());
    q.set("to", to.toISOString());
    devices.forEach((d) => q.append("deviceId", d.id));
    typen.forEach((t) => q.append("type", t));
    const events = await traccar(`/api/reports/events?${q}`);

    // Positionen der Events (für lat/lng) in einem Rutsch holen
    const posIds = [...new Set(events.map((e) => e.positionId).filter(Boolean))];
    const posMap = new Map();
    if (posIds.length) {
      const pq = new URLSearchParams();
      posIds.forEach((id) => pq.append("id", id));
      const evPos = await traccar(`/api/positions?${pq}`);
      evPos.forEach((p) => posMap.set(p.id, p));
    }

    const rows = events.map((e) => {
      const uid = uidVonDevice.get(e.deviceId) ?? null;
      const pos = posMap.get(e.positionId);
      const ausserhalb = istAusserhalb(e.eventTime, azByWd);
      const alarmRelevant =
        ausserhalb &&
        (e.type === "deviceMoving" ||
          (e.type === "geofenceExit" && hofIds.has(e.geofenceId)));
      return {
        traccar_event_id: e.id,
        traccar_unique_id: uid ?? String(e.deviceId),
        fahrzeug_id: uid ? (fahrzeugVon.get(uid) ?? null) : null,
        typ: e.type,
        zeitpunkt: e.eventTime,
        geofence_id: e.geofenceId ?? null,
        geofence_name: e.geofenceId ? (gfName.get(e.geofenceId) ?? null) : null,
        lat: pos?.latitude ?? null,
        lng: pos?.longitude ?? null,
        ausserhalb_arbeitszeit: ausserhalb,
        alarm_relevant: alarmRelevant,
        attribute: e.attributes ?? {},
      };
    });
    if (rows.length) {
      const { error } = await supa
        .from("fahrzeug_ereignis")
        .upsert(rows, { onConflict: "traccar_event_id", ignoreDuplicates: true });
      if (error) throw new Error(`fahrzeug_ereignis upsert: ${error.message}`);
    }
    neueEreignisse = rows.length;
  }
  await supa
    .from("fahrzeug_poller_state")
    .update({ letzter_event_abruf: to.toISOString() })
    .eq("id", 1);

  // --- Alarm senden (offene, gebündelt je Fahrzeug in 5-min-Fenstern) ---
  const alarme = await alarmSenden();
  return { ereignisse: neueEreignisse, alarme };
}

async function alarmSenden() {
  const { data: offen } = await supa
    .from("fahrzeug_ereignis")
    .select("traccar_event_id, fahrzeug_id, traccar_unique_id, typ, zeitpunkt, lat, lng, geofence_name")
    .eq("alarm_relevant", true)
    .is("alarm_gesendet_am", null)
    .order("zeitpunkt")
    .limit(50);
  if (!offen || offen.length === 0) return 0;

  const { data: fzRows } = await supa
    .from("fahrzeug_uebersicht")
    .select("id, bezeichnung, kennzeichen, fahrer_name, fahrer_vorname, lat, lng");
  const fz = new Map((fzRows ?? []).map((f) => [f.id, f]));

  // je Fahrzeug (oder Tracker) bündeln: alle Ereignisse innerhalb 5 min vom
  // ersten
  const gruppen = new Map();
  for (const e of offen) {
    const key = e.fahrzeug_id ?? `t:${e.traccar_unique_id}`;
    const g = gruppen.get(key);
    if (!g) {
      gruppen.set(key, { key, fahrzeug_id: e.fahrzeug_id, events: [e], start: new Date(e.zeitpunkt) });
    } else if (new Date(e.zeitpunkt) - g.start <= 5 * 60000) {
      g.events.push(e);
    }
  }

  let gesendet = 0;
  for (const g of gruppen.values()) {
    const f = g.fahrzeug_id != null ? fz.get(g.fahrzeug_id) : null;
    const name = f
      ? `${f.bezeichnung}${f.kennzeichen ? ` (${f.kennzeichen})` : ""}`
      : g.events[0].traccar_unique_id;
    const fahrer = f?.fahrer_name
      ? ` – Fahrer: ${f.fahrer_name}, ${f.fahrer_vorname ?? ""}`
      : "";
    const zeilen = g.events.map((e) => {
      const t = new Date(e.zeitpunkt).toLocaleTimeString("de-DE", {
        timeZone: TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${t} ${TYP_TEXT[e.typ] ?? e.typ}${e.geofence_name ? ` (${e.geofence_name})` : ""}`;
    });
    const posQ =
      g.events[0].lat != null
        ? `${g.events[0].lat},${g.events[0].lng}`
        : f?.lat != null
          ? `${f.lat},${f.lng}`
          : null;
    const text =
      `🚨 Fahrzeugnutzung außerhalb der Arbeitszeit\n` +
      `${name}${fahrer}\n` +
      zeilen.join("\n") +
      (posQ ? `\nhttps://maps.google.com/?q=${posQ}` : "");

    const ok = await telegram(text);
    if (ok) {
      const ids = g.events.map((e) => e.traccar_event_id);
      await supa
        .from("fahrzeug_ereignis")
        .update({ alarm_gesendet_am: new Date().toISOString() })
        .in("traccar_event_id", ids);
      gesendet++;
    }
  }
  return gesendet;
}

lauf().catch((e) => {
  console.error(`[${new Date().toISOString()}] Fehler:`, e.message);
  process.exit(1);
});
