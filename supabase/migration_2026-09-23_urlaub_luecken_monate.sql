-- ============================================================================
-- Migration 2026-09-23: Urlaubsanspruch - Lücken-Monate nicht mehr mitzählen
--
-- Bisher rechnete employee_urlaubstage die volle_kalendermonate als reine
-- SPANNE vom ersten bis zum letzten Eintrag des Jahres (nur die beiden
-- Rand-Teilmonate wurden getrimmt). Monate ohne jeden Eintrag in der Mitte
-- (Person war weg und kam zurück) wurden trotzdem mitgezählt -> zu hoher
-- Anspruch.
--
-- Neu: volle_kalendermonate = Anzahl DISTINCT Monate MIT mindestens einem
-- Eintrag (Stunden ODER Markierung), davon
--   -1 wenn der erste dieser Monate nicht am 1. begann
--   -1 wenn der letzte nicht bis zum Monatsletzten ging
-- (>= 0). Lücken-Monate fallen automatisch raus.
--
-- Nur die interne Berechnung ändert sich - Spaltennamen/-typen/-reihenfolge
-- bleiben gleich, daher "create or replace view".
-- Betrifft die Anzeige unter Controlling -> Urlaub und die Flags
-- ueberzogen / zu_wenig_genommen (Werte können sich für Personen mit
-- Beschäftigungslücke ändern).
--
-- In der Supabase SQL-Konsole ausführen. Idempotent.
-- ============================================================================

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
  (w.u_tage > greatest(0, monate.anzahl) * 2) as ueberzogen,
  greatest(0, greatest(0, monate.anzahl)::int * 2 - w.u_tage) as resturlaub_tage,
  (w.u_tage < greatest(0, monate.anzahl) * 2) as zu_wenig_genommen
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden is not null or we.markierung is not null) as erster_eintrag,
    max(we.datum) filter (where we.stunden is not null or we.markierung is not null) as letzter_eintrag,
    count(*) filter (where we.markierung = 'U') as u_tage,
    -- Monate mit mindestens einem Eintrag - Lücken-Monate sind hier gar
    -- nicht enthalten.
    count(distinct date_trunc('month', we.datum))
      filter (where we.stunden is not null or we.markierung is not null)
      as monate_mit_eintrag
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
join lateral (
  select greatest(
    0,
    w.monate_mit_eintrag
      - (case when extract(day from w.erster_eintrag) <> 1 then 1 else 0 end)
      - (case
           when w.letzter_eintrag <>
             (date_trunc('month', w.letzter_eintrag)
               + interval '1 month' - interval '1 day')::date
           then 1 else 0
         end)
  )::int as anzahl
) monate on true
where w.erster_eintrag is not null;

alter view employee_urlaubstage set (security_invoker = true);
grant select on employee_urlaubstage to authenticated;
