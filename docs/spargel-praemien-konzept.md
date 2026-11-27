# Spargelprämien – schlankes Konzept

Stand 2026-11-28, Antworten des Nutzers eingearbeitet. Grundlage: `Spargelprämien_2026.xlsx`
(Saison 2026: 7.489 Tageszeilen, 227 Personen, 55 Felder, 23.03.–21.06.). Ziel: die Excel
ablösen; das Anlegen von Kategorien bleibt, die Kategorie aus dem Import wird übernommen oder
überschrieben (je Tag/Feld oder je Person).

## So rechnet die Excel heute

Eine Zeile = Person × Tag × Feld. Der Import (Tagesauswertung des alten
Erntewirtschafts-Programms, täglich untereinander eingefügt) sind die Spalten C–O von
„1 Rohdaten Flächen“: Pers.-Nr., Datum, Nachname, Vorname, kg, Preis/kg, Ges.Std.Lohn, Std.,
Kisten, Feld, Produkt, Akkord, Akkord-Stu. Alle weiteren Spalten sind Formeln.

**Die Import-Kategorie steckt im Preis/kg** (0,60 € = Kategorie 9, 0,40 € = Kategorie 13). Die
Spalte „Kategorie“ ist die wirksame Kategorie: 2026 in 3.469 Zeilen übernommen, in 3.995 Zeilen
geändert. Geändert wurde je Tag (oft für alle Felder gleich) und an 391 von 2.341 Feld-Tagen
**je Person** – fast immer bekommt, wer mehr kg/h schafft, die höhere Kategorie.

| Schritt | Formel | Beispiel (Kat. 9, 224,6 kg, 18 Std.) |
|---|---|---|
| Preis je kg | aus der Kategorien-Tabelle; heute 1,05 € − 0,05 € × Kategorie (Kat. 1 = 1,00 €, Kat. 15 = 0,30 €, halbe Stufen) | 0,60 €/kg |
| Akkordwert | kg × Preis je kg | 134,76 € |
| Lohnanspruch | Std. × Mindestlohn (13,90 €) | 250,20 € |
| **Prämie** | Akkordwert − Lohnanspruch, **nur wenn positiv**, je Zeile | 0 € |
| Fehlbetrag (Info) | Lohnanspruch − Akkordwert, wenn negativ – wird nicht verrechnet | 115,44 € |

- „Feldstufen“: je Feld eine Standard-Kategorie (z.B. Graf = 7). Die Spalte „Unterschied“ zeigt,
  ob die Kategorie der Zeile davon abweicht – das war 2026 in rund 5.250 Zeilen der Fall.
- Tagesliste („Prämien“, je Datum): kg, Std., kg/h, Kategorie, €/kg, Akkordwert, Lohn, Prämie.
  Die Werte 0,25 („Grenze“) und 1,1 („malo/super“) werden **nicht** übernommen (Nutzer).
- Monatssummen je Person (April/Mai/Juni) und Zwischenstände („bis 21.05.“, „bis 10.06.“) als
  kopierte Blätter.

## Konzept

### 1. Kategorien (bleibt wie gewohnt)
Einstellungen → Spargel-Kategorien, je Saisonjahr: **Kategorie** (Zahl, halbe Stufen erlaubt) →
**€ je kg**. Neue Kategorie anlegen, Preis ändern, „gültig ab“ wie bei den anderen Sätzen.
Daneben angezeigt: ab wie viel kg/h sich die Kategorie lohnt (Mindestlohn ÷ €/kg). Der
Mindestlohn kommt aus den vorhandenen Sätzen je Saisonjahr. Eine Kategorie 0 gibt es nicht.
Recht: neues Sonderrecht **„Spargel-Kategorien festlegen“** – nur die Rolle Geschäftsführer
(der Administrator hat ohnehin alles).

Optional je Feld eine **Standard-Kategorie** (wie heute die Feldstufen) – nur als Vorschlag.

### 2. Datenquelle: die neue Ernteerfassung (kein laufender Import)
Nutzer-Vorgabe 2026-11-28: kein Import des alten Programms, die Daten kommen aus der Ernteerfassung.
- **kg je Person, Tag und Feld**: gewogene Kisten (`ernte_kiste_zyklus`, Status gewogen, Netto-kg,
  Feld aus GPS, Person aus der Schicht).
- **Prämienstunden**: aus den Maschinendaten (Abschnitt „Prämienstunden“ unten). Die
  Stundenerfassung (`work_entries`) dient nur behelfsweise, wenn Maschinendaten fehlen.
  (Nutzer-Vorgabe 2026-11-28; der Lohn selbst bleibt beim Stundenzettel.)
- **Gruppenmaschinen** (Grünspargel, `max_personen > 1`, in der App vorgesehen): Prämie je
  Maschine und Tag, **gleichmäßig auf alle angemeldeten Personen verteilt**.
- **Vorgeschlagene Kategorie**: Standard-Kategorie des Feldes = die **erste Kategorie des Feldes
  in den Rohdaten 2026**; ab dem Folgetag jeweils die (ggf. geänderte) Kategorie des Vortags.

### 2a. Daten 2026 einmalig übernehmen
„1 Rohdaten Flächen“ (7.489 Zeilen) einmalig als **Saison 2026** übernehmen: Person, Datum, Feld,
kg, Std., Kisten, die damals wirksame Kategorie (Spalte P) und die Import-Kategorie (aus Preis/kg).
Gruppen-Zeilen als Gruppe. Zweck: Vorjahresvergleich je Feld/Person, Startwerte für die
Standard-Kategorien je Feld, Prüfung der neuen Berechnung (muss die Excel-Summen ergeben).
**Kein Einfluss auf den Lohn 2026** (ist über die Excel gelaufen).

### 2b. Felder 2026
Zuordnung Excel-Feldname → Feld in der App: `supabase/spargel/feld_zuordnung_2026.csv`
(vom Nutzer geklärt 2026-11-28): 46 Felder zugeordnet, 9 entfallen (gibt es nicht mehr bzw.
unbekannt) – deren Zeilen werden mit dem alten Feldnamen ohne App-Feld übernommen.
„Gruenspargel Klos 1“ steht für Klos Groß 2019 + 2021 und wird Klos Groß 2019 zugeordnet.

### 3. Kategorie übernehmen oder tageweise überschreiben
Seite Prämien → Spargel, Ansicht **je Tag**: alle Felder des Tages mit ihrer Import-Kategorie.
- Je **Tag** eine Kategorie für alle Felder setzen, je **Feld und Tag**, oder je **Person**
  (kommt oft vor: schnellere Personen bekommen eine höhere Kategorie). Die Zeilen sind dafür nach
  kg/h sortierbar.
- Wirksam ist: Person → sonst Feld/Tag → sonst Tag (alle Felder) → sonst Vorschlag (Vortag /
  Standard des Feldes).
- Überschriebene Werte sind markiert (wie „Unterschied“), mit Vorschlag daneben; jede
  Änderung steht im Änderungsprotokoll. Recht: „Spargel-Kategorien festlegen“ (nur
  Geschäftsführer). Andere sehen die Kategorien nur.

### 4. Berechnung (Datenbank-Sicht `spargel_praemie_tag`)
Wie die Excel, je Person und Tag (siehe unten): Preis je kg aus der wirksamen Kategorie,
Akkordwert, Lohnanspruch, Prämie = max(0, Akkordwert − Lohn), Fehlbetrag zur Info. Stornieren wie bei
Zuckermais/Erdbeeren.

### 5. Ausgaben
- **Tagesliste** (druckbar, ersetzt das Blatt „Prämien“).
- **Unter der Prämienschwelle** (wie beim Zuckermais): Liste je Person, wie weit sie unter der
  Schwelle lag (Fehlbetrag), je Tag und aufsummiert – nur zur Information, nicht verrechnet.
- **Übersicht je Person**: Saison, April/Mai/Juni, je Tag – ersetzt „Summen_Prämien“ und die
  kopierten Zwischenstände (jeder Stand ist per Datumsfilter jederzeit abrufbar).
- **Lohn**: Saisonsumme fließt automatisch in `spargel_praemie` der Lohnübersicht (Spalte gibt es
  schon), wie bei Zuckermais.

## Prämienstunden aus den Maschinendaten

Nutzer-Vorgabe 2026-11-28: **Anmeldung an der Maschine bis letzte Bewegung der Maschine des
Tages; Standzeiten über 30 Minuten zwischen zwei Bewegungen sind Pausen** und zählen nicht.

### Begriffe
- **Anmeldung** = Ausweis-Scan an der Maschine (`ernte_schicht.beginn`).
- **Aktivität** = eine Minute, in der die Maschine sich bewegt hat **oder** eine Kiste gescannt
  wurde (ein Kisten-Scan beweist Arbeit, auch ohne messbare Bewegung).
- **Bewegung** (robust gegen GPS-Zittern, das bei 2,5–5 m liegt): je Minute die mittlere Position
  (Median) aus `ernte_position`; die Minute zählt als Bewegung, wenn sie mindestens
  `bewegung_min_meter` (Start: 3 m) von der Median-Position zwei Minuten vorher entfernt ist.
  Punkte mit schlechtem Empfang (`hdop` > Grenze) zählen nicht. Eine erntende Spinne legt in zwei
  Minuten deutlich mehr als 3 m zurück, Zittern im Stand im Mittel nicht.
- **Standzeit** = Zeit zwischen zwei Aktivitäten. **> 30 min** (`pause_ab_min`) = Pause, wird ganz
  abgezogen; ≤ 30 min zählt als Arbeitszeit.

### Formel je Schicht
Prämienstunden = (letzte Aktivität − Anmeldung) − Summe der Pausen.

### Sonderfälle (alle Regeln fest, nichts bleibt offen; Regeln 1–3 vom Nutzer bestätigt 2026-11-28)
| Fall | Regel |
|---|---|
| Zwischen Anmeldung und erster Aktivität > 30 min | gilt als Pause (wie zwischen zwei Bewegungen) |
| Bewegung nach dem Ende der Schicht (nächste Person meldet sich an, Tagesende) | zählt nicht – das Schichtfenster begrenzt |
| Rangieren am Abend: Bewegungsblock nach der letzten Kiste, durch > 30 min Pause getrennt | zählt nicht (sonst verlängert z.B. ein Umsetzen am Abend die Stunden) |
| Mehrere Schichten einer Person am Tag (Maschinenwechsel) | Stunden je Schicht, dann je Person und Tag addiert |
| Datenlücke (Box sendet nichts, auch kein Heartbeat) > 30 min | **nicht** automatisch Pause/Arbeit: Tag wird „zu prüfen“ markiert |
| Box sendet Heartbeat, aber keine Position | gilt als Standzeit (Box lebt, Maschine steht) |
| Anmeldung, aber keine Aktivität | 0 Prämienstunden, Tag „zu prüfen“ |
| Kisten ohne Anmeldung (Ausweis vergessen) | bleiben „ungeklärt“ (wie heute), keine Prämie, bis zugeordnet |
| Keine Maschinendaten für den Tag | behelfsweise Stunden aus der Stundenerfassung, sichtbar markiert |
| Prämienstunden weichen stark vom Stundenzettel ab (> `abweichung_max_h`, Start 1,5 h) | „zu prüfen“ |
| Tag | Kalendertag Europe/Berlin der Anmeldung; minutengenau, keine Rundung |

### Gruppenmaschinen (Grünspargel)
Jede angemeldete Person bekommt ihre Prämienstunden wie oben (ab ihrer Anmeldung, Pausen der
Maschine). Prämie der Maschine am Tag = Akkordwert aller Kisten der Maschine (kg × €/kg) − Summe
der Lohnansprüche aller Personen; wenn positiv, **gleichmäßig** auf die Personen verteilt.

### Prüfen und Freigeben
- Je Tag eine Liste: Person, Anmeldung, letzte Aktivität, Pausen, Prämienstunden, Stundenzettel,
  Abweichung, Markierung „zu prüfen“ mit Grund.
- Markierte Zeilen muss die Geschäftsführung klären: Vorschlag übernehmen, Stundenzettel
  übernehmen oder Stunden von Hand setzen (mit Begründung, im Änderungsprotokoll).
- **Freigabe je Tag**: Stunden, Kategorie und Prämie werden festgeschrieben (Schnappschuss) –
  spätere Datenänderungen oder das Löschen alter GPS-Daten (365 Tage) ändern nichts mehr. Nur
  freigegebene Tage fließen in den Lohn.

### Voraussetzungen / Kalibrierung vor der Saison
1. Prüfen, ob die Box im Stand regelmäßig Positionen oder Heartbeats schickt (sonst sind Stehen
   und Funkloch nicht zu unterscheiden).
2. `bewegung_min_meter` und `hdop`-Grenze mit Pilotdaten einstellen: ein Tag mit bekannten
   Pausen (handschriftlich notiert) muss genau diese Pausen ergeben.
3. Alle Schwellen in `ernte_konfig`, ohne Programmänderung anpassbar.

## Prämie je Person und Tag
Gerechnet wird je Person und Tag: Akkordwert = Summe über die Felder (kg × €/kg der jeweiligen Kategorie),
Lohn = Tagesstunden × Mindestlohn, Prämie = Differenz, wenn positiv. 2026 hat niemand am selben
Tag auf mehreren Feldern geerntet (6.905 Personen-Tage) – das Ergebnis ist damit identisch zur
Excel (Prüfsumme Saison 2026: 49.541,50 € Prämie über alle Personen-Zeilen).

## Antworten (Nutzer, 2026-11-28)
1. Gruppen-Zeilen: keine Verteilung auf Personen, keine Prämie.
2. Negative Tage werden nicht verrechnet; Fehlbetrag nur als Liste (wie Zuckermais), aufsummiert.
3. 0,25 und 1,1 komplett ignorieren.
4. Kategorie 0 soll es nicht geben (in der Excel: 10 Zeilen am 18.04. ohne Feld).
5. Import = Spalten C–O, Tagesauswertung des alten Erntewirtschafts-Programms. Kein laufender
   Import – Datenquelle ist die neue Ernteerfassung; nur 2026 wird einmalig übernommen.
6. Kategorien festlegen/überschreiben: nur Rolle Geschäftsführer.
