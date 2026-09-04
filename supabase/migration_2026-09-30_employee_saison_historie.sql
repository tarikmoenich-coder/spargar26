-- Sichten für die Saison-Historie einer Person: "wann war die Person schon da".
-- Speist sich aus zwei Quellen:
--   1. employee_saison_praesenz  - die aus der Papier-Personalkartei
--      importierten Jahre (bis Ende 2025), reines "war da".
--   2. work_entries              - Saisons, die die App selbst erfasst hat
--      (mit Stundensumme und Zahl der erfassten Tage).
--
-- Verwendung: Personalplanung ("Bereits einmal hier gewesen?"), Personalstamm
-- und die druckbare Personalstammkarte (Deckblatt der Personalkartei).

-- Detailsicht: eine Zeile je (Person, Saison-Jahr).
drop view if exists employee_saison_jahre;
create view employee_saison_jahre as
select
  coalesce(p.employee_id, w.employee_id) as employee_id,
  coalesce(p.saison_jahr, w.saison_jahr) as saison_jahr,
  (p.employee_id is not null) as aus_kartei,
  (w.employee_id is not null) as aus_erfassung,
  w.stunden_gesamt,
  w.tage_erfasst
from (
  select employee_id, saison_jahr from employee_saison_praesenz
) p
full join (
  select
    employee_id,
    extract(year from datum)::int as saison_jahr,
    round(sum(stunden), 1) as stunden_gesamt,
    count(*) filter (where stunden is not null and stunden > 0) as tage_erfasst
  from work_entries
  where stunden is not null
  group by employee_id, extract(year from datum)::int
) w on w.employee_id = p.employee_id and w.saison_jahr = p.saison_jahr;

alter view employee_saison_jahre set (security_invoker = true);
grant select on employee_saison_jahre to authenticated;

-- Kurzfassung für Listen: erste/letzte Saison, Anzahl, sortierte Jahresliste.
drop view if exists employee_saison_historie_agg;
create view employee_saison_historie_agg as
with jahre as (
  select employee_id, saison_jahr from employee_saison_praesenz
  union
  select employee_id, extract(year from datum)::int as saison_jahr
  from work_entries
  where stunden is not null
)
select
  employee_id,
  min(saison_jahr) as erste_saison,
  max(saison_jahr) as letzte_saison,
  count(*)::int as anzahl_saisons,
  array_agg(saison_jahr order by saison_jahr) as saisons
from jahre
group by employee_id;

alter view employee_saison_historie_agg set (security_invoker = true);
grant select on employee_saison_historie_agg to authenticated;
