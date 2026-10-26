# Erntewirtschaft — Architektur- und Umsetzungsplan

Stand: 2026-09-04, Frequenz-Entscheidung 2026-09-22 (UHF→HF), TECTUS-Rückmeldung
2026-09-22 (HF→LF), Präzisionsanforderung präzisiert 2026-09-23 (RTK
voraussichtlich verzichtbar), **Kurswechsel 2026-10-12: Kisten-/Badge-Scan
weg von RFID, hin zu QR-Codes** (siehe Abschnitt direkt unter diesem). Arbeitsdokument (wie `unterkunft-plan.md`),
damit der Planungsstand einen Konsolen-Neustart übersteht. Noch **kein
Code** — wartet auf die Hardware-Entscheidungen unten.

**Kurswechsel 2026-10-12: RFID → QR-Codes für Kisten- und Badge-Scan.**
Nach drei Frequenz-Wechseln (UHF→HF→LF, siehe „Frequenz-Verlauf" unten) hat
sich der Nutzer aus praktischen und vor allem wirtschaftlichen Gründen
gegen RFID und für **QR-Codes auf Hartplastik-Karten** entschieden (nicht
zum Kleben) — sowohl für die Kisten als auch für die Mitarbeiter-Badges.
Risiko beschädigter/verschmutzter Codes wird bewusst in Kauf genommen: bei
ausreichender Größe und hoher Fehlerkorrekturstufe verkraften QR-Codes bis
zu ~30 % Flächenverlust und bleiben trotzdem lesbar.
- **Scanner statt Reader:** ein fest verbautes **2D-Scan-Modul mit
  TTL/UART- bzw. RS232-Ausgang** je Maschine, im Presentation-Mode (löst
  automatisch beim Erkennen eines Codes aus, kein Knopfdruck). Nutzt
  dieselbe serielle Schnittstelle des TRB246, die vorher für den
  RFID-Reader vorgesehen war — an der SpidertrackBox-Verkabelung ändert
  sich dadurch nichts. Empfehlung: Markenmodul (Honeywell/Newland) statt
  No-Name, analog zur schon früher geäußerten Qualitätssorge bei günstigen
  RFID-Readern. An der Hofwaage genügt ein einzelnes fertiges
  Desktop-Präsentationsgerät (z. B. Zebra DS457/DS9208) statt eines
  Einbau-Moduls, da nur einmal benötigt.
- **Typ-Präfix im Code selbst, statt Rate-Heuristik:** Mitarbeiter-Karten
  beginnen mit `P-`, Kisten-Karten mit `K-` (z. B. `P-00042`, `K-10293`).
  Die Ingest-Funktion weiß damit **sofort und zweifelsfrei** beim Scan, ob
  es eine Person oder eine Kiste ist, ohne erst nachschlagen zu müssen, ob
  der Code bekannt ist. Das macht die komplette „unbekannter
  Mitarbeiter"-Rateheuristik aus Teil C (Stand bis 2026-10-11, unten als
  überholt markiert) überflüssig.
- **UHF-Material (TECTUS MAGNUM 4077 + Tags) bleibt wie schon länger geplant
  für die 300-kg-Rohware-/Fertigware-Kisten reserviert** — daran ändert der
  Kurswechsel nichts, siehe Absatz weiter unten.
- Pilottest bleibt Pflicht, jetzt für QR statt LF: verschmutzter/nasser
  Code, Handschuhe, Karte in Bewegung — vor einer 140er-Bestellung mit 2-3
  Mustern durchspielen.
- Alle RFID-/Frequenz-spezifischen Abschnitte unten (Frequenz-Verlauf,
  LF-Reader-Empfehlung, `ernte_tag`-Klassifizierungslogik) bleiben als
  Entscheidungshistorie stehen, gelten für den Kisten-/Badge-Scan aber als
  **überholt**, nicht gelöscht.

**Kurswechsel 2026-10-22: Mitarbeiter-Codes direkt aus der Personalnummer,
kein Anlernschritt mehr.** Nutzer-Idee, mit Suffix gegen Fälschung
gehärtet: `P-<personal_nr>-<suffix>` statt eines opaken, manuell
anzulernenden Badge-Codes - der zufällige, nur im QR-Code (nicht als
Klartext) stehende Suffix verhindert "Buddy Punching" über die bekannte
Personalnummer eines Kollegen und lässt sich bei Kartenverlust rotieren
("Verlust-Karte drucken" macht die alte Karte sofort ungültig). Gebaut auf
`/erntewirtschaft/ausweise`, siehe Teil C und Teil F für Details. Ein
eigener Kartendrucker (Blanko-Karten + Foto s/w) ist angeschafft/geplant,
aber noch nicht da - die Druckansicht funktioniert bis dahin mit jedem
normalen Drucker.

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
Feld:      Spargelspinne (SpidertrackBox: LTE + GNSS (ohne RTK, s.o.) + QR-Scanner + Batterie)
             Fahrer scannt morgens 1× seine Badge-Karte (P-…) → ernte_schicht
             Fahrer scannt leere Kiste (K-…), erntet rein      → ernte_kiste_zyklus (offen)
             Fahrer scannt nächste Kiste                       → vorige implizit "voll"
LKW:       holt volle Kisten ab, fährt zum Hof              (LKW schon im Fahrzeug-Modul)
Hof:       Waage + QR-Scanner liest die Kisten-Karte        → Zyklus: gewogen_am, kg
Ergebnis:  pro Kiste: Maschine · Fahrer · Feld/Flur (aus GPS) · Zeit · netto kg
           → kg/Personenstunde, kg/Maschinenstunde, Ertragsdichte-Karte,
             gebuchte Stunden (work_entries) vs. Maschine-aktiv-Zeit
```
*(Stand bis 2026-10-11 hier: LF-RFID statt QR — siehe Kurswechsel oben.)*

## Feststehende Fakten (aus der Klärung 2026-09-03/04)

- **140 Erntemaschinen = die Spargelspinnen.** 1 Person pro Maschine.
- Fahrer **registriert sich 1×/Tag** per Badge-Karte (QR, `P-…`) an der Maschine.
- **Neu seit 2026-10-12: Kisten-/Badge-Scan per QR statt RFID**, siehe
  Kurswechsel-Abschnitt ganz oben. Die folgenden Punkte bis zum Ende dieses
  Abschnitts beschreiben den RFID-Stand bis 2026-10-11 — als
  Entscheidungshistorie stehen gelassen, für den Kisten-/Badge-Scan aber
  überholt. Einzig der TECTUS MAGNUM 4077 + die UHF-Tags bleiben wie dort
  beschrieben für die 300-kg-Kisten reserviert.
- **Kisten-Transponder sind schon gekauft, aber seit 2026-09-22 umgewidmet:**
  *Transponder Square, UHF Tag Chip U8, 865–868 MHz, 69×23×7 mm, ABS+PC,
  IP68.* Für den Kisten-/Badge-Scan an der Maschine wird stattdessen LF
  favorisiert (siehe Frequenz-Verlauf oben, Pilottest offen) - diese
  UHF-Tags gehen an die 300-kg-Rohware-/Fertigware-Kisten.
- Für den Kisten-/Badge-Scan war hier bis 2026-10-11 ein **LF-Reader mit
  seriellem Anschluss** favorisiert (siehe Frequenz-Verlauf oben) - seit dem
  Kurswechsel ganz oben stattdessen ein **2D-QR-Scan-Modul mit
  TTL/UART- bzw. RS232-Ausgang** (Empfehlung: Honeywell/Newland-Markenmodul,
  Presentation-Mode). Die **SpidertrackBox-Teileliste ist ohnehin noch NICHT
  gekauft** (`docs/…BOM…xlsx`), kann also direkt mit dem QR-Modul geplant
  werden. Aktuelle Liste: Teltonika **TRB246** (IoT-Gateway, RutOS,
  LTE + GNSS + RS232 + RS485 + I/O - die seriellen Schnittstellen passen
  zum QR-Modul genauso wie vorher zum RFID-Reader geplant),
  Teltonika Combo-Dachantenne (Mobil/GNSS/WLAN), das QR-Scan-Modul (ersetzt
  den zuletzt favorisierten LF-Reader bzw. den zuvor schon wieder verworfenen
  Netronix MW-R4G HF-Reader), VE.Direct-Kabel + MAX3232 (liest
  Victron-Batteriedaten), Gehäuse/Hutschiene/Klemmen (braucht jetzt zusätzlich
  ein kleines, vor Regen geschütztes Sichtfenster für die Scan-Optik).
- **Waage am Hof - Reader jetzt umgewidmet (siehe oben):** stationärer Leser
  *MAGNUM, UHF, Long Range, Ethernet/WLAN/RS232/RS485, 1 int./2 ext.
  Antennen* - Hersteller laut Typenschild **TECTUS Technology GmbH**
  (tec-tus.de) P/N `MAGNUM 4077-01-000-00`, Versorgung 12-36 V/2,5 A - wird
  nicht mehr für den laufenden Kisten-Scan an der Waage gebraucht (dafür seit
  2026-10-12 ein QR-Desktop-Scanner, z. B. Zebra DS457/DS9208), sondern für
  die 300-kg-Kisten vorgesehen. Die **Waage selbst kommt noch** (siehe Teil D
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
| **Kisten-/Badge-Scan an der Maschine** (2026-09-22: UHF→HF→LF; 2026-10-12: RFID→QR, siehe Kurswechsel oben) | 2D-QR-Scan-Modul (TTL/UART bzw. RS232, Honeywell/Newland), No-Name-Modul, oder RFID (verworfen) | **Entschieden (2026-10-24): "Grouper" von Jacob, 12V-Scanner.** Presentation-Mode, am seriellen Anschluss des ohnehin vorhandenen TRB246 (dieselbe Schnittstelle, die vorher für den RFID-Reader vorgesehen war). Karten (Kisten + Mitarbeiter-Badges) auf Hartplastik, nicht geklebt, mit Typ-Präfix `P-`/`K-` im Code. Die bereits gekauften UHF-Tags/der UHF-Reader (TECTUS MAGNUM 4077) werden weiterhin für 300-kg-Rohware-/Fertigware-Kisten verwendet, nicht verworfen. |
| **SpidertrackBox-Gehäuse** (2026-10-24, auf Rat des Elektronikentwicklers) | Gehäuse komplett als Sonderanfertigung (Bohrungen + Sichtfenster-Ausschnitt) vs. Standardgehäuse + alles selbst bohren/fräsen | **CNC-Fensterausschnitt vom Hersteller fertigen lassen, Montagebohrungen selbst** - der Sichtfenster-Ausschnitt ist der dichtigkeitskritische Teil (muss plan/gratfrei sein, damit Dichtung/O-Ring umlaufend gleichmäßig aufliegt; bei 140 handgefräsäten Ausschnitten summieren sich Ausfälle), runde Bohrungen für Schrauben/Kabelverschraubungen/M12-Stecker sind dagegen mit passenden IP-Kabelverschraubungen + Dichtscheiben zuverlässig selbst machbar. Sichtfenster aus **Glas statt Acrylglas** - Acrylglas wird laut Elektronikentwickler mit der Zeit trüb (UV) und ist nicht kratzfest, Glas nicht. Vibrationsbedenken (Glas spröder als Polycarbonat) sind geklärt: die Glasscheibe wird mit **Silikon** elastisch eingebettet/abgedichtet statt starr gerahmt - das federt Vibration ab, statt die Scheibe zu belasten. Gehäuse **UV-/wetterbeständig**. **Vor der 140er-Bestellung:** eine Box mit dem fertigen Fenster + eigenen Bohrungen bauen und mit dem Gartenschlauch aus mehreren Winkeln besprühen (simuliert IP65/66) - gleicher Pilottest-Gedanke wie beim Scan-Modul selbst. |
| **±1 m (RTK)** — voraussichtlich verzichtbar, siehe Hinweis oben (2026-09-23) | Ohne RTK: normale TRB246-GNSS (2,5–5 m) reicht für Zig-Meter-Heatmap + Streckenlänge. Mit RTK weiterhin möglich, falls doch reihengenau gebraucht: u-blox **ZED-F9P**-Klasse + NTRIP + Multiband-Antenne | **Kein RTK** — spart ~250–450 €/Box + NTRIP-Gebühr/-Datenvolumen (× 140 Boxen erheblich). Nur bei späterem Bedarf an reihengenauer Auswertung nachrüsten. |
| **Positions-Lograte** | 1 s / 5 s / on-move+min-distance | **1 s** in der Traccar-PostgreSQL (kurze Retention), **5 s** heruntergerechnet nach `ernte_position`. |
| **Feld-Geometrien** | aus Pachtwesen2026 importieren / in Spargar neu pflegen | **Entschieden (Migration 2026-10-19):** generisches `feld` mit PostGIS in der Spargar-DB (kulturübergreifend, nicht nur Erntewirtschaft); Erstbefüllung per `anon`-RPC-Import aus Pachtwesen2026 (Schlag-Ebene) oder Karten-Editor (reuse Satellitenbild-Umschalter aus `FahrzeugKarte`). |
| **Scan-Processor** | pg_cron-plpgsql / Modul im systemd-Poller | **pg_cron** — DB-intern, unabhängig davon ob die Poller-Box läuft; Faltung ist mengenbasiertes SQL. |
| **Ingest-Auth** | ein Fleet-Token / Token je Box | v1: **ein Fleet-Token**; Token-je-Box später. |
| **Einschränkung** | Unter Folientunnel/Vlies verliert RTK ggf. den Fix | akzeptiert; im offenen Feld stabil. Fix-Qualität wird je Punkt gespeichert. |

### Glas-Montage/-Abdichtung im Gehäusefenster (2026-10-26)

Zwei Varianten, Pilottest entscheidet:

- **Variante A – Silikon als reine Dichtmasse:** CNC-Ausschnitt etwas größer
  als die Glasscheibe (1–2 mm Spalt ringsum), damit das Glas elastisch im
  Silikon "schwimmt" statt hart gegen Kunststoff/Metall zu liegen (sonst
  Rissrisiko bei Vibration/Temperaturdehnung). Beide Flächen vor dem
  Verkleben mit Isopropanol entfetten. **Neutralvernetzendes,
  UV-beständiges Silikon** (Elektronik-/Outdoor-Qualität, kein
  essigvernetzendes - greift Metall/Kontakte an). Durchgehende Raupe ohne
  Unterbrechung, Glas mit gleichmäßigem Druck einsetzen (nicht nur an den
  Ecken - sonst Luftblasen als spätere Leckkanäle). Silikon dichtet nur,
  trägt aber nicht dauerhaft: zusätzlich 2-4 kleine Schrauben/Klammern
  AUSSERHALB der Dichtzone zur rein mechanischen Fixierung.
- **Variante B – vorgefertigte Dichtung (konsistenter bei 140 Stück,
  gleiches Argument wie beim Fensterausschnitt selbst):** Shop fräst
  zusätzlich eine gestufte Fase/einen Falz für die Glasdicke, dazu ein
  passender zugeschnittener Gummi-/Silikon-Dichtring, zusammengepresst von
  einem dünnen Klemmring/wenigen Schrauben - eliminiert die
  Handarbeits-Streuung von Variante A über 140 Boxen.

Empfehlung: **Variante A am Pilotgerät** (schnell, kein Zusatzauftrag),
beim Gartenschlauch-Test (siehe oben) gezielt die Fensternaht besprühen.
Hält das, aber Konsistenz über 140 Stück fraglich → beim Shop nach
Variante B fragen.

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
2. **QR-Scans (Badge + Kisten, seit 2026-10-12 statt RFID) + Batterie
   (VE.Direct)** → TRB246 „Data to Server" (HTTPS-POST JSON, auf Event, mit
   Offline-Queue/Retry) → Edge Function **`ernte-ingest`** → Rohtabelle
   `ernte_scan`. **Nicht** über Traccar.
3. **Waage** → lokaler **Waagen-Agent** am Hof paart QR-Lesung (Desktop-Scanner,
   seit 2026-10-12 statt MAGNUM UHF) + Gewicht (Schnittstelle TBD) → POST an
   denselben `ernte-ingest`-Endpunkt.

## Teil C — Ingest Edge Function `ernte-ingest`

**Gebaut 2026-10-17** (`supabase/functions/ernte-ingest/`), noch nicht
deployt — siehe dessen README für Migration + Deploy-Schritte. Nimmt nur das
Maschinen-Payload entgegen (der Waagen-Pfad schreibt weiterhin direkt mit
Service-Key, siehe Teil D). Idempotenz-Umsetzung musste beim Bauen angepasst
werden: statt eines Hashs ein Unique-Index auf
`(quelle, tag_uid_norm, ereignis, zeitpunkt)` — `tag_uid_norm` ist eine
generierte, NULL-sichere Kopie von `tag_uid` (Migration
`migration_2026-10-17_ernte_scan_idempotenz.sql`), weil `ernte_scan` dafür
noch keinen Unique-Index hatte.

Supabase Edge Function (Deno). Auth: `Authorization: Bearer <ERNTE_INGEST_TOKEN>`.
**Dumm** — nur validieren + je Ereignis eine `ernte_scan`-Zeile schreiben
(Idempotenz-Key = Hash aus `quelle|typ|ts|tag` → `on conflict do nothing`).
Business-Logik (Zyklen öffnen/schließen, Schichten anlegen) macht weiterhin
der Processor (Teil E, pg_cron, einmal pro Minute) - **außer der schnellen
Klassifizierung unten**, die dafür zu langsam wäre.

**Klassifizierung Person/Kiste — seit 2026-10-12 per Typ-Präfix im QR-Code,
kein Raten mehr nötig.** Mitarbeiter-Badges beginnen mit `P-`, Kisten mit
`K-`. Die Ingest-Funktion liest nur das Präfix und weiß damit sofort, ohne
Datenbank-Lookup, ob es eine Person oder eine Kiste ist.

**Mitarbeiter-Codes (seit 2026-10-22, löst den ursprünglichen
`ernte_tag`-Anlernschritt ab):** `P-<personal_nr>-<suffix>`, z. B.
`P-2412-A1B2C3D4` - kein separates Onboarding mehr nötig, Ausweise werden
direkt auf `/erntewirtschaft/ausweise` (admin/hr) gedruckt, siehe dessen
eigenen Abschnitt unten. `<suffix>` ist ein zufälliger, in `ernte_ausweis`
gespeicherter 8-Hex-Zeichen-Code, der NUR im QR steht (nicht als Klartext
auf der Karte) - er verhindert, dass jemand allein über die (oft bekannte)
Personalnummer eines Kollegen eine funktionierende Karte fälschen kann,
ohne dessen echte Karte je gesehen zu haben ("Buddy Punching"). Drei
Klassifizierungs-Ergebnisse: `person` (Personalnummer + Suffix passen),
`person_gesperrt` (Personalnummer existiert, Suffix passt nicht mehr -
typischerweise eine per "Verlust-Karte drucken" bereits ungültig gemachte
alte Karte), `person_unbekannt` (Personalnummer existiert gar nicht, z. B.
Tippfehler/Fremdkörper). `ernte_tag` wird für Personen nicht mehr gelesen,
bleibt aber als Tabelle bestehen (siehe unten, weiterhin nutzbar, um
einzelne Kisten manuell zu markieren).

- `K-…` → immer eindeutig eine Kiste, **kein Lookup nötig** - `ernte_tag`
  muss für Kisten nicht befüllt werden, außer man will eine einzelne Kiste
  manuell markieren.

In allen drei Faellen wird der Scan trotzdem als `ernte_scan`-Zeile
gespeichert (nichts geht verloren) - der Fehlerfall ist sofort erkennbar
(kein stiller Fall mehr, der erst am Monatsende aus fehlenden Stunden
auffällt), statt erst über eine tägliche Rückschau.

**Erfolgston am Gerät (noch nicht gebaut):** vier klare, verwechslungsfreie
Töne möglich, ohne Fehlalarm-Risiko: „Person erkannt" / „Kiste" / „Karte
gesperrt" / „Badge unbekannt" - je ein einfacher Piezo-Summer an einem
Digitalausgang des TRB246, unterschiedliche Muster je Ereignis. Ton erst
**nach der Serverantwort**, nicht schon beim reinen Lesen des Codes, weil
nur das wirklich bestätigt, dass die Daten sicher angekommen sind. Eine
durch die Sperrzeit verworfene Wiederholung gilt dabei als Erfolg (der
Server hat sie ja erhalten) - stumm bleibt es nur bei echten
Übertragungsfehlern.

Payload Maschine (TRB246):
```json
{
  "box": "<IMEI/Serial>",
  "events": [
    {"typ":"scan","code":"K-10293","ts":"2026-04-18T05:32:11Z","lat":51.2,"lng":6.8},
    {"typ":"scan","code":"K-10294","ts":"2026-04-18T05:41:03Z","lat":51.2,"lng":6.8},
    {"typ":"batterie","soc":78,"u":12.9,"i":-4.2,"ts":"2026-04-18T05:45:00Z"}
  ]
}
```
`typ:"scan"` + Feld `code` (QR-Codewert `P-…`/`K-…`, vorher `tag` mit
RFID-UID wie `E280...`) - die Box weiß dank Präfix zwar grundsätzlich schon,
ob Person oder Kiste, schickt aber bewusst nur den rohen Code; die
eigentliche Klassifizierung (inkl. `employee_id`-Auflösung) bleibt
serverseitig in der Ingest-Funktion.

Payload Waage (Hof-Agent):
```json
{"waage":"hofwaage-1","code":"K-10293","gewicht_kg":9.42,"ts":"2026-04-18T13:07:55Z"}
```
Antwort: `200 {"angenommen": n, "dubletten": m, "klassifizierung":
[{"code":"K-10293", "typ": "person"|"kiste"|"person_unbekannt"}]}`

<details>
<summary>Stand bis 2026-10-11 (RFID-Klassifizierung, überholt — siehe Kurswechsel ganz oben)</summary>

**Klassifizierung Person/Kiste (Nutzer-Vorgabe 2026-09-23): nur Personen
werden angelernt, alles andere gilt automatisch als Kiste.** `ernte_tag`
muss deshalb NICHT für jeden der tausenden Kisten-Tags einen Datensatz
haben - nur für die ~140-200 Mitarbeiter-Badges (optional zusätzlich
einzelne Kisten, falls mal eine besonders markiert werden soll). Ein Tag,
der beim Scan nicht in `ernte_tag` als `art='person'` gefunden wird, ist
per Default eine Kiste - kein Onboarding-Schritt für neue Kisten-Tags
nötig.

**Sicherheitsnetz gegen den Fall „unbekannter Mitarbeiter" (Nutzer-Frage
2026-09-23, korrigiert nach Nutzer-Einwand 2026-09-23):** Ohne Weiteres
würde ein noch nicht angelerntes Mitarbeiter-Badge einfach als Kiste
durchlaufen - ein Zyklus würde geöffnet, nie gewogen, und es fällt erst
auf, wenn am Monatsende Stunden fehlen.

**Verworfen: „erster Scan des Tages = Login-Versuch".** Diese zunächst
vorgeschlagene Regel ist nicht brauchbar, weil Kisten laut der
Klassifizierungs-Entscheidung oben grundsätzlich NIE registriert sind -
eine ganz normale Kiste sieht für das System also identisch aus wie ein
vergessenes Mitarbeiter-Badge (beides „nicht in `ernte_tag` gefunden").
Kommt der Fahrer morgens mit der ersten Kiste in der Hand statt zuerst mit
dem Badge (realistisch, siehe Nutzer-Einwand), würde diese Regel bei jeder
ganz normalen Kiste einen falschen „unbekannter Mitarbeiter"-Alarm auslösen
- echte Fälle würden darin untergehen.

**Stattdessen: ruhige tägliche Rückschau statt Echtzeit-Heuristik je Scan.**
Ein registriertes Badge wird immer korrekt als Person erkannt, unabhängig
von der Scan-Reihenfolge - das bleibt unverändert zuverlässig. Das
verbleibende Risiko (Mitarbeiter, dessen Badge noch nicht angelernt wurde)
lässt sich nicht scanweise von einer normalen Kiste unterscheiden, muss es
aber auch nicht: eine tägliche Prüfung (Teil des Processors oder ein
eigener Report) meldet **„Maschine M hatte heute Kisten-Aktivität, aber
keinen erkannten Mitarbeiter-Login"** - erwischt denselben Fall, ohne bei
jeder normalen Kiste-zuerst-Reihenfolge falschen Alarm zu schlagen.
Vorbeugung bleibt organisatorisch: neue Mitarbeiter-Badges registrieren,
bevor die Person das erste Mal an die Maschine geht. Ein physischer Taster
nur für den Login-Scan bliebe eine Option, falls sich „vergessene
Registrierung" in der Praxis häufiger zeigt, als eine tägliche Rückschau
verträgt - erstmal bewusst ohne zusätzliche Hardware.

Payload Maschine (TRB246), RFID-Stand:
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

</details>

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

- liest den Kisten-Code vom **QR-Desktop-Scanner** (seit 2026-10-12 statt
  MAGNUM UHF/TCP) - üblicherweise USB-HID/seriell, gibt den Code direkt als
  Text aus, sobald die Kiste vor den Scanner gehalten wird;
- liest Gewicht von der **Waage** — „stabiles Gewicht" als Trigger;
- **paart**: stabiles Gewicht ≠ 0 + frische Code-Lesung innerhalb von N Sekunden →
  ein `{waage, code, gewicht_kg, ts}` → POST an `ernte-ingest`;
- lokale Warteschlange + Retry bei Netzausfall (umgesetzt als einfache
  JSON-Zeilen-Datei statt SQLite - kein natives Binary, siehe Baustein-Stand
  unten: auf einem Windows-Testrechner mit sehr neuer Node-Version scheiterte
  `better-sqlite3` ohne Build-Tools/Python);
- Config: Scanner-Schnittstelle (USB/seriell), Waagen-Port, Ingest-URL/Token,
  Paarungsfenster, Mindestgewicht.

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
  **Praxistest erfolgreich (2026-10-12), erste echte Wägung per `<FP0>`
  über TCP/IP** (`docs/waage_test.py`/`.ps1`): Antwort hat **ein Feld mehr
  als oben beschrieben** - vor der laufenden Nummer steht noch eine leere
  Satzkennung (`;<lfd.Nr.>;<Datum>;...`). Beide Testskripte entsprechend
  korrigiert. Beispiel-Antwort: lfd. Nr. 1 (erste Wägung seit
  Inbetriebnahme), Wägebrücke/-bereich 1/1, Stückzahl 0, Brutto 2,560 kg,
  Tara 0,000 kg, Netto 2,560 kg - stimmig. Ethernet-Schnittstelle war ohne
  Probleme ansprechbar (Freischaltung war also schon vorhanden/nicht
  nötig).
  ~~Offene Frage Tara~~ — **geklärt (2026-10-12):** Am Hof wird **immer an
  der Waage selbst tariert** (Person tariert je Kiste/Vorgang am Terminal,
  kein unbeaufsichtigter Betrieb). Der Agent liest deshalb einfach das
  **Netto-Feld direkt aus `<FP0>`** und übernimmt es 1:1 - kein
  Brutto-minus-Kisten-Leergewicht im Backend nötig, die ursprünglich
  erwogene Alternative (feste Plattform-Tara/Backend-Abzug) entfällt damit.
- Ablauf im Agenten: Kisten-Tag-Scan kommt rein → **per `<GN7>` pollen, bis
  wirklich ein Gewicht ≥ `MINDESTGEWICHT_KG` aufliegt** (nicht einfach fest
  warten - Nutzer-Einwand 2026-10-12: hängt der Scanner mit Abstand, kann
  der Scan feuern, bevor die Kiste physisch auf der Waage steht; ein fester
  Delay riskiert, dass `<FP0>` eine "stabile" 0 kg vorfindet, kein Fehler,
  nur eine falsche Zahl) → erst dann `<FP0>` senden → Antwort parsen (Erfolg
  → Netto+laufende Nummer weiter wie bisher geplant; `<FP!>`/Timeout →
  verwerfen bzw. `ungeklaert`, siehe Teil E) → Verbindung schließen.
  **Bekannte Grenze, im Pilottest zu prüfen:** Steht noch die vorige Kiste
  auf der Waage, wenn der nächste Scan kommt, erkennt das Polling sofort
  "Gewicht da" und könnte den alten Wert liefern - setzt voraus, dass die
  Waage zwischen zwei Kisten zuverlässig leer wird.

**Erster Baustein gebaut (2026-10-12): `tools/ernte-waage-agent/`.** Noch
nicht die komplette Teil-D-Kette, bewusst als erste testbare Scheibe:
- Schreibt direkt per **Service-Key in `ernte_scan`** (Muster wie
  `tools/fahrzeug-poller/`, **keine** `ernte-ingest`-Edge-Function nötig für
  diesen Pfad - der Agent läuft vertrauenswürdig am Hof, genau wie der
  Fahrzeug-Poller).
- **Scanner-Quelle austauschbar** (globaler Schalter `SCANNER_QUELLE` in der
  `.env`, kein DB-Flag - dem Nutzer reicht ein globaler Schalter): `simuliert`
  (Fake-Codes `K-TEST-0001…`, Trigger = ENTER-Taste - zum Testen mit echten
  Gewichten auf der echten Waage, ohne echten Scanner), `stdin` (echte
  Codes/späterer USB-HID-Scanner), `seriell` (RS232, Platzhalter bis ein
  Scanner-Modell feststeht).
- Waage-Client mit der korrigierten Feldreihenfolge (Satzkennung, s. o.),
  gegen die echten Praxistest-Bytes vom 2026-10-12 verifiziert.
- Lokale Warteschlange + Retry bei Supabase-Ausfall, wie geplant - **nicht
  SQLite** (ursprünglich so geplant): `better-sqlite3` braucht ein natives
  Binary passend zu Node-Version/Plattform, und scheiterte beim Praxistest
  auf einem Windows-Rechner mit sehr neuer Node-Version (kein fertiges
  Binary, Kompilieren schlug mangels Build-Tools/funktionierendem Python
  fehl). Stattdessen eine einfache JSON-Zeilen-Datei (`queue.mjs`) - bei der
  erwarteten Menge (einzelne Wiegungen) völlig ausreichend, läuft überall
  ohne Build-Schritt.
- Migration `migration_2026-10-12_erntewirtschaft_waage_grundlage.sql`
  bisher nur `ernte_waage`/`ernte_tag`/`ernte_scan` (+RLS) - bewusst ohne
  `ernte_maschine`/`ernte_position`/`ernte_kiste_zyklus`/`ernte_konfig`/
  Sichten/pg_cron-Processor, die hängen an der SpidertrackBox-Seite und
  folgen in einer eigenen Migration.
- **Noch offen/nicht gebaut:** `ernte-ingest`-Edge-Function (für den
  SpidertrackBox-Pfad), Traccar→PostgreSQL (Teil A), Poller-Erweiterung mit
  Positions-Quelle-Adapter (Teil G), restliche DB-Migration + Processor
  (Teil E), Frontend-Modul (Teil F), Traccar-Bulk-Anlage der 140
  Maschinen-Geräte.

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
`hdop`, `feld_id bigint references feld(id)` (Spatial-Join gegen
`feld.geometrie` - seit Migration 2026-10-19 ein echter FK statt der
ursprünglich skizzierten losen `flurstueck_id`/`feld text`-Spalten),
`unique(traccar_unique_id, zeitpunkt)`, Index `(maschine_id, zeitpunkt desc)`.
Monats-Partitionierung + Retention-Job (~400 Tage).

**`ernte_tag`** — Badge-/Kisten-Register: `uid text pk` (der QR-Codewert,
`P-…`/`K-…`, seit 2026-10-12 statt RFID-UID),
`art text check (art in ('person','kiste'))`, `employee_id → employees`,
`kiste_nr text`, `aktiv boolean default true`, `notiz`, timestamps.
**Seit 2026-10-22 für Personen nicht mehr genutzt** (siehe `ernte_ausweis`
unten und Teil C) - ein `P-…`-Code trägt die Personalnummer jetzt direkt in
sich, kein Lookup hier mehr nötig. Bleibt als Tabelle bestehen, falls doch
mal eine einzelne Kiste manuell markiert werden soll (`kiste_nr`), ist aber
im Regelfall komplett leer.

**`ernte_ausweis`** — **Gebaut 2026-10-22** (ersetzt den
Badge-Anlern-Workflow über `ernte_tag`): `employee_id uuid pk → employees`,
`suffix text` (8 Hex-Zeichen, zufällig, check-constraint), `erstellt_am`,
`erstellt_von → profiles`, `aktualisiert_am`. RLS bewusst **nur admin/hr**
(nicht wie `employees` selbst für jede eingeloggte Rolle lesbar) - der
Suffix ist das Geheimnis, das eine Karte fälschungssicher macht, siehe
Migrationskopf `migration_2026-10-22_ernte_ausweis.sql` für die ausführliche
Begründung (Spalten-Ebene-Policies auf `employees` sind in diesem Projekt
laut dokumentiertem Vorfall explizit verboten).

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
Schließen), `voll_lat/lng`, `feld_id bigint references feld(id)` (Spatial-Join,
echter FK seit Migration 2026-10-19 - `kultur` kommt bei Bedarf per Join aus
`feld.kultur`, nicht mehr denormalisiert),
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

**`ernte_feld` — ERSETZT durch das generische `feld` (Migration
2026-10-19, siehe `supabase/migration_2026-10-19_feld_anbau_schema.sql`).**
Keine eigene Erntewirtschaft-Tabelle mehr: `ernte_position`/
`ernte_kiste_zyklus` referenzieren künftig `feld.id` (Spalte `feld_id`) statt
der hier ursprünglich skizzierten losen `flurstueck_id`/`feld text`-Spalten.
`laufmeter_gesamt` entfällt als eigenes Feld — wird jetzt aus
`feld_anbau_abschnitt` berechnet (Summe Reihenlänge × Reihenzahl der
laufenden Saison, Sicht `feld_anbau_uebersicht.laufende_meter`), siehe offene
Frage 7 unten. `kultur` lebt jetzt auf `feld.kultur` (kulturübergreifend:
Erdbeeren/Spargel/Grünspargel/Sonstiges). Geometrie-Erstbefüllung per Import
aus Pachtwesen2026 (Schlag-Ebene, `anon`-RPC `schlaege_bewirtschaftet_fuer_jahr`
— noch zu bauen) oder Karten-Editor in spargar26 (reuse des
Satellitenbild-Umschalters aus `components/FahrzeugKarte.tsx`), siehe offene
Frage 1 unten.

**`ernte_maschine_energie`** (v1.1) — VE.Direct-Telemetrie: `id`, `maschine_id`,
`zeitpunkt`, `soc_prozent`, `spannung_v`, `strom_a`,
`pv_status text check (pv_status in ('bulk','float','absorption'))` (Victron-
Laderegler-Zustand, aus dem Pflichtenheft), `roh jsonb`,
`unique(maschine_id, zeitpunkt)`.

**`ernte_konfig`** — `schluessel text pk`, `wert text`, `beschreibung`. Seed:
`tara_kg_standard`, `schicht_timeout_min`, `kiste_faellig_bis='23:00'`
(ersetzt `kiste_offen_warn_h`, siehe `ernte_kette_luecken` unten - feste
Tagesend-Uhrzeit statt rollierender Stundenzahl), `position_rate_s`,
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
  Kumuliert über die Saison vs. `feld_anbau_uebersicht.laufende_meter` (für
  die laufende Saison, aus der Anbau-Planung berechnet statt separat
  gepflegt - siehe offene Frage 7) → Fortschritt in % fürs Dashboard (inkl.
  Summe letzte 48 h laut Pflichtenheft).
- **`ernte_kette_luecken`** — Reconciliation: „befüllt, nie gewogen"
  (`status='offen'` und Tagesende erreicht, siehe unten),
  „gewogen ohne Befüllung" (`status='ungeklaert'` - Kiste zum ersten Mal an
  der Waage gescannt, ohne Maschinen-Scan davor; **wird erkannt**, aber
  Feld/Person/Zeit sind für diese eine Kiste nicht rekonstruierbar),
  „eingeloggt, nichts geerntet", implausibles Nettogewicht,
  **„Kiste erneut befüllt, obwohl noch ein offener Zyklus existiert"**
  (Nutzer-Vorgabe 2026-10-22, beim Praxistest entdeckt: eine Kiste darf den
  Zyklus erst wieder von vorne durchlaufen, nachdem sie die Waage passiert
  hat — ein versehentlicher zweiter Scan vor dem Wiegen wird vom Processor
  **abgelehnt** statt einen zweiten, parallelen Zyklus anzulegen; die
  Rohzeile bleibt erhalten, `ernte_scan.verarbeitung_fehler` nennt den
  bereits offenen Zyklus, siehe `migration_2026-10-22_ernte_kiste_bereits_offen.sql`).
  Alle fünf Fälle bis auf „gewogen ohne Befüllung" und den neuen
  Doppel-Scan-Fall **existieren bisher nur als Beschreibung hier** - die
  Sicht selbst ist noch nicht gebaut (geplanter nächster zusammenhängender
  Baustein, statt die restlichen Faelle einzeln nachzuziehen).
  **Nutzer-Vorgabe 2026-09-23: Kisten müssen immer am selben Tag an der
  Waage ankommen** - deshalb Fälligkeit an eine feste Tagesend-Uhrzeit
  koppeln (`ernte_konfig.kiste_faellig_bis='23:00'`, ersetzt/ergänzt das
  bisherige `kiste_offen_warn_h`, das als rollierende Stundenzahl eine um
  17 Uhr befüllte Kiste schon um 19 Uhr fälschlich als „fehlt" markiert
  hätte), nicht an eine rollierende Stundenzahl seit Befüllung.
  **Je Mitarbeiter aggregiert** (nicht nur als lose Zyklen-Liste): „Person X
  - heute N Kisten befüllt, davon M nicht gewogen" - direkter Soll-Ist-
  Abgleich zwischen Maschinen-Scans und Waage je Person.
- **`ernte_maschine_live`** — jüngste `ernte_position` je Maschine + aktive
  Schicht + kg heute. Für Karte/Überblick.

### RLS (Muster wie `fahrzeug`)

- `select` auf alle `ernte_*`-Tabellen + Sichten: `admin`, `hr`, `management`,
  `erntewirtschaft`, **`zeiterfassung`** (= „Mitarbeiter"/„Techniker" im
  Pflichtenheft — Dashboard, Maschinenliste, Belegungen).
- `ernte_maschine`, `ernte_tag`, `ernte_waage`, `ernte_konfig`:
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

**Sperrzeit gegen Mehrfach-Lesungen (Nutzer-Frage 2026-09-23, WICHTIG — gilt
unverändert auch für QR seit dem Kurswechsel 2026-10-12):** Ein Scanner im
Dauerscan/Presentation-Mode meldet denselben Code typischerweise mehrmals
pro Sekunde, solange er im Lesefeld bleibt - hält der Fahrer eine Kiste 2 s
vor den Scanner, kommen leicht 5-10 Einzel-Lesungen desselben Codes in
`ernte_scan` an, nicht eine (bei RFID genauso wie bei einem QR-Modul im
Presentation-Mode). Für einen Login fängt das die bestehende Regel „neue
Schicht nur, wenn heute noch keine offen" bereits zufällig ab. Für eine
Kiste NICHT - ohne Sperrzeit würde jede der 5-10 Lesungen denselben Zyklus
erneut schließen/neu öffnen und die Kette zerreißen. Deshalb zusätzlich zur
scannerseitigen Drosselung (falls unterstützt, z. B. „Code erst nach X s
erneut melden" - beim Pilottest mit prüfen, spart auch Datenvolumen):
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
- **Login (Tag als `person` klassifiziert) → `ernte_schicht`** (neue
  Schicht, wenn nicht schon heute offen für Maschine+Fahrer). **Ein-
  Maschine-Regel (Nutzer-Vorgabe 2026-09-23):** Vor dem Öffnen der neuen
  Schicht wird geprüft, ob dieselbe Person noch eine offene Schicht an
  einer ANDEREN Maschine hat - falls ja, wird diese sofort geschlossen
  (`ende = zeitpunkt` des neuen Logins). Eine Person kann also nie
  gleichzeitig auf zwei Maschinen als aktiv gelten; ein Wechsel (auch
  Vormittag/Nachmittag) schaltet nahtlos um, ohne manuellen Logout.
  **Spiegelbildlich (Praxisfund/Nutzer-Entscheidung 2026-10-22):** Scannt an
  einer Maschine, an der schon eine Schicht offen ist, eine ANDERE Karte ein,
  gilt das als impliziter Schichtwechsel - die alte Schicht wird geschlossen,
  eine neue geöffnet. Scannt dieselbe Karte erneut, während ihre eigene
  Schicht noch offen ist, passiert nichts Neues, außer: war der Name noch
  nicht aufgelöst (Ausweis wurde erst nach dem Login gedruckt/angelegt in
  `ernte_ausweis`), wird er jetzt nachträglich gesetzt, statt die Schicht für
  immer "ohne Zuordnung" zu lassen (siehe
  `migration_2026-10-22_ernte_schicht_nachtraeglich_aufloesen.sql` und
  `migration_2026-10-22_ernte_schichtwechsel_maschine.sql`).
- **Kiste (jeder nicht als `person` klassifizierte Tag - das ist der
  Normalfall für jede Kiste, siehe Klassifizierungs-Entscheidung oben) an
  Maschine M** → jüngsten offenen Zyklus für M schließen (`voll_am`,
  `voll_lat/lng`), neuen Zyklus `offen` anlegen (`befuellt_*`, Spatial-Join
  gegen `feld.geometrie` → `feld_id` - **das Feld/der Ursprung ist immer
  eindeutig, unabhängig von der Mitarbeiter-Zuordnung**). `schicht_id`/
  `employee_id` kommen aus der aktiven Schicht an M, **falls keine offen
  ist, bleiben beide NULL** - Nutzer-Entscheidung 2026-09-23: kein
  Mitarbeiter registriert/angemeldet heißt „Kiste ohne Zuordnung", nicht
  „Fehler". Ursprung (Feld) bleibt vollständig, die Person kann jederzeit
  im Nachhinein nachgetragen werden (`ernte_kiste_zyklus.employee_id` ist
  update-bar für admin/hr, siehe RLS oben).
  **Keine** scanweise Sonderbehandlung für „erster Scan" mehr (siehe Teil C,
  Sicherheitsnetz-Verlauf - diese frühere Idee wurde verworfen, weil sie
  bei jeder Kiste-vor-Badge-Reihenfolge falschen Alarm geschlagen hätte).
  Stattdessen **live sichtbar auf `/erntewirtschaft`** (nicht nur einmal
  täglich im Report, siehe Teil F): laufende „Kisten ohne Zuordnung" je
  Maschine, damit das Problem sofort auffällt, während noch gearbeitet
  wird - Nutzer-Erwartung: die Mitarbeiter sorgen selbst zeitnah für die
  Behebung (Ausweis auf `/erntewirtschaft/ausweise` drucken lassen, kein
  Anlernschritt mehr seit 2026-10-22), wenn sie sehen, dass ihre Kisten
  nicht zugeordnet werden.
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
  Tages-Kacheln (Kisten heute, kg heute, Ø kg/h, offene Ketten-Lücken,
  **„Kisten ohne Zuordnung heute"** - Nutzer-Vorgabe 2026-09-23: live sichtbar,
  nicht erst im Tagesreport, siehe Processor oben - Maschinen mit
  Kisten-Aktivität ohne aktive Schicht farblich hervorheben, damit
  Mitarbeiter/Vorarbeiter das noch während der Arbeit selbst beheben
  können), **„Kisten fehlen heute"** - je Mitarbeiter befüllt vs. gewogen
  aus `ernte_kette_luecken` (siehe Teil E), ebenfalls live, nicht erst nach
  `kiste_faellig_bis`-Tagesende, damit eine tatsächlich verlorene Kiste
  noch am selben Tag gesucht werden kann. Karten-Muster aus
  `FahrzeugKarte` (ggf. zu gemeinsamem `GpsKarte` verallgemeinern).
- **`/erntewirtschaft/ernte`** — Kisten-Zyklen: Datumsfilter, Tabelle (befüllt ·
  Maschine · Fahrer · Feld · netto kg · gewogen · Status), Filter „nur Lücken"
  und **„nur ohne Zuordnung"** (`employee_id is null`, siehe Prozessor oben) -
  hier auch das **nachträgliche Zuordnen** einer Person zu bereits
  entstandenen Kisten (admin/hr, `ernte_kiste_zyklus.employee_id` per Klick
  setzen), CSV-Export.
- **`/erntewirtschaft/effizienz`** — Realitätscheck: je Schicht/Fahrer/Maschine/
  Feld kg, Stunden (Schicht vs. `work_entries`), kg/h; Ertragsdichte-Heatmap aus
  `ernte_kiste_zyklus`-Positionen (gewichtet mit netto kg); Zeitraum-Wähler; Export.
- **`/erntewirtschaft/stammdaten`** — Maschinen-CRUD, Waagen, Felder (Karten-
  Editor / Import), Konfig-Konstanten. **Excel-/CSV-Import für die 140 Maschinen**
  (siehe unten).
- **`/erntewirtschaft/transponder`** — **ERSETZT (2026-10-22)** durch
  `/erntewirtschaft/ausweise` (gebaut, siehe eigener Abschnitt unten): seit
  Codes direkt aus der Personalnummer ableitbar sind, gibt es keine
  Badge↔Person-Zuordnung mehr zu verwalten - "Badge zuordnen für
  `person_unbekannt`" entfällt, ein Ausweis wird per Knopfdruck gedruckt statt
  importiert/zugeordnet.
- **`/erntewirtschaft/ausweise`** — **Gebaut 2026-10-22** (admin/hr, eigene
  RLS-Tabelle `ernte_ausweis`): Liste aller aktiven Mitarbeiter, je Zeile
  "Drucken" (legt beim ersten Mal einen Suffix an) / "Erneut drucken"
  (gleicher Suffix) / "Verlust-Karte drucken" (rotiert den Suffix, alte
  Karte sofort ungültig, mit Bestätigungsdialog). Druckansicht zeigt groß die
  Personalnummer als Klarnummer, der Suffix steckt nur im QR-Code
  (`qrcode`-Paket, client-seitig). Noch ohne eigenen Kartendrucker (Stand
  2026-10-22).
  **Redesign 2026-10-22 ("Design und DIN-A4-Druck", eigene Spezifikation):**
  Karte exakt 85,60 x 53,98 mm (ID-1), eigenes Farbschema (Primärgrün
  `#286b38`, Text `#202820`, Sekundärtext `#737b73`), Kopfzeile "SPARGELHOF
  MÖMMEL" / "MITARBEITERAUSWEIS" mit grüner Trennlinie, Name prominent
  darunter, untere Zeile Foto (20x26mm) · Personalnummer (mittig, mit
  kleiner Beschriftung) · QR-Code (24x24mm, jetzt als **SVG** statt
  PNG-DataURL für scharfen Vektordruck - Wert/Erzeugung unverändert).
  Eigene Komponenten `components/MitarbeiterAusweisKarte.tsx` (fixe
  physische Größe, für Vorschau UND Druck identisch, nur Schatten/
  Eckenrundung unterscheiden sich) und
  `components/MitarbeiterAusweisDruckbogen.tsx` (DIN-A4-Blatt, Karte 20mm
  vom linken/oberen Rand, 4 Schnittmarkierungen außerhalb der Kartenfläche).
  Bildschirm-Vorschau ca. 3-fach vergrößert per `transform:scale()` am
  äußeren Rahmen (responsiv über Media-Query-Stufen, beeinflusst nie die
  Druckgröße). **Bewusste Abweichung von der Nutzer-Vorgabe:** die
  mitgelieferte CSS-Skizze nutzt eine unbenannte `@page { size: A4; margin:
  0; }` - das würde (siehe Bugfix-Hinweis bei `.stammkarte` in
  `app/globals.css`) den gesamten App-Druck beeinflussen, nicht nur diese
  Seite. Stattdessen eine benannte `@page ausweis2-a4`, gleiches Muster wie
  überall sonst in der App - Ergebnis optisch identisch.
  **Mitarbeiterfoto (`migration_2026-10-22_mitarbeiter_foto.sql`,
  `employees.foto_pfad` + privater Bucket `mitarbeiter-fotos`, gleiches
  RLS-Muster wie `mitarbeiter-dokumente`):** wird NICHT hier aufgenommen,
  sondern **direkt bei der Anreise** in `app/personalplanung/page.tsx`
  (Nutzer-Vorgabe 2026-10-22: "muss beim Anlegen der Person während der
  Anreise schon passieren") - `anreiseVorbereiten()` öffnet nach dem
  Anlegen für jede neu (nicht reaktivierte) Person nacheinander
  `components/MitarbeiterFotoAufnahme.tsx`: Kamera-Vorschau mit gelbem
  Rahmen, in den das Passfoto des physischen Personalausweises gehalten
  wird - gespeichert wird NUR der zugeschnittene Rahmen-Ausschnitt, nie das
  volle Kamerabild (keine Ausweiskopie mit Nummer/Geburtsdatum im Storage).
  Dieselbe Komponente steht auch auf `/erntewirtschaft/ausweise` für
  nachträgliches Hinzufügen/Ändern bereit (z. B. bei der Anreise
  übersprungen, oder für ältere Mitarbeiter ohne Foto).

**Praxistest bestanden (2026-10-22):** Ausweis über `/erntewirtschaft/ausweise`
gedruckt (normaler Drucker, kein Kartendrucker), mit dem Scan-Modul an der
Maschine gescannt (Login), danach Kisten gescannt - Personalnummer+Suffix
korrekt aufgelöst, Kisten-Zyklen dem Fahrer zugeordnet. Kompletter neuer
Ausweis-Workflow damit end-to-end bestätigt, inklusive Druck auf normalem
Papier statt Kartendrucker.

### Excel-/CSV-Import (nur noch Maschinen)

Bulk-Import, weil 140 Maschinen niemand von Hand tippt. Für Mitarbeiter-
Badges entfällt der Import seit 2026-10-22 komplett (siehe
`/erntewirtschaft/ausweise` - der Code wird aus der ohnehin vorhandenen
Personalnummer erzeugt, kein Datensatz zu importieren).

- **Maschinen:** Spalten `nummer`, `bezeichnung`, `box_seriennummer`,
  `traccar_unique_id` (IMEI). Upsert auf `nummer`.
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

## Teil F3 — Feld-Zielertrag + Telegram-Alarm (vorgemerkt 2026-10-26, noch nicht gebaut)

Nutzer-Vorgabe: Zusätzlich zum bestehenden Erntefenster (`feld_anbau.
erntefenster_von/_bis`) braucht jedes Feld einen **Maximal-/Zielertrag**, gegen
den der laufende **Rohertrag** (tatsächlich gewogene kg, aus
`ernte_kiste_zyklus.gewicht_netto_kg` je `feld_id` summiert) mitläuft. Wird der
Zielertrag erreicht, soll eine **Telegram-Nachricht** kommen - Grund: bei
manchen Feldern muss die Ernte dann bewusst beendet werden (z.B. um den Bestand
nicht zu überernten).

Offene Design-Punkte, vor dem Bauen zu klären:

- **Neues Feld, nicht `ertrag_erwartet` wiederverwenden:** `ertrag_erwartet`
  (+ `ertrag_einheit`, Default „steigen") ist eine grobe Vorab-Schätzung für
  die Bestellplanung, keine kg-genaue harte Schwelle. Zielertrag sollte eine
  eigene Spalte in **kg** sein (z.B. `feld_anbau.ertrag_ziel_kg`), damit der
  Vergleich mit der Waage (ebenfalls kg) ohne Einheiten-Umrechnung funktioniert.
- **Zeitraum-Frage:** läuft der Rohertrag-Zähler über die ganze Saison
  (`feld_anbau.saison_jahr`) oder nur innerhalb des Erntefensters? Nutzer
  entscheidet.
- **Technischer Weg zur Telegram-Nachricht:** Postgres selbst kann nicht
  direkt ins Internet - entweder (a) die `pg_net`-Extension (in Supabase
  verfügbar) direkt aus `ernte_scan_verarbeiten()` nach jedem Wiegen einen
  HTTP-Call an die Telegram-Bot-API machen lassen, oder (b) ein kleiner
  periodischer Check (Edge Function oder eigener Poller, analog zur
  bestehenden Telegram-Alarmierung bei [[fahrzeuge-traccar]]/
  `tools/fahrzeug-poller`). Variante (a) ist näher an der bestehenden
  DB-zentrierten Processor-Architektur dieses Moduls.
- **Mehrfachversand verhindern:** braucht einen Dedup-Zustand (z.B.
  `feld_anbau.ziel_erreicht_benachrichtigt_am`), sonst kommt bei jeder
  weiteren Wiegung über dem Ziel erneut eine Nachricht.
- **Offen, ob rein informativ oder auch eine Sperre im System:** reicht die
  Telegram-Nachricht (Rest ist manuelle Organisation vor Ort - Fahrer/
  Vorarbeiter stoppen die Ernte auf diesem Feld selbst), oder soll die App
  danach auch aktiv warnen/blockieren, falls trotzdem noch eine Maschine auf
  diesem Feld scannt? Nutzer entscheidet, wenn der Rest der Erntewirtschaft
  gebaut wird.

## Teil G — Poller-Erweiterung

**Gebaut 2026-10-22** (`tools/ernte-poller/`, siehe dessen README) — eigene
systemd-Timer-Instanz (15 s), nicht Teil des Fahrzeug-Pollers, aber gleiche
Traccar-Instanz. Abweichungen gegenüber der ursprünglichen Skizze:

- Statt einer Traccar-Gruppe/Namensschema erkennt der Poller "seine" Geräte
  selbst über IMEI-Abgleich (Traccar-`uniqueId` = `ernte_maschine.box_seriennummer`)
  und trägt `traccar_unique_id` automatisch nach — keine manuelle
  Traccar-Pflege je Box nötig, auch nicht beim 140er-Rollout.
- Drosselung auf `POSITION_RATE_S` (Standard 5 s, Env-Var) je Maschine, nach
  demselben Lücken-Nachzug-Muster (`/api/reports/route`) wie der
  Fahrzeug-Poller — Traccar selbst bekommt weiterhin die volle 1-s-Auflösung
  vom TRB246.
- Spatial-Join gegen `feld.geometrie` läuft NICHT im Node-Code, sondern in der
  DB-Funktion `ernte_position_feld_zuordnen()`
  (`migration_2026-10-22_ernte_position_feld_zuordnung.sql`), vom Poller nach
  jedem Schreib-Durchlauf aufgerufen — gleiches Muster wie
  `ernte_scan_verarbeiten()`. Ohne passende Feld-Geometrie bleibt `feld_id`
  NULL (kein Fehler).
- Retention 1x/Tag wie beim Fahrzeug-Poller, aber `RETENTION_DAYS=365`
  (deckt eine ganze Saison ab, für die Laufmeter-/Feldstufen-Auswertung).
- Noch nicht umgesetzt: Fix-Qualität unter RTK (aktuell kein RTK im Einsatz,
  siehe Hardware-Entscheidungen oben) — `fix_qualitaet`/`hdop` werden
  mitgeschrieben, falls Traccar sie liefert, aber (noch) nicht ausgewertet.
- **Praxistest bestanden (2026-10-22):** erste echte Feld-Geometrie
  ("Hofstelle") gezeichnet, Poller lieferte Positionen, Spatial-Join hat
  `feld_id` korrekt aufgelöst. Dabei ein Bug gefunden+gefixt
  (`migration_2026-10-22_ernte_position_feld_zuordnen_fix.sql`):
  PostGIS-Funktionen liegen in diesem Supabase-Projekt unter `public`, nicht
  `extensions` (derselbe Stolperstein wie schon bei
  `migration_2026-10-19_feld_geojson_view.sql` — beim ersten Schreiben der
  Funktion übersehen).

## Teil H — Deploy-Reihenfolge (Nutzer)

1. Hardware-Entscheidungen oben treffen (QR-Scan-Modul an der Maschine, RTK-Kette,
   NTRIP-Quelle) — **vor** dem Kauf der SpidertrackBox-Teile.
2. Traccar auf PostgreSQL umstellen (noch H2, Stand 2026-10-17 — für EIN
   Pilotgerät kein Blocker, erst vor dem 140er-Rollout Pflicht).
3. Migration `erntewirtschaft` in Supabase (PostGIS ist bereits seit Migration
   2026-10-19 aktiviert); `feld` befüllen (Import aus Pachtwesen2026 oder
   Karten-Editor, siehe Phase 2/3 des Feld/Anbau-Plans).
4. Edge Function `ernte-ingest` deployen; `ERNTE_INGEST_TOKEN` setzen —
   **gebaut 2026-10-17** (siehe Teil C), Migration
   `migration_2026-10-17_ernte_scan_idempotenz.sql` davor einspielen, Deploy
   + Secret steht noch aus.
5. pg_cron-Processor einrichten.
6. Eine Spinne als Pilot komplett aufbauen (RTK + QR-Scan-Modul + Data-to-Server), End-to-End
   testen (Badge → Kiste → LKW → Waage → `ernte_kiste_zyklus` gewogen).
7. Waagen-Agent am Hof aufsetzen, sobald die Waage da ist.
8. Rollout auf die 140 Maschinen; whereversim je Maschine zur Saison aktivieren.
   **Standard-Konfiguration je Box** (Praxistest 2026-10-22, senkt die
   Bootzeit bis zur ersten Status-LED-Reaktion von 3:20 auf 2:10 Minuten -
   bei 140 Boxen täglich spürbar): unter **Network → Mobile → General**
   "Preferred network type" auf **"4G only"** stellen (verhindert
   sequenzielles Durchprobieren von 2G/3G/4G); unter **Status → Services**
   **SMS Utilities deaktivieren** (wird nicht gebraucht). APN muss laut
   Teltonika-Vorgabe auf "Auto" bleiben, hier kein Hebel. Netzwerktyp "Auto"
   vs. "4G only" sowie "Band Selection" (bewusst auf "Auto" gelassen -
   falsches manuelles Band riskiert Verbindungsabbruch) sind zwei getrennte
   Einstellungen, nicht zu verwechseln.
9. Mitbestimmung mit den Fahrern klären, bevor der Effizienz-Check scharfgeschaltet
   wird.

## Offene Fragen an den Nutzer

1. ~~**Feld-Geometrien**~~ — **geklärt (2026-10-19):** eigenes,
   kulturübergreifendes `feld` in der Spargar-DB (PostGIS aktiv), Erstbefüllung
   per `anon`-RPC-Import aus Pachtwesen2026 auf Schlag-Ebene (idempotent, lässt
   bereits verfeinerte Geometrien unangetastet) oder Karten-Editor.
2. **Lesetiefe/-punkt an der Maschine:** gibt es an der Spinne einen
   definierten Scan-Punkt (Halterung/Tasche), an dem der Fahrer die
   Hartplastik-Karte vor den QR-Scanner hält? Bei QR braucht es direkten
   Sichtkontakt (anders als bei RFID, das auch durch leichten Dreck/Winkel
   noch liest) — der Pilottest muss deshalb auch die praktische Handhabung
   am Scan-Punkt prüfen (Erreichbarkeit vom Fahrersitz, Ausleuchtung).
3. **Waage:** sobald das Modell feststeht — Schnittstelle (RS232 / Ethernet /
   Impuls)? Rechner am Hof für den Agenten vorhanden oder Teil des Projekts (RPi)?
4. ~~`work_entries`-Kopplung~~ — **geklärt** (Pflichtenheft): der Stundenzettel
   bleibt führend, die Maschinenzeit ist Kontroll-/Differenzgröße.
5. ~~**Tara**~~ — **geklärt (2026-10-12):** es wird immer an der Waage selbst
   tariert, der Agent übernimmt das Netto-Feld direkt (siehe Teil D).
6. **Mitbestimmung:** die Kette Fahrer→Kiste→kg→Stunden ist personenscharfe
   Leistungserfassung — vor Scharfschaltung mit den Fahrern/Betriebsrat klären.
7. ~~**Laufmeter-Stammdaten**~~ — **geklärt (2026-10-19):** nicht separat
   gepflegt, sondern aus der generischen Anbau-Planung berechnet
   (`feld_anbau_abschnitt`: Reihenlänge × Reihenzahl je Abschnitt, aufsummiert
   in `feld_anbau_uebersicht.laufende_meter` für die laufende Saison).
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
