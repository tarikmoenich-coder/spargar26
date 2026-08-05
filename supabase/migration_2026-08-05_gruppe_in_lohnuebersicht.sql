-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Fügt gruppe_nr zu season_summary hinzu, damit die Saison-Lohnübersicht
-- nach Arbeitsgruppe gefiltert werden kann (z.B. um alle zur Abrechnung
-- vorgesehenen Personen vorab in eine Gruppe wie "101 - Abrechnen" zu
-- packen und dort gesammelt zu markieren).
--
-- CREATE OR REPLACE VIEW kann Spalten weder umbenennen noch ihre
-- Reihenfolge ändern - deshalb hier expliziter drop/create statt replace.
-- auszahlungsbeleg_summary hängt von season_summary ab, muss zuerst weg.
-- ============================================================================

drop view if exists auszahlungsbeleg_summary;
drop view if exists season_summary;

create view season_summary as
with base as (
  select
    e.id as employee_id,
    e.personal_nr,
    e.name,
    e.vorname,
    e.gruppe_nr,
    e.abrechnungsart,
    e.aktiv,
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
    b.netto_extern,
    b.abgerechnet_am,
    b.snapshot,
    b.auszahlungsbeleg_id,
    coalesce(b.bus_hin, 0) + coalesce(b.bus_rueck, 0) as bus_kosten,
    coalesce(b.fahrer_kaution, 0) as fahrer_kaution,
    coalesce(b.zimmer_kaution, 0) as zimmer_kaution,
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
      count(*) filter (where we2.stunden is not null or we2.markierung is not null) as anwesenheitstage
    from work_entries we2
    where we2.employee_id = e.id
    group by extract(year from we2.datum)
  ) we on true
  left join season_bonuses b on b.employee_id = e.id and b.saison_jahr = we.saison_jahr
  left join verpflegungssaetze v on v.saison_jahr = we.saison_jahr
),
steuer as (
  select
    base.*,
    case when abrechnungsart = 'pauschal'
      then round(bruttolohn * 0.05275, 2)
      else 0
    end as lohnsteuer_pauschal,
    case when abrechnungsart = 'pauschal'
      then bruttolohn - round(bruttolohn * 0.05275, 2)
      else netto_extern
    end as netto
  from base
)
select
  steuer.*,
  netto - abzug_verpflegung - abzug_wohnen - vorschuss_summe - bus_kosten
    - fahrer_kaution - zimmer_kaution
    as auszahlungsbetrag
from steuer;

grant select on season_summary to authenticated;

create view auszahlungsbeleg_summary as
select
  ab.id,
  ab.belegnummer,
  ab.saison_jahr,
  ab.zahlungsart,
  ab.erstellt_am,
  ab.erstellt_von,
  count(sb.employee_id) as anzahl_personen,
  sum((sb.snapshot ->> 'auszahlungsbetrag')::numeric) as summe_auszahlungsbetrag,
  bool_or(
    (sb.snapshot ->> 'auszahlungsbetrag')::numeric is distinct from ss.auszahlungsbetrag
  ) as weicht_ab
from auszahlungsbelege ab
join season_bonuses sb on sb.auszahlungsbeleg_id = ab.id
left join season_summary ss
  on ss.employee_id = sb.employee_id and ss.saison_jahr = sb.saison_jahr
group by ab.id, ab.belegnummer, ab.saison_jahr, ab.zahlungsart, ab.erstellt_am, ab.erstellt_von;

grant select on auszahlungsbeleg_summary to authenticated;
