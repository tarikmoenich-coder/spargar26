# Plan: Vertriebsplanung - Stände, Einsatz-/Wochenplanung, Touren

Stand: 2026-11-25 - V1 (Stände, Touren), V2 (Verfügbarkeit) und V3
(Grundplan) gebaut: Seiten /vertrieb, /vertrieb/touren,
/vertrieb/verfuegbarkeit, /vertrieb/grundplan; Migrationen
migration_2026-11-25c (Stände/Touren, vt_darf()), -25d (Verfügbarkeit),
-25e (Grundplan). V4-V6 offen, ebenso die
Geofences je Stand.
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

### V1 - Stammdaten Stände und Touren  [gebaut, außer Geofence]

- Tabelle `vt_stand`: Nummer, Name, Adresse, Kartenpunkt (`lat`/`lng`) +
  `radius_m`, aktiv, Notiz.
- Tabelle `vt_stand_zeit`: je Stand x Wochentag x Halbtag (VM/NM) eine
  Zeile mit Uhrzeit von/bis - Zeile vorhanden = geöffnet. Uhrzeiten sind
  je Stand UND je Wochentag verschieden (Antwort 1); Eingabe mit
  "Montag auf Di–Sa übertragen" (Sonntag bleibt eigen).
- Tabelle `vt_tour` mit Tagesart **Mo-Sa** oder **Sonntag** (Antwort 3:
  sonntags andere Touren, sonst selten Änderungen): Nummer/Name,
  Standard-Fahrzeug (Fahrzeug-Modul, GPS-Tracker), übliche Abfahrtszeit.
- Tabelle `vt_tour_stand`: Reihenfolge der Stände in der Tour, je Stand
  "fährt mit" oder "nur Ware". Ein Stand gehört je Tagesart zu höchstens
  einer Tour; der letzte "fährt mit"-Stand stellt den Fahrer.
- Ständeliste-Import [gebaut 2026-11-25]: `/vertrieb/import`
  (`lib/staendeImport.ts`) liest den Export des Google-Unternehmensprofils
  (Geschäftscode = Standname, Adresse, Öffnungszeiten je Wochentag).
  Nutzer-Vorgaben: alle Einträge inkl. der als „Duplikat“ markierten (Name
  + „(Duplikat)“), Nummern alphabetisch nach Ort, Halbtag-Grenze 13:00,
  Koordinaten über OpenStreetMap/Nominatim (nur straßengenaue Treffer;
  Probelauf 68 von 72). Wiederholbar: gleicher Name = aktualisieren.
  Mehrere Exporte (je Google-Konto: Mömmel 72, Reitz 25) werden gemeinsam
  eingelesen und durchnummeriert; gleiche Namen bekommen die Straße
  angehängt. Der Google-Export enthält KEINE Koordinaten.
  Ständeliste 2026 (`lib/staendeListe2026.ts`, Nutzer 2026-11-26): eigene
  Standnamen statt Geschäftscode, 92 aktiv (86 aus Google + 6 ohne Profil:
  Alsheim, Flörsheim-Dalsheim, Nackenheim, Osthofen, Wörrstadt = vom
  Kollegen Sohling übernommen; Rüsselsheim Globus = neu 2026), 11 nicht
  gelistete inaktiv. Nummern: aktive zuerst.
- Karte [gebaut 2026-11-25]: `/vertrieb/karte` (`components/StandKarte.tsx`)
  zeigt alle Stände mit Radius-Kreis auf Satellit/Luftbild Hessen/OSM.
  Position von Hand setzen (Punkt ziehen oder in die Karte klicken), Radius
  per Regler; das ist die verbindliche Standposition (Nutzer 2026-11-25).
- [offen] Jeder Stand wird automatisch als Geofence im GPS-System angelegt
  (Grundlage für V6). Noch nicht gebaut - Koordinaten und Radius werden
  aber schon erfasst (Spalte "GPS" in der Ständeliste).
- Rechte: Bereich Vertrieb (wie das Personal) über `vt_darf()`: lesen
  admin/hr/lohnabrechnung/management/pruefer, pflegen admin/hr. Die
  Reihenfolge der Stände einer Tour setzt die RPC `vt_tour_staende_setzen`.

### V2 - Verfügbarkeiten der Verkäufer  [gebaut]

- Je Person und Saison ein Wochenraster Mo-So x VM/NM: "kann" / "kann
  nicht" / offen (`vt_verfuegbarkeit`, je `saison_jahr` statt "gültig ab
  Datum"). Wer in der Saison eingeplant wird, steht in
  `vt_verkaeufer_saison` (mit "max. Halbtage/Woche" und Notiz).
  Unter dem Raster: Angebot (wie viele können) gegen Bedarf (offene Stände)
  je Halbtag.
- Ausnahmen mit Datum (Urlaub, Termin, krank) in `vt_abwesenheit`, ganzer
  Tag oder nur VM/NM. Wirken noch nicht auf den Grundplan (erst V4).
- Führerschein je Person sichtbar (Pflicht für den Fahrer der Tour). Es
  gibt schon `employee_fuehrerschein_kategorien` (bereichsgefiltert) - wird
  wiederverwendet; für Verkäufer aus HSC ist sie noch leer und muss
  gepflegt werden. Zusätzlich lässt sich der Haken `employees.fuehrerschein_b`
  direkt in der Verfügbarkeit setzen, solange kein Führerschein-Dokument da ist.

### V3 - Grundplan (Saison)  [gebaut, ohne Vorschlagsfunktion]

Ein Grundplan je Saison (Antwort 4), Tabelle `vt_grundplan` (Saison,
Stand, Wochentag, Halbtag, Person).

- Planungsansicht Stand x (Mo VM, Mo NM, ... So NM): je Zelle eine Person.
- Sofort sichtbar:
  - unbesetzte Schichten (Lücken), geschlossene Halbtage grau;
  - Konflikte (Prüfung in `lib/vertrieb.ts` `planPruefen`): Person doppelt
    zur selben Zeit (wird beim Einplanen verhindert - die Person wird vom
    anderen Stand verschoben), Person am selben Tag an
    zwei Ständen (erlaubt, aber Hinweis - Antwort 2), Person laut Verfügbarkeit
    nicht da, Fahrer der Tour ohne Führerschein, Fahrer fehlt, obwohl
    Mitfahrer eingeplant sind;
  - je Person die Summe Halbtage/Woche (wichtig für Minijob-Grenze und
    kurzfristige Beschäftigung).
- Ansicht nach Tour gruppiert (Stände der Tour untereinander), damit
  sichtbar ist, wer zusammen im Auto sitzt.
- Ansicht 2026-11-26 überarbeitet: Stammbesetzung je Stand, Auswahl am Feld
  (Tastatur), Verkäufer-Seitenleiste mit Drag & Drop, Frauen gelb / Männer
  blau, Auto am Namen = Führerschein, Fahrer-Stand-Zeilen lila mit Auto,
  Stände per Griff zwischen Touren verschieben (gleiche RPC wie
  /vertrieb/touren) - die weitere Planung läuft im Grundplan.
- Optional später: Vorschlagsfunktion, die Lücken aus den Verfügbarkeiten
  füllt. [offen] Gebaut ist nur der Helfer "Montag → Di–Sa" (leere Felder
  mit der Montagsbesetzung füllen) und ein Ausdruck des Grundplans.

### V4 - Wochenplan und Ausdrucke  [gebaut 2026-11-26, ohne Verkäufer-Wochenzettel]

Nutzer-Vorgaben 2026-11-26:
- **Feiertage = Sonntag**: Öffnungszeiten, Touren (Sonntagstouren) UND
  Besetzung kommen vom Sonntag des Grundplans; Änderungen nur für den Tag.
- **Ausdrucke für einfache, oft nicht muttersprachliche Verkäufer**: Deutsch,
  sehr wenig Text, große Schrift, Symbole. Jeder muss schnell finden: wo
  verkaufe ich, wer ist Fahrer, welches Auto (Kennzeichen aus dem
  Fahrzeug-Modul, `vt_tour.fahrzeug_id`), wer sitzt mit im Auto, wann steigt
  wer wo aus.
- **Gesamt-Tagesplan aller Touren auf DIN A3** (Hauptausdruck, liegt
  morgens aus). Zusätzlich **nur bei Änderungen ein DIN-A4-Zettel je
  betroffener Tour** - Problem heute: Fahrer wissen nichts von einem
  Planwechsel und fahren ohne Vertretung los.

Gebaut (Migration 2026-11-26c, `lib/tagesplan.ts`):
- `/vertrieb/woche`: Kalenderwoche = Grundplan + Tagesänderungen
  (`vt_tag_aenderung`: andere Person / "fehlt" / Stand zu), Abwesenheiten
  rot, Feiertage-Liste mit Vorschlag (Hessen + Fronleichnam).
- `/vertrieb/druck/tag`: A3-Tagesplan aller Touren (Auto/Kennzeichen,
  Fahrer, Halte 1-2-3, wer wo, "nur Ware", "NEU" = anders als Grundplan),
  "Ohne Auto"-Liste, Namensverzeichnis "Wer steht wo?". Auto/Abfahrt nur
  für den Tag (`vt_tour_tag`). Drucken speichert den Stand (`vt_druck`).
- `/vertrieb/druck/aenderung`: A4 je geänderter Tour seit dem letzten
  Ausdruck ("ACHTUNG! HEUTE ANDERS").
- Eröffnung/Schluss je Stand und Saison (`vt_stand_saison`, Migration
  2026-11-26d, Nutzer 2026-11-26): im Stand-Formular "geöffnet ab/bis";
  vorher/nachher ist der Stand in Woche und Tagesplan zu und fällt aus
  seiner Tour (Reihenfolge und Fahrer rechnen sich neu). Tagesplan-Kacheln
  nach Abfahrt sortiert, Standname im schwarzen Kasten.
- Offen: Verkäufer-Wochenzettel je Person, Standbesetzung je Woche als
  Aushang (mit Stufe 5 "Wochenstundenzettel" zusammen bauen).

- Konkrete Kalenderwoche entsteht aus dem Grundplan; Änderungen nur für
  diese Woche (Krankheit, Tausch, Feiertag, Stand geschlossen).
- Ausdrucke:
  - **Verkäufer-Wochenzettel**: wo und wann, mit wem im Auto, Abfahrt/
    Abholung, wer fährt (das ist zugleich der "Wochenstundenzettel" aus
    der Anforderungsliste);
  - **Tourzettel je Tag**: Fahrzeug, Fahrer, Reihenfolge, wer wo
    abgesetzt/abgeholt wird, "nur Ware"-Stände;
  - **Standbesetzung je Woche** (Aushang/Übersicht).

### V5 - Anschluss Stunden und Lohn  [offen]

- Stundenerfassung wird aus dem Wochenplan **vorbelegt** (Soll-Stunden je
  Halbtag); erfasst wird nur noch die Abweichung.
- Fahrerlohn an Fahrtagen (bisher zurückgestellt) ergibt sich aus der Tour:
  wer an dem Tag gefahren ist.
- Der Stand wird je Stunden-Eintrag mitgeführt (Auswertung "Stunden/
  Kosten je Stand").

### V6 - GPS-Controlling  [offen]

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
  Vorläufig im Code entschieden (bitte bestätigen): Fahrer ist die
  VM-Person am letzten mitfahrenden Stand; wechselt dort die Person zwischen
  VM und NM, meldet der Grundplan einen Konflikt ("der Fahrer muss den
  ganzen Tag bleiben", `lib/vertrieb.ts` fahrerAmTag/planPruefen).

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
