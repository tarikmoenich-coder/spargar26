-- ============================================================================
-- Migration 2026-09-21: "Arbeitstage am Stück" - kein legaler Ersatzausgleich
--   bei sehr langen Serien
--
-- Bisher konnte selbst eine 62-Tage-Serie als Ersatzausgleich "erfuellt"
-- angezeigt werden, wenn danach zufällig 2 freie Tage in der Folgewoche
-- lagen. Das ist irreführend: der gesetzliche Ersatzruhetag-Mechanismus
-- (§ 11 ArbZG - nach bis zu ~2 Wochen am Stück 2 freie Tage in der
-- Folgewoche) heilt nur die "knapp über 2 Wochen"-Fälle. Alles deutlich
-- darüber ist ein nicht heilbarer Verstoß.
--
--   serie_tage < 14        -> ersatzausgleich = null   (keine Ausgleichspflicht)
--   serie_tage 14..20      -> 'erfuellt' | 'offen' | 'fehlt'  (wie bisher)
--   serie_tage >= 21       -> 'kein_ausgleich'         (kein legaler Ausgleich)
--
-- Nur die ersatzausgleich-/ersatz_*-Ausdrücke ändern sich - Spaltennamen,
-- -typen und -reihenfolge bleiben gleich, daher "create or replace view".
-- In der Supabase SQL-Konsole ausführen. Idempotent.
-- ============================================================================

create or replace view arbeitstage_serie_uebersicht as
with tage as (
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
  (i.serie_bis >= current_date - 1) as laeuft_noch,
  case
    when i.serie_tage >= 14 then 'rot'
    when i.serie_tage >= 7  then 'gelb'
    else 'gruen'
  end as ampel,
  -- Ausgleichsfenster/-zähler nur im heilbaren Bereich (14..20 Tage)
  case when i.serie_tage between 14 and 20 then (i.serie_bis + 7) end
    as ersatz_fenster_bis,
  case when i.serie_tage between 14 and 20 then ea.freie_tage end
    as ersatz_freie_tage,
  case
    when i.serie_tage < 14                    then null
    when i.serie_tage >= 21                   then 'kein_ausgleich'
    when ea.freie_tage >= 2                   then 'erfuellt'
    when i.serie_bis + 7 >= current_date      then 'offen'
    else 'fehlt'
  end as ersatzausgleich
from inseln i
join employees e on e.id = i.employee_id
left join lateral (
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

alter view arbeitstage_serie_uebersicht set (security_invoker = true);
grant select on arbeitstage_serie_uebersicht to authenticated;
