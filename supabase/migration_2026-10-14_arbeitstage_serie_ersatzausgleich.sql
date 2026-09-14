-- Arbeitstage am Stück: Ersatzausgleich fehlte für 7-13-Tage-Serien
-- (Nutzer-Feedback 2026-09-14): "7 Tage am Stück arbeiten ist zulässig,
-- wenn in der darauffolgenden Woche ein Ersatztag frei ist. 14 Tage ist
-- zulässig, wenn ... 2 Ersatztage frei sind. Aktuell bleiben die Serien
-- jedoch rot markiert stehen, selbst wenn der Ersatzausgleich erfolgt
-- ist." Zwei Bugs in der bisherigen Sicht:
--
--   1. ersatz_fenster_bis/ersatz_freie_tage/ersatzausgleich wurden nur für
--      serie_tage 14..20 berechnet - bei 7..13 Tagen blieb das Feld immer
--      NULL, es gab dort also gar keine Ausgleichsprüfung.
--   2. "ampel" hing nur an serie_tage, nicht an ersatzausgleich - eine
--      erfüllte 14-Tage-Serie blieb dadurch für immer "rot".
--
-- Fix: Ausgleichsprüfung jetzt für 7..20 Tage, mit gestaffeltem Soll
-- (1 freier Tag bei 7..13, 2 freie Tage bei 14..20). "ampel" bleibt wie
-- gehabt reine Schwere-Einstufung anhand der Seriendauer (für die
-- Fach-Info "wie lang war die Serie") - der neue Gesamtstatus dafür, ob
-- noch Handlungsbedarf besteht, wird in der App berechnet
-- (lib/controlling.ts, arbeitsserieGesamtstatus: läuft/erledigt/
-- ausgleich_offen/verstoss), nicht mehr allein aus "ampel" abgelesen.

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
  -- Ausgleichsfenster/-zähler jetzt ab 7 Tagen (bis 20; ab 21 kein legaler
  -- Ausgleich mehr möglich).
  case when i.serie_tage between 7 and 20 then (i.serie_bis + 7) end
    as ersatz_fenster_bis,
  case when i.serie_tage between 7 and 20 then ea.freie_tage end
    as ersatz_freie_tage,
  case
    when i.serie_tage >= 21 then 'kein_ausgleich'
    when ea.freie_tage >= (case when i.serie_tage >= 14 then 2 else 1 end)
      then 'erfuellt'
    when i.serie_bis + 7 >= current_date then 'offen'
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
