# Ernte-Waagen-Agent

Verbindet die **RHEWA 84vario** (Hofwaage) mit einem Scanner-Code und schreibt
jede Wiegung als Zeile in `ernte_scan` (Supabase, Service-Key) -
siehe `docs/erntewirtschaft-plan.md`, Teil D.

Ablauf je Scan: Code kommt rein -> kurz warten (Kiste steht auf der Waage) ->
`<FP0>` an die Waage -> Antwort parsen -> Netto-Gewicht + Code nach Supabase.
Bei Supabase-Ausfall: lokale Warteschlange (einfache JSON-Zeilen-Datei,
bewusst kein natives Binary wie SQLite - siehe `queue.mjs`), automatischer
Retry.

## Scanner-Quelle (heute: Testdaten, echte Hardware folgt)

Der 2D-Scanner ist noch nicht gekauft. Bis dahin per `SCANNER_QUELLE`
umschaltbar, ohne den Rest des Agenten anzufassen:

- `simuliert` (Default) - jede ENTER-Taste erzeugt einen Fake-Code
  (`K-TEST-0001`, `K-TEST-0002`, ...). **Zum Testen mit der echten Waage:**
  echtes Gewicht auflegen, dann ENTER drücken - der Agent tut so, als wäre
  jetzt eine Kiste gescannt worden, liest aber das wirkliche Gewicht.
- `stdin` - echten Code eintippen, oder später ein USB-HID-Scanner (tippt
  den Code wie eine Tastatur).
- `seriell` - RS232-Scanner, noch nicht implementiert (sobald ein Modell
  feststeht, siehe `docs/anfrage-2d-scanner-rfq.md`).

Sobald echte Hardware da ist: nur `SCANNER_QUELLE` in der `.env` umstellen.

## Einrichtung (lokal zum Testen)

```bash
cd tools/ernte-waage-agent
npm install
cp .env.example .env
# WAAGE_IP, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY eintragen
npm start
```

Dann: Gewicht auf die Waage legen, ENTER drücken, Ausgabe prüfen. Danach in
Supabase `select * from ernte_scan order by id desc` - die Zeile sollte da
sein.

## Einrichtung am Hof (Dauerbetrieb) - NICHT auf dem Hetzner-Server

**Wichtig, anders als beim `fahrzeug-poller`:** Dieser Agent muss auf einem
Gerät **im selben LAN wie die Waage** laufen (z. B. Mini-PC/Raspberry Pi am
Hof, siehe Plan Teil D) - der Hetzner-Server erreicht `192.168.2.x` nicht.
Der fahrzeug-poller darf auf Hetzner laufen, weil dort Traccar selbst der
Server ist, den die Tracker über eine echte Internet-SIM erreichen - die
Waage ist dagegen nur lokal im Hofnetz ansprechbar.

Als systemd-Dienst (`Restart=always`), nicht als Timer - der Agent läuft
dauerhaft und wartet auf Scans:

```bash
cd /pfad/zum/repo && git pull
cd tools/ernte-waage-agent && npm ci
sudo install -m 600 /dev/null /etc/ernte-waage-agent.env
sudo nano /etc/ernte-waage-agent.env   # Inhalt: siehe .env.example
sudo cp ernte-waage-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ernte-waage-agent
journalctl -u ernte-waage-agent -f
```

Hinweis: Im Dauerbetrieb am Hof macht `SCANNER_QUELLE=simuliert` keinen
Sinn mehr (niemand sitzt am Terminal, um ENTER zu drücken) - sobald der
echte Scanner da ist, auf `stdin` oder `seriell` umstellen.

## Zuverlässiger Dauerbetrieb auf dem Raspberry Pi 3B+ (nächster Schritt)

Geplantes Zielgerät: **Raspberry Pi 3B+** (vorhandenes Lager-Exemplar).
Stromausfälle am Hof sind laut Nutzer an der Waage nicht zu erwarten -
trotzdem schützen die folgenden Punkte zusätzlich gegen SD-Karten-Verschleiß
durch normales Dauer-Schreiben (Logs, Warteschlangen-Datei) und gegen jedes
unsaubere Abschalten (Stecker ziehen, Reboot-Hänger), nicht nur gegen
Stromausfälle im engeren Sinn.

1. **Von USB statt microSD booten** (Pi 3B+ unterstützt das offiziell seit
   dem Bootloader-Update 2017):
   - Einmalig von SD-Karte booten, dann:
     ```bash
     echo program_usb_boot_mode=1 | sudo tee -a /boot/config.txt
     sudo reboot
     ```
   - Danach Raspberry Pi OS mit dem Raspberry Pi Imager auf einen USB-Stick
     oder eine kleine USB-SSD schreiben, SD-Karte entfernen, von USB booten.
     (Neuere `raspi-config`-Versionen bieten das auch als Menüpunkt
     "Boot Order" unter Advanced Options an - führt zum selben Ergebnis.)
   - Deutlich langlebiger/robuster gegen Korruption als microSD; SD-Karte
     danach nur noch Reserve.
2. **Overlay-Filesystem (Read-Only-Root) aktivieren:**
   ```bash
   sudo raspi-config
   # -> Performance Options -> Overlay File System -> aktivieren,
   # Boot-Partition ebenfalls schreibgeschuetzt
   ```
   Das eigentliche Betriebssystem ist danach gegen Schreibvorgänge/
   Korruption immun; nur ein bewusst ausgenommener Pfad (z. B. das
   Verzeichnis der lokalen Warteschlangen-Datei, siehe `queue.mjs`) bleibt
   beschreibbar.
3. **Kabel-Ethernet statt WLAN** für die Dauerverbindung ins Hofnetz nutzen
   (der 3B+ hat einen eingebauten Ethernet-Port) - stabiler als WLAN in der
   Werkstatt-/Waagenumgebung.
4. **Hardware-Watchdog aktivieren** (reboot bei komplett hängendem System,
   unabhängig von `systemd`'s eigenem `Restart=always` für den Agent-
   Prozess, der nur Prozess-Abstürze abfängt, nicht einen hängenden Kernel):
   ```bash
   echo dtparam=watchdog=on | sudo tee -a /boot/config.txt
   sudo sed -i 's/^#RuntimeWatchdogSec=.*/RuntimeWatchdogSec=14/' /etc/systemd/system.conf
   sudo reboot
   ```
5. **`ernte-waage-agent.service` hat bereits `Restart=always`/`RestartSec=5`**
   (siehe oben im Repo) - kein weiterer Schritt nötig, fängt Abstürze des
   Node-Prozesses selbst ab.
6. **Noch offen/später:** Alarmierung, falls der Pi komplett offline geht
   (Stromausfall am Gerät selbst, Netzwerkausfall) - könnte sich an die
   bestehende Telegram-Alarmierung des `fahrzeug-poller` anlehnen
   ([[fahrzeuge-traccar]]), ist aber noch nicht umgesetzt.

## Noch nicht Teil dieses Agenten

- Die eigentliche Zuordnung "Kiste X war an Maschine Y, Feld Z" passiert
  später im pg_cron-Processor (Plan Teil E), der `ernte_scan` mit
  `ernte_kiste_zyklus` abgleicht - das kommt erst mit der Maschinen-/
  GPS-Seite (SpidertrackBox).
