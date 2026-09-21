# Reader-Testempfänger (TECTUS MAGNUM 4077)

Kleiner Empfänger, der die Lesungen des UHF-Readers am Hofwaagen-Platz anzeigt
- zum Ausprobieren von Sendeleistung, Position und RSSI mit echten Kisten,
**bevor** der Waagen-Agent gebaut wird (siehe `docs/erntewirtschaft-plan.md`,
Teil D). Der Reader sendet nach jeder Inventur-Runde einen HTTP(S)-POST mit
JSON (`TagID`, `RSSI`, `Antenna`). Dieses Programm sammelt die Nachrichten und
zeigt je Tag den RSSI-Bereich (min / Ø / max) - damit lässt sich die Kiste auf
der Waage von den Nachbarkisten unterscheiden und ein Schwellenwert festlegen.

Nur zum Testen gedacht; danach kann es wieder entfernt werden (siehe unten).

## Einrichtung (einmalig)

1. Beim DNS-Anbieter einen **A-Record** `reader-test.spargelhof-moenich.de`
   auf `2.28.48.222` anlegen (wie bei `kontakte`/`traccar`).
2. Auf dem Server: `sudo bash tools/reader-test/setup-server.sh`
   (legt Dienst, nginx-Eintrag und Zertifikat an und gibt am Ende die
   Reader-Einstellungen und die Ansichts-Adresse mit dem Geheimnis aus).

## Einstellungen im Reader

Web-Oberfläche des Readers (Werks-IP `192.168.0.159`, siehe Handbuch 3.3):

| Einstellung | Wert |
|---|---|
| Target Host | `reader-test.spargelhof-moenich.de` |
| Target Port | `443` (zum Ausprobieren ohne Zertifikat: `80`) |
| Target URL | `/in/<TOKEN>` (Ausgabe des Setup-Skripts) |
| Root-Zertifikat | `ISRG-Root-X1.crt` aus diesem Ordner hochladen |
| Betriebsart | Permanent Scan (`dev_opmode` = 1), Ausgabe Web |

Der Reader braucht dafür Internetzugang (DNS-Server und Gateway eintragen).

Falls die HTTPS-Verbindung des Readers nicht zustande kommt (Zertifikat, Uhrzeit
des Readers, Zertifikatskette), lässt sich zum Ausprobieren von Reichweite und
RSSI auch unverschlüsselt senden: `sudo bash tools/reader-test/http-freigeben.sh`
öffnet Port 80 nur für `/in/<TOKEN>` (alles andere wird weiter auf HTTPS
umgeleitet). Dann im Reader Target Port `80` eintragen.

**Hinweis zum Zertifikat:** Let's Encrypt liefert aktuell die Kette
Zertifikat → `YR1` → `Root YR` → (kreuzsigniert von) `ISRG Root X1`. Im Reader
gehört deshalb `ISRG-Root-X1.crt` als Root-Zertifikat hinein. Das Zertifikat
läuft nach 90 Tagen ab und wird vom Server automatisch erneuert.

## Ansehen

`https://reader-test.spargelhof-moenich.de/view/<TOKEN>` - aktualisiert sich alle
2 Sekunden. "zurücksetzen" leert die Zähler, "Rohdaten" zeigt die letzten
Nachrichten samt Header (zur Fehlersuche, falls das Format abweicht). Runden mit
Tags werden zusätzlich in `/var/lib/reader-test/reader-log.jsonl` geschrieben.

## Lokal ausprobieren (ohne Server)

```
READER_TOKEN=abcdef0123456789abcdef node tools/reader-test/server.mjs
curl -X POST --data '{"Permanent Scan":{"id":"x","time":"t","Tag":[{"TagID":"E280AA","RSSI":-67,"Antenna":1}]}}' \
  http://127.0.0.1:8090/in/abcdef0123456789abcdef
```

## Entfernen

```
sudo systemctl disable --now reader-test
sudo rm /etc/systemd/system/reader-test.service /etc/reader-test.env \
        /etc/nginx/sites-enabled/reader-test.spargelhof-moenich.de \
        /etc/nginx/sites-available/reader-test.spargelhof-moenich.de
sudo certbot delete --cert-name reader-test.spargelhof-moenich.de
sudo systemctl reload nginx
```
