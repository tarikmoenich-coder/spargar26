-- ============================================================================
-- Migration 2026-09-25: Fahrzeuge-Modul (GPS-Flotte)
--
-- Fuhrpark von Mömmel Agrar: Fahrzeug-Stammdaten (Kennzeichen, Fahrer,
-- km-Stand, nächste HU), Zuordnung zu GPS-Trackern und eine Positions-
-- Zeitreihe. Die Positionen füllt ein kleiner Node-Poller auf dem
-- Hetzner-Server (neben Traccar) über den Supabase-Service-Key -
-- fahrzeug_position hat deshalb bewusst KEINE Insert-Policy. Die App liest
-- nur (Anon-Key + RLS), wie bei allen anderen Modulen.
--
-- Rollen Stufe 1: admin/hr/management lesen, admin/hr pflegen Stammdaten.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Fahrzeug-Stammdaten
-- --------------------------------------------------------------------------
create table if not exists fahrzeug (
  id bigint generated always as identity primary key,
  kennzeichen text,
  bezeichnung text not null,
  -- frei, üblich: pkw | transporter | traktor | anhaenger | sonstiges
  typ text,
  fahrer_employee_id uuid references employees (id) on delete set null,
  km_stand integer,
  km_stand_am date,
  hu_faellig date,
  vin text,
  baujahr integer,
  notiz text,
  aktiv boolean not null default true,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_fahrzeug_updated_at on fahrzeug;
create trigger trg_fahrzeug_updated_at before update on fahrzeug
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- 2. GPS-Tracker <-> Fahrzeug. traccar_unique_id = die uniqueId aus Traccar
--    (bei GT06/watch die 10-stellige Geräte-ID, bei Teltonika die IMEI).
--    Der Poller pflegt traccar_device_id/bezeichnung/status/zuletzt_gesehen
--    (+ geraetetyp, solange null); fahrzeug_id setzt die App.
-- --------------------------------------------------------------------------
create table if not exists fahrzeug_tracker (
  traccar_unique_id text primary key,
  fahrzeug_id bigint references fahrzeug (id) on delete set null,
  traccar_device_id bigint,
  -- fmb920 | tk905b | ... (vom Poller aus position.protocol, falls null)
  geraetetyp text,
  bezeichnung text,
  status text,
  zuletzt_gesehen timestamptz,
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- max. ein Tracker je Fahrzeug (mehrere "nicht zugeordnete" mit NULL erlaubt)
create unique index if not exists idx_fahrzeug_tracker_fahrzeug
  on fahrzeug_tracker (fahrzeug_id) where fahrzeug_id is not null;

drop trigger if exists trg_fahrzeug_tracker_updated_at on fahrzeug_tracker;
create trigger trg_fahrzeug_tracker_updated_at before update on fahrzeug_tracker
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- 3. Positions-Zeitreihe (append-only, kein updated_at). fahrzeug_id wird
--    beim Insert aus fahrzeug_tracker denormalisiert (kann null sein, wenn
--    der Tracker noch keinem Fahrzeug zugeordnet ist).
-- --------------------------------------------------------------------------
create table if not exists fahrzeug_position (
  id bigint generated always as identity primary key,
  traccar_unique_id text not null,
  fahrzeug_id bigint,
  zeitpunkt timestamptz not null,
  server_zeit timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  gueltig boolean not null default true,
  speed_kmh real,
  kurs real,
  hoehe real,
  zuendung boolean,
  bewegung boolean,
  batterie_prozent real,
  gesamt_km real,
  attribute jsonb,
  unique (traccar_unique_id, zeitpunkt)
);
create index if not exists idx_fahrzeug_position_fahrzeug
  on fahrzeug_position (fahrzeug_id, zeitpunkt desc);
create index if not exists idx_fahrzeug_position_tracker
  on fahrzeug_position (traccar_unique_id, zeitpunkt desc);

-- --------------------------------------------------------------------------
-- 4. Poller-State (eine Zeile) - Frist fürs Aufräumen alter Positionen.
-- --------------------------------------------------------------------------
create table if not exists fahrzeug_poller_state (
  id int primary key default 1 check (id = 1),
  letzte_bereinigung timestamptz
);
insert into fahrzeug_poller_state (id) values (1) on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- 5. Übersicht: ein Fahrzeug je Zeile + Fahrer + Tracker + letzte Position.
-- --------------------------------------------------------------------------
create or replace view fahrzeug_uebersicht as
select
  f.id,
  f.kennzeichen,
  f.bezeichnung,
  f.typ,
  f.fahrer_employee_id,
  f.km_stand,
  f.km_stand_am,
  f.hu_faellig,
  f.vin,
  f.baujahr,
  f.notiz,
  f.aktiv,
  e.name as fahrer_name,
  e.vorname as fahrer_vorname,
  e.personal_nr as fahrer_personal_nr,
  t.traccar_unique_id,
  t.geraetetyp,
  t.status as tracker_status,
  t.zuletzt_gesehen as tracker_zuletzt_gesehen,
  p.zeitpunkt as pos_zeitpunkt,
  p.lat,
  p.lng,
  p.speed_kmh,
  p.kurs,
  p.zuendung,
  p.bewegung,
  p.batterie_prozent,
  p.gesamt_km
from fahrzeug f
left join employees e on e.id = f.fahrer_employee_id
left join fahrzeug_tracker t on t.fahrzeug_id = f.id
left join lateral (
  select *
  from fahrzeug_position pp
  where pp.fahrzeug_id = f.id
  order by pp.zeitpunkt desc
  limit 1
) p on true;

alter view fahrzeug_uebersicht set (security_invoker = true);
grant select on fahrzeug_uebersicht to authenticated;

-- --------------------------------------------------------------------------
-- 6. RLS
-- --------------------------------------------------------------------------
alter table fahrzeug enable row level security;
alter table fahrzeug_tracker enable row level security;
alter table fahrzeug_position enable row level security;
alter table fahrzeug_poller_state enable row level security;

drop policy if exists "fahrzeug_select" on fahrzeug;
create policy "fahrzeug_select" on fahrzeug for select
  using (current_role_name() in ('admin', 'hr', 'management'));
drop policy if exists "fahrzeug_write" on fahrzeug;
create policy "fahrzeug_write" on fahrzeug for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

drop policy if exists "fahrzeug_tracker_select" on fahrzeug_tracker;
create policy "fahrzeug_tracker_select" on fahrzeug_tracker for select
  using (current_role_name() in ('admin', 'hr', 'management'));
drop policy if exists "fahrzeug_tracker_write" on fahrzeug_tracker;
create policy "fahrzeug_tracker_write" on fahrzeug_tracker for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- KEINE Insert/Update/Delete-Policy: geschrieben wird ausschliesslich vom
-- Poller mit dem Service-Key (umgeht RLS). Nur Lesen für die Modul-Rollen.
drop policy if exists "fahrzeug_position_select" on fahrzeug_position;
create policy "fahrzeug_position_select" on fahrzeug_position for select
  using (current_role_name() in ('admin', 'hr', 'management'));

drop policy if exists "fahrzeug_poller_state_select" on fahrzeug_poller_state;
create policy "fahrzeug_poller_state_select" on fahrzeug_poller_state for select
  using (current_role_name() in ('admin', 'hr', 'management'));

grant select, insert, update, delete on fahrzeug to authenticated;
grant select, insert, update, delete on fahrzeug_tracker to authenticated;
grant select on fahrzeug_position to authenticated;
grant select on fahrzeug_poller_state to authenticated;
