-- ============================================================================
-- Migration 2026-10-27: feld.geometrie akzeptiert jetzt auch MultiPolygon
--
-- Bug gefunden (Nutzer-Meldung: "übernehmen" beim Schlag "Edeka" zeigte
-- Erfolg - kein Fehler, Badge verschwand -, aber in der Karte war keine
-- Geometrie hinterlegt): feld.geometrie war strikt auf
-- geometry(Polygon, 4326) typisiert. Pachtwesen2026s
-- schlaege_bewirtschaftet_fuer_jahr() liefert aber ST_Union(...) über ALLE
-- Flurstücke eines Schlags - sobald ein Schlag aus mehr als einem, nicht
-- zusammenhängenden Flurstück besteht, ist das Ergebnis ein MultiPolygon,
-- kein Polygon mehr (bestätigt per direktem RPC-Test für "Edeka":
-- "type":"MultiPolygon" in der Antwort). feld_geometrie_setzen() hat
-- versucht, das per UPDATE auf die strikt typisierte Spalte zu schreiben -
-- PostGIS lehnt das mit einem Typ-Fehler ab ("Geometry type (MultiPolygon)
-- does not match column type (Polygon)"). Dieser Fehler wurde von
-- app/anbau/felder/page.tsx nie abgefragt (separater Bugfix im selben
-- Commit) - darum wirkte es wie ein stiller Erfolg.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). ST_Multi() wandelt
-- bestehende Polygon-Geometrien verlustfrei in ein Einzelelement-
-- MultiPolygon um, nichts geht dabei verloren.
-- ============================================================================

alter table feld
  alter column geometrie type geometry(MultiPolygon, 4326)
  using ST_Multi(geometrie);

-- Normalisiert jede eingehende Geometrie (egal ob Polygon oder
-- MultiPolygon aus der Quelle) selbst per ST_Multi() - robust gegen beide
-- Fälle, statt sich auf die Form der jeweiligen Quelle zu verlassen.
create or replace function feld_geometrie_setzen(p_feld_id bigint, p_geojson text)
returns void language sql security invoker as $$
  update feld
  set geometrie = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(p_geojson), 4326))
  where id = p_feld_id;
$$;
