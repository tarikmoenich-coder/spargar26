-- ============================================================================
-- Migration 2026-10-26: Waagen-Kiosk - Spargelsorte als Stammdaten-Baustein
-- + Live-Ansicht
--
-- Grundlage fuer die neue Touchscreen-Kiosk-Seite am Waagen-PC
-- (app/erntewirtschaft/waage/kiosk/page.tsx, Nutzer-Vorgabe 2026-10-26):
-- Gewicht/Tara/Feld/Sorte/Mitarbeiter+Foto sofort nach dem Wiegen anzeigen,
-- per Supabase Realtime statt Polling.
--
-- Sorte bewusst NICHT als Freitext-Spalte (erster Entwurf), sondern als
-- eigene Stammdaten-Tabelle mit FK von feld (Nutzer-Korrektur 2026-10-26:
-- "wird aber später wichtig für Feldbezogene Ernte und Sortenauswertung" -
-- Freitext wuerde Tippfehler/Schreibvarianten in eine spaetere
-- Sorten-Auswertung einschleppen). Anders als feld_anbau_abschnitt.sorte
-- (Erdbeeren, mehrere Sorten je Saison/Tunnel moeglich, dort bleibt Freitext
-- unveraendert) - ein Spargelfeld hat i.d.R. genau eine Sorte ueber Jahre,
-- darum FK direkt auf feld statt auf feld_anbau/-abschnitt.
-- ============================================================================

create table if not exists spargel_sorte (
  id bigint generated always as identity primary key,
  bezeichnung text not null unique,
  aktiv boolean not null default true
);

alter table spargel_sorte enable row level security;
create policy "spargel_sorte_select" on spargel_sorte for select
  using (auth.uid() is not null);
create policy "spargel_sorte_write" on spargel_sorte for all
  using (current_role_name() in ('admin', 'hr', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'hr', 'erntewirtschaft'));
grant select, insert, update, delete on spargel_sorte to authenticated;

alter table feld add column if not exists sorte_id bigint references spargel_sorte (id) on delete set null;
create index if not exists idx_feld_sorte on feld (sorte_id);

-- feld_geojson neu anlegen (DROP+CREATE, nicht CREATE OR REPLACE - siehe
-- Begruendung/Vorfall in migration_2026-10-20_feld_brutto_flaeche.sql) -
-- sorte_id/sorte_bezeichnung ans Ende angehaengt, /anbau/felder liest das.
drop view if exists feld_geojson;
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

-- Reine Lese-Sicht, fasst ernte_kiste_zyklus mit Feld/Sorte/Mitarbeiter
-- zusammen - die Kiosk-Seite fragt sie nach jedem Realtime-Ereignis auf
-- ernte_kiste_zyklus einmal gezielt per id ab (Realtime liefert nur die
-- Basistabellen-Spalten, keine Joins).
create or replace view ernte_kiosk_wiegung as
select
  z.id,
  z.tag_uid,
  z.waage_id,
  z.gewogen_am,
  z.gewicht_brutto_kg,
  z.tara_kg,
  z.gewicht_netto_kg,
  z.status,
  z.feld_id,
  f.bezeichnung as feld_bezeichnung,
  s.bezeichnung as feld_sorte,
  z.employee_id,
  e.name as mitarbeiter_name,
  e.vorname as mitarbeiter_vorname,
  e.personal_nr as mitarbeiter_personal_nr,
  e.foto_pfad as mitarbeiter_foto_pfad
from ernte_kiste_zyklus z
left join feld f on f.id = z.feld_id
left join spargel_sorte s on s.id = f.sorte_id
left join employees e on e.id = z.employee_id;

alter view ernte_kiosk_wiegung set (security_invoker = true);
grant select on ernte_kiosk_wiegung to authenticated;

-- Realtime fuer ernte_kiste_zyklus aktivieren (gleiches Muster wie
-- kassenbuch_buchung/work_entries, siehe migration_2026-10-03_kassenbuecher_
-- phase1.sql) - ohne das liefert ein .channel(...).on("postgres_changes", ...)
-- auf dieser Tabelle nichts.
do $$
begin
  alter publication supabase_realtime add table ernte_kiste_zyklus;
exception when duplicate_object then null;
end $$;
