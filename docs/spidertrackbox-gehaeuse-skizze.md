# SpidertrackBox-Innenausbau — Spezifikation für eine technische Skizze

Stand: 2026-10-13. Zusammengestellt aus den Datenblättern (Pollin-Gehäuse,
Teltonika TRB246) und der Hardware-Diskussion in `erntewirtschaft-plan.md`.
Gedacht zum Weitergeben an ein Zeichen-/Skizzen-Tool (z. B. ChatGPT) für eine
**Konzept-/Planungszeichnung** — keine fertigungsreife technische Zeichnung,
siehe Hinweis am Ende.

## 1. Gehäuse (Außenmaße, Referenz für die Zeichnung)

- Pollin Electronic, Best.-Nr. 460493, ABS-Kunststoff, lichtgrau, IP65/66
- Außenmaße: 200 mm (B) × 150 mm (T) × 75 mm (H)
- Nutzbare Innenfläche (Boden): ca. 190 × 140 mm
- Maximale Einbauhöhe (Bauteile auf Abstandsbolzen): 68,5 mm
- Deckel abnehmbar, umlaufende Dichtung bereits werkseitig eingezogen
- 4 Befestigungsdome in den Ecken (Bodenplatte) für Schrauben

## 2. Hauptkomponente: Teltonika TRB246 (IoT-Gateway)

- Maße: 83 × 74,2 × 25 mm, Metallgehäuse
- Mittig/seitlich auf dem Boden montiert (Hutschienen-Clip oder
  Schraubbefestigung — Montageart im offiziellen Datenblatt prüfen)
- Schnittstellen am Gerät: LTE/4G, GNSS, RS232, RS485, digitale I/Os,
  2× SIM-Slot, Antennenanschlüsse (SMA, genaue Anzahl/Belegung im
  Datenblatt verifizieren — üblich sind getrennte Anschlüsse für
  Mobilfunk-Haupt/Diversity und GNSS)
- **Platzbedarf inkl. Zugänglichkeit:** zusätzlich ca. 20–30 mm Freiraum
  auf der Steckerseite für Kabelbiegeradius und SIM-Zugang einplanen

## 3. QR-Scan-Modul (Einbau-Engine, kein eigenes Gehäuse)

- Modell noch nicht final (RFQ an Zulieferer läuft) — Platzhalter-Maße
  aus zwei realistischen Kandidaten:
  - Honeywell N6603: ca. 23,5 × 16,2 × 6,8 mm, 3 g
  - Newland EM3296: ca. 21,8 × 15,3 × 11,8 mm
- **Benötigt ein Sichtfenster in der Gehäusewand** (die Engine hat selbst
  keinen Wetterschutz) — Fenster so positionieren, dass die Scan-Optik
  direkt auf die vorbeigeführte Kiste/Karte blickt
- Fensterausschnitt: ca. 30 × 30 mm sollte reichen (abhängig vom finalen
  Modell), **idealerweise als fertiger IP65-Sichtfenster-/
  Durchsichts-Einsatz** (z. B. Bopla/Fibox-Systemkomponente), nicht
  freihändig ausgeschnitten + verklebt, da dies 140× reproduzierbar dicht
  sein muss
- Ausgang typischerweise TTL/UART, nicht direkt RS232 — braucht einen
  Pegelwandler (siehe Punkt 5)

## 4. GNSS/Mobilfunk-Antenne

- Teltonika Combo-Dachantenne (Mobilfunk + GNSS + ggf. WLAN)
- Sitzt **außen auf dem Gehäuse/Dach der Spinne**, nicht im Kasten
- Kabeldurchführung(en) durch die Gehäusewand zu den SMA-Anschlüssen am
  TRB246 — Anzahl der Kabel vom genauen Antennenmodell abhängig
  (vermutlich 2–3: Mobilfunk Haupt, ggf. Mobilfunk-Diversity, GNSS)
- Jede Durchführung braucht eine eigene abgedichtete Kabelverschraubung
  oder einen vorkonfektionierten SMA-Durchführungsadapter

## 5. Batterie-Überwachung (Victron)

- VE.Direct-Kabel + MAX3232-Pegelwandler (liest Ladezustand/Spannung/
  Strom vom Victron-Laderegler)
- Kleine Zusatzplatine, Platzbedarf gering (vergleichbar mit einer
  Visitenkarte oder kleiner)
- Nutzt eine der seriellen Schnittstellen des TRB246 (RS232 oder RS485)
  — **da sowohl Scan-Modul als auch Victron-Anbindung eine serielle
  Schnittstelle brauchen, klären, ob beide Schnittstellen des TRB246
  gleichzeitig genutzt werden können oder ein zusätzlicher Wandler/
  Multiplexer nötig ist**

## 6. Stromversorgung

- Einspeisung aus dem Bordnetz der Spargelspinne (Victron-System) über
  eine Kabeldurchführung mit Verschraubung
- TRB246 benötigt laut Datenblatt eine bestimmte Eingangsspannung (im
  offiziellen Datenblatt prüfen, nicht mit dem 12-36V-Bereich des
  separaten HD650-Waagenscanners verwechseln) — ggf. Spannungswandler/
  Sicherung mit einplanen
- Kleine Reihenklemmen zur Stromverteilung auf TRB246 + Scan-Modul +
  Pegelwandler-Platine

## 7. Montage/Befestigung im Gehäuse

- Kurzes Hutschienen-Stück (DIN-Rail-Segment) für TRB246, falls
  Hutschienenmontage gewählt wird — alternativ Schraubbefestigung direkt
  auf den Befestigungsdomen
- Reihenklemmenblock für Stromverteilung, auf Hutschiene oder Bodenplatte

## 8. Alle Wanddurchbrüche im Überblick (für die Zeichnung)

1. Sichtfenster für QR-Scan-Modul (rechteckig, ca. 30×30 mm, Position:
   Wand mit Blickrichtung zur Kiste)
2. Kabeldurchführung(en) Antenne (2–3× SMA/Kabelverschraubung, Position:
   Oberseite oder Seite, möglichst kurzer Weg zum Dach)
3. Kabeldurchführung Stromversorgung (1× Kabelverschraubung, Position:
   Unterseite/Seite, Richtung Bordnetz)

## Hinweis

Diese Skizze ist eine **Konzept-/Planungszeichnung**, keine
fertigungsreife technische Zeichnung — Scan-Modul-Modell, exakte
TRB246-Steckerbelegung und genaue Antennenkabelanzahl stehen noch nicht
fest und sollten vor der finalen Fertigung gegen die offiziellen
Datenblätter geprüft werden.

## Quellen

- Pollin Electronic Datenblatt, Best.-Nr. 460493 (ABS-Gehäuse 200×150×75mm, IP65)
- [Teltonika TRB246 — Alcadis](https://alcadis.nl/en/products/teltonika-trb246)
- [Teltonika TRB246 — Wesafe](https://en.shop.wesafe.se/teltonika-networks-trb246-4g-lte-industrial-iot-gateway-mobilnat-gateway-trb246000000)
- [Honeywell N6603/N660x — UMD](https://umd.com.au/itd/var/honeywell_n6600.html), [Honeywell N670x Serie](https://automation.honeywell.com/de/de/products/productivity-solutions/barcode-scan-engines-and-modules/2d-barcode-scan-engines/n670x-series-2d-ultra-slim-scan-engine)
- [Newland EM3296 — koncept-l.pl](https://storm.koncept-l.pl/katalog/cat/czytniki/czytniki-kodow-oem/p/em3296?print=1), [Newland EM3296V4 Datenblatt](https://www.newland-id.com/datasheets/230/em3296v4.pdf)
