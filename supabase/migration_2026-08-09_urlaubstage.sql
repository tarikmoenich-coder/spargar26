-- Urlaubstage-Anspruch/-Kontrolle je Mitarbeiter/Saisonjahr (Nutzer-Vorgabe
-- 2026-08-09): 2 Urlaubstage je vollem Kalendermonat der Beschäftigung.
-- Siehe ausführlichen Kommentar in schema.sql für die genaue Logik.

create or replace view employee_urlaubstage as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.aktiv,
  w.saison_jahr,
  w.erster_eintrag,
  w.letzter_eintrag,
  w.u_tage,
  greatest(0, monate.anzahl)::int as volle_kalendermonate,
  greatest(0, monate.anzahl)::int * 2 as urlaubsanspruch_tage,
  (w.u_tage > greatest(0, monate.anzahl) * 2) as ueberzogen
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden is not null or we.markierung is not null) as erster_eintrag,
    max(we.datum) filter (where we.stunden is not null or we.markierung is not null) as letzter_eintrag,
    count(*) filter (where we.markierung = 'U') as u_tage
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
join lateral (
  select
    (
      extract(year from end_adj) - extract(year from start_adj)
    ) * 12
    + (extract(month from end_adj) - extract(month from start_adj))
    + 1 as anzahl
  from (
    select
      case
        when extract(day from w.erster_eintrag) = 1
          then date_trunc('month', w.erster_eintrag)
        else date_trunc('month', w.erster_eintrag) + interval '1 month'
      end as start_adj,
      case
        when w.letzter_eintrag
          = (date_trunc('month', w.letzter_eintrag) + interval '1 month' - interval '1 day')::date
          then date_trunc('month', w.letzter_eintrag)
        else date_trunc('month', w.letzter_eintrag) - interval '1 month'
      end as end_adj
  ) x
) monate on true
where w.erster_eintrag is not null;

grant select on employee_urlaubstage to authenticated;
