-- Prämien Erdbeeren (Nutzer-Vorgabe 2026-08-09) - gleiches Grundmuster wie
-- Zuckermais (Strichliste je Mitarbeiter/Tag), aber mit Norm/Bonus JE
-- PARZELLE UND TAG statt global (auf mehreren Parzellen gleichzeitig
-- gepflückt, sehr unterschiedliche Gegebenheiten). Eigene, einfache
-- Parzellen-Stammdatentabelle (Name/Größe/Sorte/Pflanzenanzahl). "Sut"
-- (Abfall/nicht vermarktungsfähige Ware) wird zusätzlich erfasst, zählt
-- aber nicht zur Prämie. 1 Steige = 10 Schalen à 500g = 5 kg.
--
-- Tagesprämie = GREATEST(0, (Steigen − Stunden × Norm) × Bonus/Steige) -
-- fließt live in season_summary.praemien_summe/bruttolohn ein, wie
-- Zuckermais.
--
-- Bewusst NICHT jetzt gebaut: Mitarbeitermonitoring (schlechte
-- Ernteleistung, Wiederholungs-Warnung) - kommt später für alle drei
-- Kulturen gemeinsam.

create table erdbeeren_parzellen (
  id bigint generated always as identity primary key,
  name text not null unique,
  groesse_ha numeric(6, 2),
  sorte text,
  anzahl_pflanzen int,
  aktiv boolean not null default true,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create table erdbeeren_parzellen_saetze (
  id bigint generated always as identity primary key,
  parzelle_id bigint not null references erdbeeren_parzellen (id) on delete restrict,
  gueltig_ab date not null,
  norm_steigen_pro_stunde numeric(6, 2) not null,
  bonus_pro_steige numeric(6, 4) not null,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  unique (parzelle_id, gueltig_ab)
);

create table erdbeeren_rohdaten (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  parzelle_id bigint not null references erdbeeren_parzellen (id) on delete restrict,
  datum date not null,
  steigen numeric(8, 2) not null default 0,
  stunden numeric(5, 2) not null default 0,
  sut numeric(8, 2) not null default 0,
  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  unique (employee_id, parzelle_id, datum)
);

create index idx_erdbeeren_rohdaten_datum on erdbeeren_rohdaten (datum);
create index idx_erdbeeren_rohdaten_employee on erdbeeren_rohdaten (employee_id);
create index idx_erdbeeren_rohdaten_parzelle on erdbeeren_rohdaten (parzelle_id);

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
  greatest(
    (r.steigen - r.stunden * coalesce(s.norm_steigen_pro_stunde, 0))
      * coalesce(s.bonus_pro_steige, 0),
    0
  ) as praemie
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

create or replace view erdbeeren_statistik_tag as
select
  datum,
  parzelle_id,
  parzelle_name,
  sum(steigen) as summe_steigen,
  sum(sut) as summe_sut,
  sum(stunden) as summe_stunden,
  sum(praemie) as summe_praemie,
  case when sum(stunden) > 0 then sum(steigen) / sum(stunden) else null end
    as steigen_pro_stunde,
  case when sum(steigen) > 0
    then (13.90 * sum(stunden) + sum(praemie)) / sum(steigen)
    else null
  end as kosten_pro_steige
from erdbeeren_praemie_tag
group by datum, parzelle_id, parzelle_name
order by datum desc;

alter view erdbeeren_statistik_tag set (security_invoker = true);
grant select on erdbeeren_statistik_tag to authenticated;

create trigger trg_erdbeeren_rohdaten_updated_at before update on erdbeeren_rohdaten
  for each row execute function set_updated_at_and_version();

create trigger trg_audit_erdbeeren_rohdaten
  after insert or update on erdbeeren_rohdaten
  for each row execute function write_audit_log();

alter table erdbeeren_parzellen enable row level security;
alter table erdbeeren_parzellen_saetze enable row level security;
alter table erdbeeren_rohdaten enable row level security;

create policy "erdbeeren_parzellen_select" on erdbeeren_parzellen for select
  using (auth.uid() is not null);
create policy "erdbeeren_parzellen_write" on erdbeeren_parzellen for all
  using (is_admin()) with check (is_admin());
create policy "erdbeeren_parzellen_saetze_select" on erdbeeren_parzellen_saetze for select
  using (auth.uid() is not null);
create policy "erdbeeren_parzellen_saetze_write" on erdbeeren_parzellen_saetze for all
  using (is_admin()) with check (is_admin());
create policy "erdbeeren_rohdaten_select" on erdbeeren_rohdaten for select
  using (auth.uid() is not null);
create policy "erdbeeren_rohdaten_write" on erdbeeren_rohdaten for insert
  with check (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft'));
create policy "erdbeeren_rohdaten_update" on erdbeeren_rohdaten for update
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft'));

-- season_summary: base-CTE um die live berechnete Erdbeeren-Saison-Summe
-- erweitert (nur bestehende Formeln für praemien_summe/bruttolohn
-- ergänzt - kein neues Spaltenlayout, kein 42P16-Risiko).
create or replace view season_summary as
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
      + coalesce(b.spargel_praemie, 0)
      + coalesce(zm.zuckermais_praemie_summe, 0)
      + coalesce(eb.erdbeeren_praemie_summe, 0) as praemien_summe,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0)) as basis_brutto,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0))
      + coalesce(b.akkord_betrag, 0)
      + coalesce(b.praemie_ausgleich, 0)
      + coalesce(b.fahrer_zulage, 0)
      + coalesce(b.erdbeer_praemie, 0)
      + coalesce(b.spargel_praemie, 0)
      + coalesce(zm.zuckermais_praemie_summe, 0)
      + coalesce(eb.erdbeeren_praemie_summe, 0) as bruttolohn,
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
    ), 0) as vorschuss_summe,
    coalesce(b.kleidung_hose_anzahl, 0) * coalesce(v.kleidung_hose, 0)
      + coalesce(b.kleidung_jacke_anzahl, 0) * coalesce(v.kleidung_jacke, 0)
      + coalesce(b.kleidung_stiefel_anzahl, 0) * coalesce(v.kleidung_stiefel, 0)
      as kleidung_betrag
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
  left join lateral (
    select sum(pt.praemie) as zuckermais_praemie_summe
    from zuckermais_praemie_tag pt
    where pt.employee_id = e.id
      and extract(year from pt.datum) = we.saison_jahr
  ) zm on true
  left join lateral (
    select sum(ept.praemie) as erdbeeren_praemie_summe
    from erdbeeren_praemie_tag ept
    where ept.employee_id = e.id
      and extract(year from ept.datum) = we.saison_jahr
  ) eb on true
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
  steuer.employee_id,
  steuer.personal_nr,
  steuer.name,
  steuer.vorname,
  steuer.gruppe_nr,
  steuer.abrechnungsart,
  steuer.aktiv,
  steuer.saison_jahr,
  steuer.gesamt_stunden,
  steuer.anwesenheitstage,
  steuer.praemien_summe,
  steuer.basis_brutto,
  steuer.bruttolohn,
  steuer.netto_extern,
  steuer.abgerechnet_am,
  steuer.snapshot,
  steuer.auszahlungsbeleg_id,
  steuer.bus_kosten,
  steuer.fahrer_kaution,
  steuer.zimmer_kaution,
  steuer.abzug_verpflegung,
  steuer.abzug_wohnen,
  steuer.vorschuss_summe,
  steuer.lohnsteuer_pauschal,
  steuer.netto,
  steuer.netto - steuer.abzug_verpflegung - steuer.abzug_wohnen
    - steuer.vorschuss_summe - steuer.bus_kosten - steuer.fahrer_kaution
    - steuer.zimmer_kaution - steuer.kleidung_betrag
    as auszahlungsbetrag,
  steuer.kleidung_betrag
from steuer;

grant select on season_summary to authenticated;
