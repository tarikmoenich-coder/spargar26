// Testempfänger für den TECTUS MAGNUM 4077 (UHF-Reader am Hofwaagen-Platz).
//
// Der Reader schickt im Modus "Permanent Scan" nach JEDER Inventur-Runde einen
// HTTP(S)-POST (Body: JSON als text/plain) an ein konfiguriertes Ziel:
//   {"Permanent Scan":{"id":"..","time":"..","Tag":[{"TagID":"E280..","RSSI":-67,"Antenna":1}]}}
// Dieses Programm nimmt diese Nachrichten entgegen und zeigt sie an - zum
// Ausprobieren von Reichweite, Sendeleistung und RSSI mit echten Kisten,
// BEVOR der eigentliche Waagen-Agent gebaut wird. Keine Abhängigkeiten.
//
// Schutz: Ohne das Geheimnis (READER_TOKEN) im Pfad antwortet der Server nur
// mit 404. Endpunkte:
//   POST /in/<TOKEN>[/...]   Empfang vom Reader (immer 200 "OK")
//   GET  /view/<TOKEN>       Übersicht (aktualisiert sich alle 2 s); ?leeren=1 setzt zurück
//   GET  /raw/<TOKEN>        die letzten Roh-Nachrichten als JSON (zur Fehlersuche)
//
// Konfiguration über Umgebungsvariablen: READER_TOKEN (Pflicht, mind. 16
// Zeichen/Ziffern), PORT (8090), HOST (127.0.0.1), LOG_DATEI.

import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.env.PORT ?? 8090);
const HOST = process.env.HOST ?? "127.0.0.1";
const TOKEN = process.env.READER_TOKEN ?? "";
const LOG_DATEI =
  process.env.LOG_DATEI ?? new URL("./reader-log.jsonl", import.meta.url).pathname;
const MAX_BODY = 200 * 1024;
const MAX_LOG_BYTES = 20 * 1024 * 1024;

if (!/^[A-Za-z0-9]{16,}$/.test(TOKEN)) {
  console.error(
    "READER_TOKEN fehlt oder ist ungültig (mind. 16 Zeichen, nur Buchstaben und Ziffern)."
  );
  process.exit(1);
}

let stats;
let letzteRunden; // nur Runden mit mindestens einem Tag
let proTag; // TagID -> Zusammenfassung
let letzteRohe; // die letzten Roh-Nachrichten (auch leere) + Header-Auszug

function zuruecksetzen() {
  stats = {
    seit: new Date().toISOString(),
    posts: 0,
    leer: 0,
    mitTags: 0,
    ungueltig: 0,
    letzterPost: null,
  };
  letzteRunden = [];
  proTag = new Map();
  letzteRohe = [];
}
zuruecksetzen();

function logSchreiben(zeile) {
  try {
    if (fs.existsSync(LOG_DATEI) && fs.statSync(LOG_DATEI).size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_DATEI, `${LOG_DATEI}.1`);
    }
    fs.appendFileSync(LOG_DATEI, JSON.stringify(zeile) + "\n");
  } catch (e) {
    console.error("Log-Fehler:", e.message);
  }
}

// Sucht in der Nachricht die Liste "Tag" (das Format nennt den äußeren Schlüssel
// "Permanent Scan"; hier bewusst tolerant, falls sich das je nach Firmware ändert).
function tagsAus(daten) {
  if (!daten || typeof daten !== "object") return null;
  if (Array.isArray(daten.Tag)) return { kopf: daten, tags: daten.Tag };
  for (const wert of Object.values(daten)) {
    if (wert && typeof wert === "object" && Array.isArray(wert.Tag)) {
      return { kopf: wert, tags: wert.Tag };
    }
  }
  return null;
}

function verarbeite(body, ip, headers) {
  stats.posts += 1;
  const jetzt = new Date().toISOString();
  stats.letzterPost = jetzt;
  const headerAuszug = {
    "content-type": headers["content-type"],
    "user-agent": headers["user-agent"],
    "content-length": headers["content-length"],
    connection: headers["connection"],
    authorization: headers["authorization"] ? "(vorhanden)" : "(keine)",
  };
  letzteRohe.push({ empfangen: jetzt, ip, header: headerAuszug, body: body.slice(0, 4000) });
  if (letzteRohe.length > 30) letzteRohe.shift();

  let daten = null;
  try {
    daten = JSON.parse(body);
  } catch {
    stats.ungueltig += 1;
    logSchreiben({ empfangen: jetzt, ip, ungueltig: true, body: body.slice(0, 1000) });
    return;
  }
  const gefunden = tagsAus(daten);
  if (!gefunden) {
    stats.ungueltig += 1;
    logSchreiben({ empfangen: jetzt, ip, unbekanntesFormat: true, daten });
    return;
  }
  if (gefunden.tags.length === 0) {
    stats.leer += 1;
    return;
  }
  stats.mitTags += 1;
  const runde = {
    empfangen: jetzt,
    readerZeit: gefunden.kopf.time ?? null,
    readerId: gefunden.kopf.id ?? null,
    tags: gefunden.tags,
  };
  letzteRunden.push(runde);
  if (letzteRunden.length > 300) letzteRunden.shift();
  logSchreiben({ ip, ...runde });
  for (const t of gefunden.tags) {
    const id = String(t.TagID ?? "?");
    const rssi = Number(t.RSSI);
    let z = proTag.get(id);
    if (!z) {
      z = { anzahl: 0, min: Infinity, max: -Infinity, summe: 0, mitRssi: 0, antennen: new Set(), erste: jetzt, letzte: jetzt };
      proTag.set(id, z);
    }
    z.anzahl += 1;
    z.letzte = jetzt;
    if (Number.isFinite(rssi)) {
      z.min = Math.min(z.min, rssi);
      z.max = Math.max(z.max, rssi);
      z.summe += rssi;
      z.mitRssi += 1;
    }
    if (t.Antenna !== undefined) z.antennen.add(t.Antenna);
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function uhrzeit(iso) {
  return iso ? new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin" }) : "—";
}

function seite() {
  const tagZeilen = [...proTag.entries()]
    .sort((a, b) => b[1].letzte.localeCompare(a[1].letzte))
    .map(([id, z]) => {
      const avg = z.mitRssi ? (z.summe / z.mitRssi).toFixed(1) : "—";
      return `<tr><td class="m">${esc(id)}</td><td>${z.anzahl}</td><td>${z.mitRssi ? z.min : "—"}</td><td>${avg}</td><td>${z.mitRssi ? z.max : "—"}</td><td>${esc([...z.antennen].join(", "))}</td><td>${uhrzeit(z.letzte)}</td></tr>`;
    })
    .join("");
  const rundenZeilen = [...letzteRunden]
    .reverse()
    .slice(0, 40)
    .flatMap((r) =>
      r.tags.map(
        (t) =>
          `<tr><td>${uhrzeit(r.empfangen)}</td><td class="m">${esc(t.TagID ?? "?")}</td><td>${esc(t.RSSI ?? "—")}</td><td>${esc(t.Antenna ?? "—")}</td></tr>`
      )
    )
    .join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2"><title>Reader-Test</title>
<style>
:root{color-scheme:light dark;--bg:#f7f8f3;--fg:#1b241d;--mut:#5c6a5f;--line:#dde3d7;--acc:#0b6b3f}
@media (prefers-color-scheme:dark){:root{--bg:#10150f;--fg:#e7ede5;--mut:#a3af9f;--line:#2a332a;--acc:#4fd08a}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
h1{font-size:1.2rem;margin:0 0 4px}h2{font-size:1rem;margin:22px 0 6px;color:var(--acc)}
p{margin:0 0 6px;color:var(--mut)}table{border-collapse:collapse;width:100%;max-width:900px}
th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;font-variant-numeric:tabular-nums}
.m{font-family:ui-monospace,monospace;font-size:.85em}.z b{font-size:1.4rem;color:var(--acc)}
.z span{display:inline-block;margin-right:22px}a{color:var(--acc)}
</style></head><body>
<h1>MAGNUM 4077 - Testempfänger</h1>
<p>Zählung seit ${uhrzeit(stats.seit)} · letzter Empfang: ${uhrzeit(stats.letzterPost)} · aktualisiert sich alle 2 s ·
<a href="?leeren=1">zurücksetzen</a> · <a href="/raw/${TOKEN}">Rohdaten</a></p>
<p class="z"><span><b>${stats.posts}</b><br>Nachrichten</span><span><b>${stats.mitTags}</b><br>mit Tags</span><span><b>${stats.leer}</b><br>leer</span><span><b>${stats.ungueltig}</b><br>nicht lesbar</span></p>
<h2>Je Tag (Kalibrierhilfe: RSSI-Bereich der Kiste auf der Waage vs. Nachbarkisten)</h2>
<table><tr><th>TagID</th><th>Lesungen</th><th>RSSI min</th><th>Ø</th><th>RSSI max</th><th>Antenne</th><th>zuletzt</th></tr>${tagZeilen || '<tr><td colspan="7">noch nichts empfangen</td></tr>'}</table>
<h2>Letzte Lesungen</h2>
<table><tr><th>Zeit</th><th>TagID</th><th>RSSI</th><th>Antenne</th></tr>${rundenZeilen || '<tr><td colspan="4">noch nichts empfangen</td></tr>'}</table>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const teile = url.pathname.split("/").filter(Boolean);
  const nicht = () => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found\n");
  };
  if (teile.length < 2 || teile[1] !== TOKEN) return nicht();

  if (teile[0] === "in" && req.method === "POST") {
    let groesse = 0;
    const stuecke = [];
    req.on("data", (c) => {
      groesse += c.length;
      if (groesse > MAX_BODY) {
        res.writeHead(413, { "content-type": "text/plain" });
        res.end("Too large\n");
        req.destroy();
        return;
      }
      stuecke.push(c);
    });
    req.on("end", () => {
      if (groesse > MAX_BODY) return;
      verarbeite(
        Buffer.concat(stuecke).toString("utf8"),
        req.headers["x-real-ip"] ?? req.socket.remoteAddress,
        req.headers
      );
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("OK\n");
    });
    return;
  }
  if (teile[0] === "view" && req.method === "GET") {
    if (url.searchParams.get("leeren") === "1") {
      zuruecksetzen();
      res.writeHead(302, { location: `/view/${TOKEN}` });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(seite());
  }
  if (teile[0] === "raw" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    return res.end(JSON.stringify({ stats, letzteRohe }, null, 2));
  }
  nicht();
});

server.listen(PORT, HOST, () => {
  console.log(`Reader-Testempfänger läuft auf ${HOST}:${PORT}`);
});
