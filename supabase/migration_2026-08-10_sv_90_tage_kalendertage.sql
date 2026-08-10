-- Migration 2026-08-10: 90-Tage-Grenze auf Kalendertage umgestellt
--
-- Nutzer-Vorgabe: bei der 90-Tage-Regel (kombinierte Prüfung bei
-- Vorbeschäftigung/Rückkehr im selben Kalenderjahr) zählen die KALENDER-
-- TAGE des Beschäftigungszeitraums (1. bis letzter Arbeitstag, inklusive
-- freier Tage dazwischen) - exakt dieselbe Logik wie bei der 15-Wochen-
-- Grenze, nur mit 90 statt 105 Tagen Budget. Bisher zählte "arbeitstage_
-- ueber0" nur Tage mit tatsächlich geleisteten Stunden.
--
-- Wichtige Folge-Entscheidung (Nutzer bestätigt): die 90-Tage-Grenze ist
-- NUR noch bindend, wenn tatsächlich eine Vorbeschäftigung gemeldet ist
-- (vorbeschaeftigung_deutschland_tage > 0) - ohne diese Kopplung würde die
-- 90-Tage-Grenze (90 Kalendertage < 105 Kalendertage) IMMER vor der
-- 15-Wochen-Grenze greifen, auch ganz ohne Vorbeschäftigung.
--
-- Neu: exaktes Enddatum der kombinierten 90-Tage-Grenze im Rückkehr-Fall
-- (austrittsdatum_90_tage_kombiniert = Startdatum der zweiten
-- Beschäftigung + (89 - gemeldete Vorbeschäftigungstage)), fließt jetzt
-- zusätzlich in austrittsdatum_empfohlen ein.
--
-- In der Supabase SQL-Konsole ausführen. Reine Sicht-/Funktions-Änderung,
-- kein ALTER TYPE - kann in einem Zug laufen.

-- 1) Spalte umbenennen, BEVOR die Sicht neu definiert wird - "create or
-- replace view" erlaubt keine Namensänderung an derselben Position
-- (Fehler 42P16), "alter view ... rename column" schon.
alter view employee_sv_pruefung rename column arbeitstage_ueber0 to beschaeftigungstage;

-- 2) Sicht neu definieren: beschaeftigungstage jetzt kalendertage-basiert,
-- kritisch-Formel an Vorbeschäftigung gekoppelt, neues exaktes
-- 90-Tage-Datum ergänzt.
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
  w.beschaeftigungstage,
  greatest(0, 90 - w.beschaeftigungstage) as rest_bis_90_tage,
  (w.erster_arbeitstag + 104) as austrittsdatum_15_wochen,
  floor((w.letzter_arbeitstag - w.erster_arbeitstag) / 7.0)::int as wochen_seit_start,
  (w.beschaeftigungstage > 90) as ueberschritten_90_tage,
  (w.letzter_arbeitstag > (w.erster_arbeitstag + 104)) as ueberschritten_15_wochen,
  (
    w.letzter_arbeitstag > (w.erster_arbeitstag + 104)
    or (
      coalesce(fb.vorbeschaeftigung_deutschland_tage, 0) > 0
      and (w.beschaeftigungstage + fb.vorbeschaeftigung_deutschland_tage) > 90
    )
    or (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    or (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    or (
      coalesce(fb.sv_frei_luecke, false)
      and w.erster_arbeitstag <= fb.sv_frei_luecke_bis
      and w.letzter_arbeitstag >= fb.sv_frei_luecke_von
    )
  ) as kritisch,
  coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as vorbeschaeftigung_deutschland_tage,
  w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as kombinierte_tage,
  greatest(
    0,
    90 - (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
  ) as rest_bis_90_tage_kombiniert,
  least(
    (w.erster_arbeitstag + 104),
    fb.sv_frei_bis,
    case when coalesce(fb.vorbeschaeftigung_deutschland_tage, 0) > 0
      then w.erster_arbeitstag + (89 - fb.vorbeschaeftigung_deutschland_tage)
    end
  ) as austrittsdatum_empfohlen,
  fb.sv_frei_von,
  fb.sv_frei_bis,
  coalesce(fb.sv_frei_luecke, false) as sv_frei_luecke,
  fb.sv_frei_luecke_von,
  fb.sv_frei_luecke_bis,
  (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    as ueberschritten_sv_frei_beginn,
  (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    as ueberschritten_sv_frei_ende,
  case when coalesce(fb.vorbeschaeftigung_deutschland_tage, 0) > 0
    then w.erster_arbeitstag + (89 - fb.vorbeschaeftigung_deutschland_tage)
  end as austrittsdatum_90_tage_kombiniert
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden > 0) as erster_arbeitstag,
    max(we.datum) filter (where we.stunden > 0) as letzter_arbeitstag,
    (
      max(we.datum) filter (where we.stunden > 0)
      - min(we.datum) filter (where we.stunden > 0) + 1
    ) as beschaeftigungstage
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
left join lateral (
  select
    f.vorbeschaeftigung_deutschland_tage,
    sv_freier_zeitraum_von(f) as sv_frei_von,
    sv_freier_zeitraum_bis(f) as sv_frei_bis,
    sv_freier_zeitraum_luecke(f) as sv_frei_luecke,
    sv_freier_zeitraum_luecke_von(f) as sv_frei_luecke_von,
    sv_freier_zeitraum_luecke_bis(f) as sv_frei_luecke_bis
  from sv_fragebogen f
  where f.employee_id = e.id and f.saison_jahr = w.saison_jahr
) fb on true
where w.erster_arbeitstag is not null
  and e.abrechnungsart <> 'sozialversicherungspflichtig';

grant select on employee_sv_pruefung to authenticated;
