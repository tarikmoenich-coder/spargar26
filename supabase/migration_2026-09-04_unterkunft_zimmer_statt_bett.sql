-- ============================================================================
-- Migration 2026-09-04: Unterkunft - Belegung aufs Zimmer statt aufs Bett
--
-- Nutzer-Entscheidung: eine bettgenaue Zuordnung ist nicht noetig. Es reicht,
-- je Zimmer die Anzahl Schlafplaetze zu kennen (unterkunft_zimmer.bettenzahl)
-- und Personen dem ZIMMER zuzuordnen.
--   * unterkunft_belegung haengt am Zimmer (Spalte zimmer_id) statt am Bett.
--   * unterkunft_bett (+ Sammelanlage-Funktion) faellt weg.
--   * bettenzahl wird Pflicht (Default 0) und ist die Kapazitaet.
--   * Ueberbuchung wird NICHT mehr hart verhindert (frueher GIST-EXCLUDE je
--     Bett) - Grundriss/Kopfzeile zeigen sie nur noch als Warnung.
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Laeuft NACH den
-- Migrationen 2026-08-31 / 09-01 / 09-02 / 09-03.
-- ============================================================================

-- 1. unterkunft_belegung: zimmer_id statt bett_id -----------------------------
alter table unterkunft_belegung
  add column zimmer_id bigint references unterkunft_zimmer (id) on delete restrict;

update unterkunft_belegung b
set zimmer_id = bt.zimmer_id
from unterkunft_bett bt
where bt.id = b.bett_id;

alter table unterkunft_belegung alter column zimmer_id set not null;
alter table unterkunft_belegung drop constraint unterkunft_belegung_kein_doppel;
drop index if exists idx_unterkunft_belegung_bett;
alter table unterkunft_belegung drop column bett_id;
create index idx_unterkunft_belegung_zimmer on unterkunft_belegung (zimmer_id);

-- 2. bettenzahl wird Pflicht-Kapazitaet -------------------------------------
update unterkunft_zimmer z
set bettenzahl = coalesce(
  (select count(*) from unterkunft_bett b where b.zimmer_id = z.id and b.aktiv),
  0
)
where bettenzahl is null;
update unterkunft_zimmer set bettenzahl = 0 where bettenzahl is null;
alter table unterkunft_zimmer alter column bettenzahl set default 0;
alter table unterkunft_zimmer alter column bettenzahl set not null;

-- 3. Betten-Tabelle + Sichten weg -----------------------------------------
drop view if exists unterkunft_belegung_person;
drop view if exists unterkunft_belegung_aktuell;
drop view if exists unterkunft_zimmer_uebersicht;
drop view if exists unterkunft_wohneinheit_uebersicht;
drop table if exists unterkunft_bett cascade;
drop function if exists unterkunft_bett_sammelanlage(bigint, int);

-- 4. Sichten neu (ohne Bett) --------------------------------------------------
create view unterkunft_belegung_aktuell as
select
  b.id, b.zimmer_id, z.wohneinheit_id, b.employee_id,
  e.personal_nr, e.name, e.vorname, e.herkunft,
  b.von, b.bis, b.notiz
from unterkunft_belegung b
join unterkunft_zimmer z on z.id = b.zimmer_id
join employees e on e.id = b.employee_id
where b.von <= current_date and (b.bis is null or b.bis >= current_date);
alter view unterkunft_belegung_aktuell set (security_invoker = true);
grant select on unterkunft_belegung_aktuell to authenticated;

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
  coalesce(zu.schwebend, 0)::int as schwebend,
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
  select zimmer_id, count(*) as schwebend
  from unterkunft_zuordnung
  where status = 'schwebend' and zimmer_id is not null
  group by zimmer_id
) zu on zu.zimmer_id = z.id;
alter view unterkunft_zimmer_uebersicht set (security_invoker = true);
grant select on unterkunft_zimmer_uebersicht to authenticated;

create view unterkunft_wohneinheit_uebersicht as
select
  w.id as wohneinheit_id, w.name, w.etage_label, w.reihenfolge, w.aktiv,
  g.id as gebaeude_id, g.name as gebaeude_name,
  count(z.id)::int as zimmer,
  coalesce(sum(z.bettenzahl), 0)::int as betten,
  coalesce(sum(bl.belegt), 0)::int as fest,
  coalesce(zu.schwebend, 0)::int as schwebend,
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
  select wohneinheit_id, count(*) as schwebend
  from unterkunft_zuordnung
  where status = 'schwebend'
  group by wohneinheit_id
) zu on zu.wohneinheit_id = w.id
group by w.id, w.name, w.etage_label, w.reihenfolge, w.aktiv, g.id, g.name, zu.schwebend;
alter view unterkunft_wohneinheit_uebersicht set (security_invoker = true);
grant select on unterkunft_wohneinheit_uebersicht to authenticated;

create view unterkunft_belegung_person as
select
  b.id, b.employee_id, b.von, b.bis, b.notiz,
  z.id as zimmer_id, z.nummer as zimmer_nummer, z.wohneinheit_id,
  w.name as wohneinheit_name,
  g.id as gebaeude_id, g.name as gebaeude_name
from unterkunft_belegung b
join unterkunft_zimmer z on z.id = b.zimmer_id
left join unterkunft_wohneinheit w on w.id = z.wohneinheit_id
join unterkunft_gebaeude g on g.id = z.gebaeude_id;
alter view unterkunft_belegung_person set (security_invoker = true);
grant select on unterkunft_belegung_person to authenticated;
