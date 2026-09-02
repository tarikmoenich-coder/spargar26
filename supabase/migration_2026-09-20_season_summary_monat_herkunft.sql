-- ============================================================================
-- Migration 2026-09-20: Herkunft in season_summary_monat
--
-- Die Buchhaltung braucht auf der druckbaren Monatsliste (Lohnübersicht →
-- Monatsfilter) die Spalte "Herkunft" statt "Gruppe". Dafür wird die Sicht
-- season_summary_monat um e.herkunft ergänzt (ans Ende gehängt, damit
-- "create or replace view" ohne "drop" auskommt).
-- ============================================================================

create or replace view season_summary_monat as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.gruppe_nr,
  e.aktiv,
  extract(year from we.datum)::int as saison_jahr,
  extract(month from we.datum)::int as monat,
  sum(coalesce(we.stunden, 0) + (case when we.markierung = 'U' then 8 else 0 end)) as gesamt_stunden,
  count(*) filter (where we.stunden is not null or we.markierung is not null) as anwesenheitstage,
  max(we.datum) filter (where we.stunden is not null or we.markierung is not null) as letzter_eintrag,
  (sum(coalesce(we.stunden, 0) + (case when we.markierung = 'U' then 8 else 0 end))
    * coalesce(e.stundenlohn, 0)) as basis_brutto,
  coalesce(v.verpflegung, 0)
    * count(*) filter (where we.stunden is not null or we.markierung is not null)
    as abzug_verpflegung,
  coalesce(v.wohnen, 0)
    * count(*) filter (where we.stunden is not null or we.markierung is not null)
    as abzug_wohnen,
  e.herkunft
from employees e
join work_entries we on we.employee_id = e.id
left join verpflegungssaetze v on v.saison_jahr = extract(year from we.datum)::int
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management')
group by
  e.id, e.personal_nr, e.name, e.vorname, e.gruppe_nr, e.aktiv, e.herkunft,
  extract(year from we.datum), extract(month from we.datum),
  v.verpflegung, v.wohnen;

grant select on season_summary_monat to authenticated;
