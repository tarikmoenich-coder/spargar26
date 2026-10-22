# Ernte-Poller

Holt alle ~15 s die Positionen der Erntemaschinen (Spinnen) aus **Traccar**
(`/api/devices`, `/api/positions`, plus `/api/reports/route` für Lücken seit
dem letzten Lauf) und schreibt sie mit dem **Supabase-Service-Key** nach
`ernte_position`. Läuft **auf dem Hetzner-Server neben Traccar**, nicht im
Vercel-Frontend. Siehe `docs/erntewirtschaft-plan.md`, Teil G.

Baut auf demselben Muster wie `tools/fahrzeug-poller/` auf (Lücken-Nachzug per
Route-Report, Upsert mit `ignoreDuplicates`, Retention-Cleanup 1x/Tag) - zwei
wichtige Unterschiede:

- **Gerätezuordnung ohne Traccar-Gruppe.** Traccar führt Fahrzeuge UND
  Erntemaschinen in derselben Instanz. Statt (wie im Plan ursprünglich
  skizziert) eine eigene Traccar-Gruppe/Namensschema zu pflegen, erkennt der
  Poller "seine" Geräte selbst: stimmt die Traccar-`uniqueId` (= IMEI) mit
  einer `ernte_maschine.box_seriennummer` überein, wird `traccar_unique_id`
  automatisch nachgetragen. Jedes andere Gerät (Fahrzeug-Tracker) wird
  stillschweigend ignoriert - keine manuelle Traccar-Pflege nötig, auch nicht
  beim 140er-Rollout, solange jede neue Box ihre IMEI in `ernte_maschine`
  hinterlegt bekommt.
- **Gedrosseltes Schreiben (`POSITION_RATE_S`, Standard 5 s).** Das TRB246
  meldet ca. 1 Punkt/Sekunde an Traccar - bei 140 Boxen über eine ganze Saison
  wäre das ungedrosselt zu viel Volumen in Supabase. Der Poller schreibt pro
  Maschine höchstens alle `POSITION_RATE_S` Sekunden einen Punkt; Traccar
  selbst behält trotzdem die volle 1-s-Auflösung (kurze Retention dort, siehe
  Plan).

Die **Feld-Zuordnung** (`feld_id`) passiert NICHT im Node-Code, sondern über
die DB-Funktion `ernte_position_feld_zuordnen()`
(`migration_2026-10-22_ernte_position_feld_zuordnung.sql`, Spatial-Join gegen
`feld.geometrie`) - der Poller ruft sie nach jedem Schreib-Durchlauf auf.
Ohne passende Feld-Geometrie (z. B. noch nicht aus Pachtwesen2026 importiert
oder gezeichnet) bleibt `feld_id` einfach `NULL`, kein Fehler.

Die spargar26-App liest nur - `ernte_position` hat bewusst keine
Insert-Policy.

## Einrichtung auf dem Hetzner-Server

```bash
# 1. Node (sollte durch den Fahrzeug-Poller schon vorhanden sein)
node --version

# 2. Repo aktuell + Abhängigkeit installieren (kein sudo)
cd /home/tarik/projekte/spargar26 && git pull
cd tools/ernte-poller && npm ci   # (oder: npm install)

# 3. Traccar-Zugang: derselbe Token/Benutzer wie beim Fahrzeug-Poller reicht
#    (read-only, sieht beide Gerätetypen - der Poller filtert selbst heraus,
#    was zu ihm gehört)

# 4. Supabase-Service-Key: Dashboard -> Project Settings -> API -> service_role

# 5. Env-Datei anlegen (root, nur lesbar für root)
sudo install -m 600 /dev/null /etc/ernte-poller.env
sudo nano /etc/ernte-poller.env      # Inhalt: siehe .env.example

# 6. Einmal von Hand testen
set -a; source /etc/ernte-poller.env; set +a
node index.mjs
#  -> "1 Maschine(n) bekannt, N Position(en) geschrieben, M Feld-Zuordnung(en)"

# 7. systemd-Timer installieren
sudo cp ernte-poller.service ernte-poller.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ernte-poller.timer

# 8. Beobachten
systemctl list-timers ernte-poller.timer
journalctl -u ernte-poller -f
```

Voraussetzung in Supabase: `migration_2026-10-20_erntewirtschaft_kisten_zyklus.sql`
(legt `ernte_maschine`/`ernte_position`/`ernte_poller_state` an, `box_seriennummer`
der Pilot-Maschine `SPINNE-001` ist schon gesetzt) und
`migration_2026-10-22_ernte_position_feld_zuordnung.sql` (Spatial-Join-Funktion
+ die bis dahin fehlende Spalte `ernte_poller_state.letzte_bereinigung`).

## Aktualisieren

```bash
cd /home/tarik/projekte/spargar26 && git pull
cd tools/ernte-poller && npm ci
# Timer läuft weiter, nächster Lauf nutzt den neuen Code automatisch
```

## Wichtig

- `/etc/ernte-poller.env` enthält den Service-Key → `chmod 600`, niemals ins
  Repo.
- Der Poller macht ~1x/Tag ein `delete` alter Positionen (`RETENTION_DAYS`,
  Standard 365 - eine ganze Saison, länger als beim Fahrzeug-Poller) -
  Fortschritt in `ernte_poller_state.letzte_bereinigung`.
- Bei einem Fehler beendet sich der Lauf mit Exit-Code 1 →
  `systemctl status ernte-poller` / `journalctl -u ernte-poller` zeigt ihn.
- Ohne mindestens eine `ernte_maschine`-Zeile mit passender
  `box_seriennummer` schreibt der Poller gar nichts (loggt das aber deutlich,
  kein stiller Fehler).
