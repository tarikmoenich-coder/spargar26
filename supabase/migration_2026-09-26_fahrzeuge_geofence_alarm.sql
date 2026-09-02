-- ============================================================================
-- Migration 2026-09-26: Fahrzeuge Stufe 2 - Geofences, Hofzeiten, Alarm
--
-- Geofences (in Traccar gezeichnet) werden vom Poller gespiegelt. Aus den
-- Traccar-Events geofenceEnter/geofenceExit/deviceMoving baut der Poller ein
-- Ereignis-Log; Ereignisse ausserhalb der (in der App einstellbaren)
-- Arbeitszeit werden als alarm_relevant markiert und per Telegram gemeldet.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Geofences (Spiegel der Traccar-Geofences; ist_hof pflegt die App)
-- --------------------------------------------------------------------------
create table if not exists fahrzeug_geofence (
  traccar_geofence_id bigint primary key,
  name text,
  beschreibung text,
  -- Traccar-WKT, z.B. "CIRCLE (49.85 8.65, 150)" oder "POLYGON ((...))"
  area text,
  ist_hof boolean not null default true,
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_fahrzeug_geofence_updated_at on fahrzeug_geofence;
create trigger trg_fahrzeug_geofence_updated_at before update on fahrzeug_geofence
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- 2. Globales Arbeitszeit-Fenster je Wochentag (0=Mo .. 6=So)
-- --------------------------------------------------------------------------
create table if not exists fahrzeug_arbeitszeit (
  wochentag int primary key check (wochentag between 0 and 6),
  aktiv boolean not null default true,
  von time not null default '06:00',
  bis time not null default '18:00',
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_fahrzeug_arbeitszeit_updated_at on fahrzeug_arbeitszeit;
create trigger trg_fahrzeug_arbeitszeit_updated_at before update on fahrzeug_arbeitszeit
  for each row execute function set_updated_at();

insert into fahrzeug_arbeitszeit (wochentag, aktiv, von, bis) values
  (0, true,  '06:00', '18:00'),
  (1, true,  '06:00', '18:00'),
  (2, true,  '06:00', '18:00'),
  (3, true,  '06:00', '18:00'),
  (4, true,  '06:00', '18:00'),
  (5, true,  '06:00', '14:00'),
  (6, false, '06:00', '18:00')
on conflict (wochentag) do nothing;

-- --------------------------------------------------------------------------
-- 3. Ereignis-Log (Poller, append-only)
-- --------------------------------------------------------------------------
create table if not exists fahrzeug_ereignis (
  traccar_event_id bigint primary key,
  traccar_unique_id text not null,
  fahrzeug_id bigint,
  typ text not null,
  zeitpunkt timestamptz not null,
  geofence_id bigint,
  geofence_name text,
  lat double precision,
  lng double precision,
  ausserhalb_arbeitszeit boolean,
  alarm_relevant boolean not null default false,
  alarm_gesendet_am timestamptz,
  attribute jsonb
);
create index if not exists idx_fahrzeug_ereignis_fahrzeug
  on fahrzeug_ereignis (fahrzeug_id, zeitpunkt desc);
create index if not exists idx_fahrzeug_ereignis_alarm_offen
  on fahrzeug_ereignis (zeitpunkt)
  where alarm_relevant and alarm_gesendet_am is null;

-- --------------------------------------------------------------------------
-- 4. Poller-State: bis wann Events schon abgeholt wurden
-- --------------------------------------------------------------------------
alter table fahrzeug_poller_state
  add column if not exists letzter_event_abruf timestamptz;

-- --------------------------------------------------------------------------
-- 5. View: Hofzeiten je Fahrzeug/Tag (nur Ereignisse an "Hof"-Geofences)
-- --------------------------------------------------------------------------
create or replace view fahrzeug_hofzeit_tag as
select
  e.fahrzeug_id,
  (e.zeitpunkt at time zone 'Europe/Berlin')::date as tag,
  min(e.zeitpunkt) filter (where e.typ = 'geofenceExit') as erste_ausfahrt,
  max(e.zeitpunkt) filter (where e.typ = 'geofenceEnter') as letzte_rueckkehr,
  count(*) filter (where e.typ = 'geofenceExit') as ausfahrten,
  bool_or(e.alarm_relevant) as auffaellig
from fahrzeug_ereignis e
join fahrzeug_geofence g
  on g.traccar_geofence_id = e.geofence_id and g.ist_hof
where e.fahrzeug_id is not null
group by e.fahrzeug_id, (e.zeitpunkt at time zone 'Europe/Berlin')::date;

alter view fahrzeug_hofzeit_tag set (security_invoker = true);
grant select on fahrzeug_hofzeit_tag to authenticated;

-- --------------------------------------------------------------------------
-- 6. RLS
-- --------------------------------------------------------------------------
alter table fahrzeug_geofence enable row level security;
alter table fahrzeug_arbeitszeit enable row level security;
alter table fahrzeug_ereignis enable row level security;

drop policy if exists "fahrzeug_geofence_select" on fahrzeug_geofence;
create policy "fahrzeug_geofence_select" on fahrzeug_geofence for select
  using (current_role_name() in ('admin', 'hr', 'management'));
drop policy if exists "fahrzeug_geofence_write" on fahrzeug_geofence;
create policy "fahrzeug_geofence_write" on fahrzeug_geofence for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

drop policy if exists "fahrzeug_arbeitszeit_select" on fahrzeug_arbeitszeit;
create policy "fahrzeug_arbeitszeit_select" on fahrzeug_arbeitszeit for select
  using (current_role_name() in ('admin', 'hr', 'management'));
drop policy if exists "fahrzeug_arbeitszeit_write" on fahrzeug_arbeitszeit;
create policy "fahrzeug_arbeitszeit_write" on fahrzeug_arbeitszeit for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- kein Write für authenticated: nur der Poller (Service-Key) schreibt
drop policy if exists "fahrzeug_ereignis_select" on fahrzeug_ereignis;
create policy "fahrzeug_ereignis_select" on fahrzeug_ereignis for select
  using (current_role_name() in ('admin', 'hr', 'management'));

grant select, insert, update, delete on fahrzeug_geofence to authenticated;
grant select, insert, update, delete on fahrzeug_arbeitszeit to authenticated;
grant select on fahrzeug_ereignis to authenticated;
