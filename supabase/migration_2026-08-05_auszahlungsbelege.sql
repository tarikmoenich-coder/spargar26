-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Neue Seite "Auszahlungen": eine Belegnummer pro "Jetzt Abrechnen"-Aktion
-- (analog zu Vorschüssen/Kassenbuch), mit Übersicht (Anzahl Personen, Summe,
-- Abweichungs-Warnung) und aufklappbarer Detailliste.
-- Außerdem: Buskosten (vorfinanzierte Heimreise) als eigene, sichtbare
-- Abzugsposition im Auszahlungsbetrag (bisher gar nicht berücksichtigt).
-- ============================================================================

create table auszahlungsbelege (
  id bigint generated always as identity primary key,
  belegnummer text not null unique,
  saison_jahr int not null,
  erstellt_am timestamptz not null default now(),
  erstellt_von uuid references profiles (id)
);

alter table season_bonuses
  add column auszahlungsbeleg_id bigint references auszahlungsbelege (id);

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
    b.auszahlungsbeleg_id,
    coalesce(b.bus_hin, 0) + coalesce(b.bus_rueck, 0) as bus_kosten,
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
  netto - abzug_verpflegung - abzug_wohnen - vorschuss_summe - bus_kosten
    as auszahlungsbetrag
from steuer;

grant select on season_summary to authenticated;

-- Vorherige Einzelperson-Funktion durch die Batch-Variante ersetzen (ein
-- Beleg pro "Jetzt Abrechnen"-Aktion, egal wie viele Personen).
drop function if exists saison_abrechnen(uuid, int);

create or replace function saison_abrechnen_batch(
  p_employee_ids uuid[],
  p_saison_jahr int
)
returns text language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neuer_beleg_id bigint;
  neue_belegnummer text;
  emp_id uuid;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
  end if;

  neue_belegnummer := naechste_belegnummer('AZ-' || to_char(now(), 'MM-YYYY'));

  insert into auszahlungsbelege (belegnummer, saison_jahr, erstellt_von)
  values (neue_belegnummer, p_saison_jahr, auth.uid())
  returning id into neuer_beleg_id;

  foreach emp_id in array p_employee_ids loop
    select * into s from season_summary
    where employee_id = emp_id and saison_jahr = p_saison_jahr;

    if found then
      insert into season_bonuses (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        snapshot, auszahlungsbeleg_id
      )
      values (
        emp_id, p_saison_jahr, now(), auth.uid(),
        to_jsonb(s) - 'snapshot', neuer_beleg_id
      )
      on conflict (employee_id, saison_jahr)
      do update set
        abgerechnet_am = now(),
        abgerechnet_von = auth.uid(),
        snapshot = excluded.snapshot,
        auszahlungsbeleg_id = neuer_beleg_id;

      update employees set aktiv = false where id = emp_id;
    end if;
  end loop;

  return neue_belegnummer;
end;
$$;

grant execute on function saison_abrechnen_batch(uuid[], int) to authenticated;

create or replace view auszahlungsbeleg_summary as
select
  ab.id,
  ab.belegnummer,
  ab.saison_jahr,
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
group by ab.id, ab.belegnummer, ab.saison_jahr, ab.erstellt_am, ab.erstellt_von;

grant select on auszahlungsbeleg_summary to authenticated;

alter table auszahlungsbelege enable row level security;

-- Nur lesend per Policy - Schreiben passiert ausschließlich über die
-- security-definer Funktion saison_abrechnen_batch (wie beim Audit-Log).
create policy "auszahlungsbelege_select" on auszahlungsbelege for select
  using (auth.uid() is not null);
