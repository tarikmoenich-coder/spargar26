-- ============================================================================
-- Migration 2026-11-28i: Spargel-Erntetage nach Befüllungstag
--
-- Problem (Nutzer 2026-11-28): "Prüfen & Freigeben" listete den 27.10. als
-- Erntetag, die Vorschau fand aber keine Kisten. Ursache: Liste und
-- Startseiten-Hinweis lasen ernte_ertrag_tag (Tag des WIEGENS), die Vorschau
-- spargel_tag_vorschau zählt nach Tag der BEFÜLLUNG (= Erntetag). Pilot-Kisten
-- wurden am 22.10./26.10. befüllt und erst am 27.10. gewogen.
--
-- Neue Sicht mit exakt der Kistenauswahl der Vorschau (gewogen, Maschine
-- bekannt, Einzelmaschine nur mit Person, Gruppenmaschine immer). Damit
-- listet die App nur Tage, die sich auch freigeben lassen.
-- ernte_ertrag_tag bleibt unverändert (Erntewirtschaft "heute gewogen").
-- ============================================================================

create or replace view spargel_erntetag as
select
  (z.befuellt_am at time zone 'Europe/Berlin')::date as tag,
  count(*)::int as kisten,
  sum(z.gewicht_netto_kg) as netto_kg
from ernte_kiste_zyklus z
join ernte_maschine m on m.id = z.maschine_id
where z.status = 'gewogen'
  and z.befuellt_am is not null
  and (coalesce(m.max_personen, 1) > 1 or z.employee_id is not null)
group by 1;

alter view spargel_erntetag set (security_invoker = true);

grant select on spargel_erntetag to authenticated;
