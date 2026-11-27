# Spargelprämien – schlankes Konzept

Stand 2026-11-28. Grundlage: `Spargelprämien_2026.xlsx` (Saison 2026: 7.489 Tageszeilen,
227 Personen, 56 Felder, 23.03.–21.06.). Ziel: die Excel 1:1 ablösen, das Anlegen von
Kategorien bleibt, Kategorien aus dem Import werden übernommen oder tageweise überschrieben.

## So rechnet die Excel heute

Eine Zeile = Person × Tag × Feld (aus dem Import: Pers.-Nr., Datum, kg, Std., Kisten, Feld,
Kategorie).

| Schritt | Formel | Beispiel (Kat. 9, 224,6 kg, 18 Std.) |
|---|---|---|
| Preis je kg | aus der Kategorien-Tabelle; heute 1,05 € − 0,05 € × Kategorie (Kat. 1 = 1,00 €, Kat. 15 = 0,30 €, halbe Stufen) | 0,60 €/kg |
| Akkordwert | kg × Preis je kg | 134,76 € |
| Lohnanspruch | Std. × Mindestlohn (13,90 €) | 250,20 € |
| **Prämie** | Akkordwert − Lohnanspruch, **nur wenn positiv**, je Zeile | 0 € |
| Leistung (Info) | Summe der Differenzen inkl. negativer Tage | −115,44 € |

- „Feldstufen“: je Feld eine Standard-Kategorie (z.B. Graf = 7). Die Spalte „Unterschied“ zeigt,
  ob die Kategorie der Zeile davon abweicht – das war 2026 in rund 5.250 Zeilen der Fall.
- Tagesliste („Prämien“, je Datum): kg, Std., kg/h, Kategorie, €/kg, Akkordwert, Lohn, Prämie,
  Hinweis „malo“ (Akkordwert unter Lohn) / „super“ (über 110 % des Lohns).
- Monatssummen je Person (April/Mai/Juni) und Zwischenstände („bis 21.05.“, „bis 10.06.“) als
  kopierte Blätter.

## Konzept

### 1. Kategorien (bleibt wie gewohnt)
Einstellungen → Spargel-Kategorien, je Saisonjahr: **Kategorie** (Zahl, halbe Stufen erlaubt) →
**€ je kg**. Neue Kategorie anlegen, Preis ändern, „gültig ab“ wie bei den anderen Sätzen.
Daneben angezeigt: ab wie viel kg/h sich die Kategorie lohnt (Mindestlohn ÷ €/kg). Der
Mindestlohn kommt aus den vorhandenen Sätzen je Saisonjahr. Recht: Sätze & Grundeinstellungen.

Optional je Feld eine **Standard-Kategorie** (wie heute die Feldstufen) – nur als Vorschlag.

### 2. Tagesdaten
Tabelle `spargel_rohdaten`: Person, Datum, Feld, kg, Stunden, Kisten, **Kategorie aus dem
Import**, Herkunft der Zeile (Import / eigene Waage).
- **Jetzt:** Import der bisherigen Datei (gleiche Spalten wie „1 Rohdaten Flächen“), Personen
  über die Personalnummer, Felder über den Namen (einmalige Zuordnung Feldname → Feld).
- **Später:** dieselbe Tabelle wird automatisch aus den Spinnen-/Waagedaten gefüllt
  (Kisten je Person, Tag, Feld). Die Prämienberechnung bleibt gleich.

### 3. Kategorie übernehmen oder tageweise überschreiben
Seite Prämien → Spargel, Ansicht **je Tag**: alle Felder des Tages mit ihrer Import-Kategorie.
- Je **Feld und Tag** eine Kategorie setzen → gilt für alle Zeilen dieses Feldes an diesem Tag.
- Im Ausnahmefall je **einzelner Zeile** (Person).
- Wirksam ist: Einzelzeile → sonst Feld/Tag → sonst Import → sonst Standard des Feldes.
- Überschriebene Werte sind markiert (wie „Unterschied“), mit Import-Wert daneben; jede
  Änderung steht im Änderungsprotokoll. Recht: Prämien erfassen (schreiben).

### 4. Berechnung (Datenbank-Sicht `spargel_praemie_tag`)
Genau wie die Excel: Preis je kg aus der wirksamen Kategorie, Akkordwert, Lohnanspruch,
Prämie = max(0, Akkordwert − Lohn) je Zeile, Differenz zur Info. Stornieren wie bei
Zuckermais/Erdbeeren.

### 5. Ausgaben
- **Tagesliste** (druckbar, ersetzt das Blatt „Prämien“) mit „malo“/„super“-Hinweis.
- **Übersicht je Person**: Saison, April/Mai/Juni, je Tag – ersetzt „Summen_Prämien“ und die
  kopierten Zwischenstände (jeder Stand ist per Datumsfilter jederzeit abrufbar).
- **Lohn**: Saisonsumme fließt automatisch in `spargel_praemie` der Lohnübersicht (Spalte gibt es
  schon), wie bei Zuckermais.

## Offene Fragen an den Vater
1. **Gruppen-Zeilen** („Gruppe 1–7“, 584 Zeilen): Wie wird deren Prämie auf die Personen verteilt?
2. **Negative Tage**: Bleibt es dabei, dass ein schwacher Tag nicht mit einem guten verrechnet
   wird (Prämie je Zeile ≥ 0)?
3. **Grenze 0,25 / 1,1**: Nur Hinweis in der Tagesliste, oder hat das Auswirkung auf die Zahlung?
4. **Kategorie 0** (10 Zeilen): bedeutet „keine Prämie“?
5. **Import-Datei**: Aus welchem Programm kommt sie („Bodo Berechnung“)? Bitte eine Beispiel-Datei.
   Werden die Spalten „Preis/kg“, „Ges.Std.Lohn“, „Akkord“, „Akkord-Stu“ noch gebraucht?
6. Wer darf Kategorien überschreiben – nur er, oder auch die Erntewirtschaft?
