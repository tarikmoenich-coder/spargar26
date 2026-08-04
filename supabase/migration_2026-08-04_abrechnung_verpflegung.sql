-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Ergänzt:
--   1. "Aktiv seit" (erster Arbeitstag mit Stunden > 0) auf der Personal-Seite
--   2. Abrechnungsart je Mitarbeiter (pauschal/Lohnsteuerklasse 1/
--      sozialversicherungspflichtig) inkl. automatischer pauschaler
--      Lohnsteuer (5,275% vom Bruttolohn) in der Lohnübersicht
--   3. Konfigurierbare Verpflegungs-/Unterkunft-Sätze (Default 10€/10€ pro Tag,
--      vorher 3 Mahlzeiten-Spalten - jetzt ein Verpflegungssatz)
-- ============================================================================

-- season_summary hängt von den Spalten ab, die wir gleich ändern -
-- deshalb zuerst löschen und am Ende neu anlegen.
drop view if exists season_summary;

-- 1) Abrechnungsart
create type abrechnungsart as enum (
  'pauschal',
  'lohnsteuerklasse_1',
  'sozialversicherungspflichtig'
);

alter table employees
  add column abrechnungsart abrechnungsart not null default 'sozialversicherungspflichtig';

-- 2) Verpflegung/Wohnen vereinfachen (2 statt 4 Sätze, Default 10€/10€)
alter table verpflegungssaetze
  drop column if exists fruehstueck,
  drop column if exists mittag,
  drop column if exists abend,
  add column if not exists verpflegung numeric(6, 2) not null default 10.00;

alter table verpflegungssaetze
  alter column wohnen set default 10.00;

insert into verpflegungssaetze (saison_jahr, verpflegung, wohnen)
values (extract(year from current_date)::int, 10.00, 10.00)
on conflict (saison_jahr) do nothing;

-- 3) "Aktiv seit" - erster Arbeitstag mit Stunden > 0
create or replace view employee_erster_arbeitstag as
select employee_id, min(datum) as erster_arbeitstag
from work_entries
where stunden > 0
group by employee_id;

alter view employee_erster_arbeitstag set (security_invoker = true);
grant select on employee_erster_arbeitstag to authenticated;

-- season_summary neu anlegen (mit abrechnungsart, abzug_verpflegung statt
-- der 3 Mahlzeiten-Spalten, lohnsteuer_pauschal, nettolohn)
create view season_summary as
with base as (
  select
    e.id as employee_id,
    e.personal_nr,
    e.name,
    e.vorname,
    e.abrechnungsart,
    we.saison_jahr,
    we.gesamt_stunden,
    we.anwesenheitstage,
    coalesce(b.akkord_betrag, 0)
      + coalesce(b.praemie_ausgleich, 0)
      + coalesce(b.fahrer_zulage, 0)
      + coalesce(b.erdbeer_praemie, 0)
      + coalesce(b.spargel_praemie, 0) as praemien_summe,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0)) as basis_brutto,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0))
      + coalesce(b.akkord_betrag, 0)
      + coalesce(b.praemie_ausgleich, 0)
      + coalesce(b.fahrer_zulage, 0)
      + coalesce(b.erdbeer_praemie, 0)
      + coalesce(b.spargel_praemie, 0) as bruttolohn,
    coalesce(v.verpflegung, 0) * we.anwesenheitstage as abzug_verpflegung,
    coalesce(v.wohnen, 0) * we.anwesenheitstage as abzug_wohnen,
    coalesce((
      select sum(coalesce(ar.anteil, a.betrag / greatest(cnt.n, 1)))
      from advance_recipients ar
      join advances a on a.id = ar.advance_id
      join (
        select advance_id, count(*) n from advance_recipients group by advance_id
      ) cnt on cnt.advance_id = ar.advance_id
      where ar.employee_id = e.id
        and a.storniert = false
        and extract(year from a.datum) = we.saison_jahr
    ), 0) as vorschuss_summe
  from employees e
  join lateral (
    select
      extract(year from we2.datum)::int as saison_jahr,
      sum(coalesce(we2.stunden, 0) + (case when we2.markierung = 'U' then 8 else 0 end)) as gesamt_stunden,
      count(*) filter (where we2.stunden > 0 or we2.markierung is not null) as anwesenheitstage
    from work_entries we2
    where we2.employee_id = e.id
    group by extract(year from we2.datum)
  ) we on true
  left join season_bonuses b on b.employee_id = e.id and b.saison_jahr = we.saison_jahr
  left join verpflegungssaetze v on v.saison_jahr = we.saison_jahr
)
select
  base.*,
  case when abrechnungsart = 'pauschal'
    then round(bruttolohn * 0.05275, 2)
    else 0
  end as lohnsteuer_pauschal,
  bruttolohn
    - (case when abrechnungsart = 'pauschal' then round(bruttolohn * 0.05275, 2) else 0 end)
    - abzug_verpflegung
    - abzug_wohnen
    - vorschuss_summe as nettolohn
from base;

grant select on season_summary to authenticated;
