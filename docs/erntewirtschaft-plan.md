# Erntewirtschaft — Architektur- und Umsetzungsplan

Stand: 2026-09-04. Arbeitsdokument (wie `unterkunft-plan.md`), damit der
Planungsstand einen Konsolen-Neustart übersteht. Noch **kein Code** — wartet auf
die Hardware-Entscheidungen unten.

## Idee

Lückenlose Kette von der Erntearbeit auf dem Feld bis zum gewogenen Ertrag am Hof,
um einen echten Realitätscheck über die Arbeitseffizienz zu bekommen:

```
Feld:      Spargelspinne (SpidertrackBox: LTE + RTK-GPS + UHF-RFID + Batterie)
             Fahrer scannt morgens 1× seinen Badge          → ernte_schicht
             Fahrer scannt leere Kiste, erntet rein          → ernte_kiste_zyklus (offen)
             Fahrer scannt nächste Kiste                     → vorige implizit "voll"
LKW:       holt volle Kisten ab, fährt zum Hof              (LKW schon im Fahrzeug-Modul)
Hof:       Waage + stationärer UHF-Leser scannt die Kiste   → Zyklus: gewogen_am, kg
Ergebnis:  pro Kiste: Maschine · Fahrer · Feld/Flur (aus GPS) · Zeit · netto kg
           → kg/Personenstunde, kg/Maschinenstunde, Ertragsdichte-Karte,
             gebuchte Stunden (work_entries) vs. Maschine-aktiv-Zeit
```

## Feststehende Fakten (aus der Klärung 2026-09-03/04)

- **140 Erntemaschinen = die Spargelspinnen.** 1 Person pro Maschine.
- Fahrer **registriert sich 1×/Tag** per RFID-Badge an der Maschine.
- **Kisten-Transponder sind schon gekauft:** *Transponder Square, UHF Tag Chip U8,
  865–868 MHz, 69×23×7 mm, ABS+PC, IP68.* → **UHF, kein HF/NFC.**
- **SpidertrackBox-Teileliste ist noch NICHT gekauft** (`docs/…BOM…xlsx`) — kann
  also noch angepasst werden. Enthält aktuell: Teltonika **TRB246** (IoT-Gateway,
  RutOS, LTE + GNSS + RS232 + RS485 + I/O), Teltonika Combo-Dachantenne
  (Mobil/GNSS/WLAN), **Netronix MW-R4G** (RFID 13,56 MHz **HF** — passt NICHT zu
  den UHF-Kisten), VE.Direct-Kabel + MAX3232 (liest Victron-Batteriedaten),
  Gehäuse/Hutschiene/Klemmen.
- **Waage am Hof:** stationärer Leser *iDTRONIC-Klasse MAGNUM, UHF, Long Range,
  Ethernet/WLAN/RS232/RS485, 1 int./2 ext. Antennen.* Die **Waage selbst kommt noch**.
- **±1 m Präzision** wird gebraucht (im Testaufbau mit einem Board der
  Entwicklungsfirma erreicht — das hatte RTK). Interne TRB246-GNSS schafft das
  **nicht** (2,5–5 m).
- **SIM:** whereversim IoT-M2M-Datenkarten, monatlich aktiv/inaktiv schaltbar
  (passt zur Saison).
- **Fahrer wählt nichts.** Feld/Flur kommt aus der GPS-Position (Spatial-Join).
- **Spitze: 1600 Kisten/Tag.**
- Rolle **`erntewirtschaft`** existiert schon im Codebase (bisher nur lesend in
  anderen Modulen).
- **Rollen-Abgleich mit dem Pflichtenheft (Klärung 2026-09-04):** „Mitarbeiter"
  im Pflichtenheft = die bestehende Rolle **`zeiterfassung`** (dieselbe Ebene wie
  Stundenerfassung – Einsicht auf Maschinen/Belegungen, teils auch Datenpflege).
  „Techniker" ist veraltet und meint ebenfalls diese Ebene. „Chef" = **`admin`**.
  Es gibt **keine Einzel-Logins für die ~140 Erntehelfer** – die Ebene
  „Mitarbeiter" ist eine Vorarbeiter-/Büro-Ebene, kein Kiosk-Login pro Person.
- **Abrechnung läuft wie bei Zuckermais/Erdbeeren/Spargel:** Tageswerte
  erfassen/prüfen → „Freigeben/Alles speichern" → Tagesprämie fließt sofort in
  `season_bonuses`/`season_summary` und damit automatisch in Lohnübersicht/
  Auszahlung ein. Keine eigene Abrechnungslogik nötig, nur ein weiterer Prämien-
  Strom im selben, schon vorhandenen Mechanismus.
- „Liste Kassensysteme" (Vorbild für die Maschinenliste im Pflichtenheft) gibt
  es in spargar26 nicht und ist zu ignorieren – Karte/Liste der 140 Maschinen
  werden frei nach spargar26-Konventionen gestaltet (Muster: Fahrzeuge-Modul).

## Hardware-Entscheidungen — OFFEN, mit Empfehlung

| Thema | Optionen | Empfehlung |
|---|---|---|
| **Kisten-Scan an der Maschine** (Tags sind UHF U8) | Netronix HF streichen; **UHF-Reader-Modul** an die Box, mit Near-Field-Antenne / getriggertem Einzel-Lesevorgang, damit nur die *vorgehaltene* Kiste zählt und nicht der Stapel auf der Maschine | UHF-Reader + definierter Scan-Punkt (Halterung/„Tasche" + Taster). Fahrer-Badge wird dann ebenfalls ein UHF-Tag. Netronix + MAX3232-für-RFID entfallen. |
| **±1 m** | RTK-Empfänger (u-blox **ZED-F9P**-Klasse, Multiband L1/L2/L5) + NTRIP-Korrektur + Multiband-Antenne. TRB246 als NTRIP-Client reicht RTCM an den F9P durch; F9P → NMEA (GGA Fix-Qualität 4) → TRB246 → Traccar | F9P + **SAPOS** (in mehreren Bundesländern für Landwirtschaft günstig/kostenlos), sonst **PPP** (u-blox PointPerfect, kein Basisstations-Betrieb). Combo-Antenne bleibt für LTE/WLAN, separate GNSS-Multiband-Antenne dazu. Mehrkosten grob **+250–450 €/Box** + NTRIP-Gebühr. |
| **Positions-Lograte** | 1 s / 5 s / on-move+min-distance | **1 s** in der Traccar-PostgreSQL (kurze Retention), **5 s** heruntergerechnet nach `ernte_position`. |
| **Feld-Geometrien** | aus Pachtwesen2026 importieren / in Spargar neu pflegen | `ernte_feld` mit PostGIS in der Spargar-DB; Erstbefüllung als Import, danach kleiner Karten-Editor. |
| **Scan-Processor** | pg_cron-plpgsql / Modul im systemd-Poller | **pg_cron** — DB-intern, unabhängig davon ob die Poller-Box läuft; Faltung ist mengenbasiertes SQL. |
| **Ingest-Auth** | ein Fleet-Token / Token je Box | v1: **ein Fleet-Token**; Token-je-Box später. |
| **Einschränkung** | Unter Folientunnel/Vlies verliert RTK ggf. den Fix | akzeptiert; im offenen Feld stabil. Fix-Qualität wird je Punkt gespeichert. |

## Teil A — Traccar auf PostgreSQL (Voraussetzung)

140 TRB246 zusätzlich zu Autos/LKW → **H2 → PostgreSQL ist jetzt Pflicht**, bevor
die Spinnen aufgenommen werden.

1. PostgreSQL bereitstellen (Hetzner-Box oder separat).
2. `traccar.xml` JDBC auf Postgres; Traccar legt das Schema per Liquibase selbst an.
   Pilot-H2-Daten sind entbehrlich (frisch starten ist ok).
3. Je TRB246 in RutOS: whereversim-APN; „GPS → Server" im Teltonika-Protokoll an
   Port 5027, Identifier = IMEI; Gerät in Traccar anlegen (bulk per `/api/devices`).
4. NTRIP-Client in RutOS → RTCM an den F9P (nach Hardware-Wahl).
5. Traccar-Gruppe/Namensschema für die Spinnen, damit der Poller sie vom
   Fahrzeug-Bestand trennen kann.

## Teil B — Datenpfad SpidertrackBox → Spargar

Drei Ströme, **getrennt geführt**:

1. **Position** → TRB246 (bzw. F9P-NMEA über TRB246) → **Traccar 5027** → Poller →
   `ernte_position` (throttled 5 s, mit `fix_qualitaet`). Nicht in
   `fahrzeug_position` (anderes Volumenprofil).
2. **RFID-Scans (Badge + Kisten) + Batterie (VE.Direct)** → TRB246 „Data to
   Server" (HTTPS-POST JSON, auf Event, mit Offline-Queue/Retry) → Edge Function
   **`ernte-ingest`** → Rohtabelle `ernte_scan`. **Nicht** über Traccar.
3. **Waage** → lokaler **Waagen-Agent** am Hof paart Tag-Lesung (MAGNUM UHF, TCP)
   + Gewicht (Schnittstelle TBD) → POST an denselben `ernte-ingest`-Endpunkt.

## Teil C — Ingest Edge Function `ernte-ingest`

Supabase Edge Function (Deno). Auth: `Authorization: Bearer <ERNTE_INGEST_TOKEN>`.
**Dumm** — nur validieren + je Ereignis eine `ernte_scan`-Zeile schreiben
(Idempotenz-Key = Hash aus `quelle|typ|ts|tag` → `on conflict do nothing`).
Business-Logik macht der Processor (Teil E, pg_cron).

Payload Maschine (TRB246):
```json
{
  "box": "<IMEI/Serial>",
  "events": [
    {"typ":"person_login","tag":"E280...","ts":"2026-04-18T05:32:11Z","lat":51.2,"lng":6.8},
    {"typ":"kiste","tag":"E280...","ts":"2026-04-18T05:41:03Z","lat":51.2,"lng":6.8},
    {"typ":"batterie","soc":78,"u":12.9,"i":-4.2,"ts":"2026-04-18T05:45:00Z"}
  ]
}
```
Payload Waage (Hof-Agent):
```json
{"waage":"hofwaage-1","tag":"E280...","gewicht_kg":9.42,"ts":"2026-04-18T13:07:55Z"}
```
Antwort: `200 {"angenommen": n, "dubletten": m}`.

## Teil D — Waagen-Agent (`tools/ernte-waage-agent/`)

Kleiner Node/Python-Dienst auf einem Mini-PC/RPi am Hof (Muster wie
`tools/fahrzeug-poller/`):

- liest Kisten-Tag vom **MAGNUM UHF** über TCP (bzw. Reader pusht zum Agenten);
- liest Gewicht von der **Waage** (RS232/Ethernet, Modell TBD) — „stabiles Gewicht"
  als Trigger;
- **paart**: stabiles Gewicht ≠ 0 + frische Tag-Lesung innerhalb von N Sekunden →
  ein `{waage, tag, gewicht_kg, ts}` → POST an `ernte-ingest`;
- lokale SQLite-Queue + Retry bei Netzausfall;
- Config: Reader-IP, Waagen-Port, Ingest-URL/Token, Paarungsfenster, Mindestgewicht.

## Teil E — Datenbank (Modul-Migration + `schema.sql`-Abschnitt)

PostGIS aktivieren (`create extension if not exists postgis`).

**`ernte_maschine`** — die 140 Spinnen: `id identity pk`, `nummer text unique`,
`bezeichnung`, `box_seriennummer`, `traccar_unique_id text unique`,
`rtk boolean default true`, `aktiv boolean default true`, `notiz`, timestamps +
`updated_at`-Trigger.

**`ernte_position`** — Zeitreihe (append-only, nur Poller): `id identity pk`,
`maschine_id → ernte_maschine`, `traccar_unique_id text`, `zeitpunkt timestamptz`,
`lat/lng double precision`, `hoehe_m`, `speed_kmh`, `kurs`,
`fix_qualitaet smallint` (0 kein, 1 GPS, 2 DGPS, 4 RTK-Fix, 5 RTK-Float),
`hdop`, `flurstueck_id bigint`, `feld text` (Spatial-Join, denorm.),
`unique(traccar_unique_id, zeitpunkt)`, Index `(maschine_id, zeitpunkt desc)`.
Monats-Partitionierung + Retention-Job (~400 Tage).

**`ernte_tag`** — Transponder-Register: `uid text pk`,
`art text check (art in ('person','kiste'))`, `employee_id → employees`,
`kiste_nr text`, `aktiv boolean default true`, `notiz`, timestamps.

**`ernte_schicht`** — Tages-Login: `id identity pk`, `maschine_id → ernte_maschine`,
`employee_id → employees` (aus Tag aufgelöst, nullbar), `tag_uid text`,
`beginn timestamptz`, `ende timestamptz` (End-of-Day-Job / nächster Login /
Timeout aus `ernte_konfig`), `quelle text default 'scan'`, `notiz`,
Index `(maschine_id, beginn desc)`.

**`ernte_kiste_zyklus`** — eine Zeile je Befüll-→-Wiege-Runde: `id identity pk`,
`tag_uid text`, `kiste_nr text` (denorm.), `maschine_id → ernte_maschine`,
`schicht_id → ernte_schicht`, `employee_id → employees` (denorm.),
`befuellt_am timestamptz`, `befuellt_lat/lng`, `voll_am timestamptz`
(= Zeitpunkt des nächsten Kisten-Scans an derselben Maschine, implizites
Schließen), `voll_lat/lng`, `flurstueck_id bigint`, `feld text`, `kultur text`,
`gewogen_am timestamptz`, `gewicht_brutto_kg numeric(7,2)`, `tara_kg numeric(6,2)`
(aus `ernte_konfig`), `gewicht_netto_kg` (Sicht/Generated),
`waage_id → ernte_waage`,
`status text default 'offen' check (status in ('offen','gewogen','verworfen','ungeklaert'))`,
`notiz`. Indizes `(maschine_id, befuellt_am desc)`,
`(tag_uid) where status = 'offen'`, `(gewogen_am) where status = 'gewogen'`.
Wiege-Ereignis sucht den jüngsten offenen Zyklus zu `tag_uid` → `gewogen`.
Sonderfälle → `ungeklaert`: Wiegen ohne offenen Zyklus, zweites Wiegen, nie
gewogen nach N Stunden.

**`ernte_scan`** — Rohprotokoll (append-only, Ingest): `id identity pk`,
`empfangen_am timestamptz default now()`,
`quelle text check (quelle in ('maschine','waage'))`, `maschine_id bigint`,
`box_seriennummer text`, `waage_id bigint`, `tag_uid text`,
`ereignis text` ('person_login' | 'kiste' | 'gewicht' | 'batterie' | 'heartbeat'),
`zeitpunkt timestamptz` (Geräte-Zeit), `lat/lng`, `gewicht_kg numeric`,
`roh jsonb`, `verarbeitet_am timestamptz`, `verarbeitung_fehler text`.
Index `(verarbeitet_am) where verarbeitet_am is null`, `(quelle, zeitpunkt desc)`.
Alles Abgeleitete ist hieraus reprozessierbar.

**`ernte_waage`** — Hofwaage(n): `id identity pk`, `name`, `standort`,
`reader_uid text`, `aktiv boolean`, timestamps.

**`ernte_feld`** — Feld-/Schlaggeometrien: `id identity pk`, `name`, `flur`,
`gemarkung`, `kultur text`, `geom geometry(MultiPolygon,4326)`,
`laufmeter_gesamt numeric(9,1)` (Summe Dammlänge/Reihen des Feldes — Stammdatum
fürs Pflichtenheft-Feature „Arbeitsfortschritt in %", Quelle noch offen, siehe
unten), `aktiv boolean default true`, timestamps. GIST-Index auf `geom`.
Erstbefüllung Import aus Pachtwesen2026 (falls dort verfügbar), sonst Karten-Editor.

**`ernte_maschine_energie`** (v1.1) — VE.Direct-Telemetrie: `id`, `maschine_id`,
`zeitpunkt`, `soc_prozent`, `spannung_v`, `strom_a`,
`pv_status text check (pv_status in ('bulk','float','absorption'))` (Victron-
Laderegler-Zustand, aus dem Pflichtenheft), `roh jsonb`,
`unique(maschine_id, zeitpunkt)`.

**`ernte_konfig`** — `schluessel text pk`, `wert text`, `beschreibung`. Seed:
`tara_kg_standard`, `schicht_timeout_min`, `kiste_offen_warn_h`, `position_rate_s`,
`offline_warn_min=5`, `offline_alarm_min=10`, `batterie_warn_v=24`,
`batterie_alarm_v=22`, `pause_max_meter=2`, `pause_fenster_min=5` — alle
Schwellen 1:1 aus dem Pflichtenheft (Ampel Online/Offline, Batterie, Pausen-
Erkennung), damit sie ohne Deploy nachjustierbar bleiben statt hart codiert.

**`ernte_poller_state`** — `id int pk default 1`, `letzter_lauf`,
`letzte_position_zeit`.

### Sichten (alle `security_invoker = true`, `grant select … to authenticated`)

- **`ernte_kiste_uebersicht`** — flache Zyklen mit Maschinen-/Fahrername, Feld,
  netto kg, Dauern. Für die Modul-Tabelle.
- **`ernte_ertrag_tag`** — je (Tag `Europe/Berlin`, Maschine, Feld):
  `sum(netto_kg)`, `count(*) kisten`, `min(befuellt_am)`, `max(gewogen_am)`.
- **`ernte_effizienz_schicht`** — je `ernte_schicht`, Arbeitszeit-Modell 1:1 aus
  dem Pflichtenheft (löst die frühere offene Frage 4 — der Stundenzettel bleibt
  führend, die Maschinenzeit ist Kontrollgröße):
  - `netto_maschinenzeit` = `ende − beginn` der Schicht.
  - `pausenzeit` = Summe der Standzeit-Fenster (`< pause_max_meter` in
    `pause_fenster_min` Minuten zurückgelegt, aus `ernte_position`).
  - `produktivzeit` = `netto_maschinenzeit − pausenzeit`.
  - `gebuchte_stunden` = Join `work_entries` (gleicher Mitarbeiter + Tag) — die
    **weiterhin manuell erfasste Brutto-Arbeitszeit**, bleibt die bezahlte Größe.
  - `fahrt_ruestzeit` = `gebuchte_stunden − netto_maschinenzeit` (kann negativ
    sein → Hinweis, nicht hart validiert).
  - `kg_pro_stunde` (kg / produktivzeit), `kg_pro_laufmeter` (kg /
    Tages-Laufmeter aus `ernte_laufmeter_tag`).
- **`ernte_laufmeter_tag`** — je (Tag, Maschine, Feld): aus `ernte_position`
  aufsummierte Distanz zwischen aufeinanderfolgenden Punkten (Haversine, nur
  während Bewegung/RTK-Fix, Ausreißer/Sprünge gekappt) = „Laufmeter heute".
  Kumuliert über die Saison vs. `ernte_feld.laufmeter_gesamt` → Fortschritt in
  % fürs Dashboard (inkl. Summe letzte 48 h laut Pflichtenheft).
- **`ernte_kette_luecken`** — Reconciliation: „befüllt, nie gewogen"
  (`status='offen'` und `befuellt_am < now() − kiste_offen_warn_h`),
  „gewogen ohne Befüllung" (`status='ungeklaert'`),
  „eingeloggt, nichts geerntet", implausibles Nettogewicht.
- **`ernte_maschine_live`** — jüngste `ernte_position` je Maschine + aktive
  Schicht + kg heute. Für Karte/Überblick.

### RLS (Muster wie `fahrzeug`)

- `select` auf alle `ernte_*`-Tabellen + Sichten: `admin`, `hr`, `management`,
  `erntewirtschaft`, **`zeiterfassung`** (= „Mitarbeiter"/„Techniker" im
  Pflichtenheft — Dashboard, Maschinenliste, Belegungen).
- `ernte_maschine`, `ernte_tag`, `ernte_waage`, `ernte_feld`, `ernte_konfig`:
  `for all` `admin`, `hr`; laufende Korrekturen (Maschine↔Feld/Mitarbeiter
  manuell überschreiben) zusätzlich `erntewirtschaft`, `zeiterfassung` — analog
  zu `praemien/zuckermais`, wo dieselben zwei Rollen mit-editieren dürfen.
- Feldstufen setzen/ändern und die finale Auszahlungs-„Manipulation" (Chef laut
  Pflichtenheft) bleiben **`admin`**-only, wie die Satz-Verwaltung bei
  Zuckermais.
- `ernte_scan`, `ernte_position`, `ernte_maschine_energie`: **keine
  Insert-Policy** — nur Service-Key (Ingest/Poller).
- `ernte_schicht`, `ernte_kiste_zyklus`: Insert nur Service-Key; enge
  `update`-Policy für `admin`/`hr` (Korrekturen, Audit-Log).

### Processor (pg_cron, jede Minute)

plpgsql-Funktion faltet `ernte_scan where verarbeitet_am is null`:
- `person_login` → `ernte_schicht` (neue Schicht, wenn nicht schon heute offen für
  Maschine+Fahrer).
- `kiste` an Maschine M → jüngsten offenen Zyklus für M schließen (`voll_am`,
  `voll_lat/lng`), neuen Zyklus `offen` anlegen (`befuellt_*`, `schicht_id` aus
  aktiver Schicht an M, Spatial-Join `ernte_feld` → `feld`/`kultur`).
- `gewicht` (Tag T) → jüngsten offenen Zyklus für T → `gewogen_am`,
  `gewicht_brutto_kg`, `tara_kg` aus Konfig, `status='gewogen'`; kein Treffer →
  `ungeklaert`-Zyklus.
- `batterie` → `ernte_maschine_energie` (v1.1).
- danach `verarbeitet_am = now()`.

## Teil F — App (Modul „Erntewirtschaft")

- Nav-Eintrag „Erntewirtschaft" (`components/Nav.tsx`), Rollen `admin`, `hr`,
  `management`, `erntewirtschaft`. Icon z. B. `Sprout`/`Tractor`.
- `components/ErntewirtschaftTabs.tsx`.
- **`/erntewirtschaft`** — Überblick: Karte mit den Spinnen (Live-Position, Farbe
  nach Fix-Qualität RTK/Float/GPS, Klick → Maschine + aktuelle Schicht + kg heute),
  Tages-Kacheln (Kisten heute, kg heute, Ø kg/h, offene Ketten-Lücken). Karten-
  Muster aus `FahrzeugKarte` (ggf. zu gemeinsamem `GpsKarte` verallgemeinern).
- **`/erntewirtschaft/ernte`** — Kisten-Zyklen: Datumsfilter, Tabelle (befüllt ·
  Maschine · Fahrer · Feld · netto kg · gewogen · Status), Filter „nur Lücken",
  CSV-Export.
- **`/erntewirtschaft/effizienz`** — Realitätscheck: je Schicht/Fahrer/Maschine/
  Feld kg, Stunden (Schicht vs. `work_entries`), kg/h; Ertragsdichte-Heatmap aus
  `ernte_kiste_zyklus`-Positionen (gewichtet mit netto kg); Zeitraum-Wähler; Export.
- **`/erntewirtschaft/stammdaten`** — Maschinen-CRUD, Waagen, Felder (Karten-
  Editor / Import), Konfig-Konstanten. **Excel-/CSV-Import für die 140 Maschinen**
  (siehe unten).
- **`/erntewirtschaft/transponder`** — Tag-Verwaltung: Liste + Suche;
  „Tag anlernen" (letzter unbekannter `ernte_scan` → Art wählen → Person/Kiste
  zuordnen); **Excel-/CSV-Import für die Kisten-Transponder** (siehe unten).
  Tagesgeschäft fürs Onboarding neuer Kisten/Badges.

### Excel-/CSV-Import (Maschinen und Transponder)

Bulk-Import, weil 140 Maschinen + tausende Kisten-Tags niemand von Hand tippt.

- **Maschinen:** Spalten `nummer`, `bezeichnung`, `box_seriennummer`,
  `traccar_unique_id` (IMEI). Upsert auf `nummer`.
- **Transponder:** Spalten `uid`, `art` (`person`/`kiste`, Default `kiste`),
  `kiste_nr`. Upsert auf `uid`.
- **Vorschau vor dem Schreiben:** erkannte Zeilen, Dubletten, Fehler; erst dann
  „Importieren".
- **Umschalter „aktiv / inaktiv" für den ganzen Import, Default `inaktiv`** — die
  importierten Datensätze bekommen `aktiv = false` und werden erst später (je
  Zeile oder Mehrfachauswahl in der Liste) scharfgeschaltet. Passt zur
  Saison-Logik (whereversim je Maschine monatlich aktivieren) und verhindert, dass
  frisch importierte, noch nicht aufgebaute Maschinen sofort auf der Karte / im
  Effizienz-Check auftauchen.
- Inaktive Maschinen/Tags: nicht auf der Überblickskarte, nicht im Effizienz-
  Check; `ernte_scan` von einer inaktiven Maschine wird trotzdem roh gespeichert
  (nicht verloren), aber vom Processor als `verarbeitung_fehler = 'maschine
  inaktiv'` liegen gelassen, bis sie aktiv ist.
- `lib/types.ts`: `ErnteMaschine`, `ErntePosition`, `ErnteTag`, `ErnteSchicht`,
  `ErnteKisteZyklus`, `ErnteScan`, `ErnteWaage`, `ErnteFeld` + Sicht-Typen +
  Label-Maps.

## Teil F2 — Boni/Feldstufen (aus dem Pflichtenheft, wie Zuckermais)

Wird als **weiterer Prämien-Strom** in die bestehende Prämien-Infrastruktur
eingehängt (`praemien_zuckermais`/`praemien_erdbeeren`/`praemien_spargel`-
Muster: Rohdaten-Tabelle je Tag/Person, Sätze-Verwaltung mit „gültig ab",
`alleSpeichern()` → `season_bonuses`/`season_summary`), **kein** separates
Abrechnungssystem — das beantwortet den Pflichtenheft-Punkt „Abrechnung Lohn"
(Zeile 54, dort ohne Inhalt): funktioniert exakt wie bei Zuckermais.

- Pro Person eine Vergütungsart **Akkord** oder **Feldstufe/Prämie**
  (neues `employees`-Flag oder eigene kleine Tabelle, Muster wie die drei
  vorhandenen `praemien_*`-Booleans).
- **Feldstufe** 1–100 je Feld/Tag, aus dem Vortag vorgeschlagen, von `admin`
  (Chef) änderbar — neue Tabelle `ernte_feldstufe (feld_id, tag, stufe,
  gesetzt_von, gesetzt_am)`.
- Tagesprämie = `ernte_ertrag_tag.netto_kg × Preis(Feldstufe)` (Satztabelle wie
  `zuckermais_saetze`, „gültig ab"-versioniert).
- **Offen, bewusst nicht gelöst:** das im Pflichtenheft selbst als ungeklärt
  markierte Problem „dünne Stangen = wenig kg UND wenig Laufmeter" (Schieber
  kg/h ↔ Lfm/h, 0–1) — braucht eine Entscheidung des Nutzers, bevor die Formel
  feststeht. Bis dahin nur kg-basiert wie oben.
- **Tagesliste Boni** (`/erntewirtschaft/tagesliste`, Rolle `zeiterfassung`+):
  druckbare, optisch aufbereitete Prämienliste je Tag, Spalten ein-/ausblendbar
  für den Ausdruck (Muster: Lohnübersicht-Monatsdruck). Beispielvorlage liegt
  als SharePoint-Link im Pflichtenheft — kein Zugriff, Nutzer schickt sie
  direkt/als Screenshot nach.
- Finale **Manipulation je Person** vor „Freigeben/Alles speichern" bleibt
  `admin`-only (Audit-relevant, wie oben bei RLS).

## Teil G — Poller-Erweiterung

Neues Modul im systemd-Poller (oder zweite Instanz): liest die Spinne-Geräte aus
Traccar (Gruppe/Namensschema), schreibt gedrosselt `ernte_position` (jeder Punkt
mit `position_rate_s`-Raster; bei Fix-Abfall unter RTK jeden Punkt, für QA),
Spatial-Join `ernte_feld` → `flurstueck_id`/`feld`. Retention/Downsample-Job.

## Teil H — Deploy-Reihenfolge (Nutzer)

1. Hardware-Entscheidungen oben treffen (UHF-Reader an der Maschine, RTK-Kette,
   NTRIP-Quelle) — **vor** dem Kauf der SpidertrackBox-Teile.
2. Traccar auf PostgreSQL umstellen.
3. Migration `erntewirtschaft` in Supabase; PostGIS aktivieren; `ernte_feld`
   befüllen.
4. Edge Function `ernte-ingest` deployen; `ERNTE_INGEST_TOKEN` setzen.
5. pg_cron-Processor einrichten.
6. Eine Spinne als Pilot komplett aufbauen (RTK + UHF + Data-to-Server), End-to-End
   testen (Badge → Kiste → LKW → Waage → `ernte_kiste_zyklus` gewogen).
7. Waagen-Agent am Hof aufsetzen, sobald die Waage da ist.
8. Rollout auf die 140 Maschinen; whereversim je Maschine zur Saison aktivieren.
9. Mitbestimmung mit den Fahrern klären, bevor der Effizienz-Check scharfgeschaltet
   wird.

## Offene Fragen an den Nutzer

1. **Feld-Geometrien:** liegen die Flurstück-/Schlag-Polygone schon in derselben
   Supabase-DB (Pachtwesen2026), oder importieren/neu pflegen? PostGIS im
   Supabase-Projekt schon aktiv?
2. **UHF-Lesetiefe an der Maschine:** gibt es an der Spinne einen definierten
   Scan-Punkt (Halterung/Tasche), an dem der Fahrer die leere Kiste vorhält? Sonst
   liest ein UHF-Reader mehrere Kisten auf einmal.
3. **Waage:** sobald das Modell feststeht — Schnittstelle (RS232 / Ethernet /
   Impuls)? Rechner am Hof für den Agenten vorhanden oder Teil des Projekts (RPi)?
4. ~~`work_entries`-Kopplung~~ — **geklärt** (Pflichtenheft): der Stundenzettel
   bleibt führend, die Maschinenzeit ist Kontroll-/Differenzgröße.
5. **Tara:** feste Konstante je Kistentyp (welcher Wert?), oder werden Kisten auch
   leer gewogen?
6. **Mitbestimmung:** die Kette Fahrer→Kiste→kg→Stunden ist personenscharfe
   Leistungserfassung — vor Scharfschaltung mit den Fahrern/Betriebsrat klären.
7. **Laufmeter-Stammdaten:** woher kommt `ernte_feld.laufmeter_gesamt`
   (Dammlänge/Reihen je Feld) — aus Pachtwesen2026 ableitbar (Geometrie ×
   Dammabstand), oder muss das separat gepflegt werden?
8. **Feldstufen-Algorithmus:** wie soll der „dünne Stangen"-Fall (wenig kg UND
   wenig Laufmeter) bewertet werden — fester Kg-Preis je Stufe reicht erstmal,
   der im Pflichtenheft skizzierte kg/h↔Lfm/h-Schieber ist vertagt, bis eine
   klare Formel feststeht.
9. **Vergütungsart je Person** (Akkord vs. Feldstufe/Prämie): reicht ein
   einfaches Flag wie bei den drei bestehenden `praemien_*`-Booleans, oder soll
   sich das je Saison ändern können?

## Nicht in v1

- LKW-Bein explizit verknüpfen (Kiste ↔ Transport-Fahrzeug ↔ Ankunft Hof) — die
  LKW sind schon im Fahrzeug-Modul.
- VE.Direct-Energie-Auswertung als eigene Sicht (Tabelle v1, Auswertung v1.1).
- Auto-Lenkung/Guidance der Spinne (macht die Maschinensteuerung selbst).
- Echtzeit statt Poll.
- Sorten-/Qualitätsklassen je Kiste (Handsortierung an der Waage) — später.
