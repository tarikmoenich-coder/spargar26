-- Migration 2026-08-15: Tage-Aufschlüsselung der 105-Tage-Grenze
--
-- Nutzer-Vorgabe (nach wiederholter Verwirrung über die Herleitung von
-- "Rest bis 105 Tage"): ein Tooltip, der genau zeigt, wie sich die Zahl
-- zusammensetzt (jeder Abschnitt einzeln + Vorbeschäftigung + Summe).
--
-- Dafür werden die bisher NUR intern in employee_sv_pruefung berechneten
-- Beschäftigungsabschnitte als eigene Sicht employee_sv_abschnitte
-- ausgegeben - employee_sv_pruefung liest sie jetzt ebenfalls von dort,
-- statt die Logik zweimal zu pflegen (einzige Quelle der Abschnitts-
-- Berechnung). Kein Verhaltensunterschied bei den bestehenden Spalten von
-- employee_sv_pruefung.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

drop view if exists employee_sv_pruefung;

create or replace view employee_sv_abschnitte as
with beschaeftigungstage_roh as (
  select
    we.employee_id,
    we.datum,
    extract(year from we.datum)::int as saison_jahr,
    (
      select count(*)
      from saison_abrechnungen sa
      where sa.employee_id = we.employee_id
        and sa.saison_jahr = extract(year from we.datum)::int
        and sa.abgerechnet_am::date < we.datum
    ) as abschnitt_nr
  from work_entries we
  where we.stunden > 0 or we.markierung is not null
)
select
  employee_id,
  saison_jahr,
  abschnitt_nr,
  min(datum) as von,
  max(datum) as bis,
  (max(datum) - min(datum) + 1)::int as tage
from beschaeftigungstage_roh
group by employee_id, saison_jahr, abschnitt_nr;

alter view employee_sv_abschnitte set (security_invoker = true);
grant select on employee_sv_abschnitte to authenticated;

create or replace view employee_sv_pruefung as
with abschnitte as (
  select * from employee_sv_abschnitte
),
w as (
  select
    employee_id,
    saison_jahr,
    min(von) as erster_arbeitstag,
    max(bis) as letzter_arbeitstag,
    sum(tage)::int as beschaeftigungstage,
    count(*)::int as anzahl_abschnitte,
    (array_agg(von order by von desc))[1] as beginn_letzter_abschnitt,
    (sum(tage) - (array_agg(tage order by von desc))[1])::int
      as tage_vor_letztem_abschnitt
  from abschnitte
  group by employee_id, saison_jahr
)
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
  w.beschaeftigungstage,
  w.anzahl_abschnitte,
  coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as vorbeschaeftigung_deutschland_tage,
  (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
    as kombinierte_tage,
  greatest(
    0,
    105 - (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
  ) as rest_bis_105_tage,
  (
    (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)) > 105
  ) as ueberschritten_105_tage,
  (
    w.beginn_letzter_abschnitt
    + (105 - w.tage_vor_letztem_abschnitt
         - coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
    - 1
  ) as austrittsdatum_105_tage,
  least(
    (
      w.beginn_letzter_abschnitt
      + (105 - w.tage_vor_letztem_abschnitt
           - coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
      - 1
    ),
    fb.sv_frei_bis
  ) as austrittsdatum_empfohlen,
  (
    (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)) > 105
    or (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    or (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    or exists (
      select 1 from abschnitte ab
      where ab.employee_id = e.id
        and ab.saison_jahr = w.saison_jahr
        and coalesce(fb.sv_frei_luecke, false)
        and ab.von <= fb.sv_frei_luecke_bis
        and ab.bis >= fb.sv_frei_luecke_von
    )
  ) as kritisch,
  fb.sv_frei_von,
  fb.sv_frei_bis,
  coalesce(fb.sv_frei_luecke, false) as sv_frei_luecke,
  fb.sv_frei_luecke_von,
  fb.sv_frei_luecke_bis,
  coalesce(fb.sv_frei_offen, false) as sv_frei_offen,
  (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    as ueberschritten_sv_frei_beginn,
  (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    as ueberschritten_sv_frei_ende,
  w.beginn_letzter_abschnitt as aktueller_abschnitt_seit,
  exists (
    select 1 from abschnitte ab
    where ab.employee_id = e.id
      and ab.saison_jahr = w.saison_jahr
      and coalesce(fb.sv_frei_luecke, false)
      and ab.von <= fb.sv_frei_luecke_bis
      and ab.bis >= fb.sv_frei_luecke_von
  ) as ueberschritten_sv_frei_luecke
from employees e
join w on w.employee_id = e.id
left join lateral (
  select
    vorbeschaeftigung_deutschland_tage_effektiv(f)
      as vorbeschaeftigung_deutschland_tage,
    case when sv_freier_zeitraum_offen(f) then w.erster_arbeitstag
      else sv_freier_zeitraum_von(f) end as sv_frei_von,
    sv_freier_zeitraum_bis(f) as sv_frei_bis,
    sv_freier_zeitraum_luecke(f) as sv_frei_luecke,
    sv_freier_zeitraum_luecke_von(f) as sv_frei_luecke_von,
    sv_freier_zeitraum_luecke_bis(f) as sv_frei_luecke_bis,
    sv_freier_zeitraum_offen(f) as sv_frei_offen
  from sv_fragebogen f
  where f.employee_id = e.id and f.saison_jahr = w.saison_jahr
) fb on true
where e.abrechnungsart <> 'sozialversicherungspflichtig'
  and current_role_name() in ('admin', 'hr', 'management');

grant select on employee_sv_pruefung to authenticated;
