# Fahrzeug-Poller

Holt alle ~30 s die aktuellen Positionen aus **Traccar** (`/api/devices`,
`/api/positions`) und schreibt sie mit dem **Supabase-Service-Key** in die
Tabellen `fahrzeug_tracker` / `fahrzeug_position`. Läuft **auf dem
Hetzner-Server neben Traccar**, nicht im Vercel-Frontend.

Die spargar26-App liest nur (`fahrzeug_uebersicht` etc.) – `fahrzeug_position`
hat bewusst keine Insert-Policy.

## Einrichtung auf dem Hetzner-Server

```bash
# 1. Node (Ubuntu 24.04 bringt v18 mit; vorhandenes v20+ ist auch ok)
node --version || sudo apt install -y nodejs

# 2. Repo aktuell + Abhängigkeit installieren (kein sudo)
cd /home/tarik/projekte/spargar26 && git pull
cd tools/fahrzeug-poller && npm ci   # (oder: npm install)

# 3. Traccar-Token holen:
#    Traccar -> Einstellungen -> dein Benutzer -> "Token" generieren
#    (oder einen eigenen read-only Traccar-Benutzer anlegen und Basic-Auth nutzen)

# 4. Supabase-Service-Key: Dashboard -> Project Settings -> API -> service_role

# 5. Env-Datei anlegen (root, nur lesbar für root)
sudo install -m 600 /dev/null /etc/fahrzeug-poller.env
sudo nano /etc/fahrzeug-poller.env      # Inhalt: siehe .env.example

# 6. Einmal von Hand testen
set -a; source /etc/fahrzeug-poller.env; set +a
node index.mjs
#  -> "... N Geräte, M Positionen geschrieben"

# 7. systemd-Timer installieren
sudo cp fahrzeug-poller.service fahrzeug-poller.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fahrzeug-poller.timer

# 8. Beobachten
systemctl list-timers fahrzeug-poller.timer
journalctl -u fahrzeug-poller -f
```

## Aktualisieren

```bash
cd /home/tarik/projekte/spargar26 && git pull
cd tools/fahrzeug-poller && npm ci
# Timer läuft weiter, nächster Lauf nutzt den neuen Code automatisch
```

## Stufe 2 – Geofences & Alarm

Ab Migration `2026-09-26` spiegelt der Poller zusätzlich die **Traccar-Geofences**
und baut aus den Traccar-Events (`geofenceEnter/Exit`, `deviceMoving`) ein
Ereignis-Log (`fahrzeug_ereignis`). Ereignisse außerhalb der in der App
eingestellten Arbeitszeit (`fahrzeug_arbeitszeit`) werden als `alarm_relevant`
markiert und – wenn Telegram konfiguriert ist – als eine gebündelte Nachricht
verschickt.

Einrichtung:
1. In Traccar 2 Geofences um die Höfe zeichnen und den Geräten zuweisen.
2. In `/etc/fahrzeug-poller.env` ergänzen (siehe `.env.example`):
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TIMEZONE=Europe/Berlin`.
   Kein Neustart nötig – der nächste Lauf liest die Env-Datei neu.
3. In der App unter `/fahrzeuge/einstellungen` die Arbeitszeiten setzen und
   markieren, welche Geofences „Höfe" sind.

## Wichtig

- `/etc/fahrzeug-poller.env` enthält den Service-Key → `chmod 600`, niemals ins
  Repo.
- Der Poller macht ~1x/Tag ein `delete` alter Positionen (`RETENTION_DAYS`,
  Standard 90) – Fortschritt in `fahrzeug_poller_state`.
- Bei einem Fehler beendet sich der Lauf mit Exit-Code 1 →
  `systemctl status fahrzeug-poller` / `journalctl -u fahrzeug-poller` zeigt ihn.
