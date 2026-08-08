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
-- ---------------------------------------------------------------------------
create type user_role as enum (
  'admin',           -- Administrator: volle Rechte, Konfiguration, Reopen
  'hr',               -- Personalstamm pflegen, sonst nur lesen
  'zeiterfassung',    -- Stunden erfassen (offene Periode)
  'kasse',            -- Vorschüsse/Kassenbuch erfassen
  'lohnabrechnung',   -- Lohnübersicht einsehen/prüfen
  'pruefer',          -- nur lesen, Kassenprüfungen freigeben
  'management'        -- nur aggregierte/lesende Sicht
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role user_role not null default 'zeiterfassung',
  aktiv boolean not null default true,
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
    'Formular "Doppelte Haushaltsführung"',
    'Formular zur Feststellung der Versicherungspflicht',
    'Sonstiges'
  )),
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
  vorbeschaeftigung_deutschland_tage int,
  vorbeschaeftigung_deutschland_arbeitgeber text,
  -- Dokumentiert, falls diese Nachfrage gezielt durch eine Rückmeldung des
  -- Lohnprogramms ausgelöst wurde (statt nur beim regulären Erstantritt) -
  -- als Nachweis, dass dem nachgegangen wurde.
  ausgeloest_durch_lohnprogramm_hinweis boolean not null default false,

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
-- versehentlich als "bestanden" durchgehen.
create or replace view sv_fragebogen_auswertung as
select
  f.*,
  (
    coalesce(f.beschaeftigt_heimatland, false)
    or coalesce(f.selbststaendig, false)
    or coalesce(f.schule_studium, false)
    or coalesce(f.rente, false)
    or coalesce(f.hausmann, false)
  )
  and not coalesce(f.arbeitslos, false) as bestanden
from sv_fragebogen f;

-- security_invoker = true: die Rohantworten sind so sensibel wie andere
-- Personaldaten (SV-Nr./IBAN) - läuft mit den Rechten des aufrufenden
-- Nutzers, damit die admin/hr-only-Policy von sv_fragebogen tatsächlich
-- greift (siehe RLS weiter unten).
alter view sv_fragebogen_auswertung set (security_invoker = true);
grant select on sv_fragebogen_auswertung to authenticated;

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
  (
    k.lohnsteuerabzug_antrag_gewuenscht = false
    or exists (
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Formular "Doppelte Haushaltsführung"'
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
  ) as sv_fragebogen_bestanden
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
  -- Bei abrechnungsart 'lohnsteuerklasse_1'/'sozialversicherungspflichtig'
  -- kann/darf die App die Lohnsteuer nicht selbst berechnen (das macht ein
  -- echtes Lohnprogramm) - entspricht Sheet "Summen", Spalte BA
  -- ("Netto-Summe (HSC)"): Lohnbuchhaltung trägt den vom Lohnprogramm
  -- gelieferten Netto-Betrag hier von Hand ein, die App rechnet ab da weiter.
  netto_extern numeric(10, 2),
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
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
  end if;

  neue_belegnummer := naechste_belegnummer('AZ-' || to_char(now(), 'MM-YYYY'));

  insert into auszahlungsbelege (belegnummer, saison_jahr, zahlungsart, erstellt_von)
  values (neue_belegnummer, p_saison_jahr, p_zahlungsart, auth.uid())
  returning id into neuer_beleg_id;

  foreach emp_id in array p_employee_ids loop
    select * into s from season_summary
    where employee_id = emp_id and saison_jahr = p_saison_jahr;

    if found then
      -- 'snapshot' aus s selbst entfernen, sonst würde sich bei mehrfachem
      -- Abrechnen derselben Person der alte Schnappschuss im neuen
      -- verschachteln.
      insert into season_bonuses (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        snapshot, auszahlungsbeleg_id
      )
      values (
        emp_id, p_saison_jahr, now(), auth.uid(),
        to_jsonb(s) - 'snapshot', neuer_beleg_id
      )
      on conflict (employee_id, saison_jahr)
      do update set
        abgerechnet_am = now(),
        abgerechnet_von = auth.uid(),
        snapshot = excluded.snapshot,
        auszahlungsbeleg_id = neuer_beleg_id;

      update employees set aktiv = false where id = emp_id;
    end if;
  end loop;

  return neue_belegnummer;
end;
$$;

grant execute on function saison_abrechnen_batch(uuid[], int, text) to authenticated;

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
  mindestlohn numeric(6, 2)
);

insert into verpflegungssaetze (saison_jahr, verpflegung, wohnen)
values (extract(year from current_date)::int, 10.00, 10.00)
on conflict (saison_jahr) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Zentrale Belegnummern-Vergabe (ADR-010: atomar, auch bei gleichzeitiger
--    Nutzung durch mehrere Personen - Format wie im Altsystem "MM-JJJJ-###")
-- ---------------------------------------------------------------------------
create table beleg_zaehler (
  monatsschluessel text primary key, -- z.B. '02-2026'
  naechste_nummer int not null default 1
);

create or replace function naechste_belegnummer(prefix_monat text)
returns text language plpgsql as $$
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
  bearbeiter_id uuid references profiles (id),
  begruendung text,
  -- Name der Person (z.B. Gruppenleiter), der das Geld zur Verteilung an
  -- die einzelnen Empfänger übergeben wird - erscheint auf dem separaten
  -- Übergabe-Beleg (siehe Druck auf der Vorschüsse-Seite). Optional wie
  -- Begründung.
  uebergeben_an text,
  zahlungsart text not null, -- z.B. 'BAR', 'AZ' (Überweisung)
  storniert boolean not null default false,
  storniert_am timestamptz,
  storniert_von uuid references profiles (id),
  storno_grund text,
  created_at timestamptz not null default now()
);

-- n:m Verknüpfung, da ein Vorschuss an mehrere Personen gehen kann
create table advance_recipients (
  advance_id bigint not null references advances (id) on delete restrict,
  employee_id uuid not null references employees (id) on delete restrict,
  anteil numeric(10, 2), -- optional: individueller Anteil, sonst gleichmäßig
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
  bearbeiter_id uuid references profiles (id),
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
create trigger trg_audit_advances
  after insert or update on advances
  for each row execute function write_audit_log();
create trigger trg_audit_cash_deposits
  after insert or update on cash_deposits
  for each row execute function write_audit_log();
create trigger trg_audit_cash_checks
  after insert or update on cash_checks
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

create trigger trg_employees_updated_at before update on employees
  for each row execute function set_updated_at_and_version();
create trigger trg_work_entries_updated_at before update on work_entries
  for each row execute function set_updated_at_and_version();
create trigger trg_personal_kandidaten_updated_at before update on personal_kandidaten
  for each row execute function set_updated_at_and_version();

-- ---------------------------------------------------------------------------
-- 12a. View: erster erfasster Arbeitstag je Mitarbeiter ("Aktiv seit" auf
--      der Personal-Seite) - erster Tag mit Stunden > 0, unabhängig vom
--      Saisonjahr.
-- ---------------------------------------------------------------------------
create or replace view employee_erster_arbeitstag as
select employee_id, min(datum) as erster_arbeitstag
from work_entries
where stunden > 0
group by employee_id;

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
--                            - Buskosten
--     Buskosten (bus_hin/bus_rueck): vorfinanzierte Heimreise, wird wie ein
--     Vorschuss abgezogen, aber separat ausgewiesen ("damit es zu keinen
--     Missverständnissen kommen kann").
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
      + coalesce(b.spargel_praemie, 0) as praemien_summe,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0)) as basis_brutto,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0))
      + coalesce(b.akkord_betrag, 0)
      + coalesce(b.praemie_ausgleich, 0)
      + coalesce(b.fahrer_zulage, 0)
      + coalesce(b.erdbeer_praemie, 0)
      + coalesce(b.spargel_praemie, 0) as bruttolohn,
    b.netto_extern,
    b.abgerechnet_am,
    b.snapshot,
    b.auszahlungsbeleg_id,
    coalesce(b.bus_hin, 0) + coalesce(b.bus_rueck, 0) as bus_kosten,
    coalesce(b.fahrer_kaution, 0) as fahrer_kaution,
    coalesce(b.zimmer_kaution, 0) as zimmer_kaution,
    coalesce(v.verpflegung, 0) * we.anwesenheitstage as abzug_verpflegung,
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
    ), 0) as vorschuss_summe
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
  steuer.*,
  -- NULL, solange bei nicht-pauschalen Abrechnungsarten noch kein
  -- netto_extern eingetragen wurde - bewusst kein Platzhalterwert.
  netto - abzug_verpflegung - abzug_wohnen - vorschuss_summe - bus_kosten
    - fahrer_kaution - zimmer_kaution
    as auszahlungsbetrag
from steuer;

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
group by
  e.id, e.personal_nr, e.name, e.vorname, e.gruppe_nr, e.aktiv,
  extract(year from we.datum), extract(month from we.datum),
  v.verpflegung, v.wohnen;

grant select on season_summary_monat to authenticated;

-- ---------------------------------------------------------------------------
-- 12c. View: letztes Abrechnungsdatum je Mitarbeiter, für die Personal-Seite
--      ("Zuletzt abgerechnet am"). Bewusst NICHT security_invoker: zeigt nur
--      das Datum (keine Beträge), damit auch hr - die season_bonuses selbst
--      nicht lesen darf - diesen einen Wert sieht.
-- ---------------------------------------------------------------------------
create or replace view employee_letzte_abrechnung as
select employee_id, max(abgerechnet_am) as abgerechnet_am
from season_bonuses
where abgerechnet_am is not null
group by employee_id;

grant select on employee_letzte_abrechnung to authenticated;

-- ---------------------------------------------------------------------------
-- 12d. View: Auszahlungsbeleg-Übersicht für die "Auszahlungen"-Seite -
--      Belegnummer, Anzahl Personen, Summe, und ob sich der eingefrorene
--      Stand einer enthaltenen Person seither von der Live-Berechnung
--      unterscheidet (z.B. weil danach ein Satz/Vorschuss geändert wurde).
-- ---------------------------------------------------------------------------
create or replace view auszahlungsbeleg_summary as
select
  ab.id,
  ab.belegnummer,
  ab.saison_jahr,
  ab.zahlungsart,
  ab.erstellt_am,
  ab.erstellt_von,
  count(sb.employee_id) as anzahl_personen,
  sum((sb.snapshot ->> 'auszahlungsbetrag')::numeric) as summe_auszahlungsbetrag,
  bool_or(
    (sb.snapshot ->> 'auszahlungsbetrag')::numeric is distinct from ss.auszahlungsbetrag
  ) as weicht_ab
from auszahlungsbelege ab
join season_bonuses sb on sb.auszahlungsbeleg_id = ab.id
left join season_summary ss
  on ss.employee_id = sb.employee_id and ss.saison_jahr = sb.saison_jahr
group by ab.id, ab.belegnummer, ab.saison_jahr, ab.zahlungsart, ab.erstellt_am, ab.erstellt_von;

grant select on auszahlungsbeleg_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 12e. View: SV-Freiheit-Prüfung je Mitarbeiter/Saisonjahr (90-Tage- bzw.
--      15-Wochen-Regel für landwirtschaftliche Saisonarbeit - OI-004).
--      Reine Tage-/Wochen-Zählung, ersetzt NICHT die rechtliche Prüfung der
--      Sozialversicherungsbefreiung selbst (eigenes Formular nötig).
--      Arbeitszeitraum = 1. bis letzter Tag mit Stunden > 0 (nicht nur
--      "anwesend" - reine Anwesenheit ohne Arbeit zählt hier nicht).
-- ---------------------------------------------------------------------------
create or replace view employee_sv_pruefung as
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
  w.arbeitstage_ueber0,
  greatest(0, 90 - w.arbeitstage_ueber0) as rest_bis_90_tage,
  (w.erster_arbeitstag + 104) as austrittsdatum_15_wochen,
  floor((w.letzter_arbeitstag - w.erster_arbeitstag) / 7.0)::int as wochen_seit_start,
  (w.arbeitstage_ueber0 > 90) as ueberschritten_90_tage,
  (w.letzter_arbeitstag > (w.erster_arbeitstag + 104)) as ueberschritten_15_wochen,
  (
    w.arbeitstage_ueber0 > 90
    or w.letzter_arbeitstag > (w.erster_arbeitstag + 104)
    or (w.arbeitstage_ueber0 + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)) > 90
  ) as kritisch,
  -- Neue Spalten ans Ende angehängt (nicht dazwischen!) - "create or
  -- replace view" erlaubt nur das Anhängen neuer Spalten am Ende, sonst
  -- Fehler 42P16 "cannot change name of view column".
  -- Bisherige Arbeitstage in DEUTSCHLAND im Kalenderjahr laut SV-Fragebogen
  -- (nicht Ausland - das zählt nicht für die Tage-Grenze, siehe Kommentar
  -- bei sv_fragebogen.vorbeschaeftigung_deutschland_tage). Rechtlich zählt
  -- das Kalenderjahr über ALLE deutschen Arbeitgeber zusammen, nicht nur
  -- die Tage bei uns (Nutzer-Korrektur 2026-08-08).
  coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as vorbeschaeftigung_deutschland_tage,
  w.arbeitstage_ueber0 + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as kombinierte_tage,
  greatest(
    0,
    90 - (w.arbeitstage_ueber0 + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
  ) as rest_bis_90_tage_kombiniert
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden > 0) as erster_arbeitstag,
    max(we.datum) filter (where we.stunden > 0) as letzter_arbeitstag,
    count(distinct we.datum) filter (where we.stunden > 0) as arbeitstage_ueber0
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
-- Bewusst direkt gegen die Rohtabelle (nicht über die security_invoker-
-- Sicht sv_fragebogen_auswertung), damit hier eindeutig mit den Rechten
-- des Sicht-Eigentümers gelesen wird, unabhängig von der Rolle des
-- aufrufenden Nutzers - exakt wie beim Lesen von work_entries/employees
-- oben in dieser Sicht.
left join lateral (
  select f.vorbeschaeftigung_deutschland_tage
  from sv_fragebogen f
  where f.employee_id = e.id and f.saison_jahr = w.saison_jahr
) fb on true
where w.erster_arbeitstag is not null
  -- Die 90-Tage-/15-Wochen-Regel ist die Obergrenze für SOZIALVERSICHERUNGS-
  -- FREIE Beschäftigung - für bereits sozialversicherungspflichtige Personen
  -- ist diese Prüfung gegenstandslos (Nutzer-Hinweis 2026-08-06).
  and e.abrechnungsart <> 'sozialversicherungspflichtig';

grant select on employee_sv_pruefung to authenticated;

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
-- steht "begruendung" hier hinter "storniert" statt davor.
create or replace view employee_vorschuss_historie as
select
  ar.employee_id,
  a.datum,
  ar.anteil as betrag,
  a.zahlungsart,
  a.storniert,
  a.begruendung
from advance_recipients ar
join advances a on a.id = ar.advance_id;

grant select on employee_vorschuss_historie to authenticated;

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
alter table auszahlungsbelege enable row level security;
alter table verpflegungssaetze enable row level security;
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

alter view employees_public set (security_invoker = true);
create policy "employees_read_for_logged_in" on employees for select
  using (auth.uid() is not null);
-- Spalten-Ebene zusätzlich einschränken: Rollen ohne HR/Admin sehen über die
-- direkte Tabelle keine sensiblen Felder (SV-Nr., Steuer-ID, IBAN, BIC).
revoke select on employees from authenticated;
grant select (id, personal_nr, gruppe_nr, herkunft, nationalitaet, name, vorname,
  geburtsdatum, ort, land, stundenlohn, saison_beginn, saison_ende, aktiv)
  on employees to authenticated;

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
create policy "verpflegungssaetze_rw" on verpflegungssaetze for all
  using (is_admin()) with check (is_admin());
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
