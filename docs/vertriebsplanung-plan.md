# Plan: Vertriebsplanung - Stände, Einsatz-/Wochenplanung, Touren

Stand: 2026-11-25 - Entwurf zur Freigabe. Noch nichts davon gebaut.
Voraussetzung (erledigt): Vertriebs-Personal in spargar26
(docs/zwei-personalstaemme-plan.md, Stufen 0-4).

## Ziel (Nutzer-Vorgabe 2026-11-25)

"Wer verkauft wann und wo, und welche Stände sitzen zusammen im Auto."

- **95 Stände**, in der Saison fest.
- **Fester Grundplan:** je Stand Verkaufstage Montag bis Sonntag, je Tag
  **Vormittag und Nachmittag** - also bis zu 14 Halbtags-Schichten je Stand
  und Woche, jede kann von einer anderen Person besetzt sein.
- **Flickenteppich aus Verfügbarkeiten:** Verkäufer melden, an welchen
  Tagen/Halbtagen sie können; daraus wird eine durchgehende Standbesetzung
  (Mo bis z.T. So) gebaut.
- **Touren sind fest:** z.B. Tour 1 = Stand 1-3 (Darmstadt, Langen,
  Eschborn). Der Verkäufer des LETZTEN Stands ist Fahrer (Führerschein
  Pflicht), setzt die anderen mit der Tagesware ab, hilft beim Ausladen und
  sammelt nach dem Verkauf Personen, Leergut und Restware wieder ein.
  Variante: nur Ware wird gebracht, weil der Verkäufer vor Ort wohnt und
  direkt zum Stand kommt.
- **Touren docken ans GPS-Modul an:** Auto mit Tracker je Tour -> Fahr-
  zeiten zwischen den Ständen, Ankunft/Abfahrt, Controlling.
- **Ausgabe an die Verkäufer:** vorerst nur als Ausdruck.

## Bausteine

### V1 - Stammdaten Stände und Touren

- Tabelle `vt_stand`: Nummer, Name, Ort/Adresse, Kartenpunkt (+ Radius),
  aktiv, Notiz.
- Tabelle `vt_stand_zeit`: je Stand x Wochentag x Halbtag (VM/NM) eine
  Zeile mit Uhrzeit von/bis - Zeile vorhanden = geöffnet. Uhrzeiten sind
  je Stand UND je Wochentag verschieden (Antwort 1); Eingabe mit
  "auf alle Werktage übertragen".
- Tabelle `vt_tour` mit Tagesart **Mo-Sa** oder **Sonntag** (Antwort 3:
  sonntags andere Touren, sonst selten Änderungen): Nummer/Name,
  Standard-Fahrzeug (Fahrzeug-Modul, GPS-Tracker), übliche Abfahrtszeit.
- Tabelle `vt_tour_stand`: Reihenfolge der Stände in der Tour, je Stand
  "fährt mit" oder "nur Ware". Ein Stand gehört je Tagesart zu höchstens
  einer Tour; der letzte "fährt mit"-Stand stellt den Fahrer.
- Ständeliste-Import kommt später (Antwort 5); V1 bringt eine Eingabe-
  Maske, der Import wird nachgereicht, sobald die Liste da ist.
- Jeder Stand wird automatisch als Geofence im GPS-System angelegt
  (Grundlage für V6).
- Rechte: Bereich Vertrieb (wie das Personal), Pflege durch die Vertriebs-
  Planer.

### V2 - Verfügbarkeiten der Verkäufer

- Je Person ein Wochenraster Mo-So x VM/NM: "kann" / "kann nicht" (+
  Notiz), gültig ab Datum - die Verkäufer melden das einmal zur Saison.
- Ausnahmen mit Datum (Urlaub, Termin, krank).
- Führerschein je Person sichtbar (Pflicht für den Fahrer der Tour). Es
  gibt schon `employee_fuehrerschein_kategorien` (bereichsgefiltert) - wird
  wiederverwendet; für Verkäufer aus HSC ist sie noch leer und muss
  gepflegt werden.

### V3 - Grundplan (Saison)

Ein Grundplan je Saison (Antwort 4), Tabelle `vt_grundplan` (Saison,
Stand, Wochentag, Halbtag, Person).

- Planungsansicht Stand x (Mo VM, Mo NM, ... So NM): je Zelle eine Person.
- Sofort sichtbar:
  - unbesetzte Schichten (Lücken), geschlossene Halbtage grau;
  - Konflikte: Person doppelt zur selben Zeit, Person am selben Tag an
    zwei Ständen (erlaubt, aber Hinweis - Antwort 2), Person laut Verfügbarkeit
    nicht da, Fahrer der Tour ohne Führerschein, Fahrer fehlt, obwohl
    Mitfahrer eingeplant sind;
  - je Person die Summe Halbtage/Woche (wichtig für Minijob-Grenze und
    kurzfristige Beschäftigung).
- Ansicht nach Tour gruppiert (Stände der Tour untereinander), damit
  sichtbar ist, wer zusammen im Auto sitzt.
- Optional später: Vorschlagsfunktion, die Lücken aus den Verfügbarkeiten
  füllt.

### V4 - Wochenplan und Ausdrucke

- Konkrete Kalenderwoche entsteht aus dem Grundplan; Änderungen nur für
  diese Woche (Krankheit, Tausch, Feiertag, Stand geschlossen).
- Ausdrucke:
  - **Verkäufer-Wochenzettel**: wo und wann, mit wem im Auto, Abfahrt/
    Abholung, wer fährt (das ist zugleich der "Wochenstundenzettel" aus
    der Anforderungsliste);
  - **Tourzettel je Tag**: Fahrzeug, Fahrer, Reihenfolge, wer wo
    abgesetzt/abgeholt wird, "nur Ware"-Stände;
  - **Standbesetzung je Woche** (Aushang/Übersicht).

### V5 - Anschluss Stunden und Lohn

- Stundenerfassung wird aus dem Wochenplan **vorbelegt** (Soll-Stunden je
  Halbtag); erfasst wird nur noch die Abweichung.
- Fahrerlohn an Fahrtagen (bisher zurückgestellt) ergibt sich aus der Tour:
  wer an dem Tag gefahren ist.
- Der Stand wird je Stunden-Eintrag mitgeführt (Auswertung "Stunden/
  Kosten je Stand").

### V6 - GPS-Controlling

- Ankunft/Abfahrt je Stand aus den Geofence-Ereignissen des Tour-Autos;
  Soll (Plan) gegen Ist.
- Fahrzeiten Stand-zu-Stand, Gesamtdauer der Tour, Wartezeiten,
  Umwege; "wie lange brauchen sie noch" (Live) für den laufenden Tag.
- Auswertungen über die Saison (z.B. Tour-Dauer je Wochentag, Verspätungen).

## Reihenfolge

V1 -> V2 -> V3 -> V4 sind der Kern für den Saisonstart (1. April 2027).
V5 und V6 bauen darauf auf und können während der Saison folgen.
Jeder Baustein eigener Branch-Stand, Migration vorab auf main zum Abholen,
Code nach "kann auf main".

## Antworten des Nutzers (2026-11-25)

1. Uhrzeiten VM/NM in der Regel fest, aber je Stand und je Wochentag
   verschieden.
2. Standwechsel am Tag theoretisch möglich, praktisch nein -> nur Hinweis.
3. Sonntags andere Touren, sonst ändern sich Touren selten.
4. Ein Grundplan für die ganze Saison.
5. Ständeliste existiert, Import später.

## Noch offen

- Wenn an einem Stand Vormittag und Nachmittag verschiedene Personen
  stehen: wer fährt - die VM-Person bringt, die NM-Person holt ab?

## Ursprüngliche Fragen

1. Haben Vormittag/Nachmittag feste Uhrzeiten (für alle Stände gleich oder
   je Stand)? - nötig für die Stunden-Vorbelegung und das GPS-Soll.
2. Arbeitet eine Person an einem Tag ggf. vormittags an Stand A und
   nachmittags an Stand B - oder immer am selben Stand?
3. Sind die Touren an allen Wochentagen gleich, oder ändern sie sich (z.B.
   sonntags weniger Stände/andere Zusammenstellung)?
4. Ein Grundplan für die ganze Saison, oder Phasen (z.B. Spargel- vs.
   Erdbeerzeit mit anderen Öffnungstagen)?
5. Gibt es die Liste der 95 Stände schon (Excel) - mit Adresse bzw.
   Koordinaten, Tour-Zuordnung, Öffnungstagen?
