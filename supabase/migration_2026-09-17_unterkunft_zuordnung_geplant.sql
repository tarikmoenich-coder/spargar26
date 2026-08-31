-- ============================================================================
-- Migration 2026-09-17: unterkunft_zuordnung Status 'schwebend' -> 'geplant'
--
-- Vokabular vereinheitlichen: der Planer *plant* eine Person für ein Haus →
-- Status 'geplant'; beim Einzug wird daraus eine feste Belegung. Die
-- Sicht-Spalte `schwebend` heißt entsprechend jetzt `geplant`.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug).
-- ============================================================================

-- 1. Constraint lockern, Daten umstellen, Constraint + Default neu
alter table unterkunft_zuordnung
  drop constraint if exists unterkunft_zuordnung_status_check;
update unterkunft_zuordnung set status = 'geplant' where status = 'schwebend';
alter table unterkunft_zuordnung
  add constraint unterkunft_zuordnung_status_check
  check (status in ('geplant', 'erledigt', 'storniert'));
alter table unterkunft_zuordnung alter column status set default 'geplant';

-- 2. Unique-Index (max. eine offene Zuordnung je Person)
drop index if exists uq_unterkunft_zuordnung_offen;
create unique index uq_unterkunft_zuordnung_offen
  on unterkunft_zuordnung (employee_id) where status = 'geplant';

-- 3. Sichten neu

create or replace view unterkunft_zuordnung_offen as
select
  zu.id, zu.employee_id, zu.wohneinheit_id, zu.zimmer_id, zu.geplant_ab, zu.notiz,
  e.personal_nr, e.name, e.vorname, e.herkunft,
  w.name as wohneinheit_name, w.etage_label, w.gebaeude_id,
  g.name as gebaeude_name, z.nummer as zimmer_nummer
from unterkunft_zuordnung zu
join employees e on e.id = zu.employee_id
join unterkunft_wohneinheit w on w.id = zu.wohneinheit_id
join unterkunft_gebaeude g on g.id = w.gebaeude_id
left join unterkunft_zimmer z on z.id = zu.zimmer_id
where zu.status = 'geplant';
alter view unterkunft_zuordnung_offen set (security_invoker = true);
grant select on unterkunft_zuordnung_offen to authenticated;

create or replace view unterkunft_person_offen as
select
  e.id as employee_id, e.personal_nr, e.name, e.vorname, e.herkunft,
  k.geplante_ankunft, (k.status = 'anreiseliste') as auf_anreiseliste
from employees e
left join personal_kandidaten k
  on k.aktivierter_employee_id = e.id and k.status = 'anreiseliste'
where e.aktiv
  and not exists (
    select 1 from unterkunft_zuordnung zu
    where zu.employee_id = e.id and zu.status = 'geplant'
  )
  and not exists (
    select 1 from unterkunft_belegung b
    where b.employee_id = e.id
      and b.von <= current_date and (b.bis is null or b.bis >= current_date)
  );
alter view unterkunft_person_offen set (security_invoker = true);
grant select on unterkunft_person_offen to authenticated;

-- Spalte schwebend -> geplant: Umbenennen geht nur über drop + create.
drop view if exists unterkunft_zimmer_uebersicht;
create view unterkunft_zimmer_uebersicht as
select
  z.id as zimmer_id, z.nummer, z.art, z.aktiv, z.notiz,
  z.gesperrt, z.sperr_grund,
  z.wohneinheit_id, w.name as wohneinheit_name, w.etage_label,
  w.reihenfolge as wohneinheit_reihenfolge,
  z.plan_x, z.plan_y, z.plan_w, z.plan_h,
  g.id as gebaeude_id, g.name as gebaeude_name,
  z.bettenzahl as betten,
  coalesce(bl.belegt, 0)::int as belegt,
  greatest(z.bettenzahl - coalesce(bl.belegt, 0), 0)::int as frei,
  coalesce(zu.geplant, 0)::int as geplant,
  lk.letzte_kontrolle_am, lk.letzte_kontrolle_typ,
  coalesce(m.offene_maengel, 0)::int as offene_maengel
from unterkunft_zimmer z
join unterkunft_gebaeude g on g.id = z.gebaeude_id
left join unterkunft_wohneinheit w on w.id = z.wohneinheit_id
left join lateral (
  select count(*) as belegt
  from unterkunft_belegung b
  where b.zimmer_id = z.id
    and b.von <= current_date
    and (b.bis is null or b.bis >= current_date)
) bl on true
left join lateral (
  select v.abgeschlossen_am as letzte_kontrolle_am, v.typ as letzte_kontrolle_typ
  from unterkunft_vorgang v
  where v.zimmer_id = z.id and v.abgeschlossen and not v.storniert
  order by v.abgeschlossen_am desc
  limit 1
) lk on true
left join (
  select zimmer_id, count(*) as offene_maengel
  from unterkunft_mangel
  where status <> 'behoben'
  group by zimmer_id
) m on m.zimmer_id = z.id
left join (
  select zimmer_id, count(*) as geplant
  from unterkunft_zuordnung
  where status = 'geplant' and zimmer_id is not null
  group by zimmer_id
) zu on zu.zimmer_id = z.id;
alter view unterkunft_zimmer_uebersicht set (security_invoker = true);
grant select on unterkunft_zimmer_uebersicht to authenticated;

drop view if exists unterkunft_wohneinheit_uebersicht;
create view unterkunft_wohneinheit_uebersicht as
select
  w.id as wohneinheit_id, w.name, w.etage_label, w.reihenfolge, w.aktiv,
  g.id as gebaeude_id, g.name as gebaeude_name,
  count(z.id)::int as zimmer,
  coalesce(sum(z.bettenzahl), 0)::int as betten,
  coalesce(sum(bl.belegt), 0)::int as fest,
  coalesce(zu.geplant, 0)::int as geplant,
  greatest(coalesce(sum(z.bettenzahl), 0) - coalesce(sum(bl.belegt), 0), 0)::int as frei
from unterkunft_wohneinheit w
join unterkunft_gebaeude g on g.id = w.gebaeude_id
left join unterkunft_zimmer z
  on z.wohneinheit_id = w.id and z.aktiv and z.art = 'zimmer'
left join lateral (
  select count(*) as belegt
  from unterkunft_belegung b
  where b.zimmer_id = z.id
    and b.von <= current_date
    and (b.bis is null or b.bis >= current_date)
) bl on true
left join (
  select wohneinheit_id, count(*) as geplant
  from unterkunft_zuordnung
  where status = 'geplant'
  group by wohneinheit_id
) zu on zu.wohneinheit_id = w.id
group by w.id, w.name, w.etage_label, w.reihenfolge, w.aktiv, g.id, g.name, zu.geplant;
alter view unterkunft_wohneinheit_uebersicht set (security_invoker = true);
grant select on unterkunft_wohneinheit_uebersicht to authenticated;
