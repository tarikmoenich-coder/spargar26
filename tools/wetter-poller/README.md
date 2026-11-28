# Wetter-Poller

Holt die **DWD-MOSMIX_L-Vorhersage** (stündlich, 10 Tage, 4× täglich neu) für
die nächstgelegenen Vorhersagepunkte aller aktiven Felder mit Geometrie und
schreibt sie mit dem **Supabase-Service-Key** nach `wetter_station`,
`wetter_stunde` und `wetter_feld`. Konzept: `docs/wetter-konzept.md`.
Quelle: Deutscher Wetterdienst (Open Data) – die App nennt die Quelle.

Läuft stündlich um :20 (die DWD-Ausgaben kommen ca. 1 h nach 03/09/15/21 UTC);
eine Station wird nur neu geschrieben, wenn der DWD eine neue Ausgabe hat.

## Einrichtung auf dem Hetzner-Server

```bash
# 1. Repo aktuell + Abhängigkeit installieren (kein sudo)
cd /home/tarik/projekte/spargar26 && git pull
cd tools/wetter-poller && npm ci

# 2. Env-Datei (Service-Key wie beim Ernte-Poller)
sudo install -o "$(id -un)" -m 600 /dev/null /etc/wetter-poller.env
sudo nano /etc/wetter-poller.env      # Inhalt: siehe .env.example

# 3. Einmal von Hand testen
set -a; source /etc/wetter-poller.env; set +a
node index.mjs
#  -> "... N Punkte, M Vorhersagepunkte (...), M neu geladen"

# 4. Timer einschalten
sudo cp wetter-poller.service wetter-poller.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wetter-poller.timer
systemctl list-timers wetter-poller.timer
journalctl -u wetter-poller -n 20
```

Trockenlauf ohne Supabase:
`DRY_RUN=1 TEST_LAT=50.04 TEST_LNG=8.97 node index.mjs`
