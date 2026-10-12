-- ============================================================================
-- Migration 2026-10-12: Erntewirtschaft - Waage/Scan-Grundlage (Teil 1)
--
-- Erster Baustein des Erntewirtschaft-Moduls (docs/erntewirtschaft-plan.md,
-- Teil E), bewusst klein gehalten: nur das, was der Waagen-Agent
-- (tools/ernte-waage-agent/) zum Testen braucht - Hofwaage(n), Badge-/
-- Kisten-Register, Scan-/Wiege-Rohprotokoll. Maschinen, GPS-Positionen,
-- Kisten-Zyklen, ernte_konfig, die Auswertungs-Sichten und der
-- pg_cron-Processor folgen in weiteren Migrationen, sobald die
-- SpidertrackBox-Seite ansteht (Teil A/B/E im Plan).
--
-- Rolle "erntewirtschaft" existiert schon (migration_2026-08-09_rolle_*).
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Hofwaage(n)
-- --------------------------------------------------------------------------
create table if not exists ernte_waage (
  id bigint generated always as identity primary key,
  name text not null,
  standort text,
  ip text,
  port integer,
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ernte_waage_updated_at on ernte_waage;
create trigger trg_ernte_waage_updated_at before update on ernte_waage
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- 2. Badge-/Kisten-Register. Enthaelt praktisch nur Mitarbeiter-Badges
--    (P-...) - ein K-...-Code braucht wegen des Typ-Praefixes strukturell
--    keine eigene Zeile (siehe Plan Teil E), bleibt aber fuer manuell
--    markierte Einzelkisten nutzbar.
-- --------------------------------------------------------------------------
create table if not exists ernte_tag (
  uid text primary key,
  art text not null check (art in ('person', 'kiste')),
  employee_id uuid references employees (id) on delete set null,
  kiste_nr text,
  aktiv boolean not null default true,
  notiz text,
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ernte_tag_updated_at on ernte_tag;
create trigger trg_ernte_tag_updated_at before update on ernte_tag
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- 3. Scan-/Wiege-Rohprotokoll (append-only, nur Service-Key). Quelle fuer
--    alles Abgeleitete (Kisten-Zyklen, Statistik) - siehe Plan Teil E.
--    maschine_id bewusst noch ohne FK (ernte_maschine kommt erst mit der
--    SpidertrackBox-Migration).
-- --------------------------------------------------------------------------
create table if not exists ernte_scan (
  id bigint generated always as identity primary key,
  empfangen_am timestamptz not null default now(),
  quelle text not null check (quelle in ('maschine', 'waage')),
  maschine_id bigint,
  waage_id bigint references ernte_waage (id) on delete set null,
  tag_uid text,
  ereignis text not null check (
    ereignis in ('person_login', 'kiste', 'gewicht', 'batterie', 'heartbeat')
  ),
  zeitpunkt timestamptz not null,
  lat double precision,
  lng double precision,
  gewicht_kg numeric(7, 2),
  roh jsonb,
  verarbeitet_am timestamptz,
  verarbeitung_fehler text
);

create index if not exists idx_ernte_scan_offen
  on ernte_scan (verarbeitet_am) where verarbeitet_am is null;
create index if not exists idx_ernte_scan_quelle_zeit
  on ernte_scan (quelle, zeitpunkt desc);
create index if not exists idx_ernte_scan_tag
  on ernte_scan (tag_uid, ereignis, verarbeitet_am desc);

-- --------------------------------------------------------------------------
-- 4. RLS (Muster wie fahrzeug, Plan Teil E)
-- --------------------------------------------------------------------------
alter table ernte_waage enable row level security;
alter table ernte_tag enable row level security;
alter table ernte_scan enable row level security;

drop policy if exists "ernte_waage_select" on ernte_waage;
create policy "ernte_waage_select" on ernte_waage for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung'));
drop policy if exists "ernte_waage_write" on ernte_waage;
create policy "ernte_waage_write" on ernte_waage for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

drop policy if exists "ernte_tag_select" on ernte_tag;
create policy "ernte_tag_select" on ernte_tag for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung'));
drop policy if exists "ernte_tag_write" on ernte_tag;
create policy "ernte_tag_write" on ernte_tag for all
  using (current_role_name() in ('admin', 'hr', 'erntewirtschaft', 'zeiterfassung'))
  with check (current_role_name() in ('admin', 'hr', 'erntewirtschaft', 'zeiterfassung'));

-- KEINE Insert-Policy: ernte_scan wird ausschliesslich vom Waagen-Agenten mit
-- dem Service-Key geschrieben (umgeht RLS), analog zu fahrzeug_position.
drop policy if exists "ernte_scan_select" on ernte_scan;
create policy "ernte_scan_select" on ernte_scan for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung'));

grant select, insert, update, delete on ernte_waage to authenticated;
grant select, insert, update, delete on ernte_tag to authenticated;
grant select on ernte_scan to authenticated;

-- --------------------------------------------------------------------------
-- 5. Eine Hofwaage anlegen, damit der Agent gleich eine waage_id hat.
--    IP/Port bei Bedarf in der App unter ernte_waage anpassen.
-- --------------------------------------------------------------------------
insert into ernte_waage (name, standort, ip, port)
select 'Hofwaage', 'Hof', '192.168.2.32', 8000
where not exists (select 1 from ernte_waage);
