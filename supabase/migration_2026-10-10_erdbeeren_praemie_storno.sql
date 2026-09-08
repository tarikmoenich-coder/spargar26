-- Prämien Erdbeeren stornieren (Nutzer-Vorgabe 2026-09-08): dieselbe
-- Storno-Funktion wie bei Zuckermais (migration_2026-10-09_...). Bei
-- Qualitätsreklamationen fällt die Tagesprämie einzelner Personen oder einer
-- ganzen Parzelle/Tag mit Begründung auf 0. Steigen/Stunden/Sut bleiben für
-- Ertrags- und Kostenstatistik erhalten. Der Grund erscheint in der Suche
-- (Mitarbeiter-Auskunft) und im dortigen Ausdruck.
--
-- Re-runnable: add column if not exists / drop constraint if exists /
-- create or replace view.

alter table erdbeeren_rohdaten
  add column if not exists praemie_storniert boolean not null default false,
  add column if not exists storno_grund text,
  add column if not exists storno_am timestamptz,
  add column if not exists storno_von uuid references profiles (id);

alter table erdbeeren_rohdaten
  drop constraint if exists erdbeeren_rohdaten_storno_grund_check;
alter table erdbeeren_rohdaten
  add constraint erdbeeren_rohdaten_storno_grund_check
  check (
    not praemie_storniert
    or (storno_grund is not null and length(btrim(storno_grund)) > 0)
  );

-- praemie = 0 sobald storniert. Wirkt dadurch automatisch in season_summary
-- (Auszahlung), erdbeeren_statistik_tag und erdbeeren_gruppenkosten_tag.
-- Storno-Infos ans Spaltenende angehängt (42P16).
create or replace view erdbeeren_praemie_tag as
select
  r.id,
  r.employee_id,
  r.parzelle_id,
  p.name as parzelle_name,
  r.datum,
  r.steigen,
  r.stunden,
  r.sut,
  s.norm_steigen_pro_stunde,
  s.bonus_pro_steige,
  case
    when r.praemie_storniert then 0::numeric
    else greatest(
      (r.steigen - r.stunden * coalesce(s.norm_steigen_pro_stunde, 0))
        * coalesce(s.bonus_pro_steige, 0),
      0
    )
  end as praemie,
  r.praemie_storniert,
  r.storno_grund,
  r.storno_am
from erdbeeren_rohdaten r
join erdbeeren_parzellen p on p.id = r.parzelle_id
left join lateral (
  select z.norm_steigen_pro_stunde, z.bonus_pro_steige
  from erdbeeren_parzellen_saetze z
  where z.parzelle_id = r.parzelle_id
    and z.gueltig_ab <= r.datum
  order by z.gueltig_ab desc
  limit 1
) s on true;

alter view erdbeeren_praemie_tag set (security_invoker = true);
grant select on erdbeeren_praemie_tag to authenticated;
