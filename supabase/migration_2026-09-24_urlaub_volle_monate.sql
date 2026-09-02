-- ============================================================================
-- Migration 2026-09-24: Urlaubsanspruch - "voller Kalendermonat" per Rand-
--   Prüfung statt Spanne
--
-- 2026-09-23 (Lücken-Monate) reichte nicht: die Rand-Trimmung sah nur den
-- ersten und letzten Eintrag des Jahres. Ein mitten im Monat begonnener/
-- beendeter Mittel-Monat (z.B. 01.06.-25.06.) und ein am Monatsletzten
-- endender, aber erst am 2. begonnener Rand-Monat (z.B. 02.08.-31.08.)
-- wurden fälschlich als voll gezählt.
--
-- Neu, je Kalendermonat mit Einträgen:
--   voll  <=>  frühester Eintrags-Tag <= 3
--         AND  spätester Eintrags-Tag >= (Tage im Monat) - 3
-- Die 3-Tage-Toleranz fängt Wochenenden/Feiertage an den Monatsrändern ab.
-- volle_kalendermonate = Anzahl solcher Monate. Leere Monate, angebrochene
-- Rand-Monate und teilweise gearbeitete Monate zählen dadurch nicht mit.
--
-- Nur die interne Berechnung ändert sich - Spaltennamen/-typen/-reihenfolge
-- bleiben gleich, daher "create or replace view". Betrifft Controlling ->
-- Urlaub und die Flags ueberzogen / zu_wenig_genommen.
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
    count(*) filter (where we.markierung = 'U') as u_tage
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
join lateral (
  -- Ein Kalendermonat zählt als "voll", wenn in seinen ersten 3 UND
  -- letzten 3 Tagen je mindestens ein Eintrag liegt.
  select count(*) as anzahl
  from (
    select
      min(extract(day from we.datum)) as min_tag,
      max(extract(day from we.datum)) as max_tag,
      extract(day from (
        date_trunc('month', we.datum) + interval '1 month' - interval '1 day'
      )) as tage_im_monat
    from work_entries we
    where we.employee_id = e.id
      and extract(year from we.datum) = w.saison_jahr
      and (we.stunden is not null or we.markierung is not null)
    group by date_trunc('month', we.datum)
  ) pm
  where pm.min_tag <= 3
    and pm.max_tag >= pm.tage_im_monat - 3
) monate on true
where w.erster_eintrag is not null;

alter view employee_urlaubstage set (security_invoker = true);
grant select on employee_urlaubstage to authenticated;
