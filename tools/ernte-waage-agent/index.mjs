// Waagen-Agent - siehe docs/erntewirtschaft-plan.md Teil D.
// Ablauf je Scan: Kisten-/Test-Code kommt rein -> kurz warten (Kiste steht
// auf der Waage) -> <FP0> an die Waage -> Antwort parsen -> Zeile in
// ernte_scan schreiben (direkt per Service-Key, wie beim fahrzeug-poller -
// keine ernte-ingest Edge Function noetig fuer diesen Pfad).
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fp0Lesen } from "./waage-client.mjs";
import { scannerQuelle } from "./scanner-quelle.mjs";
import { einreihen, wartendeHolen, schreibeZurueck } from "./queue.mjs";

const env = (name, fallback) => process.env[name] ?? fallback;
const envNumber = (name, fallback) => Number(process.env[name] ?? fallback);

const WAAGE_IP = env("WAAGE_IP");
const WAAGE_PORT = envNumber("WAAGE_PORT", 8000);
const WAAGE_ID = envNumber("WAAGE_ID", 1);
const SCANNER_QUELLE_NAME = env("SCANNER_QUELLE", "simuliert");
const KISTE_STEHT_WARTE_MS = envNumber("KISTE_STEHT_WARTE_MS", 1500);
const RETRY_INTERVALL_MS = envNumber("RETRY_INTERVALL_MS", 30_000);
const QUEUE_DATEI = env("QUEUE_DATEI", "./ernte-waage-agent-queue.jsonl");

if (!WAAGE_IP) {
  console.error("WAAGE_IP fehlt - siehe .env.example");
  process.exit(1);
}
if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) {
  console.error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen - siehe .env.example");
  process.exit(1);
}

const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

function warte(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function schreiben(zeile) {
  const { error } = await supabase.from("ernte_scan").insert(zeile);
  if (error) throw new Error(error.message);
}

async function schreibenMitQueueFallback(zeile) {
  try {
    await schreiben(zeile);
    console.log(`  -> ernte_scan geschrieben (${zeile.tag_uid}, ${zeile.gewicht_kg} kg)`);
  } catch (e) {
    console.error(`  -> Supabase-Fehler, lege lokal in die Warteschlange: ${e.message}`);
    einreihen(QUEUE_DATEI, zeile);
  }
}

async function wartendeAbarbeiten() {
  const wartende = wartendeHolen(QUEUE_DATEI);
  if (wartende.length === 0) return;
  console.log(`Warteschlange: ${wartende.length} ausstehend, versuche erneut zu senden ...`);
  const nochOffen = [];
  for (const payload of wartende) {
    try {
      await schreiben(payload);
      console.log("  -> Nachtrag ok");
    } catch (e) {
      console.error(`  -> Nachtrag fehlgeschlagen: ${e.message}`);
      nochOffen.push(payload);
    }
  }
  schreibeZurueck(QUEUE_DATEI, nochOffen);
}

async function kisteWiegen(tagUid) {
  console.log(`Code gescannt: ${tagUid} - warte ${KISTE_STEHT_WARTE_MS}ms, dann <FP0> ...`);
  await warte(KISTE_STEHT_WARTE_MS);

  let ergebnis;
  try {
    ergebnis = await fp0Lesen(WAAGE_IP, WAAGE_PORT);
  } catch (e) {
    console.error(`  -> Waage nicht erreichbar/Fehler: ${e.message}`);
    return;
  }

  if (!ergebnis) {
    console.warn("  -> <FP!> - kein stabiles Gewicht innerhalb von 30s, oder ausserhalb Waegebereich.");
    return;
  }

  console.log(`  -> Netto ${ergebnis.nettoKg} kg (Brutto ${ergebnis.bruttoKg}, Tara ${ergebnis.taraKg})`);

  await schreibenMitQueueFallback({
    quelle: "waage",
    waage_id: WAAGE_ID,
    tag_uid: tagUid,
    ereignis: "gewicht",
    zeitpunkt: new Date().toISOString(),
    gewicht_kg: ergebnis.nettoKg,
    roh: ergebnis,
  });
}

async function main() {
  console.log(`Waagen-Agent gestartet. Waage ${WAAGE_IP}:${WAAGE_PORT}, Scanner-Quelle "${SCANNER_QUELLE_NAME}".`);
  setInterval(() => void wartendeAbarbeiten(), RETRY_INTERVALL_MS);

  for await (const tagUid of scannerQuelle(SCANNER_QUELLE_NAME)) {
    await kisteWiegen(tagUid);
  }
}

main().catch((e) => {
  console.error("Waagen-Agent abgebrochen:", e);
  process.exit(1);
});
