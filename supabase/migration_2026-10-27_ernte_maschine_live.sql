-- ============================================================================
-- Migration 2026-10-27: Grundlage für die Erntewirtschaft-Kartenansicht
-- (docs/erntewirtschaft-plan.md Teil E/F) - app/erntewirtschaft/page.tsx +
-- components/ErnteMaschinenKarte.tsx.
--
-- max_personen unterscheidet Weißspargel-Maschinen (1 Person, Default,
-- unveraendertes Verhalten) von Gruenspargel-Gruppenplattformen (bis zu 5
-- gleichzeitig angemeldete Personen) - die Prozessor-Anpassung fuer echte
-- Gruppenmaschinen (kapazitaetsbewusster person_login, kein Einzelperson-
-- Attribut auf ernte_kiste_zyklus bei Gruppen) ist NICHT Teil dieser
-- Migration, kommt erst, sobald eine echte Gruenspargel-Maschine ansteht.
--
-- ernte_maschine_live liefert nur, was die Karte braucht: letzte Position
-- (fuer die Online/Offline-Ampel), Anzahl aktuell angemeldeter Personen
-- (fuer "x/max_personen angemeldet") und kg heute. Die Fotos/Namen der
-- angemeldeten Personen laedt die Karte separat, gezielt beim Oeffnen eines
-- Popups (siehe Komponente) - nicht Teil dieser Sicht.
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

alter table ernte_maschine
  add column if not exists max_personen smallint not null default 1;

alter table ernte_maschine
  drop constraint if exists ernte_maschine_max_personen_check;
alter table ernte_maschine
  add constraint ernte_maschine_max_personen_check check (max_personen between 1 and 10);

create or replace view ernte_maschine_live as
select
  m.id as maschine_id,
  m.nummer,
  m.bezeichnung,
  m.max_personen,
  p.lat,
  p.lng,
  p.zeitpunkt as position_zeitpunkt,
  coalesce(s.aktive_personen, 0) as aktive_personen,
  coalesce(e.kg_heute, 0) as kg_heute
from ernte_maschine m
left join lateral (
  select lat, lng, zeitpunkt
  from ernte_position
  where maschine_id = m.id
  order by zeitpunkt desc
  limit 1
) p on true
left join lateral (
  select count(*) as aktive_personen
  from ernte_schicht
  where maschine_id = m.id and ende is null
) s on true
left join lateral (
  select sum(gewicht_netto_kg) as kg_heute
  from ernte_kiste_zyklus
  where maschine_id = m.id
    and status = 'gewogen'
    and gewogen_am >= date_trunc('day', now())
) e on true
where m.aktiv;

alter view ernte_maschine_live set (security_invoker = true);
grant select on ernte_maschine_live to authenticated;

-- Keine neue RLS-Policy noetig: security_invoker greift auf die bereits
-- passenden Policies zurueck (ernte_maschine_select/ernte_position_select/
-- ernte_schicht_select/ernte_kiste_zyklus_select - alle schon
-- admin/hr/management/erntewirtschaft/zeiterfassung, siehe migration_
-- 2026-10-20_erntewirtschaft_kisten_zyklus.sql).
