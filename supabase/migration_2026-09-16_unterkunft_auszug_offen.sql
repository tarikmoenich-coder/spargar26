-- ============================================================================
-- Migration 2026-09-16: Sicht unterkunft_auszug_offen
--
-- Personen, deren Auszug noch abgenommen werden muss: laufende Belegung
-- (bis IS NULL) UND entweder es gibt einen Lohn-Auszahlungsbeleg NACH dem
-- Einzug (= Abreise-Signal) ODER der Mitarbeiter ist inzwischen inaktiv
-- (abgereist ohne finale Abrechnung).
--
-- BEWUSST security definer (kein security_invoker): die Sicht muss
-- auszahlungsbeleg_zeilen lesen, worauf der Hausmeister keinen Zugriff hat.
-- Deshalb wird KEIN Betrag herausgegeben, nur `hat_kaution` (bool).
--
-- In der Supabase SQL-Konsole ausführen (ein Zug).
-- ============================================================================

drop view if exists unterkunft_auszug_offen;
create view unterkunft_auszug_offen as
select
  b.id as belegung_id,
  b.employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.aktiv as employee_aktiv,
  b.von as belegung_von,
  z.id as zimmer_id,
  z.nummer as zimmer_nummer,
  z.art as zimmer_art,
  z.wohneinheit_id,
  w.name as wohneinheit_name,
  g.id as gebaeude_id,
  g.name as gebaeude_name,
  az.ausgezahlt_am,
  coalesce(az.zimmer_kaution, 0) > 0 as hat_kaution
from unterkunft_belegung b
join employees e on e.id = b.employee_id
join unterkunft_zimmer z on z.id = b.zimmer_id
left join unterkunft_wohneinheit w on w.id = z.wohneinheit_id
join unterkunft_gebaeude g on g.id = z.gebaeude_id
left join lateral (
  select
    ab.erstellt_am as ausgezahlt_am,
    (azz.zeile ->> 'zimmer_kaution')::numeric as zimmer_kaution
  from auszahlungsbeleg_zeilen azz
  join auszahlungsbelege ab on ab.id = azz.auszahlungsbeleg_id
  where azz.employee_id = b.employee_id
    and ab.erstellt_am >= b.von
  order by ab.erstellt_am desc
  limit 1
) az on true
where b.bis is null
  and (az.ausgezahlt_am is not null or not e.aktiv);

grant select on unterkunft_auszug_offen to authenticated;
