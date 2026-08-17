-- Migration 2026-08-14: Beschäftigungsabschnitte transparent benennen
--
-- Nutzer-Vorgabe wörtlich: "Ich kann als Nutzer nicht sehen wie gerechnet
-- wird, aber die Datumsangaben haben mich langsam verwirrt. Die
-- verschiedenen Abschnitte müssen transparent benannt und gerechnet
-- werden."
--
-- Zwei Korrekturen:
--
-- 1. employee_erster_arbeitstag ("Aktiv seit" im Personalstamm) folgte
--    bisher NICHT der vorgaenger_employee_id-Kette (Statuswechsel) - bei
--    einer neuen Personalnummer nach Statuswechsel zeigte "Aktiv seit"
--    den Wechsel-Stichtag statt des tatsächlichen, oft viel früheren
--    echten Beschäftigungsbeginns. Jetzt über eine rekursive Abfrage auf
--    die gesamte Vorgänger-Kette bezogen - jede Personalnummer derselben
--    Kette zeigt danach denselben, korrekten Wert.
--
-- 2. employee_sv_pruefung bekommt eine neue Spalte
--    aktueller_abschnitt_seit: der bereits intern berechnete, aber nie
--    angezeigte Beginn des GERADE LAUFENDEN Abschnitts (maßgeblich für
--    die 105-Tage-Berechnung) - bisher nur erster_arbeitstag sichtbar
--    (allererster Tag der ganzen Saison über ALLE Abschnitte), was bei
--    mehreren Abschnitten (Statuswechsel oder nachgetragene historische
--    Abrechnungen) leicht mit dem aktuellen Abschnitt verwechselt werden
--    konnte.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

create or replace view employee_erster_arbeitstag as
with recursive kette as (
  select id as employee_id, id as wurzel_id
  from employees
  where vorgaenger_employee_id is null
  union all
  select e.id as employee_id, k.wurzel_id
  from employees e
  join kette k on k.employee_id = e.vorgaenger_employee_id
),
je_wurzel as (
  select k.wurzel_id, min(we.datum) as erster_arbeitstag
  from kette k
  join work_entries we on we.employee_id = k.employee_id
  where we.stunden > 0
  group by k.wurzel_id
)
select k.employee_id, jw.erster_arbeitstag
from kette k
join je_wurzel jw on jw.wurzel_id = k.wurzel_id;

alter view employee_erster_arbeitstag set (security_invoker = true);
grant select on employee_erster_arbeitstag to authenticated;

create or replace view employee_sv_pruefung as
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
),
abschnitte as (
  select
    employee_id,
    saison_jahr,
    abschnitt_nr,
    min(datum) as von,
    max(datum) as bis,
    (max(datum) - min(datum) + 1) as tage
  from beschaeftigungstage_roh
  group by employee_id, saison_jahr, abschnitt_nr
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
    or (
      coalesce(fb.sv_frei_luecke, false)
      and w.erster_arbeitstag <= fb.sv_frei_luecke_bis
      and w.letzter_arbeitstag >= fb.sv_frei_luecke_von
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
  w.beginn_letzter_abschnitt as aktueller_abschnitt_seit
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
