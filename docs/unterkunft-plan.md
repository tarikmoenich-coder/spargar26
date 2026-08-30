# Unterkunft / Zimmerverwaltung — Umsetzungsplan

Stand: 2026-08-29. Arbeitsdokument, damit der Planungsstand einen Konsolen-Neustart
übersteht. Kann gelöscht werden, sobald das Modul steht (oder als ADR-Notiz bleiben).

## Fortschritt (2026-08-29)

- [x] Migration `supabase/migration_2026-08-29_unterkunft.sql` geschrieben
      (9 Tabellen, GIST-EXCLUDE gegen Doppelbelegung, Schutz-/Audit-/updated_at-
      Trigger, 2 Sichten, RLS admin+hr, Bucket `unterkunft-fotos`, Checklisten-Seed).
      **Noch nicht in der Supabase-Konsole ausgeführt.**
- [x] `lib/types.ts` um Unterkunft-Interfaces + Label-Maps erweitert
- [x] `lib/auditLog.ts` BEREICH_LABELS ergänzt
- [x] `lib/unterkunft.ts` angelegt (Bucket-Konstante, `bildVerkleinern`,
      `fotoStoragePfad`, `heuteIso`, `belegungLaeuft`)
- [x] `components/UnterkunftTabs.tsx`
- [x] `components/FotoAufnahme.tsx` (Capture + Verkleinern + Upload + Thumbnails + Löschen)
- [x] `app/unterkunft/stammdaten/page.tsx` (Gebäude/Zimmer/Betten/Checkliste)
- [x] `app/unterkunft/page.tsx` (Belegungsplan-Übersicht)
- [x] `app/unterkunft/belegung/page.tsx` (Belegung anlegen / Auszug / löschen)
- [x] `app/unterkunft/uebergabe/page.tsx` (Übergabe/Abnahme-Flow mit Checkliste + Fotos,
      idempotenter Start per client-UUID, Zwischenspeichern + Retry, Abschließen →
      Mängel-Übernahme)
- [x] `app/unterkunft/kontrolle/page.tsx` (Zwischenkontrolle, gleiche Mechanik)
- [x] `app/unterkunft/maengel/page.tsx` (Mängelliste, Status/Schwere/Notiz/Fotos)
- [x] `components/FotoAufnahme.tsx` generalisiert (vorgangId ODER mangelId)
- [x] Nav-Eintrag „Unterkunft" in `components/Nav.tsx` (roles: admin, hr)
- [x] `npx tsc --noEmit` sauber · `npx next build` grün (alle 6 /unterkunft-Routen)
- [x] DDL zusätzlich in `supabase/schema.sql` (Abschnitt 15, Fresh-Install-Parität)
- [x] **Migration in der Supabase-SQL-Konsole ausgeführt** (2026-08-29, bestätigt) –
      `supabase/migration_2026-08-29_unterkunft.sql`
- [x] PWA installierbar gemacht (Manifest + Icons + Apple-Meta, **ohne** Service
      Worker wegen README-bfcache-Bug) — `public/manifest.webmanifest`,
      `public/icon-{192,512}.png`, `public/apple-touch-icon.png`,
      `scripts/gen-pwa-icons.mjs`, `app/layout.tsx` (metadata + viewport)
- [ ] Smoke-Test vom Handy über die **Vercel-Preview-URL** des Branch
      `unterkunft-modul` (alles ist auf Vercel deployed): Login als admin/hr →
      Unterkunft → Stammdaten → Belegung → Übergabe mit Foto; „Zum
      Startbildschirm hinzufügen" testen
- [ ] optional Dashboard-Kachel (offene Mängel / fällige Kontrollen)
- [ ] optional: README.md-Abschnitt im Nutzer-Stil
- [ ] PR `unterkunft-modul` → `main` mergen (danach Prod-URL installierbar)

### Status: DB-Migration durch, Modul einsatzbereit
Code auf Branch `unterkunft-modul` (Commit b74c19e), Migration in Supabase
ausgeführt. Nächster Schritt: `npm run dev` und Smoke-Test.

## Erweiterung (2026-08-30): Grundriss + Rolle „hausmeister"

Nutzer-Vorgaben:
1. Zimmerplanung grafischer: Gebäudeliste, dann als zweite Ebene ein
   schematischer **Grundriss je Stockwerk** mit anklickbaren Zimmer-Kacheln.
2. Neue Rolle **`hausmeister`** – sieht ausschließlich das Unterkunfts-Modul
   (+ Suche). `admin`/`hr` weiterhin voll; `erntewirtschaft` **nur lesen**.

Entscheidungen (2026-08-30):

| Frage | Entscheidung |
|---|---|
| `erntewirtschaft` | nur Lesezugriff (kein RLS-Change nötig, Menüpunkt sichtbar) |
| `hausmeister` abgrenzen | Nav-Ausblendung reicht (kein URL-Guard) |
| `hausmeister` + Suche | ja, inkl. neuem Unterkunfts-Block in der Suche |
| `hausmeister` + Stammdaten | nein – nur Belegung/Übergabe/Kontrolle/Mängel/Fotos |
| Grundriss-Variante | Vektor-Editor auf Raster (SVG), kein Hintergrundbild |
| Etage | eigenes Stammdatum `unterkunft_etage` (Bestandsdaten umgezogen) |
| Kontroll-Ampel | ja; Schwellen 75/90 Tage als Konstante, Kontrollmuster noch offen |
| Grundriss = Einstieg | ja; alte Tabelle → `/unterkunft/belegungsplan` |
| Zimmer platzieren | nur `admin` (UI-seitig) |

Umgesetzt:
- [x] Migration `migration_2026-08-30_rolle_hausmeister_1_enum.sql`
      (`alter type user_role add value 'hausmeister'`) – **eigener Lauf zuerst**
- [x] Migration `migration_2026-08-30_rolle_hausmeister_2_policies.sql`
      (Write-Policies belegung/vorgang/position/mangel/foto + Storage → +hausmeister)
- [x] Migration `migration_2026-08-30_unterkunft_grundriss.sql`
      (Tabelle `unterkunft_etage`, Spalten `plan_x/y/w/h` auf `unterkunft_zimmer`,
      Datenumzug aus `etage`-Text, View `unterkunft_zimmer_uebersicht` neu,
      View `unterkunft_belegung_person`, RLS)
- [x] `supabase/schema.sql` Abschnitt 1 (enum) + 15 gespiegelt
- [x] `lib/types.ts`: `UserRole` +`hausmeister`; `UnterkunftEtage`,
      `UnterkunftBelegungPerson`; `UnterkunftZimmer`/`…Uebersicht` um
      `etage_id`/`plan_*` erweitert
- [x] `lib/unterkunft.ts`: `GRUNDRISS_ZELLE`, `kontrollAmpel()` + Ampel-Labels/Farben
- [x] `components/Nav.tsx`: Unterkunft-Rollen = admin/hr/erntewirtschaft/hausmeister
- [x] `components/UnterkunftTabs.tsx`: Tabs „Grundriss" + „Belegungsplan"
- [x] `app/unterkunft/page.tsx`: neuer Grundriss (SVG-Canvas, Zimmer-Panel,
      Bearbeiten-Modus mit Ziehen/Pfeiltasten/Größe – nur admin)
- [x] `app/unterkunft/belegungsplan/page.tsx`: bisherige Tabelle hierher verschoben
- [x] `app/unterkunft/stammdaten/page.tsx`: Etagen-Verwaltung je Gebäude,
      Zimmer-Anlage mit Etagen-Auswahl statt Freitext
- [x] `app/unterkunft/{belegung,uebergabe,kontrolle,maengel}/page.tsx`:
      `canEdit` um `hausmeister` erweitert
- [x] `app/page.tsx` + `app/dashboard/page.tsx`: `hausmeister` → `/unterkunft`
- [x] `app/suche/page.tsx`: Block „Unterkunft" (alle Belegungszeiträume der Person)
- [x] `npx tsc --noEmit` sauber · `npx next build` grün

Offen:
- [ ] **Migrationen in der Supabase-Konsole ausführen** – Reihenfolge:
      `…hausmeister_1_enum.sql` allein + committen, dann `…hausmeister_2_policies.sql`
      und `…unterkunft_grundriss.sql`
- [ ] `hausmeister`-Benutzer in Supabase anlegen (profiles.role = 'hausmeister')
- [ ] Smoke-Test: Grundriss zeichnen (admin), Zimmer anklicken; Login als
      `hausmeister` → sieht nur Unterkunft + Suche
- [ ] Kontrollmuster festlegen (Intervall je Zimmertyp/Saison) → Schwellen in
      `lib/unterkunft.ts` anpassen
- [ ] später: Freitext-Spalte `unterkunft_zimmer.etage` per Migration entfernen
- [ ] optional: `?zimmer=`-Deep-Link aus dem Grundriss-Panel in die Arbeits-Tabs

### Wiedereinstieg nach Konsolen-Neustart
`claude --continue` in `~/projekte/spargar26`. Diese Datei ist die Quelle der Wahrheit.

## 1. Kontext & getroffene Entscheidungen

Neue Funktion für spargar: Zimmerübergabe/-abnahme per App mit Fotodokumentation,
Zwischenkontrollen je Zimmer mit Fotos, Mängelerfassung. Fundament davor: ein Werkzeug
zur Zimmerplanung (Gebäude → Zimmer → Betten → Belegung).

Entscheidungen aus der Abstimmung (2026-08-29):

| Frage | Entscheidung |
|---|---|
| Repo-Form (Zielbild) | „Betriebsportal + Module" in einem Monorepo, geteilter Code in `packages/`. **Zielbild, nicht jetzt.** |
| Umsetzung jetzt | **Direkt in spargar26** einbauen, als abgekapseltes Modul (`app/unterkunft/…`, `lib/unterkunft.ts`, eigene Migrations-Dateien mit Prefix `unterkunft_`), sauber heraushebbar für den späteren Portal-Umzug. |
| Datenbank | **spargars eigenes Supabase-Projekt** (nicht das gemeinsame von Rechnung/Pacht) — native FK auf `employees`, Wiederverwendung von `profiles`/`user_role`/Audit-Log. Der gemeinsame `core`-Backbone im geteilten Projekt bleibt Zielbild für den Konsolidierungsschritt. |
| Offline | „Meist online" mit Retry reicht für v1. Schreibpfad aber offline-nachrüstbar bauen (client-generierte UUID als PK, idempotenter Upsert, „Abschließen" als zweiter Schritt). |

## 2. Konventionen aus spargar26 (einzuhalten)

- `"use client"`-Seiten, App Router, ein Browser-Client (`getSupabaseClient()`), kein SSR.
- Rolle clientseitig über `useProfile()` (`canEdit`/`isAdmin`), Durchsetzung serverseitig via RLS.
- Storage: `supabase.storage.from(BUCKET).upload/createSignedUrl/remove`, private Buckets.
- Schema: ausführliche Kommentare, `current_role_name() in (...)` in RLS-Policies,
  versionierte Sätze/Vorlagen mit `gueltig_ab` (ADR-007), Append-only-Audit via Trigger
  `write_audit_log()`, Spalten `erfasst_von/erfasst_am`, `updated_by/updated_at`, `version`
  für optimistische Nebenläufigkeit, Storno statt Löschen (ADR-011).
- Migrationen: einzelne `supabase/migration_YYYY-MM-DD_thema.sql`, manuell in der Supabase-
  SQL-Konsole ausgeführt. Enum-Erweiterung IMMER in getrennter Datei vor ihrer Nutzung.
- Sub-Navigation über eine Tabs-Komponente (`PraemienTabs`-Muster).
- `lib/types.ts` spiegelt das Schema. Deutsch durchgängig.
- Tabellenname ist `employees` (Typ `Employee`), nicht `mitarbeiter`.

## 3. Datenmodell (neue Migration, Prefix `unterkunft_`)

- `unterkunft_gebaeude` — id, name, adresse, notiz, aktiv, erfasst_*, updated_*
- `unterkunft_zimmer` — id, gebaeude_id FK, nummer, etage, bettenzahl, notiz, aktiv;
  unique(gebaeude_id, nummer)
- `unterkunft_bett` — id, zimmer_id FK, bezeichnung; unique(zimmer_id, bezeichnung)
- `unterkunft_belegung` — id, bett_id FK, employee_id FK → employees,
  von date, bis date NULL, notiz, erfasst_*;
  EXCLUDE USING gist (bett_id WITH =, daterange(von, coalesce(bis,'infinity'), '[)') WITH &&)
  gegen Doppelbelegung (benötigt Extension `btree_gist`)
- `unterkunft_checkliste_vorlage` — id, bereich, reihenfolge, aktiv, gueltig_ab
  (versioniert, ADR-007); Seed mit Standard-Bereichen
- `unterkunft_vorgang` — id (uuid, client-generiert), zimmer_id FK,
  typ check ('einzug','auszug','zwischenkontrolle'), belegung_id FK NULL,
  durchgefuehrt_von (profiles), durchgefuehrt_am, gesamtzustand
  check ('gut','gebrauchsspuren','maengel'), notiz, unterschrift_name NULL,
  zustand_bestaetigt bool default false, abgeschlossen bool, abgeschlossen_am NULL;
  nach Abschluss kein Update (außer admin-Storno)
- `unterkunft_vorgang_position` — id, vorgang_id FK, bereich,
  zustand check ('io','mangel','na'), bemerkung
- `unterkunft_foto` — id, vorgang_id FK NULL, mangel_id FK NULL, bereich NULL,
  storage_path, dateiname, breite, hoehe, aufgenommen_am, hochgeladen_von, hochgeladen_am
- `unterkunft_mangel` — id, zimmer_id FK, quelle_vorgang_id FK NULL, beschreibung,
  schwere check ('gering','mittel','hoch'), status check ('offen','in_arbeit','behoben'),
  gemeldet_*, behoben_von NULL, behoben_am NULL, behebung_notiz NULL

Views:
- `unterkunft_zimmer_belegung` — je Zimmer: Betten/Kapazität, heute belegt, frei, nächste Belegung
- `unterkunft_zimmer_status` — je Zimmer: letzte Kontrolle (Datum/Typ), Anzahl offener Mängel

RLS:
- Lesen: `authenticated` (ggf. enger).
- Stammdaten schreiben (gebaeude/zimmer/bett/vorlage): `admin` (+ ggf. `hr`).
- Belegung/Vorgänge/Mängel/Fotos: `admin`, `hr` (+ neue Rolle, falls gewählt).
- Audit-Trigger `write_audit_log()` auf `unterkunft_vorgang`, `unterkunft_belegung`,
  `unterkunft_mangel`; `BEREICH_LABELS` in `lib/auditLog.ts` ergänzen.
- Storage-Bucket `unterkunft-fotos` (privat) + Policies analog `mitarbeiter-dokumente`.

## 4. Frontend

Nav: neuer Punkt „Unterkunft" → `/unterkunft` (roles: admin, hr, + neue Rolle).
Tabs-Komponente `components/UnterkunftTabs.tsx`:

- `/unterkunft` — Belegungs-/Zimmerübersicht (Einstieg): wer wohnt wo, freie Betten,
  letzte Kontrolle, offene Mängel je Zimmer/Gebäude
- `/unterkunft/belegung` — Belegung verwalten (Mitarbeiter → Bett/Zimmer, von–bis)
- `/unterkunft/uebergabe` — Übergabe/Abnahme (mobil): Zimmer → Typ → Checkliste je Bereich
  (Zustand + Foto + Bemerkung) → Unterschrift → Abschließen
- `/unterkunft/kontrolle` — Zwischenkontrolle (mobil): Zimmer → Fotos + optional Mangel → Abschließen
- `/unterkunft/maengel` — Mängelliste (offen/behoben, Filter je Gebäude)
- `/unterkunft/stammdaten` — Gebäude/Zimmer/Betten CRUD + Checklisten-Vorlage (admin)

Komponenten:
- `components/UnterkunftTabs.tsx`
- `components/FotoAufnahme.tsx` — `<input type="file" accept="image/*" capture="environment">`,
  clientseitige Verkleinerung (canvas, max ~1600 px, JPEG 0.8), Vorschau, Upload in Bucket,
  liefert storage_path + Maße + Aufnahmezeit zurück. Wiederverwendbar.
- optional `components/UnterschriftPad.tsx` (Canvas-Signatur → Blob → Upload)

lib:
- `lib/types.ts` — neue Interfaces + View-Typen
- `lib/unterkunft.ts` — Bucket-Konstante, Bildverkleinerung, Bereichs-/Typ-Labels,
  Helfer „aktive Belegung heute"

Offline-/Retry-Verhalten v1: Fotos direkt hochladen; Vorgang mit client-UUID als PK →
idempotenter Upsert; „Abschließen" separat. Bei Netzfehler bleibt lokaler Zustand +
Button „Erneut senden". `beforeunload`-Warnung bei offenen, nicht gespeicherten Positionen.

## 5. Integration zu Bestehendem

- `season_summary.zimmer_kaution` existiert bereits (Kaution wird bei Abreise wie ein
  Vorschuss abgezogen; Rückzahlung nach Kontrolle läuft bar außerhalb der App).
  v1: Auszug-Vorgang dokumentiert Ergebnis + Mängel; **kein** automatischer Kautionsabzug.
  Optional nur ein Doku-Feld „Kaution: einbehalten/erstattet" im Auszug.
- Personenbezug über `employees` / `Employee`.

## 6. Reihenfolge der Umsetzung

1. Migration(en) schreiben (`migration_2026-08-29_unterkunft*.sql`, ggf. Enum-Datei für neue
   Rolle separat) + `btree_gist`-Extension + Audit-Trigger + Bucket-Policies
2. `lib/types.ts` erweitern, `lib/unterkunft.ts` anlegen
3. Stammdaten-CRUD (`/unterkunft/stammdaten`)
4. Belegungsübersicht `/unterkunft` + Belegung verwalten
5. `FotoAufnahme`-Komponente + Bucket
6. Übergabe-/Abnahme-Flow
7. Zwischenkontrolle + Mängel
8. Nav-Eintrag, `UnterkunftTabs`, optional Dashboard-Kachel

## 7. Geklärte Fragen (2026-08-29)

1. **Rolle:** v1 nur `admin` + `hr`. Kein neuer `user_role`-Wert. Eigene Rolle
   (`hausmeister`) später nachziehbar (dann getrennte enum-Migration).
2. **Belegung:** bettgenau — `unterkunft_bett` + Belegung je Bett + GIST-EXCLUDE
   gegen Doppelbelegung (`btree_gist`).
3. **Unterschrift:** v1 „Name + bestätigt" — Feld `unterschrift_name` + Haken
   „Zustand bestätigt" + Zeitstempel/Bearbeiter. Kein Canvas-Pad, kein
   `unterschrift_path` in v1.
4. **Checkliste:** Standard-Set als Seed der Vorlage: Wände/Decke, Boden, Fenster,
   Türen, Bad/WC, Küche, Möbel, Betten/Matratzen, Elektro/Licht, Sauberkeit,
   Schlüssel. Über `unterkunft_checkliste_vorlage` später änderbar.
