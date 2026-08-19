-- Migration 2026-08-19: "Verpflegungsfreie Tage" - Korrektur eines zu hoch
-- abgezogenen Verpflegungsabzugs (z.B. Kantine noch nicht geöffnet)
--
-- Nutzer-Vorgabe: eine Mitarbeiterin wurde nach einer bereits erfolgten
-- Auszahlung darauf aufmerksam, dass ihr zu viel Verpflegung abgezogen
-- wurde, weil die Kantine an einigen Tagen noch nicht offen hatte. Der
-- Verpflegungsabzug wird komplett automatisch aus Tagessatz ×
-- Anwesenheitstage berechnet - es gab bisher keine Möglichkeit, einzelne
-- Tage davon auszunehmen, weder vor noch nach dem Abrechnen.
--
-- Neues Feld season_bonuses.verpflegungsfreie_tage (je Mitarbeiter+Saison,
-- vom Nutzer bestätigt: einfaches Zahlenfeld statt einer gemeinsamen
-- "Kantine geschlossen"-Datumsliste) reduziert in season_summary NUR den
-- Verpflegungsabzug (Tagessatz × (Anwesenheitstage − verpflegungsfreie_
-- tage)), nicht die Anwesenheitstage selbst und nicht die Unterkunft.
-- Vor dem Abrechnen ein normales Eingabefeld wie Buskosten/Kautionen, nach
-- dem Abrechnen über die neue Funktion abrechnung_verpflegung_korrigieren
-- korrigierbar (gleiches Muster wie abrechnung_korrigieren: Pflichtgrund,
-- Protokoll in kassenbewegungen, Sperre bei bereits freigegebener
-- Kassenprüfung, aktualisiert den eingefrorenen Schnappschuss mit).
--
-- season_summary_monat (Monatsabschluss-Kontrolle) bleibt UNVERÄNDERT -
-- verpflegungsfreie_tage ist ein saisonweiter Wert, nicht monatsgenau, und
-- diese Sicht fließt ohnehin nicht in den Auszahlungsbetrag ein.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

alter table season_bonuses
  add column if not exists verpflegungsfreie_tage int not null default 0;

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
    coalesce(b.verpflegungsfreie_tage, 0) as verpflegungsfreie_tage,
    -- Nutzer-Vorgabe 2026-08-19 (Kantine noch nicht offen): reduziert NUR
    -- den Verpflegungsabzug, nicht die Anwesenheitstage selbst (die bleiben
    -- unverändert, siehe we.anwesenheitstage) und nicht die Unterkunft.
    coalesce(v.verpflegung, 0)
      * greatest(0, we.anwesenheitstage - coalesce(b.verpflegungsfreie_tage, 0))
      as abzug_verpflegung,
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
      -- Kein Eintrag = kein Abzug. Eine eingetragene "0" bedeutet: Person war
      -- anwesend, hat aber nicht gearbeitet - zählt trotzdem als
      -- Anwesenheitstag (Verpflegung/Unterkunft werden abgezogen).
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
    -- Nur bei 'pauschal' rechnet die App die Lohnsteuer selbst (fester
    -- Satz). Bei den anderen beiden Abrechnungsarten ist das gesetzlich
    -- nicht ohne echtes Lohnprogramm möglich - dort wird lohnsteuer_pauschal
    -- nicht befüllt, siehe netto_extern.
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
  -- NULL, solange bei nicht-pauschalen Abrechnungsarten noch kein
  -- netto_extern eingetragen wurde - bewusst kein Platzhalterwert.
  steuer.netto - steuer.abzug_verpflegung - steuer.abzug_wohnen
    - steuer.vorschuss_summe - steuer.bus_kosten - steuer.fahrer_kaution
    - steuer.zimmer_kaution - steuer.kleidung_betrag
    as auszahlungsbetrag,
  steuer.kleidung_betrag,
  steuer.verpflegungsfreie_tage
from steuer
-- Sicherheitsfix 2026-08-12 (Supabase-Advisor "Security Definer View"):
-- diese Sicht liest bewusst mit den Rechten des Eigentümers (u.a.
-- season_bonuses, das per RLS auf admin/lohnabrechnung beschränkt ist),
-- damit auch kasse/pruefer/management die Lohnübersicht vollständig sehen
-- können. Ohne diese WHERE-Zeile wäre die Sicht aber für JEDE angemeldete
-- Rolle per REST-API abrufbar gewesen - auch zeiterfassung/erntewirtschaft,
-- die "Lohn" im Menü (components/Nav.tsx) nie zu sehen bekommen. Die
-- Rollenliste hier spiegelt exakt die Nav-Berechtigung für "/uebersicht".
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management');

grant select on season_summary to authenticated;

create or replace function abrechnung_verpflegung_korrigieren(
  p_employee_id uuid,
  p_saison_jahr int,
  p_neue_verpflegungsfreie_tage int,
  p_grund text
)
returns void language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neu season_summary%rowtype;
  v_belegnummer text;
  v_zahlungsart text;
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für Abrechnungs-Korrektur';
  end if;

  if p_grund is null or trim(p_grund) = '' then
    raise exception 'Bitte eine Begründung für die Korrektur angeben';
  end if;

  if p_neue_verpflegungsfreie_tage is null or p_neue_verpflegungsfreie_tage < 0 then
    raise exception 'Bitte eine gültige Anzahl Tage (0 oder mehr) angeben';
  end if;

  select * into s from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if not found or s.abgerechnet_am is null then
    raise exception 'Diese Person ist für dieses Jahr nicht abgerechnet - bitte das normale Eingabefeld auf der Lohnübersicht nutzen';
  end if;

  if ist_kassenpruefung_gesperrt(s.abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  select ab.belegnummer, ab.zahlungsart into v_belegnummer, v_zahlungsart
  from auszahlungsbelege ab where ab.id = s.auszahlungsbeleg_id;

  -- Bewusst der eingefrorene (nicht der live) Betrag als "vorher" - siehe
  -- gleiche Begründung in abrechnung_korrigieren.
  v_alter_betrag := (s.snapshot ->> 'auszahlungsbetrag')::numeric;

  update season_bonuses
  set verpflegungsfreie_tage = p_neue_verpflegungsfreie_tage
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  select * into neu from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  v_neuer_betrag := neu.auszahlungsbetrag;
  v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

  update season_bonuses
  set snapshot = to_jsonb(neu) - 'snapshot'
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if v_belegnummer is not null then
    insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
    values ('Verpflegungs-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_grund);
  end if;
end;
$$;

grant execute on function abrechnung_verpflegung_korrigieren(uuid, int, int, text) to authenticated;

