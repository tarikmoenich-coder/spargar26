-- Prämien: neuer Menüpunkt "Prämien" mit Untermenüs Spargel/Erdbeeren/
-- Zuckermais (Nutzer-Vorgabe 2026-08-09). Start mit Zuckermais (einfachste
-- Berechnung, kein Fremdsystem) - Spargel/Erdbeeren folgen als eigene
-- Ausbaustufen. Ersetzt schrittweise die Excel-Datei "Prämien Zuckermais
-- 2026.xlsx".
--
-- Logik 1:1 aus der Excel übernommen: pro Mitarbeiter/Tag werden Kisten und
-- Stunden erfasst. Norm (Kolben/Std.), Kolben je Kiste und €-Satz je Kolben
-- über der Norm ändern sich im Saisonverlauf (Excel: Norm stieg z.B. von
-- 140 auf 180 Kolben/Std.) - deshalb eine mit "gültig ab" versionierte
-- Sätze-Tabelle statt eines festen Werts pro Jahr. Tagesprämie =
-- GREATEST(0, (Kisten × Kolben/Kiste − Stunden × Norm) × Satz/Kolben). Die
-- Saison-Summe fließt live (nicht manuell gepflegt) in
-- season_summary.praemien_summe/bruttolohn ein - genau wie die bisherigen,
-- manuell eingetragenen Felder erdbeer_praemie/spargel_praemie. Kein neues
-- Auszahlungsfeld, keine Änderung an der äußersten SELECT-Liste von
-- season_summary nötig (praemien_summe/bruttolohn sind bereits bestehende
-- Spalten - kein 42P16-Risiko).

create table zuckermais_saetze (
  id bigint generated always as identity primary key,
  gueltig_ab date not null unique,
  norm_kolben_pro_stunde numeric(6, 2) not null,
  kolben_pro_kiste numeric(6, 2) not null default 55,
  satz_pro_kolben numeric(6, 4) not null,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now()
);

create table zuckermais_rohdaten (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  datum date not null,
  kisten numeric(8, 2) not null default 0,
  stunden numeric(5, 2) not null default 0,
  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  -- Optimistisches Sperren wie bei work_entries (siehe der Live-Sync-Bug
  -- vom 2026-08-08 - dort fehlte eine RLS-Berechtigung, version schützt
  -- zusätzlich vor echten Wettlaufsituationen bei gleichzeitiger
  -- Bearbeitung).
  version int not null default 1,
  unique (employee_id, datum)
);

create index idx_zuckermais_rohdaten_datum on zuckermais_rohdaten (datum);
create index idx_zuckermais_rohdaten_employee on zuckermais_rohdaten (employee_id);

create or replace view zuckermais_praemie_tag as
select
  r.id,
  r.employee_id,
  r.datum,
  r.kisten,
  r.stunden,
  s.norm_kolben_pro_stunde,
  s.kolben_pro_kiste,
  s.satz_pro_kolben,
  r.kisten * s.kolben_pro_kiste as kolben,
  greatest(
    (r.kisten * s.kolben_pro_kiste - r.stunden * coalesce(s.norm_kolben_pro_stunde, 0))
      * coalesce(s.satz_pro_kolben, 0),
    0
  ) as praemie
from zuckermais_rohdaten r
left join lateral (
  select z.norm_kolben_pro_stunde, z.kolben_pro_kiste, z.satz_pro_kolben
  from zuckermais_saetze z
  where z.gueltig_ab <= r.datum
  order by z.gueltig_ab desc
  limit 1
) s on true;

alter view zuckermais_praemie_tag set (security_invoker = true);
grant select on zuckermais_praemie_tag to authenticated;

create trigger trg_zuckermais_rohdaten_updated_at before update on zuckermais_rohdaten
  for each row execute function set_updated_at_and_version();

create trigger trg_audit_zuckermais_rohdaten
  after insert or update on zuckermais_rohdaten
  for each row execute function write_audit_log();

alter table zuckermais_rohdaten enable row level security;
alter table zuckermais_saetze enable row level security;

create policy "zuckermais_rohdaten_select" on zuckermais_rohdaten for select
  using (auth.uid() is not null);
create policy "zuckermais_rohdaten_write" on zuckermais_rohdaten for insert
  with check (current_role_name() in ('admin', 'hr', 'zeiterfassung'));
create policy "zuckermais_rohdaten_update" on zuckermais_rohdaten for update
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung'));
create policy "zuckermais_saetze_select" on zuckermais_saetze for select
  using (auth.uid() is not null);
create policy "zuckermais_saetze_write" on zuckermais_saetze for all
  using (is_admin()) with check (is_admin());

-- season_summary: base-CTE um die live berechnete Zuckermais-Saison-Summe
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
      + coalesce(zm.zuckermais_praemie_summe, 0) as praemien_summe,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0)) as basis_brutto,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0))
      + coalesce(b.akkord_betrag, 0)
      + coalesce(b.praemie_ausgleich, 0)
      + coalesce(b.fahrer_zulage, 0)
      + coalesce(b.erdbeer_praemie, 0)
      + coalesce(b.spargel_praemie, 0)
      + coalesce(zm.zuckermais_praemie_summe, 0) as bruttolohn,
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
