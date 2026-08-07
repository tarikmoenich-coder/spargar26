-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Statuswechsel (z.B. sozialversicherungsfrei -> sozialversicherungspflichtig
-- bei Erreichen der 90-Tage-/15-Wochen-Grenze): neue Person mit "a" an der
-- Personalnummer, verknüpft mit der alten. Außerdem: die 90-Tage-/15-
-- Wochen-Prüfung ist für bereits sozialversicherungspflichtige Personen
-- gegenstandslos und wird dort nicht mehr angezeigt.
-- ============================================================================

-- 1) Verknüpfung zur "Vorgänger"-Person bei einem Statuswechsel -----------

alter table employees
  add column vorgaenger_employee_id uuid references employees (id) on delete set null;

-- 2) 90-Tage-/15-Wochen-Prüfung: nicht mehr für sozialversicherungspflichtige
--    Personen anzeigen (die Regel ist die Obergrenze für sozialversicherungs-
--    FREIE Beschäftigung, für bereits Pflichtige gegenstandslos) ------------

create or replace view employee_sv_pruefung as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.abrechnungsart,
  e.aktiv,
  w.saison_jahr,
  w.erster_arbeitstag,
  w.letzter_arbeitstag,
  w.arbeitstage_ueber0,
  greatest(0, 90 - w.arbeitstage_ueber0) as rest_bis_90_tage,
  (w.erster_arbeitstag + 104) as austrittsdatum_15_wochen,
  floor((w.letzter_arbeitstag - w.erster_arbeitstag) / 7.0)::int as wochen_seit_start,
  (w.arbeitstage_ueber0 > 90) as ueberschritten_90_tage,
  (w.letzter_arbeitstag > (w.erster_arbeitstag + 104)) as ueberschritten_15_wochen,
  (
    w.arbeitstage_ueber0 > 90
    or w.letzter_arbeitstag > (w.erster_arbeitstag + 104)
  ) as kritisch
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden > 0) as erster_arbeitstag,
    max(we.datum) filter (where we.stunden > 0) as letzter_arbeitstag,
    count(distinct we.datum) filter (where we.stunden > 0) as arbeitstage_ueber0
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
where w.erster_arbeitstag is not null
  and e.abrechnungsart <> 'sozialversicherungspflichtig';
