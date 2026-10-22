-- ============================================================================
-- Migration 2026-10-22: Erntewirtschaft - Poller-Baustein (Teil G):
-- Spatial-Join ernte_position -> feld + fehlende Poller-State-Spalte
--
-- Baut auf migration_2026-10-20_erntewirtschaft_kisten_zyklus.sql
-- (ernte_position/ernte_poller_state existieren schon, feld/PostGIS seit
-- migration_2026-10-19_feld_anbau_schema.sql) und dem neuen
-- tools/ernte-poller/ (Traccar -> ernte_position, analog zu
-- tools/fahrzeug-poller/). Der Poller schreibt die rohen Positionen OHNE
-- feld_id; diese Funktion loest feld_id nachtraeglich per Spatial-Join auf -
-- in SQL statt im Node-Code, gleiches Muster wie ernte_scan_verarbeiten().
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

-- Retention-Fortschritt wie bei fahrzeug_poller_state (Migration
-- 2026-09-25), hier bisher nicht vorhanden.
alter table ernte_poller_state add column if not exists letzte_bereinigung timestamptz;

-- Ordnet allen ernte_position-Zeilen ohne feld_id das Feld zu, dessen
-- Geometrie den Punkt enthaelt (falls keins passt, bleibt feld_id NULL -
-- kein Fehler, siehe Migrationskopf von migration_2026-10-20). Wird vom
-- Poller nach jedem Schreib-Durchlauf aufgerufen statt per pg_cron, weil
-- neue Positionen ohnehin nur entstehen, waehrend der Poller laeuft.
--
-- Korrelierte Subquery mit LIMIT 1 statt UPDATE...FROM: bei (in der Praxis
-- nicht vorgesehenen) ueberlappenden Feld-Geometrien waere das Ergebnis
-- von UPDATE...FROM mit mehreren Treffern unbestimmt - so ist immer genau
-- ein Feld je Zeile das Ergebnis, auch im Ueberlapp-Fall.
create or replace function ernte_position_feld_zuordnen()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_anzahl int;
begin
  update ernte_position p
  set feld_id = (
    select f.id from feld f
    where f.geometrie is not null
      and extensions.ST_Contains(
        f.geometrie,
        extensions.ST_SetSRID(extensions.ST_MakePoint(p.lng, p.lat), 4326)
      )
    limit 1
  )
  where p.feld_id is null
    and p.lat is not null
    and p.lng is not null
    and exists (
      select 1 from feld f
      where f.geometrie is not null
        and extensions.ST_Contains(
          f.geometrie,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p.lng, p.lat), 4326)
        )
    );
  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

grant execute on function ernte_position_feld_zuordnen() to authenticated;
