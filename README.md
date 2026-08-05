# Spargar-App (Mömmel Agrar)

Web-Anwendung als Ersatz für "Spargar 2026 - Mömmel Agrar.xlsm". Mehrere
Nutzer können gleichzeitig arbeiten, Änderungen werden live synchronisiert
(Supabase Realtime).

## Umfang dieser Version (MVP)

Enthalten:
- Personalstamm (anlegen/bearbeiten/deaktivieren, keine Löschung), inkl.
  Abrechnungsart (pauschal/Lohnsteuerklasse 1/sozialversicherungspflichtig)
  und automatisch berechnetem "Aktiv seit" (erster Arbeitstag mit Stunden > 0)
- Tägliche Stundenerfassung mit Live-Sync zwischen mehreren Nutzern, nach
  Arbeitsgruppen (z.B. Sortierer, Träger) gruppiert mit Sprungleiste und
  Druckansicht pro Gruppe ("Gruppenstundenzettel")
- Arbeitsgruppen-Verwaltung unter Einstellungen (nur admin): Bezeichnung und
  Anzeige-/Druckreihenfolge je Gruppe
- Personalnummern-Übersicht: 10 Nummernkreise (1–999, 1000–1999, …),
  Dubletten-Erkennung, nächste freie Nummer je Kreis
- Personal-Import aus Excel/CSV mit Vorschau, Spaltenerkennung und
  Fehlerprüfung (u.a. bereits vergebene Personalnummern)
- Automatische Saison-Lohnübersicht (Stunden, Prämien, Verpflegungs-/
  Unterkunft-Abzüge, Vorschüsse, pauschale Lohnsteuer bei Abrechnungsart
  "pauschal": 5,275% vom Bruttolohn)
- Einstellungen-Seite (nur admin): Verpflegungs-/Unterkunft-Satz pro Tag,
  versioniert je Saisonjahr, Default 10€/10€
- Herkünfte-Verwaltung unter Einstellungen (nur admin), als Dropdown im
  Personalstamm (statt Freitext, damit Filter/Auswahl zuverlässig funktioniert)
- Vorschussverwaltung: einzeln, gruppenweise (nach Arbeitsgruppe) oder nach
  Herkunft auswählen, Betrag pro Person individuell anpassbar, atomare
  Belegnummer, Storno statt Löschen, druckbare Auszahlungsliste mit
  Unterschriftenfeldern
- Kassenbuch (Einzahlungen) mit Saldo und einfacher Kassenprüfung -
  Bar-Vorschüsse mindern automatisch den Kassenbestand, Überweisungen nicht
- Rollen/Rechte serverseitig über Postgres Row Level Security
- Append-only Audit-Log für Personal, Stunden, Vorschüsse, Kassenbuch

**Nicht enthalten** (siehe "Nächste Schritte"):
- Finalisierte Auszahlungsliste/Lohnabrechnungs-Export
- 90-Tage-/14-Wochen-Beschäftigungsprüfung (rechtliche Regel muss vom
  Auftraggeber/Steuerberater final freigegeben werden, siehe Open Issue
  OI-004 im Fachkonzept)
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

- OI-004: Exakte Definition der "90 Tage"/"14 Wochen"-Regel (rechtlich
  verbindlich) für die Beschäftigungsprüfung.
- OI-009: Exakte Brutto-/Netto-/Abzugsformeln der bisherigen Excel-Datei
  (die aktuelle `season_summary`-Berechnung ist ein Entwurf und muss
  gegen echte, abgeschlossene Abrechnungen verifiziert werden). Stand:
  Netto/Auszahlungsbetrag-Trennung + manuelle Eingabe des externen
  Lohnprogramm-Nettos (bei Lohnsteuerklasse 1/sozialversicherungspflichtig)
  sind umgesetzt, offen ist noch die Verifikation mit echten Testfällen
  sowie die Rolle der `season_bonuses`-Felder `bus_hin`/`bus_rueck`
  (aktuell nicht in der Brutto-Berechnung berücksichtigt).
- Migration bestehender Personal-/Saisondaten aus der `.xlsm`-Datei in
  dieses Schema (aktuell nicht automatisiert).
- Druckvorlagen für Stundenzettel (A5/A6) als PDF-Erzeugung.

## Architektur

- Frontend: Next.js (App Router) + Tailwind, React-Client-Komponenten
- Backend/Datenbank: Supabase (Postgres + Auth + Realtime)
- Autorisierung: Row Level Security in Postgres, siehe `supabase/schema.sql`
- Live-Sync: Supabase Realtime Channels (`postgres_changes`) in
  `app/erfassung/page.tsx`
