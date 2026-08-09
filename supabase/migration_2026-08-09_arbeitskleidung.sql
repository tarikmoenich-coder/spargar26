-- Arbeitskleidung (Nutzer-Vorgabe 2026-08-09): Hose/Jacke/Stiefel werden
-- wie Buskosten/Kautionen als eigene, sichtbare Abzugsposition erfasst.
-- Nur diese drei werden berechnet - Spargelmesser/Feile/Handschuhe sind
-- Verbrauchsgegenstände (kostenloser Tausch), werden hier nicht erfasst.
-- Erfasst von der Rolle zeiterfassung (gibt die Kleidung aus), über die
-- neue Funktion arbeitskleidung_setzen. Feste Preise je Stück in
-- verpflegungssaetze (Einstellungen-Seite), damit zeiterfassung nur noch
-- Stückzahlen auswählen muss.

alter table season_bonuses
  add column kleidung_hose_anzahl int not null default 0;
alter table season_bonuses
  add column kleidung_jacke_anzahl int not null default 0;
alter table season_bonuses
  add column kleidung_stiefel_anzahl int not null default 0;

alter table verpflegungssaetze
  add column kleidung_hose numeric(6, 2);
alter table verpflegungssaetze
  add column kleidung_jacke numeric(6, 2);
alter table verpflegungssaetze
  add column kleidung_stiefel numeric(6, 2);

create or replace function arbeitskleidung_setzen(
  p_employee_id uuid,
  p_saison_jahr int,
  p_hose_anzahl int,
  p_jacke_anzahl int,
  p_stiefel_anzahl int
)
returns void language plpgsql security definer as $$
begin
  if current_role_name() not in ('admin', 'hr', 'zeiterfassung') then
    raise exception 'Keine Berechtigung für die Arbeitskleidung-Ausgabe';
  end if;

  if p_hose_anzahl < 0 or p_jacke_anzahl < 0 or p_stiefel_anzahl < 0 then
    raise exception 'Anzahl darf nicht negativ sein';
  end if;

  insert into season_bonuses (
    employee_id, saison_jahr,
    kleidung_hose_anzahl, kleidung_jacke_anzahl, kleidung_stiefel_anzahl
  )
  values (
    p_employee_id, p_saison_jahr,
    p_hose_anzahl, p_jacke_anzahl, p_stiefel_anzahl
  )
  on conflict (employee_id, saison_jahr)
  do update set
    kleidung_hose_anzahl = excluded.kleidung_hose_anzahl,
    kleidung_jacke_anzahl = excluded.kleidung_jacke_anzahl,
    kleidung_stiefel_anzahl = excluded.kleidung_stiefel_anzahl,
    updated_by = auth.uid(),
    updated_at = now();
end;
$$;

grant execute on function arbeitskleidung_setzen(uuid, int, int, int, int) to authenticated;

create or replace view employee_kleidung_ausgabe as
select
  employee_id,
  saison_jahr,
  kleidung_hose_anzahl,
  kleidung_jacke_anzahl,
  kleidung_stiefel_anzahl
from season_bonuses;

grant select on employee_kleidung_ausgabe to authenticated;

-- season_summary: kleidung_betrag als NEUE Spalte ans Ende angehängt (nach
-- auszahlungsbetrag), auszahlungsbetrag-Formel erweitert. WICHTIG: die
-- äußerste SELECT-Liste ist bewusst explizit ausgeschrieben statt
-- "steuer.*" zu nutzen, damit die Position bestehender Spalten garantiert
-- unverändert bleibt (sonst Fehler 42P16, siehe schema.sql-Kommentar).
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
