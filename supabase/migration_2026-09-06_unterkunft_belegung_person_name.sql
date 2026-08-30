-- ============================================================================
-- Migration 2026-09-06: unterkunft_belegung_person um Personendaten erweitern
--
-- Fuer die Bewohner-Rueckverfolgung in der Maengelliste (Namen der Bewohner
-- des Zimmers bzw. - bei Allgemeinraeumen - der ganzen Wohneinheit) braucht
-- die Sicht Personenname + Herkunft und den Raumtyp des Zimmers.
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug).
-- ============================================================================

drop view if exists unterkunft_belegung_person;
create view unterkunft_belegung_person as
select
  b.id, b.employee_id, b.von, b.bis, b.notiz,
  e.personal_nr, e.name, e.vorname, e.herkunft,
  z.id as zimmer_id, z.nummer as zimmer_nummer, z.art as zimmer_art,
  z.wohneinheit_id, w.name as wohneinheit_name,
  g.id as gebaeude_id, g.name as gebaeude_name
from unterkunft_belegung b
join employees e on e.id = b.employee_id
join unterkunft_zimmer z on z.id = b.zimmer_id
left join unterkunft_wohneinheit w on w.id = z.wohneinheit_id
join unterkunft_gebaeude g on g.id = z.gebaeude_id;
alter view unterkunft_belegung_person set (security_invoker = true);
grant select on unterkunft_belegung_person to authenticated;
