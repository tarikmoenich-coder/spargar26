-- ============================================================================
-- Migration 2026-11-05: Erntewirtschaft - ernte_ertrag_tag + ernte_kette_luecken
--
-- Grundlage fuer die Tages-Kacheln auf /erntewirtschaft (docs/
-- erntewirtschaft-plan.md Teil E/F): "Kisten heute"/"kg heute" aus
-- ernte_ertrag_tag, "Kisten ohne Zuordnung"/"Kisten fehlen heute" aus
-- ernte_kette_luecken. Baureihenfolge laut Plan: zuerst das einfache
-- Aggregat, dann die Reconciliation-Sicht (ernte_kette_luecken-Entwurf
-- 1:1 aus docs/erntewirtschaft-plan.md uebernommen).
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

insert into ernte_konfig (schluessel, wert, beschreibung) values
  ('netto_plausibel_min_kg', '1', 'Unterhalb dieses Nettogewichts gilt eine gewogene Kiste als implausibel (Platzhalter, bitte vor Produktivbetrieb pruefen)'),
  ('netto_plausibel_max_kg', '30', 'Oberhalb dieses Nettogewichts gilt eine gewogene Kiste als implausibel (Platzhalter, bitte vor Produktivbetrieb pruefen)')
on conflict (schluessel) do nothing;

create or replace view ernte_ertrag_tag as
select
  date_trunc('day', z.gewogen_am at time zone 'Europe/Berlin') as tag,
  z.maschine_id,
  z.feld_id,
  sum(z.gewicht_netto_kg) as netto_kg,
  count(*) as kisten,
  min(z.befuellt_am) as erste_befuellung,
  max(z.gewogen_am) as letzte_wiegung
from ernte_kiste_zyklus z
where z.status = 'gewogen'
group by 1, z.maschine_id, z.feld_id;

alter view ernte_ertrag_tag set (security_invoker = true);
grant select on ernte_ertrag_tag to authenticated;

create or replace view ernte_kette_luecken as
select
  z.id as zyklus_id,
  z.tag_uid,
  z.employee_id,
  z.maschine_id,
  z.feld_id,
  z.befuellt_am,
  z.gewogen_am,
  z.status,
  z.gewicht_netto_kg,
  case
    when z.status = 'offen' then 'befuellt_nie_gewogen'
    when z.status = 'ungeklaert' then 'gewogen_ohne_befuellung'
    when z.status = 'gewogen'
      and (z.gewicht_netto_kg < k_min.wert::numeric or z.gewicht_netto_kg > k_max.wert::numeric)
      then 'implausibles_gewicht'
  end as art,
  (z.status = 'offen' and (
    z.befuellt_am::date < current_date
    or (z.befuellt_am::date = current_date
        and current_time >= k_faellig.wert::time)
  )) as ist_faellig
from ernte_kiste_zyklus z
left join ernte_konfig k_faellig on k_faellig.schluessel = 'kiste_faellig_bis'
left join ernte_konfig k_min on k_min.schluessel = 'netto_plausibel_min_kg'
left join ernte_konfig k_max on k_max.schluessel = 'netto_plausibel_max_kg'
where z.status in ('offen', 'ungeklaert')
   or (z.status = 'gewogen'
       and (z.gewicht_netto_kg < k_min.wert::numeric or z.gewicht_netto_kg > k_max.wert::numeric));

alter view ernte_kette_luecken set (security_invoker = true);
grant select on ernte_kette_luecken to authenticated;
