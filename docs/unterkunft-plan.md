# Unterkunft / Zimmerverwaltung — Umsetzungsplan

Stand: 2026-11-25. Das Modul ist gebaut und auf `main` im Einsatz. Der
Abschnitt „Aktueller Stand“ gibt den heutigen Stand wieder; alles danach ist
die historische Planung von Ende August/Anfang September 2026 (überholte
Stellen sind mit „→ ersetzt/erledigt“ markiert).

## Aktueller Stand (2026-11-25)

Seiten (Reiter `components/UnterkunftTabs.tsx`):

| Reiter | Route | Inhalt |
|---|---|---|
| Kontrollplan | `/unterkunft/kontrollplan` | Baum Gebäude → Wohneinheit → Raum, letzte Kontrolle, offene Mängel, späteste nächste Kontrolle, „Heute zu erledigen“ |
| Immobilien | `/unterkunft` | Gebäude → Wohneinheit-Karten → Zimmer (Grundriss oder Liste), Einzug/Auszug/Umzug, Gruppen-Einzug, Mangel melden, Sperren |
| Belegungsplan | `/unterkunft/belegungsplan` | je Zimmer Bewohner heute, freie Plätze (nur lesend) |
| Herkunfts-Planung | `/unterkunft/planung` | Soll je Herkunft (= Soll der Personalplanung) + reservierte Wohneinheiten |
| Belegung | `/unterkunft/belegung` | Personen ohne Bleibe einer Wohneinheit „geplant“ zuordnen, fest belegt, Direkt belegen |
| Übergabe / Abnahme | `/unterkunft/uebergabe` | Einzug/Auszug mit Checkliste je Raumtyp, Fotos, Schlüssel, Mängel-Übernahme |
| Auszüge | `/unterkunft/auszuege` | nur sichtbar, wenn offen: laufende Belegung + ausgezahlt oder inaktiv (View `unterkunft_auszug_offen`) |
| Zwischenkontrolle | `/unterkunft/kontrolle` | Zimmer oder ganze Wohneinheit kontrollieren |
| Mängel | `/unterkunft/maengel` | Mängelliste (Status, Schwere, Kategorie, Fotos) |
| Reparaturen | `/unterkunft/reparaturen` | Board für Mängel mit `kategorie='reparatur'`, Verursacher, Kosten, Belastung (`unterkunft_belastung`, Bestätigung unter /vorschuesse) |
| Stammdaten | `/unterkunft/stammdaten` | Gebäude, Wohneinheiten, Räume, Checkliste je Raumtyp, Kontrollzeitraum je Raumtyp |

Datenmodell heute (Live-Stand, `supabase/schema.sql` ist nicht aktuell):
`unterkunft_gebaeude`, `unterkunft_wohneinheit` (statt `unterkunft_etage`),
`unterkunft_zimmer` (mit `art` = Raumtyp zimmer/kueche/bad/wc/flur/
gemeinschaft, `bettenzahl` als Kapazität, `gesperrt`/`sperr_grund`,
`plan_x/y/w/h`), `unterkunft_belegung` (zimmergenau, KEINE Betten mehr seit
Migration 2026-09-04), `unterkunft_zuordnung` (Status `geplant`/`erledigt`/
`storniert`, seit 2026-09-17), `unterkunft_vorgang` (+ `schluessel_ausgegeben`/
`schluessel_zurueck`), `unterkunft_vorgang_position`, `unterkunft_foto`,
`unterkunft_mangel` (+ `kategorie`, `verursachung`, `kosten_geschaetzt`,
`faellig_am`, `verursacher_employee_ids`), `unterkunft_belastung`,
`unterkunft_checkliste_vorlage` (+ `art`), `unterkunft_kontroll_intervall`,
`unterkunft_herkunft_plan`, `unterkunft_herkunft_kontingent`. Views:
`unterkunft_zimmer_uebersicht`, `unterkunft_wohneinheit_uebersicht`,
`unterkunft_belegung_aktuell`, `unterkunft_belegung_person`,
`unterkunft_zuordnung_offen`, `unterkunft_person_offen`,
`unterkunft_auszug_offen`, `unterkunft_herkunft_abgleich`.

Migrationen (alle im Live-Schema vorhanden): 08-29 Grundmodul, 08-30
Hausmeister-Rolle + Grundriss, 08-31 Wohneinheit/Zuordnung, 09-01
Gemeinschaftsraum, 09-02 Raumtypen, 09-03 Grundriss sperren, 09-04 Zimmer
statt Bett, 09-05 Mangel-Fotos, 09-06 Belegung-Person-Name, 09-07 Auszug
schließt Belegung, 09-08 Kontrollintervall je Raumtyp, 09-09 Schlüssel, 09-10
Raumtyp WC, 09-11 Checkliste je Raumtyp, 09-12 Reparaturen, 09-14 Belastung,
09-16 offene Auszüge, 09-17 Zuordnung „geplant“, 09-18 Herkunfts-Planung.

Rollen (seit 2026-11-24 mehrere je Nutzer, `profiles.rollen`, Prüfung über
`hat_rolle()` / `hatRolle()`; Menü über `lib/rollen.ts` MENUE_RECHTE):
- admin/hr: alles; Grundriss platzieren nur admin.
- erntewirtschaft: nur lesen.
- hausmeister (Vorgabe 2026-09-15, `nurHausmeisterSicht()`): Reiter
  Immobilien, Belegungsplan, Herkunfts-Planung (nur lesend), Auszüge,
  Reparaturen; darf Ein-/Auszüge (Übergabe), Umzüge und Mängel/Reparaturen.
  KEINE Zwischenkontrollen/Kontrollplan (Weiterleitung zu Reparaturen),
  keine Stammdaten.

Kontrolllogik (`lib/unterkunft.ts` `naechsteKontrolle`): Zyklus je Raumtyp
aus `unterkunft_kontroll_intervall` (Fallback 75/90 Tage), offener Mangel →
Kontrolle binnen 3 Tagen, bei Kontrolle nicht behoben → binnen 1 Tag,
2× in Folge „alles in Ordnung“ → 14-Tage-Takt; Flure nicht kontrollpflichtig;
unbelegte Zimmer nicht fällig.

Bereiche (seit 2026-11-24): Bewohner sollen bereichsübergreifend sichtbar
sein (gemeinsame Häuser). Achtung (bitte prüfen): die Views mit Namen
(`unterkunft_belegung_aktuell` u.a.) verbinden per inner join mit
`employees` und unterliegen damit der Policy `bereich_grenze` - Nutzer mit
nur einem Bereich sehen Bewohner des anderen Bereichs nicht, die Zählung
belegt/frei zählt sie aber mit. Lösung braucht eine Migration.

Offen:
- [ ] Dashboard-Kachel (offene Mängel / fällige Kontrollen) - nicht gebaut.
- [ ] Freitext-Spalte `unterkunft_zimmer.etage` per Migration entfernen
      (live noch vorhanden).
- [ ] Bewohnernamen bereichsübergreifend (siehe oben).
- [ ] optional: Übergabe als Bottom-Sheet im Wohneinheit-Detail.
- [ ] Hausmeister-Benutzer: Rolle `hausmeister` in der Nutzerverwaltung
      (`profiles.rollen`) vergeben (bitte bestätigen, ob schon geschehen).

---

# Historische Planung (2026-08-29 bis 2026-09-01)

## Fortschritt (2026-08-29)

- [x] Migration `supabase/migration_2026-08-29_unterkunft.sql` geschrieben
      (9 Tabellen, GIST-EXCLUDE gegen Doppelbelegung, Schutz-/Audit-/updated_at-
      Trigger, 2 Sichten, RLS admin+hr, Bucket `unterkunft-fotos`, Checklisten-Seed).
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
- [x] Smoke-Test / Praxiseinsatz → erledigt, Modul läuft auf `main`
- [ ] optional Dashboard-Kachel (offene Mängel / fällige Kontrollen) → weiter offen
- [ ] optional: README.md-Abschnitt im Nutzer-Stil
- [x] PR `unterkunft-modul` → `main` gemerged

### Status (historisch): → erledigt, Modul ist auf `main`.

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
| `hausmeister` + Stammdaten | nein – nur Belegung/Übergabe/Kontrolle/Mängel/Fotos (→ ersetzt durch Vorgabe 2026-09-15: keine Kontrollen mehr, siehe „Aktueller Stand“) |
| Grundriss-Variante | Vektor-Editor auf Raster (SVG), kein Hintergrundbild |
| Etage | eigenes Stammdatum `unterkunft_etage` (Bestandsdaten umgezogen) |
| Kontroll-Ampel | ja; Schwellen 75/90 Tage als Konstante (→ ersetzt: je Raumtyp in `unterkunft_kontroll_intervall`, Migration 09-08) |
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
      (→ heute in `lib/rollen.ts` MENUE_RECHTE)
- [x] `components/UnterkunftTabs.tsx`: Tabs „Grundriss" + „Belegungsplan"
- [x] `app/unterkunft/page.tsx`: neuer Grundriss (SVG-Canvas, Zimmer-Panel,
      Bearbeiten-Modus mit Ziehen/Pfeiltasten/Größe – nur admin)
- [x] `app/unterkunft/belegungsplan/page.tsx`: bisherige Tabelle hierher verschoben
- [x] `app/unterkunft/stammdaten/page.tsx`: Etagen-Verwaltung je Gebäude,
      Zimmer-Anlage mit Etagen-Auswahl statt Freitext
- [x] `app/unterkunft/{belegung,uebergabe,kontrolle,maengel}/page.tsx`:
      `canEdit` um `hausmeister` erweitert (→ Kontrolle seit 2026-09-15 wieder
      nur admin/hr)
- [x] `app/page.tsx` + `app/dashboard/page.tsx`: `hausmeister` → `/unterkunft`
- [x] `app/suche/page.tsx`: Block „Unterkunft" (alle Belegungszeiträume der Person)
- [x] `npx tsc --noEmit` sauber · `npx next build` grün

Offen (Stand 2026-08-30, teils überholt durch die Erweiterung 2026-08-31):
- [x] Migrationen 2026-08-30 in Supabase ausgeführt, auf `main` gemerged
- [x] `?zimmer=`-Deep-Link aus dem Grundriss (jetzt in Übergabe + Kontrolle)
- [ ] `hausmeister`-Benutzer anlegen → heute Rolle in `profiles.rollen` über
      die Nutzerverwaltung (bitte bestätigen, ob erledigt)
- [x] Kontrollmuster festlegen → erledigt (Migration 09-08 + Fristen in
      `lib/unterkunft.ts` `naechsteKontrolle`)
- [ ] später: Freitext-Spalte `unterkunft_zimmer.etage` per Migration entfernen

## Erweiterung (2026-08-31): Wohneinheit-Ebene + schwebende Belegung

Ziel: weniger Klicks für den Hausmeister am Smartphone, Belegungsplanung vor
der Übergabe.

Entscheidungen (2026-08-31):

| Frage | Entscheidung |
|---|---|
| `unterkunft_etage` | durch `unterkunft_wohneinheit` **ersetzt** (Etage = Text-Label) |
| Belegungs-Zustände | zwei Tabellen: `unterkunft_zuordnung` (schwebend → seit 09-17 Status `geplant`) + `unterkunft_belegung` (fest) |
| Wohneinheit-Übersicht | Karten/Liste, kein gezeichneter Gebäude-Grundriss |
| „Belegung planen" (schwebend) | nur admin/hr; hausmeister nur Übergabe-Abschluss |
| Schwebende Zuordnung | nur zimmergenau (Bett erst bei der Übergabe) → ersetzt: Betten abgeschafft (09-04), Belegung ist zimmergenau |

Umgesetzt:
- [x] Migration `migration_2026-08-31_unterkunft_wohneinheit_zuordnung.sql`:
      Tabelle `unterkunft_wohneinheit` (+ `etage_label`, `reihenfolge`),
      `unterkunft_zimmer.wohneinheit_id` (Daten aus `unterkunft_etage` gezogen,
      dann `etage_id` + `unterkunft_etage` gedroppt); Tabelle
      `unterkunft_zuordnung` (schwebend/erledigt/storniert → heute geplant/erledigt/storniert, nur zimmergenau,
      Unique-Index „eine offene je Person", Audit-Trigger); RLS (Zuordnung
      anlegen admin/hr, hausmeister nur Update auf erledigt/storniert).
      Sichten neu: `unterkunft_zimmer_uebersicht` (+ wohneinheit, + schwebend),
      `unterkunft_wohneinheit_uebersicht`, `unterkunft_zuordnung_offen`,
      `unterkunft_person_offen`; `unterkunft_belegung_aktuell`/`_person` um
      Herkunft/Wohneinheit erweitert.
- [x] `supabase/schema.sql` Abschnitt 15 gespiegelt.
- [x] `lib/types.ts`: `UnterkunftWohneinheit`, `UnterkunftZuordnung(+Offen)`,
      `UnterkunftWohneinheitUebersicht`, `UnterkunftPersonOffen`;
      `UnterkunftZimmer`/`…Uebersicht` auf Wohneinheit umgestellt;
      `UnterkunftBelegungAktuell/Person` + herkunft/wohneinheit.
- [x] `lib/unterkunft.ts`: `herkunftMix()`.
- [x] `lib/auditLog.ts`: BEREICH_LABELS `unterkunft_zuordnung`.
- [x] `/unterkunft` (Grundriss): Gebäude-Auswahl → **Etage-Umschalter**
      (Chips) → **Wohneinheit-Karten** (Betten · fest · schwebend · frei ·
      Herkunfts-Mix · „Übergaben offen") → Karte antippen → Zimmer-Raster der
      Einheit + Liste „Noch offen" (schwebende Personen) + Zimmer-Panel mit
      „Übergabe starten" (`?zimmer=`). Platzieren nur admin.
- [x] `/unterkunft/belegung` → „**Belegung planen**": Liste „Ohne Bleibe"
      (`unterkunft_person_offen`, Anreiseliste zuerst) ↔ Ziel (Gebäude/
      Wohneinheit/optional Zimmer/ab-Datum) → schwebend zuordnen (Mehrfach);
      Tabelle „Schwebend" (Zimmer nachtragen / aufheben); „Fest belegt"-
      Tabelle; „Direkt belegen" als `<details>`-Notnagel. Nur admin/hr.
- [x] `/unterkunft/uebergabe`: `?zimmer=` Vorwahl; für **Einzug** Personen-
      Auswahl (aus schwebenden Zuordnungen des Zimmers vorbelegt, + Namens-
      suche), je Person Bett-Wahl (→ entfällt seit 09-04); „Abschließen" legt je Person die
      `unterkunft_belegung` an und setzt die Zuordnung auf `erledigt`.
- [x] `/unterkunft/kontrolle`: `?zimmer=` Vorwahl.
- [x] Stammdaten: „Etagen"-Block → „Wohneinheiten" (Name + Etage-Label +
      Reihenfolge); Zimmer-Anlage mit Wohneinheit-Auswahl.
- [x] `npx tsc --noEmit` sauber · `npx next build` grün.

### Nachtrag 2026-09-01: Gemeinschaftsräume im Grundriss
- Neue Spalte `unterkunft_zimmer.art` ('zimmer' | 'gemeinschaft'). Migration
  `migration_2026-09-01_unterkunft_gemeinschaftsraum.sql` (Spalte + zwei
  Sichten neu). Gemeinschaftsräume (Küche / Bad/WC / Flur) hängen an einer
  Wohneinheit, tragen `plan_*`, haben KEINE Betten/Belegung/Übergabe -
  Kontrollen und Mängel gelten. Im Grundriss-Bearbeiten-Modus über
  „+ Küche / + Bad/WC / + Flur" hinzufügbar (mehrfach, admin), indigo-Kachel,
  Panel mit Kontrolle/Mängel + „Löschen". Aus Belegung/Übergabe/Belegungsplan/
  Stammdaten-Zimmerliste herausgefiltert (`art = 'zimmer'`).

Offen:
- [x] **Migrationen ausführen** (08-31, 09-01) → erledigt (im Live-Schema).
- [x] Smoke-Test Planung → Übergabe → fest → erledigt (Praxiseinsatz).
- [x] Zimmerkontrollen-Workflow → gebaut (Kontrollplan, Kontrolle je Zimmer
      oder ganzer Wohneinheit, Kontrollzeitraum je Raumtyp).
- [ ] optional: Übergabe direkt als Bottom-Sheet im Wohneinheit-Detail.

### Wiedereinstieg
Maßgeblich ist der Abschnitt „Aktueller Stand“ oben.

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

> Historisch. → Ersetzt durch den Abschnitt „Aktueller Stand“: keine
> `unterkunft_bett`/`bett_id` mehr (09-04), Views heißen
> `unterkunft_zimmer_uebersicht` usw., RLS prüft heute über `hat_rolle()`
> statt `current_role_name()`.

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

> Historisch. → Aktuelle Seiten und Reiter siehe „Aktueller Stand“.

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
  → Ergänzt: Reparaturen mit Verursacher können als `unterkunft_belastung`
  einer Person belastet werden (Migration 09-14, Bestätigung unter
  /vorschuesse); die Auszüge-Liste zeigt, ob eine Kaution zurückzuzahlen ist.
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
   → erledigt: Rolle `hausmeister` seit 08-30.
2. **Belegung:** bettgenau — `unterkunft_bett` + Belegung je Bett + GIST-EXCLUDE
   gegen Doppelbelegung (`btree_gist`). → ersetzt: seit 09-04 zimmergenau,
   `bettenzahl` ist die Kapazität (Überbuchung nur mit Hinweis).
3. **Unterschrift:** v1 „Name + bestätigt" — Feld `unterschrift_name` + Haken
   „Zustand bestätigt" + Zeitstempel/Bearbeiter. Kein Canvas-Pad, kein
   `unterschrift_path` in v1.
4. **Checkliste:** Standard-Set als Seed der Vorlage: Wände/Decke, Boden, Fenster,
   Türen, Bad/WC, Küche, Möbel, Betten/Matratzen, Elektro/Licht, Sauberkeit,
   Schlüssel. Über `unterkunft_checkliste_vorlage` später änderbar.
