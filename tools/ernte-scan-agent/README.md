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

## Serielle Schnittstelle: cs8/-parenb/-cstopb + icrnl (Praxistest 2026-10-20)

Erster echter Scanner (Datalogic) angeschlossen, zwei reale Probleme gefunden
und behoben:

1. **Zeichen kamen verstümmelt an** (z. B. Umlaute als Ersatzzeichen,
   einzelne falsche Buchstaben). Ursache: `stty ... raw` allein garantiert
   **nicht** 8 Datenbits/keine Parität/1 Stopbit — das hängt vom vorherigen
   Zustand der Schnittstelle ab. Fix: `cs8 -parenb -cstopb` explizit dazu.
2. **Kein einziger Scan wurde erfasst**, obwohl Daten ankamen. Ursache: Per
   Hex-Dump (`Format-Hex` in PowerShell, nachdem `od`/`base64`/`sed -n l` auf
   diesem BusyBox alle fehlten) bestätigt: Der Scanner schließt jeden Code
   nur mit **CR** (`\r`, 0x0D) ab, **kein LF**. `read` in der Shell erkennt
   aber ausschließlich `\n` als Zeilenende - das Skript wartete ewig.
   **Erster Versuch, verworfen:** eine `tr '\r' '\n'`-Pipe vor `read` -
   gepuffert, wenn `tr` in eine Pipe statt ein Terminal schreibt, kurze
   einzelne Scans kamen nie zeitnah durch (lokal nachgestellt und bestätigt).
   **Fix stattdessen:** `icrnl` als stty-Flag - lässt den **Kernel**
   synchron jedes eingehende CR in LF wandeln, kein Pufferungsrisiko.

Ein scheinbar drittes Problem (Zeichen fielen bei Mehrfach-Scans mitten im
Code weg) stellte sich bei genauerem Hinsehen als **Test-Artefakt** heraus,
nicht als echter Fehler: mehrere alte, nicht sauber beendete
`agent.sh`-Testinstanzen liefen gleichzeitig und haben sich beim Lesen
gegenseitig Bytes weggeschnappt. Mit garantiert nur einer laufenden Instanz
kamen mehrere Scans hintereinander (auch mit realistischen Pausen
dazwischen) jedes Mal exakt korrekt an.

## LED-Statusanzeige (SpidertrackBox-Erweiterung, 2026-10-20)

RGB-Status-LED (Signal-Construct SWBM08952L020, Common-Anode, 12 V) an den
drei konfigurierbaren I/O-Pins des TRB246. Diese sind laut Teltonika-Doku
**nicht** `D1`/`D2`/`D3` (wie ein erster Entwurf annahm), sondern heißen
`dio0`/`dio1`/`dio2` und sind als Ausgang **Open-Collector, bis 30 V/300 mA**
— passt elektrisch zu einer Common-Anode-LED (jeder Farbkanal wird einzeln
gegen Masse geschaltet), sofern die LED tatsächlich eine integrierte
Strombegrenzung hat (laut Datenblatt der Fall) — **vor dem ersten Anschluss
trotzdem elektrisch gegenprüfen**, bevor `LED_MODUS=echt` gesetzt wird.

**Dritter Hintergrundprozess (`led_schleife`)**, nicht in die bestehende
Sendeschleife gequetscht: ein durchgehend **blinkendes** Gelb braucht einen
eigenen, kurzen Tick (0,3–0,5 s), unabhängig vom viel längeren
`RETRY_INTERVALL_S`. `led_schleife` ist die **einzige** Stelle im ganzen
Skript, die `ubus` aufruft — Lese- und Sendeschleife schreiben nur noch in
zwei kleine Dateien (`LED_ZUSTAND_DATEI` = gewünschter Dauerzustand,
`LED_BLINK_ZAEHLER_DATEI` = Zähler, der bei jedem erfolgreich zugestellten
Scan hochgezählt wird). Das erfüllt "GPIO-Zugriffe zentral kapseln" und
vermeidet, dass zwei Prozesse unabhängig an denselben Pins schalten.

| Zustand | Bedeutung |
|---|---|
| **Rot** | Seit dem letzten Neustart noch nie erfolgreich mit `ernte-ingest` verbunden gewesen |
| **Gelb (durchgehend)** | War/ist verbunden, Warteschlange leer bzw. letzter Versand erfolgreich |
| **Gelb (blinkend)** | War schon mal verbunden, aktuell nicht erreichbar — Scans werden trotzdem lokal gesammelt (Nutzer-Idee 2026-10-19, verhindert das Missverständnis "Rot = ich darf nicht mehr scannen") |
| **Grün (2× kurz blinken)** | Server hat einen Scan soeben bestätigt, danach zurück zum vorherigen Dauerzustand |

**Bewusst zurückgestellt:** die ursprünglich geplante Unterscheidung
Gelb=nicht angemeldet / Grün=angemeldet. Dafür müsste der Agent wissen, ob
gerade ein Mitarbeiter an der Maschine eingeloggt ist — dieses Konzept
existiert im Backend noch gar nicht (das ist Teil des noch nicht gebauten
pg_cron-Processors, Teil E, der erst Kisten-Zyklen/Schichten herstellt). Bis
dahin zeigt "Gelb durchgehend" nur "online", ohne Anmelde-Unterscheidung.

**`LED_MODUS=simuliert`** (Standard) schreibt nur `LED-SIM: dioN=wert`-Zeilen
ins Log statt echte `ubus`-Aufrufe zu machen — so lange die LED nicht
verkabelt ist. Alle vier Zustände wurden in diesem Modus durchgetestet
(Start, Verbindung, Bestätigungs-Blinken, Verbindungsverlust, Erholung).
Sobald die LED angeschlossen und elektrisch verifiziert ist: `LED_MODUS=echt`
in `agent.conf` setzen, Dienst neu starten.

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
- **`ernte-ingest` ist jetzt gebaut und deployt** (`supabase/functions/ernte-ingest/`,
  2026-10-17), End-to-End per `curl` vom TRB246 selbst verifiziert.
- **Kein eigener manueller LED-Testmodus** (z.B. "Rot einschalten" als
  CLI-Befehl, unabhängig vom Scan-Betrieb) — `LED_MODUS=simuliert` deckt das
  Testen der Logik bereits ab. Für die elektrische Erstverifikation, sobald
  die LED verkabelt ist, reicht ein einzeiliger manueller `ubus call
  ioman.gpio.dio0 update '{"direction":"out","value":"1"}'`-Aufruf auf dem
  Gerät - kein eigenes Testskript nötig.

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
- Sobald `ernte-ingest` deployt ist (siehe `supabase/functions/ernte-ingest/README.md`):
  `INGEST_URL` ist schon in `agent.conf.example` korrekt vorausgefüllt, nur
  `INGEST_TOKEN` (= der per `supabase secrets set` gesetzte Wert) eintragen,
  Dienst neu starten — kein Code-Änderung nötig.
