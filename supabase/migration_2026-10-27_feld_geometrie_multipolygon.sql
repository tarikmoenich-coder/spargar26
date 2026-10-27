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
-- Korrektur gegenüber dem ersten Anlauf (Fehler "cannot alter type of a
-- column used by a view or rule", DETAIL "rule _RETURN on view
-- feld_anbau_uebersicht depends on column geometrie"): Postgres lässt
-- ALTER COLUMN TYPE nicht zu, solange eine View die Spalte liest - beide
-- betroffenen Views (feld_geojson, feld_anbau_uebersicht) müssen vorher
-- gedroppt und danach mit unveränderter Definition neu angelegt werden.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). ST_Multi() wandelt
-- bestehende Polygon-Geometrien verlustfrei in ein Einzelelement-
-- MultiPolygon um, nichts geht dabei verloren.
-- ============================================================================

drop view if exists feld_geojson;
drop view if exists feld_anbau_uebersicht;

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

-- Beide Views unverändert neu angelegt (Definitionen identisch zu
-- migration_2026-10-26_ernte_kiosk.sql / migration_2026-10-20_feld_brutto_
-- flaeche.sql - nur hier erneut nötig, weil DROP+CREATE wegen der
-- Spalten-Typänderung oben unausweichlich war).

create view feld_geojson as
select
  f.id,
  f.bezeichnung,
  f.kultur,
  f.aktiv,
  ST_AsGeoJSON(f.geometrie) as geometrie_geojson,
  f.pachtwesen_schlag_id,
  f.pachtwesen_geometrie_hash,
  f.pachtwesen_geometrie_hash_neu,
  f.pachtwesen_geometrie_geojson_neu,
  case
    when f.geometrie is not null
    then round((ST_Area(f.geometrie::geography) / 10000)::numeric, 4)
  end as flaeche_brutto_ha,
  f.sorte_id,
  s.bezeichnung as sorte_bezeichnung
from feld f
left join spargel_sorte s on s.id = f.sorte_id;

alter view feld_geojson set (security_invoker = true);
grant select on feld_geojson to authenticated;

create view feld_anbau_uebersicht as
select
  fa.id as anbau_id,
  fa.feld_id,
  f.bezeichnung as feld_bezeichnung,
  f.kultur,
  fa.saison_jahr,
  fa.erntefenster_von,
  fa.erntefenster_bis,
  fa.ertrag_erwartet,
  fa.ertrag_einheit,
  fa.rodung_geplant,
  fa.notiz,
  count(ab.id)::int as anzahl_abschnitte,
  coalesce(sum(bb.laufende_meter), 0) as laufende_meter,
  coalesce(sum(bb.anzahl_pflanzen), 0)::int as anzahl_pflanzen,
  coalesce(sum(bb.netto_ha), 0) as netto_ha,
  (
    select string_agg(distinct ab2.sorte, ', ' order by ab2.sorte)
    from feld_anbau_abschnitt ab2
    where ab2.feld_anbau_id = fa.id and ab2.sorte is not null
  ) as sorten,
  case
    when f.geometrie is not null
    then round((ST_Area(f.geometrie::geography) / 10000)::numeric, 4)
  end as flaeche_brutto_ha
from feld_anbau fa
join feld f on f.id = fa.feld_id
left join feld_anbau_abschnitt ab on ab.feld_anbau_id = fa.id
left join feld_anbau_abschnitt_berechnet bb on bb.id = ab.id
group by fa.id, f.bezeichnung, f.kultur, f.geometrie, fa.feld_id, fa.saison_jahr,
  fa.erntefenster_von, fa.erntefenster_bis, fa.ertrag_erwartet,
  fa.ertrag_einheit, fa.rodung_geplant, fa.notiz;

alter view feld_anbau_uebersicht set (security_invoker = true);
grant select on feld_anbau_uebersicht to authenticated;
