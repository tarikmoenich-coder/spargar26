# Spargar-App (Mömmel Agrar)

Web-Anwendung als Ersatz für "Spargar 2026 - Mömmel Agrar.xlsm". Mehrere
Nutzer können gleichzeitig arbeiten, Änderungen werden live synchronisiert
(Supabase Realtime).

## Umfang dieser Version (MVP)

Enthalten:
- Navigation, Unterreiter (Personal/Lohn) und die wichtigste Werkzeugleiste
  je Seite (Datum, Filter, Suche) bleiben beim Scrollen durch lange Listen
  sichtbar (fixiert/"sticky")
- UI-Sprache je Nutzer umschaltbar (Auswahl oben rechts in der Navigation,
  gespeichert in `profiles.sprache`) - betrifft NUR die Bedienoberfläche,
  keine Dokumente/Formulare/Druckansichten (die bleiben in ihrer
  jeweiligen Sprache, z.B. Deutsch/Rumänisch bei den SV-Formularen).
  Schrittweise ausgerollt (Stand 2026-08-09): bisher Stundenerfassung,
  Suche und Arbeitskleidung ins Kroatische übersetzt, weitere Seiten
  folgen bei Bedarf.
  Leichtgewichtige eigene Lösung ohne Framework (`lib/i18n.ts`, flaches
  Wörterbuch je Sprache) - kein Aufwand für ungenutzte Sprachen/Seiten
- Rollenabhängiges Dashboard ("Start", auch neue Startseite nach dem
  Login): kompakte, klickbare Kacheln mit dem, was gerade Aufmerksamkeit
  braucht - hr sieht offene Anreiseliste-Punkte und die
  15-Wochen-Kontrolle, kasse den aktuellen Kassensaldo, Stand der letzten
  Kassenprüfung und Bewegungen seit der letzten Prüfung, lohnabrechnung
  Abweichungen bei Auszahlungen und die Anzahl aktiver Personen, pruefer
  offene Kassenprüfungs-Freigaben und die letzten Audit-Log-Einträge,
  management eine kompakte Fassung der Controlling-Seite. admin sieht alle
  Kacheln kombiniert. zeiterfassung hat kein eigenes Dashboard und landet
  weiterhin direkt auf der Stundenerfassung, da das schon ihr einziger
  Arbeitsbereich ist
- Personalstamm (anlegen/bearbeiten/deaktivieren, keine Löschung), inkl.
  Abrechnungsart (pauschal/Lohnsteuerklasse 1/sozialversicherungspflichtig)
  und automatisch berechnetem "Aktiv seit" (erster Arbeitstag mit Stunden > 0)
- Tägliche Stundenerfassung mit Live-Sync zwischen mehreren Nutzern, nach
  Arbeitsgruppen (z.B. Sortierer, Träger) gruppiert mit Sprungleiste und
  Suchfeld nach Name/Personalnummer (Stand 2026-08-14, wie im
  Personalstamm/der Lohnübersicht - wirkt vor der Gruppierung, Sprungleiste
  und Gruppen-Summen zeigen dadurch automatisch nur die gefundenen
  Personen) und
  Druckansicht pro Gruppe ("Gruppenstundenzettel"; die Trennlinien aller
  Papierformulare sind im Druck bewusst schwarz und kräftiger als am
  Bildschirm, Stand 2026-08-11 - die Zettel werden handschriftlich
  ausgefüllt und anschließend kopiert, ein helles Grau verschwindet dabei).
  Bugfix 2026-08-20: nach mehrfachem Neuladen zeigte ein Nutzer weiterhin
  einen veralteten Stundenwert (im Protokoll stand bereits der korrekte
  Wert) - erst Aus-/Wiedereinloggen half. Plausibelster Mechanismus (kein
  Service Worker/PWA-Cache in der App): der Browser-"Back-Forward-Cache"
  stellt beim Zurückkehren zur Seite (Tab-Wechsel, Bildschirm entsperren,
  Zurück-Navigation) eine eingefrorene Kopie aus dem Speicher wieder her,
  statt sie neu zu laden. Absicherung unabhängig von der genauen Ursache:
  lädt bei jeder Rückkehr zur Seite (`pageshow` mit `persisted`,
  `visibilitychange`) zwingend frisch aus der Datenbank nach - außer
  gerade ein Stunden-Feld hat den Fokus.
  Zur Kontrolle stehen
  die Stunden der letzten 3 Tage schreibgeschützt links neben dem
  bearbeitbaren Tag, sowie zusätzlich die 2 kommenden Tage schreibgeschützt
  rechts daneben; Gruppen-Spalte direkt neben der Personalnummer (weniger
  Hin-und-her-Blicken), Herkunft-Spalte neben dem Namen. Markierung kennt
  neben "U" (Urlaub/Feiertag) jetzt auch "F" (Fahrer) - reine Kennzeichnung
  vorerst, soll später für die Fahrer-Prämie ausgewertet werden.
  Pfeil-Buttons neben der Datumsauswahl springen einen
  Tag vor/zurück, Pfeiltasten hoch/runter im Stunden-Feld springen direkt
  zur nächsten/vorherigen Person, Umschalt+Pfeil rechts/links springt beim
  gleichen Mitarbeiter zum Folgetag/Vortag (praktisch zum Nacherfassen
  mehrerer Tage in Folge ohne Maus). Datum ist standardmäßig auf gestern
  vorausgewählt. Beim Wechsel des Tages (Pfeil-Buttons, Datumsfeld oder
  Umschalt+Pfeil) bleibt die Ansicht an derselben Stelle (Fokus/Scroll-
  Position), statt nach oben zu springen. Zahlenfelder (Stunden, aber auch
  Beträge/Sätze an anderer Stelle) haben keine Hoch-/Runter-Pfeile und
  ändern ihren Wert nicht mehr versehentlich durchs Scrollen mit der Maus,
  wenn sie gerade fokussiert sind - ein häufiger Browser-Stolperstein.
  Felder sind für Rollen ohne Schreibrecht (nur admin/hr/zeiterfassung
  dürfen Stunden eintragen) jetzt clientseitig gesperrt mit erklärendem
  Hinweis, statt normal bearbeitbar auszusehen, aber die Eingabe lautlos
  von der Datenbank abzulehnen (Bugfix 2026-08-08, betraf z.B. den
  Sprung-Link von der Controlling-Seite ins Stundenmonitoring). Ein
  fehlgeschlagener Speicherversuch (z.B. weil jemand anders denselben
  Eintrag zwischenzeitlich geändert hat) zeigt jetzt ebenfalls einen
  Hinweis, statt die Eingabe kommentarlos zu verwerfen
- "Stundenkonto" (Stand 2026-08-20, Nutzer-Vorgabe): eigene, immer
  sichtbare Spalte in der Stundenerfassung, unabhängig vom gerade
  gewählten Tag (nur das Jahr bestimmt die Saison). Ein aufklappbarer
  Bereich je Person zeigt den aktuellen Kontostand, ein Buchungsformular
  (Gutschrift/Korrektur/Freizeitausgleich - wie Stundenerfassung selbst
  admin/hr/zeiterfassung, ohne Lohnwirkung) und die letzten Buchungen.
  "In Auszahlung umwandeln" (admin/hr/lohnabrechnung/management - Stand
  2026-08-21 um hr/management erweitert, ausdrücklich NICHT
  zeiterfassung; vorher nur admin/lohnabrechnung) rechnet automatisch
  Stunden × Stundenlohn, bucht eine
  negative Bewegung und verhält sich dann wie eine Prämie: fließt live in
  Bruttolohn ein (normal lohnsteuerpflichtig), erscheint auf der
  Lohnübersicht aber als eigene Spalte "Zulage €" (Stand 2026-08-20
  umbenannt, vorher "Stundenkonto €") statt in der
  Prämien-Summe. Ist die Person bereits abgerechnet, wird der eingefrorene
  Schnappschuss automatisch mit-aktualisiert und die Änderung wie eine
  Abrechnungs-Korrektur in "Kassenbewegungen" protokolliert (gesperrt bei
  bereits freigegebener Kassenprüfung). Bewegungs-Log statt Einzelfeld -
  der Kontostand ist die Summe aller Buchungen, kein negativer Saldo
  möglich (außer bei "Korrektur", bewusste Ausnahme ohne Saldo-Prüfung).
  "Stornieren"-Button je Umwandlung ergänzt (Stand 2026-08-28, Nutzer-
  Meldung: "Ich habe ein Stundenkonto fälschlicherweise in Auszahlung
  umgewandelt... ich bekomme sie nicht mehr raus" - dafür gab es bisher gar
  keinen Weg): bucht eine ausgleichende "Korrektur" zurück aufs Konto
  (Original-Zeile bleibt sichtbar stehen, nur als "storniert" markiert -
  vollständiger Audit-Trail statt Löschen), zieht exakt denselben Betrag
  wieder von "Zulage €" ab (aus einer neuen `betrag`-Spalte auf der
  Bewegung, nicht mit dem AKTUELLEN Stundenlohn neu berechnet - bleibt so
  auch bei zwischenzeitlicher Lohnänderung korrekt), inkl. Schnappschuss-/
  Kassenbewegungs-Korrektur, falls die Person bereits abgerechnet ist.
  Migration: `migration_2026-08-28_stundenkonto_auszahlung_stornieren.sql`
- "Stundenerfassung → Import" (admin/hr/zeiterfassung): Excel-/CSV-Import
  zum Nacherfassen mehrerer Tage/Personen auf einmal - anderes Format als
  der Personal-Import: Spalte 1 = Personalnummer, ab Spalte 2 je eine
  Spalte pro Datum (Kopfzeile = Datum). Existieren für eine Person und ein
  Datum bereits Stunden, hat der bestehende Eintrag Vorrang (Zelle wird
  übersprungen, nicht überschrieben); ebenso übersprungen werden Zellen in
  einem per Monatsabschluss gesperrten Monat. Vorschau zeigt vorab, was
  importiert/übersprungen wird bzw. wo Personalnummer oder Datumsspalte
  nicht erkannt wurden
- Arbeitsgruppen-Verwaltung unter Einstellungen (nur admin): Bezeichnung und
  Anzeige-/Druckreihenfolge je Gruppe
- Personalnummern-Übersicht: 10 Nummernkreise (1–999, 1000–1999, …),
  Dubletten-Erkennung, nächste freie Nummer je Kreis - Kreis-Auswahl beim
  Neuanlegen zeigt den Nummernbereich direkt mit an (z.B. "Kreis 1 (1-999)")
- Eigene Unterseite "Personal → Planung" (nur admin/hr): Kandidaten für
  die kommende Saison vorab anlegen, bevor sie tatsächlich anreisen -
  gruppiert nach Herkunft. Personalnummern werden dabei nur reserviert
  (nicht final vergeben); sagt ein Kandidat ab, wird seine Nummer sofort
  wieder frei. Beim Anlegen kann eine bereits bekannte (auch inaktive)
  Person verknüpft werden - warnt automatisch, falls diese auf der
  Schwarzen Liste steht. Führerschein-Selbstauskunft (B/BE/C/CE) kann direkt
  am Kandidaten vermerkt werden, unabhängig von der hochgeladenen, geprüften
  Kopie im Personalstamm. Über "Anreise vorbereiten" (Mehrfachauswahl) wird
  aus einem Kandidaten ein echter Mitarbeiter unter "Personal" (verknüpfte
  Personen werden reaktiviert - Historie bleibt an einer ID, neue Personen
  mit ihrer reservierten Nummer angelegt) und er wandert weiter in die
  Anreiseliste
- Eigene Unterseite "Personal → Anreiseliste" (nur admin/hr): Personen aus
  der Planung, gruppiert nach geplantem Ankunftsdatum ("Anreisegruppe").
  Vor dem Drucken müssen Vertragsbeginn/-ende erfasst werden. Danach können
  Arbeitsvertrag, Werks-/Mietvertrag und Bankverbindungs-Erfassungsbogen
  einzeln oder für die ganze Anreisegruppe in einem druckbaren Dokument
  erzeugt werden (Word-Vorlagen aus public/vertragsvorlagen mit
  «Platzhalter»-Feldern, direkt im Browser mit jszip befüllt, keine
  kommerzielle Templating-Bibliothek) - das erfolgte Drucken wird pro
  Person markiert. Nach der tatsächlichen Anreise werden weitere Punkte
  abgehakt: SV-Fragebogen (siehe "Personal → Sozialversicherung" unten)
  direkt hier person für person erfassbar/bearbeitbar - Status
  "Nicht erfasst"/"Nicht bestanden"/"Bestanden" sofort sichtbar, ggf.
  verheiratet, ggf. Lohnsteuerabzug-Antrag gewünscht, sowie Buskosten
  (Hinfahrt) eingetragen (fließt automatisch in season_bonuses/die
  Lohnübersicht ein). Ob Ausweiskopie/Führerscheinkopie/Hochzeitsurkunde
  hochgeladen sind, wird live gegen "Personal → Dokumente" geprüft (nicht
  doppelt gepflegt); die beiden Fach-Formulare werden dagegen NICHT
  hochgeladen, sondern über ihre Eingabemaske erfasst (Stand 2026-08-11) -
  geprüft wird entsprechend, ob die Angaben erfasst sind: beim
  Lohnsteuerabzug der Familienstand auf "Personal → Lohnsteuer", beim
  SV-Fragebogen ohnehin schon immer der Datensatz selbst. Erst wenn alles
  erfüllt ist (inkl. SV-Fragebogen "Bestanden"), springt der Status von
  "Offen" auf "Vollständig" - auch als Spalte im Personalstamm sichtbar,
  live berechnet statt gespeichert, damit nichts veraltet stehen bleiben
  kann
- "Schwarze Liste"-Flag im Personalstamm (nur admin/hr sichtbar, wie
  IBAN/SV-Nr.): dauerhaftes "nicht mehr erwünscht"-Markierung je Person,
  unabhängig vom Aktiv-Status - wird bei der Personalplanung automatisch
  geprüft
- Eigene Unterseite "Personal → Dokumente" (nur admin/hr, wie andere
  sensible Personaldaten): Tabelle wie im Personalstamm (Pers.-Nr.,
  Herkunft, Name, Vorname, Ort), dahinter eine Spalte je Dokument-
  Kategorie (Ausweiskopie, Führerschein Kopie, Arbeitsvertrag,
  Werks-/Mietvertrag, Hochzeitsurkunde, Sonstiges) - leer, wenn noch
  nichts hochgeladen wurde, sonst anklickbar zum Download. Dateien liegen
  in einem privaten Supabase-Storage-Bucket, Downloads laufen über
  zeitlich begrenzte signierte Links. Aufgeräumt 2026-08-11
  (Nutzer-Vorgabe: die Seite war irreführend geworden): die beiden
  Fach-Formulare und alle fachlichen Status-Spalten stehen nicht mehr
  hier, sondern jeweils bei ihrem Thema - Familienstand/Wohnsituation/
  Antragsstand unter "Personal → Lohnsteuer", SV-Status unter "Personal →
  Sozialversicherung". Die beiden Formulare selbst wurden als
  Dokument-Kategorie ganz entfernt (Nutzer-Vorgabe, zweiter Schritt am
  selben Tag): sie werden nicht mehr hochgeladen, sondern ausschließlich
  über ihre Eingabemaske erfasst - die dort erfassten Angaben sind der
  Nachweis. Damit ist diese Seite wieder das, was ihr Name sagt: die
  allgemeinen Personaldokumente.
- Eigene Unterseite "Personal → Lohnsteuer" (nur admin/hr, Stand
  2026-08-11, aufgebaut analog zu "Personal → Sozialversicherung"):
  bündelt alles zum Antrag auf Lohnsteuerabzug an einer Stelle. Angaben
  aus der "Bestätigung für den Nachweis der doppelten Haushaltsführung"
  (manuelles Eingabeformular je Person und Saison-Jahr, analog zum
  SV-Fragebogen vom ausgefüllten/gestempelten Papierformular der Gemeinde
  abgetippt): Familienstand und - laut Formular nur bei nicht
  verheirateten Personen abgefragt - die Wohnsituation im Heimatland.
  Dazu der Verfahrensstand beim Finanzamt als vierstufiger Status: Kein
  Antrag / Antrag gestellt / Freibetrag erteilt / Kein Freibetrag, mit
  Datum (gestellt am bzw. Bescheid vom). **Wichtig (Nutzer-Klarstellung
  2026-08-11): das Ausfüllen des Formulars ist noch KEIN gestellter
  Antrag** - das Formular ist nur der Nachweis des eigenen Hausstands im
  Heimatland, der Status wird deshalb immer manuell gesetzt und nie
  automatisch abgeleitet. Der Antrag selbst (das eigentliche Schreiben ans
  Finanzamt) ist noch nicht in der App abgebildet und soll später ergänzt
  werden. Ebenfalls auf dieser Seite: die Hochzeitsurkunde mit
  dem Hinweis "ggf. erneut prüfen", wenn die zuletzt hochgeladene Kopie
  älter als ein Jahr ist und die Person laut diesjähriger Erfassung
  verheiratet ist (reine Erinnerung, keine echte Prüfung). Der Status
  unterscheidet sich bewusst von `lohnsteuerabzug_antrag_gewuenscht` in
  der Anreiseliste - das ist nur der Wunsch der Person, dies hier der
  tatsächliche Verfahrensstand. Name/Geburtsdatum/Adresse werden nicht
  dupliziert, stehen schon im Personalstamm.
- Führerschein-Klassen (B, BE, C, CE) werden beim Hochladen einer
  "Führerschein Kopie" abgefragt und wirken sich breit aus: Personal,
  Stundenerfassung und Lohnübersicht zeigen für jede Person mit
  hinterlegtem Führerschein die Klassen an (über eine schmale, für alle
  Rollen lesbare Sicht - das Dokument selbst bleibt admin/hr-only)
- Personal-Import aus Excel/CSV mit Vorschau, Spaltenerkennung und
  Fehlerprüfung (u.a. bereits vergebene Personalnummern). Endet die
  Personalnummer einer Zeile auf "a" (Statuswechsel-Konvention, siehe
  "Statuswechsel" im Personalstamm), wird automatisch nach einer
  Vorgänger-Person mit der Nummer ohne "a" gesucht (auch innerhalb
  derselben Import-Datei) und die Verknüpfung gesetzt - fehlt der
  Vorgänger, wird trotzdem ganz normal importiert, nur ohne Verknüpfung
- Monatsabschluss: Monatsfilter auf der Lohnübersicht zeigt je Mitarbeiter
  Stunden, Anwesenheitstage, Basis-Brutto (nur Stunden × Stundenlohn,
  ohne Saison-Prämien - die bleiben ein Saison-Gesamtbetrag) sowie
  Verpflegung/Unterkunft in € für genau diesen Monat (z.B. für die
  monatliche Abführung an die Vermietungsgesellschaft). „⚠" markiert
  Personen, deren letzter Eintrag vor dem erwarteten Monatsende liegt,
  aktive Personen ganz ohne Eintrag im Monat werden separat aufgeführt.
  admin/hr können den Monat abschließen (sperrt die Stundenerfassung für
  diesen Monat serverseitig, nicht nur im Menü) und mit Pflichtgrund
  wieder öffnen, um vergessene Stunden nachzutragen
- Menüpunkt "Lohn" fasst Lohnübersicht, Vorschüsse und Auszahlungen als
  Unterreiter zusammen (analog zu "Personal")
- Automatische Saison-Lohnübersicht (Stunden, Prämien, Verpflegungs-/
  Unterkunft-Abzüge, Vorschüsse, pauschale Lohnsteuer bei Abrechnungsart
  "pauschal": 5,275% vom Bruttolohn), filterbar nach Arbeitsgruppe - z.B.
  um alle zur Abrechnung vorgesehenen Personen vorab in eine Gruppe wie
  "101 - Abrechnen" zu packen und dort gesammelt zu markieren. Inaktive
  Personen sind standardmäßig ausgeblendet (Checkbox "inaktive anzeigen",
  gleiches Muster wie im Personalstamm, Stand 2026-08-09). Zusätzlich ein
  Suchfeld nach Name/Personalnummer (Stand 2026-08-14, wie im
  Personalstamm) - wirkt zusammen mit dem Gruppen-Filter, auf beide
  Ansichten (Saison-Summe und Monats-Kontrolle)
- Einstellungen-Seite (nur admin): Verpflegungs-/Unterkunft-Satz pro Tag
  sowie Mindestlohn, versioniert je Saisonjahr, Default 10€/10€. Der
  Mindestlohn wird beim Neuanlegen einer Person (Personalstamm oder
  Personalplanung) automatisch als Stundenlohn vorbelegt, bleibt dort aber
  frei änderbar
- "Jetzt Abrechnen" auf der Lohnübersicht (admin/lohnabrechnung, auch
  mehrere Personen gleichzeitig): markiert die Saison für die Person als
  abgerechnet und setzt sie auf inaktiv - reversibel über "Reaktivieren"
  auf der Personal-Seite für die nächste Saison. Friert dabei den
  berechneten Stand als Schnappschuss ein (spätere Satz-/Vorschuss-
  Änderungen verändern eine bereits ausgezahlte Abrechnung nicht mehr
  rückwirkend; Lohnübersicht warnt mit „⚠", falls die Live-Berechnung
  seither abweicht). Der druckbare Beleg selbst entsteht NICHT hier,
  sondern ausschließlich auf der "Auszahlungen"-Seite (siehe dort) - Stand
  2026-08-21 bewusst so vereinfacht: vorher gab es hier zusätzlich einen
  zweiten, unvollständigen Ausdruck ohne Belegnummer (automatisch direkt
  nach "Jetzt Abrechnen" UND über einen eigenen Button für die aktuelle
  Auswahl), der nur verwirrende Doppelung war (Nutzer-Meldung: "dieser
  Beleg ist eigentlich auch unnötig") - entfernt. Nachträgliche
  Korrektur eines falsch eingegebenen Netto-Betrags (Stand 2026-08-19,
  admin/lohnabrechnung): "korrigieren"-Link direkt im gesperrten
  Netto-Feld, Grund ist Pflichtfeld und wird protokolliert (wie
  Vorschuss-Korrektur, landet ebenfalls in "Kassenbewegungen" auf der
  Kasse-Seite), aktualisiert dabei auch den eingefrorenen Schnappschuss
  (sonst bliebe die Korrektur unsichtbar - siehe oben) und damit
  automatisch die Auszahlungsbeleg-Summe und den Kassenbestand. Gesperrt
  bei bereits freigegebener Kassenprüfung (dann zuerst im Kassenbuch
  wiedereröffnen) und bei Abrechnungsart "pauschal" (Netto dort automatisch
  berechnet). Bewusst nur Netto korrigierbar, kein automatischer
  Differenzbeleg - die tatsächliche Nach-/Rückzahlung läuft wie bei der
  Kautions-Rückzahlung außerhalb der App
- **"Jetzt Abrechnen" verweigert fehlenden Netto-Betrag (Stand 2026-08-21,
  Nutzer-Meldung: "mir ist es nun schon mehrfach passiert, dass ich ...
  vergessen habe den Netto-Betrag aus dem Lohnprogramm einzugeben")**: die
  Aktion bricht jetzt komplett ab (mit Fehlermeldung, welche Person(en)
  betroffen sind), wenn mindestens eine ausgewählte Person einen
  Bruttolohn > 0 hat, aber noch keinen Netto-Betrag eingetragen wurde -
  betrifft nur Lohnsteuerklasse 1/sozialversicherungspflichtig (bei
  "pauschal" wird Netto immer automatisch berechnet)
- **Erneutes "Jetzt Abrechnen" nach Reaktivierung (Stand 2026-08-21,
  Nutzer-Frage: "Person abgerechnet, deaktiviert, reaktiviert, Stunden
  nachgetragen, erneut abgerechnet - kommt dann eine weitere Abrechnung?")**:
  season_summary rechnet immer kumulativ für die gesamte Saison, nie "seit
  der letzten Abrechnung" - ein zweites "Jetzt Abrechnen" für dieselbe
  Person hätte sonst wieder den KOMPLETTEN Saison-Betrag gezeigt statt nur
  der Differenz (Doppelzahlungsrisiko), und der alte, bereits gedruckte
  Beleg hätte diese Person rückwirkend aus seiner eigenen Summe/
  Personenliste verloren. Behoben mit einer neuen, unveränderlichen
  Tabelle `auszahlungsbeleg_zeilen`, die pro Beleg/Person die für GENAU
  DIESEN Beleg gültigen Beträge festhält, unabhängig davon, was später mit
  derselben Person passiert. War eine Person für die Saison schon einmal
  abgerechnet, erzeugt "Jetzt Abrechnen" jetzt automatisch nur noch einen
  **Differenzbeleg** (nur die Differenz seit der letzten Abrechnung,
  gekennzeichnet mit „(Differenz)" auf Beleg/Bildschirm und einem „⚠
  Differenz"-Hinweis in der Belegliste) - mit Warnhinweis im Bestätigungs-
  Dialog vor dem Klick. Bereits erstellte Belege bleiben dadurch für immer
  unveränderlich, auch die drei nachträglichen Korrektur-Funktionen (Netto,
  Verpflegungstage, Stundenkonto-Auszahlung) ziehen ihre Änderung jetzt
  zusätzlich auf die tatsächlich gedruckte Beleg-Zeile nach
- "Verpflegungsfreie Tage" (Stand 2026-08-19, Nutzer-Vorgabe: zu viel
  Verpflegung abgezogen, weil die Kantine an einigen Tagen noch nicht
  geöffnet hatte): eigenes Zahlenfeld je Mitarbeiter/Saison auf der
  Lohnübersicht, reduziert NUR den Verpflegungsabzug (Tagessatz ×
  (Anwesenheitstage − verpflegungsfreie Tage)), nicht die Anwesenheitstage
  selbst und nicht die Unterkunft. Vor dem Abrechnen normal editierbar wie
  Buskosten/Kautionen, danach über dieselbe "korrigieren"-Mechanik wie
  beim Netto-Betrag (Pflichtgrund, Protokoll, Schnappschuss-Aktualisierung)
- "Auszahlungen"-Seite: ein Beleg je "Jetzt Abrechnen"-Aktion (analog zu
  Vorschüssen/Kassenbuch), aufklappbar mit Personalnummer, Name, Stunden,
  Anwesenheitstage, Brutto, Steuer, Netto, Verpflegung/Unterkunft,
  Vorschüsse, Buskosten und Auszahlungsbetrag je Person, mit
  Abweichungs-Warnung und eigener Druckfunktion je Beleg, filterbar nach
  Saison-Jahr und Monat (des Abrechnungsdatums) - der einzige druckbare
  Auszahlungsbeleg der App, mit Belegnummer (siehe Bugfix oben bei "Jetzt
  Abrechnen"). Druck verschlankt (Stand 2026-08-21, Nutzer-Meldung
  "Unterschriften-Feld außerhalb des Blattes"): dieselbe dichte
  Druckformatierung wie die Suche-/Lohnübersichts-Ausdrucke
  (`.print-dense-table`), eine schmalere erste Spalte für die
  Personalnummer statt der für Datumsangaben gedachten Standardbreite
  (`.print-persnr-schmal`), Fahrer- und Zimmerkaution zu einer Spalte
  "Kaution(en) €" zusammengefasst, und die bisher fehlende Spalte
  "Zulage €" (Stundenkonto-Auszahlung) ergänzt (war auf der Lohnübersicht
  schon da, hier aber vergessen worden).
  Spaltenreihenfolge/-format grundlegend überarbeitet (Stand 2026-08-21,
  Nutzer-Vorgabe: die Rechenkette Basislohn+Prämien+Zulagen=Brutto,
  −Steuer=Netto, −Verpfl./Unterk.=„Netto nach Verpfl./Unterk." (kein
  feststehender Fachbegriff, deshalb selbsterklärendes Etikett statt
  eines evtl. falschen), −Vorschüsse/Buskosten/Kleidung/Kautionen=
  Auszahlung soll "ins Auge springen"): Spalten in genau dieser
  Reihenfolge, farblich nach dem bestehenden Lohn-Farbschema gruppiert
  (Brutto-Bestandteile hellbraun/grün, Steuer/Abzüge rot, Kautionen blau,
  Netto voll grau, siehe `lib/farben.ts`) und mit einer dickeren
  Trennlinie am Anfang jedes neuen Rechenschritts (`.print-gruppenstart`).
  Zusätzlich blendet jede Spalte, in der bei ALLEN Personen dieses Belegs
  eine 0 steht, sich automatisch aus (Nutzer-Vorgabe: "kostet viel Platz")
  - außer den Kernspalten Brutto/Netto/Auszahlung, die immer stehen
  bleiben; "Netto nach Verpfl./Unterk." blendet sich zusammen mit
  "Verpfl./Unterk." aus, da sie sonst nur Netto wiederholen würde.
  Weiter fein-getunt (Stand 2026-08-21): Beträge im Ausdruck mit
  deutschen Tausender-Trennpunkten (`fmtDruck()`, eigene Funktion nur für
  den Druck - die interaktive, aufklappbare Ansicht bleibt beim
  bisherigen Punkt-Dezimalformat); "Netto nach Verpfl./Unterk. €" zu
  "Netto nach Abz. €" gekürzt, der gewonnene Platz kommt der
  Unterschriftenspalte zugute (`.print-unterschrift-breit`); Brutto, Netto
  und Auszahlung im Ausdruck größer und fett hervorgehoben
  (`.print-hervorgehoben`), damit die drei Endsummen der Rechenkette auf
  den ersten Blick auffindbar sind. Die Spalte "Steuer €" (die kurzzeitig
  am selben Tag zusätzlich "(PA)"/"(HSC)" auswies) danach wieder komplett
  entfernt - sowohl im Ausdruck als auch in der aufklappbaren
  Bildschirm-Ansicht (Nutzer-Vorgabe: "ergibt sich sowieso aus der
  Differenz von Brutto zu Netto")
- Eingeklappte Beleg-Zeile auf der "Auszahlungen"-Seite überarbeitet
  (Stand 2026-08-25, Nutzer-Meldung: "die Belegnummer ist noch bündig,
  aber dann verschiebt sich ... nach rechts, wenn 'Differenz' dabeisteht"):
  vorher `flex justify-between` ohne feste Spaltenbreiten - ein längerer
  Inhalt in einer Spalte (z.B. das "⚠ Differenz"-Badge bei der
  Belegnummer) schob dadurch alle folgenden Spalten dieser Zeile nach
  rechts, wodurch verschiedene Belege nicht mehr untereinander
  ausgerichtet waren. Jetzt feste Breite je Spalte (nur die
  Belegnummer-Spalte bleibt flexibel), bleibt dadurch zeilenübergreifend
  exakt ausgerichtet. Zusätzlich neue Spalte "Kaution {Betrag} €" (nur
  wenn eine Kautionsübergabe für diesen Beleg existiert) direkt im
  eingeklappten Zustand sichtbar, ohne den Beleg erst aufklappen zu
  müssen - nutzt dieselbe bereits geladene `kautionen`-Map wie die
  aufgeklappte Ansicht, keine zusätzliche Abfrage nötig
- Buskosten (vorfinanzierte Heimreise) als eigene, sichtbare
  Abzugsposition im Auszahlungsbetrag (getrennt von Kassen-Vorschüssen,
  "damit es zu keinen Missverständnissen kommen kann")
- Bei Abrechnungsart "Lohnsteuerklasse 1"/"sozialversicherungspflichtig":
  Eingabefeld für den vom externen Lohnprogramm gelieferten Netto-Betrag
  (App berechnet hier bewusst keine eigene Lohnsteuer)
- Herkünfte-Verwaltung unter Einstellungen (nur admin), als Dropdown im
  Personalstamm (statt Freitext, damit Filter/Auswahl zuverlässig funktioniert).
  Filter nach Herkunft (Stand 2026-08-21) auf der Personalstamm- und der
  Sozialversicherung-Seite, um die sichtbare Liste einzugrenzen - getrennt
  von der bereits bestehenden Mehrfachauswahl-Herkunft im Personalstamm
  (die baut eine Gruppen-Auswahl auf, filtert nicht die Liste)
- Vorschussverwaltung: einzeln, gruppenweise (nach Arbeitsgruppe) oder nach
  Herkunft auswählen, Betrag pro Person individuell anpassbar, atomare
  Belegnummer, Storno statt Löschen, filterbar nach Jahr und Monat (wie
  bei Auszahlungen). Zahlungsart BAR druckt zwei getrennte Blätter: eine
  Mitarbeiter-Unterschriftenliste (ohne Summe - die Empfänger müssen die
  Gesamtsumme nicht sehen) und - nur falls "Übergeben an" ausgefüllt ist
  (Stand 2026-08-14, vorher wurde diese Seite immer gedruckt) - einen
  separaten Übergabe-Beleg für die Person, die das Geld zur Verteilung
  bekommt (z.B. Gruppenleiter), mit Summe und einem einzigen
  Unterschriftenfeld für diese eine Person
- **Vorschuss-Historie bei der Auswahl (Stand 2026-08-24, Nutzer-Vorgabe:
  "um schnell prüfen zu können, ob ich der Person einen Vorschuss geben
  kann"):** in der Tabelle der gerade ausgewählten Personen zwei neue
  Spalten - "Letzter Vorschuss" (Datum) und "Bisher insgesamt €" (Summe
  aller nicht stornierten Vorschüsse dieser Person, über alle Belege
  hinweg, nicht nur die zuletzt geladenen 100). Eigene, gezielte Abfrage
  nur für die aktuell ausgewählten Personen (nicht aus der ohnehin auf
  100 Belege begrenzten Liste abgeleitet), lädt bei jeder Änderung der
  Auswahl neu
- Zahlungsart Überweisung (Stand 2026-08-14, Code "BÜ" - vorher "AZ", das
  für "Auszahlung" stand und bei Vorschüssen verwirrend war): eigenes,
  einseitiges Druckbild statt der beiden BAR-Blätter, da kein Bargeld den
  Besitzer wechselt. Zahlungsempfänger, IBAN und BIC sind je Empfänger
  Pflichtangaben - aus den Personalstammdaten vorbefüllt, änderbar, als
  Schnappschuss auf `advance_recipients` gespeichert (bleiben unverändert,
  auch wenn sich die IBAN der Person später ändert) - und erscheinen mit
  auf dem Belegdruck. Statt einer Erhalt-Unterschrift bestätigt dort jede
  Person selbst mit Unterschrift, dass ihre eigenen Kontodaten korrekt
  sind, BEVOR die Überweisung tatsächlich ausgeführt wird (Nutzer-Vorgabe:
  "Die Richtigkeit dieser Banküberweisung will ich mir unterschreiben
  lassen, bevor ich sie durchführe")
- SEPA-Überweisungsdatei bei Vorschüssen (Stand 2026-08-25, Nutzer-Vorgabe:
  "Schaltfläche 'SEPA-Datei erstellen'" bei Zahlungsart Banküberweisung):
  Button "SEPA-Datei erstellen" direkt in der Erfolgsmeldung nach dem
  Bestätigen eines Überweisungs-Vorschusses, mit frei wählbarem
  Zahlungsdatum. Erzeugt eine echte, bankfähige ISO-20022-Datei
  (`pain.001.001.03`, `lib/sepa.ts`) mit je einer Überweisung pro Empfänger
  des Belegs - Verwendungszweck exakt "[Belegnummer], [Nachname],
  [Vorname]" wie vorgegeben. Bricht mit einer klaren Fehlermeldung ab statt
  eine Person ohne IBAN/BIC stillschweigend zu überspringen. Das
  Auftraggeber-Konto (Mömmel Agrar GmbH & Co. KG) liegt in der neuen,
  admin/kasse-only lesbaren Tabelle `firmen_bankdaten` (Singleton-Zeile,
  admin-editierbar unter Einstellungen → "Firmen-Bankdaten") - einmal
  hinterlegt statt bei jeder Datei neu eingetippt. Migration:
  `migration_2026-08-25_firmen_bankdaten_sepa.sql`
- Neue Vorschussart "Strafe/Rechnung" (Stand 2026-08-18): eigener Beleg mit
  Belegupload (Strafzettel/Rechnung als Nachweis, PDF/JPG/PNG), bewusst auf
  genau eine Person beschränkt (der Beleg gehört zu dieser einen Person,
  keine Mehrfachauswahl wie bei normalen Vorschüssen). Zahlungsart/
  "Übergeben an" entfallen (kein Geld fließt) - intern `zahlungsart = 'N/A'`,
  wodurch diese Belege automatisch aus dem physischen Kassenbestand
  herausfallen (Kasse/Dashboard filtern explizit auf `zahlungsart = 'BAR'`),
  aber wie ein normaler Vorschuss den Auszahlungsbetrag mindern. Der Beleg
  liegt in einem eigenen, privaten Storage-Bucket (`vorschuss-belege`,
  getrennt von `mitarbeiter-dokumente`, da kasse hier zusätzlich lesen/
  schreiben darf) und ist per Direktlink (zeitlich begrenzte signierte URL)
  sowohl im Vorschusslog als auch auf der "Suche"-Seite abrufbar - dort
  nur für Rollen mit den bisherigen Vorschuss-Rechten (admin/hr/kasse/
  lohnabrechnung/pruefer), nicht z.B. zeiterfassung
- Nachträgliche Korrektur eines bereits bestätigten Vorschuss-Betrags
  (admin/kasse, auch nach Storno-Sperre): Grund ist Pflichtfeld, jede
  Korrektur wird mit Anwender, Zeitstempel und Differenz in den
  "Kassenbewegungen" protokolliert und wirkt sich direkt auf den
  Kassenbestand aus
- Kautionen (Fahrerkaution, Zimmerkaution) als eigene, sichtbare
  Abzugspositionen im Auszahlungsbetrag (getrennt von Vorschüssen/
  Buskosten, "damit es zu keinen Missverständnissen kommen kann").
  Rückzahlung nach Fahrzeug-/Zimmerkontrolle läuft weiterhin außerhalb der
  App in bar - die App bildet aktuell nur den Abzug ab, keinen offen/
  zurückgezahlt-Status
- "Stundenerfassung → Arbeitskleidung" (admin/hr/zeiterfassung, Stand
  2026-08-09): Ausgabe von Arbeitshose/-jacke/Gummistiefeln je Person -
  landet wie Buskosten/Kautionen als eigene, sichtbare Abzugsposition im
  Auszahlungsbetrag. Spargelmesser, Feile, Handschuhe sind
  Verbrauchsgegenstände (kostenloser Tausch gegen das Altgerät) und werden
  bewusst nicht erfasst. Erfasst über eine kontrollierte
  security-definer-Ausnahme (season_bonuses selbst bleibt für
  zeiterfassung nicht lesbar/schreibbar). **Grundlegend umgebaut (Stand
  2026-08-24, Nutzer-Vorgabe: "Ich möchte einen Datumsstempel bekommen...
  die Größen, die ausgegeben wurden... einen Lagerbestand an
  Arbeitskleidung, der 'lebt'"):** statt einer überschreibbaren Gesamtzahl
  je Person/Saison jetzt ein Ausgabe-Log (`kleidung_ausgaben`) - jede
  Ausgabe ein eigener, zeitgestempelter Eintrag mit Pflichtfeld Größe
  (feste Listen im Code: Hose/Jacke S–3XL, Stiefel 36–48), per Storno statt
  Überschreiben korrigierbar (Pflichtgrund, wie bei Vorschüssen).
  Personentabelle jetzt aufklappbar (wie Controlling →
  Stundenmonitoring): Ausgabe-Formular (Typ/Größe/Anzahl, farbige
  Typ-Badges) plus die eigene Ausgabe-Historie der Person inkl.
  Storno-Möglichkeit. Gleicher Suchfilter wie auf der Stundenerfassung
  (Name/Personalnummer) ergänzt. Der bestehende Lohnabzug bleibt
  inhaltlich unverändert (weiterhin Stück × Preis) -
  `season_bonuses.kleidung_*_anzahl` ist jetzt nur noch ein aus dem Log
  neu berechneter Cache (`arbeitskleidung_bestand_synchronisieren`),
  ersetzt die alte Funktion `arbeitskleidung_setzen`. **Lagerbestand seit
  2026-08-25 auf eigener Seite "Stundenerfassung → Lager" (Nutzer-Vorgabe:
  "Den Lagerbestand soll nur 'admin und hr' sehen und bearbeiten können.
  'Stundenerfassung' macht nur die Ausgabe"):** nur admin/hr sehen den
  Reiter überhaupt (`ErfassungTabs` jetzt rollenbewusst je Tab). Tabelle
  mit farbigen Typ-Badges und dicker Trennlinie zwischen Hose/Jacke/
  Stiefel, "Aktueller Bestand" weiterhin live berechnet (Anfangsbestand −
  Summe aller nicht stornierten Ausgaben, muss laut Nutzer nicht 100%
  exakt sein - reine Orientierung), rot/gelb eingefärbt bei 0 bzw. ≤ 3
  Stück. Zwei Wege, den Anfangsbestand zu pflegen: direkte Eingabe +
  "Anfangsbestände speichern" (mit Datumsstempel + Bearbeiter, serverseitig
  per Trigger `kleidung_lagerbestand_touch` gesetzt, nicht vom Client
  manipulierbar), oder "Inventur durchführen" - Eingabefeld wird mit dem
  live berechneten Bestand vorausgefüllt, man trägt den tatsächlich
  GEZÄHLTEN Bestand ein (nach Zukauf oder bei Schwund), die App rechnet
  daraus rückwärts den nötigen Anfangsbestand aus. Gemeinsame Konstanten
  (Größen-Listen, Farb-Badges) in `lib/arbeitskleidung.ts`, damit
  Arbeitskleidung- und Lager-Seite nie auseinanderlaufen. Migration:
  `migration_2026-08-24_arbeitskleidung_lagerbestand.sql`.
  **Bugfix im selben Zuge (Nutzer-Meldung: "steht da, dass die Preise für
  2026 noch nicht in den Einstellungen hinterlegt sind. Das stimmt aber
  nicht"):** `verpflegungssaetze` hatte nur eine einzige RLS-Policy ("for
  all using (is_admin())") - dadurch konnte KEINE andere Rolle
  (hr/zeiterfassung/kasse/lohnabrechnung/pruefer/management/
  erntewirtschaft) die Preise/Sätze überhaupt lesen, betraf also nicht nur
  diese Seite, sondern auch die Mindestlohn-Vorbelegung auf Personal/
  Personalplanung/Anreiseliste. Aufgeteilt wie bei zuckermais_saetze/
  erdbeeren_parzellen_saetze (lesen breit, schreiben weiterhin nur admin).
  Migration: `migration_2026-08-24_verpflegungssaetze_select_rls.sql`.
  Nutzer-Meldung 2026-08-25 ("Man verliert sich in den Zeilen beim
  Erfassen, weil die Linien so dünn sind. Ich weiß dann nicht mehr bei
  welcher Person ich war"): die aufgeklappte Zeile auf der
  Arbeitskleidung-Seite ist jetzt deutlich als zusammengehöriger Block
  gerahmt (dicker grüner Rahmen um Kopf- und Ausklapp-Zeile) und
  wiederholt Name + Personalnummer noch einmal direkt im Formular
- Kautionsübergabe an den Hausmeister (Stand 2026-08-09): die bei der
  Auszahlung einbehaltene Zimmerkaution mindert zunächst nur den
  Auszahlungsbetrag der Person, nicht den Kassenbestand - erst wenn sie
  real an den Hausmeister übergeben wird (admin/kasse/lohnabrechnung,
  Beleg direkt auf der Auszahlungen-Seite unter dem jeweiligen
  Auszahlungsbeleg erstellbar), wird sie auch als echte Kassenausgabe im
  Kassenbuch verbucht. Druck erzeugt im Anschluss an den Auszahlungsbeleg:
  eine Personen-Tabelle (Pers.-Nr., Name, Betrag €) mit eigener
  "Unterschrift"-Spalte je Person (Stand 2026-08-25, Nutzer-Vorgabe:
  "wie einen Vorschussbeleg unterschriftsfähig machen" - analog zur
  Bar-Vorschuss-Auszahlung, wo jede Person ihren Betrag einzeln
  bestätigt), darunter ein einziges zusätzliches Unterschriftsfeld für den
  Hausmeister für die gesamte Übergabe. Schriftgröße seit 2026-08-25
  bewusst wie beim Vorschussbeleg (13pt, `.print-form-table` ohne
  `.print-dense-table`) statt der kleineren, dichten Formatierung der
  Auszahlungsliste - Nutzer-Vorgabe: "die Schriftgröße des Belegs wie bei
  den Vorschüssen machen". Storno statt Löschen, macht die Kassenausgabe
  wieder rückgängig
- Zahlungsart (Bar/Überweisung) bei "Jetzt Abrechnen" wählbar und je
  Auszahlungsbeleg gespeichert - für Personen, die schon abgereist sind
  und erst später per Überweisung ausgezahlt werden (siehe Arbeitsgruppe
  "Ausstehend/Abgereist" als Merkposten dafür)
- Kassenbuch (Einzahlungen) mit Saldo, einfacher Kassenprüfung und Log der
  nachträglichen Vorschuss-Korrekturen ("Kassenbewegungen") - Bar-Vorschüsse,
  Bar-Auszahlungen (aus "Jetzt Abrechnen") und Kautionsübergaben an den
  Hausmeister mindern automatisch den Kassenbestand, Überweisungen nicht.
  Unter "Prüfung durchführen" steht zusätzlich eine Liste aller Bewegungen
  (Vorschuss, Vorschuss-Korrektur, Auszahlung, Kautionsübergabe) seit der
  letzten Prüfung, mit Datum, Belegnummer und
  Anwender, zur Durchsicht vor dem Zählen der Kasse. Bugfix 2026-08-19:
  `advances.bearbeiter_id`/`cash_deposits.bearbeiter_id` hatten - anders
  als die vergleichbaren `erstellt_von`-Spalten - keinen
  `default auth.uid()` und wurden auch im Frontend nirgends explizit
  gesetzt, weshalb "Anwender" bei jedem Vorschuss leer blieb. Gilt nur für
  neue Zeilen ab dem Migrationszeitpunkt - bestehende Vorschüsse/
  Einzahlungen bleiben ohne Anwender. Nach Freigabe einer
  Prüfung (nur admin/pruefer, zweistufig - kasse führt die Prüfung durch,
  pruefer gibt frei) werden alle Belege im geprüften Zeitraum gesperrt
  (Storno/Korrektur nicht mehr möglich) - analog zur Monatsabschluss-Sperre
  bei den Stunden. Wiedereröffnung mit Pflichtgrund hebt die Sperre wieder
  auf. **Kassenbuch in "Journal" und "Kassenprüfung" aufgeteilt (Stand
  2026-08-24, Nutzer-Vorgabe: "Ein Journal mit laufendem Saldo... Eventuell
  verdient das Kassenbuch auch Untermenüpunkte"):** eigene Reiter-Leiste
  (`KassenbuchTabs`, gleiches Muster wie Lohn/Personal/Statistik) mit zwei
  Routen. "Journal" (`/kasse`, weiterhin die Einzahlung-Erfassung) zeigt
  jahresweise (Jahr-Filter) einen "Eröffnungssaldo {Jahr}" (Stand 1. Januar)
  gefolgt von allen Bewegungen des Jahres chronologisch mit laufendem Saldo
  je Zeile (neueste zuerst, wie überall sonst in der App) - Einzahlungen,
  Bar-Vorschüsse, Bar-Auszahlungen und Kautionsübergaben bewegen den
  laufenden Saldo, eine Korrektur ("Kassenbewegungen", z.B. eine
  nachträglich geänderte Vorschuss-/Auszahlungshöhe) erscheint dagegen nur
  als eigene, grau-kursive Informationszeile und bewegt den Saldo NICHT
  zusätzlich - der korrigierte Betrag steckt bereits im aktuellen
  Vorschuss-/Auszahlungsbetrag selbst, ein zusätzlicher Saldo-Sprung würde
  doppelt zählen. "Kassenprüfung" (neue Route `/kasse-pruefung`) enthält den
  Soll/Ist-Abgleich, die Liste "Bewegungen seit letzter Prüfung" sowie
  Freigabe/Wiedereröffnung - unverändert gegenüber vorher, nur auf eine
  eigene Seite verschoben. Beide Seiten teilen sich eine neue Saldo-Karte
  (`KassenSaldoKarte`), die den aktuellen Kassenbestand über die neue
  SQL-Funktion `kassenbestand_bis()` lädt - ersetzt eine zuvor
  clientseitige Summierung aus auf 100-200 Zeilen gedeckelten Listen
  (`.limit(100)`/`.limit(200)`), die bei mehr Belegen über mehrere Saisons
  hinweg zu einem stillschweigend falschen Kassensaldo geführt hätte;
  `kassenbestand_bis(p_bis)` rechnet stattdessen ein echtes SQL `SUM()` ohne
  Zeilenlimit und liefert per Parameter auch den Eröffnungssaldo eines
  beliebigen Zeitpunkts fürs Journal. Migration:
  `migration_2026-08-24_kassenbestand_bis.sql`. Auf Nutzer-Nachfrage
  ergänzt: jede Kassenprüfung erscheint im Journal zusätzlich als eigene,
  hervorgehobene Trennzeile an ihrem Prüfzeitpunkt (Soll/Ist/Differenz/
  Status, mit Hinweis "gesperrt" bei bereits freigegebenen Prüfungen) - eine
  Korrektur kollidiert dabei bewusst NICHT mit einer bereits freigegebenen
  Kassenprüfung: `vorschuss_korrigieren`/`abrechnung_korrigieren` prüfen
  schon vorher `ist_kassenpruefung_gesperrt(datum)` und verweigern die
  Änderung, solange der betroffene Zeitraum freigegeben ist (muss erst
  wiedereröffnet werden) - bestand bereits vor dem Journal, war aber ohne
  die neue Trennzeile schwer nachvollziehbar.
- "Suche"-Seite (alle Rollen): nach Name oder Personalnummer suchen und
  Arbeitsstunden (inkl. Notiz je Tag) sowie Vorschuss-Historie (inkl.
  Begründung) einer Person einsehen und als Übersicht für den Mitarbeiter
  ausdrucken - damit nicht nur die Verwaltung, sondern auch untere Ebenen
  selbst Auskunft geben können. Seit 2026-08-18 zusätzlich als
  "Auslage"-Positionen unter Vorschüsse aufgeführt: Buskosten,
  Fahrerkaution, Zimmerkaution und die berechnete Arbeitskleidung (je
  Hose/Jacke/Stiefel eine eigene Zeile, nur wenn > 0), aus `season_bonuses`
  abgeleitet. Datum zeigt "Saison {Jahr}" statt eines echten Datums, da
  `season_bonuses` nur einen gemeinsamen `updated_at`-Zeitstempel je
  Mitarbeiter+Jahr für alle Felder hat (kein präzises Einzeldatum je
  Position verfügbar). Seit 2026-08-20 zusätzlich ein eigener
  "Stundenkonto"-Block (Saldo + alle Buchungen des gewählten Saisonjahrs,
  Datum/Stunden/Art/Notiz) - damit auch für die betroffene Person selbst
  transparent nachvollziehbar ist, wie viele Stunden auf dem Konto stehen,
  auch im Ausdruck enthalten. Ausdruck ("Übersicht zum Aushändigen")
  verschlankt (Stand 2026-08-21, Nutzer-Meldung "stark aufgebläht"): alle
  fünf Tabellen nutzen jetzt dieselbe dichte Druckformatierung wie die
  Auszahlungsliste (`.print-dense-table`), und Zeilen ohne jede Information
  fallen weg - Tage komplett ohne Eintrag bei den Arbeitsstunden,
  Prämientage mit 0 € bei Zuckermais/Erdbeeren (nur im Ausdruck, die
  interaktive Ansicht bleibt vollständig). Die Arbeitsstunden-Tabelle im
  Ausdruck ist zusätzlich als echtes Wochenraster aufgebaut (Nutzer-Vorgabe
  "jede Zeile eine Woche"): eine Zeile je Kalenderwoche (Montag-Sonntag)
  von der ersten bis zur letzten Buchung, eine Spalte je Wochentag mit
  Datum + Stunden (oder Markierung/Notiz, falls vorhanden) in der Zelle,
  plus eine Wochensumme-Spalte am Ende jeder Zeile - bei einer vollen
  Saison damit ca. 20 statt 150+ Zeilen. Die interaktive (nicht gedruckte)
  Arbeitsstunden-Liste zeigt seit 2026-08-21 zusätzlich das Wochentag-Kürzel
  (Mo/Di/Mi/Do/Fr/Sa/So) vor jedem Datum
- Freitext-Notiz je Tag auf der Stundenerfassung (z.B. "krank", "zu
  spät") - erscheint auch auf der "Suche"-Seite
- 15-Wochen-Kontrolle (SV-Freiheit landwirtschaftliche Saisonarbeit,
  OI-004): Spalten auf der Personal-Seite (Rest bis 105 Tage,
  Austrittsdatum (empfohlen), SV-Status) sowie eine "Controlling"-Seite mit
  allen kritischen Fällen. Gilt nur für Personen, die noch NICHT
  sozialversicherungspflichtig sind (die Grenze ist die Obergrenze für
  sozialversicherungsFREIE Beschäftigung, für bereits Pflichtige
  gegenstandslos).
  **Grundlegend überarbeitet 2026-08-11 nach Nutzer-Recherche** - zwei
  Korrekturen gegenüber dem vorherigen Stand:
  1. Die **90-Arbeitstage-Grenze wurde entfernt**. Sie gilt nur für
     Beschäftigungen an weniger als 5 Tagen pro Woche, was im Betrieb nicht
     vorkommt ("findet praktisch keine Anwendung"). Maßgeblich sind allein
     die 15 Wochen = **105 Kalendertage** je Kalenderjahr. Damit entfällt
     auch die vorherige Kopplung "90-Tage-Grenze nur bei Vorbeschäftigung".
  2. Die 105 Tage müssen **nicht am Stück** laufen: alle kurzfristigen
     Beschäftigungen eines Kalenderjahres werden zusammengerechnet. Vorher
     zählte die reine Spanne vom ersten bis zum letzten Arbeitstag - eine
     Pause zwischen zwei Einsätzen zählte damit fälschlich mit. Jetzt
     werden die einzelnen Abschnitte summiert (Spalte "Beschäftigungstage",
     dazu "Abschnitte" als Anzahl).
  Abschnitts-Erkennung (Nutzer-Vorgabe): eine **Abrechnung beendet den
  Beschäftigungsabschnitt** - "Jetzt Abrechnen" setzt ohnehin schon
  `employees.aktiv = false`, die Person reist ab. Kommt sie später zurück,
  beginnt ein neuer Abschnitt. Dafür gibt es die neue Historie-Tabelle
  `saison_abrechnungen`: `season_bonuses` hat `unique (employee_id,
  saison_jahr)` und überschreibt `abgerechnet_am` bei jeder erneuten
  Abrechnung, für die Abschnittsbildung braucht es aber jeden einzelnen
  Zeitpunkt. Freie Tage, Wochenenden und Urlaub INNERHALB eines Abschnitts
  zählen bewusst mit - das Beschäftigungsverhältnis läuft ja weiter.
  Ein Beschäftigungstag ist ab jetzt ein Tag mit Stunden ODER mit
  Markierung (z.B. "U" für Urlaub, Nutzer-Vorgabe 2026-08-11: während
  Urlaub besteht das Beschäftigungsverhältnis fort) - vorher zählten nur
  Tage mit Stunden > 0.
  **Bugfix 2026-08-24 (Nutzer-Fall: historische Abrechnung am 25.06.,
  0-Std.-Tage davor wurden nicht mitgezählt, Abschnitt endete fälschlich
  schon am letzten Tag mit Stunden > 0):** "Tag mit Stunden" in
  `employee_sv_abschnitte` prüfte technisch weiterhin `stunden > 0` statt
  `stunden is not null` - ein echter "0 Std."-Tag (Person anwesend, aber
  nicht gearbeitet) fiel damit fälschlich heraus, obwohl dieselbe
  Begründung wie bei einem Urlaubstag zutrifft und `season_summary.
  anwesenheitstage` eine "0" schon immer mitzählt. Jetzt konsistent
  `stunden is not null`. Migration:
  `migration_2026-08-24_beschaeftigungstag_null_check.sql`.
  Bisherige Beschäftigungstage bei anderen deutschen Arbeitgebern laut
  SV-Fragebogen werden weiterhin dazugerechnet (rechtlich zählt das
  Kalenderjahr über ALLE deutschen Arbeitgeber zusammen).
  Zusätzlich gleicht die Controlling-Seite den tatsächlichen
  Beschäftigungszeitraum mit dem SV-freien Zeitraum laut den
  SV-Fragebogen-Angaben ab (siehe unten) - beginnt die Beschäftigung vor
  dessen Anfang, geht sie über dessen Ende hinaus, oder fällt sie in eine
  Lücke zwischen "Bezahlter Urlaub" und "Freistellung", zählt das genauso
  als kritisch wie eine Überschreitung der 105 Tage. Das empfohlene
  Austrittsdatum ist das frühere von 15-Wochen-Ende und dem Ende des
  SV-freien Zeitraums laut Angaben; das 15-Wochen-Ende berücksichtigt dabei
  bereits verbrauchte Tage aus früheren Abschnitten und die
  Vorbeschäftigung (der laufende Abschnitt darf noch genau so lange laufen,
  wie das Budget hergibt).
  Wichtig zum Verständnis der "Controlling"-Seite: die dortige
  "kritisch"-Liste ist bewusst reaktiv - eine Person landet erst dort,
  sobald tatsächlich AN oder NACH dem Grenzdatum gearbeitet wurde (nicht
  schon am Tag, an dem die Grenze erreicht wird). Wer wissen will, wann
  eine Person die Grenze erreicht, bevor es kritisch wird, sieht das
  proaktiv in der Spalte "Austrittsdatum (empfohlen)" auf der
  Personal-Seite.
  Auf "Personal → Sozialversicherung" (siehe unten) zwei Spalten dazu:
  "Angewendete Regel" (15 Wochen/105 Tage, mit Hinweis auf mehrere
  Abschnitte bzw. "abzgl. X Tage Vorbeschäftigung" - Stand 2026-08-11:
  vorher stand dort irreführend "+ X Tage", dabei wird die Vorbeschäftigung
  vom 105-Tage-Budget ABGEZOGEN) und "Ende der SV-Freiheit (Tage)" -
  Resttage bis zum empfohlenen Austrittsdatum, gelb unter 7 Tagen, rot bei
  bereits überschrittenen (negativen) Tagen; erst berechenbar, sobald
  mindestens ein Arbeitstag erfasst ist. Bei Abrechnungsart
  "sozialversicherungspflichtig" zeigen "Angewendete Regel", "SV-freier
  Zeitraum", "Ende der SV-Freiheit" und "Vorbeschäftigung Deutschland"
  jetzt "entfällt" statt einer Zahl/Regel (Stand 2026-08-11) - für bereits
  SV-pflichtige Personen sind alle SV-Freiheits-Prüfungen gegenstandslos,
  auch wenn (z.B. aus der Zeit davor) noch ein SV-Fragebogen existiert. Auf der Controlling-Seite
  zusätzlich eine rein proaktive Übersicht "Nächste 10, deren SV-freier
  Zeitraum endet" (unabhängig vom "kritisch"-Status, sortiert nach
  empfohlenem Austrittsdatum, NUR aktive Personen - Nutzer-Vorgabe
  2026-08-10) - ergänzt die reaktive "kritisch"-Liste um eine echte
  Vorausschau. Direkt darunter eine rein dokumentierende Übersicht
  "SV-Freiheit Diskrepanz": bereits INAKTIVE Personen, bei denen die
  tatsächliche Beschäftigung nachträglich betrachtet den SV-freien Zeitraum
  laut Angaben überschritten hat (Beginn zu spät, Ende überschritten, oder
  Lücke zwischen "Bezahlter Urlaub"/"Freistellung" getroffen) - bewusst
  ohne die 15-Wochen-Gründe (die sind für bereits ausgeschiedene Personen
  keine akute Handlungsaufforderung mehr, nur die SV-frei-Diskrepanz bleibt
  für die Dokumentation relevant)
- Eigene Unterseite "Personal → Sozialversicherung" (nur admin/hr):
  SV-Fragebogen ("Fragebogen zur Feststellung der
  Versicherungspflicht/Versicherungsfreiheit rumänischer
  Saisonarbeitnehmer") - manuell vom ausgefüllten/gestempelten
  Papierformular abgetippt (bewusst KEIN automatisches Auslesen -
  Handschrift/Kästchen/rumänische Behördenstempel sind dafür nicht
  verlässlich genug bei einem Formular mit sozialversicherungsrechtlicher
  Bedeutung). Ein Datensatz je Person UND Saison-Jahr, damit im Folgejahr
  geprüft werden kann, ob sich die Angaben (z.B. Hausfrau/Hausmann,
  Selbstständigkeit) verändert haben - die Seite zeigt dafür die
  diesjährigen Angaben direkt neben einem "Zum Vorjahr geändert"-Hinweis
  je Person, zum unmittelbaren Vergleich. Dasselbe Eingabeformular ist
  auch direkt in der Anreiseliste nutzbar (person für person, gruppenweise
  wie der Rest des Anreise-Workflows) - beide Stellen teilen sich dieselbe
  Komponente (`components/SvFragebogenFormular.tsx`). Live berechnete Auswertung
  "Bestanden"/"Nicht bestanden" nach der allgemeinen
  Berufsmäßigkeits-Regel (kurzfristige Beschäftigung ist nur SV-frei, wenn
  sie nicht die Haupt-Existenzgrundlage der Person ist) - reine Warnung,
  keine automatische Sperre, am Ende entscheidet weiterhin der Nutzer
  (z.B. über den bestehenden "Statuswechsel"). Eigenes Feld "Erfassungsbogen
  unvollständig/fehlerhaft" mit Begründung - unterscheidet "bereits
  geprüft, aber nicht verwertbar" (z.B. fehlende Angaben/Bestätigung) von
  "noch gar nicht angesehen"; zählt ebenfalls automatisch als nicht
  bestanden. Eigenes Feld "bisherige Beschäftigung in Deutschland (dieses
  Kalenderjahr, andere Arbeitgeber)", markierbar als durch eine
  Lohnprogramm-Rückmeldung ausgelöst - fließt direkt in die
  15-Wochen-Kontrolle oben ein (Kern der Regel: das Kalenderjahr zählt über
  ALLE deutschen Arbeitgeber zusammen, nicht nur die Tage bei uns).
  Erfassbar wahlweise als Zeitraum von/bis ODER als reine Tage-Zahl (Stand
  2026-08-11) - je nachdem, was das Lohnprogramm bzw. die Person meldet.
  Bei ausgefülltem Zeitraum werden die Tage daraus berechnet (Kalendertage
  inklusive beider Randtage, gleiche Zählweise wie bei der 15-Wochen-
  Grenze), live schon beim Ausfüllen angezeigt; das Tage-Feld wird dann
  gesperrt, damit kein widersprüchlicher Wert stehen bleibt. Ersetzt weiterhin nicht die rechtliche Prüfung der
  Sozialversicherungsbefreiung im Einzelfall selbst (die hier hinterlegte
  Bestanden/Nicht-bestanden-Logik ist unser Verständnis der allgemeinen
  Regel, keine steuerberaterlich geprüfte Rechtsauskunft für den
  Einzelfall). Suche nach Name/Personalnummer wie im Personalstamm (Stand
  2026-08-09), dazu eine Spalte "Herkunft" direkt neben dem Namen (aus den
  Personalstammdaten, Stand 2026-08-11). Status-Anzeige verfeinert (Stand 2026-08-09): bei
  Abrechnungsart "sozialversicherungspflichtig" zeigt die Spalte direkt
  "SV-Pflicht." statt einer Bestanden/Nicht-bestanden-Auswertung (eine
  SV-Freiheits-Feststellung ergibt für bereits SV-pflichtig Beschäftigte
  keinen Sinn mehr) - "Bestanden" heißt jetzt "✓ SV-Frei". Stand 2026-08-10:
  zusätzlich eine Spalte "SV-freier Zeitraum", live aus den Angaben
  abgeleitet - bei "Beschäftigung im Heimatland" die Spanne aus "Bezahlter
  Urlaub" UND "Freistellung aus anderem Grund" (beide zusammen sind
  SV-frei, "Unbezahlter Urlaub" zählt bewusst nicht mit; eine echte Lücke
  zwischen den beiden Teilzeiträumen wird als "⚠ Lücke" mit Datum
  angezeigt), bei Schule/Studium der Schulferienzeitraum (nur wenn
  "Schulferien während Beschäftigung" angekreuzt ist), bei Hausfrau/
  Hausmann, Rentenbezug und Selbstständigkeit im Heimatland ein offener
  Zeitraum, in den Angaben ohne Enddatum. Wichtige Korrektur 2026-08-11
  (Nutzer): bei diesen drei offenen Zuständen beginnt der SV-freie Zeitraum
  mit dem tatsächlichen Arbeitsbeginn ("aktiv seit"), NICHT mit dem
  "seit"-Datum aus dem Formular - dieses weist nur nach, seit wann der
  Zustand besteht ("Anders macht das auch keinen Sinn"). Bei Beschäftigung
  im Heimatland und bei Schulferien bleibt es dagegen beim echten Von-Datum
  aus den Angaben, denn das sind echte Von-Bis-Zeiträume: nur so kann die
  Prüfung "SV-freier Zeitraum beginnt zu spät" überhaupt noch auslösen.
  Fehlkorrektur vermieden (Nutzer-Feedback 2026-08-10, erneut bestätigt
  2026-08-11): dieser offene Zeitraum wird NIE als "unbefristet"/"offen"
  angezeigt, da er immer durch die 15-Wochen-Grenze (105 Kalendertage)
  begrenzt ist -
  sobald der tatsächliche Arbeitsbeginn bekannt ist (mind. ein Arbeitstag
  mit Stunden > 0 erfasst), zeigt die Spalte immer das konkrete, daraus
  berechnete Enddatum (`austrittsdatum_empfohlen`, per Tooltip mit dem
  Hinweis, ob es aus den Angaben oder aus der Tage-Grenze stammt). Nur
  wenn noch gar kein Arbeitstag erfasst ist UND die Angaben kein Enddatum
  nennen, lässt sich rechnerisch kein Datum bilden - dann steht dort der
  Regeltext "15 Wochen ab Arbeitsbeginn" statt eines Datums. Dieser SV-freie Zeitraum wird auf der
  Controlling-Seite gegen den tatsächlichen Beschäftigungszeitraum geprüft
  (siehe dort)
- "Abschnitts-Historie" auf Personal → Sozialversicherung (Stand
  2026-08-13, nur admin/hr, je Person aufklappbar): löst das Problem beim
  In-Betrieb-Nehmen der App - Mitarbeiter/Stunden wurden importiert, aber
  reale Abrechnungen VOR App-Start (altes Excel-System) sind der App
  unbekannt. Die 15-Wochen-Abschnitts-Erkennung erkennt Abschnitte
  ausschließlich über `saison_abrechnungen`-Einträge, ohne Nachtrag
  rechnet die App fälschlich mit einem einzigen, nie unterbrochenen
  Abschnitt seit dem ersten importierten Arbeitstag. Neue Funktionen
  `saison_abrechnung_nachtragen`/`_entfernen` (admin/hr-only) legen NUR
  einen "Uhr zurückgesetzt"-Marker in `saison_abrechnungen` an - OHNE
  Auszahlungsbeleg/Beträge/`employees.aktiv` anzufassen (die Person
  arbeitet ja aktuell weiter, das reale Geld ist bereits über das alte
  System abgerechnet). Die bestehende 105-Tage-Logik selbst bleibt
  unverändert - sie bekommt nur die fehlende historische Information.
  `auszahlungsbeleg_id` unterscheidet einen Nachtrag ("manuell
  nachgetragen", entfernbar) von einer echten App-Abrechnung ("echte
  Abrechnung in der App", nicht über dieses Werkzeug löschbar). Neue
  Komponente `components/AbrechnungsHistorie.tsx`. Migration:
  `migration_2026-08-13_historische_abrechnung.sql`. Bugfix noch am
  selben Tag: die Historie war fälschlich ausgeblendet bei Personen mit
  Abrechnungsart "sozialversicherungspflichtig" - genau die, bei denen die
  fehlende historische Abrechnung am ehesten zu einer voreiligen Umstellung
  geführt haben dürfte. Jetzt immer sichtbar (reines Fakten-Protokoll,
  keine SV-Freiheits-Prüfung)
- **Statuswechsel-Kette sichtbar gemacht (Stand 2026-08-24, drei
  zusammenhängende Nutzer-Meldungen nach einem echten Statuswechsel-Test):**
  1. "Erfassen" des SV-Fragebogens entfällt jetzt komplett bei
     `sozialversicherungspflichtig` (Button zeigt "Historie" statt
     "Erfassen"/"Bearbeiten", Formular wird nicht mehr angeboten) - die
     Abschnitts-Historie bleibt bewusst weiter erreichbar (siehe Bugfix
     oben, genau diese Personen brauchen sie am dringendsten).
  2. Neue Sicht `employee_status_chain` (verknüpft eine Personalnummer über
     `employees.vorgaenger_employee_id` mit ihrer Vorgänger-/Nachfolge-
     Nummer, Übergangsdatum aus dem ersten übertragenen Arbeitstag der
     neuen Nummer hergeleitet - der Stichtag selbst wird nirgends
     gespeichert) speist zwei neue Spalten auf Personal → Sozialversicherung:
     "Status war" (Abrechnungsart vor dem Statuswechsel) und "… seit" (Datum
     des aktuellen Status bzw., auf der jetzt inaktiven alten Nummer - Stand
     desselben Tages nach Nutzer-Feinschliff "nicht 'seit', sondern 'von...
     bis' reinschreiben" - der abgeschlossene Zeitraum "von {eigener
     Beschäftigungsbeginn} bis {Vortag des Wechsels}" plus ein kleiner
     Verweis auf die neue Nummer, z.B. "von 01.06.2026 bis 23.08.2026
     (→ SV-Pfl. ab 24.08.2026)"). Löst konkret: "Überschritten seit X Tagen"
     auf einer inaktiven, längst per Statuswechsel korrekt umgestellten
     Nummer wirkte wie ein weiterhin offenes Problem - die 105-Tage-Prüfung
     selbst bleibt unverändert korrekt, es fehlte nur die sichtbare
     Verknüpfung.
  3. Lohnübersicht: neuer Schnellfilter "nur offene Statuswechsel" (nutzt
     dieselbe Sicht) - zeigt gezielt inaktive Personen mit Nachfolge-Nummer,
     die noch NICHT abgerechnet sind, statt sie in der allgemeinen
     "inaktive anzeigen"-Liste unter echten Ex-Mitarbeitern zu verlieren.
     Zusätzlich Badge "⚠ Statuswechsel offen" in der Status-Spalte. Die
     zugrunde liegenden Daten waren schon vorher korrekt (`season_summary`/
     `season_summary_monat` filtern nicht nach `aktiv`, "inaktive anzeigen"
     macht sie technisch schon sichtbar/abrechenbar) - das eigentliche
     Problem war reine Auffindbarkeit.
  Migration: `migration_2026-08-24_statuswechsel_status_chain.sql`.
- Klarheits-Pass 2026-08-14 (Nutzer: "Die verschiedenen Abschnitte müssen
  transparent benannt und gerechnet werden"): "Aktiv seit" im Personalstamm
  folgt jetzt der Vorgänger-Kette (springt nach einem Statuswechsel nicht
  mehr fälschlich auf den Wechsel-Stichtag); neue Spalte "Aktueller
  Abschnitt seit" auf Controlling zeigt den Beginn des gerade laufenden
  (nicht des allerersten) Beschäftigungsabschnitts - taucht auch in
  "Angewendete Regel" auf der SV-Seite auf. Tooltips ergänzt, die
  gleichnamige, aber unterschiedlich berechnete Spalten (z.B. "1.
  Arbeitstag" auf Controlling vs. auf der Anreiseliste-Kontrolle)
  unterscheiden
- Bugfix 2026-08-15: bei mehreren Beschäftigungsabschnitten mit einer
  echten Pause dazwischen konnte die App fälschlich "SV-Status:
  Überschritten" zeigen, wenn diese Pause zufällig mit einer im
  SV-Fragebogen deklarierten Lücke (zwischen Bezahltem Urlaub und
  Freistellung) zusammenfiel - obwohl an den betroffenen Tagen nie
  gearbeitet wurde. Die Prüfung verglich bisher gegen die Spanne über
  ALLE Abschnitte einer Saison hinweg statt zu prüfen, ob ein einzelner
  Abschnitt die Lücke wirklich überschneidet
- Anpassungen 2026-08-15 nach Nutzer-Feedback: "Zuletzt abgerechnet am" im
  Personalstamm zeigt jetzt auch manuell nachgetragene historische
  Abrechnungen (nicht mehr nur echte "Jetzt Abrechnen"-Aktionen), Quelle
  umgestellt von `season_bonuses` auf das umfassendere
  `saison_abrechnungen`. Die "⚠ Lücke"-Anzeige auf Personal →
  Sozialversicherung heißt jetzt "Davon NICHT SV-frei" (macht klarer, dass
  es eine Ausnahme INNERHALB des angezeigten Zeitraums ist, kein eigener
  konkurrierender Zeitraum), mit Farbe/Dringlichkeit je nachdem, ob in der
  Lücke tatsächlich gearbeitet wurde
- Tage-Aufschlüsselung als Tooltip (Stand 2026-08-15, Nutzer-Vorgabe nach
  wiederholter Nachfrage "Wie sähe das aus?"): "Rest bis 105 Tage"
  (Personal, Controlling) und "Angewendete Regel" (Personal →
  Sozialversicherung) zeigen jetzt beim Überfahren mit der Maus genau, wie
  sich die Zahl zusammensetzt - jeder Beschäftigungsabschnitt einzeln mit
  Zeitraum, plus Vorbeschäftigung, plus Summe. Neue Sicht
  `employee_sv_abschnitte` (vorher nur intern in `employee_sv_pruefung`
  berechnet) ist jetzt die einzige Quelle der Abschnitts-Logik für beide
  Sichten
- Arbeitsvertrag_Vorlage.docx aktualisiert (2026-08-15, vom Nutzer in Word
  bearbeitet) - Platzhalter geprüft und alle 8 intakt
- Bugfix 2026-08-13: ein versehentlich gesetzter Haken samt Datum (z.B.
  "unbezahlter Urlaub") im SV-Fragebogen ließ sich nach dem Speichern
  nicht mehr entfernen - Fehler "invalid input syntax for type date: ''".
  Betraf systematisch alle ~15 Datumsfelder in `SvFragebogenFormular.tsx`:
  ein geleertes `<input type="date">` liefert `""`, nicht `null`, das
  wurde ungefiltert an die `date`-Spalte geschickt. Alle betroffenen
  `onChange`-Handler auf `e.target.value || null` umgestellt - keine
  Migration nötig, reine Frontend-Änderung
- "Statuswechsel" im Personalstamm (nur admin/hr, z.B. beim Erreichen der
  15-Wochen-Grenze): legt eine neue, verknüpfte Person mit "a" an
  der Personalnummer an (z.B. "342" → "342a") mit wählbarer neuer
  Abrechnungsart und Stichtag (Pflichtfeld), deaktiviert die alte Nummer
  (keine Löschung, ADR-011) und hängt deren hochgeladene Dokumente auf die
  neue Nummer um. Stand 2026-08-11 (Nutzer-Korrektur - vorher blieben
  Stunden nach dem Stichtag fälschlich an der alten, jetzt inaktiven
  Nummer stehen): Stunden AB DEM STICHTAG werden automatisch auf die neue
  Nummer übertragen, weil ab dann die neue Abrechnungsart gilt; Stunden
  davor bleiben an der alten Nummer. Vorschüsse und Prämien/Boni bleiben
  bewusst bei der alten Nummer unverändert - sie hängen an der Auszahlung,
  nicht am Beschäftigungszeitraum. Liegt der zu übertragende Zeitraum in
  einem per Monatsabschluss bereits gesperrten Monat, wird der
  Statuswechsel komplett verweigert (nicht nur teilweise durchgeführt) -
  klare Fehlermeldung, welcher Monat zuerst entsperrt werden muss; das gilt
  ausnahmslos für alle Rollen inkl. admin, wie beim Monatsabschluss selbst.
  Zwei eigene Zeilen in der Lohnübersicht, je eigene Netto-Berechnung
  passend zur jeweiligen Abrechnungsart - beide Nummern bleiben über eine
  "Verknüpfung"-Spalte im Personalstamm als dieselbe Person erkennbar.
  Nur verfügbar, solange die Person noch nicht sozialversicherungspflichtig
  ist (ein Wechsel weg davon ist nicht möglich/sinnvoll)
- Mehrfachauswahl im Personalstamm (nur admin/hr, gleiches Muster wie bei
  den Vorschüssen): Gruppe oder Herkunft als Filter fügt alle passenden,
  aktuell sichtbaren Personen der Auswahl hinzu, zusätzlich einzeln per
  Checkbox - dann "Alle Deaktivieren"/"Alle Reaktivieren" auf einmal (z.B.
  praktisch direkt nach einem Reimport, bei dem alle Personen erstmal
  aktiv sind), außerdem "Auswahl zu Gruppe hinzufügen" um mehreren
  ausgewählten Personen auf einmal eine Gruppe zuzuweisen
- "Dokumente"-Button im Personalstamm (nur admin/hr, für jede aktive
  Person jederzeit verfügbar): Arbeitsvertrag/Werkmietvertrag/
  Bankverbindungs-Nachweis aus der Vorlage neu erzeugen und herunterladen,
  z.B. für einen Nachdruck. Bisher war die Dokumenterzeugung nur einmalig
  über "Anreise vorbereiten" in der Anreiseliste erreichbar. Zusätzlicher
  Button "Arbeitsvertrag (SV-Pflichtig)" (Stand 2026-08-28, Nutzer-Vorgabe:
  "Beim Statuswechsel auf SV-Pflichtig brauchen die Leute auch einen neuen
  Arbeitsvertrag, der dann auch wieder unterschrieben werden muss") - nur
  sichtbar bei Abrechnungsart "sozialversicherungspflichtig", nutzt eine
  eigene Vorlage (`Arbeitsvertrag_SV_Pflichtig_Vorlage.docx`, dieselben
  Platzhalter wie der normale Arbeitsvertrag) mit dem an die
  Sozialversicherungspflicht angepassten Vertragstext
- Menüpunkt "Anbau" (nur admin/erntewirtschaft, Stand 2026-08-11):
  Anbauplanung Erdbeeren als Ersatz für die gewachsene Excel
  "Erdbeerpflanzplanung.xlsx" (14 Jahresblätter, jedes per Copy/Paste aus
  dem Vorjahr). Struktur Feld → Anbau-Jahrgang → Tunnel → Bepflanzung:
  jeder Tunnel hat seine eigene Länge und Reihenzahl, und zwei Sorten in
  einem Tunnel sind einfach zwei Bepflanzungszeilen. Das löst drei Probleme
  der Excel auf einmal: dort sind die neun Sorten SPALTEN (pro Zeile meist
  nur 1-2 gefüllt, jede neue Sorte = Strukturänderung in allen Blättern,
  Spaltenzahl dadurch von 24 auf 47 gewachsen); eine ZEILE ist mal ein
  ganzes Feld, mal nur ein Teilstück ("Brücke" 3x mit 230/210/138 m,
  "Vogel" 2x, "Dünenfeld" 2x - 24 Planzeilen für 19 echte Felder), weil
  unterschiedlich lange Tunnel nicht abbildbar sind; und die Spalte "Tunnel"
  ist nur eine Anzahl, Länge und Reihenzahl gelten pauschal für alle.
  Laufende Meter und Pflanzenzahl werden gerechnet (Länge × Reihen ×
  Pflanzen je laufendem Meter - in der Excel Spalte I mit 4,37 im Feld bzw.
  8 im Glashaus) statt getippt; die dortige Kontrollspalte AF, die wegen
  Kommastellen nie sauber auf 0 aufgeht, entfällt damit ersatzlos.
  Erfassungshilfen für die Größenordnung (2026: 182 Tunnel auf 19 Feldern):
  Sammelanlage "Tunnel 1-16 mit gleicher Länge und Reihenzahl anlegen",
  "Sorte für Tunnel 1-8 zuweisen" (setzt die Sorte auf alle Reihen), "Tunnel 3-7 auf anderes Feld verschieben"
  (für den Umzug in Vorbereitung auf die Cotura) und "Aus Vorjahr
  übernehmen" - letzteres ersetzt das Copy/Paste zwischen den Blättern,
  ohne die dort entstandenen #REF!-Bezüge, und erhöht das Standjahr
  automatisch. Zwei Sorten in einem Tunnel gehen über "+ Sorte" direkt an
  der Bepflanzung, wobei die Reihenzahl je Sorte angegeben wird (z.B. 4 und
  4 bei 8 Reihen); leer gelassen belegt eine Sorte alle Reihen. Belegen
  mehrere Sorten zusammen mehr Reihen als der Tunnel hat, warnt die Zeile -
  sonst wäre die Pflanzenzahl zu hoch. Die Tunnel sind frei sortierbar
  (Ziehen oder Pfeile, Stand 2026-08-11), damit die Reihenfolge in der
  Liste die tatsächliche Anordnung auf dem Feld abbildet - in der Excel
  waren sie nur nach Länge gruppiert, was mit der Anordnung nichts zu tun
  hat; die Tunnelnummer bleibt davon unberührt. Der Tunnel-Bereich steht
  bewusst UNTER der Feldtabelle statt als aufgeklappte Zeile mittendrin,
  damit die Feldübersicht beim Arbeiten vollständig sichtbar bleibt.
  Die Folienrollen-Nummer (Cotura) steht vorerst als Textfeld
  am Tunnel; ein eigenes Folien-Register mit Zustand und Einsatzhistorie ist
  als zweiter Schritt vorgesehen. Unterreiter "Bestellung": Bedarf je Sorte
  kommt live aus der Planung, dazu Bestellmenge, eigener Bestand und
  Reserve-Satz je Sorte - ersetzt die Handarbeit in den Excel-Zeilen 29-36
  samt der dort negativ geführten Restbestände. Unterreiter "Felder": die
  Stammdaten der Erdbeer-Felder (Name, Größe, aktiv). Standen vorher unter
  "Prämien → Erdbeeren", was seit der Anbauplanung nicht mehr passt
  (Nutzer-Vorgabe 2026-08-11: "In Prämien dürfen nur die Sätze verwaltet
  werden, nicht aber die Parzellen"). Bewusst schlank - Sorte und
  Pflanzenzahl standen dort früher ebenfalls, ergeben sich jetzt aber aus
  der Planung je Tunnel und wären als Zweitangabe nur eine zweite Wahrheit.
  Je Feld ist sichtbar, für welche Saisons eine Planung besteht. Die Rolle
  erntewirtschaft darf Felder ab jetzt selbst anlegen/ändern (vorher nur
  admin), sonst wäre die eigene Planungsseite nicht bedienbar. **Das Prämiensystem bleibt
  davon unberührt** (Nutzer-Vorgabe): Rohdaten und Norm-/Bonus-Sätze hängen
  weiterhin nur an der Parzelle, die Prämien-Erfassung zeigt unverändert die
  Feldauswahl.
- Seite "Protokoll" (nur admin, Stand 2026-08-11): macht das seit Beginn
  mitlaufende Audit-Log sichtbar - wer hat wann was geändert, mit Filter
  nach Person (Name/Personalnummer), Bereich und Zeitraum. Aufklappen zeigt
  die einzelnen Feldänderungen als Vorher/Nachher-Vergleich; rein
  technische Felder (updated_at, version …) werden dabei ausgeblendet.
  Abgedeckt sind Personalstamm, Stunden, Vorschüsse, Prämien, Kassenbuch,
  Kassenprüfung, Dokumente, Monatsabschluss und Personalplanung. Bewusst
  admin-only, da die Einträge ganze Datensätze und damit auch sensible
  Felder (IBAN, SV-Nr.) enthalten - die Datenbank-Policy erlaubt zusätzlich
  der Rolle pruefer den Lesezugriff (bestehende Regelung für die
  Kassenprüfung), diese Detailansicht bleibt aber admin. Ergänzend zeigt
  der Personalstamm für admin eine Spalte "Zuletzt geändert" (Datum +
  Nutzer der letzten Änderung am Stammdatensatz). Bei den Prämien-Rohdaten
  wurde dabei eine Lücke geschlossen: dort wird als einzigem Bereich
  tatsächlich gelöscht (ein geleertes Feld entfernt den Eintrag), was
  bisher nicht protokolliert wurde - der Trigger erfasst jetzt auch
  "delete"
- "Controlling"-Seite, Abschnitt "Es arbeiten folgende Personen mit offenem
  Status" (Stand 2026-08-11, ganz oben auf der Seite): Personen, die noch
  auf der Anreiseliste stehen - Arbeitsvertrag nicht gedruckt,
  SV-Fragebogen nicht bestanden, fehlende Ausweiskopie/Führerschein-Kopie/
  Hochzeitsurkunde/DHH-Formular, Buskosten nicht erfasst - aber bereits
  Stunden in der Stundenerfassung haben. Mit Klartext-Grund und "Tage seit
  Status offen" (Tage seit dem ersten Arbeitstag, ab 14 Tagen rot statt
  gelb) sowie Sprung-Link in die Anreiseliste. Bewusst
  saisonübergreifend, nicht nach Saison-Jahr gefiltert. Die zugrunde
  liegende Sicht `anreiseliste_offen_arbeitend` läuft bewusst NICHT als
  security_invoker (sonst wäre sie für die Rolle management leer, da
  personal_kandidaten admin/hr-only ist) und gibt dafür ausschließlich
  Name/Personalnummer/Herkunft und die offenen Punkte aus - keine
  sensiblen Personaldaten
- "Controlling"-Seite, Abschnitt "Stundenmonitoring": listet alle Personen
  mit mindestens einem Tag über 12,00 Stunden in der Stundenerfassung
  (Saison-Jahr-Filter), aufklappbar je Person mit allen betroffenen Tagen.
  Der ganze Abschnitt ist zusätzlich als Ganzes ein-/ausklappbar (Stand
  2026-08-10, standardmäßig eingeklappt) - im eingeklappten Zustand nur
  die Gesamtzahl "Anzahl Tage > 12 Std." über alle Personen. Stand
  2026-08-21 (Nutzer-Vorgabe: "beschleunigt unsere Arbeit im Controlling
  enorm"): das Stunden-Feld je Tag ist direkt hier bearbeitbar (ersetzt den
  vorherigen Sprung-Link zur Stundenerfassung) - inkl. Monatsabschluss-
  Sperre-Anzeige (🔒) und derselben optimistischen Sperre wie auf der
  Stundenerfassung. Daneben, sofern berechtigt, dieselbe Stundenkonto-
  Werkzeugleiste wie dort (Buchen/Umwandeln/Historie). Beide Seiten nutzen
  jetzt dieselbe, geprüfte Speicherlogik (`lib/workEntrySpeichern.ts`) und
  dieselbe Stundenkonto-Komponente (`components/StundenkontoBereich.tsx`)
  statt zweimal gepflegten Code - Rollen zentral in
  `lib/stundenkontoRechte.ts`. "In Auszahlung umwandeln" jetzt zusätzlich
  für hr/management sichtbar (vorher nur admin/lohnabrechnung),
  weiterhin NICHT für zeiterfassung. Stand 2026-08-23 (Nutzer-Vorgabe): das
  "Buchen"-Datumsfeld übernimmt auf der Stundenerfassung als Standard den
  gerade bearbeiteten Tag statt immer "heute" - neuer optionaler Prop
  `bearbeitetesDatum` an `StundenkontoBereich`, auf dem Controlling-
  Stundenmonitoring (kein einzelner bearbeiteter Tag vorhanden) bewusst
  nicht gesetzt, bleibt dort bei "heute"
- "Controlling"-Seite, Abschnitt "Abweichungen bei Auszahlungen": listet
  alle bereits abgerechneten Personen, deren Live-Berechnung inzwischen
  vom eingefrorenen Schnappschuss abweicht (das „⚠" von der
  Auszahlungen-Seite), mit konkreter Angabe je Feld (alt → neu) statt nur
  des Warnzeichens
- "Controlling"-Seite, Abschnitt "Urlaubstage" (Stand 2026-08-09): Anspruch
  ist 2 Urlaubstage je vollem Kalendermonat der Beschäftigung (1. bis
  letzter Tag mit Stunden oder Markierung) - ein Monat zählt nur, wenn die
  Beschäftigung Monatsanfang UND -ende dieses Monats abdeckt (z.B.
  02.05.-29.07. ergibt nur 2 Tage, da nur Juni ein voller Monat ist).
  Listet Personen, bei denen mehr "U"-markierte Tage erfasst wurden als
  der berechnete Anspruch hergibt. Zweiter Block "Resturlaub" (Stand
  2026-08-20, Nutzer-Vorgabe: "der eigentliche Use Case ist zu wenig
  genommener Urlaub") - gleicher Anspruch, umgekehrte Richtung: Personen,
  bei denen weniger "U"-Tage erfasst wurden als der Anspruch hergibt.
  Bereits inaktive Personen werden separat und hervorgehoben als
  "Abgeltung fällig" gelistet (unused Resturlaub muss bei Beendigung in
  der Regel ausgezahlt werden), aktive Personen normal ("kann noch
  genommen werden")
- **"Controlling"-Seite in 5 aufklappbare Themenblöcke gegliedert (Stand
  2026-08-24, Nutzer-Vorgabe: "Da steht momentan auch einfach alles
  untereinander"):** die bisher 8 Abschnitte standen stur untereinander -
  weitet das bereits vorhandene Stundenmonitoring-Muster (eingeklappt nur
  eine Kennzahl, aufgeklappt die volle Tabelle) über die ganze Seite aus
  (neue, wiederverwendbare `Gruppe`-Komponente). Zusammengefasst zu:
  "Anreiseliste – offener Status", "Sozialversicherung (105-Tage)"
  (enthält die drei bisherigen Einzelabschnitte 15-Wochen-Kontrolle/bald
  endend/Diskrepanz als Unterabschnitte), "Stundenmonitoring",
  "Abweichungen bei Auszahlungen" und "Urlaub" (Überzogen + Resturlaub als
  Unterabschnitte). Nur "Sozialversicherung (105-Tage)" startet
  aufgeklappt (wichtigster, akutester Block), die anderen vier eingeklappt
  mit einer Kennzahl (z.B. "3 kritische Fälle · 2 bald endend · 1
  Diskrepanz(en)"). Reine Darstellungsänderung - alle Abfragen, Filter und
  die Inline-Bearbeitung im Stundenmonitoring unverändert
- Farbschema auf Lohnübersicht und Auszahlungen (Stand 2026-08-09, reine
  Optik, keine Funktionsänderung): Brutto-Spalte durchgehend hellbraun,
  Netto-Spalte durchgehend hellgrau (Kopf + Zellen); die Überschriften von
  Kautionen (Fahrer-/Zimmerkaution) immer blau, Abzügen (Verpflegung/
  Unterkunft, Vorschüsse, Buskosten, Kleidung) immer rot - Zulagen/Boni
  sind aktuell in der Brutto-Summe enthalten, es gibt noch keine eigene
  Spalte dafür (Grün ist als Kategorie vorgesehen, siehe `lib/farben.ts`)
- Neuer Menüpunkt "Prämien" (Stand 2026-08-09) mit Untermenüs Spargel/
  Erdbeeren/Zuckermais - ersetzt schrittweise drei bisher separate
  Excel-Dateien ("Prämien Spargel/Erdbeeren/Zuckermais 2026.xlsx"), die den
  Personalstamm bislang nur als kopierte Werte nutzten. Start mit
  Zuckermais (Prämien → Zuckermais, admin/hr/zeiterfassung): pro
  Mitarbeiter und Tag werden Kisten und Stunden erfasst, die Prämie wird
  automatisch berechnet (Norm in Kolben/Std., Kolben je Kiste und €-Satz je
  Kolben über der Norm - alle drei mit "gültig ab" versioniert, da sie sich
  im Saisonverlauf ändern können, admin-verwaltet direkt auf der Seite) und
  fließt live in die Lohnübersicht (Brutto-Spalte) ein, genau wie die
  bisherigen Akkord-/Fahrer-/Erdbeer-/Spargel-Prämien. Tagesaktueller Stand
  zusätzlich in der "Suche" sichtbar (Mitarbeiter-Selbstauskunft) sowie als
  druckbare Tagesliste zum Aushängen. Spalte "Kolben/Std." (Stand
  2026-08-25) zwischen Stunden und Kolben ergänzt - die tatsächliche
  Ausbeute (Kolben ÷ Stunden) der eingegebenen Werte, live beim Tippen
  berechnet, zur Unterscheidung von "Kolben Norm" (der bei der aktuellen
  Norm erwarteten Kolbenzahl). Sätze-Verwaltung um "Bearbeiten"/"Löschen"
  je Zeile ergänzt (Stand 2026-08-25, Nutzer-Meldung: ein falsch angelegter
  Satz ließ sich bisher nicht korrigieren - ein erneuter Speicherversuch
  mit demselben Datum scheiterte an "duplicate key value violates unique
  constraint zuckermais_saetze_gueltig_ab_key", da es bisher nur "Satz
  hinzufügen" gab). Dasselbe Formular dient jetzt für Neuanlage UND
  Korrektur, mit Warnhinweis: Ändern/Löschen wirkt auf alle Tage, die
  diesen Satz nutzen - auch rückwirkend auf bereits abgerechnete Personen.
  Reine Frontend-Ergänzung, keine Migration nötig (RLS erlaubte
  Update/Delete für admin bereits, nur die UI fehlte). Sätze-Verwaltung
  zusätzlich einklappbar (Stand 2026-08-28, standardmäßig eingeklappt -
  wird nur selten gebraucht, soll die tägliche Erfassung nicht überladen).
  **Erdbeeren**
  (Prämien → Erdbeeren,
  admin/hr/zeiterfassung/erntewirtschaft, Stand 2026-08-09) nach
  demselben Muster, aber mit Norm (Steigen/Std.) und Bonus (€/Steige über
  Norm) JE PARZELLE UND TAG statt global (auf mehreren Parzellen mit sehr
  unterschiedlichen Gegebenheiten gleichzeitig gepflückt) - eigene
  Parzellen-Stammdaten (Name/Größe/Sorte/Anzahl Pflanzen, admin-verwaltet
  direkt auf der Seite), zusätzlich wird "Sut" (Abfall/nicht
  vermarktungsfähige Ware) miterfasst (zählt nicht zur Prämie, nur zur
  Statistik). 1 Steige = 10 Schalen à 500g = 5 kg. Spargel ist als eigener
  Reiter angelegt, aber noch in Vorbereitung - braucht eine Anbindung an
  die externe Waage-Datenbank sowie eine Klärung der Feldstufen-Logik.
  Viertes Untermenü **"Gruppenaufteilung"** (nur admin/hr, Stand
  2026-08-09): legt fest, wer in den Prämien-Erfassungsseiten überhaupt
  auftaucht - unabhängig von den Stundenerfassungs-Gruppen (`gruppe_nr`),
  die weiterhin unverändert wichtig bleiben. Einfaches An/Aus je Kultur
  (`employees.praemien_zuckermais/_erdbeeren/_spargel`), keine neue eigene
  Gruppen-Ebene. Bestehende Gruppen/Herkünfte dienen nur als Filter zum
  schnellen Mehrfach-Auswählen (Checkbox-Liste), danach "Zu X hinzufügen"/
  "Von X entfernen" für die gewählte Kultur. Zuckermais/Erdbeeren zeigen
  standardmäßig nur zugeordnete Mitarbeiter (weniger Scrollen/Ablenkung bei
  der täglichen Erfassung). Korrektur/Löschen (Stand 2026-08-09): Feld auf
  0 setzen und "Alle speichern" entfernt einen versehentlich am falschen
  Tag/an der falschen Parzelle eingetragenen Eintrag wieder vollständig
  (vorher nur stillschweigend übersprungen, nicht korrigierbar) - das geht
  aber nicht mehr, sobald die betroffene Person für die jeweilige Saison
  bereits abgerechnet ("Jetzt Abrechnen") ist, ein Wert einer
  abgeschlossenen Auszahlung bleibt unveränderlich
- Neuer Menüpunkt "Statistik" (Stand 2026-08-09, admin/hr/lohnabrechnung/
  management/erntewirtschaft), analog zu "Prämien" mit eigenen Untermenüs
  Spargel/Erdbeeren/Zuckermais - Tagesstatistik über alle Mitarbeiter
  (Summe Kisten bzw. Steigen/Kolben/Stunden/Prämien, Durchschnitt je
  Stunde, Kosten je Einheit). Die Kosten-Formel rechnet mit dem für das
  jeweilige Saison-Jahr gepflegten Mindestlohn (Einstellungen), nicht mit
  dem individuellen Stundenlohn je Person - hier ist eine grobe
  Tages-Kennzahl über alle Mitarbeiter gefragt, keine personenscharfe
  Abrechnung. Bis 2026-08-11 stand dort ein fest verdrahteter Wert von
  13,90 €, der mit jeder Mindestlohn-Änderung auseinandergelaufen wäre
  (Nutzer-Vorgabe: "Da ist immer mein gesetzter Wert für Mindestlohn für
  die Berechnung relevant"). Ist für ein Jahr kein Mindestlohn hinterlegt,
  bleibt die Kennzahl bewusst leer, statt mit einem geratenen Wert zu
  rechnen. Erdbeeren zusätzlich mit
  Saison-Summe je Parzelle (Ertrag in Steigen und kg, Nutzer-Vorgabe: "wie
  viel Ertrag pro Feld kommt runter") und Parzelle-Filter. Spargel folgt,
  sobald dessen Prämien-Erfassung steht
- Arbeitsgruppen ↔ Kultur (Stand 2026-08-12): Arbeitsgruppen (Einstellungen)
  können optional einer Kultur (Zuckermais/Erdbeeren/Spargel) zugeordnet
  werden. Auf den Statistik-Seiten erscheint dadurch zusätzlich "Kosten/
  Kolben (Gruppen)" bzw. "Kosten/Steige (Gruppen)" - rechnet mit den
  Stunden aus der ALLGEMEINEN Stundenerfassung dieser Gruppen (× Mindestlohn
  ÷ Erntemenge des Tages), nicht nur mit den in der Prämien-Erfassung
  eingetragenen Stunden - damit zählen z.B. auch Sortierer/Träger mit, die
  nicht einzeln in der Prämien-Erfassung stehen. Bei Erdbeeren als eigene
  Sicht `erdbeeren_gruppenkosten_tag` (Tages-, nicht Parzellen-Ebene, da die
  Stundenerfassung keine Parzelle kennt). Nebenbefund dabei behoben:
  `zuckermais_statistik_tag`/`erdbeeren_statistik_tag` konnten den
  Mindestlohn wegen ihres `security_invoker`-Zustands für alle Rollen außer
  admin gar nicht lesen (verpflegungssaetze ist admin-only per RLS) -
  Kosten/Kolben bzw. Kosten/Steige waren für hr/lohnabrechnung/management/
  erntewirtschaft seit 2026-08-11 lautlos leer. Migration:
  `migration_2026-08-12_gruppen_kultur.sql`. Nachtrag noch am selben Tag:
  auf Nutzer-Wunsch mit Abstand und eigener Überschrift "Kulturkosten"
  dargestellt (zweizeiliger Tabellenkopf bei Zuckermais, eigene Tabelle bei
  Erdbeeren), und die Formel enthält jetzt zusätzlich die Tagesprämien
  ("die fehlen bei der Betrachtung der reinen Gruppenkosten") - Migration
  `migration_2026-08-12_kulturkosten_praemien.sql`
- **Personenauswertung Zuckermais (Stand 2026-08-23, Nutzer-Vorgabe: "wen
  schicke ich zuerst nach Hause" - wer kostet am meisten bei geringster
  Leistung)**: neue Sektion unter der bestehenden Tagesstatistik auf
  `Statistik → Zuckermais`, nur für admin/hr/management sichtbar (enger
  als der Rest der Seite) - rechnet bewusst mit dem individuellen
  `employees.stundenlohn`, nicht dem Mindestlohn wie die übrige Seite,
  echte Lohnkosten je Person sind hier der Punkt. Freier Von-Bis-
  Zeitraumfilter statt nur Saison-Jahr ("vor allem wenn ich es mir über
  einen längeren Zeitraum anschauen kann", Nutzer-Zitat). Kennzahlen je
  Person: **Auslastung %** = Ausbeute/Std. ÷ die im Zeitraum jeweils
  gültige Norm × 100 - zeilenweise mit dem am jeweiligen Tag gültigen
  Satz berechnet und dann summiert, nicht aus Tages-Durchschnitten
  gemittelt, damit eine Normänderung mitten im Zeitraum korrekt gewichtet
  einfließt (gleiches Prinzip wie bei `zuckermais_praemie_tag` selbst).
  **Negativprämie €** = Spiegelbild der bestehenden Prämien-Formel mit
  demselben Satz (`GREATEST((Norm × Std. − Kolben) × Satz, 0)`) - macht
  eine Unterschreitung in denselben Euro sichtbar wie die Prämie selbst
  (Nutzer-Bestätigung: die Prämie ist dabei keine Verzerrung zulasten
  guter Leute, da Kosten/Kolben schnelle und langsame Leute schon ohne
  sie trennt). Personen mit weniger als 5 Std. im Zeitraum werden
  ausgeblendet (zu verrauschte Auslastung). Tabelle klickbar sortierbar,
  Standard-Sortierung Auslastung aufsteigend, Herkunft-Spalte rechts neben
  dem Namen. Reine Frontend-Auswertung
  auf bereits bestehenden Daten (`zuckermais_praemie_tag`,
  `employees.stundenlohn`), keine Migration nötig. Erdbeeren (Daten
  ebenso bereits person-scharf vorhanden, Norm dort aber je Parzelle) und
  Spargel (bislang keine personenscharfen Erntedaten überhaupt) bewusst
  zurückgestellt - siehe Konzept-Dokument in der Sitzung
- **"Summe Negativprämie €" in der Tagesstatistik (Stand 2026-08-25,
  Nutzer-Vorgabe: "neben Kosten/Kolben € ... eine Spalte mit der Summe
  Negativprämie für diesen Tag")**: neue Spalte auf `Statistik →
  Zuckermais`, direkt neben "Kosten/Kolben €" - Summe der Negativprämie
  aller Personen dieses Tages. Die Negativprämie-Formel (Spiegelbild der
  Prämie, siehe Personenauswertung oben) ist dafür aus dem Frontend in die
  Sicht `zuckermais_praemie_tag` selbst gewandert
  (`zuckermais_praemie_tag.negativpraemie`) - `zuckermais_statistik_tag`
  summiert sie je Tag, die Personenauswertung liest jetzt denselben Wert
  statt ihn ein zweites Mal zu berechnen, damit beide Stellen garantiert
  übereinstimmen. Migration:
  `migration_2026-08-25_zuckermais_summe_negativpraemie.sql`
- Neue Rolle `erntewirtschaft` (Stand 2026-08-09): eigener,
  eingeschränkter Arbeitsbereich mit ausschließlich Zugriff auf Prämien
  (erfassen, wie zeiterfassung), Statistik und ein eigenes Dashboard - kein
  Zugriff auf Personal, Lohnübersicht, Kassenbuch, Controlling oder
  Einstellungen. Eigenes Dashboard (Stand 2026-08-09, `app/dashboard/
  page.tsx`): Kacheln für Zuckermais/Erdbeeren heute (erfasste Personen,
  Prämien-Summe), Warnung falls für Zuckermais noch kein Satz für heute
  hinterlegt ist, Direktlinks zu Statistik und (nur admin) Gruppenaufteilung.
  Zusätzlich "Mais-Statistik" (`components/MaisStatistikKachel.tsx`):
  Tagessumme Kolben als Säulendiagramm über der Saison, darunter die
  Leistung (Kolben/Std., Tagesschnitt) als Liniendiagramm, gemeinsame
  Datums-Achse. Bewusst KEIN Zwei-Achsen-Diagramm (eine Grafik mit zwei
  Y-Skalen wäre bei so unterschiedlichen Größenordnungen irreführend,
  siehe dataviz-Skill-Anti-Pattern) - stattdessen zwei schlanke, exakt
  ausgerichtete Diagramme mit einem gemeinsamen Tooltip für beide Werte.
  Alle Zahlen mit 1000er-Punkten, 0 Nachkommastellen (Nutzer-Vorgabe,
  `lib/format.ts` `formatZahlDE`)
- Rollen/Rechte serverseitig über Postgres Row Level Security
- Append-only Audit-Log für Personal, Stunden, Vorschüsse, Kassenbuch -
  einsehbar über die Seite "Protokoll" (siehe unten)
- Sicherheitsfix 2026-08-11: `beleg_zaehler` (zentrale Belegnummern-Vergabe)
  war die einzige Tabelle im Schema ohne aktiviertes RLS - ausgelöst durch
  eine Supabase-Sicherheitswarnung (`rls_disabled_in_public`). Jetzt per
  RLS ohne jede Policy vollständig gesperrt, Zugriff nur noch über die
  jetzt `security definer` laufende Funktion `naechste_belegnummer()`
  (gleiches "kontrollierte Ausnahme"-Muster wie an anderer Stelle im
  Schema). Migration: `migration_2026-08-11_beleg_zaehler_rls.sql`
- Sicherheitsfix 2026-08-12: Supabase-Advisor-Warnung "Security Definer
  View" für 14 Sichten geprüft. 6 sind bewusst so gebaut (zeigen nur eine
  schmale, unkritische Auswahl wie Namen/Stückzahlen) - unverändert. 4
  waren unbedenklich (Basistabellen ohnehin für alle lesbar) - nur
  `security_invoker = true` ergänzt. 4 hatten eine echte Lücke -
  `season_summary`, `season_summary_monat`, `auszahlungsbeleg_summary`
  (volle Lohndaten) und `employee_sv_pruefung` (SV-rechtliche
  Einschätzung) waren technisch für jede angemeldete Rolle per REST-API
  abrufbar, obwohl die App diese Seiten nur bestimmten Rollen zeigt -
  jetzt mit `current_role_name() in (...)` direkt in der Sicht abgesichert,
  passend zur bestehenden Menü-Berechtigung. Migration:
  `migration_2026-08-12_security_definer_views.sql`

**Nicht enthalten** (siehe "Nächste Schritte"):
- Finalisierte Auszahlungsliste/Lohnabrechnungs-Export
- Rechtsverbindliche Prüfung der SV-Befreiung im Einzelfall - der
  SV-Fragebogen (siehe oben, OI-004) bildet unser Verständnis der
  allgemeinen Regel ab, ist aber keine steuerberaterlich geprüfte
  Rechtsauskunft
- Druckvorlagen (Stundenzettel A5/A6 als PDF)
- Migrations-Import aus der bestehenden Excel-Datei

Diese Web-App weicht bewusst von ADR-002 aus dem beigelegten Fachkonzept
("nativer Windows-Client") ab - auf deinen Wunsch hin als Browser-Anwendung,
aber mit denselben zugrunde liegenden Prinzipien (stabile IDs, Audit-Log,
kein Hard-Delete, serverseitige Rechte, versionierte Sätze/Regeln,
atomare Belegnummern).

## Voraussetzungen

- kostenloses Konto auf https://supabase.com
- kostenloses Konto auf https://vercel.com (oder ein anderer Node-Hoster)
- Node.js 18+ lokal, falls du vor dem Deployment lokal testen willst

## 1. Supabase-Projekt einrichten

1. Auf supabase.com ein neues Projekt anlegen (Region z.B. Frankfurt).
2. Im Supabase-Dashboard: SQL Editor → Inhalt von `supabase/schema.sql`
   einfügen und ausführen.
3. Unter Authentication → Users manuell die ersten Benutzer anlegen
   (E-Mail + Passwort). Für jeden Nutzer anschließend im Table Editor in
   der Tabelle `profiles` eine Zeile mit derselben `id` (siehe Auth →
   Users → User UID), `full_name` und `role` anlegen
   (`admin`, `hr`, `zeiterfassung`, `kasse`, `lohnabrechnung`, `pruefer`,
   `management` oder `erntewirtschaft`).
4. Unter Project Settings → API: `Project URL` und `anon public key`
   kopieren.

**Bereits ein Projekt am Laufen?** `schema.sql` legt Tabellen neu an und
schlägt daher auf einer bestehenden Datenbank fehl. Führe stattdessen nur
neue Migrations-Dateien aus `supabase/migration_*.sql` (in Dateinamen-
Reihenfolge, jede nur einmal) im SQL Editor aus.

### Rollen & Berechtigungen

Rechte sind serverseitig in der Datenbank festgelegt (Row Level Security),
nicht nur im Menü versteckt.

| Rolle | Sichtbare Menüpunkte | Kernrechte |
|---|---|---|
| `admin` | Alle | Voller Zugriff auf alles, inkl. Einstellungen, Kassenprüfungen freigeben, Änderungsprotokoll (Seite "Protokoll") |
| `hr` | Personal, Stundenerfassung, Suche, Lohn, Prämien, Statistik, Controlling | Personalstamm + Dokumente voll pflegen (inkl. SV-Nr./IBAN/Ausweiskopien), Sozialversicherung + Lohnsteuer erfassen, Personalplanung + Anreiseliste (Kandidaten, Schwarze Liste, Buskosten) verwalten, Stunden erfassen, Lohnübersicht/Vorschüsse nur ansehen (nicht bearbeiten), Prämien erfassen, Monatsabschluss sperren/öffnen |
| `zeiterfassung` | Stundenerfassung, Suche, Prämien | Nur Stunden eintragen/ändern; sieht Personal nur mit eingeschränkten Feldern (keine SV-Nr./IBAN etc.); erfasst zusätzlich die Ausgabe von Arbeitskleidung (Stundenerfassung → Arbeitskleidung) sowie Prämien (Kisten/Stunden je Tag) |
| `kasse` | Suche, Lohn, Kassenbuch | Vorschüsse erfassen/stornieren/korrigieren, Kassenbuch führen, Kassenprüfung durchführen |
| `lohnabrechnung` | Suche, Lohn, Prämien, Statistik | Lohnübersicht ansehen **und bearbeiten** (Buskosten, Kautionen, "Jetzt Abrechnen"), Vorschüsse einsehen, Prämien ansehen |
| `pruefer` | Suche, Lohn, Kassenbuch | Nur lesen, außer: Kassenprüfungen freigeben; einzige Nicht-Admin-Rolle mit Audit-Log-Einsicht |
| `management` | Suche, Lohn, Kassenbuch, Prämien, Statistik, Controlling | Nur lesende/aggregierte Sicht |
| `erntewirtschaft` | Start, Suche, Prämien, Anbau, Statistik | Eigener, eingeschränkter Arbeitsbereich (Nutzer-Vorgabe 2026-08-09) - erfasst Prämien (Kisten/Stunden je Tag, wie zeiterfassung), sieht die Statistik, eigenes Dashboard mit Tageskennzahlen; kein Zugriff auf Personal, Lohnübersicht, Kassenbuch, Controlling, Einstellungen |

Neuen Benutzer anlegen: Supabase-Dashboard → Authentication → Users →
"Add user" (E-Mail + Passwort) → User UID kopieren → Table Editor →
Tabelle `profiles` → neue Zeile mit `id` = User UID, `full_name`, `role`
(eine der obigen), `aktiv` = `true`.

## 2. Lokale Konfiguration

```
cp .env.local.example .env.local
```

Trage dort die Werte aus Schritt 1.4 ein.

```
npm install
npm run dev
```

Die App läuft dann auf http://localhost:3000.

## 3. Deployment (Vercel)

1. Dieses Projekt in ein GitHub-Repository legen (oder Vercel CLI direkt
   aus dem Ordner nutzen: `npx vercel`).
2. In Vercel „New Project“ → Repository auswählen.
3. Unter Environment Variables `NEXT_PUBLIC_SUPABASE_URL` und
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` eintragen (Werte aus Schritt 1.4).
4. Deployen. Die Nutzer greifen anschließend über die Vercel-URL zu -
   mehrere Personen können gleichzeitig arbeiten, wie zuvor mit
   Office 365.

## Nächste Schritte (aus dem Fachkonzept, unverändert offen)

Diese Punkte betreffen die Datenqualität/Rechtssicherheit und lassen sich
nicht ohne dich bzw. eine Steuerberatung klären:

- OI-004: Die Tage-Zählung (15 Wochen = 105 Kalendertage - der Excel-Text
  "14 Wochen" war ein Tippfehler, korrekt sind 15; die 90-Arbeitstage-
  Grenze gilt nur bei weniger als 5 Arbeitstagen pro Woche und wurde
  deshalb 2026-08-11 entfernt) ist
  umgesetzt (Personal-Seite + Controlling-Seite), inkl. SV-Fragebogen
  (Personal → Sozialversicherung, Stand 2026-08-08: manuelles
  Eingabeformular je Person/Saison-Jahr mit Vorjahresvergleich,
  Bestanden/Nicht-bestanden-Auswertung nach der allgemeinen
  Berufsmäßigkeits-Regel als Warnung, sowie Einrechnung bisheriger
  Beschäftigungstage bei anderen deutschen Arbeitgebern in die
  15-Wochen-Kontrolle).
  Offen: rechtsverbindliche Prüfung im Einzelfall bleibt beim Nutzer/einer
  Steuerberatung - die App-Logik ist unser Verständnis der allgemeinen
  Regel, keine geprüfte Rechtsauskunft; außerdem weiterhin offen, ob "90
  Tage" oder "15 Wochen" je Person tatsächlich gilt.
- OI-009: Exakte Brutto-/Netto-/Abzugsformeln der bisherigen Excel-Datei
  (die aktuelle `season_summary`-Berechnung ist ein Entwurf und muss
  gegen echte, abgeschlossene Abrechnungen verifiziert werden). Stand:
  Netto/Auszahlungsbetrag-Trennung + manuelle Eingabe des externen
  Lohnprogramm-Nettos (bei Lohnsteuerklasse 1/sozialversicherungspflichtig)
  sind umgesetzt. Die Formel (Brutto → 5,275% Steuer bei "pauschal" →
  Netto → − Verpflegung/Unterkunft − Vorschüsse − Buskosten →
  Auszahlungsbetrag) wurde gegen das Blatt "Auszahlungsbeleg" der
  Original-Excel-Datei geprüft (Testperson Pers.-Nr. 3036) und stimmt
  exakt überein. Buskosten (`bus_hin`/`bus_rueck`, vorfinanzierte
  Heimreise) werden jetzt als eigene Abzugsposition erfasst und
  ausgewiesen. Offen: Verifikation mit weiteren echten Testfällen sowie
  eine Oberfläche für die übrigen `season_bonuses`-Felder (Akkord-,
  Ausgleichs-, Fahrer-, Erdbeer-, Spargel-Prämie) - aktuell nur über den
  Supabase Table Editor pflegbar. Bugfix: eine eingetragene "0" bei den
  Stunden zählt jetzt korrekt als Anwesenheitstag (Verpflegung/Unterkunft
  werden abgezogen), kein Eintrag zählt weiterhin nicht.
- Migration bestehender Personal-/Saisondaten aus der `.xlsm`-Datei in
  dieses Schema (aktuell nicht automatisiert).
- Druckvorlagen für Stundenzettel (A5/A6) als PDF-Erzeugung.
- OI-010 (Datenschutz/Hosting): Alle personenbezogenen Daten (inkl.
  Mitarbeiter-Dokumente wie Hochzeitsurkunde/Ausweiskopie) liegen
  ausschließlich bei Supabase (Datenbank + privater Storage-Bucket).
  GitHub enthält nur Code, keine Personendaten. Vercel liefert nur die
  App aus - es gibt keine serverseitigen API-Routen, der Browser spricht
  bei jeder Aktion direkt mit Supabase, sensible Inhalte laufen also
  nicht über Vercel. Offen/zu prüfen: (1) Region des Supabase-Projekts
  im Dashboard kontrollieren (Project Settings → General → Region) - für
  DSGVO-Konformität sollte das eine EU-Region sein; (2) Auftrags-
  verarbeitungsverträge (AVV) mit Supabase und Vercel abschließen.
  Migration auf einen eigenen Server ist grundsätzlich möglich, da
  Supabase offiziell Self-Hosting via Docker Compose anbietet (Postgres,
  Auth, Storage, Realtime sind offene Bausteine) - `schema.sql` ist dafür
  bereits 1:1 nutzbar, die eigentlichen Daten (inkl. hochgeladener
  Dokumente) müssten aber separat per `pg_dump`/Storage-Kopie umgezogen
  werden, und der laufende Betrieb (Wartung, Updates, Backups, TLS)
  würde dann in Eigenregie liegen statt bei Supabase/Vercel. Aktueller
  Stand (Nutzer-Check im Dashboard): Supabase Free-Plan mit 1 GB
  File-Storage (getrennt vom Datenbank-Kontingent) - Verbrauch unter
  Project Settings → Usage im Blick behalten, bei Bedarf Upgrade auf
  Pro-Plan statt Umzug.

## Architektur

- Frontend: Next.js (App Router) + Tailwind, React-Client-Komponenten
- Backend/Datenbank: Supabase (Postgres + Auth + Realtime)
- Autorisierung: Row Level Security in Postgres, siehe `supabase/schema.sql`
- Live-Sync: Supabase Realtime Channels (`postgres_changes`) in
  `app/erfassung/page.tsx`
