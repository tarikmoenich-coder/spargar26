-- ============================================================================
-- Migration 2026-10-22 (Fix): ernte_position_feld_zuordnen() - falsches
-- Schema-Präfix vor den PostGIS-Funktionen
--
-- Praxisfund: "function extensions.st_makepoint(double precision, double
-- precision) does not exist". In diesem Supabase-Projekt liegen die
-- PostGIS-Funktionen in "public", NICHT in "extensions" (anders als bei
-- Pachtwesen2026, dort war "extensions." richtig) - das war hier schon
-- einmal entdeckt worden (siehe migration_2026-10-19_feld_geojson_view.sql,
-- migration_2026-10-20_feld_brutto_flaeche.sql), beim Schreiben der
-- urspruenglichen Funktion aber uebersehen. Nur das Praefix entfernt, sonst
-- unveraendert.
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

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
      and ST_Contains(
        f.geometrie,
        ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)
      )
    limit 1
  )
  where p.feld_id is null
    and p.lat is not null
    and p.lng is not null
    and exists (
      select 1 from feld f
      where f.geometrie is not null
        and ST_Contains(
          f.geometrie,
          ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)
        )
    );
  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

grant execute on function ernte_position_feld_zuordnen() to authenticated;
