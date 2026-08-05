-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- 1) Kassenbewegungen: nachträgliche Korrektur bestätigter Vorschuss-Beträge
--    mit Protokoll (wer/wann/Differenz/Grund), beeinflusst den Kassenbestand.
-- 2) Kautionen (Fahrer/Zimmer) als eigene Abzugsposition, wie Buskosten.
-- 3) Zahlungsart (Bar/Überweisung) beim "Jetzt Abrechnen" - für später per
--    Überweisung abzurechnende Personen (z.B. schon abgereist).
-- 4) "Suche"-View: Vorschuss-Historie schmal/breit zugänglich, für die neue
--    Suche-Seite (Stunden + Vorschüsse einer Person, für alle Rollen).
-- ============================================================================

-- 1) Kassenbewegungen ---------------------------------------------------------

create table kassenbewegungen (
  id bigint generated always as identity primary key,
  zeitstempel timestamptz not null default now(),
  art text not null,
  belegnummer text not null,
  delta numeric(10, 2) not null,
  zahlungsart text,
  bearbeiter_id uuid references profiles (id),
  hinweis text
);

alter table kassenbewegungen enable row level security;

create policy "kassenbewegungen_select" on kassenbewegungen for select
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));

create or replace function vorschuss_korrigieren(
  p_advance_id bigint,
  p_employee_id uuid,
  p_neuer_betrag numeric,
  p_hinweis text
)
returns void language plpgsql security definer as $$
declare
  alter_betrag numeric;
  v_belegnummer text;
  v_zahlungsart text;
  v_delta numeric;
begin
  if current_role_name() not in ('admin', 'kasse') then
    raise exception 'Keine Berechtigung für Beleg-Korrektur';
  end if;

  if p_neuer_betrag <= 0 then
    raise exception 'Betrag muss größer als 0 sein';
  end if;

  select ar.anteil into alter_betrag
  from advance_recipients ar
  where ar.advance_id = p_advance_id and ar.employee_id = p_employee_id;

  if not found then
    raise exception 'Empfänger nicht in diesem Beleg gefunden';
  end if;

  select belegnummer, zahlungsart into v_belegnummer, v_zahlungsart
  from advances where id = p_advance_id;

  v_delta := p_neuer_betrag - coalesce(alter_betrag, 0);

  update advance_recipients
  set anteil = p_neuer_betrag
  where advance_id = p_advance_id and employee_id = p_employee_id;

  update advances
  set betrag = (
    select coalesce(sum(anteil), 0)
    from advance_recipients
    where advance_id = p_advance_id
  )
  where id = p_advance_id;

  insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
  values ('Vorschuss-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_hinweis);
end;
$$;

grant execute on function vorschuss_korrigieren(bigint, uuid, numeric, text) to authenticated;

-- 2) Kautionen -----------------------------------------------------------------

alter table season_bonuses
  add column fahrer_kaution numeric(10, 2) not null default 0,
  add column zimmer_kaution numeric(10, 2) not null default 0;

-- 3) Zahlungsart bei Auszahlung --------------------------------------------

alter table auszahlungsbelege
  add column zahlungsart text not null default 'BAR';

-- season_summary + auszahlungsbeleg_summary neu anlegen (Kautionen +
-- Zahlungsart mit einbeziehen). auszahlungsbeleg_summary hängt von
-- season_summary ab, muss zuerst weg.

drop view if exists auszahlungsbeleg_summary;
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

-- saison_abrechnen_batch neu mit Zahlungsart-Parameter.
drop function if exists saison_abrechnen_batch(uuid[], int);

create or replace function saison_abrechnen_batch(
  p_employee_ids uuid[],
  p_saison_jahr int,
  p_zahlungsart text default 'BAR'
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

  insert into auszahlungsbelege (belegnummer, saison_jahr, zahlungsart, erstellt_von)
  values (neue_belegnummer, p_saison_jahr, p_zahlungsart, auth.uid())
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

grant execute on function saison_abrechnen_batch(uuid[], int, text) to authenticated;

-- 4) Suche: Vorschuss-Historie -------------------------------------------------

create or replace view employee_vorschuss_historie as
select
  ar.employee_id,
  a.datum,
  ar.anteil as betrag,
  a.zahlungsart,
  a.storniert
from advance_recipients ar
join advances a on a.id = ar.advance_id;

grant select on employee_vorschuss_historie to authenticated;
