# Ernte-Scan-Agent (läuft AUF dem TRB246)

Liest QR-Codes (Mitarbeiter-Badges `P-…`, Kisten `K-…`) vom seriellen
2D-Scan-Modul und schickt sie an die Ingest-Edge-Function — siehe
`docs/erntewirtschaft-plan.md`, Teil B/C.

**Anders als `tools/ernte-waage-agent/`:** Dieser Agent läuft nicht auf einem
separaten PC/Pi, sondern direkt auf dem TRB246 selbst (RutOS, BusyBox-Shell —
kein Node/Python verfügbar), deshalb reines POSIX-`sh` statt Node.js.

## Warum kein Node, warum kein fertiges TRB246-Feature

Die eingebaute "Data to Server"-Funktion des TRB246 ist für strukturierte
Sensor-/GPS-Daten gebaut (siehe `Services → GPS → AVL`, das für die
Positions-Übertragung an Traccar genutzt wird) — sie unterstützt laut
Teltonika-Forum **kein** "lies rohe Zeilen von einem seriellen Gerät und
schick sie per HTTP POST". Dafür braucht es ein eigenes Skript, siehe
[Teltonika-Community-Thread](https://community.teltonika.lt/t/lua-script-to-receive-mqtt-or-http-payloads-and-send-it-to-serial-port-rs232-not-modbus/14525).

## Architektur (zweigeteilt, wie `queue.mjs` beim Waagen-Agenten)

- **Leseschleife**: öffnet die serielle Schnittstelle, hängt jeden gescannten
  Code **sofort** als JSON-Zeile an `QUEUE_DATEI` an. Wartet nie auf das Netz.
- **Sendeschleife** (eigener Hintergrundprozess): holt sich alle `RETRY_INTERVALL_S`
  Sekunden den aktuellen Inhalt der Warteschlange, versucht jede Zeile per
  `curl` zu verschicken — Erfolg: verworfen, Fehlschlag: wandert zurück in
  die (inzwischen weitergewachsene) Warteschlange.

Lokal getestet (PTY-Paar via `socat` als Fake-Seriell-Gerät + kleiner
Python-HTTP-Server als Fake-Ingest): Normalfall, Server-Ausfall (Scan bleibt
in der Warteschlange, kein Verlust), Erholung nach Neustart des Servers, und
mehrere schnelle Scans hintereinander — alle vier Fälle funktionieren wie
erwartet.

## Noch NICHT Teil von v1 (bewusste Vereinfachung)

- **Kein GPS/Koordinaten im Scan-Event**, obwohl der Plan das im Payload
  vorsieht. Position wird bereits parallel und unabhängig über
  `Services → GPS → AVL` an Traccar mit 1s-Auflösung übertragen — der
  Processor (Teil E) kann `ernte_scan` später per Zeitstempel gegen
  `ernte_position` matchen. Koordinaten zusätzlich im Scan-Event zu versenden
  bräuchte einen `ubus`-Aufruf auf dem Gerät, dessen genaue Syntax für dieses
  Modell nicht verifiziert ist — lieber später sauber nachrüsten als jetzt
  raten.
- **Kein Erfolgston** (Piezo-Summer am Digitalausgang, siehe Plan) — kommt,
  sobald das Grundgerüst steht.
- **`ernte-ingest` existiert noch nicht** (Plan Teil H, Schritt 4) — bis dahin
  bleibt `INGEST_URL` ein Platzhalter, der Agent sammelt Scans trotzdem schon
  zuverlässig in der lokalen Warteschlange gleichzeitig mit dem GPS-Test.

## RS232-Geräte-Pfad (geklärt 2026-10-17)

**Immer `/dev/rs232`** — kein Raten nötig. Auf dem TRB246 (Hardware-Rev.
0004) legt Teltonikas eigenes Boot-Skript (`01-serial-symlink.sh`) einen
festen Symlink an: die externe RS232-Buchse hängt intern an einem
USB-Seriell-Chip (`ttyUSB0`, PL2303), der auf `/dev/rs232` verlinkt wird
(`dmesg | grep tty` zeigt `Creating /dev/ttyUSB0 -> /dev/rs232 symlink`).
`ttyS0` ist die System-Konsole (nicht anfassen), `ttyS1` ist `/dev/rs485`,
`ttyS2` vermutlich intern fürs GPS-Modul. Die `ttyUSB1`–`ttyUSB4` gehören
zum internen LTE-Modem (AT/Diagnose/PPP), nicht zur externen Buchse. Bei
anderer Hardware-Revision sicherheitshalber mit `ls -la /dev/rs232`
gegenprüfen.

## Einrichtung auf dem TRB246

1. **Services → Serial Utilities**: RS232-Instanz NICHT auf "Console" oder
   "Over IP" stellen (sonst belegt RutOS den Port selbst) — Baudrate/Parität
   passend zum Scan-Modul-Datenblatt einstellen.
2. `SERIAL_DEV=/dev/rs232` in `agent.conf` eintragen (siehe oben) —
   zur Sicherheit auf dem Gerät mit `ls -la /dev/rs232` bestätigen.
3. Dateien aufs Gerät kopieren (z.B. per `scp`):
   ```
   scp agent.sh root@<TRB246-IP>:/etc/ernte-scan-agent/agent.sh
   scp agent.conf.example root@<TRB246-IP>:/etc/ernte-scan-agent/agent.conf
   scp ernte-scan-agent.init root@<TRB246-IP>:/etc/init.d/ernte-scan-agent
   ```
4. Auf dem Gerät: `agent.conf` anpassen (`SERIAL_DEV`, `BOX_ID` mindestens),
   dann:
   ```
   chmod +x /etc/ernte-scan-agent/agent.sh /etc/init.d/ernte-scan-agent
   /etc/init.d/ernte-scan-agent enable
   /etc/init.d/ernte-scan-agent start
   logread -f   # oder: tail -f, je nach Firmware - zeigt "Scan: ..."-Zeilen
   ```
5. Testen: Code vor den Scanner halten, in den Logs sollte `Scan: K-…`
   erscheinen, und (sobald `INGEST_URL` echt ist) `Versendet: …`.

## Alternative ohne SSH

Teltonika bietet in der Weboberfläche unter **System → Custom Scripts** eine
Stelle für Shell-Befehle, die am Ende des Boot-Vorgangs laufen — als
einfachere, aber weniger robuste Alternative zum procd-Dienst (kein
automatischer Neustart bei Absturz) könnte dort z.B.
`/bin/sh /etc/ernte-scan-agent/agent.sh &` eingetragen werden. Für den
Dauerbetrieb ist der procd-Dienst (siehe oben) die bessere Wahl.

## Offene Punkte

- Stromausfall-Verhalten (siehe Plan, "Offene Frage Stromausfall"): ob die
  Warteschlangen-Datei einen abrupten Stromverlust (nicht nur Neustart)
  unbeschadet übersteht, hängt vom Flash-Dateisystem von RutOS ab — vor dem
  Pilottest gezielt prüfen (Gerät mit wartenden Zeilen in der Warteschlange
  stromlos machen, wieder einschalten, Datei prüfen).
- Sobald `ernte-ingest` deployt ist: nur `INGEST_URL`/`INGEST_TOKEN` in
  `agent.conf` eintragen, Dienst neu starten — kein Code-Änderung nötig.
