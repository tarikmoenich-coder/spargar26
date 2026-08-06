# Spargar-App (Mömmel Agrar)

Web-Anwendung als Ersatz für "Spargar 2026 - Mömmel Agrar.xlsm". Mehrere
Nutzer können gleichzeitig arbeiten, Änderungen werden live synchronisiert
(Supabase Realtime).

## Umfang dieser Version (MVP)

Enthalten:
- Navigation, Unterreiter (Personal/Lohn) und die wichtigste Werkzeugleiste
  je Seite (Datum, Filter, Suche) bleiben beim Scrollen durch lange Listen
  sichtbar (fixiert/"sticky")
- Personalstamm (anlegen/bearbeiten/deaktivieren, keine Löschung), inkl.
  Abrechnungsart (pauschal/Lohnsteuerklasse 1/sozialversicherungspflichtig)
  und automatisch berechnetem "Aktiv seit" (erster Arbeitstag mit Stunden > 0)
- Tägliche Stundenerfassung mit Live-Sync zwischen mehreren Nutzern, nach
  Arbeitsgruppen (z.B. Sortierer, Träger) gruppiert mit Sprungleiste und
  Druckansicht pro Gruppe ("Gruppenstundenzettel"). Zur Kontrolle stehen
  die Stunden der letzten 3 Tage schreibgeschützt links neben dem
  bearbeitbaren Tag; Pfeil-Buttons neben der Datumsauswahl springen einen
  Tag vor/zurück, Pfeiltasten hoch/runter im Stunden-Feld springen direkt
  zur nächsten/vorherigen Person. Datum ist standardmäßig auf gestern
  vorausgewählt. Beim Wechsel des Tages (Pfeil-Buttons oder Datumsfeld)
  bleibt die Ansicht an derselben Stelle (Fokus/Scroll-Position), statt
  nach oben zu springen
- Arbeitsgruppen-Verwaltung unter Einstellungen (nur admin): Bezeichnung und
  Anzeige-/Druckreihenfolge je Gruppe
- Personalnummern-Übersicht: 10 Nummernkreise (1–999, 1000–1999, …),
  Dubletten-Erkennung, nächste freie Nummer je Kreis - Kreis-Auswahl beim
  Neuanlegen zeigt den Nummernbereich direkt mit an (z.B. "Kreis 1 (1-999)")
- Eigene Unterseite "Personal → Dokumente" (nur admin/hr, wie andere
  sensible Personaldaten): Tabelle wie im Personalstamm (Pers.-Nr.,
  Herkunft, Name, Vorname, Ort), dahinter eine Spalte je Dokument-
  Kategorie (Hochzeitsurkunde, Ausweiskopie, Führerschein Kopie,
  Arbeitsvertrag, Werks-/Mietvertrag, Formular "Doppelte
  Haushaltsführung", Formular zur Feststellung der Versicherungspflicht,
  Sonstiges) - leer, wenn noch nichts hochgeladen wurde, sonst anklickbar
  zum Download. Dateien liegen in einem privaten Supabase-Storage-Bucket,
  Downloads laufen über zeitlich begrenzte signierte Links.
- Führerschein-Klassen (B, BE, C, CE) werden beim Hochladen einer
  "Führerschein Kopie" abgefragt und wirken sich breit aus: Personal,
  Stundenerfassung und Lohnübersicht zeigen für jede Person mit
  hinterlegtem Führerschein die Klassen an (über eine schmale, für alle
  Rollen lesbare Sicht - das Dokument selbst bleibt admin/hr-only)
- Personal-Import aus Excel/CSV mit Vorschau, Spaltenerkennung und
  Fehlerprüfung (u.a. bereits vergebene Personalnummern)
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
  "101 - Abrechnen" zu packen und dort gesammelt zu markieren
- Einstellungen-Seite (nur admin): Verpflegungs-/Unterkunft-Satz pro Tag,
  versioniert je Saisonjahr, Default 10€/10€
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
  Unterschriftenfeld für diese eine Person
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
- Zahlungsart (Bar/Überweisung) bei "Jetzt Abrechnen" wählbar und je
  Auszahlungsbeleg gespeichert - für Personen, die schon abgereist sind
  und erst später per Überweisung ausgezahlt werden (siehe Arbeitsgruppe
  "Ausstehend/Abgereist" als Merkposten dafür)
- Kassenbuch (Einzahlungen) mit Saldo, einfacher Kassenprüfung und Log der
  nachträglichen Vorschuss-Korrekturen ("Kassenbewegungen") - Bar-Vorschüsse
  mindern automatisch den Kassenbestand, Überweisungen nicht
- "Suche"-Seite (alle Rollen): nach Name oder Personalnummer suchen und
  Arbeitsstunden (inkl. Notiz je Tag) sowie Vorschuss-Historie (inkl.
  Begründung) einer Person einsehen und als Übersicht für den Mitarbeiter
  ausdrucken - damit nicht nur die Verwaltung, sondern auch untere Ebenen
  selbst Auskunft geben können
- Freitext-Notiz je Tag auf der Stundenerfassung (z.B. "krank", "zu
  spät") - erscheint auch auf der "Suche"-Seite
- 90-Tage-/15-Wochen-Kontrolle (SV-Freiheit landwirtschaftliche
  Saisonarbeit, OI-004): Spalten auf der Personal-Seite (Rest bis 90 Tage,
  theoretisches Austrittsdatum, Status) sowie eine "Management"-Seite mit
  allen kritischen Fällen. Reine Tage-/Wochen-Zählung auf Basis "1. bis
  letzter Arbeitstag mit Stunden > 0" - ersetzt nicht die rechtliche
  Prüfung der Sozialversicherungsbefreiung selbst (eigenes Formular nötig,
  noch offen)
- "Management"-Seite, Abschnitt "Stundenmonitoring": listet alle Personen
  mit mindestens einem Tag über 12,00 Stunden in der Stundenerfassung
  (Saison-Jahr-Filter), aufklappbar je Person mit allen betroffenen Tagen
  und einem Sprung-Link direkt zu Datum + Person in der Stundenerfassung
- "Management"-Seite, Abschnitt "Abweichungen bei Auszahlungen": listet
  alle bereits abgerechneten Personen, deren Live-Berechnung inzwischen
  vom eingefrorenen Schnappschuss abweicht (das „⚠" von der
  Auszahlungen-Seite), mit konkreter Angabe je Feld (alt → neu) statt nur
  des Warnzeichens
- Rollen/Rechte serverseitig über Postgres Row Level Security
- Append-only Audit-Log für Personal, Stunden, Vorschüsse, Kassenbuch

**Nicht enthalten** (siehe "Nächste Schritte"):
- Finalisierte Auszahlungsliste/Lohnabrechnungs-Export
- Rechtliche Prüfung der SV-Befreiung selbst (eigenes Formular, siehe
  offener Punkt OI-004 unten) - aktuell nur die reine Tage-/Wochen-Zählung
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
   (`admin`, `hr`, `zeiterfassung`, `kasse`, `lohnabrechnung`, `pruefer`
   oder `management`).
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
| `hr` | Personal, Stundenerfassung, Suche, Lohn, Management | Personalstamm + Dokumente voll pflegen (inkl. SV-Nr./IBAN/Ausweiskopien), Stunden erfassen, Lohnübersicht/Vorschüsse nur ansehen (nicht bearbeiten), Monatsabschluss sperren/öffnen |
| `zeiterfassung` | Stundenerfassung, Suche | Nur Stunden eintragen/ändern; sieht Personal nur mit eingeschränkten Feldern (keine SV-Nr./IBAN etc.) |
| `kasse` | Suche, Lohn, Kassenbuch | Vorschüsse erfassen/stornieren/korrigieren, Kassenbuch führen, Kassenprüfung durchführen |
| `lohnabrechnung` | Suche, Lohn | Lohnübersicht ansehen **und bearbeiten** (Buskosten, Kautionen, "Jetzt Abrechnen"), Vorschüsse einsehen |
| `pruefer` | Suche, Lohn, Kassenbuch | Nur lesen, außer: Kassenprüfungen freigeben; einzige Nicht-Admin-Rolle mit Audit-Log-Einsicht |
| `management` | Suche, Lohn, Kassenbuch, Management | Nur lesende/aggregierte Sicht |

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

- OI-004: Die reine Tage-/Wochen-Zählung (90 Tage bzw. 15 Wochen - der
  Excel-Text "14 Wochen" war ein Tippfehler, korrekt sind 15) ist
  umgesetzt (Personal-Seite + Management-Seite). Offen: die eigentliche
  rechtliche Prüfung der Voraussetzungen für Sozialversicherungsbefreiung
  (eigenes Formular, vom Nutzer noch bereitzustellen/zu erklären) sowie
  ob "90 Tage" oder "15 Wochen" je Person tatsächlich gilt.
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
