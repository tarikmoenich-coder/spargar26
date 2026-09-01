-- ============================================================================
-- Migration 2026-09-19: Arbeitstage am Stück (ArbZG-Wochenruhe-Kontrolle)
--
-- HR soll ohne Wechsel zwischen Stundenerfassung und Controlling sehen,
-- wer wie lange ohne freien Tag durcharbeitet und ob nach 2 Wochen am Stück
-- der gesetzliche Ersatzausgleich (2 freie Tage in der Folgewoche) genommen
-- wurde.
--
--   Arbeitstag  = work_entries mit stunden > 0 UND markierung <> 'U'
--                 (F/Fahrer zählt als Arbeitstag; Wochenende/Feiertag mit
--                  Stunden zählt mit).
--   Pause       = Tag mit 0 Std., markierung 'U' oder ganz ohne Eintrag.
--   Serie       = maximale Kette aufeinanderfolgender Kalendertage mit
--                 Arbeitstag (gaps & islands).
--   Ampel       = serie_tage >= 14  -> 'rot'
--                 serie_tage >=  7  -> 'gelb'
--   Ersatz-     = nur ab 14 Tagen am Stück: in den 7 Kalendertagen NACH
--   ausgleich     serie_bis müssen >= 2 freie Tage liegen.
--                 'erfuellt' | 'offen' (Folgewoche läuft noch) | 'fehlt'
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

create index if not exists idx_work_entries_emp_datum
  on work_entries (employee_id, datum);

create or replace view arbeitstage_serie_uebersicht as
with tage as (
  -- genau eine Zeile je (Person, Arbeitstag), Historie 400 Tage
  select employee_id, datum
  from work_entries
  where stunden > 0
    and coalesce(markierung, '') <> 'U'
    and datum >= current_date - 400
  group by employee_id, datum
),
inseln as (
  select
    employee_id,
    min(datum) as serie_von,
    max(datum) as serie_bis,
    count(*)   as serie_tage
  from (
    select
      employee_id,
      datum,
      -- konstanter Wert je zusammenhängendem Datumsblock
      datum - (row_number() over (partition by employee_id order by datum))::int
        as grp
    from tage
  ) s
  group by employee_id, grp
)
select
  i.employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.aktiv,
  i.serie_von,
  i.serie_bis,
  i.serie_tage,
  -- letzter Serientag heute oder gestern -> Serie läuft vermutlich noch
  -- (der heutige Tag ist oft noch nicht erfasst)
  (i.serie_bis >= current_date - 1) as laeuft_noch,
  case
    when i.serie_tage >= 14 then 'rot'
    when i.serie_tage >= 7  then 'gelb'
    else 'gruen'
  end as ampel,
  case when i.serie_tage >= 14 then (i.serie_bis + 7) end as ersatz_fenster_bis,
  case when i.serie_tage >= 14 then ea.freie_tage end     as ersatz_freie_tage,
  case
    when i.serie_tage < 14                    then null
    when ea.freie_tage >= 2                   then 'erfuellt'
    when i.serie_bis + 7 >= current_date      then 'offen'
    else 'fehlt'
  end as ersatzausgleich
from inseln i
join employees e on e.id = i.employee_id
left join lateral (
  -- freie Tage in der Folgewoche, aber nur so weit wie tatsächlich
  -- vergangen (sonst zählten unerfasste Zukunftstage fälschlich als frei)
  select
    greatest(0, least(i.serie_bis + 7, current_date) - i.serie_bis)::int
      - count(t.datum)::int as freie_tage
  from tage t
  where t.employee_id = i.employee_id
    and t.datum >  i.serie_bis
    and t.datum <= least(i.serie_bis + 7, current_date)
) ea on true
where i.serie_tage >= 7
  and e.aktiv
order by i.serie_tage desc, i.serie_bis desc;

-- security_invoker = true: employees und work_entries sind ohnehin per RLS
-- rollenabhängig lesbar - die View gibt nichts frei, was der Aufrufer nicht
-- schon direkt sehen könnte.
alter view arbeitstage_serie_uebersicht set (security_invoker = true);
grant select on arbeitstage_serie_uebersicht to authenticated;
