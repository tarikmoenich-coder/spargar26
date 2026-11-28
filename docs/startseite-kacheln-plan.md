# Startseite selbst gestalten – Kacheln in drei Größen

Stand 2026-11-28, Planung mit dem Nutzer. Noch nicht gebaut.

## Grundsätze (Nutzer-Vorgaben)

- Auf der Startseite stehen **nur akute, live, Tagesinformationen und offene Aufgaben** –
  nie längere Statistiken. Die stehen auf der Detailseite, die Kachel verlinkt dorthin.
- Jede Kachel ist je Nutzer wählbar: **Groß / Mittel / Klein / Aus**. Die Größe ist zugleich
  die Priorität.
- Die Seite setzt sich selbst zusammen: oben die roten Hinweise, dann alle großen, dann alle
  mittleren, dann alle kleinen Kacheln.
- Innerhalb einer Größe **fest nach Dringlichkeit**: Kacheln mit Rot zuerst, dann Gelb, dann
  ruhige; bei Gleichstand eine feste Grundreihenfolge (Tabelle unten).
- Eine **ausgeblendete Kachel meldet sich weiter über den roten Hinweis oben** (z.B.
  „Kassendifferenz ML“) – sonst nichts.
- **Start: alles Mittel.** Keine Rollen-Voreinstellungen.
- Man sieht nur Kacheln zu Bereichen, die man sehen darf (Rechte-Katalog).

## Größen

| Größe | Breite (Desktop) | Inhalt |
|---|---|---|
| Groß | volle Breite (bzw. 2/3) | alles Akute des Bereichs, ausführlich: mehrere Listen, alle offenen Einträge, Details je Eintrag |
| Mittel | 1/3 | große Zahl, kurze Unterzeile, die 3–5 wichtigsten Einträge, Link (wie heute) |
| Klein | 1/4 | eine Zahl mit Beschriftung und Zustand (grün/gelb/rot), Klick → Detailseite |
| Aus | – | nicht sichtbar; roter Hinweis oben bleibt |

Handy: Groß und Mittel volle Breite, Klein zu zweit nebeneinander.

## Kacheln

Grundreihenfolge = Reihenfolge der Tabelle. „Ton“ bestimmt die Dringlichkeit.

| Kachel | Recht | Klein | Mittel | Groß | Rot / Gelb |
|---|---|---|---|---|---|
| Controlling | Controlling lesen | Summe offener Punkte | 6 Punkte mit Zahl (wie heute) | dazu je Punkt die betroffenen Personen | Rot: 15-Wochen-Grenze, Tage > 12 h · Gelb: übrige |
| Vertrieb | Vertriebsplanung lesen + Bereich VT | offene Halbtage heute | heute + nächste 6 Tage (wie heute) | dazu je Tag die Stände ohne Verkäufer und Tagesänderungen | Rot: heute unbesetzt · Gelb: kommende Tage offen |
| Unterkunft | Mängel / Belegung lesen | offene Mängel | Mängel nach Schwere + offene Auszüge (wie heute) | dazu heutige Ein-/Auszüge, Kontrollen fällig | Rot: schwerer Mangel · Gelb: offene Mängel/Auszüge |
| Personal | Planung lesen | Anreiseliste nicht gedruckt | Planung/Anreise (wie heute) | dazu Anreisen der nächsten Tage | Gelb: nicht gedruckt, Platzhalter |
| Lohn | Lohnübersicht lesen | Abweichungen | Abweichungen nach Auszahlung | dazu betroffene Personen | Gelb: Abweichungen |
| Kassen | Kassenbücher/-prüfung lesen | Differenzen / offene Freigaben | Saldo je Buch (wie heute) | dazu offene Prüfungen, Bewegungen seit letzter Prüfung | Rot: Kassendifferenz · Gelb: Freigabe offen |
| **Spargel** | Prämien / Ernte lesen | offene Freigaben | offene Tage, heute gewogen, ungeklärte Kisten | dazu heute je Feld kg/Kisten | Rot: ungeklärte Kisten · Gelb: Tage nicht freigegeben |
| **Spargelspinnen** | Ernte lesen | Spinnen offline | online/offline, angemeldet, Kisten heute | dazu Liste der Spinnen mit Zustand, Kisten überfällig | Rot: offline während Schicht, Kisten überfällig |
| **Zuckermais** | Prämien lesen | Personen heute | Personen + Prämie heute, Satz hinterlegt | dazu Halle (Qualität heute, Nacharbeit) | Rot: Satz fehlt |
| **Erdbeeren** | Prämien lesen | Personen heute | Personen + Prämie heute je Feld | dazu Bestellungen heute | Rot: Satz je Feld fehlt |
| Vorschläge | Administrator | offene Vorschläge | 3 neueste (wie heute) | alle offenen | Rot: „Etwas geht nicht“ · Gelb: offen |
| Zuletzt geändert | Änderungsprotokoll | Änderungen heute | 6 letzte (wie heute) | 15 letzte mit Details | – |

Erntewirtschafts-Kacheln außerhalb der Saison: zeigen „heute keine Ernte“ (Klein: grau, ohne
Zahl) – Größe bleibt, wie gewählt.

## Technik

- Je Kachel eine Komponente (`components/startseite/<kachel>.tsx`) mit:
  `id`, `titel`, `sichtbar(profile)`, `laden()` (nur die Daten dieser Kachel),
  `zustand(daten)` → Ton + rote Hinweise, `anzeige(daten, groesse)`.
- Daten werden nur für sichtbare Kacheln geladen; für ausgeblendete nur das, was der rote
  Hinweis braucht.
- Speicherung je Nutzer: `profiles.startseite jsonb` (`{"kasse": "G", "protokoll": "aus"}`,
  fehlend = Mittel) – wie `menue_ausgeblendet`, darf jeder selbst ändern.
- „Startseite anpassen“: Knopf oben rechts; im Bearbeiten-Modus hat jede Kachel einen
  Umschalter G / M / K / Aus, die Seite ordnet sich sofort neu. „Zurücksetzen“ = alles Mittel.

## Umsetzung

1. Gerüst: Kachel-Komponenten, Größen, Sortierung, Hinweise, Speicherung, Anpassen-Modus;
   bestehende Kacheln in drei Größen.
2. Erntewirtschaft: Spargel, Spargelspinnen, Zuckermais, Erdbeeren.
Beides zusammen in einem Branch, im Browser je Größe geprüft.
