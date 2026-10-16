-- Migration 2026-10-19: Feld-Geometrie als GeoJSON lesbar machen
--
-- PostgREST kann eine PostGIS-geometry-Spalte nicht direkt als GeoJSON an
-- den Browser liefern (gleiche Lücke wie in Pachtwesen2026) - deshalb eine
-- kleine Sicht, die geometrie bereits als GeoJSON-Text ausgibt. Für die
-- neue Zeichnen-Seite (app/anbau/felder/[id]).
--
-- Bewusst OHNE "extensions."-Präfix vor den PostGIS-Funktionen (anders als
-- in Pachtwesen2026): dort liegt PostGIS im Schema "extensions", hier
-- offenbar im normalen Suchpfad (die Tabelle "feld" aus Phase 1 nutzt den
-- Typ "geometry" ja auch schon unqualifiziert und funktioniert) - ein
-- erster Versuch mit "extensions.ST_AsGeoJSON" scheiterte entsprechend mit
-- "function extensions.st_asgeojson(geometry) does not exist".

create or replace view feld_geojson as
select
  id,
  bezeichnung,
  kultur,
  aktiv,
  ST_AsGeoJSON(geometrie) as geometrie_geojson,
  pachtwesen_schlag_id,
  pachtwesen_geometrie_hash,
  pachtwesen_geometrie_hash_neu,
  pachtwesen_geometrie_geojson_neu
from feld;

alter view feld_geojson set (security_invoker = true);
grant select on feld_geojson to authenticated;
