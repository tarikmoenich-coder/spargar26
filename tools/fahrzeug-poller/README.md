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

## Wichtig

- `/etc/fahrzeug-poller.env` enthält den Service-Key → `chmod 600`, niemals ins
  Repo.
- Der Poller macht ~1x/Tag ein `delete` alter Positionen (`RETENTION_DAYS`,
  Standard 90) – Fortschritt in `fahrzeug_poller_state`.
- Bei einem Fehler beendet sich der Lauf mit Exit-Code 1 →
  `systemctl status fahrzeug-poller` / `journalctl -u fahrzeug-poller` zeigt ihn.
