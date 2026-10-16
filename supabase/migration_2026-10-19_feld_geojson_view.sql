-- Migration 2026-10-19: Feld-Geometrie als GeoJSON lesbar machen
--
-- PostgREST kann eine PostGIS-geometry-Spalte nicht direkt als GeoJSON an
-- den Browser liefern (gleiche Lücke wie in Pachtwesen2026) - deshalb eine
-- kleine Sicht, die geometrie bereits als GeoJSON-Text ausgibt. Für die
-- neue Zeichnen-Seite (app/anbau/felder/[id]).

create or replace view feld_geojson as
select
  id,
  bezeichnung,
  kultur,
  aktiv,
  extensions.ST_AsGeoJSON(geometrie) as geometrie_geojson,
  pachtwesen_schlag_id,
  pachtwesen_geometrie_hash,
  pachtwesen_geometrie_hash_neu,
  pachtwesen_geometrie_geojson_neu
from feld;

alter view feld_geojson set (security_invoker = true);
grant select on feld_geojson to authenticated;
