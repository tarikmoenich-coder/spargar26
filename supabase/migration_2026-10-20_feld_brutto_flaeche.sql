-- Migration 2026-10-20: Brutto-Hektarfläche (aus der Geometrie) sichtbar machen
--
-- Nutzer-Vorgabe: Die beim Pachtwesen2026-Import berechnete Brutto-Fläche
-- ging bisher verloren (nur geometrie_geojson/geometrie_hash wurden
-- gespeichert) - jetzt wird sie direkt aus feld.geometrie berechnet (bleibt
-- dadurch auch nach einer manuellen Korrektur der Geometrie aktuell, statt
-- einen einmalig importierten Wert festzuschreiben) und in den beiden
-- relevanten Sichten mit ausgegeben.
--
-- Nutzt bewusst KEIN "extensions."-Präfix (siehe Migration
-- 2026-10-19_feld_geojson_view.sql - PostGIS liegt in diesem Projekt im
-- normalen Suchpfad, anders als in Pachtwesen2026).

create or replace view feld_geojson as
select
  id,
  bezeichnung,
  kultur,
  aktiv,
  ST_AsGeoJSON(geometrie) as geometrie_geojson,
  case
    when geometrie is not null
    then round((ST_Area(geometrie::geography) / 10000)::numeric, 4)
  end as flaeche_brutto_ha,
  pachtwesen_schlag_id,
  pachtwesen_geometrie_hash,
  pachtwesen_geometrie_hash_neu,
  pachtwesen_geometrie_geojson_neu
from feld;

alter view feld_geojson set (security_invoker = true);
grant select on feld_geojson to authenticated;

create or replace view feld_anbau_uebersicht as
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
  case
    when f.geometrie is not null
    then round((ST_Area(f.geometrie::geography) / 10000)::numeric, 4)
  end as flaeche_brutto_ha,
  (
    select string_agg(distinct ab2.sorte, ', ' order by ab2.sorte)
    from feld_anbau_abschnitt ab2
    where ab2.feld_anbau_id = fa.id and ab2.sorte is not null
  ) as sorten
from feld_anbau fa
join feld f on f.id = fa.feld_id
left join feld_anbau_abschnitt ab on ab.feld_anbau_id = fa.id
left join feld_anbau_abschnitt_berechnet bb on bb.id = ab.id
group by fa.id, f.bezeichnung, f.kultur, f.geometrie, fa.feld_id, fa.saison_jahr,
  fa.erntefenster_von, fa.erntefenster_bis, fa.ertrag_erwartet,
  fa.ertrag_einheit, fa.rodung_geplant, fa.notiz;

alter view feld_anbau_uebersicht set (security_invoker = true);
grant select on feld_anbau_uebersicht to authenticated;
