# Spargelprämien – schlankes Konzept

Stand 2026-11-28, Antworten des Nutzers eingearbeitet. Grundlage: `Spargelprämien_2026.xlsx`
(Saison 2026: 7.489 Tageszeilen, 227 Personen, 56 Felder, 23.03.–21.06.). Ziel: die Excel
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
- **Stunden**: aus der Stundenerfassung (`work_entries`) – laut Erntewirtschafts-Plan bleibt der
  Stundenzettel führend, die Maschinenzeit ist nur Kontrollgröße.
- **Gruppenmaschinen** (Grünspargel, mehrere Personen): keine Prämie, nur Statistik.
- **Vorgeschlagene Kategorie** (ersetzt die Import-Kategorie): Standard-Kategorie des Feldes; ab
  dem zweiten Erntetag die Kategorie des Feldes vom Vortag.

### 2a. Daten 2026 einmalig übernehmen
„1 Rohdaten Flächen“ (7.489 Zeilen) einmalig als **Saison 2026** übernehmen: Person, Datum, Feld,
kg, Std., Kisten, die damals wirksame Kategorie (Spalte P) und die Import-Kategorie (aus Preis/kg).
Gruppen-Zeilen als Gruppe. Zweck: Vorjahresvergleich je Feld/Person, Startwerte für die
Standard-Kategorien je Feld, Prüfung der neuen Berechnung (muss die Excel-Summen ergeben).
**Kein Einfluss auf den Lohn 2026** (ist über die Excel gelaufen).

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

## Prämie je Person und Tag
Die Stundenerfassung kennt Stunden je Person und Tag (nicht je Feld). Gerechnet wird daher je
Person und Tag: Akkordwert = Summe über die Felder (kg × €/kg der jeweiligen Kategorie),
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
