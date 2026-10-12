// RHEWA 84vario per Ethernet/TCP-IP (Schnittstelle 7) - Protokoll siehe
// docs/erntewirtschaft-plan.md Teil D und docs/waage_test.py (Ursprung
// dieses Codes, dort manuell gegen die echte Waage verifiziert am
// 2026-10-12, inkl. der zusaetzlichen leeren Satzkennung vor der
// laufenden Nummer).
import net from "node:net";

const STX = 0x02;
const ETX = 0x03;

const FELDER = [
  "satzkennung",
  "laufendeNummer",
  "datum",
  "uhrzeit",
  "waegebrueckeNr",
  "waegebereich",
  "stueckzahl",
  "einheit",
  "brutto",
  "tara",
  "netto",
];

function sendeBefehl(ip, port, befehl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port }, () => {
      socket.write(`<${befehl}>`, "ascii");
    });
    const chunks = [];
    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const alles = Buffer.concat(chunks);
      const text = alles.toString("latin1");
      if (text.endsWith(">") && (text.includes("!") || alles.includes(ETX))) {
        socket.end();
      }
    });
    socket.on("close", () => resolve(Buffer.concat(chunks)));
    socket.on("timeout", () => socket.destroy(new Error(`Timeout nach ${timeoutMs}ms`)));
    socket.on("error", reject);
  });
}

function parseEdv1(rohdaten) {
  const stxIdx = rohdaten.indexOf(STX);
  const etxIdx = rohdaten.indexOf(ETX);
  if (stxIdx < 0 || etxIdx < 0 || etxIdx <= stxIdx) return null;

  const block = rohdaten.subarray(stxIdx + 1, etxIdx).toString("latin1");
  const teile = block.split(";").map((t) => t.trim());
  const werte = {};
  FELDER.forEach((name, i) => {
    werte[name] = teile[i] ?? "";
  });
  return werte;
}

/**
 * Aktuelles Nettogewicht, sofortige Antwort (kein Warten auf Ruhelage).
 * Nur zur groben Statusanzeige - fuer eine Wiegung immer fp0Lesen() nutzen.
 */
export async function gn7Lesen(ip, port) {
  const antwort = await sendeBefehl(ip, port, "GN7", 5000);
  return antwort.toString("latin1");
}

/**
 * Wie gn7Lesen(), aber als Zahl geparst (z.B. "   2.560<GN>" -> 2.56).
 * NaN, wenn die Antwort keine brauchbare Zahl enthaelt (z.B. Fehlerquittung).
 */
export async function gn7Gewicht(ip, port) {
  const roh = await gn7Lesen(ip, port);
  const zahlTeil = roh.split("<")[0]?.trim() ?? "";
  return Number(zahlTeil);
}

/**
 * Kompletter eichfaehiger EDV1-Datensatz. Die Waage wartet GERAETESEITIG
 * bis zu 30s auf Ruhelage - hier als "stabiles Gewicht"-Trigger genutzt,
 * keine eigene Stabilitaets-Pruefung im Agenten noetig (siehe Plan Teil D).
 * Gibt null zurueck bei <FP!> (kein stabiles Gewicht/ausserhalb Waegebereich).
 */
export async function fp0Lesen(ip, port) {
  const antwort = await sendeBefehl(ip, port, "FP0", 35000);
  const text = antwort.toString("latin1");
  if (text.includes("!")) return null;

  const werte = parseEdv1(antwort);
  if (!werte) throw new Error(`EDV1-Rahmen nicht gefunden in: ${text}`);

  return {
    laufendeNummer: werte.laufendeNummer,
    zeitpunktGeraet: `${werte.datum} ${werte.uhrzeit}`,
    bruttoKg: Number(werte.brutto),
    taraKg: Number(werte.tara),
    nettoKg: Number(werte.netto),
    roh: werte,
  };
}
