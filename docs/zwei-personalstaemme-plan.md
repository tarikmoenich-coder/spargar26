# Plan: Zwei Personalstämme (Landwirtschaft + Vertrieb), drei Firmen

Stand: 2026-11-24 - Entwurf zur Freigabe. Noch nichts davon gebaut.

## Ziel (Nutzer-Vorgabe 2026-11-24)

Der Personalstamm des Vertriebs (~100 aktive Verkäufer, bisher Excel) wird in
spargar26 verwaltet - Stunden, Vorschüsse, Abrechnung wie in der
Landwirtschaft. Die beiden Personalstämme müssen **absolut getrennt** sein:
wer nur für einen Personalstamm zuständig ist (z.B. Stundenerfassung
Landwirtschaft), darf vom anderen weder Personen noch Stunden noch Löhne
sehen - auch nicht über direkte Datenbankabfragen. HR, Lohnabrechnung,
Kasse (Buchhaltung), Management, Prüfer und Admin arbeiten für beide.

## Ausgangslage (Befund)

- Viele Tabellen haben die Lese-Regel `auth.uid() is not null`, also lesbar
  für jeden eingeloggten Nutzer: u.a. `employees` (inkl. IBAN, SV-Nr.),
  `work_entries`, `saison_abrechnungen`, `stundenkonto_bewegungen`,
  `auszahlungsbelege`, `unterkunft_belegung`, `employee_saison_praesenz`.
  Der Schutz läuft dort nur über Menü und gezielte Abfragen der Seiten
  (siehe `migration_2026-08-09_fix_employees_select_grant.sql`).
- Jeder Nutzer hat genau eine Rolle (`profiles.role`), ~177 Prüfungen
  `current_role_name() in (...)`. In der Praxis musste deshalb schon ein
  HR-Mitarbeiter notgedrungen `admin` bekommen.
- Es gibt nur eine Firma (`firmen_bankdaten`, Einzeile). Alle
  Bar-Vorschüsse/Auszahlungen/Kautionen laufen implizit über die Mömmel
  Lohnkasse (`kassenbestand_bis()`), auch für Leute von Mönich
  Landwirtschaft - so auch in der Praxis gewollt.
- `season_summary` zieht jedem Mitarbeiter Verpflegung + Wohnen je
  Anwesenheitstag ab (`verpflegungssaetze` je Saisonjahr).
- `abrechnungsart`: `pauschal`, `lohnsteuerklasse_1`,
  `sozialversicherungspflichtig`. Nur bei `pauschal` rechnet die App Steuer
  (5,275 %), sonst Netto aus dem Lohnprogramm (`netto_extern`).

## Begriffe

| | Personalstamm | Firma (Arbeitgeber) |
|---|---|---|
| Zweck | Rechte-Grenze: wer wen sieht | Kostenaufteilung, SEPA-Auftraggeber, Lohnsteuer-Antrag |
| Werte | Landwirtschaft (`LW`), Vertrieb (`VT`) | Mömmel Agrar, Mönich Landwirtschaft, Mönich Direkt |
| hängt an | der Person, fest | der Person **je Saison** |
| Nummernkreis | LW gemeinsam (beide LW-Firmen), VT eigener mit Präfix `V-` | - |

Wechsel LW → VT (oder zurück) zwischen zwei Jahren = neue Personenzeile mit
Nummer aus dem anderen Kreis, verknüpft mit der alten (wie beim
Statuswechsel). Wechsel zwischen den beiden LW-Firmen = nur andere Firma in
der Saison, gleiche Person und Nummer. Innerhalb einer Saison kein Wechsel.

## Entscheidungen des Nutzers

1. Mehrere Rollen je Nutzer. "Vertrieb" = Vorlage: Rollen HR +
   Lohnabrechnung + Kasse, nur Personalstamm VT.
2. Kassenbücher: MLK + MÖ = Mömmel Agrar, ML = Mönich Landwirtschaft,
   MD = Mönich Direkt (Vertrieb). Nachtrag 2026-11-24: **jede Firma zahlt
   aus ihrem eigenen Kassenbuch** (Mömmel → MLK, Mönich Landwirtschaft → ML,
   Mönich Direkt → MD). Bisher lief alles über MLK, weil die App nur eine
   Firma kannte.
3. Personalnummern Vertrieb mit Präfix `V-`, gespeichert im Feld
   `personal_nr` (bleibt app-weit eindeutig, ~335 Codestellen unverändert).
4. Herkünfte gemeinsam; Arbeitsgruppen je Personalstamm (VT = Stände);
   Unterkünfte gemeinsam, Verkäufer haben aber oft weder Unterkunft noch
   Verpflegung. Planung/Prämien Vertrieb: später, eigene Stufe.
5. Management, Prüfer, Admin sehen beide Personalstämme.
6. Firma je Saison wird NICHT rückwirkend nachgetragen; nur für die wenigen
   aktuell Beschäftigten von Hand.
7. Beschäftigungsarten: LW kurzfristig + SV-pflichtig, VT zusätzlich
   Minijob. Netto rechnet weiter HSC; die App dokumentiert und warnt nur.

## Stufen

Jede Stufe eigener Branch-Stand, geht nach "kann auf main" einzeln live.
Jede Migration vorher in der lokalen Postgres-Kopie getestet.

### Stufe 0 - Abdichten + Rechte-Test (ohne sichtbare Änderung)

1. **Bestandsaufnahme** (Ergebnis als Tabelle in diesem Dokument): jede
   Tabelle, View, security-definer-Funktion und jeder Storage-Bucket mit
   aktuellem Lese-/Schreibrecht je Rolle, jeweils nach der **neuesten**
   Migration (schema.sql ist nicht verlässlich).
2. **Rechte-Test-Skript** (`supabase/tests/rechte_matrix.sql`): legt in der
   lokalen Kopie je Rolle einen Test-Nutzer an, simuliert dessen Anmeldung
   (`request.jwt.claims`) und prüft je Tabelle/View/Funktion, was er lesen
   und schreiben kann, gegen eine Soll-Matrix. Läuft ab jetzt vor jeder
   Rechte-Migration.
3. **Lücken schließen**: Lese-Regeln `auth.uid() is not null` auf
   personenbezogenen Tabellen durch echte Rollenprüfungen ersetzen;
   alle Views `security_invoker = true`; Spalten-Schutz für IBAN/SV-Nr./
   Steuer-ID wieder in der Datenbank (eigene View für eingeschränkte Rollen
   statt Spalten-Grant, weil `select *` daran 2026-08-09 gescheitert ist).
4. Seiten der eingeschränkten Rollen (zeiterfassung, erntewirtschaft, waage,
   hausmeister) einmal durchklicken bzw. Abfragen prüfen.

#### Stand Stufe 0 (2026-11-24)

- Live eingespielt: `migration_2026-11-24_anon_zugriff_sperren.sql` (kein
  Zugriff ohne Anmeldung), `migration_2026-11-24b_nur_aktive_rollen.sql`
  (nur aktive Profile mit Rolle; 36 Policies + Storage). Selbst-
  Registrierung in Supabase vom Nutzer abgeschaltet.
- Werkzeug: `supabase/tests/rechte_test.sh` (exakte Kopie der Live-Struktur
  über nur-Katalog-Zugang `claude_struktur`, Testdaten, Matrix 13 Zugänge x
  134 Tabellen/Views, Vorher/Nachher mit Migrationen).
- Stufe 0b (`migration_2026-11-24c_rollenrechte_lesen.sql` + Strichliste
  ohne `select("*")` + Prüfer sieht Änderungsprotokoll), Nutzer-
  Entscheidung 2026-11-24:
  - Tagesstunden: alle außer hausmeister/waage; Stundenkonto zusätzlich
    ohne erntewirtschaft; Saisonabrechnungen/Auszahlungsbelege/Auslagen/
    Vorschüsse (auch in der Suche): nur Lohn-Rollen; Unterkunft: alle außer
    waage.
  - Monatsabschluss-Fehler (Audit-Trigger erwartete Spalte `id` in
    `periods`) behoben.
- Stufe 0c (gebaut, Branch): Daten bleiben in `employees`, heikle Spalten
  per Spaltenrecht für authenticated gesperrt; Zugriff über Views
  `employee_personaldaten` (admin/hr, les-/schreibbar), `employee_bankdaten`,
  `employee_lohndaten`. Ausrollen ohne Ausfall: Migration 2026-11-24d
  (nur Views) → Code → Migration 2026-11-24e (Rechte entziehen). Freigegeben:
  Grunddaten alle; Stundenlohn admin/hr/lohnabrechnung/management;
  IBAN/BIC/Zahlungsempfänger admin/hr/kasse/lohnabrechnung (NICHT
  management/pruefer); SV-Nr./Steuer-ID/Anschrift/Geburtsdaten/
  Familienstand/Kontakt/Schwarze Liste nur admin/hr.

### Stufe 1 - Mehrere Rollen je Nutzer

Stand 2026-11-24: gebaut (Branch). Migration `2026-11-24f_mehrfachrollen`
schreibt alle Prüfungen automatisch aus dem Live-Stand um und bricht ab,
falls eine übrig bleibt; Rechte-Matrix Einzelrollen vorher/nachher
identisch, Mehrfachrolle = Vereinigung. Code: ~200 Prüfungen in 60 Dateien
auf `hatRolle()`; einschränkende Sichten (Hausmeister, Arbeitsgruppen-only)
gelten nur ohne weitere "größere" Rolle; Startseite nach Hauptrolle.
Nutzerverwaltung mit Rollen-Häkchen + Hauptrolle.

- `profiles.rollen user_role[]` (Pflicht, nicht leer), befüllt aus `role`.
  `role` bleibt zunächst als "Hauptrolle" für Anzeige/Rückwärtskompatibilität.
- SQL-Helfer `hat_rolle(variadic user_role[])`; alle Policies/Funktionen von
  `current_role_name() in (...)` auf `hat_rolle(...)` umstellen (mechanisch,
  vom Rechte-Test abgesichert: Matrix vorher = nachher).
- Client: `useProfile` liefert `rollen`; `MENUE_RECHTE`, `canEdit`-Prüfungen
  auf "irgendeine der Rollen".
- Nutzerverwaltung: Mehrfachauswahl Rollen; Schutz gegen Selbst-
  Rechteerhöhung bleibt (Trigger auf `rollen`).
- Danach kann der HR-Mitarbeiter von `admin` auf die passenden Rollen
  zurückgesetzt werden.

### Stufe 2 - Personalstamm als Rechte-Grenze

Stand 2026-11-24: gebaut (Branch), umbenannt in **Geschäftsbereich**
(LW/VT), weil der Nutzer die drei Firmen "Personalstämme" nennt. Nutzer-
Entscheidung: Mönich und Mömmel brauchen keine Rechte-Trennung (nur
Kassenbuch/Lohn-Monatsfilter/Kosten je Firma -> Stufe 3). Umsetzung über
zusätzliche einschränkende Policies (bestehende Rollen-Regeln unverändert),
Filter in 10 Eigentümer-Views, Prüfung in 15 Funktionen. Unterkunft-
Belegung bereichsübergreifend; auszahlungsbeleg_summary bleibt bis Stufe 3
ungefiltert (speist den Kassenbestand). Bestehende Nutzer: nur LW.

- Tabelle `personalstamm` (`LW`, `VT`; Bezeichnung, Personalnummer-Präfix,
  Standard-Kassenbuch).
- `employees.personalstamm` not null, Bestand = `LW`.
  `personal_kandidaten.personalstamm`, `arbeitsgruppen.personalstamm`.
- `profiles.personalstaemme text[]`; admin/management/pruefer immer alle.
- Helfer `darf_personalstamm(ps)` und `darf_mitarbeiter(employee_id)`
  (security definer, stabil, indexgestützt) - in jede Regel jeder
  personenbezogenen Tabelle, in jede security-definer-Funktion, in die
  Storage-Regeln der Personaldokumente.
- Rechte-Test um "fremder Personalstamm = 0 Zeilen, Schreiben verboten"
  erweitern; Test-Nutzer je Personalstamm.
- Oberfläche: Wer beide sieht, bekommt Umschalter "Alle / Landwirtschaft /
  Vertrieb" (Nav, gemerkt je Nutzer) + Kennzeichen in Listen. Wer einen hat,
  sieht keinen Unterschied.
- Personalnummern-Vergabe (`/personalnummern`) je Personalstamm mit Präfix.
- Rollen erntewirtschaft/waage: nur LW (Prämien/Ernte bleiben LW-only).

### Stufe 3 - Firmen, Saison-Zuordnung, Kassen, Sätze, Minijob

Aufgeteilt (2026-11-24): **3a** Firmen + Firma je Person/Saison + Filter/
SEPA/Lohnsteuer je Firma (gebaut, Migration 2026-11-24i; Nutzer: Standard
immer Mömmel, Firmennamen "... GmbH & Co. KG", gemischte SEPA-Belege ->
Datei je Firma); **3b** Kassenbuch je Buchung + Kassenstand/-prüfung je
Buch (gebaut, Migration 2026-11-24j mit eingebauter Kassenstand-Selbstprüfung;
Nutzer: ML und MD werden Lohnkassen, MÖ bleibt allgemein, getrennte
Nummernkreise mit Präfix); **3c** Lohnberechnung (Sätze je Bereich, Abzugs-Zeiträume, Minijob) -
gebaut (Migration 2026-11-25; Ausnahmen als "ohne"-Zeiträume, Default =
wie bisher jeder Anwesenheitstag; Nachweis + Umstellung atomar in einem
DO-Block). Offen/Hinweis: SV-Prüfung (90-Tage-Grenze) kennt Minijob noch
nicht gesondert.

- Tabelle `firmen` (Name, Kurzname, IBAN/BIC, Steuernummer, Anschrift,
  Personalstamm) ersetzt `firmen_bankdaten`; Bestandswerte übernommen als
  Mömmel Agrar.
- `kassenbuch.firma_id`.
- Tabelle `employee_saison` (employee_id, saison_jahr, firma_id null).
- Unterkunft/Verpflegung als **Zeiträume** statt Ja/Nein (Vertriebs-
  Anforderung "ohne Essen ab einem bestimmten Monat"): Tabelle
  `employee_abzug_zeitraum` (employee_id, art unterkunft|verpflegung, von,
  bis null, berechnen bool). Ohne Eintrag = wie heute (beides an jedem
  Anwesenheitstag) - keine bestehende Abrechnung ändert sich.
- `season_summary`/`season_summary_monat`: Abzug Wohnen/Verpflegung nur an
  Anwesenheitstagen innerhalb eines berechneten Zeitraums; Sätze aus `verpflegungssaetze` je
  (saison_jahr, personalstamm) - Mindestlohn bleibt je Jahr für alle.
  Vorher/nachher-Vergleich aller bisherigen Abrechnungen = identisch.
- Kassenbuch je Bar-Buchung: `advances`, Auszahlungsbelege, Kautionen
  bekommen `kassenbuch_id`; Vorbelegung aus der **Firma der Saison**
  (`employee_saison.firma_id` → Lohn-Kassenbuch der Firma); ohne Firma
  Rückfall auf den Personalstamm (LW → MLK, VT → MD). Bestand = MLK.
  Jede Firma braucht ein Lohn-Kassenbuch (`kassenbuch.typ`/Kennzeichen
  "Lohnbuchungen erlaubt" für MLK, ML, MD). `kassenbestand_bis()`/
  `kassenbuch_saldo_bis()` rechnen je Buch. Kassenprüfung je Buch
  (Kassenbücher Phase 2, bisher offen) wird damit Pflicht, weil ML und MD
  echtes Lohn-Bargeld führen.
- SEPA-Datei, Lohnsteuer-Sammelantrag, Lohnübersicht/Monatsdruck: je Firma
  (aus `employee_saison`) bzw. Personalstamm filter-/trennbar.
- `abrechnungsart` + `minijob`: keine App-Lohnsteuer, Netto aus HSC
  (`netto_extern`). Felder `minijob_rv_befreit` (bool),
  `minijob_pauschsteuer_arbeitgeber` (bool, default true) - Dokumentation.
  `verpflegungssaetze.minijob_grenze` je Jahr (Einstellungen); Warnung in
  der Lohnübersicht, wenn ein Minijobber im Monat darüber liegt.

### Stufe 4 - Vertrieb übernehmen

Nutzer 2026-11-24: aktuell **keine aktiven Verkäufer** - übernommen wird die
komplette Historie. Basis ist daher der vorhandene **Historie-Import**
(`/personal-import-historie`, `lib/personalImportHistorie.ts`: Zeile je
Person+Jahr → inaktive Person + `employee_saison_praesenz`), erweitert um:
Personalstamm VT fest, Präfix `V-`, Firma Mönich Direkt je Jahr
(`employee_saison`), neue Spalten (GEBDATUM, STRASSE, HAUSNUMMER, PLZ,
Minijob), Abgleich mit LW (gleiche Person in beiden Stämmen = verknüpfen,
keine Dublette). Pflichtspalten: PERSONALNR, NAME, VORNAME, GEBDATUM, JAHR.
Der erste Buchhaltungs-Export (nur PERSONALNR..LAND, ohne ORT/JAHR) reicht
nicht - Nutzer holt einen vollständigen Export nach.

(ursprüngliche Punkte:)

- Personal-Import erweitert: fester Personalstamm VT, automatisches `V-`,
  Firma Mönich Direkt für die Saison, Unterkunft/Verpflegung/
  Beschäftigungsart je Zeile. Benötigt: Spaltenköpfe der Vertriebs-Excel
  (+ eine erfundene Beispielzeile). Lokal testen, dann echter Import.
- Arbeitsgruppen (Stände) Vertrieb anlegen, Sätze VT pflegen.
- Vertriebs-Nutzer mit Vorlage anlegen; Rechte-Test mit echten Rollen,
  Probelauf eine Woche Stunden + Vorschüsse.

### Stufe 5 - Vertriebs-Funktionen (aus der Anforderungsliste)

Aus dem Abgleich unten, Stand 2026-11-24 - Kandidaten für den Start des
Vertriebs: Monatsabschlag (Vorschussliste + SEPA), freie pauschale
Prämie/Zulage in €, So-/Feiertags- und Urlaubsstunden getrennt,
Wochenstundenzettel, Monatsnachweis je Person. Zurückgestellt: Standorte/
Öffnungszeiten, Einsatzplan/Abfahrtszeiten, Fahrerlohn an Fahrtagen.

### Später (eigene Planung)

Personalplanung Vertrieb, Prämien Vertrieb, Firma je Saison in der
Personalplanung vorbelegen, Entfernen von `profiles.role`.

## Risiken / Gegenmaßnahmen

| Risiko | Maßnahme |
|---|---|
| Rechte-Umbau sperrt versehentlich Seiten (wie 2026-08-09) | Rechte-Test Soll/Ist vor jeder Migration; Seiten je Rolle durchklicken; Migration in einem Zug mit Rückweg-Skript |
| Abrechnungsbeträge ändern sich unbemerkt | Vor/nach-Vergleich `season_summary` aller Personen/Jahre in der lokalen Kopie muss identisch sein |
| Kassenbestand MLK verschiebt sich | Bestand bleibt MLK; Vergleich `kassenbuch_saldo_bis` vor/nach |
| Performance durch Prüffunktion in jeder Regel | Index auf `employees(id, personalstamm)`, stabile Funktion; Messung mit Bestandsdaten |
| Datenleck über Views/RPCs mit erhöhten Rechten | Alle Views `security_invoker`; jede security-definer-Funktion prüft `darf_mitarbeiter` selbst; Teil des Rechte-Tests |

## Abgleich Anforderungsliste Vertrieb (2026-11-24)

Legende: **vorhanden** = gibt es schon, ggf. nur für VT freizuschalten;
**im Plan** = durch Stufe 0-4 abgedeckt; **neu** = zusätzlicher Bau.

| # | Anforderung | Stand | Anmerkung |
|---|---|---|---|
| 1.1 | HSC-Anmeldung erfassen/kontrollieren | entfällt | ergibt sich aus den Vertragszeiträumen (Nutzer 2026-11-24) |
| 1.2 | Freibetrag-Beantragung | vorhanden | `/personal-lohnsteuer` (Verfahrensstand bis "Freibetrag erteilt") - zu prüfen, ob für Deutsche/Vertrieb passend |
| 1.3 | Fahrer eindeutig kennzeichnen (anderer Lohn) | zurückgestellt | anderer Lohn nur an Fahrtagen - Nutzer 2026-11-24: vorerst ignorieren |
| 2.1 | Standorte statt Gruppen | zurückgestellt | Arbeitsgruppen werden je Personalstamm getrennt (Stufe 2); eigene Standorte später |
| 2.2 | Standorte mit Öffnungszeiten | zurückgestellt | mit den Standorten |
| 2.3 | Einsatzplan im Programm | zurückgestellt | erst wenn alles andere läuft (Nutzer 2026-11-24) |
| 2.4 | Abfahrtszeiten vermerken | zurückgestellt | Teil des Einsatzplans |
| 2.5 | Wochenstundenzettel je Person | neu (klein), Entwurf | Erster Entwurf als Druckansicht aus der KW-Wochenansicht; Nutzer erwartet Nachbesserung nach Rückmeldung des Vertriebs |
| 3.1 | Sonntags-/Feiertagszuschläge (Deutsche); Urlaub getrennt | neu (mittel) | App weist So-/Feiertagsstunden (Feiertagskalender Hessen) und Urlaub (`U`) getrennt aus; Zuschlag rechnet HSC |
| 3.2 | Zulagen direkt in Euro | vorhanden | monatliche Zulage in € (Stundenkonto mit Monatszuordnung) + Saison-Zulagen in € |
| 3.3 | Monatliche Abrechnung per Überweisung | neu (mittel) | **Monatsabschlag** = Vorschussliste (Nutzer 2026-11-24): je Monat Liste der Personen, Betrag = Netto aus HSC abzüglich bereits erhaltener Vorschüsse (App zeigt diese an), erzeugt Vorschüsse (Überweisung, Art "Monatsabschlag") + SEPA-Vorschussdatei über das vorhandene SEPA-Modul. Saisonabrechnung zieht sie wie jeden Vorschuss ab. Keine eigene Monatsabrechnung. |
| 3.4 | Aushilfen aus der Landwirtschaft im Verkauf | vorhanden | werden in der Landwirtschaft abgerechnet (bleiben im Personalstamm LW) |
| 3.5 | Stunden, Vorschüsse, Zulagen monatlich drucken | teilweise | Monatsdruck `/uebersicht` (Summen) vorhanden; Einzelnachweis je Person/Monat = neu (klein) |
| 3.6 | Pauschale Prämie/Zulage frei eingeben | neu (klein) | Freies Feld "Prämie/Zulage pauschal" in € (mit Bemerkung) je Person + Saison, ins Brutto. Prüfen: `season_summary` entsteht heute nur aus Stundeneinträgen - Person ohne Stunden erscheint nicht |
| 4.1 | Strafzettel | vorhanden | Vorschuss mit Pflicht-Beleg (Strafzettel/Rechnung) |
| 4.2 | Zimmerkaution | vorhanden | `zimmer_kaution`, Kautionsübergabe |
| 4.3 | Fahrerkaution (Auto) | vorhanden | `fahrer_kaution` - Regeln nochmal besprechen |
| 5.1 | Ohne Essen; Wechsel "ohne Essen" ab Monat | im Plan | Abzugs-Zeiträume (Stufe 3) |
