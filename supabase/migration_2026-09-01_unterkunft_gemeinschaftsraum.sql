-- ============================================================================
-- Migration 2026-09-01: Unterkunft - Gemeinschaftsräume im Grundriss
--
-- Nutzer-Vorgabe: Küche, Bad/WC und Flur sollen im Grundriss als Räume
-- platzierbar sein, damit der Plan vollständig ist. Sie sind KEINE
-- Schlafzimmer: keine Betten, keine Belegung/Zuordnung/Übergabe. Kontrollen
-- und Mängel gelten dagegen sehr wohl (die Küche wird kontrolliert).
--
-- Umsetzung: neue Spalte unterkunft_zimmer.art ('zimmer' | 'gemeinschaft').
-- Gemeinschaftsräume liegen wie Zimmer an einer Wohneinheit und tragen
-- plan_x/plan_y/plan_w/plan_h.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug, kein ALTER TYPE).
-- ============================================================================

alter table unterkunft_zimmer
  add column art text not null default 'zimmer'
    check (art in ('zimmer', 'gemeinschaft'));

-- ---------------------------------------------------------------------------
-- Sichten neu aufbauen (art mitliefern bzw. Zählung auf echte Zimmer
-- begrenzen).
-- ---------------------------------------------------------------------------
drop view if exists unterkunft_zimmer_uebersicht;
create view unterkunft_zimmer_uebersicht as
select
  z.id as zimmer_id,
  z.nummer,
  z.art,
  z.aktiv,
  z.notiz,
  z.wohneinheit_id,
  w.name as wohneinheit_name,
  w.etage_label,
  w.reihenfolge as wohneinheit_reihenfolge,
  z.plan_x, z.plan_y, z.plan_w, z.plan_h,
  g.id as gebaeude_id,
  g.name as gebaeude_name,
  count(distinct bt.id) filter (where bt.aktiv)::int as betten,
  count(distinct ba.id)::int as belegt,
  (count(distinct bt.id) filter (where bt.aktiv) - count(distinct ba.id))::int as frei,
  coalesce(zu.schwebend, 0)::int as schwebend,
  lk.letzte_kontrolle_am,
  lk.letzte_kontrolle_typ,
  coalesce(m.offene_maengel, 0)::int as offene_maengel
from unterkunft_zimmer z
join unterkunft_gebaeude g on g.id = z.gebaeude_id
left join unterkunft_wohneinheit w on w.id = z.wohneinheit_id
left join unterkunft_bett bt on bt.zimmer_id = z.id
left join unterkunft_belegung ba
  on ba.bett_id = bt.id
  and ba.von <= current_date
  and (ba.bis is null or ba.bis >= current_date)
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
) zu on zu.zimmer_id = z.id
group by
  z.id, z.nummer, z.art, z.aktiv, z.notiz,
  z.wohneinheit_id, w.name, w.etage_label, w.reihenfolge,
  z.plan_x, z.plan_y, z.plan_w, z.plan_h,
  g.id, g.name,
  zu.schwebend,
  lk.letzte_kontrolle_am, lk.letzte_kontrolle_typ, m.offene_maengel;
alter view unterkunft_zimmer_uebersicht set (security_invoker = true);
grant select on unterkunft_zimmer_uebersicht to authenticated;

drop view if exists unterkunft_wohneinheit_uebersicht;
create view unterkunft_wohneinheit_uebersicht as
select
  w.id as wohneinheit_id, w.name, w.etage_label, w.reihenfolge, w.aktiv,
  g.id as gebaeude_id, g.name as gebaeude_name,
  count(distinct z.id) filter (where z.aktiv and z.art = 'zimmer')::int as zimmer,
  count(distinct bt.id)::int as betten,
  count(distinct ba.id)::int as fest,
  coalesce(zu.schwebend, 0)::int as schwebend,
  (count(distinct bt.id) - count(distinct ba.id))::int as frei
from unterkunft_wohneinheit w
join unterkunft_gebaeude g on g.id = w.gebaeude_id
left join unterkunft_zimmer z on z.wohneinheit_id = w.id and z.aktiv
left join unterkunft_bett bt on bt.zimmer_id = z.id and bt.aktiv
left join unterkunft_belegung ba
  on ba.bett_id = bt.id
  and ba.von <= current_date
  and (ba.bis is null or ba.bis >= current_date)
left join (
  select wohneinheit_id, count(*) as schwebend
  from unterkunft_zuordnung
  where status = 'schwebend'
  group by wohneinheit_id
) zu on zu.wohneinheit_id = w.id
group by w.id, w.name, w.etage_label, w.reihenfolge, w.aktiv, g.id, g.name, zu.schwebend;
alter view unterkunft_wohneinheit_uebersicht set (security_invoker = true);
grant select on unterkunft_wohneinheit_uebersicht to authenticated;
