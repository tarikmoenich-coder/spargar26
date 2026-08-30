-- ============================================================================
-- Migration 2026-09-03: Unterkunft - Zimmer sperren + Grundriss-Ausbau
--
-- Nutzer-Wunsch (Grundriss als Steuerzentrale):
--   * Zimmer/Räume sperren können (Wasserschaden, Renovierung, Quarantäne).
--     Ein gesperrter Raum zählt in der Kapazität nicht mehr als "frei".
--   * Kapazitäts-Kopfzeile, Ansichts-Umschalter (Belegung/Herkunft/Kontrolle/
--     Mängel), Umzug, Direkt-Belegung laufen rein im Frontend - dafür reicht
--     die zusätzliche Spalte hier.
--
-- Sperren dürfen admin/hr (bestehende Policy unterkunft_zimmer_write).
-- Umzug = unterkunft_belegung schließen + neu anlegen (Policy erlaubt schon
-- admin/hr/hausmeister), keine Schema-Änderung nötig.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug).
-- ============================================================================

alter table unterkunft_zimmer
  add column if not exists gesperrt boolean not null default false;
alter table unterkunft_zimmer
  add column if not exists sperr_grund text;

-- Zimmerübersicht um den Sperr-Status erweitern.
drop view if exists unterkunft_zimmer_uebersicht;
create view unterkunft_zimmer_uebersicht as
select
  z.id as zimmer_id, z.nummer, z.art, z.aktiv, z.notiz,
  z.gesperrt, z.sperr_grund,
  z.wohneinheit_id, w.name as wohneinheit_name, w.etage_label,
  w.reihenfolge as wohneinheit_reihenfolge,
  z.plan_x, z.plan_y, z.plan_w, z.plan_h,
  g.id as gebaeude_id, g.name as gebaeude_name,
  count(distinct bt.id) filter (where bt.aktiv)::int as betten,
  count(distinct ba.id)::int as belegt,
  (count(distinct bt.id) filter (where bt.aktiv) - count(distinct ba.id))::int as frei,
  coalesce(zu.schwebend, 0)::int as schwebend,
  lk.letzte_kontrolle_am, lk.letzte_kontrolle_typ,
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
  z.id, z.nummer, z.art, z.aktiv, z.notiz, z.gesperrt, z.sperr_grund,
  z.wohneinheit_id, w.name, w.etage_label, w.reihenfolge,
  z.plan_x, z.plan_y, z.plan_w, z.plan_h,
  g.id, g.name,
  zu.schwebend,
  lk.letzte_kontrolle_am, lk.letzte_kontrolle_typ, m.offene_maengel;
alter view unterkunft_zimmer_uebersicht set (security_invoker = true);
grant select on unterkunft_zimmer_uebersicht to authenticated;
