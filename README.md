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
  braucht - hr sieht offene Anreiseliste-Punkte und die 90-Tage-/
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
  Druckansicht pro Gruppe ("Gruppenstundenzettel"). Zur Kontrolle stehen
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
  Lohnübersicht ein). Ob Ausweiskopie/Führerscheinkopie/Hochzeitsurkunde/
  Formular "Doppelte Haushaltsführung" hochgeladen sind, wird live gegen
  "Personal → Dokumente" geprüft (nicht doppelt gepflegt). Erst wenn alles
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
  Werks-/Mietvertrag, Sonstiges neutral; Hochzeitsurkunde und Formular
  "Doppelte Haushaltsführung" sanft gelb hinterlegt als Lohnsteuer-Themen;
  Formular zur Feststellung der Versicherungspflicht sanft orange als
  Sozialversicherungs-Thema, Stand 2026-08-08) - leer, wenn noch nichts
  hochgeladen wurde, sonst anklickbar zum Download. Dateien liegen in
  einem privaten Supabase-Storage-Bucket, Downloads laufen über zeitlich
  begrenzte signierte Links. Hochzeitsurkunde bekommt zusätzlich einen
  Hinweis "ggf. erneut prüfen", wenn die zuletzt hochgeladene Kopie älter
  als ein Jahr ist und die Person laut diesjähriger "Doppelte
  Haushaltsführung"-Erfassung verheiratet ist (Familienstand könnte sich
  geändert haben - reine Erinnerung, keine echte Prüfung).
- "Bestätigung für den Nachweis der doppelten Haushaltsführung" (gelbe
  Spalten auf "Personal → Dokumente"): manuelles Eingabeformular je
  Person und Saison-Jahr, analog zum SV-Fragebogen vom
  ausgefüllten/gestempelten Papierformular (Gemeinde-Bestätigung)
  abgetippt - Familienstand, bei nicht verheiratet zusätzlich die
  Wohnsituation im Heimatland, sowie getrennt davon "Antrag auf
  Lohnsteuerabzug beim Finanzamt gestellt" mit Datum (unterscheidet sich
  von `lohnsteuerabzug_antrag_gewuenscht` in der Anreiseliste - das ist
  nur der Wunsch der Person, dies hier der tatsächliche Stand der
  Antragstellung). Name/Geburtsdatum/Adresse werden nicht dupliziert,
  stehen schon im Personalstamm. Der gestempelte Papierbeleg bleibt
  zusätzlich als Datei-Upload (Formular "Doppelte Haushaltsführung")
  bestehen - der Stempel der Gemeinde ist der eigentliche Rechtsnachweis
  und lässt sich nicht digital ersetzen.
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
- 90-Tage-/15-Wochen-Kontrolle (SV-Freiheit landwirtschaftliche
  Saisonarbeit, OI-004): Spalten auf der Personal-Seite (Rest bis 90 Tage,
  theoretisches Austrittsdatum, Status) sowie eine "Controlling"-Seite mit
  allen kritischen Fällen. Tage-/Wochen-Zählung auf Basis "1. bis letzter
  Arbeitstag mit Stunden > 0" bei uns, PLUS bisherige Arbeitstage bei
  anderen Arbeitgebern in Deutschland laut SV-Fragebogen (siehe unten,
  "Rest bis 90 Tage" auf der Personal-Seite zeigt den kombinierten Wert,
  Controlling-Seite zeigt beide Werte einzeln). Gilt nur für Personen, die
  noch NICHT sozialversicherungspflichtig sind (die Grenze ist die
  Obergrenze für sozialversicherungsFREIE Beschäftigung, für bereits
  Pflichtige gegenstandslos). Stand 2026-08-10: die Controlling-Seite
  gleicht den tatsächlichen Beschäftigungszeitraum zusätzlich mit dem
  SV-freien Zeitraum laut den SV-Fragebogen-Angaben ab (siehe unten) -
  beginnt die Beschäftigung vor dessen Anfang, geht sie über dessen Ende
  hinaus, oder fällt sie in eine Lücke zwischen "Bezahlter Urlaub" und
  "Freistellung", zählt das genauso als kritisch wie eine Überschreitung
  der 90-Tage-/15-Wochen-Grenze (eigene Spalte "SV-freier Zeitraum
  (Angaben)" plus Grund-Text in der Tabelle). Das "normale" empfohlene
  Austrittsdatum ist jetzt das frühere von 15-Wochen-Ende und dem Ende des
  SV-freien Zeitraums laut Angaben (Spalte "Austrittsdatum (empfohlen)" -
  auch auf der Personal-Seite selbst korrigiert, zeigt dort jetzt für JEDE
  Person dieses frühere Datum statt nur der reinen 15-Wochen-Grenze); die
  bisherige 90-Tage-Kombinationsprüfung bleibt unverändert und greift
  zusätzlich nur im Wiederkehr-Fall (Person kommt nach einer Auszahlung vor
  Erreichen der 90 Tage erneut). Wichtig zum Verständnis der
  "Controlling"-Seite: die dortige "kritisch"-Liste ist bewusst reaktiv, wie
  schon bei der 90-Tage-/15-Wochen-Regel selbst - eine Person landet erst
  dort, sobald tatsächlich AN oder NACH dem Grenzdatum gearbeitet wurde
  (nicht schon am Tag, an dem die Grenze erreicht wird). Wer wissen will,
  wann eine Person die Grenze erreicht, bevor es kritisch wird, sieht das
  proaktiv in der Spalte "Austrittsdatum (empfohlen)" auf der Personal-Seite.
  Stand 2026-08-10, Nutzer-Korrektur: die 90-Tage-Grenze zählt jetzt
  KALENDERTAGE des Beschäftigungszeitraums (1. bis letzter Arbeitstag,
  inkl. freier Tage dazwischen - Spalte "Beschäftigungstage", vorher
  "Arbeitstage > 0" mit reinen Tagen mit Stunden > 0), exakt wie die
  15-Wochen-Grenze, nur mit 90 statt 105 Tagen Budget. Damit die 90-Tage-
  Grenze (90 Kalendertage) nicht immer schon vor der 15-Wochen-Grenze
  (105 Kalendertage) greift, ist sie jetzt AUSSCHLIESSLICH im
  Wiederkehr-Fall bindend (Vorbeschäftigung > 0 laut SV-Fragebogen) - ohne
  gemeldete Vorbeschäftigung gilt nur noch die 15-Wochen-Grenze. Im
  Wiederkehr-Fall wird zusätzlich ein EXAKTES Enddatum berechnet
  (Startdatum der aktuellen Beschäftigung + (89 − bereits gemeldete
  Vorbeschäftigungstage)) und fließt jetzt mit in "Austrittsdatum
  (empfohlen)" ein (das früheste von 15-Wochen-Ende, SV-frei-Ende laut
  Angaben und 90-Tage-kombiniert-Ende). "Rest bis 90 Tage" auf der
  Personal-Seite zeigt "—", wenn keine Vorbeschäftigung gemeldet ist (die
  Zahl wäre sonst irreführend, da sie ohne rechtliche Bedeutung wäre).
  Auf "Personal → Sozialversicherung" (siehe unten) zwei neue Spalten:
  "Angewendete Regel" (15-Wochen- oder 90-Tage-Grenze, je nach gemeldeter
  Vorbeschäftigung) und "Ende der SV-Freiheit (Tage)" - Resttage bis zum
  empfohlenen Austrittsdatum, gelb unter 7 Tagen, rot bei bereits
  überschrittenen (negativen) Tagen; erst berechenbar, sobald mindestens
  ein Arbeitstag erfasst ist. Auf der Controlling-Seite zusätzlich eine
  neue, rein proaktive Übersicht "Nächste 10, deren SV-freier Zeitraum
  endet" (unabhängig vom "kritisch"-Status, sortiert nach empfohlenem
  Austrittsdatum) - ergänzt die reaktive "kritisch"-Liste um eine echte
  Vorausschau
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
  bestanden. Eigenes Feld "bisherige
  Arbeitstage in Deutschland (dieses Kalenderjahr, andere Arbeitgeber)",
  markierbar als durch eine Lohnprogramm-Rückmeldung ausgelöst - fließt
  direkt in die 90-Tage-Kontrolle oben ein (Kern der Regel: das
  Kalenderjahr zählt über ALLE deutschen Arbeitgeber zusammen, nicht nur
  die Tage bei uns). Ersetzt weiterhin nicht die rechtliche Prüfung der
  Sozialversicherungsbefreiung im Einzelfall selbst (die hier hinterlegte
  Bestanden/Nicht-bestanden-Logik ist unser Verständnis der allgemeinen
  Regel, keine steuerberaterlich geprüfte Rechtsauskunft für den
  Einzelfall). Suche nach Name/Personalnummer wie im Personalstamm (Stand
  2026-08-09). Status-Anzeige verfeinert (Stand 2026-08-09): bei
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
  Zeitraum ab dem jeweiligen "seit"-Datum, in den Angaben ohne Enddatum.
  Fehlkorrektur vermieden (Nutzer-Feedback 2026-08-10): dieser offene
  Zeitraum wird NIE als "unbefristet" angezeigt, da er immer durch die
  15-Wochen-Grenze (bzw. bei Vorbeschäftigung/Rückkehr kombiniert die
  90-Tage-Grenze) begrenzt ist - sobald der tatsächliche Arbeitsbeginn
  bekannt ist (mind. ein Arbeitstag mit Stunden > 0 erfasst), zeigt die
  Spalte das daraus berechnete Enddatum mit Regel-Hinweis ("15-Wochen-
  Grenze ab Arbeitsbeginn" bzw. "laut Angaben"); ist der Arbeitsbeginn noch
  unbekannt, zeigt sie stattdessen den Regeltext ohne konkretes Datum. Bei
  Vorbeschäftigung/Rückkehr erscheint zusätzlich ein Hinweis auf die
  kombinierte 90-Tage-Grenze. Dieser SV-freie Zeitraum wird auf der
  Controlling-Seite gegen den tatsächlichen Beschäftigungszeitraum geprüft
  (siehe dort)
- "Statuswechsel" im Personalstamm (nur admin/hr, z.B. beim Erreichen der
  90-Tage-/15-Wochen-Grenze): legt eine neue, verknüpfte Person mit "a" an
  der Personalnummer an (z.B. "342" → "342a") mit wählbarer neuer
  Abrechnungsart und Stichtag, deaktiviert die alte Nummer (keine
  Löschung, ADR-011) und hängt deren hochgeladene Dokumente auf die neue
  Nummer um. Stunden/Vorschüsse/Boni bleiben dadurch strikt getrennt (zwei
  eigene Zeilen in der Lohnübersicht, je eigene Netto-Berechnung passend
  zur jeweiligen Abrechnungsart) - beide Nummern bleiben über eine
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
- "Controlling"-Seite, Abschnitt "Stundenmonitoring": listet alle Personen
  mit mindestens einem Tag über 12,00 Stunden in der Stundenerfassung
  (Saison-Jahr-Filter), aufklappbar je Person mit allen betroffenen Tagen
  und einem Sprung-Link direkt zu Datum + Person in der Stundenerfassung
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
  Stunde, Kosten je Einheit). Kosten-Formel nutzt einen festen
  Stundenlohn von 13,90 € (Nutzer-Vorgabe, exakt wie angegeben), nicht den
  individuellen Stundenlohn je Person. Erdbeeren zusätzlich mit
  Saison-Summe je Parzelle (Ertrag in Steigen und kg, Nutzer-Vorgabe: "wie
  viel Ertrag pro Feld kommt runter") und Parzelle-Filter. Spargel folgt,
  sobald dessen Prämien-Erfassung steht
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
- Append-only Audit-Log für Personal, Stunden, Vorschüsse, Kassenbuch

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
| `admin` | Alle | Voller Zugriff auf alles, inkl. Einstellungen, Kassenprüfungen freigeben |
| `hr` | Personal, Stundenerfassung, Suche, Lohn, Prämien, Statistik, Controlling | Personalstamm + Dokumente voll pflegen (inkl. SV-Nr./IBAN/Ausweiskopien), Personalplanung + Anreiseliste (Kandidaten, Schwarze Liste, Buskosten) verwalten, Stunden erfassen, Lohnübersicht/Vorschüsse nur ansehen (nicht bearbeiten), Prämien erfassen, Monatsabschluss sperren/öffnen |
| `zeiterfassung` | Stundenerfassung, Suche, Prämien | Nur Stunden eintragen/ändern; sieht Personal nur mit eingeschränkten Feldern (keine SV-Nr./IBAN etc.); erfasst zusätzlich die Ausgabe von Arbeitskleidung (Stundenerfassung → Arbeitskleidung) sowie Prämien (Kisten/Stunden je Tag) |
| `kasse` | Suche, Lohn, Kassenbuch | Vorschüsse erfassen/stornieren/korrigieren, Kassenbuch führen, Kassenprüfung durchführen |
| `lohnabrechnung` | Suche, Lohn, Prämien, Statistik | Lohnübersicht ansehen **und bearbeiten** (Buskosten, Kautionen, "Jetzt Abrechnen"), Vorschüsse einsehen, Prämien ansehen |
| `pruefer` | Suche, Lohn, Kassenbuch | Nur lesen, außer: Kassenprüfungen freigeben; einzige Nicht-Admin-Rolle mit Audit-Log-Einsicht |
| `management` | Suche, Lohn, Kassenbuch, Prämien, Statistik, Controlling | Nur lesende/aggregierte Sicht |
| `erntewirtschaft` | Start, Suche, Prämien, Statistik | Eigener, eingeschränkter Arbeitsbereich (Nutzer-Vorgabe 2026-08-09) - erfasst Prämien (Kisten/Stunden je Tag, wie zeiterfassung), sieht die Statistik, eigenes Dashboard mit Tageskennzahlen; kein Zugriff auf Personal, Lohnübersicht, Kassenbuch, Controlling, Einstellungen |

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

- OI-004: Die Tage-/Wochen-Zählung (90 Tage bzw. 15 Wochen - der
  Excel-Text "14 Wochen" war ein Tippfehler, korrekt sind 15) ist
  umgesetzt (Personal-Seite + Controlling-Seite), inkl. SV-Fragebogen
  (Personal → Sozialversicherung, Stand 2026-08-08: manuelles
  Eingabeformular je Person/Saison-Jahr mit Vorjahresvergleich,
  Bestanden/Nicht-bestanden-Auswertung nach der allgemeinen
  Berufsmäßigkeits-Regel als Warnung, sowie Einrechnung bisheriger
  Arbeitstage bei anderen deutschen Arbeitgebern in die 90-Tage-Kontrolle).
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
