-- ============================================================================
-- Spargar / Mömmel Agrar - Datenbankschema für Supabase (Postgres)
-- Ersetzt: "Spargar 2026 - Mömmel Agrar.xlsm"
--
-- Umfang dieser Ausbaustufe (MVP, Web-App statt nativem Windows-Client):
--   Personal, Stundenerfassung, Saison-Summen/Lohnübersicht, Vorschüsse,
--   Kassenbuch/-prüfung.
-- NICHT enthalten (siehe README.md, spätere Ausbaustufe):
--   Auszahlungsliste/Finalisierung, 90-Tage-/14-Wochen-Compliance-Berechnung,
--   Druckvorlagen (Stundenzettel A5/A6), Migrations-Staging aus der Excel-Datei.
--
-- Dieses Schema orientiert sich - im Rahmen einer Browser-Web-App statt des
-- im Fachkonzept empfohlenen nativen Windows-Clients (ADR-002) - an den
-- Architekturentscheidungen aus "IT_Systemuebergabe_Fachkonzept_und_Architektur":
--   ADR-004 Stabile interne IDs + Altsystem-Personalnummer bleibt erhalten
--   ADR-005 Append-only Audit-Log statt stiller Änderungen
--   ADR-006 Berechtigungen serverseitig (RLS) und nicht nur im UI
--   ADR-007 Versionierte Regeln/Sätze mit Gültigkeitsdatum
--   ADR-010 Atomare Belegnummern-Vergabe, sonst optimistische Nebenläufigkeit
--   ADR-011 Kein Hard-Delete bei Vorgängen - Storno/Deaktivierung statt Löschen
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rollen & Profile (angelehnt an die Rollenmatrix im Testkatalog,
--    vereinfacht auf das MVP zugeschnitten)
--
--    WICHTIG bei künftigen neuen Rollen (Migration, nicht bei diesem
--    schema.sql-Fresh-Install): "alter type user_role add value '...'"
--    darf NICHT in derselben Transaktion wie eine Nutzung dieses neuen
--    Werts stehen (z.B. eine RLS-Policy mit
--    "current_role_name() in (..., 'neue_rolle')" - current_role_name()
--    gibt user_role zurück, der Vergleich braucht also einen impliziten
--    Cast des String-Literals auf den Enum-Typ). Sonst Fehler "unsafe use
--    of new value of enum type". Deshalb IMMER zwei getrennte
--    Migrationsdateien (erst der ADD VALUE allein, danach - in einem
--    zweiten, separaten Lauf im SQL Editor - die Policies/Grants mit dem
--    neuen Wert), siehe migration_2026-08-09_rolle_erntewirtschaft_1_enum.sql
--    und ..._2_policies.sql als Beispiel.
-- ---------------------------------------------------------------------------
create type user_role as enum (
  'admin',           -- Administrator: volle Rechte, Konfiguration, Reopen
  'hr',               -- Personalstamm pflegen, sonst nur lesen
  'zeiterfassung',    -- Stunden erfassen (offene Periode)
  'kasse',            -- Vorschüsse/Kassenbuch erfassen
  'lohnabrechnung',   -- Lohnübersicht einsehen/prüfen
  'pruefer',          -- nur lesen, Kassenprüfungen freigeben
  'management',       -- nur aggregierte/lesende Sicht
  -- Nutzer-Vorgabe 2026-08-09: nur Zugriff auf Prämien (Erfassung) und
  -- Statistik, sonst nichts - eigener Arbeitsbereich wie zeiterfassung
  -- bei Stundenerfassung.
  'erntewirtschaft'
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role user_role not null default 'zeiterfassung',
  aktiv boolean not null default true,
  -- UI-Sprache je Nutzer (nicht je Rolle) - Nutzer-Vorgabe 2026-08-08.
  -- Betrifft NUR die Bedienoberfläche, keine Dokumente/Formulare (die
  -- bleiben Deutsch/Rumänisch etc., je nach Vorlage). Schrittweise
  -- ausgerollt, aktuell nur Stundenerfassung + Suche übersetzt, siehe
  -- lib/i18n.ts.
  sprache text not null default 'de' check (sprache in ('de', 'hr')),
  created_at timestamptz not null default now()
);

-- security definer + fester search_path: OHNE das würde diese Funktion
-- beim Lesen von profiles wieder die RLS-Policy "profiles_select" auslösen
-- (die selbst is_admin() -> current_role_name() aufruft) - eine
-- Endlosschleife, die Postgres irgendwann mit "stack depth limit exceeded"
-- abbricht. Sicher, da die Funktion ausschließlich die eigene Zeile
-- (auth.uid()) liest, nichts Fremdes und nichts Schreibendes.
create or replace function current_role_name()
returns user_role language sql stable security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable as $$
  select current_role_name() = 'admin';
$$;

-- Schmale, breit zugängliche Sicht (nur id + full_name, kein role/aktiv) -
-- "profiles_select" lässt jeden nur die eigene Zeile lesen, wodurch z.B.
-- der Bearbeiter-Name bei Kassenbewegungen für alle außer admin/die
-- handelnde Person selbst als "—" erschien. Namen sind nicht sensibel
-- genug, um das zu rechtfertigen - anders als role/aktiv, die bewusst
-- eingeschränkt bleiben.
create or replace view profile_namen as
select id, full_name from profiles;

grant select on profile_namen to authenticated;

-- ---------------------------------------------------------------------------
-- 1a. Arbeitsgruppen (z.B. "Sortierer", "Träger", "Schälmannschaft") - dient
--     der übersichtlichen Gruppierung/Sortierung auf der Stundenerfassung
--     und den gedruckten Gruppenstundenzetteln.
-- ---------------------------------------------------------------------------
create table arbeitsgruppen (
  gruppe_nr text primary key,
  bezeichnung text not null,
  -- Anzeige-/Druckreihenfolge der Gruppen (nicht alphabetisch nach gruppe_nr,
  -- da z.B. "10" vor "2" sortiert würde).
  reihenfolge int not null default 0,
  -- Zuordnung zur Kultur (Nutzer-Vorgabe 2026-08-12): optional, da nicht
  -- jede Gruppe einer einzelnen Kultur zugeordnet ist. Ermöglicht, die in
  -- der allgemeinen Stundenerfassung erfassten Stunden dieser Gruppe ×
  -- Mindestlohn auf die an diesem Tag geerntete Menge dieser Kultur
  -- umzulegen (siehe zuckermais_statistik_tag/erdbeeren_gruppenkosten_tag)
  -- - zusätzlich zu den bereits bestehenden, enger gefassten Prämien-
  -- Stunden (nur die tatsächlich in der Prämien-Erfassung eingetragenen
  -- Personen). Bewusst nur EINE Kultur je Gruppe, kein Array - eine Gruppe
  -- wie "Sortierer" arbeitet in der Praxis an einer Kultur.
  kultur text check (kultur in ('zuckermais', 'erdbeeren', 'spargel')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1b. Herkünfte (feste Liste statt Freitext, damit "nach Herkunft
--     auswählen/filtern" bei Vorschüssen zuverlässig funktioniert - keine
--     Tippfehler-Varianten wie "Kroatien"/"kroatien").
-- ---------------------------------------------------------------------------
create table herkuenfte (
  wert text primary key,
  reihenfolge int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Mitarbeiter (entspricht Sheet "Pers.dat")
--    ADR-004: stabile interne ID (uuid) + Alt-Personalnummer bleibt als
--    eigenes, weiterhin sichtbares/suchbares Feld erhalten.
-- ---------------------------------------------------------------------------
create type abrechnungsart as enum (
  'pauschal',                  -- pauschale Lohnsteuer, siehe season_summary
  'lohnsteuerklasse_1',
  'sozialversicherungspflichtig'
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  -- Alt-Personalnummer aus Excel, z.T. alphanumerisch (z.B. "8226a") - bleibt
  -- eindeutig und durchsuchbar, ist aber NICHT mehr der Primärschlüssel.
  personal_nr text not null unique,
  gruppe_nr text references arbeitsgruppen (gruppe_nr)
    on update cascade on delete set null,
  herkunft text references herkuenfte (wert)
    on update cascade on delete set null,
  nationalitaet text,
  name text not null,
  vorname text not null,
  geburtsdatum date,
  strasse text,
  hausnummer text,
  plz text,
  ort text,
  land text,
  sozialversicherungsnummer text,
  steuer_id text,
  staatsangehoerigkeit text,
  geschlecht text check (geschlecht in ('M', 'F')),
  familienstand text,
  geburtsname text,
  geburtsort text,
  hochzeitsdatum date,
  fuehrerschein_b boolean not null default false,
  fuehrerschein_c boolean not null default false,
  zahlungsempfaenger text,
  iban text,
  bic text,
  stundenlohn numeric(10, 2),
  -- Art der Lohnabrechnung: bei 'pauschal' wird in der Lohnübersicht
  -- automatisch pauschale Lohnsteuer (5,275% vom Bruttolohn) berechnet.
  abrechnungsart abrechnungsart not null default 'sozialversicherungspflichtig',
  saison_beginn date,
  saison_ende date,
  -- ADR-011: kein Löschen von Personen mit Historie - stattdessen deaktivieren
  aktiv boolean not null default true,
  -- Schwarze Liste: dauerhaftes "nicht mehr erwünscht"-Flag, unabhängig vom
  -- aktiv-Status. Wird bei der Personalplanung geprüft, sobald ein
  -- Kandidat mit dieser (auch inaktiven) Person verknüpft wird - siehe
  -- personal_kandidaten.verknuepfter_employee_id weiter unten. Absichtlich
  -- NICHT im eingeschränkten "grant select" für Nicht-admin/hr-Rollen
  -- enthalten (wie IBAN/SV-Nr.).
  schwarze_liste boolean not null default false,
  schwarze_liste_grund text,
  schwarze_liste_von uuid references profiles (id),
  schwarze_liste_am timestamptz,
  -- Statuswechsel (z.B. sozialversicherungsfrei -> sozialversicherungs-
  -- pflichtig, wenn die 90-Tage-/15-Wochen-Grenze erreicht wird): verweist
  -- auf die "Vorgänger"-Person (alte Personalnummer), aus der diese Zeile
  -- per Statuswechsel entstanden ist. Bewusst eine eigene, komplett neue
  -- Person (statt die Personalnummer der bestehenden Zeile umzubenennen),
  -- damit Stunden/Boni davor und danach strikt getrennt bleiben und mit
  -- unterschiedlicher Abrechnungsart korrekt abgerechnet werden können.
  vorgaenger_employee_id uuid references employees (id) on delete set null,
  notiz text,
  -- Zugehörigkeit zu den Prämien-Erfassungen (Nutzer-Vorgabe 2026-08-09):
  -- unabhängig von gruppe_nr (Stundenerfassungs-Gruppen bleiben unverändert
  -- wichtig, siehe README) - eigene, einfache An/Aus-Flags je Kultur, damit
  -- Prämien → Zuckermais/Erdbeeren/Spargel nur die tatsächlich dort
  -- pflückenden Mitarbeiter zeigen statt aller aktiven Personen. Gepflegt
  -- über "Prämien → Gruppenaufteilung" (nur admin/hr, wie andere
  -- Personalstamm-Änderungen).
  praemien_zuckermais boolean not null default false,
  praemien_erdbeeren boolean not null default false,
  praemien_spargel boolean not null default false,
  -- Optimistische Nebenläufigkeit (ADR-010): Version wird bei jedem Update
  -- hochgezählt; das Frontend muss die zuletzt gelesene Version mitschicken.
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_employees_name on employees (name, vorname);

-- Abgespeckte Sicht ohne sensible Felder (SV-Nr., Steuer-ID, IBAN, BIC) für
-- Rollen, die nur Stunden erfassen (Rollenmatrix: "Time Recording" = View).
create view employees_public as
  select
    id, personal_nr, gruppe_nr, herkunft, nationalitaet, name, vorname,
    geburtsdatum, ort, land, stundenlohn, saison_beginn, saison_ende, aktiv
  from employees;

-- ---------------------------------------------------------------------------
-- 2a. Mitarbeiter-Dokumente (z.B. Hochzeitsurkunde, Ausweiskopie) - werden
--     als Datei in Supabase Storage abgelegt, dieser Eintrag verweist nur
--     darauf. Feste Kategorie-Liste (Nutzer-Vorgabe), siehe
--     lib/types.ts DOKUMENT_KATEGORIEN - muss synchron gehalten werden.
--     Zugriff wie bei anderen sensiblen Personaldaten (SV-Nr., IBAN) nur
--     admin/hr, siehe RLS-Policy weiter unten + Storage-Policy.
-- ---------------------------------------------------------------------------
create table employee_documents (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  kategorie text not null check (kategorie in (
    'Hochzeitsurkunde',
    'Ausweiskopie',
    'Führerschein Kopie',
    'Arbeitsvertrag',
    'Werks- und Mietvertrag',
    'Sonstiges'
  )),
  -- Entfernt 2026-08-11 (Nutzer-Vorgabe): Formular "Doppelte
  -- Haushaltsführung" und Formular zur Feststellung der
  -- Versicherungspflicht werden NICHT mehr hochgeladen. Beide werden
  -- ausschließlich über ihre Eingabemaske erfasst (Personal → Lohnsteuer
  -- bzw. Sozialversicherung); die erfassten Angaben sind der Nachweis.
  -- Die Anreiseliste-Checkliste prüft entsprechend die Angaben statt eines
  -- Dokuments (siehe personal_kandidaten_checkliste weiter unten).
  dateiname text not null,
  -- Pfad im Storage-Bucket "mitarbeiter-dokumente", z.B.
  -- "<employee_id>/<zeitstempel>_<dateiname>".
  storage_path text not null unique,
  hochgeladen_von uuid references profiles (id),
  hochgeladen_am timestamptz not null default now(),
  -- Nur befüllt bei kategorie = 'Führerschein Kopie': welche Klassen die
  -- hochgeladene Kopie abdeckt. Wird beim Upload abgefragt und wirkt sich
  -- breit aus (Personal/Stundenerfassung/Lohnübersicht zeigen daraus, ob
  -- und wofür jemand einen Führerschein hat - siehe
  -- employee_fuehrerschein_kategorien weiter unten).
  fuehrerschein_kategorien text[]
    check (fuehrerschein_kategorien is null
      or fuehrerschein_kategorien <@ array['B', 'BE', 'C', 'CE'])
);

create index idx_employee_documents_employee on employee_documents (employee_id);

-- Privater Storage-Bucket für die eigentlichen Dateien (kein öffentlicher
-- Zugriff - Downloads laufen über zeitlich begrenzte signierte URLs).
insert into storage.buckets (id, name, public)
values ('mitarbeiter-dokumente', 'mitarbeiter-dokumente', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2b. Personalplanung: Kandidaten vor der Aktivierung
--     Getrennt von employees, damit Zu-/Absagen in der Planungsphase nicht
--     ständig echte employees-Datensätze/Personalnummern verbrauchen.
--     Personalnummern werden hier schon RESERVIERT (die App zählt beim
--     Vorschlagen der nächsten freien Nummer employees UND nicht-stornierte
--     Kandidaten als "belegt", siehe lib/personalnummern.ts), aber erst bei
--     Aktivierung final an employees vergeben. Anders als employees
--     (ADR-011: kein Löschen) dürfen Kandidaten storniert werden, ohne
--     Historie zu haben - der Datensatz bleibt zur Nachvollziehbarkeit
--     erhalten (status = 'storniert'), die Nummer wird dadurch aber sofort
--     wieder frei, weil stornierte Kandidaten beim "belegt"-Zählen nicht
--     mitzählen.
-- ---------------------------------------------------------------------------
create table personal_kandidaten (
  id uuid primary key default gen_random_uuid(),
  personal_nr text not null unique,
  name text not null,
  vorname text not null,
  geburtsdatum date,
  nationalitaet text,
  herkunft text references herkuenfte (wert)
    on update cascade on delete set null,
  -- Falls diese Person schon einmal hier war (eigene, ggf. inaktive
  -- employees-Zeile): Verknüpfung macht die Schwarze-Liste-Prüfung möglich
  -- und wird bei der Aktivierung genutzt, um die bestehende Person zu
  -- reaktivieren statt eine zweite anzulegen (Historie bleibt an einer ID).
  verknuepfter_employee_id uuid references employees (id) on delete set null,
  -- Individueller Vertragszeitraum - bewusst NICHT aus employees.saison_
  -- beginn/-ende übernommen, da der tatsächliche Arbeitsvertrag oft davon
  -- abweicht (Nutzer-Vorgabe 2026-08-06).
  arbeitsbeginn_datum date,
  arbeitsende_datum date,
  -- Für den Arbeitsvertrag-Platzhalter «Stundenlohn» - vor der Aktivierung
  -- gibt es noch keinen employees.stundenlohn, den man ziehen könnte.
  stundenlohn numeric(10, 2),
  geplante_ankunft date,
  -- Selbstauskunft beim Anlegen des Kandidaten (unabhängig von der
  -- hochgeladenen, geprüften Kopie in employee_documents/Personal →
  -- Dokumente - zwei getrennte Signale: "gibt an zu haben" vs.
  -- "haben wir schriftlich geprüft").
  fuehrerschein_kategorien text[]
    check (fuehrerschein_kategorien is null
      or fuehrerschein_kategorien <@ array['B', 'BE', 'C', 'CE']),
  -- 'geplant': in der Kandidatenliste, noch nicht angereist.
  -- 'anreiseliste': per "Anreise vorbereiten" aktiviert (echter employees-
  --   Datensatz existiert bereits, siehe aktivierter_employee_id) und in
  --   der Anreiseliste - ob die Unterlagen schon vollständig sind, wird
  --   NICHT hier gespeichert, sondern live aus den Feldern unten +
  --   employee_documents berechnet (siehe View personal_kandidaten_checkliste
  --   weiter unten), damit das nie veraltet/falsch stehen bleiben kann.
  -- 'storniert': Absage vor der Anreise, Personalnummer wird wieder frei.
  status text not null default 'geplant'
    check (status in ('geplant', 'anreiseliste', 'storniert')),
  storniert_grund text,
  notiz text,
  -- Bei Aktivierung ("Anreise vorbereiten") befüllt: welcher employees-
  -- Datensatz daraus entstanden ist bzw. reaktiviert wurde.
  aktivierter_employee_id uuid references employees (id) on delete set null,
  -- Ab hier: Felder für die Anreiseliste (erst relevant, wenn status =
  -- 'anreiseliste'). gedruckt wird automatisch gesetzt, sobald irgendeines
  -- der drei Dokumente für diese Person erzeugt wurde (einzeln oder im
  -- Sammel-Ausdruck der Anreisegruppe).
  gedruckt boolean not null default false,
  gedruckt_am timestamptz,
  -- Fragebogen zur Feststellung der Versicherungspflicht: nur ein Ja/Nein,
  -- ob er erfasst wurde (für die Anreiseliste-Checkliste), plus die eine
  -- Angabe daraus, die schon länger gebraucht wird (verheiratet ->
  -- Hochzeitsurkunde nötig). Die eigentlichen Antworten stehen seit
  -- 2026-08-08 in der eigenen Tabelle sv_fragebogen (ein Datensatz je
  -- Person UND Saison-Jahr, siehe "Personal → Sozialversicherung") - diese
  -- beiden Häkchen sind bewusst (noch) nicht damit verknüpft.
  fragebogen_erfasst boolean not null default false,
  verheiratet_laut_fragebogen boolean,
  -- Steuert, ob das Formular "Doppelte Haushaltsführung" für die
  -- Vollständigkeits-Prüfung nötig ist. Der Antrag auf Lohnsteuerabzug
  -- selbst wird noch im Detail geklärt (Stand 2026-08-06).
  lohnsteuerabzug_antrag_gewuenscht boolean not null default false,
  -- Buskosten (Hinfahrt) werden direkt in season_bonuses.bus_hin erfasst
  -- (fließt automatisch in die Lohnübersicht ein) - dieses Feld markiert nur,
  -- dass der Wert bewusst eingetragen wurde (auch 0 zählt als "erfasst").
  buskosten_erfasst boolean not null default false,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create index idx_personal_kandidaten_status on personal_kandidaten (status);

-- ---------------------------------------------------------------------------
-- 2a. SV-Fragebogen ("Fragebogen zur Feststellung der Versicherungspflicht/
--     Versicherungsfreiheit rumänischer Saisonarbeitnehmer") - ein Datensatz
--     je Person UND Saison-Jahr (nicht nur einmal je Person!), damit im
--     Folgejahr geprüft werden kann, ob sich die Angaben (z.B. Hausfrau/
--     Hausmann, Selbstständigkeit) verändert haben (Nutzer-Vorgabe
--     2026-08-08). Manuell abgetippt vom ausgefüllten/gestempelten
--     Papierformular - KEIN automatisches Auslesen (Handschrift/Kästchen/
--     rumänische Behördenstempel sind dafür nicht verlässlich genug bei
--     einem Formular mit sozialversicherungsrechtlicher Bedeutung).
--     Muss VOR personal_kandidaten_checkliste stehen, da diese View unten
--     gegen sv_fragebogen/sv_fragebogen_auswertung nachschlägt.
-- ---------------------------------------------------------------------------
create table sv_fragebogen (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,

  -- 1. Beschäftigung im Heimatland
  beschaeftigt_heimatland boolean,
  beschaeftigt_firma text,
  beschaeftigt_taetigkeit text,
  bezahlter_urlaub boolean,
  bezahlter_urlaub_von date,
  bezahlter_urlaub_bis date,
  unbezahlter_urlaub boolean,
  unbezahlter_urlaub_von date,
  unbezahlter_urlaub_bis date,
  freistellung boolean,
  freistellung_von date,
  freistellung_bis date,
  freistellung_grund text,

  -- 2. Selbstständigkeit im Heimatland
  selbststaendig boolean,
  selbststaendig_seit date,
  selbststaendig_taetigkeit text,

  -- 3. Arbeitslosigkeit im Heimatland
  arbeitslos boolean,
  arbeitslos_seit date,
  arbeitsamt_name text,
  arbeitsamt_aktenzeichen text,

  -- 4. Schulbesuch/Studium im Heimatland
  schule_studium boolean,
  schule_seit date,
  schule_name text,
  schule_ende date,
  schulferien_waehrend_beschaeftigung boolean,
  schulferien_von date,
  schulferien_bis date,

  -- 5. Rentenbezug im Heimatland
  rente boolean,
  rente_seit date,
  rente_art text,
  rente_traeger text,

  -- 6. Hausfrau/Hausmann im Heimatland
  hausmann boolean,
  hausmann_seit date,

  -- 7. Sonstiges - nur relevant, wenn 1/2/3/4/5/6 alle "nein" sind
  lebensunterhalt_sonstiges text,

  -- Kern der 90-Tage-Regel (Nutzer-Korrektur 2026-08-08): entscheidend ist
  -- die Gesamtzahl der Arbeitstage in DEUTSCHLAND im Kalenderjahr über
  -- ALLE Arbeitgeber, nicht nur bei uns - NICHT die Beschäftigung im
  -- Ausland (die zählt für die Berufsmäßigkeits-Frage oben, Blöcke 1-7,
  -- aber nicht für die Tage-Grenze). Oft meldet das Lohnprogramm, dass
  -- eine Person schon einmal in Deutschland beschäftigt war - dann wird
  -- gezielt nachgefragt und hier dokumentiert, worauf wir uns bei der
  -- wahrheitsgemäßen (rechtlich bindenden) Angabe der Person verlassen.
  -- Fließt direkt in die kombinierte 90-Tage-Kontrolle ein (siehe
  -- employee_sv_pruefung weiter unten).
  -- Entweder direkt als Tage-Zahl ODER als Zeitraum von/bis erfassbar
  -- (Nutzer-Vorgabe 2026-08-11) - je nachdem, was das Lohnprogramm bzw.
  -- die Person meldet. Bei ausgefülltem Zeitraum werden die Tage daraus
  -- berechnet und die Zahl unten ignoriert, siehe Funktion
  -- vorbeschaeftigung_deutschland_tage_effektiv() weiter unten.
  vorbeschaeftigung_deutschland_tage int,
  vorbeschaeftigung_deutschland_von date,
  vorbeschaeftigung_deutschland_bis date,
  vorbeschaeftigung_deutschland_arbeitgeber text,
  -- Dokumentiert, falls diese Nachfrage gezielt durch eine Rückmeldung des
  -- Lohnprogramms ausgelöst wurde (statt nur beim regulären Erstantritt) -
  -- als Nachweis, dass dem nachgegangen wurde.
  ausgeloest_durch_lohnprogramm_hinweis boolean not null default false,

  -- Markiert, dass der Bogen bereits geprüft wurde, aber unvollständig
  -- oder fehlerhaft ist (z.B. fehlende Angaben, unleserlich, fehlende
  -- Bestätigung/Stempel einer rumänischen Stelle) - unterscheidet das
  -- bewusst von "noch gar nicht angesehen" (kein Datensatz vorhanden).
  -- Zählt automatisch als "nicht bestanden" (siehe sv_fragebogen_
  -- auswertung), damit ein fehlerhafter Bogen nicht unbemerkt als
  -- geprüft/bestanden durchgeht.
  unvollstaendig_fehlerhaft boolean not null default false,
  unvollstaendig_fehlerhaft_grund text,

  -- Erklärung/Unterschrift auf dem Papierformular
  ausgefuellt_am date,

  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),

  unique (employee_id, saison_jahr)
);

-- 8. Bisherige Beschäftigungen im laufenden Kalenderjahr (vor dieser
--    Beschäftigung, im In- oder Ausland) - mehrere Zeilen möglich, wie auf
--    dem Papierformular. Rein informativ/dokumentierend (Kontext für die
--    Berufsmäßigkeits-Einschätzung oben) - zählt NICHT in die 90-Tage-
--    Kontrolle hinein, das macht sv_fragebogen.vorbeschaeftigung_
--    deutschland_tage (nur Deutschland zählt für die Tage-Grenze, siehe
--    dort).
create table sv_fragebogen_vorbeschaeftigung (
  id bigint generated always as identity primary key,
  fragebogen_id bigint not null references sv_fragebogen (id) on delete cascade,
  von date not null,
  bis date not null,
  wochenstunden numeric(5, 2),
  taetigkeit text,
  arbeitgeber text
);

create index idx_sv_fragebogen_vorbeschaeftigung_fragebogen
  on sv_fragebogen_vorbeschaeftigung (fragebogen_id);

-- ---------------------------------------------------------------------------
-- Sozialversicherungsfreier Zeitraum (Nutzer-Vorgabe 2026-08-10): aus den
-- Datumsangaben des jeweils zutreffenden Blocks abgeleitet. Als Funktionen
-- (nicht direkt in den Sichten) definiert, damit die Logik nur EINMAL steht
-- und sowohl von sv_fragebogen_auswertung als auch von employee_sv_pruefung
-- genutzt werden kann.
--
-- Regeln (Nutzer-Vorgabe):
--   - Block 1 (Beschäftigung im Heimatland): "Bezahlter Urlaub" UND
--     "Freistellung aus anderem Grund" sind SV-frei und laufen zusammen -
--     sv_frei_von/bis ist die Spanne von der frühesten bis zur spätesten
--     der beiden Teilzeiträume. "Unbezahlter Urlaub" zählt bewusst NICHT
--     mit (nicht SV-frei).
--   - Block 4 (Schule/Studium): nur wenn "Schulferien während Beschäftigung"
--     angekreuzt ist, zählt der Schulferienzeitraum.
--   - Block 2/5/6 (Selbstständigkeit/Rente/Hausmann): offener (unbefristeter)
--     Zeitraum ab dem jeweiligen "seit"-Datum - "es zählen die vollen
--     Zeiträume".
--   - Wenn bei Block 1 sowohl "Bezahlter Urlaub" als auch "Freistellung"
--     vollständig angegeben sind, aber eine echte Lücke dazwischen liegt
--     (nicht durchgängig/überlappend), ist genau diese Lücke NICHT SV-frei
--     (sv_freier_zeitraum_luecke true, Zeitraum in _luecke_von/_luecke_bis).
create or replace function sv_freier_zeitraum_von(f sv_fragebogen)
returns date language sql immutable as $$
  select case
    when coalesce(f.beschaeftigt_heimatland, false)
      then least(f.bezahlter_urlaub_von, f.freistellung_von)
    when coalesce(f.schule_studium, false)
      and coalesce(f.schulferien_waehrend_beschaeftigung, false)
      then f.schulferien_von
    when coalesce(f.hausmann, false) then f.hausmann_seit
    when coalesce(f.rente, false) then f.rente_seit
    when coalesce(f.selbststaendig, false) then f.selbststaendig_seit
  end;
$$;

-- true bei den "offenen Zuständen" (Blöcke 2/5/6: Selbstständigkeit, Rente,
-- Hausfrau/Hausmann) - dort ist das "seit"-Datum auf dem Formular NUR ein
-- Nachweis, seit wann der Zustand besteht, KEIN Beginn eines SV-freien
-- Zeitraums (Nutzer-Korrektur 2026-08-11: "Das Startdatum ist immer das
-- 'aktiv seit' Datum der Person. Anders macht das auch keinen Sinn.").
-- Der SV-freie Zeitraum beginnt in diesen Fällen deshalb mit dem
-- tatsächlichen Arbeitsbeginn - siehe employee_sv_pruefung weiter unten,
-- wo genau das eingesetzt wird.
-- Bewusst mit derselben Vorrang-Reihenfolge wie in sv_freier_zeitraum_von:
-- Block 1 und Block 4 liefern echte Von-Bis-Zeiträume und gehen vor.
-- "Bestanden" = sozialversicherungsfreie Beschäftigung nach der
-- Berufsmäßigkeits-Regel plausibel möglich. Als Funktion, weil dieselbe
-- Formel an mehreren Stellen gebraucht wird (sv_fragebogen_auswertung und
-- anreiseliste_offen_arbeitend weiter unten) - eine zweite handgeschriebene
-- Kopie würde beim nächsten Regel-Feinschliff auseinanderlaufen.
create or replace function sv_fragebogen_bestanden(f sv_fragebogen)
returns boolean language sql immutable as $$
  select
    (
      (
        coalesce(f.beschaeftigt_heimatland, false)
        or coalesce(f.selbststaendig, false)
        or coalesce(f.schule_studium, false)
        or coalesce(f.rente, false)
        or coalesce(f.hausmann, false)
      )
      and not coalesce(f.arbeitslos, false)
    )
    and not f.unvollstaendig_fehlerhaft;
$$;

-- Bisherige Beschäftigungstage in Deutschland bei anderen Arbeitgebern -
-- erfassbar entweder als Zeitraum von/bis ODER als reine Tage-Zahl
-- (Nutzer-Vorgabe 2026-08-11). Ist ein vollständiger Zeitraum angegeben,
-- hat dieser Vorrang und die Tage werden daraus berechnet (Kalendertage
-- inklusive beider Randtage, wie bei der 15-Wochen-Grenze auch).
create or replace function vorbeschaeftigung_deutschland_tage_effektiv(
  f sv_fragebogen
)
returns int language sql immutable as $$
  select coalesce(
    case
      when f.vorbeschaeftigung_deutschland_von is not null
        and f.vorbeschaeftigung_deutschland_bis is not null
      then (f.vorbeschaeftigung_deutschland_bis
            - f.vorbeschaeftigung_deutschland_von + 1)
    end,
    f.vorbeschaeftigung_deutschland_tage,
    0
  );
$$;

create or replace function sv_freier_zeitraum_offen(f sv_fragebogen)
returns boolean language sql immutable as $$
  select
    not coalesce(f.beschaeftigt_heimatland, false)
    and not (
      coalesce(f.schule_studium, false)
      and coalesce(f.schulferien_waehrend_beschaeftigung, false)
    )
    and (
      coalesce(f.hausmann, false)
      or coalesce(f.rente, false)
      or coalesce(f.selbststaendig, false)
    );
$$;

create or replace function sv_freier_zeitraum_bis(f sv_fragebogen)
returns date language sql immutable as $$
  select case
    when coalesce(f.beschaeftigt_heimatland, false)
      then greatest(f.bezahlter_urlaub_bis, f.freistellung_bis)
    when coalesce(f.schule_studium, false)
      and coalesce(f.schulferien_waehrend_beschaeftigung, false)
      then f.schulferien_bis
    -- Hausfrau/Hausmann, Rente, Selbstständigkeit: bewusst offenes Ende
    -- (kein "bis" auf dem Formular vorgesehen) - gilt als dauerhaft ab
    -- dem "seit"-Datum, siehe sv_freier_zeitraum_von.
  end;
$$;

-- true, wenn bei Block 1 beide Teilzeiträume ("Bezahlter Urlaub" und
-- "Freistellung") vollständig angegeben sind, aber NICHT durchgängig
-- ineinander übergehen (echte Lücke dazwischen). Rechnet mit der Summe der
-- beiden Einzellängen gegen die Gesamtspanne - funktioniert unabhängig
-- davon, welcher der beiden Zeiträume zuerst beginnt, und erkennt
-- Überlappung/Anschluss korrekt als "keine Lücke".
create or replace function sv_freier_zeitraum_luecke(f sv_fragebogen)
returns boolean language sql immutable as $$
  select
    coalesce(f.beschaeftigt_heimatland, false)
    and f.bezahlter_urlaub_von is not null and f.bezahlter_urlaub_bis is not null
    and f.freistellung_von is not null and f.freistellung_bis is not null
    and (
      (f.bezahlter_urlaub_bis - f.bezahlter_urlaub_von + 1)
      + (f.freistellung_bis - f.freistellung_von + 1)
    ) < (
      greatest(f.bezahlter_urlaub_bis, f.freistellung_bis)
      - least(f.bezahlter_urlaub_von, f.freistellung_von) + 1
    );
$$;

create or replace function sv_freier_zeitraum_luecke_von(f sv_fragebogen)
returns date language sql immutable as $$
  select case when sv_freier_zeitraum_luecke(f)
    then case when f.bezahlter_urlaub_von <= f.freistellung_von
      then f.bezahlter_urlaub_bis + 1 else f.freistellung_bis + 1 end
  end;
$$;

create or replace function sv_freier_zeitraum_luecke_bis(f sv_fragebogen)
returns date language sql immutable as $$
  select case when sv_freier_zeitraum_luecke(f)
    then case when f.bezahlter_urlaub_von <= f.freistellung_von
      then f.freistellung_von - 1 else f.bezahlter_urlaub_von - 1 end
  end;
$$;

-- Live berechnete Auswertung: "bestanden" = sozialversicherungsfreie
-- Beschäftigung anhand der Angaben plausibel möglich. WICHTIG: dies ist
-- eine reine Ja/Nein-Fragen-Auswertung nach der allgemeinen Regel zur
-- "Berufsmäßigkeit" (kurzfristige Beschäftigung ist nur SV-frei, wenn sie
-- NICHT die Haupt-Existenzgrundlage der Person ist) - ersetzt nicht die
-- rechtliche Prüfung im Einzelfall und wurde nicht steuerberaterlich
-- geprüft (Nutzer-Vorgabe 2026-08-08: als Warnung gedacht, manuell vom
-- Nutzer übersteuerbar, kein harter Block).
-- Ein unbeantwortetes (NULL) Feld zählt hier bewusst wie "nein" (coalesce
-- ... false) - ein unvollständig ausgefüllter Fragebogen soll nicht
-- versehentlich als "bestanden" durchgehen. Ebenso zählt ein explizit als
-- unvollständig/fehlerhaft markierter Bogen automatisch als nicht
-- bestanden.
-- WICHTIG: bewusst "f.spalte, f.spalte, ..." statt "f.*" - bei "f.*" würde
-- eine künftig per ALTER TABLE ADD COLUMN neu angehängte Spalte auf
-- sv_fragebogen automatisch VOR "bestanden" in dieser Sicht einsortiert
-- und dessen Position verschieben, was "create or replace view" mit
-- Fehler 42P16 ablehnt (schon zweimal passiert - siehe
-- migration_2026-08-08_sv_fragebogen_unvollstaendig.sql). Mit expliziter
-- Spaltenliste bleibt "bestanden" unabhängig von der Tabellen-
-- Spaltenreihenfolge an fester Position; neue Spalten werden hier
-- bewusst manuell ergänzt.
create or replace view sv_fragebogen_auswertung as
select
  f.id,
  f.employee_id,
  f.saison_jahr,
  f.beschaeftigt_heimatland,
  f.beschaeftigt_firma,
  f.beschaeftigt_taetigkeit,
  f.bezahlter_urlaub,
  f.bezahlter_urlaub_von,
  f.bezahlter_urlaub_bis,
  f.unbezahlter_urlaub,
  f.unbezahlter_urlaub_von,
  f.unbezahlter_urlaub_bis,
  f.freistellung,
  f.freistellung_von,
  f.freistellung_bis,
  f.freistellung_grund,
  f.selbststaendig,
  f.selbststaendig_seit,
  f.selbststaendig_taetigkeit,
  f.arbeitslos,
  f.arbeitslos_seit,
  f.arbeitsamt_name,
  f.arbeitsamt_aktenzeichen,
  f.schule_studium,
  f.schule_seit,
  f.schule_name,
  f.schule_ende,
  f.schulferien_waehrend_beschaeftigung,
  f.schulferien_von,
  f.schulferien_bis,
  f.rente,
  f.rente_seit,
  f.rente_art,
  f.rente_traeger,
  f.hausmann,
  f.hausmann_seit,
  f.lebensunterhalt_sonstiges,
  f.vorbeschaeftigung_deutschland_tage,
  f.vorbeschaeftigung_deutschland_arbeitgeber,
  f.ausgeloest_durch_lohnprogramm_hinweis,
  f.ausgefuellt_am,
  f.erfasst_von,
  f.erfasst_am,
  f.updated_by,
  f.updated_at,
  sv_fragebogen_bestanden(f) as bestanden,
  -- WICHTIG: unvollstaendig_fehlerhaft/_grund stehen HIER (nach bestanden),
  -- nicht in Tabellen-Spaltenreihenfolge vor ausgefuellt_am - das ist die
  -- Position, in der sie live per "create or replace view" angehängt
  -- wurden (migration_2026-08-08_sv_fragebogen_unvollstaendig.sql). Diese
  -- SELECT-Liste muss die TATSÄCHLICH deployte Spaltenreihenfolge
  -- widerspiegeln, nicht die Tabellen-Spaltenreihenfolge - sonst 42P16
  -- (schon einmal passiert, 2026-08-10).
  f.unvollstaendig_fehlerhaft,
  f.unvollstaendig_fehlerhaft_grund,
  -- Sozialversicherungsfreier Zeitraum laut Angaben (Nutzer-Vorgabe
  -- 2026-08-10) - siehe ausführlichen Kommentar bei den sv_freier_zeitraum_
  -- *-Funktionen oben. Ans Ende angehängt (nach unvollstaendig_fehlerhaft_
  -- grund, dem tatsächlich letzten Feld der live laufenden Sicht).
  sv_freier_zeitraum_von(f) as sv_frei_von,
  sv_freier_zeitraum_bis(f) as sv_frei_bis,
  sv_freier_zeitraum_luecke(f) as sv_frei_luecke,
  sv_freier_zeitraum_luecke_von(f) as sv_frei_luecke_von,
  sv_freier_zeitraum_luecke_bis(f) as sv_frei_luecke_bis,
  -- "Offener Zustand" (Hausfrau/Rente/Selbstständigkeit): sv_frei_von oben
  -- ist dann nur das Nachweis-Datum aus dem Formular, NICHT der Beginn des
  -- SV-freien Zeitraums - der ist der tatsächliche Arbeitsbeginn (siehe
  -- employee_sv_pruefung.sv_frei_von, dort korrekt eingesetzt).
  sv_freier_zeitraum_offen(f) as sv_frei_offen,
  -- Vorbeschäftigung wahlweise als Zeitraum erfassbar (Nutzer-Vorgabe
  -- 2026-08-11) - die effektive Tage-Zahl bevorzugt den Zeitraum, falls
  -- vollständig angegeben. Ans Ende angehängt (42P16).
  f.vorbeschaeftigung_deutschland_von,
  f.vorbeschaeftigung_deutschland_bis,
  vorbeschaeftigung_deutschland_tage_effektiv(f)
    as vorbeschaeftigung_deutschland_tage_effektiv
from sv_fragebogen f;

-- security_invoker = true: die Rohantworten sind so sensibel wie andere
-- Personaldaten (SV-Nr./IBAN) - läuft mit den Rechten des aufrufenden
-- Nutzers, damit die admin/hr-only-Policy von sv_fragebogen tatsächlich
-- greift (siehe RLS weiter unten).
alter view sv_fragebogen_auswertung set (security_invoker = true);
grant select on sv_fragebogen_auswertung to authenticated;

-- ---------------------------------------------------------------------------
-- 2b. Doppelte Haushaltsführung ("Bestätigung für den Nachweis der
--     doppelten Haushaltsführung - saisonbeschäftigte Arbeitskräfte") -
--     Nachweis für das Finanzamt, dass die Person im Heimatland einen
--     eigenen Hausstand unterhält (Voraussetzung für den Lohnsteuerabzug-
--     Antrag). Ein Datensatz je Person UND Saison-Jahr, analog zum
--     SV-Fragebogen (Nutzer-Vorgabe 2026-08-08). Name/Geburtsdatum/Adresse
--     stehen schon auf employees, werden hier bewusst nicht dupliziert -
--     nur die formularspezifischen Angaben. Genau wie beim SV-Fragebogen:
--     von der rumänischen Gemeinde bestätigt/gestempelt, daher manuell vom
--     Papierformular abgetippt, kein automatisches Auslesen.
-- ---------------------------------------------------------------------------
create table doppelte_haushaltsfuehrung (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,

  familienstand text check (
    familienstand in ('verheiratet', 'ledig', 'verwitwet', 'geschieden_getrennt')
  ),
  -- Nur laut Formular relevant/abgefragt, wenn familienstand <> 'verheiratet'.
  wohnsituation text check (
    wohnsituation in (
      'eigentuemer_mieter', 'lebenspartner', 'andere_verwandte', 'keine_angabe'
    )
  ),

  -- Stand des Lohnsteuerabzug-Antrags beim Finanzamt (Nutzer-Vorgabe
  -- 2026-08-11, ersetzt das frühere Ja/Nein-Feld "antrag_gestellt").
  -- Getrennt von "gewünscht" (personal_kandidaten.lohnsteuerabzug_antrag_
  -- gewuenscht) - das ist der Wunsch der Person, dies hier ist der
  -- tatsächliche Verfahrensstand.
  -- WICHTIG (Nutzer-Klarstellung): das bloße Ausfüllen des Formulars
  -- "Doppelte Haushaltsführung" ist NOCH KEIN gestellter Antrag - das
  -- Formular ist nur der Nachweis des eigenen Hausstands im Heimatland.
  -- Dieser Status wird deshalb bewusst manuell gesetzt und NIE automatisch
  -- aus dem Vorhandensein des Formulars abgeleitet.
  lohnsteuer_status text not null default 'kein_antrag' check (
    lohnsteuer_status in (
      'kein_antrag', 'antrag_gestellt', 'freibetrag_erteilt', 'kein_freibetrag'
    )
  ),
  -- Datum zum jeweiligen Status (Antrag gestellt am / Bescheid vom).
  antrag_gestellt_am date,

  -- Ort/Datum auf dem Papierformular
  ausgefuellt_am date,

  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),

  unique (employee_id, saison_jahr)
);

-- Live berechnete Vollständigkeits-Prüfung für die Anreiseliste (und die
-- gespiegelte Anzeige im Personalstamm) - bewusst nicht gespeichert, damit
-- sie nie veraltet/falsch stehen bleiben kann, wenn z.B. anderswo (Personal
-- → Dokumente) eine fehlende Kopie nachträglich hochgeladen wird.
-- security_invoker = true (siehe unten): läuft mit den Rechten des
-- aufrufenden Nutzers, damit die RLS-Policies von personal_kandidaten UND
-- employee_documents (beide admin/hr-only) tatsächlich greifen.
create or replace view personal_kandidaten_checkliste as
select
  k.id as kandidat_id,
  k.aktivierter_employee_id as employee_id,
  k.gedruckt,
  k.fragebogen_erfasst,
  k.buskosten_erfasst,
  exists (
    select 1 from employee_documents d
    where d.employee_id = k.aktivierter_employee_id
      and d.kategorie = 'Ausweiskopie'
  ) as ausweiskopie_vorhanden,
  (
    k.fuehrerschein_kategorien is null
    or array_length(k.fuehrerschein_kategorien, 1) is null
    or exists (
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Führerschein Kopie'
    )
  ) as fuehrerschein_erfuellt,
  (
    coalesce(k.verheiratet_laut_fragebogen, false) = false
    or exists (
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Hochzeitsurkunde'
    )
  ) as hochzeitsurkunde_erfuellt,
  -- Prüft seit 2026-08-11 die ERFASSTEN ANGABEN statt eines hochgeladenen
  -- Formulars (Nutzer-Vorgabe: "Diese Dokumente sollen nur noch über die
  -- Eingabemaske abgefragt werden ... ein Dateiupload ist nicht mehr
  -- notwendig"). Erfüllt, sobald auf "Personal → Lohnsteuer" der
  -- Familienstand erfasst ist - das ist die Kernangabe des Formulars.
  (
    k.lohnsteuerabzug_antrag_gewuenscht = false
    or exists (
      select 1 from doppelte_haushaltsfuehrung d
      where d.employee_id = k.aktivierter_employee_id
        and d.saison_jahr = extract(year from k.geplante_ankunft)::int
        and d.familienstand is not null
    )
  ) as lohnsteuerabzug_erfuellt,
  -- SV-Fragebogen (Nutzer-Vorgabe 2026-08-08: löst das alte manuelle
  -- fragebogen_erfasst-Häkchen als Vollständigkeits-Kriterium ab). Kein
  -- eigenes Saison-Jahr-Feld auf personal_kandidaten - Jahr wird aus dem
  -- geplanten Ankunftsdatum abgeleitet. "erfasst" = Datensatz existiert,
  -- "bestanden" = zusätzlich laut Auswertung SV-frei plausibel möglich.
  -- Ans Ende angehängt (nicht dazwischen) - siehe Kommentar bei
  -- employee_sv_pruefung weiter unten zum Grund (Fehler 42P16).
  exists (
    select 1 from sv_fragebogen f
    where f.employee_id = k.aktivierter_employee_id
      and f.saison_jahr = extract(year from k.geplante_ankunft)::int
  ) as sv_fragebogen_erfasst,
  coalesce(
    (
      select fa.bestanden
      from sv_fragebogen_auswertung fa
      where fa.employee_id = k.aktivierter_employee_id
        and fa.saison_jahr = extract(year from k.geplante_ankunft)::int
    ),
    false
  ) as sv_fragebogen_bestanden,
  coalesce(
    (
      select fa.unvollstaendig_fehlerhaft
      from sv_fragebogen_auswertung fa
      where fa.employee_id = k.aktivierter_employee_id
        and fa.saison_jahr = extract(year from k.geplante_ankunft)::int
    ),
    false
  ) as sv_fragebogen_unvollstaendig_fehlerhaft
from personal_kandidaten k
where k.status = 'anreiseliste';

alter view personal_kandidaten_checkliste set (security_invoker = true);
grant select on personal_kandidaten_checkliste to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tageserfassung (ersetzt Sheets "Jan" bis "August")
-- ---------------------------------------------------------------------------
create table work_entries (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  datum date not null,
  -- 0-24 Std., NULL = "nicht erfasst" (unterscheidet sich bewusst von 0)
  stunden numeric(4, 2) check (stunden is null or (stunden >= 0 and stunden <= 24)),
  -- 'U' = Urlaub/Feiertag (in Excel pauschal mit 8 Std. verrechnet)
  markierung text,
  notiz text,
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, datum)
);

create index idx_work_entries_datum on work_entries (datum);
create index idx_work_entries_employee on work_entries (employee_id);

-- ---------------------------------------------------------------------------
-- 4. Perioden-Sperre (aus 5.2: "Freigabe/Sperre abgeschlossener Monate")
-- ---------------------------------------------------------------------------
create table periods (
  saison_jahr int not null,
  monat int not null check (monat between 1 and 12),
  gesperrt boolean not null default false,
  -- default auth.uid() statt vom Client übergeben - fälschungssicherer,
  -- da RLS ohnehin nur admin/hr das Schreiben erlaubt.
  gesperrt_von uuid references profiles (id) default auth.uid(),
  gesperrt_am timestamptz,
  -- Beim Wiederöffnen eines abgeschlossenen Monats (z.B. um vergessene
  -- Stunden nachzutragen) - Grund ist Pflichtfeld, wie bei Storno/
  -- Vorschuss-Korrektur, damit eine nachträgliche Änderung sichtbar und
  -- nachvollziehbar bleibt statt unbemerkt durchzurutschen.
  entsperrt_von uuid references profiles (id) default auth.uid(),
  entsperrt_am timestamptz,
  entsperrt_grund text,
  primary key (saison_jahr, monat)
);

-- ---------------------------------------------------------------------------
-- 4a. Auszahlungsbelege: eine Belegnummer je "Jetzt Abrechnen"-Aktion,
--     unabhängig davon wie viele Personen dabei gleichzeitig abgerechnet
--     wurden (analog zu Vorschüssen/Kassenbuch).
-- ---------------------------------------------------------------------------
create table auszahlungsbelege (
  id bigint generated always as identity primary key,
  belegnummer text not null unique,
  saison_jahr int not null,
  -- 'BAR' oder 'AZ' (Überweisung) - relevant z.B. für Personen, die schon
  -- abgereist sind und erst später per Überweisung ausgezahlt werden.
  zahlungsart text not null default 'BAR',
  erstellt_am timestamptz not null default now(),
  erstellt_von uuid references profiles (id)
);

-- ---------------------------------------------------------------------------
-- 4a2. Unveränderliche Zeilen je Beleg/Person (Nutzer-Vorgabe 2026-08-21,
--      Frage: "Person abgerechnet, deaktiviert, reaktiviert, Stunden
--      nachgetragen, erneut abgerechnet - kommt dann eine weitere
--      Abrechnung?"). VORHER stammte der Beleg-Inhalt für die Auszahlungen-
--      Seite/auszahlungsbeleg_summary aus season_bonuses.snapshot bzw.
--      season_bonuses.auszahlungsbeleg_id - beides wird bei JEDER erneuten
--      Abrechnung derselben Person/Saison überschrieben (season_bonuses hat
--      UNIQUE(employee_id, saison_jahr)). Das hatte zwei Folgen: (1) ein
--      erneutes "Jetzt Abrechnen" zeigte wieder den KOMPLETTEN, kumulierten
--      Saison-Betrag statt nur der Differenz seit der letzten Abrechnung -
--      Doppelzahlungsrisiko; (2) der ALTE, bereits gedruckte Beleg verlor
--      diese Person (und ihren Betrag) rückwirkend aus seiner eigenen
--      Summe/Personenliste, sobald der Verweis auf den neuen Beleg wanderte.
--
--      Diese Tabelle ist append-only (wie saison_abrechnungen) und hält pro
--      (Beleg, Person) die für GENAU DIESEN Beleg gültigen Beträge fest -
--      unabhängig davon, was später mit season_bonuses passiert.
--      season_bonuses bleibt unverändert bestehen und weiterhin der
--      "laufende Gesamtstand" der Saison (Basis für die Abweichungsanzeige
--      auf der Lohnübersicht und für den Vergleichswert beim nächsten
--      Differenzbeleg), siehe saison_abrechnen_batch weiter unten.
-- ---------------------------------------------------------------------------
create table auszahlungsbeleg_zeilen (
  id bigint generated always as identity primary key,
  auszahlungsbeleg_id bigint not null references auszahlungsbelege (id),
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,
  personal_nr text not null,
  name text not null,
  vorname text not null,
  abrechnungsart text not null,
  -- true, wenn diese Zeile die DIFFERENZ zu einer früheren Abrechnung
  -- derselben Person/Saison ist (nicht der volle Saison-Betrag) - Person
  -- war also schon einmal für dieses Jahr abgerechnet und wurde seither
  -- reaktiviert.
  ist_differenz boolean not null default false,
  -- Gleiche Feldnamen wie season_summary (basis_brutto, praemien_summe,
  -- stundenkonto_auszahlung_betrag, bruttolohn, lohnsteuer_pauschal, netto,
  -- abzug_verpflegung, abzug_wohnen, vorschuss_summe, bus_kosten,
  -- fahrer_kaution, zimmer_kaution, kleidung_betrag, verpflegungsfreie_tage,
  -- gesamt_stunden, anwesenheitstage, auszahlungsbetrag) - bei
  -- ist_differenz = true die DIFFERENZ, sonst der volle Wert. Gleiche
  -- Struktur wie season_bonuses.snapshot, damit anzeige() im Frontend
  -- (app/auszahlungen/page.tsx) unverändert weiterverwendet werden kann.
  zeile jsonb not null,
  erstellt_am timestamptz not null default now()
);

create unique index idx_auszahlungsbeleg_zeilen_beleg_employee
  on auszahlungsbeleg_zeilen (auszahlungsbeleg_id, employee_id);

-- ---------------------------------------------------------------------------
-- 4b. Kautionsübergabe (Nutzer-Vorgabe 2026-08-09): die bei der Auszahlung
--     einbehaltene Zimmerkaution wird real an den Hausmeister übergeben -
--     erst dann wird sie auch als tatsächliche Kassenausgabe fällig (die
--     Kaution mindert vorher schon den Auszahlungsbetrag der Person, aber
--     NICHT den Kassenbestand - das macht erst diese Übergabe). Analog zum
--     Vorschuss-Übergabebeleg: eine Zusammenfassung (wer/wann/wie viel an
--     wen) plus die enthaltenen Personen/Beträge, mit EINEM
--     Unterschriftsfeld für den Hausmeister (nicht je Person). Immer bar,
--     da eine physische Kaution.
-- ---------------------------------------------------------------------------
create table kautionsuebergaben (
  id bigint generated always as identity primary key,
  belegnummer text not null unique,
  -- Der Auszahlungsbeleg, aus dem die Kautionen dieser Übergabe stammen -
  -- die Liste erscheint direkt im Anschluss an diesen Beleg (Nutzer-
  -- Vorgabe: "muss unter den Auszahlungsbeleg").
  auszahlungsbeleg_id bigint not null references auszahlungsbelege (id),
  uebergeben_an text not null,
  betrag_summe numeric(10, 2) not null check (betrag_summe > 0),
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  storniert boolean not null default false,
  storniert_am timestamptz,
  storniert_von uuid references profiles (id),
  storno_grund text
);

-- n:m-artig, da eine Übergabe mehrere Personen/Kautionen bündelt.
create table kautionsuebergabe_personen (
  kautionsuebergabe_id bigint not null references kautionsuebergaben (id) on delete restrict,
  employee_id uuid not null references employees (id) on delete restrict,
  betrag numeric(10, 2) not null,
  primary key (kautionsuebergabe_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- 5. Saison-Boni & Zulagen (aus Sheet "Summen": Akkord, Prämien, Fahrer, Bus)
-- ---------------------------------------------------------------------------
create table season_bonuses (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,
  akkord_betrag numeric(10, 2) not null default 0,
  praemie_ausgleich numeric(10, 2) not null default 0,
  fahrer_zulage numeric(10, 2) not null default 0,
  erdbeer_praemie numeric(10, 2) not null default 0,
  spargel_praemie numeric(10, 2) not null default 0,
  bus_hin numeric(10, 2) not null default 0,
  bus_rueck numeric(10, 2) not null default 0,
  -- Kautionen, bei bevorstehender Abreise wie ein Vorschuss von der
  -- Auszahlung abgezogen, aber separat ausgewiesen. Rückzahlung (nach
  -- Fahrzeug-/Zimmerkontrolle) läuft weiterhin außerhalb der App in bar.
  -- Fahrerkaution nur bei Fahrern (die auch fahrer_zulage bekommen).
  fahrer_kaution numeric(10, 2) not null default 0,
  zimmer_kaution numeric(10, 2) not null default 0,
  -- Arbeitskleidung (Nutzer-Vorgabe 2026-08-09): nur Hose/Jacke/Stiefel
  -- werden berechnet - Spargelmesser/Feile/Handschuhe sind
  -- Verbrauchsgegenstände, werden beim Tausch gegen das Altgerät
  -- kostenlos ersetzt und deshalb hier nicht erfasst. Anzahl statt
  -- direktem Betrag, da der Preis je Stück fest in verpflegungssaetze
  -- hinterlegt ist (Anzahl × Satz = Abzug, siehe season_summary).
  -- Erfasst von der Rolle zeiterfassung, die die Kleidung ausgibt. Dies
  -- ist ein reiner Cache, aus dem Ausgabe-Log kleidung_ausgaben
  -- fortlaufend neu berechnet - siehe
  -- arbeitskleidung_bestand_synchronisieren weiter unten (Nutzer-Vorgabe
  -- 2026-08-24: Datumsstempel + Größen je Ausgabe statt einer
  -- überschreibbaren Gesamtzahl).
  kleidung_hose_anzahl int not null default 0,
  kleidung_jacke_anzahl int not null default 0,
  kleidung_stiefel_anzahl int not null default 0,
  -- Bei abrechnungsart 'lohnsteuerklasse_1'/'sozialversicherungspflichtig'
  -- kann/darf die App die Lohnsteuer nicht selbst berechnen (das macht ein
  -- echtes Lohnprogramm) - entspricht Sheet "Summen", Spalte BA
  -- ("Netto-Summe (HSC)"): Lohnbuchhaltung trägt den vom Lohnprogramm
  -- gelieferten Netto-Betrag hier von Hand ein, die App rechnet ab da weiter.
  netto_extern numeric(10, 2),
  -- Anzahl Tage innerhalb der Saison, an denen KEIN Verpflegungsabzug
  -- berechnet wird (Nutzer-Vorgabe 2026-08-19, z.B. weil die Kantine noch
  -- nicht geöffnet hatte) - reduziert in season_summary NUR die für den
  -- Verpflegungsabzug gezählten Anwesenheitstage (Tagessatz × (Anwesenheits-
  -- tage − verpflegungsfreie_tage)), nicht die Anwesenheitstage selbst
  -- (die bleiben für Stunden/Unterkunft unverändert). Unterkunft bewusst
  -- nicht betroffen - hier ging es ausdrücklich nur um die Kantine.
  verpflegungsfreie_tage int not null default 0,
  -- Kumulierte Summe aller "in Auszahlung umgewandelten" Stundenkonto-
  -- Buchungen dieser Saison (Nutzer-Vorgabe 2026-08-20, siehe
  -- stundenkonto_bewegungen/stundenkonto_in_auszahlung_umwandeln weiter
  -- unten) - fließt wie eine Prämie live in bruttolohn ein (also normal
  -- lohnsteuerpflichtig), erscheint auf der Lohnübersicht aber als eigene
  -- Spalte statt in der Prämien-Summe.
  stundenkonto_auszahlung_betrag numeric(10, 2) not null default 0,
  -- "Jetzt Abrechnen" auf der Lohnübersicht (pro Saison-Jahr, nicht
  -- permanent - damit eine Wiederkehr in der nächsten Saison nicht mit
  -- dieser Markierung kollidiert).
  abgerechnet_am timestamptz,
  abgerechnet_von uuid references profiles (id),
  auszahlungsbeleg_id bigint references auszahlungsbelege (id),
  -- Eingefrorener Stand von season_summary zum Zeitpunkt des Abrechnens
  -- (Stunden, Brutto, Abzüge, Netto, Auszahlungsbetrag, ...). Spätere
  -- Änderungen an Sätzen/Vorschüssen dürfen eine bereits ausgezahlte
  -- Abrechnung nicht rückwirkend verändern - die Lohnübersicht zeigt für
  -- abgerechnete Personen diesen Schnappschuss und warnt, falls die
  -- Live-Neuberechnung inzwischen abweicht.
  snapshot jsonb,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (employee_id, saison_jahr)
);

-- ---------------------------------------------------------------------------
-- 5a. Stundenkonto (Nutzer-Vorgabe 2026-08-20): laufendes Konto je
--     Mitarbeiter/Saison-Jahr für Überstunden & Co., unabhängig vom gerade
--     gewählten Datum auf der Stundenerfassung pflegbar. Bewegungs-Log
--     statt Einzelfeld (wie kassenbewegungen) - der Kontostand ist die
--     Summe aller Bewegungen, siehe employee_stundenkonto_saldo unten.
--     Vier Arten:
--       'Gutschrift'        - Stunden werden dem Konto gutgeschrieben
--       'Korrektur'         - Tippfehler o.ä. richtigstellen, kein
--                              Saldo-Check (bewusste Ausnahme)
--       'Freizeitausgleich' - Stunden werden in freie Tage umgewandelt,
--                              keine Lohnwirkung
--       'Auszahlung'        - Stunden werden ausgezahlt, siehe
--                              stundenkonto_in_auszahlung_umwandeln unten
--     'Freizeitausgleich' und 'Auszahlung' dürfen den Saldo nicht negativ
--     werden lassen. Schreibrechte für 'Gutschrift'/'Korrektur'/
--     'Freizeitausgleich' wie work_entries (admin/hr/zeiterfassung) -
--     'Auszahlung' ausschließlich über die eigene, admin/lohnabrechnung-
--     beschränkte Funktion (erzeugt zusätzlich einen echten
--     Lohnbestandteil, siehe season_bonuses.stundenkonto_auszahlung_betrag
--     oben). Wie bei auszahlungsbelege/saison_abrechnungen deshalb bewusst
--     KEINE Schreib-Policy auf der Tabelle selbst - nur die beiden
--     security-definer Funktionen unten dürfen schreiben.
-- ---------------------------------------------------------------------------
create table stundenkonto_bewegungen (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,
  datum date not null default current_date,
  stunden numeric(6, 2) not null check (stunden <> 0),
  art text not null
    check (art in ('Gutschrift', 'Korrektur', 'Freizeitausgleich', 'Auszahlung')),
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now()
);

create index idx_stundenkonto_bewegungen_employee
  on stundenkonto_bewegungen (employee_id, saison_jahr);

-- Aktueller Kontostand je Mitarbeiter/Saison-Jahr - security_invoker
-- unbedenklich, stundenkonto_bewegungen ist per RLS ohnehin für jede
-- angemeldete Rolle lesbar (wie work_entries).
create or replace view employee_stundenkonto_saldo as
select employee_id, saison_jahr, sum(stunden) as saldo
from stundenkonto_bewegungen
group by employee_id, saison_jahr;

alter view employee_stundenkonto_saldo set (security_invoker = true);
grant select on employee_stundenkonto_saldo to authenticated;

-- Bucht Gutschrift/Korrektur/Freizeitausgleich - alles ohne unmittelbare
-- Lohnwirkung, deshalb dieselben Rechte wie die Stundenerfassung selbst.
create or replace function stundenkonto_buchen(
  p_employee_id uuid,
  p_saison_jahr int,
  p_datum date,
  p_stunden numeric,
  p_art text,
  p_notiz text
)
returns void language plpgsql security definer as $$
declare
  v_saldo numeric;
begin
  if current_role_name() not in ('admin', 'hr', 'zeiterfassung') then
    raise exception 'Keine Berechtigung für das Stundenkonto';
  end if;

  if p_stunden is null or p_stunden = 0 then
    raise exception 'Bitte eine Stundenzahl ungleich 0 angeben';
  end if;

  -- Bugfix 2026-08-20: die vorherige if/elsif-Kette prüfte "ist es KEINE
  -- Freizeitausgleich UND KEINE Korrektur" als letzte Bedingung - eine
  -- gültige Gutschrift (positive Stunden) fiel dadurch fälschlich in die
  -- "Ungültige Art"-Fehlermeldung, da p_art = 'Gutschrift' in keinem der
  -- vorherigen Zweige behandelt wurde. Jetzt je Art ein eigener,
  -- vollständiger Zweig.
  if p_art = 'Gutschrift' then
    if p_stunden <= 0 then
      raise exception 'Eine Gutschrift muss positiv sein';
    end if;
  elsif p_art = 'Freizeitausgleich' then
    if p_stunden >= 0 then
      raise exception 'Freizeitausgleich muss als negative Stundenzahl gebucht werden';
    end if;
    select coalesce(sum(stunden), 0) into v_saldo
    from stundenkonto_bewegungen
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;
    if -p_stunden > v_saldo then
      raise exception 'Nicht genug Stunden auf dem Stundenkonto (aktueller Saldo: % Std.)', v_saldo;
    end if;
  elsif p_art = 'Korrektur' then
    null; -- bewusst ohne Saldo-Prüfung, siehe Kommentar bei der Tabelle
  else
    raise exception 'Ungültige Art - Auszahlung nur über die dafür vorgesehene Funktion';
  end if;

  insert into stundenkonto_bewegungen (employee_id, saison_jahr, datum, stunden, art, notiz)
  values (p_employee_id, p_saison_jahr, coalesce(p_datum, current_date), p_stunden, p_art, p_notiz);
end;
$$;

grant execute on function stundenkonto_buchen(uuid, int, date, numeric, text, text) to authenticated;

-- Wandelt einen Teil des Stundenkonto-Saldos in eine Auszahlung um - admin/
-- lohnabrechnung wie "Jetzt Abrechnen" (echter Lohnbestandteil). Rechnet
-- automatisch Stunden × Stundenlohn, bucht eine negative Bewegung und
-- erhöht season_bonuses.stundenkonto_auszahlung_betrag (kumulativ - mehrere
-- Umwandlungen je Saison möglich). Ist die Person bereits abgerechnet,
-- wird zusätzlich der eingefrorene Schnappschuss aktualisiert und die
-- Änderung protokolliert - exakt dasselbe Muster wie
-- abrechnung_korrigieren (Sperre bei bereits freigegebener
-- Kassenprüfung, Eintrag in kassenbewegungen).
create or replace function stundenkonto_in_auszahlung_umwandeln(
  p_employee_id uuid,
  p_saison_jahr int,
  p_stunden numeric,
  p_notiz text
)
-- Gibt den berechneten Auszahlungsbetrag zurück (Stunden × Stundenlohn) -
-- so muss das Frontend employees.stundenlohn nicht selbst laden/anzeigen
-- (auf der Stundenerfassung sonst nur schmal für zeiterfassung geladen,
-- siehe employees-Select-Grant-Vorfall).
returns numeric language plpgsql security definer as $$
declare
  v_saldo numeric;
  v_stundenlohn numeric;
  v_betrag numeric;
  v_abgerechnet_am timestamptz;
  v_belegnummer text;
  v_zahlungsart text;
  v_auszahlungsbeleg_id bigint;
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
  s season_summary%rowtype;
  neu season_summary%rowtype;
begin
  -- Nutzer-Vorgabe 2026-08-21: hr und management dürfen "In Auszahlung
  -- umwandeln" ebenfalls sehen/nutzen (nicht nur admin/lohnabrechnung wie
  -- beim ursprünglichen Bau am 2026-08-20) - ausdrücklich NICHT
  -- zeiterfassung. Muss exakt zu kannStundenkontoAuszahlen in
  -- lib/stundenkontoRechte.ts passen.
  if current_role_name() not in ('admin', 'hr', 'lohnabrechnung', 'management') then
    raise exception 'Keine Berechtigung, Stundenkonto in Auszahlung umzuwandeln';
  end if;

  if p_stunden is null or p_stunden <= 0 then
    raise exception 'Bitte eine Stundenzahl größer als 0 angeben';
  end if;

  select coalesce(sum(stunden), 0) into v_saldo
  from stundenkonto_bewegungen
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if p_stunden > v_saldo then
    raise exception 'Nicht genug Stunden auf dem Stundenkonto (aktueller Saldo: % Std.)', v_saldo;
  end if;

  select stundenlohn into v_stundenlohn from employees where id = p_employee_id;
  v_betrag := round(p_stunden * coalesce(v_stundenlohn, 0), 2);

  select b.abgerechnet_am, b.auszahlungsbeleg_id, ab.belegnummer, ab.zahlungsart
    into v_abgerechnet_am, v_auszahlungsbeleg_id, v_belegnummer, v_zahlungsart
  from season_bonuses b
  left join auszahlungsbelege ab on ab.id = b.auszahlungsbeleg_id
  where b.employee_id = p_employee_id and b.saison_jahr = p_saison_jahr;

  if v_abgerechnet_am is not null and ist_kassenpruefung_gesperrt(v_abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  -- Nutzer-Vorgabe 2026-08-21: volle "Vorher"-Zeile (nicht nur den Betrag)
  -- einlesen, damit die Differenz auch auf dem tatsächlich gedruckten Beleg
  -- nachgezogen werden kann (auszahlungsbeleg_zeile_delta_anwenden unten) -
  -- gleiches Muster wie abrechnung_korrigieren/
  -- abrechnung_verpflegung_korrigieren.
  if v_abgerechnet_am is not null then
    select * into s from season_summary
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;
    v_alter_betrag := s.auszahlungsbetrag;
  end if;

  insert into stundenkonto_bewegungen (employee_id, saison_jahr, stunden, art, notiz)
  values (p_employee_id, p_saison_jahr, -p_stunden, 'Auszahlung', p_notiz);

  insert into season_bonuses (employee_id, saison_jahr, stundenkonto_auszahlung_betrag)
  values (p_employee_id, p_saison_jahr, v_betrag)
  on conflict (employee_id, saison_jahr)
  do update set stundenkonto_auszahlung_betrag =
    season_bonuses.stundenkonto_auszahlung_betrag + v_betrag;

  if v_abgerechnet_am is not null then
    select * into neu from season_summary
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

    v_neuer_betrag := neu.auszahlungsbetrag;
    v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

    update season_bonuses
    set snapshot = to_jsonb(neu) - 'snapshot'
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

    perform auszahlungsbeleg_zeile_delta_anwenden(p_employee_id, v_auszahlungsbeleg_id, s, neu);

    if v_belegnummer is not null then
      insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
      values (
        'Stundenkonto-Auszahlung', v_belegnummer, v_delta, v_zahlungsart, auth.uid(),
        coalesce(p_notiz || ' - ', '') || p_stunden || ' Std. umgewandelt'
      );
    end if;
  end if;

  return v_betrag;
end;
$$;

grant execute on function stundenkonto_in_auszahlung_umwandeln(uuid, int, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Historie aller Abrechnungen je Person und Saison (Nutzer-Vorgabe
-- 2026-08-11). season_bonuses selbst hat unique (employee_id, saison_jahr)
-- und überschreibt abgerechnet_am bei jeder erneuten Abrechnung - für die
-- SV-Prüfung brauchen wir aber ALLE Abrechnungszeitpunkte:
--
-- Die Abrechnung IST das Ende eines Beschäftigungsabschnitts (saison_
-- abrechnen_batch setzt dabei employees.aktiv = false). Da die 15-Wochen-
-- Grenze über das Kalenderjahr zusammengerechnet wird und NICHT am Stück
-- laufen muss (Nutzer-Recherche 2026-08-11), müssen die einzelnen
-- Abschnitte einer wiederkehrenden Person getrennt gezählt werden - sonst
-- würde die Pause zwischen zwei Einsätzen fälschlich mitzählen. Genau
-- dafür ist diese Tabelle da (siehe employee_sv_pruefung weiter unten).
--
-- Rein dokumentierend/additiv: wird nur von saison_abrechnen_batch
-- geschrieben, nie geändert oder gelöscht.
-- ---------------------------------------------------------------------------
create table saison_abrechnungen (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,
  abgerechnet_am timestamptz not null default now(),
  abgerechnet_von uuid references profiles (id),
  auszahlungsbeleg_id bigint references auszahlungsbelege (id)
);

create index idx_saison_abrechnungen_employee
  on saison_abrechnungen (employee_id, saison_jahr, abgerechnet_am);

-- ---------------------------------------------------------------------------
-- Differenzbeleg-Hilfsfunktionen (Nutzer-Vorgabe 2026-08-21): siehe
-- auszahlungsbeleg_zeilen weiter oben. auszahlungsbeleg_zeile_differenz
-- bildet aus zwei season_summary-artigen JSON-Objekten (aktueller Stand
-- minus vorheriger eingefrorener Stand) die reine Differenz je Betrags-
-- /Mengenfeld - nicht-numerische Felder (Name, Personalnummer, ...) bleiben
-- unverändert der AKTUELLE Stand. auszahlungsbeleg_zeile_delta_anwenden
-- ADDIERT diese Differenz nachträglich auf eine bereits bestehende Beleg-
-- Zeile (statt sie zu überschreiben) - so bleibt eine Differenz-Zeile eine
-- Differenz-Zeile und eine volle Erstzeile eine volle Zeile, auch wenn eine
-- der drei Korrektur-Funktionen (abrechnung_korrigieren,
-- abrechnung_verpflegung_korrigieren, stundenkonto_in_auszahlung_umwandeln)
-- nachträglich etwas an einer bereits abgerechneten Person ändert.
-- ---------------------------------------------------------------------------
create or replace function auszahlungsbeleg_zeile_felder()
returns text[] language sql immutable as $$
  select array[
    'gesamt_stunden', 'anwesenheitstage', 'basis_brutto', 'praemien_summe',
    'stundenkonto_auszahlung_betrag', 'bruttolohn', 'lohnsteuer_pauschal',
    'netto', 'abzug_verpflegung', 'abzug_wohnen', 'vorschuss_summe',
    'bus_kosten', 'fahrer_kaution', 'zimmer_kaution', 'kleidung_betrag',
    'verpflegungsfreie_tage', 'auszahlungsbetrag'
  ];
$$;

create or replace function auszahlungsbeleg_zeile_differenz(v_neu jsonb, v_alt jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_ergebnis jsonb := v_neu;
  v_feld text;
begin
  foreach v_feld in array auszahlungsbeleg_zeile_felder() loop
    v_ergebnis := jsonb_set(
      v_ergebnis, array[v_feld],
      to_jsonb(
        coalesce((v_neu ->> v_feld)::numeric, 0)
        - coalesce((v_alt ->> v_feld)::numeric, 0)
      )
    );
  end loop;
  return v_ergebnis;
end;
$$;

create or replace function auszahlungsbeleg_zeile_delta_anwenden(
  p_employee_id uuid,
  p_beleg_id bigint,
  p_alt season_summary,
  p_neu season_summary
)
returns void language plpgsql security definer as $$
declare
  v_zeile jsonb;
  v_feld text;
  v_alt_jsonb jsonb := to_jsonb(p_alt) - 'snapshot';
  v_neu_jsonb jsonb := to_jsonb(p_neu) - 'snapshot';
  v_delta numeric;
begin
  if p_beleg_id is null then
    return;
  end if;

  select zeile into v_zeile from auszahlungsbeleg_zeilen
  where auszahlungsbeleg_id = p_beleg_id and employee_id = p_employee_id
  for update;

  if not found then
    -- Sollte nicht vorkommen (jede abgerechnete Person hat eine Zeile im
    -- zuletzt erstellten Beleg) - sicherheitshalber kein Fehler, damit eine
    -- Korrektur nicht an einer fehlenden historischen Zeile scheitert.
    return;
  end if;

  foreach v_feld in array auszahlungsbeleg_zeile_felder() loop
    v_delta := coalesce((v_neu_jsonb ->> v_feld)::numeric, 0)
      - coalesce((v_alt_jsonb ->> v_feld)::numeric, 0);
    if v_delta <> 0 then
      v_zeile := jsonb_set(
        v_zeile, array[v_feld],
        to_jsonb(coalesce((v_zeile ->> v_feld)::numeric, 0) + v_delta)
      );
    end if;
  end loop;

  update auszahlungsbeleg_zeilen set zeile = v_zeile
  where auszahlungsbeleg_id = p_beleg_id and employee_id = p_employee_id;
end;
$$;

-- "Jetzt Abrechnen" auf der Lohnübersicht (Mehrfachauswahl): erstellt EINEN
-- Auszahlungsbeleg für die ganze Aktion (analog zu Vorschüssen/Kassenbuch),
-- markiert jede übergebene Person als abgerechnet, friert ihren Stand als
-- Schnappschuss ein und setzt employees.aktiv = false, alles atomar in
-- einer Transaktion. security definer, weil die Rolle lohnabrechnung
-- season_bonuses pflegen darf, aber employees.aktiv laut RLS eigentlich
-- nur admin/hr ändern dürfen - diese Funktion ist der eine kontrollierte
-- Ausnahmeweg dafür, ohne die employees-Policy generell zu öffnen.
-- Neuer Parameter p_zahlungsart -> andere Signatur als zuvor, alte Version
-- explizit entfernen statt als zusätzlichen Overload stehen zu lassen.
drop function if exists saison_abrechnen_batch(uuid[], int);

create or replace function saison_abrechnen_batch(
  p_employee_ids uuid[],
  p_saison_jahr int,
  p_zahlungsart text default 'BAR'
)
returns text language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neuer_beleg_id bigint;
  neue_belegnummer text;
  emp_id uuid;
  v_war_abgerechnet boolean;
  v_voller_stand jsonb;
  v_zeile jsonb;
  v_fehlende_namen text;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
  end if;

  -- Nutzer-Vorgabe 2026-08-21: "ich habe vergessen, den Netto-Betrag aus
  -- dem Lohnprogramm einzugeben" (mehrfach passiert) - blockiert das
  -- gesamte Abrechnen, wenn mindestens eine ausgewählte Person einen
  -- Bruttolohn > 0 hat, aber noch keinen Netto-Betrag. Betrifft nur
  -- Lohnsteuerklasse 1/sozialversicherungspflichtig (dort trägt
  -- Lohnbuchhaltung netto_extern von Hand ein, siehe season_bonuses) -
  -- bei 'pauschal' ist netto immer automatisch berechnet, nie null.
  select string_agg(s2.name || ', ' || s2.vorname, '; ')
    into v_fehlende_namen
  from season_summary s2
  where s2.employee_id = any(p_employee_ids)
    and s2.saison_jahr = p_saison_jahr
    and s2.bruttolohn > 0
    and s2.netto is null;

  if v_fehlende_namen is not null then
    raise exception 'Bitte zuerst den Netto-Betrag aus dem Lohnprogramm eintragen für: %', v_fehlende_namen;
  end if;

  neue_belegnummer := naechste_belegnummer('AZ-' || to_char(now(), 'MM-YYYY'));

  insert into auszahlungsbelege (belegnummer, saison_jahr, zahlungsart, erstellt_von)
  values (neue_belegnummer, p_saison_jahr, p_zahlungsart, auth.uid())
  returning id into neuer_beleg_id;

  foreach emp_id in array p_employee_ids loop
    select * into s from season_summary
    where employee_id = emp_id and saison_jahr = p_saison_jahr;

    if found then
      -- Nutzer-Vorgabe 2026-08-21: war diese Person für dieses Saisonjahr
      -- schon EINMAL abgerechnet (z.B. reaktiviert und mit nachgetragenen
      -- Stunden), zeigt dieser Beleg nur die DIFFERENZ seit der letzten
      -- Abrechnung, nicht nochmal den vollen (kumulierten) Saison-Betrag -
      -- siehe auszahlungsbeleg_zeilen weiter oben.
      v_war_abgerechnet := s.abgerechnet_am is not null;
      -- 'snapshot' aus s selbst entfernen, sonst würde sich bei mehrfachem
      -- Abrechnen derselben Person der alte Schnappschuss im neuen
      -- verschachteln.
      v_voller_stand := to_jsonb(s) - 'snapshot';
      if v_war_abgerechnet then
        v_zeile := auszahlungsbeleg_zeile_differenz(v_voller_stand, s.snapshot);
      else
        v_zeile := v_voller_stand;
      end if;

      insert into auszahlungsbeleg_zeilen (
        auszahlungsbeleg_id, employee_id, saison_jahr, personal_nr, name,
        vorname, abrechnungsart, ist_differenz, zeile
      )
      values (
        neuer_beleg_id, emp_id, p_saison_jahr, s.personal_nr, s.name,
        s.vorname, s.abrechnungsart, v_war_abgerechnet, v_zeile
      );

      -- season_bonuses bleibt weiterhin der laufende GESAMTSTAND der Saison
      -- (Basis für die Abweichungsanzeige auf der Lohnübersicht und für den
      -- Vergleichswert beim nächsten Differenzbeleg oben) - hier also
      -- unverändert der volle kumulierte Stand, nicht die Differenz.
      insert into season_bonuses (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        snapshot, auszahlungsbeleg_id
      )
      values (
        emp_id, p_saison_jahr, now(), auth.uid(),
        v_voller_stand, neuer_beleg_id
      )
      on conflict (employee_id, saison_jahr)
      do update set
        abgerechnet_am = now(),
        abgerechnet_von = auth.uid(),
        snapshot = excluded.snapshot,
        auszahlungsbeleg_id = neuer_beleg_id;

      -- Zusätzlich in die Historie (siehe saison_abrechnungen oben):
      -- season_bonuses überschreibt abgerechnet_am bei erneutem Abrechnen,
      -- die SV-Prüfung braucht aber jeden einzelnen Abschnitts-Endzeitpunkt.
      insert into saison_abrechnungen (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        auszahlungsbeleg_id
      )
      values (emp_id, p_saison_jahr, now(), auth.uid(), neuer_beleg_id);

      update employees set aktiv = false where id = emp_id;
    end if;
  end loop;

  return neue_belegnummer;
end;
$$;

grant execute on function saison_abrechnen_batch(uuid[], int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Nachträgliche Korrektur eines falsch eingegebenen Netto-Betrags NACH dem
-- Abrechnen (Nutzer-Vorgabe 2026-08-19: "Der Auszahlungsbetrag stimmt
-- jetzt nicht mehr, weil ich den Netto-Betrag falsch eingegeben habe").
-- Sobald abgerechnet_am gesetzt ist, liest die Lohnübersicht NICHT mehr
-- live, sondern aus dem eingefrorenen season_bonuses.snapshot (siehe
-- anzeige() in app/uebersicht/page.tsx) - dort hinein fließt auch die
-- Auszahlungsbeleg-Summe (auszahlungsbeleg_summary) und darüber der
-- Kassenbestand (Kasse-Seite). Eine reine netto_extern-Änderung würde also
-- nirgends sichtbar werden - diese Funktion aktualisiert deshalb zusätzlich
-- den Schnappschuss und protokolliert die Korrektur wie bei
-- vorschuss_korrigieren (Pflichtgrund, Eintrag in kassenbewegungen, Sperre
-- bei bereits freigegebener Kassenprüfung).
--
-- Bewusst NUR netto_extern (Nutzer-Vorgabe: kleinster, gezielter Eingriff
-- statt aller vier vor dem Abrechnen editierbaren Felder). Bewusst KEIN
-- Differenzbeleg (Nutzer-Vorgabe) - die tatsächliche Nachzahlung/
-- Rückforderung läuft wie bei der Kautions-Rückzahlung außerhalb der App,
-- die Korrektur passt nur die Buchung an.
create or replace function abrechnung_korrigieren(
  p_employee_id uuid,
  p_saison_jahr int,
  p_neuer_netto_extern numeric,
  p_grund text
)
returns void language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neu season_summary%rowtype;
  v_belegnummer text;
  v_zahlungsart text;
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für Abrechnungs-Korrektur';
  end if;

  if p_grund is null or trim(p_grund) = '' then
    raise exception 'Bitte eine Begründung für die Korrektur angeben';
  end if;

  if p_neuer_netto_extern is null then
    raise exception 'Bitte einen Netto-Betrag angeben';
  end if;

  select * into s from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if not found or s.abgerechnet_am is null then
    raise exception 'Diese Person ist für dieses Jahr nicht abgerechnet - bitte das normale Eingabefeld auf der Lohnübersicht nutzen';
  end if;

  if s.abrechnungsart = 'pauschal' then
    raise exception 'Bei Abrechnungsart "pauschal" wird Netto automatisch berechnet und kann nicht manuell korrigiert werden';
  end if;

  if ist_kassenpruefung_gesperrt(s.abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  select ab.belegnummer, ab.zahlungsart into v_belegnummer, v_zahlungsart
  from auszahlungsbelege ab where ab.id = s.auszahlungsbeleg_id;

  -- Bewusst der eingefrorene (nicht der live) Betrag als "vorher" - das
  -- ist der Betrag, der tatsächlich als Kassenbestand gezählt wird, und
  -- kann seit der Auszahlung bereits vom Live-Wert abweichen (siehe
  -- weichtAb() im Frontend) - diese Korrektur soll nur die eigene
  -- Netto-Änderung ausweisen, keine unabhängige Drift mit einrechnen.
  v_alter_betrag := (s.snapshot ->> 'auszahlungsbetrag')::numeric;

  update season_bonuses
  set netto_extern = p_neuer_netto_extern
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  select * into neu from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  v_neuer_betrag := neu.auszahlungsbetrag;
  v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

  -- Schnappschuss neu einfrieren, wie saison_abrechnen_batch - "snapshot"
  -- aus neu selbst entfernen, sonst verschachtelt sich der alte
  -- Schnappschuss im neuen.
  update season_bonuses
  set snapshot = to_jsonb(neu) - 'snapshot'
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  -- Nutzer-Vorgabe 2026-08-21: die Korrektur muss auch auf dem tatsächlich
  -- gedruckten Beleg sichtbar werden, nicht nur im laufenden Gesamtstand
  -- (season_bonuses) - siehe auszahlungsbeleg_zeilen/-zeile_delta_anwenden
  -- weiter oben.
  perform auszahlungsbeleg_zeile_delta_anwenden(p_employee_id, s.auszahlungsbeleg_id, s, neu);

  if v_belegnummer is not null then
    insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
    values ('Abrechnungs-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_grund);
  end if;
end;
$$;

grant execute on function abrechnung_korrigieren(uuid, int, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Gleiches Muster wie abrechnung_korrigieren, aber für "Tage ohne
-- Verpflegungsabzug" (Nutzer-Vorgabe 2026-08-19: eine Mitarbeiterin hatte
-- zu viel Verpflegung abgezogen bekommen, weil die Kantine an einigen
-- Tagen noch nicht geöffnet hatte - anders als beim Netto-Betrag gibt es
-- season_bonuses.verpflegungsfreie_tage aber auch VOR dem Abrechnen schon
-- als normales Eingabefeld (siehe app/uebersicht/page.tsx), diese Funktion
-- ist nur für den Fall NACH dem Abrechnen nötig, wenn das Feld sonst
-- gesperrt wäre.
create or replace function abrechnung_verpflegung_korrigieren(
  p_employee_id uuid,
  p_saison_jahr int,
  p_neue_verpflegungsfreie_tage int,
  p_grund text
)
returns void language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neu season_summary%rowtype;
  v_belegnummer text;
  v_zahlungsart text;
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für Abrechnungs-Korrektur';
  end if;

  if p_grund is null or trim(p_grund) = '' then
    raise exception 'Bitte eine Begründung für die Korrektur angeben';
  end if;

  if p_neue_verpflegungsfreie_tage is null or p_neue_verpflegungsfreie_tage < 0 then
    raise exception 'Bitte eine gültige Anzahl Tage (0 oder mehr) angeben';
  end if;

  select * into s from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if not found or s.abgerechnet_am is null then
    raise exception 'Diese Person ist für dieses Jahr nicht abgerechnet - bitte das normale Eingabefeld auf der Lohnübersicht nutzen';
  end if;

  if ist_kassenpruefung_gesperrt(s.abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  select ab.belegnummer, ab.zahlungsart into v_belegnummer, v_zahlungsart
  from auszahlungsbelege ab where ab.id = s.auszahlungsbeleg_id;

  -- Bewusst der eingefrorene (nicht der live) Betrag als "vorher" - siehe
  -- gleiche Begründung in abrechnung_korrigieren.
  v_alter_betrag := (s.snapshot ->> 'auszahlungsbetrag')::numeric;

  update season_bonuses
  set verpflegungsfreie_tage = p_neue_verpflegungsfreie_tage
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  select * into neu from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  v_neuer_betrag := neu.auszahlungsbetrag;
  v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

  update season_bonuses
  set snapshot = to_jsonb(neu) - 'snapshot'
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  -- Nutzer-Vorgabe 2026-08-21: siehe gleiche Begründung in
  -- abrechnung_korrigieren.
  perform auszahlungsbeleg_zeile_delta_anwenden(p_employee_id, s.auszahlungsbeleg_id, s, neu);

  if v_belegnummer is not null then
    insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
    values ('Verpflegungs-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_grund);
  end if;
end;
$$;

grant execute on function abrechnung_verpflegung_korrigieren(uuid, int, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Historische Abrechnung nachtragen (Nutzer-Vorgabe 2026-08-13): beim
-- App-Start waren bereits Mitarbeiter/Stunden importiert, aber die App
-- kennt keine vor dem App-Start REAL erfolgten Abrechnungen (über das
-- alte Excel-System) - die 15-Wochen-Abschnitts-Erkennung in
-- employee_sv_pruefung erkennt Abschnitte AUSSCHLIESSLICH über
-- saison_abrechnungen-Einträge (siehe Kommentar dort). Ohne Nachtrag
-- rechnet die App fälschlich mit einem einzigen, nie unterbrochenen
-- Abschnitt seit dem ersten importierten Arbeitstag.
--
-- Diese Funktion legt NUR einen solchen "Uhr zurückgesetzt"-Marker an,
-- OHNE Auszahlungsbeleg/season_bonuses/employees.aktiv anzufassen (die
-- Person arbeitet ja aktuell aktiv weiter, und das reale Geld ist bereits
-- über das alte System abgerechnet - keine Doppelbuchung in der App).
-- Bewusst getrennt von saison_abrechnen_batch(), das eine gerade
-- stattfindende, echte Abrechnung abbildet. auszahlungsbeleg_id bleibt
-- NULL - das unterscheidet einen Nachtrag von einer echten
-- App-Abrechnung, siehe saison_abrechnung_nachtrag_entfernen unten.
create or replace function saison_abrechnung_nachtragen(
  p_employee_id uuid,
  p_saison_jahr int,
  p_abgerechnet_am date
)
returns bigint language plpgsql security definer as $$
declare
  neue_id bigint;
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung, eine historische Abrechnung nachzutragen';
  end if;

  insert into saison_abrechnungen (employee_id, saison_jahr, abgerechnet_am, abgerechnet_von)
  values (p_employee_id, p_saison_jahr, p_abgerechnet_am::timestamptz, auth.uid())
  returning id into neue_id;

  return neue_id;
end;
$$;

grant execute on function saison_abrechnung_nachtragen(uuid, int, date) to authenticated;

-- Gegenstück zum Rückgängigmachen eines Nachtrags (z.B. bei Tippfehler) -
-- löscht bewusst NUR Einträge OHNE Auszahlungsbeleg, damit eine echte
-- App-Abrechnung darüber niemals entfernt werden kann.
create or replace function saison_abrechnung_nachtrag_entfernen(p_id bigint)
returns void language plpgsql security definer as $$
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung, einen Abrechnungs-Nachtrag zu entfernen';
  end if;

  delete from saison_abrechnungen
  where id = p_id and auszahlungsbeleg_id is null;

  if not found then
    raise exception 'Eintrag nicht gefunden oder ist eine echte Abrechnung (kann nicht entfernt werden)';
  end if;
end;
$$;

grant execute on function saison_abrechnung_nachtrag_entfernen(bigint) to authenticated;

-- Anreiseliste: Buskosten (Hinfahrt) für einen Kandidaten setzen. Landet in
-- season_bonuses.bus_hin (fließt automatisch in die Lohnübersicht ein), ist
-- dort aber laut season_bonuses_rw nur admin/lohnabrechnung erlaubt - die
-- Anreiseliste braucht das aber auch für hr. Statt season_bonuses generell
-- für hr zu öffnen (die dann auch Akkord/Prämien/Kautionen ändern könnten,
-- was nicht Teil der Anreiseliste-Aufgabe ist), dieser eine kontrollierte
-- Ausnahmeweg - gleiches Muster wie saison_abrechnen_batch oben.
create or replace function kandidat_buskosten_setzen(
  p_kandidat_id uuid,
  p_bus_hin numeric
)
returns void language plpgsql security definer as $$
declare
  v_employee_id uuid;
  v_saison_jahr int;
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung für die Anreiseliste';
  end if;

  select aktivierter_employee_id, coalesce(extract(year from geplante_ankunft)::int, extract(year from current_date)::int)
    into v_employee_id, v_saison_jahr
  from personal_kandidaten
  where id = p_kandidat_id;

  if v_employee_id is null then
    raise exception 'Kandidat hat noch keinen aktivierten Mitarbeiter';
  end if;

  insert into season_bonuses (employee_id, saison_jahr, bus_hin)
  values (v_employee_id, v_saison_jahr, p_bus_hin)
  on conflict (employee_id, saison_jahr)
  do update set bus_hin = excluded.bus_hin;

  update personal_kandidaten set buskosten_erfasst = true where id = p_kandidat_id;
end;
$$;

grant execute on function kandidat_buskosten_setzen(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Statuswechsel im Personalstamm (z.B. sozialversicherungsfrei ->
-- -pflichtig bei Erreichen der 15-Wochen-Grenze): legt eine neue,
-- verknüpfte Personalnummer an (siehe app/mitarbeiter/page.tsx,
-- statuswechselDurchfuehren) und deaktiviert die alte. Diese beiden
-- Funktionen übertragen dabei die Stunden ab dem Stichtag auf die neue
-- Nummer (Nutzer-Vorgabe 2026-08-11): ab dem Stichtag gilt die neue
-- Abrechnungsart, die Stunden müssen deshalb mitwandern, damit sie korrekt
-- abgerechnet werden. Vorschüsse und Prämien bleiben bewusst UNBERÜHRT -
-- sie hängen an der Auszahlung, nicht am Beschäftigungszeitraum.
--
-- Bewusst SECURITY INVOKER (nicht DEFINER wie bei den übrigen
-- "kontrollierten Ausnahmeweg"-Funktionen oben): admin/hr dürfen
-- work_entries ohnehin direkt schreiben, hier geht es nur darum, eine
-- gesperrten-Monat-Prüfung ATOMAR vor der eigentlichen Übertragung zu
-- machen (Nutzer-Entscheidung: Statuswechsel bei gesperrtem Monat komplett
-- verweigern, nicht nur die betroffenen Tage stillschweigend an der alten
-- Nummer stehen lassen). Die bestehende work_entries_update-Policy sperrt
-- Monatsabschluss-gesperrte Monate "ausnahmslos für alle Rollen inkl.
-- admin" - das gilt hier unverändert mit, ein SECURITY DEFINER würde diese
-- Regel aufweichen.
create or replace function statuswechsel_gesperrter_monat(
  p_employee_id uuid,
  p_stichtag date
)
returns text language sql security invoker stable as $$
  select to_char(min(we.datum), 'MM/YYYY')
  from work_entries we
  join periods p
    on p.saison_jahr = extract(year from we.datum)::int
    and p.monat = extract(month from we.datum)::int
  where we.employee_id = p_employee_id
    and we.datum >= p_stichtag
    and p.gesperrt;
$$;

grant execute on function statuswechsel_gesperrter_monat(uuid, date) to authenticated;

create or replace function statuswechsel_stunden_uebertragen(
  p_alt_employee_id uuid,
  p_neu_employee_id uuid,
  p_stichtag date
)
returns int language plpgsql security invoker as $$
declare
  v_gesperrter_monat text;
  v_anzahl int;
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung für Statuswechsel';
  end if;

  -- Erneute Prüfung (nicht nur clientseitig vor dem Anlegen der neuen
  -- Nummer) - verweigert die Übertragung vollständig, statt Stunden in
  -- gesperrten Monaten unbemerkt an der alten Nummer stehen zu lassen.
  v_gesperrter_monat := statuswechsel_gesperrter_monat(p_alt_employee_id, p_stichtag);
  if v_gesperrter_monat is not null then
    raise exception 'Monat % ist bereits per Monatsabschluss gesperrt - bitte zuerst entsperren, bevor der Statuswechsel durchgeführt wird.', v_gesperrter_monat;
  end if;

  update work_entries
  set employee_id = p_neu_employee_id
  where employee_id = p_alt_employee_id
    and datum >= p_stichtag;

  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

grant execute on function statuswechsel_stunden_uebertragen(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Statuswechsel-Kette für die Sozialversicherung-Seite (Nutzer-Vorgabe
-- 2026-08-24): "Unter Sozialversicherung steht immer noch bei diesen
-- beiden inaktiven Personen 'Überschritten seit X Tagen'. Das System muss
-- mitbekommen, dass die Personen ab dem Stichtag SV-Pflichtig sind." Die
-- 105-Tage-Prüfung selbst bleibt unverändert korrekt (die ALTE Nummer HAT
-- die Grenze in ihrem eigenen Zeitraum wirklich überschritten - das ist ja
-- der Grund für den Statuswechsel) - was fehlte, war die sichtbare
-- Verknüpfung "das ist inzwischen erledigt, siehe Nachfolge-Nummer X seit
-- Datum Y". Der Stichtag selbst wird nirgends gespeichert (nur transient
-- im Statuswechsel-Dialog) - hier stattdessen aus dem ersten übertragenen
-- Arbeitstag der neuen Nummer hergeleitet (siehe
-- statuswechsel_stunden_uebertragen oben: verschiebt work_entries ab
-- genau diesem Datum), was in der Praxis exakt dem Stichtag entspricht.
create or replace function abrechnungsart_label(p_abrechnungsart abrechnungsart)
returns text language sql immutable as $$
  select case p_abrechnungsart
    when 'pauschal' then 'PA'
    when 'lohnsteuerklasse_1' then 'StKl 1'
    when 'sozialversicherungspflichtig' then 'SV-Pfl.'
  end;
$$;

create or replace view employee_status_chain as
with eigene_stunden as (
  select employee_id, min(datum) as erster_arbeitstag
  from work_entries
  group by employee_id
)
select
  e.id as employee_id,
  -- Diese Nummer IST eine Nachfolge-Nummer (hat einen Vorgänger) - der
  -- Status davor + das Datum, seit dem der aktuelle Status gilt.
  case when e.vorgaenger_employee_id is not null
    then abrechnungsart_label(v.abrechnungsart)
  end as vorheriger_status,
  case when e.vorgaenger_employee_id is not null
    then es.erster_arbeitstag
  end as aktueller_status_seit,
  -- Diese Nummer HAT eine Nachfolge-Nummer (wurde per Statuswechsel
  -- abgelöst) - deren Status + Startdatum, für die Verknüpfung auf der
  -- alten (jetzt inaktiven) Nummer.
  n.personal_nr as nachfolger_personal_nr,
  case when n.id is not null
    then abrechnungsart_label(n.abrechnungsart)
  end as nachfolger_status,
  case when n.id is not null
    then esn.erster_arbeitstag
  end as nachfolger_seit,
  -- Nutzer-Vorgabe 2026-08-24 (Feinschliff "von ... bis" statt nur "seit"):
  -- eigener Beschäftigungsbeginn dieser Personalnummer - für die
  -- "von...bis"-Anzeige auf einer per Statuswechsel abgelösten (jetzt
  -- inaktiven) Nummer, unabhängig davon, ob sie selbst eine Nachfolge-
  -- Nummer ist.
  es.erster_arbeitstag as eigener_erster_arbeitstag
from employees e
left join employees v on v.id = e.vorgaenger_employee_id
left join employees n on n.vorgaenger_employee_id = e.id
left join eigene_stunden es on es.employee_id = e.id
left join eigene_stunden esn on esn.employee_id = n.id;

-- security_invoker unbedenklich (wie employee_sv_abschnitte): employees
-- und work_entries sind beide bereits für jede angemeldete Rolle lesbar
-- per RLS, keine zusätzlich sensiblen Felder hier (nur IDs/Personalnummer/
-- Abrechnungsart/Datum).
alter view employee_status_chain set (security_invoker = true);
grant select on employee_status_chain to authenticated;

-- Arbeitskleidung: Lagerbestand + Ausgabe-Log (Nutzer-Vorgabe 2026-08-24:
-- "Ich möchte einen Datumsstempel bekommen... die Größen, die ausgegeben
-- wurden... einen Lagerbestand an Arbeitskleidung, der 'lebt'"). Ersetzt
-- das bisherige Modell (eine überschreibbare Gesamtzahl je Person/Saison,
-- ehemals arbeitskleidung_setzen) durch ein Ausgabe-Log - jede Ausgabe ein
-- eigener, zeitgestempelter Eintrag mit Größe, wie bei Vorschüssen per
-- Storno statt Überschreiben korrigierbar - plus einen Anfangsbestand je
-- Typ+Größe. Der aktuelle Lagerbestand wird IMMER live berechnet
-- (Anfangsbestand − Summe aller nicht stornierten Ausgaben), nie als
-- Zwischenstand gespeichert - gleiches Prinzip wie kassenbestand_bis() im
-- Kassenbuch. Weiterhin nur Hose/Jacke/Stiefel (Spargelmesser/Feile/
-- Handschuhe bleiben Verbrauchsgegenstände, siehe season_bonuses oben).

-- Anfangsbestand je Saison/Typ/Größe - von admin/hr zu Saisonbeginn
-- eingetragen (siehe RLS unten - zeiterfassung darf nur lesen). Größen-
-- Listen bewusst fest im Code statt hier konfigurierbar (Nutzer-Vorgabe
-- 2026-08-24) - siehe app/arbeitskleidung/page.tsx.
create table kleidung_lagerbestand (
  saison_jahr int not null,
  typ text not null check (typ in ('Hose', 'Jacke', 'Stiefel')),
  groesse text not null,
  anfangsbestand int not null default 0 check (anfangsbestand >= 0),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  primary key (saison_jahr, typ, groesse)
);

-- Ausgabe-Log - eine Zeile je tatsächlicher Ausgabe (nicht mehr eine
-- überschreibbare Gesamtzahl je Person). storniert statt Löschen, analog
-- zu advances/cash_deposits/kautionsuebergaben.
create table kleidung_ausgaben (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,
  typ text not null check (typ in ('Hose', 'Jacke', 'Stiefel')),
  groesse text not null,
  anzahl int not null check (anzahl > 0),
  datum timestamptz not null default now(),
  bearbeiter_id uuid references profiles (id) default auth.uid(),
  storniert boolean not null default false,
  storno_grund text
);

-- Schreibt die aktuelle Summe (ohne stornierte Ausgaben) je Typ zurück in
-- season_bonuses.kleidung_*_anzahl - dieser Cache bleibt bewusst bestehen
-- und treibt weiterhin unverändert kleidung_betrag in season_summary
-- (siehe dort) sowie employee_auslagen_historie (Suche-Seite), damit an
-- diesen beiden Stellen nichts geändert werden muss. Größen selbst
-- fließen NICHT in die Lohnberechnung ein, nur die Stückzahl. security
-- definer aus demselben Grund wie schon vorher bei arbeitskleidung_setzen:
-- season_bonuses ist für zeiterfassung sonst nicht schreibbar
-- (season_bonuses_rw ist admin/lohnabrechnung-only).
create or replace function arbeitskleidung_bestand_synchronisieren(
  p_employee_id uuid,
  p_saison_jahr int
)
returns void language plpgsql security definer as $$
declare
  v_hose int;
  v_jacke int;
  v_stiefel int;
begin
  select
    coalesce(sum(anzahl) filter (where typ = 'Hose'), 0),
    coalesce(sum(anzahl) filter (where typ = 'Jacke'), 0),
    coalesce(sum(anzahl) filter (where typ = 'Stiefel'), 0)
  into v_hose, v_jacke, v_stiefel
  from kleidung_ausgaben
  where employee_id = p_employee_id
    and saison_jahr = p_saison_jahr
    and not storniert;

  insert into season_bonuses (
    employee_id, saison_jahr,
    kleidung_hose_anzahl, kleidung_jacke_anzahl, kleidung_stiefel_anzahl
  )
  values (p_employee_id, p_saison_jahr, v_hose, v_jacke, v_stiefel)
  on conflict (employee_id, saison_jahr) do update set
    kleidung_hose_anzahl = excluded.kleidung_hose_anzahl,
    kleidung_jacke_anzahl = excluded.kleidung_jacke_anzahl,
    kleidung_stiefel_anzahl = excluded.kleidung_stiefel_anzahl,
    updated_by = auth.uid(),
    updated_at = now();
end;
$$;

-- Bucht eine Ausgabe (Log-Eintrag) und synchronisiert danach den
-- season_bonuses-Cache. Gleiches Rollen-Muster wie vorher bei
-- arbeitskleidung_setzen.
create or replace function arbeitskleidung_ausgabe_buchen(
  p_employee_id uuid,
  p_saison_jahr int,
  p_typ text,
  p_groesse text,
  p_anzahl int
)
returns void language plpgsql security definer as $$
begin
  if current_role_name() not in ('admin', 'hr', 'zeiterfassung') then
    raise exception 'Keine Berechtigung für die Arbeitskleidung-Ausgabe';
  end if;
  if p_anzahl <= 0 then
    raise exception 'Anzahl muss größer als 0 sein';
  end if;
  if p_typ not in ('Hose', 'Jacke', 'Stiefel') then
    raise exception 'Ungültiger Kleidungstyp';
  end if;
  if p_groesse is null or trim(p_groesse) = '' then
    raise exception 'Größe erforderlich';
  end if;

  insert into kleidung_ausgaben (
    employee_id, saison_jahr, typ, groesse, anzahl, bearbeiter_id
  )
  values (
    p_employee_id, p_saison_jahr, p_typ, p_groesse, p_anzahl, auth.uid()
  );

  perform arbeitskleidung_bestand_synchronisieren(p_employee_id, p_saison_jahr);
end;
$$;

grant execute on function arbeitskleidung_ausgabe_buchen(uuid, int, text, text, int) to authenticated;

-- Storniert eine fehlerhaft erfasste Ausgabe (z.B. falsche Größe) -
-- Pflichtgrund wie bei Vorschuss-Storno, synchronisiert danach den Cache
-- neu.
create or replace function arbeitskleidung_ausgabe_stornieren(
  p_ausgabe_id bigint,
  p_grund text
)
returns void language plpgsql security definer as $$
declare
  v_employee_id uuid;
  v_saison_jahr int;
begin
  if current_role_name() not in ('admin', 'hr', 'zeiterfassung') then
    raise exception 'Keine Berechtigung für die Arbeitskleidung-Ausgabe';
  end if;
  if p_grund is null or trim(p_grund) = '' then
    raise exception 'Storno-Grund erforderlich';
  end if;

  select employee_id, saison_jahr into v_employee_id, v_saison_jahr
  from kleidung_ausgaben where id = p_ausgabe_id;

  if not found then
    raise exception 'Ausgabe nicht gefunden';
  end if;

  update kleidung_ausgaben
  set storniert = true, storno_grund = p_grund
  where id = p_ausgabe_id;

  perform arbeitskleidung_bestand_synchronisieren(v_employee_id, v_saison_jahr);
end;
$$;

grant execute on function arbeitskleidung_ausgabe_stornieren(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Verpflegungs-/Wohnen-Sätze (ADR-007: versioniert je Saisonjahr, über
--    die Einstellungen-Seite konfigurierbar, Default 10€/Tag je Kategorie)
-- ---------------------------------------------------------------------------
create table verpflegungssaetze (
  saison_jahr int primary key,
  verpflegung numeric(6, 2) not null default 10.00, -- € pro Anwesenheitstag
  wohnen numeric(6, 2) not null default 10.00,       -- € pro Anwesenheitstag
  -- Gesetzlicher Mindestlohn für dieses Saisonjahr - kein Default (muss
  -- bewusst vom admin eingetragen werden, siehe Einstellungen-Seite).
  -- Dient als Vorbelegung für den Stundenlohn neu angelegter/geplanter
  -- Personen (personal_kandidaten.stundenlohn, employees.stundenlohn beim
  -- direkten Neuanlegen) - bleibt dort weiterhin frei änderbar.
  mindestlohn numeric(6, 2),
  -- Arbeitskleidung-Preise je Stück (Nutzer-Vorgabe 2026-08-09), fest
  -- hinterlegt statt bei jeder Ausgabe neu eingetippt - kein Default,
  -- admin muss sie bewusst setzen (siehe Einstellungen-Seite).
  kleidung_hose numeric(6, 2),
  kleidung_jacke numeric(6, 2),
  kleidung_stiefel numeric(6, 2)
);

insert into verpflegungssaetze (saison_jahr, verpflegung, wohnen)
values (extract(year from current_date)::int, 10.00, 10.00)
on conflict (saison_jahr) do nothing;

-- ---------------------------------------------------------------------------
-- 6a. Prämien (Nutzer-Vorgabe 2026-08-09): neuer Menüpunkt "Prämien" mit
--     Untermenüs Spargel/Erdbeeren/Zuckermais, ersetzt schrittweise die drei
--     separaten Excel-Dateien "Prämien Spargel/Erdbeeren/Zuckermais 2026".
--     Start mit Zuckermais (einfachste Berechnung, kein Fremdsystem, keine
--     offene Frage) - Spargel (Waage-Anbindung, Feld-Stufen) und Erdbeeren
--     (mehrere Wiegungen je Tag) folgen später als eigene Ausbaustufen.
--
--     Zuckermais-Logik (1:1 aus der bisherigen Excel-Datei übernommen):
--     pro Mitarbeiter und Tag werden Kisten und Stunden erfasst. Norm
--     (Kolben/Std.), Kolben je Kiste und €-Satz je Kolben über der Norm
--     ändern sich im Saisonverlauf (siehe Excel: Norm stieg z.B. von 140
--     auf 180 Kolben/Std.) - deshalb eine mit "gültig ab" versionierte
--     Sätze-Tabelle statt eines einzelnen Werts pro Jahr (wie
--     verpflegungssaetze), analog zu ADR-007. Tagesprämie =
--     GREATEST(0, (Kisten × Kolben/Kiste − Stunden × Norm) × Satz/Kolben).
--     Die Saison-Summe fließt direkt (live berechnet, nicht manuell
--     gepflegt) in season_summary.praemien_summe/bruttolohn ein - genau wie
--     die bisherigen (bislang manuell eingetragenen) Felder
--     erdbeer_praemie/spargel_praemie auf season_bonuses. Kein neues
--     Auszahlungsfeld nötig, keine Änderung an der äußersten SELECT-Liste
--     von season_summary (kein 42P16-Risiko), da praemien_summe/bruttolohn
--     bereits bestehende Spalten sind.
-- ---------------------------------------------------------------------------
create table zuckermais_saetze (
  id bigint generated always as identity primary key,
  gueltig_ab date not null unique,
  norm_kolben_pro_stunde numeric(6, 2) not null,
  kolben_pro_kiste numeric(6, 2) not null default 55,
  satz_pro_kolben numeric(6, 4) not null,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now()
);

create table zuckermais_rohdaten (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  datum date not null,
  kisten numeric(8, 2) not null default 0,
  stunden numeric(5, 2) not null default 0,
  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  -- Optimistisches Sperren wie bei work_entries (siehe der Live-Sync-Bug
  -- vom 2026-08-08: dort fehlte diese Absicherung nicht, sondern eine
  -- fehlende RLS-Berechtigung führte zu lautlos fehlgeschlagenen
  -- Speicherversuchen - version schützt zusätzlich vor echten
  -- Wettlaufsituationen bei gleichzeitiger Bearbeitung).
  version int not null default 1,
  unique (employee_id, datum)
);

create index idx_zuckermais_rohdaten_datum on zuckermais_rohdaten (datum);
create index idx_zuckermais_rohdaten_employee on zuckermais_rohdaten (employee_id);

-- Tagesprämie je Erfassung - für Suche (tageweiser Stand) und die
-- druckbare Tagesliste. Verknüpft jede Rohdaten-Zeile per LATERAL mit dem
-- zum jeweiligen Datum gültigen Satz (letzter "gültig ab" <= Datum).
create or replace view zuckermais_praemie_tag as
select
  r.id,
  r.employee_id,
  r.datum,
  r.kisten,
  r.stunden,
  s.norm_kolben_pro_stunde,
  s.kolben_pro_kiste,
  s.satz_pro_kolben,
  r.kisten * s.kolben_pro_kiste as kolben,
  greatest(
    (r.kisten * s.kolben_pro_kiste - r.stunden * coalesce(s.norm_kolben_pro_stunde, 0))
      * coalesce(s.satz_pro_kolben, 0),
    0
  ) as praemie
from zuckermais_rohdaten r
left join lateral (
  select z.norm_kolben_pro_stunde, z.kolben_pro_kiste, z.satz_pro_kolben
  from zuckermais_saetze z
  where z.gueltig_ab <= r.datum
  order by z.gueltig_ab desc
  limit 1
) s on true;

alter view zuckermais_praemie_tag set (security_invoker = true);
grant select on zuckermais_praemie_tag to authenticated;

-- Tagesstatistik über alle Mitarbeiter (Nutzer-Vorgabe 2026-08-09, neuer
-- Menüpunkt "Statistik" - analog zu "Prämien" mit eigenen Untermenüs
-- Spargel/Erdbeeren/Zuckermais, hier erstmal nur Zuckermais).
-- Kosten/Kolben rechnet mit dem für das jeweilige Saisonjahr gepflegten
-- Mindestlohn (verpflegungssaetze.mindestlohn, Einstellungen-Seite) -
-- bewusst NICHT mit dem individuellen employees.stundenlohn, da hier eine
-- grobe Tages-Kennzahl über alle Mitarbeiter gefragt ist, keine
-- personenscharfe Abrechnung. Bis 2026-08-11 stand hier ein fest
-- verdrahteter Wert von 13,90 €, der mit jeder Mindestlohn-Änderung
-- auseinandergelaufen wäre (Nutzer-Vorgabe: "Da ist immer mein gesetzter
-- Wert für Mindestlohn für die Berechnung relevant"). Ist für ein Jahr kein
-- Mindestlohn hinterlegt, bleibt die Kennzahl leer statt mit einem
-- geratenen Wert zu rechnen.
-- Sicherheitsfix 2026-08-12: diese Sicht war bislang security_invoker =
-- true, verpflegungssaetze (Mindestlohn) ist aber per RLS admin-only
-- lesbar - dadurch lief v.mindestlohn für JEDE andere Rolle als admin
-- lautlos auf NULL, kosten_pro_kolben war für hr/lohnabrechnung/
-- management/erntewirtschaft (siehe components/Nav.tsx "Statistik") also
-- immer leer, obwohl die Statistik-Seite gerade für diese Rollen gedacht
-- ist. Jetzt (wie season_summary_monat) mit Eigentümer-Rechten + eigener
-- Rollen-Prüfung statt security_invoker.
create or replace view zuckermais_statistik_tag as
select
  p.datum,
  sum(p.kisten) as summe_kisten,
  sum(p.kolben) as summe_kolben,
  sum(p.stunden) as summe_stunden,
  sum(p.praemie) as summe_praemie,
  case when sum(p.stunden) > 0 then sum(p.kolben) / sum(p.stunden) else null end
    as kolben_pro_stunde,
  case when sum(p.kolben) > 0 and v.mindestlohn is not null
    then (v.mindestlohn * sum(p.stunden) + sum(p.praemie)) / sum(p.kolben)
    else null
  end as kosten_pro_kolben,
  -- "Kulturkosten" (Nutzer-Vorgabe 2026-08-12, ergänzt 2026-08-12): Stunden
  -- aus der ALLGEMEINEN Stundenerfassung (nicht aus den oben verwendeten
  -- Prämien-Stunden) von Mitarbeitern, deren aktuelle Arbeitsgruppe der
  -- Kultur "zuckermais" zugeordnet ist (Einstellungen → Arbeitsgruppen) -
  -- damit zählen z.B. auch Sortierer/Träger mit, die nicht einzeln in der
  -- Prämien-Erfassung stehen. Die Tagesprämien (summe_praemie) fließen mit
  -- ein wie bei kosten_pro_kolben oben - sonst fehlen sie bei Betrachtung
  -- der reinen Gruppenkosten (Nutzer-Hinweis).
  gs.gruppen_stunden,
  case when sum(p.kolben) > 0 and v.mindestlohn is not null and gs.gruppen_stunden is not null
    then (v.mindestlohn * gs.gruppen_stunden + sum(p.praemie)) / sum(p.kolben)
    else null
  end as kosten_pro_kolben_gruppen,
  -- Roher Mindestlohn-Wert mit ausgegeben (Nutzer-Vorgabe 2026-08-12,
  -- Nebeneffekt der Sicherheitsprüfung): das Frontend kann verpflegungssaetze
  -- selbst nicht direkt lesen (admin-only per RLS), braucht den Wert aber
  -- für die client-seitige Saison-Summen-Zeile - vorher stand dort ein fest
  -- verdrahteter Wert von 13,90 €, der ebenfalls veraltet war.
  v.mindestlohn
from zuckermais_praemie_tag p
left join verpflegungssaetze v
  on v.saison_jahr = extract(year from p.datum)::int
left join lateral (
  select sum(we.stunden) as gruppen_stunden
  from work_entries we
  join employees e on e.id = we.employee_id
  join arbeitsgruppen ag on ag.gruppe_nr = e.gruppe_nr
  where ag.kultur = 'zuckermais'
    and we.datum = p.datum
    and we.stunden is not null
) gs on true
where current_role_name() in
  ('admin', 'hr', 'lohnabrechnung', 'management', 'erntewirtschaft')
group by p.datum, v.mindestlohn, gs.gruppen_stunden
order by p.datum desc;

-- Nicht mehr security_invoker (siehe Kommentar oben) - Rollen-Prüfung
-- läuft jetzt über die WHERE-Klausel und entspricht exakt
-- components/Nav.tsx "Statistik".
alter view zuckermais_statistik_tag reset (security_invoker);

grant select on zuckermais_statistik_tag to authenticated;

-- ---------------------------------------------------------------------------
-- 6b. Prämien Erdbeeren (Nutzer-Vorgabe 2026-08-09) - gleiches Grundmuster
--     wie Zuckermais (Strichliste je Mitarbeiter/Tag), aber mit einem
--     wichtigen Unterschied: es wird auf mehreren Parzellen gleichzeitig
--     gepflückt, mit sehr unterschiedlichen Gegebenheiten (Sorte, Alter,
--     Bodenverhältnisse) - Norm (Steigen/Std.) und Bonus (€/Steige über
--     Norm) müssen deshalb JE PARZELLE UND TAG eigenständig einstellbar
--     sein, nicht global wie bei Zuckermais. Dafür eine eigene, einfache
--     Parzellen-Stammdatentabelle (Name, Größe, Sorte, Pflanzenanzahl -
--     "vorerst die notwendigsten Informationen", spätere Ertragsstatistik
--     pro Pflanze/Hektar vorbereitet). "Sut" (Abfall/nicht
--     vermarktungsfähige Ware) wird zusätzlich erfasst, fließt aber NICHT
--     in die Prämienberechnung ein (nur Steigen zählen) - dient der
--     Ertrags-/Kostenstatistik. 1 Steige = 10 Schalen à 500g = 5 kg (fürs
--     spätere Umrechnen in der Statistik).
--
--     Tagesprämie (je Mitarbeiter, Parzelle und Tag) =
--     GREATEST(0, (Steigen − Stunden × Norm) × Bonus/Steige) - gleiches
--     Muster wie Zuckermais, nur mit parzellenspezifischem Satz statt
--     eines einzigen globalen. Fließt genauso live in
--     season_summary.praemien_summe/bruttolohn ein.
--
--     Bewusst NICHT jetzt gebaut (Nutzer-Vorgabe: "das erstmal für den
--     Anfang"): Mitarbeitermonitoring mit Checkbox für schlechte
--     Ernteleistung + Wiederholungs-Warnung - soll später für alle drei
--     Kulturen gemeinsam kommen.
-- ---------------------------------------------------------------------------
create table erdbeeren_parzellen (
  id bigint generated always as identity primary key,
  name text not null unique,
  groesse_ha numeric(6, 2),
  sorte text,
  anzahl_pflanzen int,
  aktiv boolean not null default true,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create table erdbeeren_parzellen_saetze (
  id bigint generated always as identity primary key,
  parzelle_id bigint not null references erdbeeren_parzellen (id) on delete restrict,
  gueltig_ab date not null,
  norm_steigen_pro_stunde numeric(6, 2) not null,
  bonus_pro_steige numeric(6, 4) not null,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  unique (parzelle_id, gueltig_ab)
);

create table erdbeeren_rohdaten (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  parzelle_id bigint not null references erdbeeren_parzellen (id) on delete restrict,
  datum date not null,
  steigen numeric(8, 2) not null default 0,
  stunden numeric(5, 2) not null default 0,
  -- Abfall/nicht vermarktungsfähige Ware - informativ, zählt nicht zur
  -- Prämie.
  sut numeric(8, 2) not null default 0,
  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  unique (employee_id, parzelle_id, datum)
);

create index idx_erdbeeren_rohdaten_datum on erdbeeren_rohdaten (datum);
create index idx_erdbeeren_rohdaten_employee on erdbeeren_rohdaten (employee_id);
create index idx_erdbeeren_rohdaten_parzelle on erdbeeren_rohdaten (parzelle_id);

-- Tagesprämie je Erfassung (Mitarbeiter + Parzelle + Tag) - LATERAL JOIN
-- auf den zu diesem Datum UND dieser Parzelle gültigen Satz (letzter
-- "gültig ab" <= Datum, je Parzelle getrennt).
create or replace view erdbeeren_praemie_tag as
select
  r.id,
  r.employee_id,
  r.parzelle_id,
  p.name as parzelle_name,
  r.datum,
  r.steigen,
  r.stunden,
  r.sut,
  s.norm_steigen_pro_stunde,
  s.bonus_pro_steige,
  greatest(
    (r.steigen - r.stunden * coalesce(s.norm_steigen_pro_stunde, 0))
      * coalesce(s.bonus_pro_steige, 0),
    0
  ) as praemie
from erdbeeren_rohdaten r
join erdbeeren_parzellen p on p.id = r.parzelle_id
left join lateral (
  select z.norm_steigen_pro_stunde, z.bonus_pro_steige
  from erdbeeren_parzellen_saetze z
  where z.parzelle_id = r.parzelle_id
    and z.gueltig_ab <= r.datum
  order by z.gueltig_ab desc
  limit 1
) s on true;

alter view erdbeeren_praemie_tag set (security_invoker = true);
grant select on erdbeeren_praemie_tag to authenticated;

-- Tagesstatistik je Parzelle (Nutzer-Vorgabe: Ertrag/Kosten je Feld sind
-- für den Betrieb wichtig) - Kosten/Steige rechnet wie
-- zuckermais_statistik_tag mit dem gepflegten Mindestlohn des jeweiligen
-- Saisonjahres, nicht mehr mit einem fest verdrahteten Wert.
--
-- Sicherheitsfix 2026-08-12: wie zuckermais_statistik_tag - war
-- security_invoker = true, verpflegungssaetze ist aber admin-only per RLS,
-- kosten_pro_steige war dadurch für hr/lohnabrechnung/management/
-- erntewirtschaft lautlos immer leer. Jetzt mit Eigentümer-Rechten +
-- eigener Rollen-Prüfung (entspricht components/Nav.tsx "Statistik").
create or replace view erdbeeren_statistik_tag as
select
  p.datum,
  p.parzelle_id,
  p.parzelle_name,
  sum(p.steigen) as summe_steigen,
  sum(p.sut) as summe_sut,
  sum(p.stunden) as summe_stunden,
  sum(p.praemie) as summe_praemie,
  case when sum(p.stunden) > 0 then sum(p.steigen) / sum(p.stunden) else null end
    as steigen_pro_stunde,
  case when sum(p.steigen) > 0 and v.mindestlohn is not null
    then (v.mindestlohn * sum(p.stunden) + sum(p.praemie)) / sum(p.steigen)
    else null
  end as kosten_pro_steige,
  -- Roher Mindestlohn-Wert mit ausgegeben - gleicher Grund wie bei
  -- zuckermais_statistik_tag.
  v.mindestlohn
from erdbeeren_praemie_tag p
left join verpflegungssaetze v
  on v.saison_jahr = extract(year from p.datum)::int
where current_role_name() in
  ('admin', 'hr', 'lohnabrechnung', 'management', 'erntewirtschaft')
group by p.datum, p.parzelle_id, p.parzelle_name, v.mindestlohn
order by p.datum desc;

alter view erdbeeren_statistik_tag reset (security_invoker);
grant select on erdbeeren_statistik_tag to authenticated;

-- "Kulturkosten" je Tag (Nutzer-Vorgabe 2026-08-12): Stunden aus der
-- ALLGEMEINEN Stundenerfassung (nicht die Prämien-Stunden oben) von
-- Mitarbeitern, deren aktuelle Arbeitsgruppe der Kultur "erdbeeren"
-- zugeordnet ist (Einstellungen → Arbeitsgruppen), × Mindestlohn PLUS die
-- Tagesprämien (Nutzer-Hinweis: "die fehlen bei der Betrachtung der reinen
-- Gruppenkosten"), umgelegt auf die an diesem Tag geerntete Gesamtmenge
-- (alle Parzellen zusammen - die Stundenerfassung kennt keine einzelne
-- Parzelle, anders als erdbeeren_rohdaten). Bewusst eine EIGENE Sicht statt
-- zusätzlicher Spalten in erdbeeren_statistik_tag: die ist je Parzelle
-- gruppiert, die Gruppen-Stunden sind das aber nicht - eine zusätzliche
-- Spalte dort würde bei mehreren Parzellen am selben Tag denselben Wert
-- mehrfach zeigen und beim Aufsummieren verfälschen. Quelle für Steigen/
-- Prämien ist erdbeeren_praemie_tag (nicht die Rohtabelle direkt), damit
-- die Tagesprämie über alle Parzellen hinweg mitgezählt wird.
-- Spaltenreihenfolge bewusst so belassen (summe_praemie ans ENDE
-- angehängt, nicht vor mindestlohn eingefügt) - CREATE OR REPLACE VIEW
-- erlaubt nur ein Anhängen neuer Spalten, siehe 42P16-Lehre an anderer
-- Stelle im Schema.
create or replace view erdbeeren_gruppenkosten_tag as
select
  d.datum,
  d.summe_steigen,
  v.mindestlohn,
  gs.gruppen_stunden,
  case when d.summe_steigen > 0 and v.mindestlohn is not null and gs.gruppen_stunden is not null
    then (v.mindestlohn * gs.gruppen_stunden + d.summe_praemie) / d.summe_steigen
    else null
  end as kosten_pro_steige_gruppen,
  d.summe_praemie
from (
  select datum, sum(steigen) as summe_steigen, sum(praemie) as summe_praemie
  from erdbeeren_praemie_tag
  group by datum
) d
left join verpflegungssaetze v
  on v.saison_jahr = extract(year from d.datum)::int
left join lateral (
  select sum(we.stunden) as gruppen_stunden
  from work_entries we
  join employees e on e.id = we.employee_id
  join arbeitsgruppen ag on ag.gruppe_nr = e.gruppe_nr
  where ag.kultur = 'erdbeeren'
    and we.datum = d.datum
    and we.stunden is not null
) gs on true
where current_role_name() in
  ('admin', 'hr', 'lohnabrechnung', 'management', 'erntewirtschaft')
order by d.datum desc;

grant select on erdbeeren_gruppenkosten_tag to authenticated;

-- ---------------------------------------------------------------------------
-- 10c. Erdbeeren-ANBAUPLANUNG (Nutzer-Vorgabe 2026-08-11) - löst die
--      gewachsene Excel "Erdbeerpflanzplanung.xlsx" ab.
--
--      Warum diese Struktur: in der Excel ist eine ZEILE mal ein ganzes
--      Feld, mal nur ein Teilstück davon - weil sich unterschiedlich lange
--      Tunnel dort nicht abbilden lassen ("Brücke" steht 3x mit 230/210/138
--      m, "Vogel" 2x, "Dünenfeld" 2x). Spalte "Tunnel" ist dort nur eine
--      ANZAHL; Länge und Reihenzahl gelten pauschal für alle Tunnel der
--      Zeile. Außerdem sind die Sorten SPALTEN (9 Stück, meist 1-2 gefüllt),
--      wodurch jede neue Sorte eine Strukturänderung in allen 14 Jahresblättern
--      bedeutet.
--
--      Hier stattdessen vier Ebenen, wodurch beides verschwindet:
--        Feld (erdbeeren_parzellen)
--         └ Anbau-Jahrgang je Feld+Saison (erdbeeren_anbau)
--            └ Tunnel, einzeln mit eigener Länge/Reihenzahl (erdbeeren_tunnel)
--               └ Bepflanzung je Sorte (erdbeeren_bepflanzung)
--
--      Ein Tunnel hängt am Jahrgang, nicht starr am Feld - ihn auf ein
--      anderes Feld zu verschieben ist damit ein einziger Feldwechsel
--      (Nutzer-Wunsch: Tunnel "in Vorbereitung auf die Cotura" von Feld zu
--      Feld ziehen). Die Cotura-/Folienrollen-Verwaltung selbst kommt in
--      einem zweiten Schritt; bis dahin steht die Rollennummer als Textfeld
--      am Tunnel.
--
--      WICHTIG: das Prämiensystem bleibt davon komplett unberührt
--      (Nutzer-Vorgabe: "nur relevant für die Anbauplanung, aber nicht für
--      das Prämiensystem"). erdbeeren_rohdaten und die Norm-/Bonus-Sätze
--      hängen weiterhin nur an erdbeeren_parzellen - die Erfassung zeigt
--      also unverändert die Feldauswahl.
-- ---------------------------------------------------------------------------
create table erdbeeren_anbau (
  id bigint generated always as identity primary key,
  parzelle_id bigint not null references erdbeeren_parzellen (id) on delete restrict,
  saison_jahr int not null,
  -- Erwartungswerte für die Planung (Nutzer-Auswahl "Erwartung").
  erntefenster_von date,
  erntefenster_bis date,
  ertrag_erwartet_steigen numeric(10, 2),
  rodung_geplant date,
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (parzelle_id, saison_jahr)
);

create index idx_erdbeeren_anbau_saison on erdbeeren_anbau (saison_jahr);

create table erdbeeren_tunnel (
  id bigint generated always as identity primary key,
  anbau_id bigint not null references erdbeeren_anbau (id) on delete cascade,
  -- Freier Text statt Zahl: die Nummerierung vor Ort ist nicht zwingend
  -- lückenlos ("T1", "12a", ...).
  nummer text not null,
  laenge_m numeric(7, 2),
  reihen_anzahl int,
  -- Pflanzen je laufendem Meter - in der Excel Spalte I, dort je Zeile
  -- gepflegt (4,37 im Feld, 8 im Glashaus). Daraus rechnet sich die
  -- Pflanzenzahl: Länge x Reihen x Pflanzen/lfm.
  pflanzen_pro_lfm numeric(6, 2),
  -- Rollennummer der Folie (Cotura). Vorerst nur dokumentierend, das
  -- eigene Folien-Register kommt später.
  cotura_nr text,
  -- Reihenfolge in der Liste = räumliche Anordnung auf dem Feld
  -- (Nutzer-Vorgabe 2026-08-11). Bewusst nicht nach Nummer sortiert: in
  -- der alten Excel sind die Tunnel nach Länge gruppiert, was mit der
  -- tatsächlichen Anordnung nichts zu tun hat. Frei sortierbar per Ziehen
  -- oder Pfeiltasten.
  position int,
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (anbau_id, nummer)
);

create index idx_erdbeeren_tunnel_anbau on erdbeeren_tunnel (anbau_id);

-- Bepflanzung eines Tunnels. Mehrere Zeilen je Tunnel möglich - in einem
-- Tunnel können zwei verschiedene Sorten sitzen (Nutzer-Hinweis). Genau
-- das ist in der Excel nur über eine zusätzliche FELD-Zeile abbildbar.
create table erdbeeren_bepflanzung (
  id bigint generated always as identity primary key,
  tunnel_id bigint not null references erdbeeren_tunnel (id) on delete cascade,
  sorte text not null,
  -- Wie viele der Tunnelreihen diese Sorte belegt. Leer = alle Reihen des
  -- Tunnels (der häufige Fall mit nur einer Sorte).
  reihen_anzahl int,
  pflanzdatum date,
  -- 1 = Neupflanzung, 2/3 = zweites/drittes Standjahr (starker
  -- Ertragseinfluss, deshalb eigenes Feld statt aus dem Pflanzjahr
  -- abgeleitet - Warteboden/Verlängerung passt sonst nicht).
  standjahr int,
  pflanztyp text check (
    pflanztyp is null or pflanztyp in (
      'frigo', 'gruenpflanze', 'topfgruen', 'warteboden', 'sonstiges'
    )
  ),
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create index idx_erdbeeren_bepflanzung_tunnel on erdbeeren_bepflanzung (tunnel_id);

-- Bestellplanung je Saison und Sorte (Nutzer-Vorgabe: "gleich mit").
-- Ersetzt die Handarbeit in den Excel-Zeilen 29-36 (Gesamt / bestellt /
-- selbst / Differenzbedarf / Reserve 15 % / Gesamt inkl. Reserve). Der
-- BEDARF wird nicht hier gespeichert, sondern live aus den Bepflanzungen
-- gerechnet (siehe View erdbeeren_bestellung_uebersicht) - nur die
-- Bestell-/Eigenmengen und der Reserve-Satz sind Eingaben.
create table erdbeeren_bestellung (
  id bigint generated always as identity primary key,
  saison_jahr int not null,
  sorte text not null,
  bestellt_anzahl int,
  -- Eigene Vermehrung/Restbestand, wird vom Bedarf abgezogen.
  eigene_anzahl int,
  reserve_prozent numeric(5, 2) not null default 15,
  lieferant text,
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (saison_jahr, sorte)
);

-- ---------------------------------------------------------------------------
-- Auswertende Sichten für die Anbauplanung
-- ---------------------------------------------------------------------------

-- Je Bepflanzung: laufende Meter und Pflanzenzahl, gerechnet statt getippt.
-- Ersetzt die Excel-Spalten I/J/K/AD/AE und die Kontrollspalte AF (die dort
-- wegen der Kommastellen nie sauber auf 0 aufgeht).
create or replace view erdbeeren_bepflanzung_berechnet as
select
  b.id,
  b.tunnel_id,
  t.anbau_id,
  a.parzelle_id,
  a.saison_jahr,
  p.name as parzelle_name,
  t.nummer as tunnel_nummer,
  t.laenge_m,
  t.cotura_nr,
  b.sorte,
  b.pflanzdatum,
  b.standjahr,
  b.pflanztyp,
  -- Leer gelassene Reihenzahl = alle Reihen des Tunnels.
  coalesce(b.reihen_anzahl, t.reihen_anzahl) as reihen_anzahl,
  (coalesce(t.laenge_m, 0) * coalesce(b.reihen_anzahl, t.reihen_anzahl, 0))
    as laufende_meter,
  round(
    coalesce(t.laenge_m, 0)
    * coalesce(b.reihen_anzahl, t.reihen_anzahl, 0)
    * coalesce(t.pflanzen_pro_lfm, 0)
  )::int as anzahl_pflanzen
from erdbeeren_bepflanzung b
join erdbeeren_tunnel t on t.id = b.tunnel_id
join erdbeeren_anbau a on a.id = t.anbau_id
join erdbeeren_parzellen p on p.id = a.parzelle_id;

-- security_invoker = true: unbedenklich, da alle drei zugrunde liegenden
-- Tabellen (erdbeeren_bepflanzung/_tunnel/_anbau/_parzellen) ohnehin per
-- RLS für jede angemeldete Rolle lesbar sind ("auth.uid() is not null") -
-- kein Unterschied im Ergebnis, silenced nur den Supabase-Security-Advisor-
-- Hinweis "Security Definer View".
alter view erdbeeren_bepflanzung_berechnet set (security_invoker = true);
grant select on erdbeeren_bepflanzung_berechnet to authenticated;

-- Bestellübersicht je Saison und Sorte: Bedarf aus der Planung, dagegen die
-- eingetragenen Bestell-/Eigenmengen. Vollständiger Ersatz für die
-- Excel-Zeilen 29-36.
create or replace view erdbeeren_bestellung_uebersicht as
select
  coalesce(bed.saison_jahr, best.saison_jahr) as saison_jahr,
  coalesce(bed.sorte, best.sorte) as sorte,
  coalesce(bed.bedarf_pflanzen, 0) as bedarf_pflanzen,
  coalesce(best.reserve_prozent, 15) as reserve_prozent,
  round(
    coalesce(bed.bedarf_pflanzen, 0)
    * (1 + coalesce(best.reserve_prozent, 15) / 100.0)
  )::int as bedarf_mit_reserve,
  best.bestellt_anzahl,
  best.eigene_anzahl,
  best.lieferant,
  -- Positiv = es fehlt noch, negativ = zu viel bestellt.
  (
    round(
      coalesce(bed.bedarf_pflanzen, 0)
      * (1 + coalesce(best.reserve_prozent, 15) / 100.0)
    )::int
    - coalesce(best.bestellt_anzahl, 0)
    - coalesce(best.eigene_anzahl, 0)
  ) as differenz
from (
  select saison_jahr, sorte, sum(anzahl_pflanzen)::int as bedarf_pflanzen
  from erdbeeren_bepflanzung_berechnet
  group by saison_jahr, sorte
) bed
full outer join erdbeeren_bestellung best
  on best.saison_jahr = bed.saison_jahr and best.sorte = bed.sorte;

-- security_invoker = true: gleicher Grund wie bei erdbeeren_bepflanzung_berechnet.
alter view erdbeeren_bestellung_uebersicht set (security_invoker = true);
grant select on erdbeeren_bestellung_uebersicht to authenticated;

-- Kennzahlen je Feld und Saison - die Zusammenfassung, die in der Excel
-- über verstreute Summenspalten (K/N/O/P-R/AD/AE) lief.
create or replace view erdbeeren_anbau_uebersicht as
select
  a.id as anbau_id,
  a.parzelle_id,
  p.name as parzelle_name,
  p.groesse_ha,
  a.saison_jahr,
  a.erntefenster_von,
  a.erntefenster_bis,
  a.ertrag_erwartet_steigen,
  a.rodung_geplant,
  a.notiz,
  count(distinct t.id)::int as anzahl_tunnel,
  coalesce(sum(bb.laufende_meter), 0) as laufende_meter,
  coalesce(sum(bb.anzahl_pflanzen), 0)::int as anzahl_pflanzen,
  -- Sorten dieses Feldes als lesbare Aufzählung (statt neun Spalten).
  (
    select string_agg(distinct b2.sorte, ', ' order by b2.sorte)
    from erdbeeren_bepflanzung b2
    join erdbeeren_tunnel t2 on t2.id = b2.tunnel_id
    where t2.anbau_id = a.id
  ) as sorten
from erdbeeren_anbau a
join erdbeeren_parzellen p on p.id = a.parzelle_id
left join erdbeeren_tunnel t on t.anbau_id = a.id
left join erdbeeren_bepflanzung_berechnet bb on bb.tunnel_id = t.id
group by
  a.id, a.parzelle_id, p.name, p.groesse_ha, a.saison_jahr,
  a.erntefenster_von, a.erntefenster_bis, a.ertrag_erwartet_steigen,
  a.rodung_geplant, a.notiz;

-- security_invoker = true: gleicher Grund wie bei erdbeeren_bepflanzung_berechnet.
alter view erdbeeren_anbau_uebersicht set (security_invoker = true);
grant select on erdbeeren_anbau_uebersicht to authenticated;

-- Legt für ein Feld auf einen Schlag mehrere gleichartige Tunnel an
-- (Nutzer-Wunsch "Sammelanlage je Feld") - bei 182 Tunneln wäre einzeln
-- anlegen sonst nicht praktikabel. Vorhandene Nummern werden übersprungen,
-- die Funktion lässt sich also gefahrlos erneut aufrufen.
create or replace function erdbeeren_tunnel_sammelanlage(
  p_anbau_id bigint,
  p_von int,
  p_bis int,
  p_laenge_m numeric,
  p_reihen_anzahl int,
  p_pflanzen_pro_lfm numeric
)
returns int language plpgsql security invoker as $$
declare
  i int;
  angelegt int := 0;
  naechste_position int;
begin
  -- Neue Tunnel hinten anhängen, damit eine bestehende Sortierung erhalten
  -- bleibt.
  select coalesce(max(position), 0) into naechste_position
  from erdbeeren_tunnel where anbau_id = p_anbau_id;

  for i in p_von..p_bis loop
    naechste_position := naechste_position + 1;
    insert into erdbeeren_tunnel (
      anbau_id, nummer, laenge_m, reihen_anzahl, pflanzen_pro_lfm, position
    )
    values (
      p_anbau_id, i::text, p_laenge_m, p_reihen_anzahl, p_pflanzen_pro_lfm,
      naechste_position
    )
    on conflict (anbau_id, nummer) do nothing;
    if found then angelegt := angelegt + 1; end if;
  end loop;
  return angelegt;
end;
$$;

grant execute on function erdbeeren_tunnel_sammelanlage(bigint, int, int, numeric, int, numeric) to authenticated;

-- Setzt die Reihenfolge einer Tunnel-Liste in einem Aufruf: die Position
-- ergibt sich aus der Reihenfolge im übergebenen Array.
-- Bewusst als Funktion statt als upsert vom Client aus: erdbeeren_tunnel
-- hat NOT-NULL-Spalten (anbau_id, nummer), ein upsert mit nur id+position
-- würde deshalb als INSERT scheitern (Vorfall 2026-08-11 - das Ziehen sah
-- so aus, als passiere gar nichts).
create or replace function erdbeeren_tunnel_reihenfolge_setzen(p_ids bigint[])
returns void language sql security invoker as $$
  update erdbeeren_tunnel t
  set position = pos.idx
  from unnest(p_ids) with ordinality as pos(id, idx)
  where t.id = pos.id;
$$;

grant execute on function erdbeeren_tunnel_reihenfolge_setzen(bigint[]) to authenticated;

-- Übernimmt einen kompletten Jahrgang eines Feldes ins Zieljahr (Felder,
-- Tunnel mit Maßen, Bepflanzung ohne Pflanzdatum) - ersetzt das Copy/Paste
-- zwischen den Excel-Blättern, aber ohne die dort entstandenen #REF!-
-- Bezüge. Vorhandene Jahrgänge werden NICHT überschrieben.
create or replace function erdbeeren_anbau_vorjahr_uebernehmen(
  p_saison_jahr int,
  p_quelle_jahr int
)
returns int language plpgsql security invoker as $$
declare
  v_alt record;
  v_neu_anbau_id bigint;
  v_alt_tunnel record;
  v_neu_tunnel_id bigint;
  uebernommen int := 0;
begin
  for v_alt in
    select * from erdbeeren_anbau where saison_jahr = p_quelle_jahr
  loop
    -- Feld schon fürs Zieljahr geplant? Dann unangetastet lassen.
    if exists (
      select 1 from erdbeeren_anbau
      where parzelle_id = v_alt.parzelle_id and saison_jahr = p_saison_jahr
    ) then
      continue;
    end if;

    insert into erdbeeren_anbau (parzelle_id, saison_jahr, notiz)
    values (v_alt.parzelle_id, p_saison_jahr, v_alt.notiz)
    returning id into v_neu_anbau_id;

    for v_alt_tunnel in
      select * from erdbeeren_tunnel where anbau_id = v_alt.id
    loop
      insert into erdbeeren_tunnel (
        anbau_id, nummer, laenge_m, reihen_anzahl, pflanzen_pro_lfm,
        cotura_nr, notiz, position
      )
      values (
        v_neu_anbau_id, v_alt_tunnel.nummer, v_alt_tunnel.laenge_m,
        v_alt_tunnel.reihen_anzahl, v_alt_tunnel.pflanzen_pro_lfm,
        v_alt_tunnel.cotura_nr, v_alt_tunnel.notiz, v_alt_tunnel.position
      )
      returning id into v_neu_tunnel_id;

      -- Bepflanzung mitnehmen, aber OHNE Pflanzdatum und mit erhöhtem
      -- Standjahr: die Fläche steht ein Jahr länger, neu gepflanzt wird
      -- erst durch eine bewusste Eingabe.
      insert into erdbeeren_bepflanzung (
        tunnel_id, sorte, reihen_anzahl, standjahr, pflanztyp
      )
      select
        v_neu_tunnel_id, b.sorte, b.reihen_anzahl,
        case when b.standjahr is not null then b.standjahr + 1 end,
        b.pflanztyp
      from erdbeeren_bepflanzung b
      where b.tunnel_id = v_alt_tunnel.id;
    end loop;

    uebernommen := uebernommen + 1;
  end loop;
  return uebernommen;
end;
$$;

grant execute on function erdbeeren_anbau_vorjahr_uebernehmen(int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Zentrale Belegnummern-Vergabe (ADR-010: atomar, auch bei gleichzeitiger
--    Nutzung durch mehrere Personen - Format wie im Altsystem "MM-JJJJ-###")
-- ---------------------------------------------------------------------------
create table beleg_zaehler (
  monatsschluessel text primary key, -- z.B. '02-2026'
  naechste_nummer int not null default 1
);

-- RLS-Sicherheitshinweis 2026-08-11 (Supabase-Scan "rls_disabled_in_public"):
-- diese Tabelle hatte bis dahin KEINE Row-Level-Security - ohne eigene
-- Policy und ohne RLS wäre sie über die REST-API direkt lesbar/schreibbar
-- gewesen (Supabase gewährt anon/authenticated standardmäßig Tabellen-
-- Grants, RLS ist die einzige Schranke davor). Fix: RLS aktiviert, aber
-- bewusst OHNE jede Policy - damit ist die Tabelle für alle Rollen
-- vollständig gesperrt, außer über die SECURITY-DEFINER-Funktion
-- naechste_belegnummer() weiter unten (läuft mit den Rechten des
-- Funktions-Eigentümers, der als Tabellen-Eigentümer RLS automatisch
-- umgeht - gleiches Muster wie kandidat_buskosten_setzen/
-- saison_abrechnen_batch oben). Das ist auch der einzige vorgesehene
-- Zugriffsweg: die Zähler dürfen nie direkt verändert werden, nur über
-- diese Funktion atomar hochgezählt.
alter table beleg_zaehler enable row level security;

-- security definer + fester search_path (wie bei current_role_name() oben):
-- naechste_belegnummer() wird direkt vom Client per .rpc() aufgerufen
-- (Auszahlungen/Kasse/Vorschuesse-Seite) und muss trotz RLS auf
-- beleg_zaehler funktionieren. Bewusst OHNE eigene Rollenprüfung - die
-- Funktion selbst tut nichts Sensibles (liefert nur die nächste laufende
-- Nummer, ändert keine Beträge/Personendaten), die eigentliche Berechtigung
-- prüft die jeweils aufrufende Seite/Tabellen-Policy beim Einfügen des
-- damit erzeugten Belegs.
create or replace function naechste_belegnummer(prefix_monat text)
returns text language plpgsql security definer set search_path = public as $$
declare
  neue_nr int;
begin
  insert into beleg_zaehler (monatsschluessel, naechste_nummer)
  values (prefix_monat, 2)
  on conflict (monatsschluessel)
  do update set naechste_nummer = beleg_zaehler.naechste_nummer + 1
  returning naechste_nummer - 1 into neue_nr;

  return prefix_monat || '-' || lpad(neue_nr::text, 3, '0');
end;
$$;

grant execute on function naechste_belegnummer(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Vorschüsse (Sheet "Vorschüsse")
--    ADR-011: keine Löschung bestätigter Vorgänge - Storno statt Delete.
-- ---------------------------------------------------------------------------
create table advances (
  id bigint generated always as identity primary key,
  belegnummer text not null unique,
  -- Transaktionszeitpunkt und Kassenbuchdatum getrennt (siehe 5.4)
  datum timestamptz not null default now(),
  datum_kassenbuch date not null default current_date,
  betrag numeric(10, 2) not null check (betrag > 0),
  empfaenger_text text,
  -- Bugfix 2026-08-19: fehlte bisher ohne "default auth.uid()" (anders als
  -- z.B. auszahlungsbelege.erstellt_von) und wurde auch nirgends im
  -- Frontend explizit gesetzt - deshalb zeigte "Anwender" im Kassenbuch bei
  -- JEDEM Vorschuss "—", während Auszahlungen/Kautionsübergaben korrekt
  -- einen Bearbeiter zeigten (siehe app/kasse/page.tsx).
  bearbeiter_id uuid references profiles (id) default auth.uid(),
  begruendung text,
  -- Name der Person (z.B. Gruppenleiter), der das Geld zur Verteilung an
  -- die einzelnen Empfänger übergeben wird - erscheint auf dem separaten
  -- Übergabe-Beleg (siehe Druck auf der Vorschüsse-Seite). Optional wie
  -- Begründung.
  uebergeben_an text,
  zahlungsart text not null, -- z.B. 'BAR', 'BÜ' (Überweisung, Stand 2026-08-14 - vorher 'AZ', das für "Auszahlung" stand und hier verwirrend war), 'N/A' bei art = 'Strafe/Rechnung' (kein Geld fließt, siehe unten)
  storniert boolean not null default false,
  storniert_am timestamptz,
  storniert_von uuid references profiles (id),
  storno_grund text,
  created_at timestamptz not null default now(),
  -- Vorschussart (Nutzer-Vorgabe 2026-08-18): 'Strafe/Rechnung' ist ein
  -- Lohnabzug mit Belegpflicht (Strafzettel/Rechnung als Nachweis, siehe
  -- beleg_storage_path unten) statt einer Geldübergabe - daher zahlungsart
  -- 'N/A' bei diesem Wert, wodurch diese Belege automatisch aus dem
  -- physischen Kassenbestand herausfallen (kasse/dashboard filtern explizit
  -- auf zahlungsart = 'BAR'). Fließt trotzdem wie ein normaler Vorschuss in
  -- season_summary.vorschuss_summe ein (keine art-Einschränkung dort).
  art text not null default 'Vorschuss'
    check (art in ('Vorschuss', 'Strafe/Rechnung')),
  -- Nur bei art = 'Strafe/Rechnung' befüllt - Nachweis-Dokument im privaten
  -- Storage-Bucket "vorschuss-belege" (kein öffentlicher Zugriff, Downloads
  -- laufen über zeitlich begrenzte signierte URLs, wie bei
  -- mitarbeiter-dokumente). Bewusst auf advances selbst (nicht
  -- advance_recipients) - Nutzer-Vorgabe: genau ein Empfänger je
  -- Strafe/Rechnung-Beleg, daher 1:1 zum Beleg statt n:m.
  beleg_dateiname text,
  beleg_storage_path text
);

-- Privater Storage-Bucket für Strafe/Rechnung-Belege - getrennt von
-- "mitarbeiter-dokumente" (dort nur admin/hr), da kasse hier ebenfalls
-- hochladen/lesen darf, aber keinen Zugriff auf die eigentlichen
-- Personaldokumente bekommen soll.
insert into storage.buckets (id, name, public)
values ('vorschuss-belege', 'vorschuss-belege', false)
on conflict (id) do nothing;

-- n:m Verknüpfung, da ein Vorschuss an mehrere Personen gehen kann
create table advance_recipients (
  advance_id bigint not null references advances (id) on delete restrict,
  employee_id uuid not null references employees (id) on delete restrict,
  anteil numeric(10, 2), -- optional: individueller Anteil, sonst gleichmäßig
  -- Bei Zahlungsart "BÜ" (Überweisung) - Nutzer-Vorgabe 2026-08-14: Pflicht,
  -- beim Erfassen aus den Personalstammdaten vorbefüllt, aber änderbar.
  -- Bewusst hier (nicht auf advances) UND als eigener Schnappschuss
  -- gespeichert (nicht live aus employees gelesen) - eine Überweisung kann
  -- an mehrere Personen mit je eigenem Konto gehen, und der Beleg muss
  -- dauerhaft die Kontodaten zeigen, mit denen tatsächlich überwiesen
  -- wurde, auch wenn sich employees.iban später ändert.
  zahlungsempfaenger text,
  iban text,
  bic text,
  primary key (advance_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- 8a. Kassenbewegungen: Log für nachträgliche Korrekturen bereits
--     bestätigter Vorschuss-Beträge (auch nach Abschluss möglich, wie im
--     bisherigen Excel-Workflow) - wer, wann, wie viel Differenz, warum.
--     Beeinflusst den Kassenbestand, da advances.betrag live in die
--     Kassensaldo-Berechnung einfließt.
-- ---------------------------------------------------------------------------
create table kassenbewegungen (
  id bigint generated always as identity primary key,
  zeitstempel timestamptz not null default now(),
  art text not null, -- z.B. 'Vorschuss-Korrektur'
  belegnummer text not null,
  delta numeric(10, 2) not null, -- +/- Änderung des Betrags
  zahlungsart text,
  bearbeiter_id uuid references profiles (id),
  hinweis text
);

-- Korrigiert den Anteil einer Person in einem bereits bestätigten
-- Vorschuss-Beleg, passt advances.betrag entsprechend an und protokolliert
-- die Änderung. security definer + eigene Rollenprüfung, analog zu den
-- anderen kontrollierten Ausnahmewegen in diesem Schema.
create or replace function vorschuss_korrigieren(
  p_advance_id bigint,
  p_employee_id uuid,
  p_neuer_betrag numeric,
  p_hinweis text
)
returns void language plpgsql security definer as $$
declare
  alter_betrag numeric;
  v_belegnummer text;
  v_zahlungsart text;
  v_datum timestamptz;
  v_delta numeric;
begin
  if current_role_name() not in ('admin', 'kasse') then
    raise exception 'Keine Berechtigung für Beleg-Korrektur';
  end if;

  if p_neuer_betrag <= 0 then
    raise exception 'Betrag muss größer als 0 sein';
  end if;

  select ar.anteil into alter_betrag
  from advance_recipients ar
  where ar.advance_id = p_advance_id and ar.employee_id = p_employee_id;

  if not found then
    raise exception 'Empfänger nicht in diesem Beleg gefunden';
  end if;

  select belegnummer, zahlungsart, datum into v_belegnummer, v_zahlungsart, v_datum
  from advances where id = p_advance_id;

  if ist_kassenpruefung_gesperrt(v_datum) then
    raise exception 'Dieser Beleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  v_delta := p_neuer_betrag - coalesce(alter_betrag, 0);

  update advance_recipients
  set anteil = p_neuer_betrag
  where advance_id = p_advance_id and employee_id = p_employee_id;

  update advances
  set betrag = (
    select coalesce(sum(anteil), 0)
    from advance_recipients
    where advance_id = p_advance_id
  )
  where id = p_advance_id;

  insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
  values ('Vorschuss-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_hinweis);
end;
$$;

grant execute on function vorschuss_korrigieren(bigint, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Kassenbuch: Einzahlungen (Sheet "Einzahlungen")
-- ---------------------------------------------------------------------------
create table cash_deposits (
  id bigint generated always as identity primary key,
  belegnummer text not null unique,
  datum timestamptz not null default now(),
  datum_kassenbuch date not null default current_date,
  betrag numeric(10, 2) not null check (betrag > 0),
  verwendungszweck text,
  -- Gleicher Bugfix wie bei advances.bearbeiter_id (2026-08-19) - fehlte
  -- ohne "default auth.uid()" und wurde nirgends explizit gesetzt.
  -- Aktuell im Kassenbuch nicht angezeigt (Einzahlungen-Tabelle hat noch
  -- keine Anwender-Spalte), aber die Daten sollen ab jetzt korrekt
  -- erfasst werden.
  bearbeiter_id uuid references profiles (id) default auth.uid(),
  storniert boolean not null default false,
  storniert_am timestamptz,
  storniert_von uuid references profiles (id),
  storno_grund text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 10. Kassenprüfung (Sheet "Kassenprüfung")
--     Toleranz konfigurierbar (Altsystem: 50,00 EUR), Freigabe macht den
--     Datensatz schreibgeschützt; Wiederöffnen nur mit Begründung.
-- ---------------------------------------------------------------------------
create table kassenpruefung_einstellungen (
  id int primary key default 1 check (id = 1),
  toleranz_euro numeric(10, 2) not null default 50.00
);
insert into kassenpruefung_einstellungen (id, toleranz_euro) values (1, 50.00)
  on conflict do nothing;

create table cash_checks (
  id bigint generated always as identity primary key,
  check_zeit timestamptz not null default now(),
  period_from timestamptz not null,
  period_to timestamptz not null,
  opening numeric(10, 2) not null default 0,
  summe_vorschuesse numeric(10, 2) not null default 0,
  einzahlungen numeric(10, 2) not null default 0,
  soll numeric(10, 2) not null default 0,
  ist numeric(10, 2) not null,
  differenz numeric(10, 2) not null,
  innerhalb_toleranz boolean not null,
  status text not null default 'Entwurf', -- Entwurf | Bestanden | Kassendifferenz | Freigegeben
  geprueft_von uuid references profiles (id),
  freigegeben boolean not null default false,
  freigegeben_von uuid references profiles (id),
  freigegeben_am timestamptz,
  wiedereroeffnet_von uuid references profiles (id),
  wiedereroeffnet_am timestamptz,
  wiedereroeffnung_grund text
);

-- Kassenbestand zu einem beliebigen Zeitpunkt (Nutzer-Vorgabe 2026-08-24:
-- "Journal mit laufendem Saldo" für das Kassenbuch, wie ein echtes
-- Kassenbuch mit Jahres-Eröffnungssaldo). Dieselbe Formel wie bisher
-- clientseitig in app/kasse/page.tsx (Einzahlungen − Bar-Vorschüsse −
-- Bar-Auszahlungen − Kautionsübergaben, jeweils ohne stornierte Belege),
-- aber als echtes SQL SUM() ohne Zeilenlimit - die bisherige clientseitige
-- Berechnung lud dafür nur die letzten 100-200 Belege je Tabelle
-- (`.limit(100)`/`.limit(200)`), was bei mehr Belegen über mehrere Saisons
-- hinweg zu einem stillschweigend falschen Saldo geführt hätte. p_bis
-- default now() liefert den aktuellen Kassensaldo, ein früherer Zeitpunkt
-- den Eröffnungssaldo eines beliebigen Zeitraums (z.B. 1. Januar für den
-- Jahres-Eröffnungssaldo im Journal). security invoker (keine erhöhten
-- Rechte nötig) - die aufrufenden Rollen dürfen alle vier Quellen ohnehin
-- direkt lesen.
create or replace function kassenbestand_bis(p_bis timestamptz default now())
returns numeric language sql stable as $$
  select
    coalesce((
      select sum(betrag) from cash_deposits
      where not storniert and datum < p_bis
    ), 0)
    - coalesce((
      select sum(betrag) from advances
      where not storniert and zahlungsart = 'BAR' and datum < p_bis
    ), 0)
    - coalesce((
      select sum(summe_auszahlungsbetrag) from auszahlungsbeleg_summary
      where zahlungsart = 'BAR' and erstellt_am < p_bis
    ), 0)
    - coalesce((
      select sum(betrag_summe) from kautionsuebergaben
      where not storniert and erstellt_am < p_bis
    ), 0);
$$;

grant execute on function kassenbestand_bis(timestamptz) to authenticated;

-- Prüft, ob ein Datum in den Zeitraum einer bereits freigegebenen
-- Kassenprüfung fällt (period_from/period_to) - genutzt, um Belege
-- (Vorschüsse, Einzahlungen, Vorschuss-Korrekturen), die bereits geprüft
-- und freigegeben wurden, vor nachträglicher Änderung zu sperren (analog
-- zu periods.gesperrt beim Monatsabschluss). Erst eine Wiedereröffnung
-- der betroffenen Kassenprüfung (nur admin/pruefer, siehe cash_checks_update)
-- hebt die Sperre für diesen Zeitraum wieder auf.
create or replace function ist_kassenpruefung_gesperrt(p_datum timestamptz)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from cash_checks
    where freigegeben = true
      and p_datum >= period_from
      and p_datum <= period_to
  );
$$;

-- Prüft, ob eine Person für die Saison, in die das übergebene Datum fällt,
-- bereits abgerechnet ist ("Jetzt Abrechnen" auf der Lohnübersicht) -
-- sperrt damit rückwirkende Änderungen an Prämien-Rohdaten (Zuckermais/
-- Erdbeeren, später Spargel) für bereits ausgezahlte Personen (Nutzer-
-- Vorgabe 2026-08-09: "ein Wert, der eine abgeschlossene Auszahlung
-- betrifft, sollte nicht mehr abgeändert werden dürfen"). security
-- definer, da season_bonuses selbst nur für admin/lohnabrechnung lesbar
-- ist (season_bonuses_rw) - zeiterfassung/erntewirtschaft dürfen Prämien
-- erfassen, aber nicht direkt in season_bonuses schauen; ohne security
-- definer würde die Prüfung für sie immer "nicht abgerechnet" ergeben,
-- unabhängig vom echten Status.
create or replace function ist_saison_abgerechnet(p_employee_id uuid, p_datum date)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from season_bonuses b
    where b.employee_id = p_employee_id
      and b.saison_jahr = extract(year from p_datum)::int
      and b.abgerechnet_am is not null
  );
$$;

-- ---------------------------------------------------------------------------
-- 11. Append-only Audit-Log (ADR-005) - erfasst alle relevanten Änderungen
--     an Personal, Stunden, Vorschüssen und Kassenbuch.
-- ---------------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references profiles (id),
  entity text not null,       -- z.B. 'employees', 'advances', 'work_entries'
  entity_id text not null,
  action text not null,       -- 'insert' | 'update' | 'storno' | 'reopen'
  before_data jsonb,
  after_data jsonb
);

create or replace function write_audit_log()
returns trigger language plpgsql security definer as $$
begin
  insert into audit_log (actor_id, entity, entity_id, action, before_data, after_data)
  values (
    auth.uid(),
    TG_TABLE_NAME,
    coalesce(new.id, old.id)::text,
    lower(TG_OP),
    case when TG_OP <> 'INSERT' then to_jsonb(old) end,
    case when TG_OP <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_audit_employees
  after insert or update on employees
  for each row execute function write_audit_log();
create trigger trg_audit_work_entries
  after insert or update on work_entries
  for each row execute function write_audit_log();
-- Prämien-Rohdaten fließen direkt (live) in die Lohnberechnung ein - wie
-- work_entries daher ebenfalls protokolliert. Hier zusätzlich "delete":
-- anders als bei Stunden/Vorschüssen wird hier tatsächlich gelöscht (ein
-- geleertes bzw. auf 0 gesetztes Feld entfernt den Eintrag, siehe "Alle
-- speichern" auf den Prämien-Seiten) - ohne delete-Trigger verschwände
-- eine lohnrelevante Änderung spurlos aus dem Protokoll.
create trigger trg_audit_zuckermais_rohdaten
  after insert or update or delete on zuckermais_rohdaten
  for each row execute function write_audit_log();
create trigger trg_audit_erdbeeren_rohdaten
  after insert or update or delete on erdbeeren_rohdaten
  for each row execute function write_audit_log();
create trigger trg_audit_advances
  after insert or update on advances
  for each row execute function write_audit_log();
create trigger trg_audit_cash_deposits
  after insert or update on cash_deposits
  for each row execute function write_audit_log();
create trigger trg_audit_cash_checks
  after insert or update on cash_checks
  for each row execute function write_audit_log();
-- Arbeitskleidung-Ausgabe (Nutzer-Vorgabe 2026-08-24): treibt einen
-- Lohnabzug (kleidung_betrag), deshalb wie advances/cash_deposits
-- protokolliert. kleidung_lagerbestand (nur eine Planungszahl) bewusst
-- nicht protokolliert.
create trigger trg_audit_kleidung_ausgaben
  after insert or update on kleidung_ausgaben
  for each row execute function write_audit_log();
-- Dokumente: auch "delete" mitloggen, da hier (anders als sonst) echtes
-- Löschen möglich ist (z.B. versehentlich falsche Datei hochgeladen).
create trigger trg_audit_employee_documents
  after insert or update or delete on employee_documents
  for each row execute function write_audit_log();
-- Monatsabschluss (Sperren/Wiederöffnen) - vollständige Historie im
-- Audit-Log, zusätzlich zum Pflichtgrund direkt in periods.entsperrt_grund.
create trigger trg_audit_periods
  after insert or update on periods
  for each row execute function write_audit_log();
-- Personalplanung: Anlage/Änderung/Stornierung/Aktivierung eines
-- Kandidaten mitloggen (enthält u.a. Geburtsdatum/Staatsangehörigkeit,
-- daher wie employees behandelt).
create trigger trg_audit_personal_kandidaten
  after insert or update on personal_kandidaten
  for each row execute function write_audit_log();

-- ---------------------------------------------------------------------------
-- Aufbereitete Sicht auf das Audit-Log für die Seite "Änderungsprotokoll"
-- (Nutzer-Vorgabe 2026-08-11). Zwei Dinge, die die Rohtabelle nicht liefert:
--
--   1. actor_name statt nur actor_id - sonst steht dort eine UUID.
--   2. betroffene_employee_id: einheitlicher Personenbezug über ALLE
--      Bereiche. Bei 'employees' ist die entity_id selbst schon die
--      Personen-ID, bei Stunden/Vorschüssen/Prämien steckt sie dagegen im
--      Datensatz (employee_id). Erst damit lässt sich das Protokoll nach
--      einer Person filtern.
--
-- security_invoker = true: die Einträge enthalten ganze Datensätze und
-- damit auch sensible Felder (IBAN, SV-Nr. bei employees) - die Sicht
-- läuft deshalb mit den Rechten des aufrufenden Nutzers, sodass die
-- bestehende audit_log-Policy (admin/pruefer) unverändert greift. Die
-- Detailansicht in der App ist zusätzlich auf admin beschränkt.
-- ---------------------------------------------------------------------------
create or replace view audit_log_ansicht as
select
  a.id,
  a.occurred_at,
  a.actor_id,
  p.full_name as actor_name,
  a.entity,
  a.entity_id,
  a.action,
  a.before_data,
  a.after_data,
  case
    when a.entity = 'employees' then a.entity_id
    else coalesce(a.after_data, a.before_data) ->> 'employee_id'
  end as betroffene_employee_id
from audit_log a
left join profile_namen p on p.id = a.actor_id;

alter view audit_log_ansicht set (security_invoker = true);
grant select on audit_log_ansicht to authenticated;

-- Letzte Änderung am STAMMDATENSATZ je Mitarbeiter ("wann hat welcher
-- Nutzer diese Person zuletzt bearbeitet") - für die Spalte auf der
-- Personal-Seite. Bewusst nur entity = 'employees': Änderungen an Stunden
-- oder Vorschüssen der Person sind etwas anderes und stehen im vollen
-- Protokoll.
create or replace view employee_letzte_aenderung as
select distinct on (a.entity_id)
  a.entity_id as employee_id,
  a.occurred_at,
  a.actor_id,
  p.full_name as actor_name,
  a.action
from audit_log a
left join profile_namen p on p.id = a.actor_id
where a.entity = 'employees'
order by a.entity_id, a.occurred_at desc;

alter view employee_letzte_aenderung set (security_invoker = true);
grant select on employee_letzte_aenderung to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: updated_at + version automatisch pflegen (optimistische Sperre)
-- ---------------------------------------------------------------------------
create or replace function set_updated_at_and_version()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

-- Schlanke Variante für Tabellen OHNE optimistische Sperre (keine
-- version-Spalte) - z.B. die Anbauplanung, die typischerweise eine Person
-- pflegt und wo ein Versionskonflikt nur stören würde.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_employees_updated_at before update on employees
  for each row execute function set_updated_at_and_version();
create trigger trg_work_entries_updated_at before update on work_entries
  for each row execute function set_updated_at_and_version();
create trigger trg_zuckermais_rohdaten_updated_at before update on zuckermais_rohdaten
  for each row execute function set_updated_at_and_version();
create trigger trg_erdbeeren_rohdaten_updated_at before update on erdbeeren_rohdaten
  for each row execute function set_updated_at_and_version();
create trigger trg_erdbeeren_anbau_updated_at before update on erdbeeren_anbau
  for each row execute function set_updated_at();
create trigger trg_erdbeeren_tunnel_updated_at before update on erdbeeren_tunnel
  for each row execute function set_updated_at();
create trigger trg_erdbeeren_bepflanzung_updated_at before update on erdbeeren_bepflanzung
  for each row execute function set_updated_at();
create trigger trg_erdbeeren_bestellung_updated_at before update on erdbeeren_bestellung
  for each row execute function set_updated_at();
create trigger trg_personal_kandidaten_updated_at before update on personal_kandidaten
  for each row execute function set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- 12a. View: erster erfasster Arbeitstag je Mitarbeiter ("Aktiv seit" auf
--      der Personal-Seite) - erster Tag mit Stunden > 0, unabhängig vom
--      Saisonjahr.
--
--      Korrektur 2026-08-14 (Nutzer: "Die verschiedenen Abschnitte müssen
--      transparent benannt und gerechnet werden"): folgte bisher NICHT der
--      vorgaenger_employee_id-Kette (Statuswechsel) - bei einer Person mit
--      neuer Personalnummer nach Statuswechsel zeigte "Aktiv seit" den
--      Stichtag des Wechsels, nicht den tatsächlichen, oft viel früheren
--      echten Beschäftigungsbeginn. "Aktiv seit" ist eine Eigenschaft der
--      PERSON, nicht der einzelnen Personalnummer - jetzt über eine
--      rekursive Abfrage auf die gesamte Vorgänger-Kette bezogen. Jede
--      Personalnummer derselben Kette (alt und neu) zeigt danach denselben
--      Wert: den frühesten Arbeitstag über die gesamte Kette hinweg.
create or replace view employee_erster_arbeitstag as
with recursive kette as (
  -- Wurzel: Personen ohne Vorgänger sind ihre eigene Kette.
  select id as employee_id, id as wurzel_id
  from employees
  where vorgaenger_employee_id is null
  union all
  -- Jede Nachfolge-Personalnummer erbt die Wurzel ihres Vorgängers.
  select e.id as employee_id, k.wurzel_id
  from employees e
  join kette k on k.employee_id = e.vorgaenger_employee_id
),
je_wurzel as (
  select k.wurzel_id, min(we.datum) as erster_arbeitstag
  from kette k
  join work_entries we on we.employee_id = k.employee_id
  where we.stunden > 0
  group by k.wurzel_id
)
select k.employee_id, jw.erster_arbeitstag
from kette k
join je_wurzel jw on jw.wurzel_id = k.wurzel_id;

alter view employee_erster_arbeitstag set (security_invoker = true);
grant select on employee_erster_arbeitstag to authenticated;

-- ---------------------------------------------------------------------------
-- 12b. View: Saison-Summen je Mitarbeiter (ersetzt die Kernkennzahlen aus
--     Sheet "Summen"). ACHTUNG: erster Entwurf, vor Live-Auszahlungen gegen
--     die bestehende Excel-Datei verifizieren (siehe Open Issue OI-009).
--     Pauschale Lohnsteuer (5,275% vom Bruttolohn) nur bei
--     abrechnungsart = 'pauschal' - Satz ebenfalls ungeprüft, siehe OI-009.
--     Zwei Zwischenwerte, wie im bisherigen Excel-Workflow üblich:
--       netto              = Bruttolohn - Lohnsteuer
--       auszahlungsbetrag  = netto - Verpflegung - Unterkunft - Vorschüsse
--                            - Buskosten - Kautionen - Arbeitskleidung
--     Buskosten (bus_hin/bus_rueck): vorfinanzierte Heimreise, wird wie ein
--     Vorschuss abgezogen, aber separat ausgewiesen ("damit es zu keinen
--     Missverständnissen kommen kann"). Arbeitskleidung (Hose/Jacke/
--     Stiefel, Nutzer-Vorgabe 2026-08-09) genauso: Anzahl × fester Satz aus
--     verpflegungssaetze, ebenfalls separat ausgewiesen.
--     WICHTIG: die äußerste SELECT-Liste hier ist bewusst explizit
--     ausgeschrieben statt "steuer.*" zu nutzen, damit neue Spalten (wie
--     kleidung_betrag) garantiert ans Ende angehängt werden und nicht die
--     Position bestehender Spalten verschieben - siehe Kommentar bei
--     sv_fragebogen_auswertung weiter oben zum Grund (Fehler 42P16).
-- ---------------------------------------------------------------------------
create or replace view season_summary as
with base as (
  select
    e.id as employee_id,
    e.personal_nr,
    e.name,
    e.vorname,
    e.gruppe_nr,
    e.abrechnungsart,
    e.aktiv,
    we.saison_jahr,
    we.gesamt_stunden,
    we.anwesenheitstage,
    coalesce(b.akkord_betrag, 0)
      + coalesce(b.praemie_ausgleich, 0)
      + coalesce(b.fahrer_zulage, 0)
      + coalesce(b.erdbeer_praemie, 0)
      + coalesce(b.spargel_praemie, 0)
      + coalesce(zm.zuckermais_praemie_summe, 0)
      + coalesce(eb.erdbeeren_praemie_summe, 0) as praemien_summe,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0)) as basis_brutto,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0))
      + coalesce(b.akkord_betrag, 0)
      + coalesce(b.praemie_ausgleich, 0)
      + coalesce(b.fahrer_zulage, 0)
      + coalesce(b.erdbeer_praemie, 0)
      + coalesce(b.spargel_praemie, 0)
      + coalesce(zm.zuckermais_praemie_summe, 0)
      + coalesce(eb.erdbeeren_praemie_summe, 0)
      -- Nutzer-Vorgabe 2026-08-20: verhält sich wie eine Prämie (fließt in
      -- Bruttolohn ein, normal lohnsteuerpflichtig), erscheint aber als
      -- eigene Spalte statt in praemien_summe eingerechnet zu werden.
      + coalesce(b.stundenkonto_auszahlung_betrag, 0) as bruttolohn,
    coalesce(b.stundenkonto_auszahlung_betrag, 0) as stundenkonto_auszahlung_betrag,
    b.netto_extern,
    b.abgerechnet_am,
    b.snapshot,
    b.auszahlungsbeleg_id,
    coalesce(b.bus_hin, 0) + coalesce(b.bus_rueck, 0) as bus_kosten,
    coalesce(b.fahrer_kaution, 0) as fahrer_kaution,
    coalesce(b.zimmer_kaution, 0) as zimmer_kaution,
    coalesce(b.verpflegungsfreie_tage, 0) as verpflegungsfreie_tage,
    -- Nutzer-Vorgabe 2026-08-19 (Kantine noch nicht offen): reduziert NUR
    -- den Verpflegungsabzug, nicht die Anwesenheitstage selbst (die bleiben
    -- unverändert, siehe we.anwesenheitstage) und nicht die Unterkunft.
    coalesce(v.verpflegung, 0)
      * greatest(0, we.anwesenheitstage - coalesce(b.verpflegungsfreie_tage, 0))
      as abzug_verpflegung,
    coalesce(v.wohnen, 0) * we.anwesenheitstage as abzug_wohnen,
    coalesce((
      select sum(coalesce(ar.anteil, a.betrag / greatest(cnt.n, 1)))
      from advance_recipients ar
      join advances a on a.id = ar.advance_id
      join (
        select advance_id, count(*) n from advance_recipients group by advance_id
      ) cnt on cnt.advance_id = ar.advance_id
      where ar.employee_id = e.id
        and a.storniert = false
        and extract(year from a.datum) = we.saison_jahr
    ), 0) as vorschuss_summe,
    coalesce(b.kleidung_hose_anzahl, 0) * coalesce(v.kleidung_hose, 0)
      + coalesce(b.kleidung_jacke_anzahl, 0) * coalesce(v.kleidung_jacke, 0)
      + coalesce(b.kleidung_stiefel_anzahl, 0) * coalesce(v.kleidung_stiefel, 0)
      as kleidung_betrag
  from employees e
  join lateral (
    select
      extract(year from we2.datum)::int as saison_jahr,
      sum(coalesce(we2.stunden, 0) + (case when we2.markierung = 'U' then 8 else 0 end)) as gesamt_stunden,
      -- Kein Eintrag = kein Abzug. Eine eingetragene "0" bedeutet: Person war
      -- anwesend, hat aber nicht gearbeitet - zählt trotzdem als
      -- Anwesenheitstag (Verpflegung/Unterkunft werden abgezogen).
      count(*) filter (where we2.stunden is not null or we2.markierung is not null) as anwesenheitstage
    from work_entries we2
    where we2.employee_id = e.id
    group by extract(year from we2.datum)
  ) we on true
  left join season_bonuses b on b.employee_id = e.id and b.saison_jahr = we.saison_jahr
  left join verpflegungssaetze v on v.saison_jahr = we.saison_jahr
  left join lateral (
    select sum(pt.praemie) as zuckermais_praemie_summe
    from zuckermais_praemie_tag pt
    where pt.employee_id = e.id
      and extract(year from pt.datum) = we.saison_jahr
  ) zm on true
  left join lateral (
    select sum(ept.praemie) as erdbeeren_praemie_summe
    from erdbeeren_praemie_tag ept
    where ept.employee_id = e.id
      and extract(year from ept.datum) = we.saison_jahr
  ) eb on true
),
steuer as (
  select
    base.*,
    -- Nur bei 'pauschal' rechnet die App die Lohnsteuer selbst (fester
    -- Satz). Bei den anderen beiden Abrechnungsarten ist das gesetzlich
    -- nicht ohne echtes Lohnprogramm möglich - dort wird lohnsteuer_pauschal
    -- nicht befüllt, siehe netto_extern.
    case when abrechnungsart = 'pauschal'
      then round(bruttolohn * 0.05275, 2)
      else 0
    end as lohnsteuer_pauschal,
    case when abrechnungsart = 'pauschal'
      then bruttolohn - round(bruttolohn * 0.05275, 2)
      else netto_extern
    end as netto
  from base
)
select
  steuer.employee_id,
  steuer.personal_nr,
  steuer.name,
  steuer.vorname,
  steuer.gruppe_nr,
  steuer.abrechnungsart,
  steuer.aktiv,
  steuer.saison_jahr,
  steuer.gesamt_stunden,
  steuer.anwesenheitstage,
  steuer.praemien_summe,
  steuer.basis_brutto,
  steuer.bruttolohn,
  steuer.netto_extern,
  steuer.abgerechnet_am,
  steuer.snapshot,
  steuer.auszahlungsbeleg_id,
  steuer.bus_kosten,
  steuer.fahrer_kaution,
  steuer.zimmer_kaution,
  steuer.abzug_verpflegung,
  steuer.abzug_wohnen,
  steuer.vorschuss_summe,
  steuer.lohnsteuer_pauschal,
  steuer.netto,
  -- NULL, solange bei nicht-pauschalen Abrechnungsarten noch kein
  -- netto_extern eingetragen wurde - bewusst kein Platzhalterwert.
  steuer.netto - steuer.abzug_verpflegung - steuer.abzug_wohnen
    - steuer.vorschuss_summe - steuer.bus_kosten - steuer.fahrer_kaution
    - steuer.zimmer_kaution - steuer.kleidung_betrag
    as auszahlungsbetrag,
  steuer.kleidung_betrag,
  steuer.verpflegungsfreie_tage,
  steuer.stundenkonto_auszahlung_betrag
from steuer
-- Sicherheitsfix 2026-08-12 (Supabase-Advisor "Security Definer View"):
-- diese Sicht liest bewusst mit den Rechten des Eigentümers (u.a.
-- season_bonuses, das per RLS auf admin/lohnabrechnung beschränkt ist),
-- damit auch kasse/pruefer/management die Lohnübersicht vollständig sehen
-- können. Ohne diese WHERE-Zeile wäre die Sicht aber für JEDE angemeldete
-- Rolle per REST-API abrufbar gewesen - auch zeiterfassung/erntewirtschaft,
-- die "Lohn" im Menü (components/Nav.tsx) nie zu sehen bekommen. Die
-- Rollenliste hier spiegelt exakt die Nav-Berechtigung für "/uebersicht".
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management');

grant select on season_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 12b2. View: Monats-Stunden/-Brutto/-Verpflegung je Mitarbeiter, für den
--       Monatsfilter auf der Lohnübersicht (Monatsabschluss-Kontrolle).
--       Bewusst getrennt von season_summary (bleibt unverändert Saison-
--       Basis für "Jetzt Abrechnen"): Akkord-/Prämien-/Fahrer-/Erdbeer-/
--       Spargel-Beträge werden weiterhin nur EINMAL PRO SAISON erfasst
--       (nicht pro Monat), fließen deshalb hier bewusst NICHT ein -
--       basis_brutto ist nur Stunden × Stundenlohn für den Monat. Nur
--       Zeilen mit mindestens einem Eintrag in dem Monat (kein
--       generate_series über alle denkbaren Monate) - Personen ganz ohne
--       Eintrag im Monat werden im Frontend separat über die volle
--       Mitarbeiterliste erkannt.
-- ---------------------------------------------------------------------------
create or replace view season_summary_monat as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.gruppe_nr,
  e.aktiv,
  extract(year from we.datum)::int as saison_jahr,
  extract(month from we.datum)::int as monat,
  sum(coalesce(we.stunden, 0) + (case when we.markierung = 'U' then 8 else 0 end)) as gesamt_stunden,
  count(*) filter (where we.stunden is not null or we.markierung is not null) as anwesenheitstage,
  max(we.datum) filter (where we.stunden is not null or we.markierung is not null) as letzter_eintrag,
  (sum(coalesce(we.stunden, 0) + (case when we.markierung = 'U' then 8 else 0 end))
    * coalesce(e.stundenlohn, 0)) as basis_brutto,
  coalesce(v.verpflegung, 0)
    * count(*) filter (where we.stunden is not null or we.markierung is not null)
    as abzug_verpflegung,
  coalesce(v.wohnen, 0)
    * count(*) filter (where we.stunden is not null or we.markierung is not null)
    as abzug_wohnen
from employees e
join work_entries we on we.employee_id = e.id
left join verpflegungssaetze v on v.saison_jahr = extract(year from we.datum)::int
-- Sicherheitsfix 2026-08-12 (Supabase-Advisor "Security Definer View"):
-- gleicher Grund wie bei season_summary - verpflegungssaetze ist per RLS
-- admin-only, diese Sicht braucht die Eigentümer-Rechte dafür, darf aber
-- nicht an zeiterfassung/erntewirtschaft durchgereicht werden.
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management')
group by
  e.id, e.personal_nr, e.name, e.vorname, e.gruppe_nr, e.aktiv,
  extract(year from we.datum), extract(month from we.datum),
  v.verpflegung, v.wohnen;

grant select on season_summary_monat to authenticated;

-- ---------------------------------------------------------------------------
-- 12c. View: letztes bekanntes Abrechnungsdatum je Mitarbeiter, für die
--      Personal-Seite ("Zuletzt abgerechnet am").
--
--      Quelle 2026-08-15 umgestellt von season_bonuses auf
--      saison_abrechnungen - Nutzer-Nachfrage: "sollte doch jetzt das von
--      mir nachgetragene historische Abrechnungsdatum enthalten oder?".
--      saison_abrechnungen ist ein striktes Superset: jede ECHTE "Jetzt
--      Abrechnen"-Aktion schreibt dort ZUSÄTZLICH mit (siehe
--      saison_abrechnen_batch), enthält aber zusätzlich auch die manuell
--      nachgetragenen historischen Abrechnungen (siehe
--      saison_abrechnung_nachtragen) - genau die fehlten hier bisher.
--      security_invoker jetzt möglich (anders als vorher bei
--      season_bonuses, das admin/lohnabrechnung-only ist):
--      saison_abrechnungen ist bereits für alle angemeldeten Rollen lesbar
--      (saison_abrechnungen_select), keine "kontrollierte Ausnahme" mehr
--      nötig.
-- ---------------------------------------------------------------------------
create or replace view employee_letzte_abrechnung as
select employee_id, max(abgerechnet_am) as abgerechnet_am
from saison_abrechnungen
group by employee_id;

alter view employee_letzte_abrechnung set (security_invoker = true);
grant select on employee_letzte_abrechnung to authenticated;

-- ---------------------------------------------------------------------------
-- 12d. View: Auszahlungsbeleg-Übersicht für die "Auszahlungen"-Seite -
--      Belegnummer, Anzahl Personen, Summe, und ob dieser Beleg eine oder
--      mehrere Differenzbeleg-Zeilen enthält (Nutzer-Vorgabe 2026-08-21).
--      Quelle 2026-08-21 umgestellt von season_bonuses (EINE, bei jeder
--      erneuten Abrechnung derselben Person überschriebene Zeile je
--      Person/Saison) auf die unveränderliche auszahlungsbeleg_zeilen -
--      vorher verschwand eine Person rückwirkend aus einem alten, bereits
--      gedruckten Beleg, sobald sie erneut abgerechnet wurde (siehe
--      auszahlungsbeleg_zeilen weiter oben).
-- ---------------------------------------------------------------------------
-- drop statt create-or-replace: Postgres verweigert create-or-replace, wenn
-- sich Spaltennamen ändern ("weicht_ab" -> "enthaelt_differenz", 42P16) -
-- unbedenklich, keine andere Sicht/Funktion greift auf diese Sicht zu.
drop view if exists auszahlungsbeleg_summary;

create view auszahlungsbeleg_summary as
select
  ab.id,
  ab.belegnummer,
  ab.saison_jahr,
  ab.zahlungsart,
  ab.erstellt_am,
  ab.erstellt_von,
  count(az.employee_id) as anzahl_personen,
  sum((az.zeile ->> 'auszahlungsbetrag')::numeric) as summe_auszahlungsbetrag,
  bool_or(az.ist_differenz) as enthaelt_differenz
from auszahlungsbelege ab
join auszahlungsbeleg_zeilen az on az.auszahlungsbeleg_id = ab.id
-- Sicherheitsfix 2026-08-12 (Supabase-Advisor "Security Definer View"):
-- gleicher Grund wie bei season_summary - auszahlungsbeleg_zeilen ist per
-- RLS auf die Lohn-Rollen beschränkt, diese Sicht braucht die Eigentümer-
-- Rechte dafür, darf aber nicht an zeiterfassung/erntewirtschaft
-- durchgereicht werden.
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management')
group by ab.id, ab.belegnummer, ab.saison_jahr, ab.zahlungsart, ab.erstellt_am, ab.erstellt_von;

grant select on auszahlungsbeleg_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 12e. View: SV-Freiheit-Prüfung je Mitarbeiter/Saisonjahr - 15-Wochen-Regel
--      (105 Kalendertage) für landwirtschaftliche Saisonarbeit, OI-004.
--
--      GRUNDLEGEND ÜBERARBEITET 2026-08-11 nach Nutzer-Recherche. Zwei
--      Korrekturen gegenüber dem bisherigen Stand:
--
--      1. Die 90-Arbeitstage-Grenze wurde ENTFERNT. Sie gilt laut Quelle
--         nur für Beschäftigungen an WENIGER als 5 Tagen pro Woche - das
--         kommt im Betrieb nicht vor (Nutzer: "findet praktisch keine
--         Anwendung"). Maßgeblich sind allein die 15 Wochen = 105
--         Kalendertage.
--
--      2. Die 105 Tage müssen NICHT am Stück laufen: alle kurzfristigen
--         Beschäftigungen eines Kalenderjahres werden zusammengerechnet.
--         Bisher zählte die reine Spanne vom ersten bis zum letzten
--         Arbeitstag - eine Pause zwischen zwei Einsätzen zählte damit
--         fälschlich mit. Jetzt werden die einzelnen Abschnitte summiert.
--
--      Abschnitts-Erkennung (Nutzer-Vorgabe): eine ABRECHNUNG beendet den
--      Beschäftigungsabschnitt - saison_abrechnen_batch setzt dabei auch
--      employees.aktiv = false, die Person reist ab. Kommt sie später
--      zurück, beginnt ein neuer Abschnitt. Dafür gibt es die Historie
--      saison_abrechnungen (season_bonuses selbst überschreibt
--      abgerechnet_am bei jeder erneuten Abrechnung, siehe dort).
--      Freie Tage, Wochenenden und Urlaub INNERHALB eines Abschnitts zählen
--      bewusst mit - das Beschäftigungsverhältnis läuft ja weiter.
--
--      Beschäftigungstag = Tag mit Stunden ODER mit Markierung (z.B. "U"
--      für Urlaub) - Nutzer-Vorgabe 2026-08-11: während Urlaub besteht das
--      Beschäftigungsverhältnis fort, die Zeit zählt auf die 15 Wochen.
--      Bugfix 2026-08-24 (Nutzer-Fall: historische Abrechnung am 25.06.,
--      aber 0-Std.-Tage davor wurden nicht mitgezählt, Abschnitt endete
--      fälschlich schon beim letzten Tag mit Stunden > 0): "Tag mit
--      Stunden" bedeutet "stunden is not null" (auch eine echte "0" -
--      Person anwesend, aber nicht gearbeitet), NICHT "stunden > 0" - exakt
--      dieselbe Definition wie bei season_summary.anwesenheitstage
--      ("Kein Eintrag = kein Abzug. Eine eingetragene '0' ... zählt
--      trotzdem als Anwesenheitstag"). Ein 0-Std.-Tag ist damit ein
--      Beschäftigungstag wie ein Urlaubstag - dieselbe Begründung
--      ("Beschäftigungsverhältnis besteht fort") trifft genauso zu.
--
--      Reine Tage-Zählung, ersetzt NICHT die rechtliche Prüfung der
--      Sozialversicherungsbefreiung selbst (eigenes Formular nötig).
--
--      Bewusst "drop + create" statt "create or replace": es ändern sich
--      Spaltennamen UND -reihenfolge, was "create or replace view" mit
--      Fehler 42P16 ablehnen würde. Keine andere Sicht hängt an dieser hier
--      (nur das Frontend liest sie), daher unproblematisch.
-- ---------------------------------------------------------------------------
drop view if exists employee_sv_pruefung;

-- ---------------------------------------------------------------------------
-- 12e0. View: Beschäftigungsabschnitte einzeln, je Mitarbeiter/Saisonjahr/
--       Abschnitt-Nummer - bisher nur als CTE INNERHALB employee_sv_pruefung
--       verwendet, jetzt eine eigene Sicht (Nutzer-Vorgabe 2026-08-15: "Wie
--       sähe das aus?" zur Tage-Aufschlüsselung der 105-Tage-Grenze -
--       braucht die einzelnen Abschnitte, nicht nur die Summe). Einzige
--       Quelle der Abschnitts-Logik - employee_sv_pruefung liest sie jetzt
--       ebenfalls von hier, statt die Logik zweimal zu pflegen.
-- ---------------------------------------------------------------------------
create or replace view employee_sv_abschnitte as
with beschaeftigungstage_roh as (
  select
    we.employee_id,
    we.datum,
    extract(year from we.datum)::int as saison_jahr,
    -- Abschnitts-Nummer = Anzahl der Abrechnungen VOR diesem Tag. "<"
    -- statt "<=": an dem Tag, an dem abgerechnet wird, gearbeitete Stunden
    -- gehören noch zum alten Abschnitt.
    (
      select count(*)
      from saison_abrechnungen sa
      where sa.employee_id = we.employee_id
        and sa.saison_jahr = extract(year from we.datum)::int
        and sa.abgerechnet_am::date < we.datum
    ) as abschnitt_nr
  from work_entries we
  where we.stunden is not null or we.markierung is not null
)
select
  employee_id,
  saison_jahr,
  abschnitt_nr,
  min(datum) as von,
  max(datum) as bis,
  (max(datum) - min(datum) + 1)::int as tage
from beschaeftigungstage_roh
group by employee_id, saison_jahr, abschnitt_nr;

alter view employee_sv_abschnitte set (security_invoker = true);
grant select on employee_sv_abschnitte to authenticated;

-- Erweiterung 2026-08-14 (Nutzer: "Die verschiedenen Abschnitte müssen
-- transparent benannt und gerechnet werden"): w.beginn_letzter_abschnitt
-- wurde bisher nur INTERN für austrittsdatum_105_tage/_empfohlen genutzt,
-- aber nie selbst angezeigt - ohne ihn war für den Nutzer nicht sichtbar,
-- wann der GERADE LAUFENDE Abschnitt begonnen hat, wenn es (durch
-- Statuswechsel oder nachgetragene historische Abrechnungen) mehrere
-- Abschnitte in einer Saison gibt. w.erster_arbeitstag zeigt weiterhin den
-- allerersten Tag der Saison über ALLE Abschnitte - bewusst unverändert
-- gelassen, nur um aktueller_abschnitt_seit ergänzt (ans Ende angehängt,
-- 42P16-sicher).
create or replace view employee_sv_pruefung as
with abschnitte as (
  select * from employee_sv_abschnitte
),
w as (
  select
    employee_id,
    saison_jahr,
    min(von) as erster_arbeitstag,
    max(bis) as letzter_arbeitstag,
    -- ::int (nicht bigint): tage_vor_letztem_abschnitt unten wird auf ein
    -- Datum addiert, und Postgres kennt nur "date + integer", kein
    -- "date + bigint" (Fehler 42883). sum() liefert von sich aus bigint.
    sum(tage)::int as beschaeftigungstage,
    count(*)::int as anzahl_abschnitte,
    -- Für das Austrittsdatum: der laufende (zuletzt begonnene) Abschnitt
    -- darf noch so viele Kalendertage laufen, wie vom Budget übrig ist.
    (array_agg(von order by von desc))[1] as beginn_letzter_abschnitt,
    (sum(tage) - (array_agg(tage order by von desc))[1])::int
      as tage_vor_letztem_abschnitt
  from abschnitte
  group by employee_id, saison_jahr
)
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.abrechnungsart,
  e.aktiv,
  w.saison_jahr,
  w.erster_arbeitstag,
  w.letzter_arbeitstag,
  -- Summe der Kalendertage ALLER Beschäftigungsabschnitte dieses
  -- Kalenderjahres (nicht die Spanne vom ersten bis zum letzten Tag).
  w.beschaeftigungstage,
  w.anzahl_abschnitte,
  -- Bisherige Beschäftigungstage in DEUTSCHLAND bei anderen Arbeitgebern
  -- laut SV-Fragebogen. Rechtlich zählt das Kalenderjahr über ALLE
  -- deutschen Arbeitgeber zusammen, nicht nur die Tage bei uns.
  coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as vorbeschaeftigung_deutschland_tage,
  (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
    as kombinierte_tage,
  greatest(
    0,
    105 - (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
  ) as rest_bis_105_tage,
  (
    (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)) > 105
  ) as ueberschritten_105_tage,
  -- Letzter Tag, an dem die Person nach der 15-Wochen-Regel noch
  -- SV-frei beschäftigt sein darf: der laufende Abschnitt darf genau so
  -- lange laufen, wie das Budget nach Abzug früherer Abschnitte und der
  -- Vorbeschäftigung noch hergibt.
  (
    w.beginn_letzter_abschnitt
    + (105 - w.tage_vor_letztem_abschnitt
         - coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
    - 1
  ) as austrittsdatum_105_tage,
  -- Empfohlenes Austrittsdatum: das frühere von der 15-Wochen-Grenze und
  -- dem Ende des SV-freien Zeitraums laut Angaben (least() ignoriert
  -- NULL, sv_frei_bis ist bei offenen Zuständen NULL).
  least(
    (
      w.beginn_letzter_abschnitt
      + (105 - w.tage_vor_letztem_abschnitt
           - coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
      - 1
    ),
    fb.sv_frei_bis
  ) as austrittsdatum_empfohlen,
  (
    (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)) > 105
    -- SV-freier Zeitraum laut Angaben deckt die tatsächliche Beschäftigung
    -- nicht ab, oder diese fällt in eine Lücke zwischen "Bezahlter Urlaub"
    -- und "Freistellung" (Nutzer-Vorgabe 2026-08-10: als kritisch werten).
    or (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    or (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    -- Bugfix 2026-08-15 (Nutzer-Testfall mit zwei Abschnitten und einer
    -- Lücke dazwischen, die fälschlich als "kritisch" markiert wurde):
    -- NICHT mehr gegen w.erster_arbeitstag/letzter_arbeitstag prüfen (die
    -- Spanne über ALLE Abschnitte hinweg) - das reißt die Lücke auf, sobald
    -- irgendein früherer und irgendein späterer Abschnitt existieren, ganz
    -- gleich ob dazwischen tatsächlich gearbeitet wurde. Stattdessen: gibt
    -- es einen EINZELNEN Abschnitt, der die Lücke wirklich überschneidet?
    or exists (
      select 1 from abschnitte ab
      where ab.employee_id = e.id
        and ab.saison_jahr = w.saison_jahr
        and coalesce(fb.sv_frei_luecke, false)
        and ab.von <= fb.sv_frei_luecke_bis
        and ab.bis >= fb.sv_frei_luecke_von
    )
  ) as kritisch,
  fb.sv_frei_von,
  fb.sv_frei_bis,
  coalesce(fb.sv_frei_luecke, false) as sv_frei_luecke,
  fb.sv_frei_luecke_von,
  fb.sv_frei_luecke_bis,
  coalesce(fb.sv_frei_offen, false) as sv_frei_offen,
  (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    as ueberschritten_sv_frei_beginn,
  (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    as ueberschritten_sv_frei_ende,
  -- Beginn des GERADE LAUFENDEN (letzten) Abschnitts - anders als
  -- erster_arbeitstag (allererster Tag der ganzen Saison) maßgeblich für
  -- die 105-Tage-Berechnung des aktuellen Abschnitts, siehe Kommentar oben.
  w.beginn_letzter_abschnitt as aktueller_abschnitt_seit,
  -- Eigens ausgegeben (Bugfix 2026-08-15, siehe Kommentar bei "kritisch"
  -- oben): ob TATSÄCHLICH ein Beschäftigungsabschnitt die deklarierte
  -- Lücke überschneidet - im Unterschied zu sv_frei_luecke weiter oben,
  -- das nur aussagt, DASS die Angaben selbst eine Lücke enthalten
  -- (unabhängig davon, ob je gearbeitet wurde). Ersetzt die bisherige,
  -- fehleranfällige Berechnung in lib/svPruefung.ts
  -- (svFreiZeitraumUeberschritten) und in app/management/page.tsx.
  exists (
    select 1 from abschnitte ab
    where ab.employee_id = e.id
      and ab.saison_jahr = w.saison_jahr
      and coalesce(fb.sv_frei_luecke, false)
      and ab.von <= fb.sv_frei_luecke_bis
      and ab.bis >= fb.sv_frei_luecke_von
  ) as ueberschritten_sv_frei_luecke
from employees e
join w on w.employee_id = e.id
-- Bewusst direkt gegen die Rohtabelle (nicht über die security_invoker-
-- Sicht sv_fragebogen_auswertung), damit hier eindeutig mit den Rechten
-- des Sicht-Eigentümers gelesen wird, unabhängig von der Rolle des
-- aufrufenden Nutzers.
left join lateral (
  select
    -- Effektive Tage-Zahl: bevorzugt aus dem Zeitraum von/bis berechnet,
    -- sonst die direkt eingetragene Zahl (Nutzer-Vorgabe 2026-08-11).
    vorbeschaeftigung_deutschland_tage_effektiv(f)
      as vorbeschaeftigung_deutschland_tage,
    -- Bei den offenen Zuständen (Hausfrau/Rente/Selbstständigkeit) ist das
    -- "seit"-Datum aus dem Formular nur ein Nachweis, seit wann der Zustand
    -- besteht - der SV-freie Zeitraum beginnt dort mit dem tatsächlichen
    -- Arbeitsbeginn. Bei Block 1/4 bleibt es beim Von-Datum aus den
    -- Angaben, sonst könnte "beginnt zu spät" nie auslösen.
    case when sv_freier_zeitraum_offen(f) then w.erster_arbeitstag
      else sv_freier_zeitraum_von(f) end as sv_frei_von,
    sv_freier_zeitraum_bis(f) as sv_frei_bis,
    sv_freier_zeitraum_luecke(f) as sv_frei_luecke,
    sv_freier_zeitraum_luecke_von(f) as sv_frei_luecke_von,
    sv_freier_zeitraum_luecke_bis(f) as sv_frei_luecke_bis,
    sv_freier_zeitraum_offen(f) as sv_frei_offen
  from sv_fragebogen f
  where f.employee_id = e.id and f.saison_jahr = w.saison_jahr
) fb on true
-- Die 15-Wochen-Regel ist die Obergrenze für SOZIALVERSICHERUNGSFREIE
-- Beschäftigung - für bereits sozialversicherungspflichtige Personen ist
-- diese Prüfung gegenstandslos (Nutzer-Hinweis 2026-08-06).
--
-- Sicherheitsfix 2026-08-12 (Supabase-Advisor "Security Definer View"):
-- diese Sicht liest bewusst mit den Rechten des Eigentümers direkt gegen
-- sv_fragebogen (siehe Kommentar oben bei "fb"), das per RLS admin/hr-only
-- ist - "so sensibel wie SV-Nr./IBAN" (siehe sv_fragebogen_admin_hr_all
-- weiter unten). Ohne diese Zeile wäre die abgeleitete SV-Einschätzung
-- trotzdem für JEDE angemeldete Rolle abrufbar gewesen. Rollenliste
-- entspricht den tatsächlichen Nutzern (Personal/Controlling, siehe
-- app/mitarbeiter, app/personal-sozialversicherung, app/management).
where e.abrechnungsart <> 'sozialversicherungspflichtig'
  and current_role_name() in ('admin', 'hr', 'management');

grant select on employee_sv_pruefung to authenticated;

-- ---------------------------------------------------------------------------
-- 12e2. View: Urlaubstage-Anspruch/-Kontrolle je Mitarbeiter/Saisonjahr
--       (Nutzer-Vorgabe 2026-08-09): Anspruch = 2 Urlaubstage je vollem
--       Kalendermonat der Beschäftigung (1. bis letzter Tag mit
--       irgendeinem Eintrag - Stunden ODER Markierung, nicht nur
--       Arbeitstage). "Voller Kalendermonat" heißt: die Beschäftigung
--       deckt Monatsanfang UND Monatsende dieses Monats ab - ein Monat, in
--       dem erst am 2. begonnen oder vor dem Monatsletzten geendet wurde,
--       zählt NICHT (Beispiel Nutzer: 02.05.-29.07. ergibt nur 2 Tage,
--       da nur Juni ein voller Monat ist). "U"-markierte Tage sind die
--       tatsächlich genommenen Urlaubstage - "ueberzogen" markiert, wenn
--       mehr U-Tage erfasst wurden als der Anspruch hergibt.
--       resturlaub_tage/zu_wenig_genommen (2026-08-20, Nutzer-Vorgabe:
--       "der Use Case ist eigentlich, dass zu wenig Urlaub genommen
--       wird") - die umgekehrte Richtung, offener Resturlaub.
-- ---------------------------------------------------------------------------
create or replace view employee_urlaubstage as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.aktiv,
  w.saison_jahr,
  w.erster_eintrag,
  w.letzter_eintrag,
  w.u_tage,
  greatest(0, monate.anzahl)::int as volle_kalendermonate,
  greatest(0, monate.anzahl)::int * 2 as urlaubsanspruch_tage,
  (w.u_tage > greatest(0, monate.anzahl) * 2) as ueberzogen,
  -- Nutzer-Vorgabe 2026-08-20: der Hauptfall ist eigentlich zu WENIG
  -- genommener Urlaub (bisher wurde nur "zu viel" geprüft) - offener Rest,
  -- bei einer bereits inaktiven Person praktisch eine Abgeltungspflicht.
  greatest(0, greatest(0, monate.anzahl)::int * 2 - w.u_tage) as resturlaub_tage,
  (w.u_tage < greatest(0, monate.anzahl) * 2) as zu_wenig_genommen
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden is not null or we.markierung is not null) as erster_eintrag,
    max(we.datum) filter (where we.stunden is not null or we.markierung is not null) as letzter_eintrag,
    count(*) filter (where we.markierung = 'U') as u_tage
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
join lateral (
  select
    (
      extract(year from end_adj) - extract(year from start_adj)
    ) * 12
    + (extract(month from end_adj) - extract(month from start_adj))
    + 1 as anzahl
  from (
    select
      case
        when extract(day from w.erster_eintrag) = 1
          then date_trunc('month', w.erster_eintrag)
        else date_trunc('month', w.erster_eintrag) + interval '1 month'
      end as start_adj,
      case
        when w.letzter_eintrag
          = (date_trunc('month', w.letzter_eintrag) + interval '1 month' - interval '1 day')::date
          then date_trunc('month', w.letzter_eintrag)
        else date_trunc('month', w.letzter_eintrag) - interval '1 month'
      end as end_adj
  ) x
) monate on true
where w.erster_eintrag is not null;

-- security_invoker = true: unbedenklich, employees und work_entries sind
-- ohnehin für jede angemeldete Rolle per RLS lesbar - kein Unterschied im
-- Ergebnis, silenced nur den Supabase-Security-Advisor-Hinweis.
alter view employee_urlaubstage set (security_invoker = true);
grant select on employee_urlaubstage to authenticated;

-- ---------------------------------------------------------------------------
-- 12e3. View: Personen, die bereits ARBEITEN, obwohl ihr Anreiselisten-
--       Status noch offen ist (Nutzer-Vorgabe 2026-08-11). Genau der
--       Zustand, der sonst untergeht: jemand steht noch mit fehlendem
--       Arbeitsvertrag oder nicht bestandenem SV-Fragebogen auf der
--       Anreiseliste, trägt aber schon Stunden ein.
--
--       "Tage seit Status offen" = Tage seit dem ersten Arbeitstag, also:
--       wie lange arbeitet die Person schon, obwohl noch etwas fehlt.
--
--       Bewusst NICHT über personal_kandidaten_checkliste (die ist
--       security_invoker und damit admin/hr-only) - diese Sicht läuft mit
--       den Rechten des Eigentümers, damit auch die Rolle management die
--       Controlling-Seite vollständig sieht. Sie gibt dafür ausschließlich
--       Name/Personalnummer und die offenen Punkte aus, KEINE sensiblen
--       Personaldaten (kein Geburtsdatum, keine IBAN/SV-Nr.) - gleiches
--       Muster wie employee_letzte_abrechnung.
-- ---------------------------------------------------------------------------
-- drop + create statt "create or replace": die Spalte dhh_formular_fehlt
-- heißt seit 2026-08-11 dhh_angaben_fehlen, und eine Namensänderung lehnt
-- "create or replace view" mit Fehler 42P16 ab.
drop view if exists anreiseliste_offen_arbeitend;

create view anreiseliste_offen_arbeitend as
select
  k.id as kandidat_id,
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.herkunft,
  e.aktiv,
  w.erster_arbeitstag,
  w.letzter_arbeitstag,
  (current_date - w.erster_arbeitstag) as tage_seit_arbeitsbeginn,
  not k.gedruckt as arbeitsvertrag_fehlt,
  not coalesce(
    (
      select sv_fragebogen_bestanden(f)
      from sv_fragebogen f
      where f.employee_id = e.id
        and f.saison_jahr = extract(year from w.erster_arbeitstag)::int
    ),
    false
  ) as sv_fragebogen_offen,
  not k.buskosten_erfasst as buskosten_fehlen,
  not exists (
    select 1 from employee_documents d
    where d.employee_id = e.id and d.kategorie = 'Ausweiskopie'
  ) as ausweiskopie_fehlt,
  (
    k.fuehrerschein_kategorien is not null
    and array_length(k.fuehrerschein_kategorien, 1) is not null
    and not exists (
      select 1 from employee_documents d
      where d.employee_id = e.id and d.kategorie = 'Führerschein Kopie'
    )
  ) as fuehrerschein_fehlt,
  (
    coalesce(k.verheiratet_laut_fragebogen, false)
    and not exists (
      select 1 from employee_documents d
      where d.employee_id = e.id and d.kategorie = 'Hochzeitsurkunde'
    )
  ) as hochzeitsurkunde_fehlt,
  -- Angaben zur doppelten Haushaltsführung (Personal → Lohnsteuer) - seit
  -- 2026-08-11 wird die erfasste Angabe geprüft, nicht mehr ein
  -- hochgeladenes Formular.
  (
    k.lohnsteuerabzug_antrag_gewuenscht
    and not exists (
      select 1 from doppelte_haushaltsfuehrung d
      where d.employee_id = e.id
        and d.saison_jahr = extract(year from w.erster_arbeitstag)::int
        and d.familienstand is not null
    )
  ) as dhh_angaben_fehlen
from personal_kandidaten k
join employees e on e.id = k.aktivierter_employee_id
join lateral (
  select
    min(we.datum) as erster_arbeitstag,
    max(we.datum) as letzter_arbeitstag
  from work_entries we
  where we.employee_id = e.id
    and (we.stunden > 0 or we.markierung is not null)
) w on true
where k.status = 'anreiseliste'
  -- Nur Personen, die tatsächlich schon gearbeitet haben - erst dann ist
  -- ein offener Status wirklich kritisch (vorher ist die Anreiseliste ja
  -- genau der richtige Ort dafür).
  and w.erster_arbeitstag is not null;

grant select on anreiseliste_offen_arbeitend to authenticated;

-- ---------------------------------------------------------------------------
-- 12f. View: Vorschuss-Historie je Mitarbeiter für die "Suche"-Seite -
--      bewusst schmal (kein Bearbeiter/keine Belegnummer), damit auch
--      Rollen wie zeiterfassung, die die volle advances-Tabelle nicht
--      lesen dürfen, hier Auskunft geben können ("darf nicht nur der Chef
--      wissen"). Begründung ist bewusst mit dabei (Nutzer-Vorgabe: muss
--      auf der Suche-Seite zwingend sichtbar sein).
-- ---------------------------------------------------------------------------
-- Achtung: CREATE OR REPLACE VIEW darf bestehende Spalten weder umbenennen
-- noch ihre Reihenfolge ändern - neue Spalten müssen ans Ende. Deshalb
-- steht "begruendung" hier hinter "storniert" statt davor, und art/
-- beleg_* (2026-08-18, Vorschussart "Strafe/Rechnung") hinter begruendung.
-- beleg_storage_path/beleg_dateiname sind bewusst per current_role_name()
-- maskiert (nicht einfach mitgegeben) - "art" allein ist unkritisch (wie
-- begruendung breit sichtbar), aber der Beleg-Verweis soll nur den Rollen
-- mit den bisherigen Vorschuss-Rechten zugänglich sein (Nutzer-Vorgabe),
-- nicht z.B. zeiterfassung, die diese Sicht ebenfalls lesen darf.
create or replace view employee_vorschuss_historie as
select
  ar.employee_id,
  a.datum,
  ar.anteil as betrag,
  a.zahlungsart,
  a.storniert,
  a.begruendung,
  a.art,
  case when current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer')
    then a.beleg_storage_path else null end as beleg_storage_path,
  case when current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer')
    then a.beleg_dateiname else null end as beleg_dateiname
from advance_recipients ar
join advances a on a.id = ar.advance_id;

grant select on employee_vorschuss_historie to authenticated;

-- ---------------------------------------------------------------------------
-- 12f-2. View: Bus/Kaution(en)/Arbeitskleidung je Mitarbeiter+Saison für die
--        "Suche"-Seite, dort als zusätzliche "Auslage"-Positionen unter
--        Vorschüsse aufgeführt (Nutzer-Vorgabe 2026-08-18). Bewusst NICHT
--        security_invoker - season_bonuses UND verpflegungssaetze sind per
--        RLS eingeschränkt (season_bonuses_rw ist admin/lohnabrechnung-
--        only), aber genau wie bei den echten Vorschüssen sollen alle
--        Rollen hier Auskunft geben können. Kein Datum je Position -
--        season_bonuses hat nur
--        einen gemeinsamen updated_at je Mitarbeiter+Jahr für alle Felder
--        (nicht separat je Bus/Kaution/Kleidung gepflegt), daher zeigt die
--        Suche-Seite hierfür "Saison {Jahr}" statt eines echten Datums.
-- ---------------------------------------------------------------------------
create or replace view employee_auslagen_historie as
select
  b.employee_id,
  b.saison_jahr,
  coalesce(b.bus_hin, 0) + coalesce(b.bus_rueck, 0) as bus_kosten,
  coalesce(b.fahrer_kaution, 0) as fahrer_kaution,
  coalesce(b.zimmer_kaution, 0) as zimmer_kaution,
  coalesce(b.kleidung_hose_anzahl, 0) * coalesce(v.kleidung_hose, 0)
    as kleidung_hose_betrag,
  coalesce(b.kleidung_jacke_anzahl, 0) * coalesce(v.kleidung_jacke, 0)
    as kleidung_jacke_betrag,
  coalesce(b.kleidung_stiefel_anzahl, 0) * coalesce(v.kleidung_stiefel, 0)
    as kleidung_stiefel_betrag
from season_bonuses b
left join verpflegungssaetze v on v.saison_jahr = b.saison_jahr;

grant select on employee_auslagen_historie to authenticated;

-- ---------------------------------------------------------------------------
-- 12g. View: aktuelle Führerschein-Klassen je Mitarbeiter, aus der neuesten
--      hochgeladenen "Führerschein Kopie" (employee_documents ist selbst
--      admin/hr-only, siehe oben) - bewusst schmal (nur employee_id +
--      Klassen + Datum, keine Datei/kein Dateiname/kein Uploader), damit
--      Personal/Stundenerfassung/Lohnübersicht allen relevanten Rollen
--      anzeigen können, dass und wofür jemand einen Führerschein hat,
--      ohne die eigentlichen Dokumente breiter zugänglich zu machen.
-- ---------------------------------------------------------------------------
create or replace view employee_fuehrerschein_kategorien as
select distinct on (employee_id)
  employee_id,
  fuehrerschein_kategorien,
  hochgeladen_am
from employee_documents
where kategorie = 'Führerschein Kopie' and fuehrerschein_kategorien is not null
order by employee_id, hochgeladen_am desc;

grant select on employee_fuehrerschein_kategorien to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Row Level Security (ADR-006: Berechtigungen serverseitig, nicht nur UI)
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table arbeitsgruppen enable row level security;
alter table herkuenfte enable row level security;
alter table employees enable row level security;
alter table work_entries enable row level security;
alter table periods enable row level security;
alter table season_bonuses enable row level security;
alter table stundenkonto_bewegungen enable row level security;
alter table saison_abrechnungen enable row level security;
alter table auszahlungsbelege enable row level security;
alter table auszahlungsbeleg_zeilen enable row level security;
alter table kautionsuebergaben enable row level security;
alter table kautionsuebergabe_personen enable row level security;
alter table kleidung_lagerbestand enable row level security;
alter table kleidung_ausgaben enable row level security;
alter table verpflegungssaetze enable row level security;
alter table zuckermais_rohdaten enable row level security;
alter table zuckermais_saetze enable row level security;
alter table erdbeeren_parzellen enable row level security;
alter table erdbeeren_anbau enable row level security;
alter table erdbeeren_tunnel enable row level security;
alter table erdbeeren_bepflanzung enable row level security;
alter table erdbeeren_bestellung enable row level security;
alter table erdbeeren_parzellen_saetze enable row level security;
alter table erdbeeren_rohdaten enable row level security;
alter table advances enable row level security;
alter table advance_recipients enable row level security;
alter table kassenbewegungen enable row level security;
alter table cash_deposits enable row level security;
alter table cash_checks enable row level security;
alter table kassenpruefung_einstellungen enable row level security;
alter table audit_log enable row level security;
alter table employee_documents enable row level security;
alter table personal_kandidaten enable row level security;
alter table sv_fragebogen enable row level security;
alter table sv_fragebogen_vorbeschaeftigung enable row level security;
alter table doppelte_haushaltsfuehrung enable row level security;

-- profiles
create policy "profiles_select" on profiles for select
  using (id = auth.uid() or is_admin());
create policy "profiles_update_self" on profiles for update
  using (id = auth.uid());

-- arbeitsgruppen: alle eingeloggten Rollen lesen, nur admin pflegt
create policy "arbeitsgruppen_select" on arbeitsgruppen for select
  using (auth.uid() is not null);
create policy "arbeitsgruppen_admin_write" on arbeitsgruppen for all
  using (is_admin()) with check (is_admin());

-- herkuenfte: alle eingeloggten Rollen lesen, nur admin pflegt
create policy "herkuenfte_select" on herkuenfte for select
  using (auth.uid() is not null);
create policy "herkuenfte_admin_write" on herkuenfte for all
  using (is_admin()) with check (is_admin());

-- employees: volle Sicht/Bearbeitung für admin und hr
create policy "employees_admin_hr_all" on employees for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- Personalplanung: wie employees nur admin/hr (Personalplanung-Frage
-- vom Nutzer 2026-08-06 explizit so festgelegt).
create policy "personal_kandidaten_admin_hr_all" on personal_kandidaten for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- SV-Fragebogen: so sensibel wie andere Personaldaten (SV-Nr./IBAN), nur
-- admin/hr.
create policy "sv_fragebogen_admin_hr_all" on sv_fragebogen for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
create policy "sv_fragebogen_vorbeschaeftigung_admin_hr_all"
  on sv_fragebogen_vorbeschaeftigung for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- Doppelte Haushaltsführung: gleiche Sensibilität wie SV-Fragebogen.
create policy "doppelte_haushaltsfuehrung_admin_hr_all"
  on doppelte_haushaltsfuehrung for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

alter view employees_public set (security_invoker = true);
create policy "employees_read_for_logged_in" on employees for select
  using (auth.uid() is not null);
-- WICHTIGE LEHRE (2026-08-09-Vorfall): hier stand früher ein Versuch,
-- sensible Felder (SV-Nr., Steuer-ID, IBAN, BIC) per Spalten-Ebene über
-- "revoke select ... / grant select (Teilliste) ..." einzuschränken. Das
-- ist grundlegend fragil: "select *" (von mehreren Seiten genutzt)
-- verlangt in Postgres SELECT-Recht auf ALLE Spalten der Tabelle - sobald
-- auch nur eine einzige Spalte fehlt (z.B. weil eine Migration eine neue
-- Spalte hinzufügt, ohne die Grant-Liste synchron zu pflegen), schlägt
-- JEDE "select *"-Abfrage für ALLE Rollen mit 403 fehl - auch für
-- admin/hr, die diese Felder eigentlich sehen dürfen. Genau das ist am
-- 2026-08-09 passiert (die neue Prämien-Gruppenaufteilung-Migration hat
-- die Spaltenliste erweitert, aber offenbar erstmals wirksam verengt statt
-- vorher schon zu greifen - Ergebnis: komplette Sperre der Personal-Seite
-- für alle Rollen). Lösung: volle SELECT-Berechtigung auf Tabellenebene
-- (unten) statt einer Spaltenliste, die bei jeder neuen Spalte händisch
-- gepflegt werden müsste. Der Schutz sensibler Felder vor
-- zeiterfassung/erntewirtschaft läuft stattdessen darüber, dass die für
-- diese Rollen erreichbaren Seiten (Prämien, Arbeitskleidung, ...) gezielt
-- nur die tatsächlich benötigten Spalten abfragen (nie "select *" auf
-- employees) - siehe die jeweiligen page.tsx-Dateien. NIE wieder
-- "revoke select on employees" + Teilliste versuchen, ohne alle
-- "select *"-Nutzungen im ganzen Code geprüft zu haben.
grant select on employees to authenticated;

-- employee_documents: wie andere sensible Personaldaten nur admin/hr, sowohl
-- für die Metadaten-Tabelle als auch für die Dateien im Storage-Bucket.
create policy "employee_documents_admin_hr_all" on employee_documents for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create policy "mitarbeiter_dokumente_storage_admin_hr" on storage.objects for all
  using (bucket_id = 'mitarbeiter-dokumente' and current_role_name() in ('admin', 'hr'))
  with check (bucket_id = 'mitarbeiter-dokumente' and current_role_name() in ('admin', 'hr'));

-- work_entries: zeiterfassung/admin/hr/lohnabrechnung dürfen schreiben,
-- alle eingeloggten Rollen dürfen lesen. Zusätzlich: kein Schreiben in
-- einem per Monatsabschluss gesperrten Monat (periods.gesperrt) - gilt
-- ausnahmslos für alle Rollen inkl. admin; ein gesperrter Monat muss erst
-- bewusst (mit Pflichtgrund) wieder geöffnet werden, siehe periods_write.
create policy "work_entries_select" on work_entries for select
  using (auth.uid() is not null);
create policy "work_entries_write" on work_entries for insert
  with check (
    current_role_name() in ('admin', 'zeiterfassung', 'hr')
    and not exists (
      select 1 from periods p
      where p.saison_jahr = extract(year from datum)::int
        and p.monat = extract(month from datum)::int
        and p.gesperrt = true
    )
  );
create policy "work_entries_update" on work_entries for update
  using (
    current_role_name() in ('admin', 'zeiterfassung', 'hr')
    and not exists (
      select 1 from periods p
      where p.saison_jahr = extract(year from datum)::int
        and p.monat = extract(month from datum)::int
        and p.gesperrt = true
    )
  );

-- stundenkonto_bewegungen: wie work_entries breit lesbar - Schreiben
-- ausschließlich über stundenkonto_buchen/stundenkonto_in_auszahlung_
-- umwandeln (keine Schreib-Policy auf der Tabelle selbst, siehe Kommentar
-- dort).
create policy "stundenkonto_bewegungen_select" on stundenkonto_bewegungen for select
  using (auth.uid() is not null);

-- periods (Monatsabschluss): admin/hr sperren/entsperren, alle lesen.
create policy "periods_select" on periods for select using (auth.uid() is not null);
create policy "periods_write" on periods for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- Finanzielle/Compliance-Tabellen: admin, kasse, lohnabrechnung, pruefer
create policy "season_bonuses_rw" on season_bonuses for all
  using (current_role_name() in ('admin', 'lohnabrechnung'))
  with check (current_role_name() in ('admin', 'lohnabrechnung'));
-- auszahlungsbelege: nur lesend per Policy - Schreiben ausschließlich über
-- die security-definer Funktion saison_abrechnen_batch (wie Audit-Log).
create policy "auszahlungsbelege_select" on auszahlungsbelege for select
  using (auth.uid() is not null);
-- saison_abrechnungen: gleiches Muster - nur lesend per Policy, geschrieben
-- ausschließlich von saison_abrechnen_batch. Enthält bewusst KEINE Beträge
-- (nur Zeitpunkt + Belegverweis), deshalb wie auszahlungsbelege für alle
-- angemeldeten Rollen lesbar - die SV-Prüfung braucht das, und hr/management
-- dürfen die reinen Abrechnungszeitpunkte ohnehin sehen (siehe auch
-- employee_letzte_abrechnung).
create policy "saison_abrechnungen_select" on saison_abrechnungen for select
  using (auth.uid() is not null);

-- auszahlungsbeleg_zeilen: enthält Beträge, deshalb wie season_bonuses/
-- auszahlungsbeleg_summary auf die Lohn-Rollen beschränkt (nicht wie
-- saison_abrechnungen für alle angemeldeten Rollen). Nur lesend per Policy -
-- geschrieben ausschließlich über saison_abrechnen_batch bzw. die
-- Korrektur-Funktionen (alle security definer).
create policy "auszahlungsbeleg_zeilen_select" on auszahlungsbeleg_zeilen for select
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));

-- Kautionsübergabe: admin/lohnabrechnung (Auszahlungen-Seite) und kasse
-- (Kassenbuch-Auswirkung) dürfen anlegen/stornieren, alle mit
-- Kassenbuch-Einblick dürfen lesen.
create policy "kautionsuebergaben_select" on kautionsuebergaben for select
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
create policy "kautionsuebergaben_write" on kautionsuebergaben for insert
  with check (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'));
create policy "kautionsuebergaben_update" on kautionsuebergaben for update
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'));
create policy "kautionsuebergabe_personen_select" on kautionsuebergabe_personen for select
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
create policy "kautionsuebergabe_personen_write" on kautionsuebergabe_personen for insert
  with check (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'));

-- Arbeitskleidung (Nutzer-Vorgabe 2026-08-24): Lagerbestand (Anfangsbestand)
-- nur admin/hr, Ausgabe-Log wie gehabt admin/hr/zeiterfassung (die Kleidung
-- ausgibt) - lesend breiter (auch lohnabrechnung/management, analog zu
-- kautionsuebergaben/advances), damit der Lagerbestand auch im
-- Controlling/Lohn-Umfeld sichtbar ist.
create policy "kleidung_lagerbestand_select" on kleidung_lagerbestand for select
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'lohnabrechnung', 'management'));
create policy "kleidung_lagerbestand_write" on kleidung_lagerbestand for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
-- kleidung_ausgaben: nur lesend per Policy - Schreiben (Buchen/Stornieren)
-- ausschließlich über die security-definer Funktionen
-- arbeitskleidung_ausgabe_buchen/arbeitskleidung_ausgabe_stornieren, damit
-- season_bonuses zuverlässig mitsynchronisiert wird.
create policy "kleidung_ausgaben_select" on kleidung_ausgaben for select
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'lohnabrechnung', 'management'));

-- Bugfix 2026-08-24 (Nutzer-Meldung: "steht da, dass die Preise für 2026
-- noch nicht in den Einstellungen hinterlegt sind. Das stimmt aber nicht"):
-- die einzige bisherige Policy war "for all using (is_admin())" - damit
-- konnte KEINE andere Rolle (hr/zeiterfassung/kasse/lohnabrechnung/
-- pruefer/management/erntewirtschaft) verpflegungssaetze überhaupt lesen,
-- obwohl mehrere Seiten (Arbeitskleidung-Preise, Mindestlohn-Vorbelegung
-- auf Personal/Personalplanung/Anreiseliste) genau das für nicht-admin-
-- Rollen brauchen - fiel dort nur nicht als Fehler auf, weil die Abfrage
-- einfach leer zurückkam. Aufgeteilt wie bei zuckermais_saetze/
-- erdbeeren_parzellen_saetze: lesen breit, schreiben weiterhin nur admin.
create policy "verpflegungssaetze_select" on verpflegungssaetze for select
  using (auth.uid() is not null);
create policy "verpflegungssaetze_write" on verpflegungssaetze for all
  using (is_admin()) with check (is_admin());

-- Zuckermais-Prämien: Rohdaten wie work_entries (zeiterfassung/admin/hr/
-- erntewirtschaft schreiben, alle lesen dürfen - Suche braucht das für den
-- tageweisen Prämien-Stand). Sätze (Norm/Preis) nur admin schreibt, aber
-- breit lesbar (zeiterfassung/erntewirtschaft sollen beim Erfassen die
-- aktuell gültige Norm sehen können).
create policy "zuckermais_rohdaten_select" on zuckermais_rohdaten for select
  using (auth.uid() is not null);
-- Löschen/Ändern erlaubt (statt nur auf 0 zu setzen), damit ein
-- versehentlich am falschen Tag eingetragener Wert vollständig rückgängig
-- gemacht werden kann (Nutzer-Vorgabe 2026-08-09) - anders als bei
-- Vorschüssen/Auszahlungen gibt es hier keine Storno-Pflicht, da es sich
-- um reine Tageserfassung ohne Beleg-Charakter handelt (wie
-- work_entries). ABER: nicht mehr möglich, sobald die betroffene Person
-- für die jeweilige Saison bereits abgerechnet ("Jetzt Abrechnen") ist -
-- ein Wert, der eine abgeschlossene Auszahlung betrifft, darf nicht mehr
-- rückwirkend verändert werden (Nutzer-Vorgabe 2026-08-09).
create policy "zuckermais_rohdaten_write" on zuckermais_rohdaten for insert
  with check (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );
create policy "zuckermais_rohdaten_update" on zuckermais_rohdaten for update
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );
create policy "zuckermais_rohdaten_delete" on zuckermais_rohdaten for delete
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );
create policy "zuckermais_saetze_select" on zuckermais_saetze for select
  using (auth.uid() is not null);
create policy "zuckermais_saetze_write" on zuckermais_saetze for all
  using (is_admin()) with check (is_admin());

-- Erdbeeren-Prämien: gleiches Muster wie Zuckermais. Parzellen-Stammdaten
-- (Name/Größe/Sorte/Pflanzenanzahl) und ihre Sätze (Norm/Bonus je
-- Parzelle) nur admin pflegt, aber breit lesbar - Rohdaten (Steigen/
-- Stunden/Sut) wie zeiterfassung/admin/hr/erntewirtschaft schreiben, alle
-- lesen dürfen.
create policy "erdbeeren_parzellen_select" on erdbeeren_parzellen for select
  using (auth.uid() is not null);
-- Felder werden seit 2026-08-11 unter "Anbau -> Felder" gepflegt (vorher
-- unter Prämien) - deshalb hier dieselbe Rolle wie bei den übrigen
-- Anbau-Tabellen: admin UND erntewirtschaft. Ohne das könnte die
-- Erntewirtschaft ihre eigene Planungsseite nicht bedienen.
create policy "erdbeeren_parzellen_write" on erdbeeren_parzellen for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));
-- Anbauplanung (Nutzer-Vorgabe 2026-08-11): admin und erntewirtschaft
-- pflegen sie - die Erntewirtschaft plant den Anbau, admin hat ohnehin
-- Vollzugriff. Lesen dürfen alle Angemeldeten, damit die Planung z.B. in
-- der Statistik ausgewertet werden kann.
create policy "erdbeeren_anbau_select" on erdbeeren_anbau for select
  using (auth.uid() is not null);
create policy "erdbeeren_anbau_write" on erdbeeren_anbau for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));
create policy "erdbeeren_tunnel_select" on erdbeeren_tunnel for select
  using (auth.uid() is not null);
create policy "erdbeeren_tunnel_write" on erdbeeren_tunnel for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));
create policy "erdbeeren_bepflanzung_select" on erdbeeren_bepflanzung for select
  using (auth.uid() is not null);
create policy "erdbeeren_bepflanzung_write" on erdbeeren_bepflanzung for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));
create policy "erdbeeren_bestellung_select" on erdbeeren_bestellung for select
  using (auth.uid() is not null);
create policy "erdbeeren_bestellung_write" on erdbeeren_bestellung for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));

create policy "erdbeeren_parzellen_saetze_select" on erdbeeren_parzellen_saetze for select
  using (auth.uid() is not null);
create policy "erdbeeren_parzellen_saetze_write" on erdbeeren_parzellen_saetze for all
  using (is_admin()) with check (is_admin());
create policy "erdbeeren_rohdaten_select" on erdbeeren_rohdaten for select
  using (auth.uid() is not null);
-- Löschen/Ändern erlaubt, aber nicht mehr nach Auszahlung - gleicher Grund
-- wie bei Zuckermais.
create policy "erdbeeren_rohdaten_write" on erdbeeren_rohdaten for insert
  with check (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );
create policy "erdbeeren_rohdaten_update" on erdbeeren_rohdaten for update
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );
create policy "erdbeeren_rohdaten_delete" on erdbeeren_rohdaten for delete
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );

create policy "advances_select" on advances for select
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
create policy "advances_write" on advances for insert
  with check (current_role_name() in ('admin', 'kasse'));
create policy "advances_update" on advances for update
  using (
    current_role_name() in ('admin', 'kasse')
    and not ist_kassenpruefung_gesperrt(datum)
  );
create policy "advance_recipients_rw" on advance_recipients for all
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer'))
  with check (current_role_name() in ('admin', 'kasse'));
-- Strafe/Rechnung-Belege: gleiche Rollenaufteilung wie advance_recipients_rw
-- (lesen: wie bisherige Vorschuss-Rechte, schreiben: wie advances_write).
create policy "vorschuss_belege_storage_select" on storage.objects for select
  using (
    bucket_id = 'vorschuss-belege'
    and current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer')
  );
create policy "vorschuss_belege_storage_insert" on storage.objects for insert
  with check (
    bucket_id = 'vorschuss-belege' and current_role_name() in ('admin', 'kasse')
  );
create policy "vorschuss_belege_storage_delete" on storage.objects for delete
  using (
    bucket_id = 'vorschuss-belege' and current_role_name() in ('admin', 'kasse')
  );
-- kassenbewegungen: nur lesend per Policy - Schreiben ausschließlich über
-- die security-definer Funktion vorschuss_korrigieren.
create policy "kassenbewegungen_select" on kassenbewegungen for select
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
create policy "cash_deposits_select" on cash_deposits for select
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
create policy "cash_deposits_write" on cash_deposits for insert
  with check (current_role_name() in ('admin', 'kasse'));
create policy "cash_deposits_update" on cash_deposits for update
  using (
    current_role_name() in ('admin', 'kasse')
    and not ist_kassenpruefung_gesperrt(datum)
  );
create policy "cash_checks_select" on cash_checks for select
  using (current_role_name() in ('admin', 'kasse', 'pruefer', 'management'));
create policy "cash_checks_write" on cash_checks for insert
  with check (current_role_name() in ('admin', 'kasse'));
create policy "cash_checks_update" on cash_checks for update
  using (current_role_name() in ('admin', 'pruefer'));
create policy "kassenpruefung_einstellungen_rw" on kassenpruefung_einstellungen for all
  using (is_admin()) with check (is_admin());

-- audit_log: append-only, nur lesend und nur für admin/pruefer
create policy "audit_log_select" on audit_log for select
  using (current_role_name() in ('admin', 'pruefer'));
-- Kein Insert/Update/Delete-Policy für Nutzer: Schreiben passiert ausschließlich
-- über die security-definer Trigger-Funktion write_audit_log().

-- ---------------------------------------------------------------------------
-- 14. Realtime aktivieren (für Live-Sync im Frontend)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table work_entries;
alter publication supabase_realtime add table advances;
alter publication supabase_realtime add table cash_deposits;
alter publication supabase_realtime add table cash_checks;
