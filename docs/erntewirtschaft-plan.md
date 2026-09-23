# Erntewirtschaft — Architektur- und Umsetzungsplan

Stand: 2026-09-04, Frequenz-Entscheidung 2026-09-22 (UHF→HF), TECTUS-Rückmeldung
2026-09-22 (HF→LF), Präzisionsanforderung präzisiert 2026-09-23 (RTK
voraussichtlich verzichtbar). Arbeitsdokument (wie `unterkunft-plan.md`),
damit der Planungsstand einen Konsolen-Neustart übersteht. Noch **kein
Code** — wartet auf die Hardware-Entscheidungen unten.

**Präzisionsanforderung geklärt (2026-09-23): RTK voraussichtlich NICHT
nötig.** Die ursprüngliche „±1 m"-Vorgabe (Klärung 2026-09-03/04) stammte aus
einem Testaufbau mit RTK, ohne dass der tatsächliche Verwendungszweck der
Position dagegen geprüft wurde. Jetzt konkretisiert:
- **Gefahrene Strecke je Maschine/Tag/Stunde:** Streckenlänge reagiert primär
  auf Punkt-zu-Punkt-Rauschen (Zittern), kaum auf eine langsam wandernde
  Gesamtverschiebung - normales GNSS (2,5-5 m) plus ein Mindestabstands-/
  Bewegungsfilter (ohnehin als Logging-Option unten vorgesehen) reicht.
- **Ertrag pro Laufmeter als grobe Heatmap** - Beispiel des Nutzers: „auf der
  Ostseite die letzten 30 m gibt es kaum noch Spargel". Gesucht ist eine
  Auflösung im Bereich von zig Metern, NICHT reihengenau (1,80 m
  Reihenabstand). Normales GNSS liegt damit 5-10× genauer als nötig -
  komfortabler Sicherheitsabstand, anders als bei einer reihengenauen
  Auswertung, wo Fehler (2,5-5 m) und Reihenabstand (1,80 m) gefährlich nah
  beieinander lägen.
- Ein Praxistest des Nutzers 2026-09 (Router+Antenne im Betrieb, Reihen
  „kerzengerade", keine Überschneidung bei 1,80 m Abstand) zeigte gute
  Ergebnisse - als alleiniger Beleg für absolute Genauigkeit aber mit
  Vorsicht zu genießen (gerade Spuren zeigen v.a. NIEDRIGES Rauschen, nicht
  zwingend eine korrekte absolute Position - eine langsam wandernde
  Verschiebung sieht in einer einzelnen Aufzeichnung trotzdem glatt aus).
  Für den jetzt bestätigten Verwendungszweck (Zig-Meter-Auflösung) ist der
  Sicherheitsabstand aber so groß, dass dieser Vorbehalt hier nicht mehr
  entscheidend ist.
- **Konsequenz:** RTK (F9P, Multiband-Antenne, NTRIP/SAPOS) entfällt
  voraussichtlich. Das spart ~250-450 €/Box (× 140 ≈ 35.000-63.000 €
  Hardware) UND macht den zuvor errechneten hohen Datenverbrauch (NTRIP war
  der dominante Treiber, ~4-8 GB/Saison/Maschine) hinfällig.
  Alle RTK-spezifischen Abschnitte unten (Hardware-Tabelle, Teil A Schritt 4,
  `fix_qualitaet`-Spalte etc.) bleiben im Dokument stehen für den Fall, dass
  sich der Bedarf später doch ändert - gelten aber bis auf Weiteres als
  **nicht mehr Pflicht**, nur noch optional.
- **Batterie-Meldeintervall entschieden (2026-09-23): alle 10 Minuten**, nicht
  die native VE.Direct-Rate (~1 Hz) 1:1 weiterreichen - ein Ladezustand
  ändert sich innerhalb einer Sekunde nicht nennenswert, dafür braucht
  niemand eine sekundengenaue Cloud-Historie. Bei 12 aktiven Stunden/Tag
  macht das 72 Meldungen/Tag statt 43.200 - der Unterschied zwischen "ein
  paar KB/Tag" und "nochmal ~1,5-2,5 MB/Tag oben drauf".
- **Ohne RTK ergibt sich damit für die drei Ströme zusammen** (Position +
  RFID + gedrosselte Batterie) **ca. 150-160 MB/Saison/Maschine** (Position
  macht davon fast alles aus, RFID/Batterie zusammen nur wenige MB). Die
  günstigen 100 SIM-Karten (500 MB/5 Jahre, siehe [[fahrzeuge-traccar]])
  könnten dafür sogar ausreichen, statt einer separaten teureren IoT-SIM -
  das aber erst final entscheiden, wenn klar ist, wie viele davon die
  Fahrzeugflotte selbst braucht.

**Frequenz-Verlauf 2026-09-22 - noch nicht final, Pilottest offen:**
1. Erste Entscheidung: Kisten-/Badge-Scan weg von UHF, hin zu HF (13,56 MHz).
   Grund: an keiner Lesestelle in diesem Plan (Badge, Kiste an der Maschine,
   Kiste auf der Waage) wird UHFs eigentliche Stärke (viele Tags gleichzeitig
   auf Distanz) gebraucht - überall gezielte Einzel-Lesevorgänge.
2. **Rückmeldung von TECTUS (Hersteller des Waagen-Readers) auf Nachfrage:**
   empfiehlt stattdessen **LF (125-134 kHz)** - bis 60 cm Lesereichweite (mit
   entsprechend größerer Reader-Antenne, nicht mit einem kleinen Tag/Reader
   wie bei den zuvor angesehenen HF-Beispielen), nach ihrer Einschätzung das
   beste Preis-Leistungs-Verhältnis für diesen Anwendungsfall. LF ist zudem
   die Frequenz mit der geringsten Störanfälligkeit durch Metall/Flüssigkeit
   in der Nähe (Wasser dämpft HF/UHF stärker) - passt zur nassen Umgebung.
   Klassische Industrie-Identifikationstechnik (z.B. Werkzeug-/Palettenkennung
   in Fabrikumgebungen), kein Exot.
   **Zusätzlich:** für die 140 Erntemaschinen sind **serielle Reader
   (RS232/RS485) deutlich günstiger als Ethernet-Reader** - passt gut zum
   ohnehin geplanten TRB246 in der SpidertrackBox, der beide seriellen
   Schnittstellen schon mitbringt (kein zusätzliches Netzwerk-Interface pro
   Maschine nötig, kein HTTP(S)-Empfänger im Waagen-Agenten wie beim
   UHF-MAGNUM-Push).
   **Einordnung:** TECTUS ist Verkäufer, keine neutrale Quelle - die fachliche
   Begründung (Robustheit bei Nässe, seriell statt Ethernet für 140 Boxen)
   ist trotzdem in sich schlüssig und deckt sich mit allgemeinem Wissen über
   LF-Industrietechnik. Macht den ohnehin geplanten **Pilottest** umso
   wichtiger, jetzt am besten direkt mit LF-Testhardware von TECTUS, bevor
   140 Reader + neue Tags bestellt werden - drei Frequenz-Wechsel
   nacheinander (UHF→HF→LF) sind ein Zeichen, dass hier ein echter Test mehr
   wert ist als weitere Theorie.

Alle UHF-spezifischen Abschnitte unten (Reader TECTUS MAGNUM 4077, Tag „U8")
sind für den Kisten-/Badge-Scan überholt (jetzt LF statt HF/UHF) - stehen aber
bewusst noch drin, weil das Material anderweitig weiterverwendet wird, siehe
nächster Absatz.

**Die bereits gekauften UHF-Tags und der TECTUS MAGNUM 4077 werden NICHT
verworfen**, sondern für ein anderes, größeres Gebinde umgewidmet: 300-kg-
Rohware-/Transportkisten, z.B. Fertigware von der Spargelsortieranlage oder
(ab der nächsten Saison) Rohware Mais vom Feld. Dort passt UHFs Reichweite
eher (weniger, größere, langsamer bewegte Einheiten) - noch keine
ausgearbeitete Anforderung, nur als Verwendungszweck festgehalten, damit die
Investition nicht verloren geht. Eigener Plan/Abschnitt folgt, sobald das
konkret ansteht.

## Idee

Lückenlose Kette von der Erntearbeit auf dem Feld bis zum gewogenen Ertrag am Hof,
um einen echten Realitätscheck über die Arbeitseffizienz zu bekommen:

```
Feld:      Spargelspinne (SpidertrackBox: LTE + GNSS (ohne RTK, s.o.) + LF-RFID + Batterie)
             Fahrer scannt morgens 1× seinen Badge          → ernte_schicht
             Fahrer scannt leere Kiste, erntet rein          → ernte_kiste_zyklus (offen)
             Fahrer scannt nächste Kiste                     → vorige implizit "voll"
LKW:       holt volle Kisten ab, fährt zum Hof              (LKW schon im Fahrzeug-Modul)
Hof:       Waage + stationärer LF-Leser scannt die Kiste    → Zyklus: gewogen_am, kg
Ergebnis:  pro Kiste: Maschine · Fahrer · Feld/Flur (aus GPS) · Zeit · netto kg
           → kg/Personenstunde, kg/Maschinenstunde, Ertragsdichte-Karte,
             gebuchte Stunden (work_entries) vs. Maschine-aktiv-Zeit
```

## Feststehende Fakten (aus der Klärung 2026-09-03/04)

- **140 Erntemaschinen = die Spargelspinnen.** 1 Person pro Maschine.
- Fahrer **registriert sich 1×/Tag** per RFID-Badge an der Maschine.
- **Kisten-Transponder sind schon gekauft, aber seit 2026-09-22 umgewidmet:**
  *Transponder Square, UHF Tag Chip U8, 865–868 MHz, 69×23×7 mm, ABS+PC,
  IP68.* Für den Kisten-/Badge-Scan an der Maschine wird stattdessen LF
  favorisiert (siehe Frequenz-Verlauf oben, Pilottest offen) - diese
  UHF-Tags gehen an die 300-kg-Rohware-/Fertigware-Kisten.
- Für den Kisten-/Badge-Scan wird jetzt ein **LF-Reader mit seriellem
  Anschluss** favorisiert (konkretes Modell offen, siehe Frequenz-Verlauf
  oben) - die **SpidertrackBox-Teileliste ist ohnehin noch NICHT gekauft**
  (`docs/…BOM…xlsx`), kann also direkt danach geplant werden. Enthielt
  vorher: Teltonika **TRB246** (IoT-Gateway, RutOS, LTE + GNSS + RS232 +
  RS485 + I/O - die seriellen Schnittstellen passen zum LF-Reader),
  Teltonika Combo-Dachantenne (Mobil/GNSS/WLAN), Netronix MW-R4G (RFID
  13,56 MHz HF - ursprünglich für die Kiste vorgesehen, dann wegen der
  UHF-Tags verworfen, durch die HF-Zwischenentscheidung kurz wieder passend,
  jetzt durch die LF-Empfehlung erneut zu ersetzen), VE.Direct-Kabel +
  MAX3232 (liest Victron-Batteriedaten), Gehäuse/Hutschiene/Klemmen.
- **Waage am Hof - Reader jetzt umgewidmet (siehe oben):** stationärer Leser
  *MAGNUM, UHF, Long Range, Ethernet/WLAN/RS232/RS485, 1 int./2 ext.
  Antennen* - Hersteller laut Typenschild **TECTUS Technology GmbH**
  (tec-tus.de) P/N `MAGNUM 4077-01-000-00`, Versorgung 12-36 V/2,5 A - wird
  nicht mehr für den laufenden Kisten-Scan an der Waage gebraucht (dafür ein
  neuer, noch zu wählender LF-Reader, TECTUS-Empfehlung), sondern für die
  300-kg-Kisten vorgesehen. Die **Waage selbst kommt noch** (siehe Teil D
  für das gewählte Modell
  RHEWA 84vario).
- **±1 m Präzision (RTK)** — ursprüngliche Vorgabe, seit 2026-09-23
  voraussichtlich NICHT mehr nötig, siehe „Präzisionsanforderung geklärt"
  oben. Interne TRB246-GNSS liegt bei 2,5–5 m, für den jetzt bestätigten
  Verwendungszweck (Zig-Meter-Heatmap, Streckenlänge) ausreichend.
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
| **Kisten-Scan an der Maschine** (2026-09-22: UHF→HF→LF, siehe Hinweis oben, Pilottest offen) | LF-Reader-Modul (seriell, TECTUS-Empfehlung), Ethernet-HF-Modul, oder erst der Pilottest entscheidet | Aktuell favorisiert: LF mit seriellem Reader (RS232/RS485 an den ohnehin vorhandenen TRB246), bis 60 cm Reichweite, robust bei Nässe, günstiger als Ethernet-Reader für 140 Boxen. Vor Bestellung: Pilottest mit TECTUS-LF-Testhardware unter Feldbedingungen. Die bereits gekauften UHF-Tags/der UHF-Reader (TECTUS MAGNUM 4077) werden für 300-kg-Rohware-/Fertigware-Kisten weiterverwendet, nicht verworfen. |
| **±1 m (RTK)** — voraussichtlich verzichtbar, siehe Hinweis oben (2026-09-23) | Ohne RTK: normale TRB246-GNSS (2,5–5 m) reicht für Zig-Meter-Heatmap + Streckenlänge. Mit RTK weiterhin möglich, falls doch reihengenau gebraucht: u-blox **ZED-F9P**-Klasse + NTRIP + Multiband-Antenne | **Kein RTK** — spart ~250–450 €/Box + NTRIP-Gebühr/-Datenvolumen (× 140 Boxen erheblich). Nur bei späterem Bedarf an reihengenauer Auswertung nachrüsten. |
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
Business-Logik (Zyklen öffnen/schließen, Schichten anlegen) macht weiterhin
der Processor (Teil E, pg_cron, einmal pro Minute) - **außer der schnellen
Klassifizierung unten**, die dafür zu langsam wäre.

**Klassifizierung Person/Kiste (Nutzer-Vorgabe 2026-09-23): nur Personen
werden angelernt, alles andere gilt automatisch als Kiste.** `ernte_tag`
muss deshalb NICHT für jeden der tausenden Kisten-Tags einen Datensatz
haben - nur für die ~140-200 Mitarbeiter-Badges (optional zusätzlich
einzelne Kisten, falls mal eine besonders markiert werden soll). Ein Tag,
der beim Scan nicht in `ernte_tag` als `art='person'` gefunden wird, ist
per Default eine Kiste - kein Onboarding-Schritt für neue Kisten-Tags
nötig.

**Sicherheitsnetz gegen den Fall „unbekannter Mitarbeiter" (Nutzer-Frage
2026-09-23):** Ohne Weiteres würde ein noch nicht angelerntes
Mitarbeiter-Badge einfach als Kiste durchlaufen - ein Zyklus würde
geöffnet, nie gewogen, und es fällt erst auf, wenn am Monatsende Stunden
fehlen. Deshalb: **der erste Scan eines Tags an einer Maschine an einem
Tag gilt immer als Login-Versuch**, unabhängig vom Ergebnis der
Klassifizierung.
- Tag ist als `person` registriert → normaler Login (`ernte_schicht`).
- Tag ist NICHT registriert → **kein** Kisten-Zyklus wird angelegt,
  stattdessen `ernte_scan.verarbeitung_fehler = 'unbekannter_mitarbeiter_tag'`
  (eigene Fehlerkategorie, sichtbar in der App, kein stiller Datenverlust).
- Jeder weitere Scan desselben Tages an dieser Maschine, der nicht
  registriert ist, gilt regulär als Kiste (Verwechslungsrisiko dort gering,
  da Kisten viel häufiger sind als neue Mitarbeiter).
- Annahme dahinter: der Fahrer scannt morgens immer zuerst sein Badge,
  bevor er eine Kiste anfasst. Falls sich das im Pilottest als unsicher
  erweist, wäre ein physischer Taster nur für den Login-Scan die
  Alternative - erstmal ohne zusätzliche Hardware versucht.

**Erfolgston am Gerät (Nutzer-Vorschlag 2026-09-23):** Die Ingest-Antwort
gibt den Klassifizierungs-Typ direkt zurück (siehe unten), damit das Skript
auf dem TRB246 (dasselbe, das auch die Sperrzeit prüft, siehe Teil D) sofort
nach erfolgreicher Übertragung einen passenden Ton auslösen kann - **erst
nach der Serverantwort, nicht schon beim reinen Lesen des Tags**, weil nur
das wirklich bestätigt, dass die Daten sicher angekommen sind. Auch eine
durch die Sperrzeit verworfene Wiederholung gilt dabei als Erfolg (der
Server hat sie ja erhalten) - stumm bleibt es nur bei echten
Übertragungsfehlern. Töne: „Person" / „Kiste" / „unbekannter Mitarbeiter"
(siehe Sicherheitsnetz oben) - je ein einfacher Piezo-Summer an einem
Digitalausgang des TRB246, unterschiedliche Muster je Ereignis.

Payload Maschine (TRB246):
```json
{
  "box": "<IMEI/Serial>",
  "events": [
    {"typ":"scan","tag":"E280...","ts":"2026-04-18T05:32:11Z","lat":51.2,"lng":6.8},
    {"typ":"scan","tag":"E280...","ts":"2026-04-18T05:41:03Z","lat":51.2,"lng":6.8},
    {"typ":"batterie","soc":78,"u":12.9,"i":-4.2,"ts":"2026-04-18T05:45:00Z"}
  ]
}
```
`typ:"scan"` ersetzt die bisherige Unterscheidung `person_login`/`kiste` im
Payload - die Box weiß das ja gerade NICHT mehr im Voraus, das entscheidet
erst die Ingest-Funktion per Klassifizierung.

Payload Waage (Hof-Agent):
```json
{"waage":"hofwaage-1","tag":"E280...","gewicht_kg":9.42,"ts":"2026-04-18T13:07:55Z"}
```
Antwort: `200 {"angenommen": n, "dubletten": m, "klassifizierung":
[{"tag":"E280...", "typ": "person"|"kiste"|"unbekannter_mitarbeiter_tag"}]}`
- das `typ` je Tag ist neu, für den Erfolgston am Gerät.

**Offene Frage Stromausfall (Nutzer-Frage 2026-09-23):** Schaltet die
Maschine nach Feierabend die komplette Stromversorgung ab (nicht nur
Zündung), verliert der TRB246 sofort allen RAM-Inhalt - inklusive einer
eventuell noch nicht gesendeten Offline-Warteschlange. Ob Teltonikas
„Data to Server"-Warteschlange auf Flash (übersteht Stromausfall) oder RAM
(verloren) liegt, ist in der öffentlichen Doku nicht eindeutig zu finden -
**vor dem Pilottest direkt testen**: Gerät mit wartenden Meldungen in der
Warteschlange stromlos machen, wieder einschalten, prüfen ob nachgesendet
wird. Falls nicht: entweder eine kurze Abschaltverzögerung
(Zündungs-/Kondensator-Pufferung, wie bei Fahrzeugelektronik üblich) oder
eine selbst gebaute, flash-basierte Warteschlange im Custom Script
vorsehen. Die Sperrzeit-Merkliste (siehe Teil D) selbst darf dagegen
bewusst im RAM bleiben (siehe dortige Begründung) - das ist ein anderes,
unkritischeres Problem als verlorene Nutzdaten.

## Teil D — Waagen-Agent (`tools/ernte-waage-agent/`)

Kleiner Node/Python-Dienst auf einem Mini-PC/RPi am Hof (Muster wie
`tools/fahrzeug-poller/`):

- liest Kisten-Tag vom **MAGNUM UHF** über TCP (bzw. Reader pusht zum Agenten);
- liest Gewicht von der **Waage** — „stabiles Gewicht" als Trigger;
- **paart**: stabiles Gewicht ≠ 0 + frische Tag-Lesung innerhalb von N Sekunden →
  ein `{waage, tag, gewicht_kg, ts}` → POST an `ernte-ingest`;
- lokale SQLite-Queue + Retry bei Netzausfall;
- Config: Reader-IP, Waagen-Port, Ingest-URL/Token, Paarungsfenster, Mindestgewicht.

**Waage — Modell entschieden (Klärung 2026-09-18): RHEWA 84vario**, Anbindung
per **Ethernet/TCP/IP direkt** (nicht über die RHEWA-eigene Windows-Software
DataRDK/DataLog - die passt nicht zum Linux-Agenten-Ansatz hier und wird nicht
gebraucht). Protokoll-Unterlagen liegen vor (`EDV-Anbindung 83s-84v.pdf`,
`Kundeninformation TCP_IP.pdf`, `84vario_Ethernet.pdf`, C#-Referenzbeispiel
für ein anderes Modell/82c).

- **Verbindung:** Auswertegerät ist der TCP-**Server** (Default-Port 8000, am
  Gerät änderbar/einsehbar), unser Agent ist der **Client** - reiner
  Stream-Socket, kein HTTP/Telnet/SSH, keine UDP-Sockets, kein DHCP. IP/Port/
  Subnetz/Gateway werden direkt am Gerätedisplay eingestellt (Menü
  Einstellungen → Gerätekonfiguration → Ethernet, Passwort = Fabriknummer).
  **Wichtig:** Die Ethernet-Schnittstelle des 84vario ist kostenpflichtig
  freizuschalten (Freischaltcode beim Händler bestellen) - ohne Freischaltung
  bleibt nur RS232.
- **Befehlsrahmen:** ASCII-Befehle, geklammert `<..>` (Start `<`, Ende `>`),
  zweistelliger Befehlscode + optionale Parameter/Schnittstellen-Nummer. Für
  83sigma/84vario ist die TCP/IP-Schnittstelle **Nummer 7** (z.B. `<GN7>` =
  aktuelles Nettogewicht über TCP/IP). Antwort quittiert denselben Befehl
  (`<FP>`) oder meldet Fehler (`<FP!>`, `<..%!>` unbekannter Befehl, `<..#>`
  fehlendes Stoppzeichen).
- **Der richtige Befehl für uns: `<FP0>`** - fordert den kompletten,
  **eichfähigen** Datensatz „EDV1" an, **wartet geräteseitig selbst auf
  Gewichtsruhelage** (kein eigenes Polling/Stabilitäts-Timing im Agenten
  nötig) und bricht nach 30 s mit `<FP!>` ab, wenn nie stabil/außerhalb
  Wägebereich. Genau das ist unser „stabiles Gewicht"-Trigger aus Teil D -
  eine Zustandsmaschine dafür entfällt.
- **EDV1-Datensatz** (STX…ETX, `;`-getrennt, danach CR LF + `<FP>`): laufende
  Nummer (10-stellig, = Schlüssel des geräteinternen **Alibispeichers** -
  **mit in `ernte_scan.roh` speichern**, das ist der amtliche Prüfnachweis),
  Datum (TT.MM.JJJJ), Uhrzeit (HH:MM:SS), Wägebrücken-Nr, Wägebereich,
  Stückzahl, Gewichtseinheit (kg), Brutto, Tara, Netto (je 8-stellig,
  rechtsbündig, Dezimalpunkt).
  **Offene Frage Tara:** „Netto" ist Brutto minus dem, was zuletzt per `<FT>`/
  `<FH..>` am Gerät als Tara gesetzt wurde - bei unbeaufsichtigtem Betrieb
  (keine Person tariert je Kiste am Terminal) bräuchte das entweder eine feste
  Plattform-Tara (leere Palette dauerhaft aufgesetzt) oder wir tarieren
  überhaupt nicht am Gerät und lesen stattdessen **Brutto**, ziehen das
  bekannte Kisten-Leergewicht (je Kistentyp, aus `ernte_tag`/Stammdaten) selbst
  im Backend ab. Zweiteres ist robuster (kein Risiko einer veraltet stehen
  gebliebenen Geräte-Tara) - vorbehaltlich Rückfrage/Praxistest.
- Ablauf im Agenten: Kisten-Tag-Scan kommt rein → kurz warten (Kiste steht auf
  der Waage) → TCP-Verbindung öffnen → `<FP0>` senden → Antwort parsen (Erfolg
  → Netto+laufende Nummer weiter wie bisher geplant; `<FP!>`/Timeout →
  verwerfen bzw. `ungeklaert`, siehe Teil E) → Verbindung schließen.

**Reader — TECTUS MAGNUM 4077, Handbuch V1.1 (Klärung 2026-09-21) — seit
2026-09-22 umgewidmet auf die 300-kg-Rohware-/Fertigware-Kisten, siehe
Entscheidung ganz oben. Die folgenden Details bleiben für diesen neuen
Zweck relevant, gelten aber NICHT mehr für den Kisten-/Badge-Scan an
Maschine/Waage - dafür wird ein separater HF-Reader gewählt, sobald der
Pilottest steht.**

- **Anschlüsse (alle M12):** 3-polig = Strom (Pin 1 V+, 2 V-, 3 PE; Handbuch
  nennt 9-32 V, Typenschild/Datenblatt 12-36 V, 2,5 A → sicher: 24 V DC);
  4-polig = Ethernet 10/100 (Pinbelegung wie M12 **D-codiert** auf RJ45:
  1 TD+, 2 RD+, 3 TD-, 4 RD-); 8-polig = RS232 (GND/RxD/TxD, 115200 8N1)
  + 1 digitaler Ausgang + 1 digitaler Eingang. Die Codierung 3-/8-polig und das
  Steckergeschlecht (Stifte/Buchse) stehen nicht im Handbuch → am Gerät prüfen.
  Antennenanschlüsse: Steckertyp (TNC/N/SMA) steht nicht im Handbuch.
- **Datenweg:** Der Reader **pusht** im Modus "Permanent Scan" nach jeder
  Inventur-Runde per **HTTP(S)-POST** (Body `text/plain`, JSON) an
  `tar_host`/`tar_url`/`tar_port` (optional `tar_user`/`tar_password`):
  `{"Permanent Scan":{"id":..,"time":"..","Tag":[{"TagID":"E280..","RSSI":-67,
  "Antenna":1}]}}`. **RSSI und Antennennummer kommen also je Tag mit**; leere
  Runden kommen als `"Tag":[]`. Für HTTPS muss ein Root-Zertifikat im Reader
  hochgeladen werden (nur über die Web-Oberfläche); Port 80/HTTP ist als
  Beispiel genannt (im lokalen Netz zu testen). Der Waagen-Agent muss also
  einen kleinen HTTP-Empfänger im lokalen Netz bereitstellen.
- **Einstellungen** (Web-Oberfläche oder seriell `get`/`set`): Sendeleistung je
  Antenne 0-33 dBm (`uhf_ant1pwr`..`4pwr`), aktive Antenne `uhf_workant`
  (**es ist immer nur EINE Antenne gleichzeitig aktiv**), `dev_opmode`,
  `uhf_acd` (Antennenerkennung). Werkseinstellung LAN: statisch
  192.168.0.159/24 (DHCP möglich, anders als die Waage); Reset per Taste neben
  der Power-LED (10 s beim Einschalten halten). **Keinen** RSSI-Filter im
  Reader → Schwellenwert/Fenster macht der Agent.
- **Konsequenz Antennen:** Zwei Antennen links/rechts der Waage lassen sich
  nicht gleichzeitig betreiben. Realistisch: eine Antenne mittig so, dass beide
  Kistenseiten ähnlich weit weg sind, oder `uhf_workant` zwischen den Runden
  umschalten (nur seriell/Web, aufwändig).
- **Digitaler Eingang** (>= 3,6 V): startet die Inventur, solange er aktiv ist
  → eine Lichtschranke/ein Näherungssensor an der Waagenposition kann das
  Lesen auf die Zeit begrenzen, in der eine Kiste wirklich auf der Waage steht.
  **Digitaler Ausgang** im Automatikmodus (`io_output` 2): AN, solange ein Tag
  gefunden wird → einfache Signal-Lampe "Kiste erkannt" ohne Software
  (Belastbarkeit des Ausgangs steht nicht im Handbuch).

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
**Enthält seit 2026-09-23 nur noch die ~140-200 Mitarbeiter-Badges** (siehe
Teil C) - ein Tag ohne Eintrag hier gilt automatisch als Kiste, braucht
also keine eigene Zeile mehr. `kiste_nr` bleibt nutzbar, falls doch mal eine
einzelne Kiste manuell markiert werden soll (z. B. eine reparierte/
markierte Testkiste), ist aber im Regelfall leer.

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
Index `(verarbeitet_am) where verarbeitet_am is null`, `(quelle, zeitpunkt desc)`,
`(tag_uid, ereignis, verarbeitet_am desc)` (für die Sperrzeit-Prüfung, siehe
Processor unten). Alles Abgeleitete ist hieraus reprozessierbar.

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
`batterie_melde_intervall_min=10` (Entscheidung 2026-09-23, siehe oben - nicht
die native VE.Direct-Rate 1:1 durchreichen), `sperrzeit_tag_s=15`
(Entscheidung 2026-09-23, siehe Processor unten - gegen Mehrfach-Lesungen
desselben Tags), `offline_warn_min=5`,
`offline_alarm_min=10`, `batterie_warn_v=24`,
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

**Sperrzeit gegen Mehrfach-Lesungen (Nutzer-Frage 2026-09-23, WICHTIG):** Ein
UHF-Reader im Dauerscan meldet denselben Tag typischerweise mehrmals pro
Sekunde, solange er in Reichweite bleibt - hält der Fahrer eine Kiste 2 s vor
den Reader, kommen leicht 5-10 Einzel-Lesungen desselben Tags in `ernte_scan`
an, nicht eine. Für einen Login fängt das die bestehende Regel „neue
Schicht nur, wenn heute noch keine offen" bereits zufällig ab. Für eine
Kiste NICHT - ohne Sperrzeit würde jede der 5-10 Lesungen denselben Zyklus
erneut schließen/neu öffnen und die Kette zerreißen. Deshalb zusätzlich zur
Reader-seitigen Drosselung (falls unterstützt, z. B. „Tag erst nach X s
erneut melden" - beim Reader-/Pilottest mit prüfen, spart auch Datenvolumen):
**Der Processor ignoriert eine Lesung, wenn für denselben `tag_uid` bereits
eine Lesung mit demselben Klassifizierungs-Ergebnis (Person-Login oder
Kiste, siehe Teil C) innerhalb der letzten `sperrzeit_tag_s` Sekunden
verarbeitet wurde** (neuer
`ernte_konfig`-Schlüssel `sperrzeit_tag_s=15` - Startwert, im Pilottest
gegenprüfen: lang genug für eine Kisten-Übergabe, kurz genug, um eine
schnell aufeinanderfolgende zweite Kiste nicht zu verschlucken). Ignorierte
Lesungen bekommen trotzdem `verarbeitet_am = now()` (damit der Processor sie
nicht erneut anfasst), aber keine Wirkung auf `ernte_schicht`/
`ernte_kiste_zyklus` - das Rohprotokoll in `ernte_scan` bleibt vollständig
erhalten, nur die Geschäftslogik reagiert einmal statt mehrfach. Dafür ein
Index `(tag_uid, ereignis, verarbeitet_am desc)` auf `ernte_scan`.

plpgsql-Funktion faltet `ernte_scan where verarbeitet_am is null`. Die
Klassifizierung (Person/Kiste/unbekannter Mitarbeiter) ist bereits in der
Ingest-Funktion passiert (Teil C, schnell genug für den Erfolgston) und
steht am `ernte_scan`-Datensatz; der Processor übernimmt nur noch die
zeitaufwändigere Geschäftslogik. Je Zeile zuerst die Sperrzeit-Prüfung oben,
danach:
- Login (Tag als `person` klassifiziert) → `ernte_schicht` (neue Schicht,
  wenn nicht schon heute offen für Maschine+Fahrer).
- Erster Tag des Tages an Maschine M, NICHT als `person` klassifiziert →
  `verarbeitung_fehler = 'unbekannter_mitarbeiter_tag'`, **kein**
  Kisten-Zyklus (siehe Teil C, Sicherheitsnetz).
- Kiste (jeder weitere nicht als `person` klassifizierte Tag) an Maschine M
  → jüngsten offenen Zyklus für M schließen (`voll_am`, `voll_lat/lng`),
  neuen Zyklus `offen` anlegen (`befuellt_*`, `schicht_id` aus aktiver
  Schicht an M, Spatial-Join `ernte_feld` → `feld`/`kultur`).
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
2. **Lesetiefe/-punkt an der Maschine:** gibt es an der Spinne einen
   definierten Scan-Punkt (Halterung/Tasche), an dem der Fahrer die leere
   Kiste vorhält? Bei LF (bis 60 cm mit größerer Reader-Antenne laut TECTUS)
   weniger kritisch als bei UHF/HF mit kleinem Tag, aber erst der Pilottest
   zeigt die reale Reichweite mit echter Antennengröße/-einbaulage.
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
