-- ============================================================================
-- Migration 2026-09-18: Herkunfts-Zimmerplanung
--
--   unterkunft_herkunft_plan        - je (Saison, Herkunft) die Planzahl.
--   unterkunft_herkunft_kontingent  - je (Saison, Herkunft) die reservierten
--                                     Wohneinheiten (Stammplätze), geordnet.
--   unterkunft_herkunft_abgleich    - Sicht: Soll ↔ erfasst/verplant/eingezogen.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

create table if not exists unterkunft_herkunft_plan (
  saison_jahr int not null,
  herkunft text not null references herkuenfte (wert) on delete restrict,
  soll_anzahl int not null default 0 check (soll_anzahl >= 0),
  anreise_hinweis text,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  primary key (saison_jahr, herkunft)
);

create table if not exists unterkunft_herkunft_kontingent (
  id bigint generated always as identity primary key,
  saison_jahr int not null,
  herkunft text not null references herkuenfte (wert) on delete restrict,
  wohneinheit_id bigint not null
    references unterkunft_wohneinheit (id) on delete cascade,
  reihenfolge int not null default 0,
  notiz text,
  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (saison_jahr, herkunft, wohneinheit_id)
);
create index if not exists idx_unterkunft_herkunft_kontingent_saison
  on unterkunft_herkunft_kontingent (saison_jahr, herkunft);

drop trigger if exists trg_unterkunft_herkunft_plan_updated_at
  on unterkunft_herkunft_plan;
create trigger trg_unterkunft_herkunft_plan_updated_at
  before update on unterkunft_herkunft_plan
  for each row execute function set_updated_at();
drop trigger if exists trg_unterkunft_herkunft_kontingent_updated_at
  on unterkunft_herkunft_kontingent;
create trigger trg_unterkunft_herkunft_kontingent_updated_at
  before update on unterkunft_herkunft_kontingent
  for each row execute function set_updated_at();

alter table unterkunft_herkunft_plan enable row level security;
alter table unterkunft_herkunft_kontingent enable row level security;

drop policy if exists "unterkunft_herkunft_plan_select" on unterkunft_herkunft_plan;
create policy "unterkunft_herkunft_plan_select" on unterkunft_herkunft_plan for select
  using (current_role_name() in ('admin', 'hr', 'management'));
drop policy if exists "unterkunft_herkunft_plan_write" on unterkunft_herkunft_plan;
create policy "unterkunft_herkunft_plan_write" on unterkunft_herkunft_plan for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

drop policy if exists "unterkunft_herkunft_kontingent_select"
  on unterkunft_herkunft_kontingent;
create policy "unterkunft_herkunft_kontingent_select"
  on unterkunft_herkunft_kontingent for select
  using (current_role_name() in ('admin', 'hr', 'hausmeister', 'management'));
drop policy if exists "unterkunft_herkunft_kontingent_write"
  on unterkunft_herkunft_kontingent;
create policy "unterkunft_herkunft_kontingent_write"
  on unterkunft_herkunft_kontingent for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create or replace view unterkunft_herkunft_abgleich as
select
  p.saison_jahr,
  p.herkunft,
  p.soll_anzahl,
  p.anreise_hinweis,
  coalesce(k.erfasst, 0)::int as erfasst,
  coalesce(zu.verplant, 0)::int as verplant,
  coalesce(bl.eingezogen, 0)::int as eingezogen
from unterkunft_herkunft_plan p
left join (
  select
    herkunft,
    coalesce(extract(year from geplante_ankunft)::int,
             extract(year from current_date)::int) as saison_jahr,
    count(*) as erfasst
  from personal_kandidaten
  where status in ('geplant', 'anreiseliste') and herkunft is not null
  group by 1, 2
) k on k.herkunft = p.herkunft and k.saison_jahr = p.saison_jahr
left join (
  select e.herkunft, extract(year from z.geplant_ab)::int as saison_jahr,
         count(*) as verplant
  from unterkunft_zuordnung z
  join employees e on e.id = z.employee_id
  where z.status = 'geplant' and e.herkunft is not null
  group by 1, 2
) zu on zu.herkunft = p.herkunft and zu.saison_jahr = p.saison_jahr
left join (
  select e.herkunft, extract(year from b.von)::int as saison_jahr,
         count(*) as eingezogen
  from unterkunft_belegung b
  join employees e on e.id = b.employee_id
  where b.bis is null and e.herkunft is not null
  group by 1, 2
) bl on bl.herkunft = p.herkunft and bl.saison_jahr = p.saison_jahr;
alter view unterkunft_herkunft_abgleich set (security_invoker = true);
grant select on unterkunft_herkunft_abgleich to authenticated;
