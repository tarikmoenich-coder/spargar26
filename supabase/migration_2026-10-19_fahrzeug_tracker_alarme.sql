-- ============================================================================
-- Migration 2026-10-19: Fahrzeuge - Tracker-Alarme (Inbetriebnahme 100+ Tracker)
--
-- Nutzer-Sorge beim Einrichten der 100 neuen Fahrzeugtracker: bei so vielen
-- Fahrzeugen fällt es nicht mehr auf, wenn ein Tracker, der sonst taeglich
-- aktiv war, ploetzlich keine Positionen mehr schickt (kaputt/entfernt/
-- manipuliert). Diese View liefert pro Fahrzeug das LETZTE Ereignis an einer
-- "Hof"-Geofence (Ein- oder Ausfahrt) - die App kombiniert das clientseitig
-- mit fahrzeug_tracker.zuletzt_gesehen zu Alarmstufen (siehe
-- lib/fahrzeugAlarme.ts):
--   - Rot/kritisch (universell, auch fuer abgemeldete Fahrzeuge): letztes
--     Hof-Ereignis ist eine Ausfahrt (keine Rueckkehr) UND seitdem > 24h
--     keine neue Position.
--   - Warnung/Kritisch (nur aktive Fahrzeuge): laengere Zeit ohne Position,
--     unabhaengig vom Hof-Status - 24h/72h fuer die meisten Typen, 14/30
--     Tage fuer Traktoren (koennen saisonbedingt viel laenger stillstehen).
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

create or replace view fahrzeug_hof_status as
select distinct on (e.fahrzeug_id)
  e.fahrzeug_id,
  e.typ as letztes_hof_ereignis,
  e.zeitpunkt as letztes_hof_ereignis_zeitpunkt
from fahrzeug_ereignis e
join fahrzeug_geofence g
  on g.traccar_geofence_id = e.geofence_id and g.ist_hof
where e.fahrzeug_id is not null
  and e.typ in ('geofenceEnter', 'geofenceExit')
order by e.fahrzeug_id, e.zeitpunkt desc;

alter view fahrzeug_hof_status set (security_invoker = true);
grant select on fahrzeug_hof_status to authenticated;
