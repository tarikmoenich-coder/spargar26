// Waagen-Agent - siehe docs/erntewirtschaft-plan.md Teil D.
// Ablauf je Scan: Kisten-/Test-Code kommt rein -> Gewicht beim Scan merken
// (egal ob 0 oder noch die vorige Kiste - Ueberschneidungen beim
// Kistenwechsel sind laut Nutzer normal) -> per <GN7> pollen, bis sich der
// Wert MERKLICH aendert (= es tut sich etwas auf der Waage, unabhaengig
// davon, ob zwischendurch kurz beide Kisten teilweise aufliegen) -> erst
// DANN <FP0> fuer den eichfaehigen Wert, der selbst auf die neue Ruhelage
// wartet -> Zeile in ernte_scan schreiben (direkt per Service-Key, wie
// beim fahrzeug-poller - keine ernte-ingest Edge Function noetig fuer
// diesen Pfad).
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fp0Lesen, gn7Gewicht } from "./waage-client.mjs";
import { scannerQuelle } from "./scanner-quelle.mjs";
import { einreihen, wartendeHolen, schreibeZurueck } from "./queue.mjs";

const env = (name, fallback) => process.env[name] ?? fallback;
const envNumber = (name, fallback) => Number(process.env[name] ?? fallback);

const WAAGE_IP = env("WAAGE_IP");
const WAAGE_PORT = envNumber("WAAGE_PORT", 8000);
const WAAGE_ID = envNumber("WAAGE_ID", 1);
const SCANNER_QUELLE_NAME = env("SCANNER_QUELLE", "simuliert");
// Ab welcher Aenderung gilt "da tut sich was" (Kiste wird gewechselt) -
// knapp ueber dem normalen Wackeln/Rauschen der Waage, aber klar drunter,
// was zwei unterschiedlich befuellte Kisten realistisch ausmacht.
const GEWICHT_AENDERUNG_KG = envNumber("GEWICHT_AENDERUNG_KG", 0.3);
// Nachtraegliche Plausi-Pruefung auf den fertigen <FP0>-Wert (nur Warnung,
// die Zeile wird trotzdem gespeichert - Rohdaten bleiben immer vollstaendig).
const MINDESTGEWICHT_KG = envNumber("MINDESTGEWICHT_KG", 2);
const GEWICHT_POLL_INTERVALL_MS = envNumber("GEWICHT_POLL_INTERVALL_MS", 400);
const WARTE_AUF_GEWICHT_TIMEOUT_MS = envNumber("WARTE_AUF_GEWICHT_TIMEOUT_MS", 20_000);
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

/**
 * Merkt sich das Gewicht im Moment des Scans (egal was das ist - 0, die
 * vorige Kiste, mitten im Wechsel) und pollt per <GN7>, bis sich der Wert
 * um mindestens GEWICHT_AENDERUNG_KG davon unterscheidet. Das erkennt einen
 * Kistenwechsel auch dann, wenn die alte Kiste beim Scan noch (stabil) auf
 * der Waage steht - ein einfacher Schwellwert-Check ("Gewicht >= X") wuerde
 * das faelschlich sofort als "fertig" werten und moeglicherweise noch den
 * ALTEN Wert an <FP0> liefern.
 */
async function wartetAufVeraenderung(tagUid) {
  let vorher;
  try {
    vorher = await gn7Gewicht(WAAGE_IP, WAAGE_PORT);
  } catch (e) {
    console.error(`  -> <GN7> fehlgeschlagen: ${e.message}`);
    return false;
  }
  if (!Number.isFinite(vorher)) vorher = 0;

  const start = Date.now();
  while (Date.now() - start < WARTE_AUF_GEWICHT_TIMEOUT_MS) {
    await warte(GEWICHT_POLL_INTERVALL_MS);
    let aktuell;
    try {
      aktuell = await gn7Gewicht(WAAGE_IP, WAAGE_PORT);
    } catch (e) {
      console.error(`  -> <GN7> fehlgeschlagen: ${e.message}`);
      return false;
    }
    if (Number.isFinite(aktuell) && Math.abs(aktuell - vorher) >= GEWICHT_AENDERUNG_KG) return true;
  }
  console.warn(
    `  -> ${tagUid}: nach ${WARTE_AUF_GEWICHT_TIMEOUT_MS}ms keine Gewichtsaenderung erkannt (Stand beim Scan: ${vorher} kg) - Kiste nie gewechselt?`,
  );
  return false;
}

/**
 * Fragt <FP0> zweimal hintereinander ab und akzeptiert nur, wenn beide
 * Male (fast) dasselbe rauskommt. Absicherung gegen ein falsch-stabiles
 * Zwischenplateau waehrend eines ueberlappenden Kistenwechsels - wie
 * robust der Geraete-eigene Ruhelage-Algorithmus das selbst abfaengt,
 * wissen wir ohne Pilottest nicht, diese Gegenprobe ist billig.
 */
async function fp0LesenBestaetigt() {
  const erste = await fp0Lesen(WAAGE_IP, WAAGE_PORT);
  if (!erste) return { ergebnis: null, bestaetigt: true };

  const zweite = await fp0Lesen(WAAGE_IP, WAAGE_PORT);
  if (!zweite) return { ergebnis: erste, bestaetigt: false };

  const bestaetigt = Math.abs(zweite.nettoKg - erste.nettoKg) < 0.05;
  return { ergebnis: zweite, bestaetigt };
}

async function kisteWiegen(tagUid) {
  console.log(`Code gescannt: ${tagUid} - warte auf Gewichtswechsel auf der Waage ...`);
  if (!(await wartetAufVeraenderung(tagUid))) return;

  console.log("  -> Aenderung erkannt, frage <FP0> zweimal ab (muss uebereinstimmen) ...");
  let ergebnis, bestaetigt;
  try {
    ({ ergebnis, bestaetigt } = await fp0LesenBestaetigt());
  } catch (e) {
    console.error(`  -> Waage nicht erreichbar/Fehler: ${e.message}`);
    return;
  }

  if (!ergebnis) {
    console.warn("  -> <FP!> - kein stabiles Gewicht innerhalb von 30s, oder ausserhalb Waegebereich.");
    return;
  }

  if (!bestaetigt) {
    console.warn(
      `  -> Zweite <FP0>-Abfrage wich vom ersten Wert ab (wahrscheinlich noch im Kistenwechsel) - speichere trotzdem den zweiten Wert (${ergebnis.nettoKg} kg) zur Kontrolle.`,
    );
  }

  if (ergebnis.nettoKg < MINDESTGEWICHT_KG) {
    console.warn(
      `  -> Netto ${ergebnis.nettoKg} kg liegt unter dem erwarteten Mindestgewicht (${MINDESTGEWICHT_KG} kg) - wird trotzdem gespeichert, zur Kontrolle.`,
    );
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
