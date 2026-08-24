-- Migration 2026-08-24: Bugfix Beschäftigungstage-Zählung (105-Tage-Prüfung)
--
-- Nutzer-Fall: "Wenn im alten Zeitraum eine historische Abrechnung
-- existiert am 25.06.2026, die Tage vorher aber '0' Stunden sind, dann
-- werden die bei der SV-Prüfung nicht gezählt. Wenn ich die 0 Stunden auf
-- 1 Stunde ändere, dann zählt das Programm korrekt bis zum 25.06.2026.
-- Ansonsten nur bis zum 21.06., als die Arbeitsstunden noch >0 waren."
--
-- Ursache: employee_sv_abschnitte zählte einen Beschäftigungstag bisher
-- nur bei "stunden > 0 or markierung is not null" - ein echter "0
-- Std."-Tag (Person anwesend, aber nicht gearbeitet) fiel damit heraus,
-- obwohl dieselbe Begründung wie bei einem Urlaubstag ("das
-- Beschäftigungsverhältnis besteht fort") genauso zutrifft, und
-- season_summary.anwesenheitstage eine "0" bereits längst als
-- Anwesenheitstag zählt ("Kein Eintrag = kein Abzug. Eine eingetragene
-- '0' ... zählt trotzdem als Anwesenheitstag"). Fix: "stunden is not
-- null" statt "stunden > 0" - exakt dieselbe Bedingung wie bei
-- season_summary.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

create or replace view employee_sv_abschnitte as
with beschaeftigungstage_roh as (
  select
    we.employee_id,
    we.datum,
    extract(year from we.datum)::int as saison_jahr,
    -- Abschnitts-Nummer = Anzahl der Abrechnungen VOR diesem Tag. "<"
    -- statt "<=": an dem Tag, an dem abgerechnet wird, gearbeitete Stunden
    -- gehören noch zum alten Abschnitt.
    (
      select count(*)
      from saison_abrechnungen sa
      where sa.employee_id = we.employee_id
        and sa.saison_jahr = extract(year from we.datum)::int
        and sa.abgerechnet_am::date < we.datum
    ) as abschnitt_nr
  from work_entries we
  where we.stunden is not null or we.markierung is not null
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
