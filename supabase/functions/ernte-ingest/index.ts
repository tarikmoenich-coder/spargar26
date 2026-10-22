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

type Klassifizierung = "person" | "person_unbekannt" | "person_gesperrt" | "kiste";

// Code-Schema seit 2026-10-22 (Nutzer-Vorgabe): "P-<personal_nr>-<suffix>",
// z.B. "P-2412-A1B2C3D4" - kein Anlernschritt mehr noetig, der Code traegt
// die Zuordnung direkt in sich. Suffix ist IMMER das letzte Segment (8 Hex-
// Zeichen), .+ ist gierig und sucht sich automatisch den LETZTEN
// Bindestrich - robust, falls eine Personalnummer selbst einen Bindestrich
// enthaelt (einzelne Alt-Personalnummern sind alphanumerisch).
const P_CODE_MUSTER = /^P-(.+)-([0-9A-Fa-f]{8})$/;

function parsePCode(code: string): { personalNr: string; suffix: string } | null {
  const treffer = code.match(P_CODE_MUSTER);
  if (!treffer) return null;
  return { personalNr: treffer[1], suffix: treffer[2].toUpperCase() };
}

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
  // einer Offline-Phase mit vielen nachgereichten Zeilen). Seit 2026-10-22
  // kein ernte_tag-Lookup mehr fuer Personen - die Personalnummer steckt
  // direkt im Code, nur der geheime Suffix (ernte_ausweis.suffix) muss noch
  // nachgeschlagen werden.
  const pCodes = [
    ...new Set(
      events
        .filter((e) => e.typ === "scan" && typeof e.code === "string" && e.code.startsWith("P-"))
        .map((e) => e.code as string),
    ),
  ];
  const pGeparst = new Map(
    pCodes
      .map((code) => [code, parsePCode(code)] as const)
      .filter((paar): paar is [string, { personalNr: string; suffix: string }] => paar[1] !== null),
  );
  const personalNrListe = [...new Set([...pGeparst.values()].map((g) => g.personalNr))];
  const { data: mitarbeiterTreffer } = personalNrListe.length
    ? await supabase
        .from("employees")
        .select("id, personal_nr, aktiv")
        .in("personal_nr", personalNrListe)
    : { data: [] as { id: string; personal_nr: string; aktiv: boolean }[] };
  const employeeIdVonPersonalNr = new Map(
    (mitarbeiterTreffer ?? []).filter((m) => m.aktiv).map((m) => [m.personal_nr, m.id]),
  );
  const employeeIds = [...employeeIdVonPersonalNr.values()];
  const { data: ausweisTreffer } = employeeIds.length
    ? await supabase.from("ernte_ausweis").select("employee_id, suffix").in("employee_id", employeeIds)
    : { data: [] as { employee_id: string; suffix: string }[] };
  const suffixVonEmployeeId = new Map((ausweisTreffer ?? []).map((a) => [a.employee_id, a.suffix]));

  // Klassifiziert einen P-Code fuer die sofortige Geraete-Antwort (siehe
  // Teil C im Plan): "person" nur, wenn Personalnummer UND Suffix passen.
  // "person_gesperrt" (Personalnummer existiert, Suffix passt nicht) ist
  // bewusst von "person_unbekannt" (Personalnummer existiert gar nicht)
  // unterschieden - ersteres ist typischerweise eine per "Verlust-Karte
  // drucken" bereits ungueltig gemachte, alte Karte.
  function klassifiziereP(code: string): Klassifizierung {
    const geparst = pGeparst.get(code);
    if (!geparst) return "person_unbekannt";
    const employeeId = employeeIdVonPersonalNr.get(geparst.personalNr);
    if (!employeeId) return "person_unbekannt";
    return suffixVonEmployeeId.get(employeeId) === geparst.suffix ? "person" : "person_gesperrt";
  }

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
        klassifizierung.push({ code, typ: klassifiziereP(code) });
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
