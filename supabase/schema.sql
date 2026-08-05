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

create or replace function current_role_name()
returns user_role language sql stable as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable as $$
  select current_role_name() = 'admin';
$$;

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
  gesperrt_von uuid references profiles (id),
  gesperrt_am timestamptz,
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

-- ---------------------------------------------------------------------------
-- 6. Verpflegungs-/Wohnen-Sätze (ADR-007: versioniert je Saisonjahr, über
--    die Einstellungen-Seite konfigurierbar, Default 10€/Tag je Kategorie)
-- ---------------------------------------------------------------------------
create table verpflegungssaetze (
  saison_jahr int primary key,
  verpflegung numeric(6, 2) not null default 10.00, -- € pro Anwesenheitstag
  wohnen numeric(6, 2) not null default 10.00        -- € pro Anwesenheitstag
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

  select belegnummer, zahlungsart into v_belegnummer, v_zahlungsart
  from advances where id = p_advance_id;

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
  ) as kritisch
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
where w.erster_arbeitstag is not null;

grant select on employee_sv_pruefung to authenticated;

-- ---------------------------------------------------------------------------
-- 12f. View: Vorschuss-Historie je Mitarbeiter für die "Suche"-Seite -
--      bewusst schmal (nur Datum/Betrag/Zahlungsart, keine Begründung/
--      Bearbeiter/Belegnummer), damit auch Rollen wie zeiterfassung, die
--      die volle advances-Tabelle nicht lesen dürfen, hier Auskunft geben
--      können ("darf nicht nur der Chef wissen").
-- ---------------------------------------------------------------------------
create or replace view employee_vorschuss_historie as
select
  ar.employee_id,
  a.datum,
  ar.anteil as betrag,
  a.zahlungsart,
  a.storniert
from advance_recipients ar
join advances a on a.id = ar.advance_id;

grant select on employee_vorschuss_historie to authenticated;

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

alter view employees_public set (security_invoker = true);
create policy "employees_read_for_logged_in" on employees for select
  using (auth.uid() is not null);
-- Spalten-Ebene zusätzlich einschränken: Rollen ohne HR/Admin sehen über die
-- direkte Tabelle keine sensiblen Felder (SV-Nr., Steuer-ID, IBAN, BIC).
revoke select on employees from authenticated;
grant select (id, personal_nr, gruppe_nr, herkunft, nationalitaet, name, vorname,
  geburtsdatum, ort, land, stundenlohn, saison_beginn, saison_ende, aktiv)
  on employees to authenticated;

-- work_entries: zeiterfassung/admin/hr/lohnabrechnung dürfen schreiben,
-- alle eingeloggten Rollen dürfen lesen.
create policy "work_entries_select" on work_entries for select
  using (auth.uid() is not null);
create policy "work_entries_write" on work_entries for insert
  with check (current_role_name() in ('admin', 'zeiterfassung', 'hr'));
create policy "work_entries_update" on work_entries for update
  using (current_role_name() in ('admin', 'zeiterfassung', 'hr'));

-- periods: nur admin sperrt/entsperrt, alle lesen
create policy "periods_select" on periods for select using (auth.uid() is not null);
create policy "periods_admin_write" on periods for all
  using (is_admin()) with check (is_admin());

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
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
create policy "advances_write" on advances for insert
  with check (current_role_name() in ('admin', 'kasse'));
create policy "advances_update" on advances for update
  using (current_role_name() in ('admin', 'kasse'));
create policy "advance_recipients_rw" on advance_recipients for all
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung', 'pruefer'))
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
  using (current_role_name() in ('admin', 'kasse'));
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
