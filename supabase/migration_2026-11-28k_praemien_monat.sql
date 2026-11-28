-- ============================================================================
-- Migration 2026-11-28k: Tagesprämien je Monat (Lohn → Monatsfilter)
--
-- Nutzer-Vorgabe 2026-11-28: Spargel-, Erdbeer- und Zuckermais-Prämien im
-- Monatsfilter der Lohnübersicht ausweisen, im Monats-Brutto und auf der
-- gedruckten Monatsliste für die Buchhaltung. Auszahlung bleibt Saison.
--
-- Gleiche Quellen und Filter wie praemien_summe in season_summary, nur je
-- Kalendermonat des Prämientags:
--   Zuckermais  zuckermais_praemie_tag  (storniert = 0)
--   Erdbeeren   erdbeeren_praemie_tag   (storniert = 0)
--   Spargel     spargel_praemie_tag     nur lohnwirksam (= freigegeben)
-- Summe aller Monate = Tagesprämien der Saison-Summe. Saison-Prämien aus
-- season_bonuses (Akkord, Fahrer-Zulage, manuelle Erdbeer-/Spargelprämie)
-- haben kein Datum und bleiben nur in der Saison-Summe.
--
-- Bewusst eigene Sicht statt Umbau von season_summary_monat: die
-- Lohnberechnung bleibt unangetastet. Wie season_summary_monat mit
-- Eigentümer-Rechten und derselben Rechteprüfung.
-- Einzelne Anweisungen, wiederholbar.
-- ============================================================================

create or replace view public.praemie_monat as
with p as (
  select employee_id, extract(year from datum)::int as saison_jahr, extract(month from datum)::int as monat,
         0::numeric as spargel, 0::numeric as erdbeeren, coalesce(praemie, 0)::numeric as zuckermais
  from public.zuckermais_praemie_tag
  union all
  select employee_id, extract(year from datum)::int, extract(month from datum)::int,
         0, coalesce(praemie, 0), 0
  from public.erdbeeren_praemie_tag
  union all
  select employee_id, saison_jahr, extract(month from datum)::int,
         coalesce(praemie, 0), 0, 0
  from public.spargel_praemie_tag
  where lohnwirksam and employee_id is not null
)
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.gruppe_nr,
  e.aktiv,
  e.herkunft,
  p.saison_jahr,
  p.monat,
  sum(p.spargel) as spargel_praemie,
  sum(p.erdbeeren) as erdbeeren_praemie,
  sum(p.zuckermais) as zuckermais_praemie
from p
join public.employees e on e.id = p.employee_id
where public.darf_any(array['controlling:L', 'kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])
group by e.id, e.personal_nr, e.name, e.vorname, e.gruppe_nr, e.aktiv, e.herkunft, p.saison_jahr, p.monat
having sum(p.spargel) <> 0 or sum(p.erdbeeren) <> 0 or sum(p.zuckermais) <> 0;

revoke all on public.praemie_monat from anon;

grant select on public.praemie_monat to authenticated;
