-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Friert beim "Jetzt Abrechnen" den kompletten berechneten Stand
-- (Stunden, Brutto, Abzüge, Netto, Auszahlungsbetrag, ...) als Schnappschuss
-- ein, damit spätere Änderungen an Sätzen/Vorschüssen eine bereits
-- ausgezahlte Abrechnung nicht rückwirkend verändern. Die Lohnübersicht
-- warnt, falls die Live-Neuberechnung inzwischen abweicht.
-- ============================================================================

alter table season_bonuses
  add column snapshot jsonb;

drop view if exists season_summary;

create view season_summary as
with base as (
  select
    e.id as employee_id,
    e.personal_nr,
    e.name,
    e.vorname,
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
  netto - abzug_verpflegung - abzug_wohnen - vorschuss_summe
    as auszahlungsbetrag
from steuer;

grant select on season_summary to authenticated;

-- saison_abrechnen neu anlegen: erstellt jetzt zusätzlich den Schnappschuss.
create or replace function saison_abrechnen(p_employee_id uuid, p_saison_jahr int)
returns void language plpgsql security definer as $$
declare
  s season_summary%rowtype;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
  end if;

  select * into s from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if not found then
    raise exception 'Keine Saison-Daten für diese Person/dieses Jahr gefunden';
  end if;

  insert into season_bonuses (employee_id, saison_jahr, abgerechnet_am, abgerechnet_von, snapshot)
  values (p_employee_id, p_saison_jahr, now(), auth.uid(), to_jsonb(s) - 'snapshot')
  on conflict (employee_id, saison_jahr)
  do update set
    abgerechnet_am = now(),
    abgerechnet_von = auth.uid(),
    snapshot = excluded.snapshot;

  update employees set aktiv = false where id = p_employee_id;
end;
$$;

grant execute on function saison_abrechnen(uuid, int) to authenticated;
