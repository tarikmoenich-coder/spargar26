# Ernte-Waagen-Agent

Verbindet die **RHEWA 84vario** (Hofwaage) mit einem Scanner-Code und schreibt
jede Wiegung als Zeile in `ernte_scan` (Supabase, Service-Key) -
siehe `docs/erntewirtschaft-plan.md`, Teil D.

Ablauf je Scan: Code kommt rein -> kurz warten (Kiste steht auf der Waage) ->
`<FP0>` an die Waage -> Antwort parsen -> Netto-Gewicht + Code nach Supabase.
Bei Supabase-Ausfall: lokale SQLite-Warteschlange, automatischer Retry.

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

## Einrichtung auf dem Hetzner-Server (Dauerbetrieb)

Analog zu `tools/fahrzeug-poller/`, aber als Dienst (`Restart=always`), nicht
als Timer - der Agent läuft dauerhaft und wartet auf Scans:

```bash
cd /home/tarik/projekte/spargar26 && git pull
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

## Noch nicht Teil dieses Agenten

- Die eigentliche Zuordnung "Kiste X war an Maschine Y, Feld Z" passiert
  später im pg_cron-Processor (Plan Teil E), der `ernte_scan` mit
  `ernte_kiste_zyklus` abgleicht - das kommt erst mit der Maschinen-/
  GPS-Seite (SpidertrackBox).
