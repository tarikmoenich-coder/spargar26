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
  Druckansicht pro Gruppe ("Gruppenstundenzettel"; die Trennlinien aller
  Papierformulare sind im Druck bewusst schwarz und kräftiger als am
  Bildschirm, Stand 2026-08-11 - die Zettel werden handschriftlich
  ausgefüllt und anschließend kopiert, ein helles Grau verschwindet dabei).
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
  gleiches Muster wie im Personalstamm, Stand 2026-08-09)
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
  seither abweicht) und erzeugt eine druckbare Auszahlungsliste (mehrere
  Personen, eine Zeile pro Person, mit Unterschriftenspalte)
- "Auszahlungen"-Seite: ein Beleg je "Jetzt Abrechnen"-Aktion (analog zu
  Vorschüssen/Kassenbuch), aufklappbar mit Personalnummer, Name, Stunden,
  Anwesenheitstage, Brutto, Steuer, Netto, Verpflegung/Unterkunft,
  Vorschüsse, Buskosten und Auszahlungsbetrag je Person, mit
  Abweichungs-Warnung und eigener Druckfunktion je Beleg, filterbar nach
  Saison-Jahr und Monat (des Abrechnungsdatums)
- Buskosten (vorfinanzierte Heimreise) als eigene, sichtbare
  Abzugsposition im Auszahlungsbetrag (getrennt von Kassen-Vorschüssen,
  "damit es zu keinen Missverständnissen kommen kann")
- Bei Abrechnungsart "Lohnsteuerklasse 1"/"sozialversicherungspflichtig":
  Eingabefeld für den vom externen Lohnprogramm gelieferten Netto-Betrag
  (App berechnet hier bewusst keine eigene Lohnsteuer)
- Herkünfte-Verwaltung unter Einstellungen (nur admin), als Dropdown im
  Personalstamm (statt Freitext, damit Filter/Auswahl zuverlässig funktioniert)
- Vorschussverwaltung: einzeln, gruppenweise (nach Arbeitsgruppe) oder nach
  Herkunft auswählen, Betrag pro Person individuell anpassbar, atomare
  Belegnummer, Storno statt Löschen, filterbar nach Jahr und Monat (wie
  bei Auszahlungen). Druck erzeugt zwei getrennte Blätter: eine
  Mitarbeiter-Unterschriftenliste (wie bisher, aber ohne Summe - die
  Empfänger müssen die Gesamtsumme nicht sehen) und einen separaten
  Übergabe-Beleg für die Person, die das Geld zur Verteilung bekommt
  (z.B. Gruppenleiter) - mit Summe, optionalem Feld "Übergeben an" (wie
  Begründung beim Erfassen abfragbar) und einem einzigen
  Unterschriftenfeld für diese eine Person. Begründung und "Übergeben an"
  stehen auf beiden Blättern direkt unter der Belegnummer
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
  2026-08-09): Ausgabe von Arbeitshose/-jacke/Gummistiefeln je Person
  (Anzahl statt Betrag - fester Preis je Stück in den Einstellungen) -
  landet wie Buskosten/Kautionen als eigene, sichtbare Abzugsposition im
  Auszahlungsbetrag. Spargelmesser, Feile, Handschuhe sind
  Verbrauchsgegenstände (kostenloser Tausch gegen das Altgerät) und werden
  bewusst nicht erfasst. Erfasst über eine kontrollierte
  security-definer-Ausnahme (season_bonuses selbst bleibt für
  zeiterfassung nicht lesbar/schreibbar)
- Kautionsübergabe an den Hausmeister (Stand 2026-08-09): die bei der
  Auszahlung einbehaltene Zimmerkaution mindert zunächst nur den
  Auszahlungsbetrag der Person, nicht den Kassenbestand - erst wenn sie
  real an den Hausmeister übergeben wird (admin/kasse/lohnabrechnung,
  Beleg direkt auf der Auszahlungen-Seite unter dem jeweiligen
  Auszahlungsbeleg erstellbar), wird sie auch als echte Kassenausgabe im
  Kassenbuch verbucht. Druck erzeugt wie bei den Vorschüssen zwei Blätter
  im Anschluss an den Auszahlungsbeleg: eine Zusammenfassung (Personen,
  Beträge, Summe, "Übergeben an") und eine zweite Liste mit einem
  einzigen Unterschriftsfeld für den Hausmeister (ein Feld für die ganze
  Übergabe, nicht je Person). Storno statt Löschen, macht die
  Kassenausgabe wieder rückgängig
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
  Anwender, zur Durchsicht vor dem Zählen der Kasse. Nach Freigabe einer
  Prüfung (nur admin/pruefer, zweistufig - kasse führt die Prüfung durch,
  pruefer gibt frei) werden alle Belege im geprüften Zeitraum gesperrt
  (Storno/Korrektur nicht mehr möglich) - analog zur Monatsabschluss-Sperre
  bei den Stunden. Wiedereröffnung mit Pflichtgrund hebt die Sperre wieder
  auf
- "Suche"-Seite (alle Rollen): nach Name oder Personalnummer suchen und
  Arbeitsstunden (inkl. Notiz je Tag) sowie Vorschuss-Historie (inkl.
  Begründung) einer Person einsehen und als Übersicht für den Mitarbeiter
  ausdrucken - damit nicht nur die Verwaltung, sondern auch untere Ebenen
  selbst Auskunft geben können
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
  über "Anreise vorbereiten" in der Anreiseliste erreichbar
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
  (Saison-Jahr-Filter), aufklappbar je Person mit allen betroffenen Tagen
  und einem Sprung-Link direkt zu Datum + Person in der Stundenerfassung.
  Der ganze Abschnitt ist zusätzlich als Ganzes ein-/ausklappbar (Stand
  2026-08-10, standardmäßig eingeklappt) - im eingeklappten Zustand nur
  die Gesamtzahl "Anzahl Tage > 12 Std." über alle Personen
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
  der berechnete Anspruch hergibt
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
  druckbare Tagesliste zum Aushängen. **Erdbeeren** (Prämien → Erdbeeren,
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
  `migration_2026-08-12_gruppen_kultur.sql`
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
