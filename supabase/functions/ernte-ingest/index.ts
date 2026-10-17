// ernte-ingest - Supabase Edge Function (Deno).
// Nimmt Scan-/Batterie-Ereignisse einer Spargelspinne (TRB246,
// tools/ernte-scan-agent/) entgegen und schreibt sie roh in ernte_scan -
// siehe docs/erntewirtschaft-plan.md, Teil C.
//
// Bewusst "dumm": nur validieren, Person/Kiste per Code-Praefix klassifizieren
// (fuer die sofortige Geraete-Antwort/den spaeteren Erfolgston) und
// einfuegen. Zyklen oeffnen/schliessen, Schichten anlegen etc. macht weiterhin
// der pg_cron-Processor (Teil E).
//
// Der Waagen-Pfad (tools/ernte-waage-agent/) ruft diese Funktion NICHT auf -
// der schreibt bewusst direkt mit dem Service-Key in ernte_scan (siehe
// Kommentar in dessen index.mjs), deshalb kennt diese Funktion nur das
// Maschinen-Payload-Format.

/// <reference lib="deno.ns" />
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ERNTE_INGEST_TOKEN = Deno.env.get("ERNTE_INGEST_TOKEN") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type EingehendesEreignis = {
  typ?: string;
  code?: string;
  ts?: string;
  lat?: number;
  lng?: number;
  soc?: number;
  u?: number;
  i?: number;
};

type MaschinenPayload = {
  box?: string;
  events?: EingehendesEreignis[];
};

type Klassifizierung = "person" | "person_unbekannt" | "kiste";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Nur POST erlaubt." }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const erwarteterHeader = `Bearer ${ERNTE_INGEST_TOKEN}`;
  if (!ERNTE_INGEST_TOKEN || authHeader !== erwarteterHeader) {
    return json({ error: "Nicht autorisiert." }, 401);
  }

  let payload: MaschinenPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Kein gueltiges JSON." }, 400);
  }

  const box = typeof payload.box === "string" ? payload.box : null;
  const events = Array.isArray(payload.events) ? payload.events : null;
  if (!box || !events || events.length === 0) {
    return json({ error: "Feld 'box' und nicht-leeres Array 'events' sind erforderlich." }, 400);
  }

  // Alle P-Codes vorab in EINEM Rutsch nachschlagen statt pro Ereignis -
  // relevant, wenn ein Batch mehrere Scans auf einmal enthaelt (z.B. nach
  // einer Offline-Phase mit vielen nachgereichten Zeilen).
  const pCodes = [
    ...new Set(
      events
        .filter((e) => e.typ === "scan" && typeof e.code === "string" && e.code.startsWith("P-"))
        .map((e) => e.code as string),
    ),
  ];
  const { data: tagTreffer } = pCodes.length
    ? await supabase.from("ernte_tag").select("uid, art, aktiv, employee_id").in("uid", pCodes)
    : { data: [] as { uid: string; art: string; aktiv: boolean; employee_id: string | null }[] };
  const tagProUid = new Map((tagTreffer ?? []).map((t) => [t.uid, t]));

  type EinzufuegendeZeile = {
    quelle: "maschine";
    maschine_id: null;
    tag_uid: string | null;
    ereignis: "person_login" | "kiste" | "batterie";
    zeitpunkt: string;
    lat: number | null;
    lng: number | null;
    gewicht_kg: null;
    roh: Record<string, unknown>;
  };

  const zeilen: EinzufuegendeZeile[] = [];
  const klassifizierung: { code: string; typ: Klassifizierung }[] = [];
  const fehler: { event: EingehendesEreignis; grund: string }[] = [];

  for (const ereignis of events) {
    const ts = typeof ereignis.ts === "string" ? ereignis.ts : null;
    if (!ts || Number.isNaN(Date.parse(ts))) {
      fehler.push({ event: ereignis, grund: "Fehlender oder ungueltiger Zeitstempel (ts)." });
      continue;
    }

    if (ereignis.typ === "scan") {
      const code = ereignis.code;
      if (typeof code !== "string" || code.length === 0) {
        fehler.push({ event: ereignis, grund: "Feld 'code' fehlt." });
        continue;
      }

      if (code.startsWith("P-")) {
        const tag = tagProUid.get(code);
        const bekannt = !!tag && tag.art === "person" && tag.aktiv;
        klassifizierung.push({ code, typ: bekannt ? "person" : "person_unbekannt" });
        zeilen.push({
          quelle: "maschine",
          maschine_id: null,
          tag_uid: code,
          ereignis: "person_login",
          zeitpunkt: ts,
          lat: ereignis.lat ?? null,
          lng: ereignis.lng ?? null,
          gewicht_kg: null,
          roh: { box, ...ereignis },
        });
      } else if (code.startsWith("K-")) {
        klassifizierung.push({ code, typ: "kiste" });
        zeilen.push({
          quelle: "maschine",
          maschine_id: null,
          tag_uid: code,
          ereignis: "kiste",
          zeitpunkt: ts,
          lat: ereignis.lat ?? null,
          lng: ereignis.lng ?? null,
          gewicht_kg: null,
          roh: { box, ...ereignis },
        });
      } else {
        fehler.push({ event: ereignis, grund: `Code ohne bekanntes Praefix (P-/K-): "${code}"` });
      }
    } else if (ereignis.typ === "batterie") {
      zeilen.push({
        quelle: "maschine",
        maschine_id: null,
        tag_uid: null,
        ereignis: "batterie",
        zeitpunkt: ts,
        lat: null,
        lng: null,
        gewicht_kg: null,
        roh: { box, ...ereignis },
      });
    } else {
      fehler.push({ event: ereignis, grund: `Unbekannter Ereignistyp: "${ereignis.typ}"` });
    }
  }

  if (zeilen.length === 0) {
    return json({ angenommen: 0, dubletten: 0, klassifizierung, fehler }, 400);
  }

  // on conflict do nothing (idx_ernte_scan_idempotenz, siehe Migration
  // 2026-10-17) - der Agent schickt bei einem fehlgeschlagenen Versand
  // denselben Payload beim naechsten Versuch erneut, das ist gewollt.
  const { data: eingefuegt, error } = await supabase
    .from("ernte_scan")
    .upsert(zeilen, { onConflict: "quelle,tag_uid_norm,ereignis,zeitpunkt", ignoreDuplicates: true })
    .select("id");

  if (error) {
    return json({ error: `Einfuegen fehlgeschlagen: ${error.message}` }, 500);
  }

  const angenommen = eingefuegt?.length ?? 0;
  return json({
    angenommen,
    dubletten: zeilen.length - angenommen,
    klassifizierung,
    ...(fehler.length > 0 ? { fehler } : {}),
  });
});
