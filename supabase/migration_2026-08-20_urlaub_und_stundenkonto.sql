-- Migration 2026-08-20: Resturlaub-Kontrolle + neues Stundenkonto
--
-- Nutzer-Vorgabe (zwei Teile):
-- 1. Arbeitsstunden-Controlling: bisher wurde nur "zu viel genommener
--    Urlaub" geprüft - der eigentliche Use Case ist aber zu WENIG
--    genommener Urlaub. employee_urlaubstage bekommt die umgekehrte
--    Richtung (resturlaub_tage/zu_wenig_genommen), die Anspruchslogik
--    selbst (2 Tage je vollem Kalendermonat) bleibt unverändert.
-- 2. Neues "Stundenkonto": ein laufendes Konto je Mitarbeiter/Saison-Jahr
--    (unabhängig vom gewählten Tag auf der Stundenerfassung pflegbar),
--    auf das Stunden gebucht werden können (Gutschrift/Korrektur/
--    Freizeitausgleich - keine Lohnwirkung) und aus dem Stunden "in
--    Auszahlung umgewandelt" werden können (admin/lohnabrechnung, erzeugt
--    einen echten Lohnbestandteil - fließt wie eine Prämie live in
--    Bruttolohn ein, erscheint auf der Lohnübersicht aber als eigene
--    Spalte). Bewegungs-Log statt Einzelfeld (wie kassenbewegungen), der
--    Kontostand ist die Summe aller Bewegungen.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

-- ---------------------------------------------------------------------------
-- 1. Resturlaub - umgekehrte Richtung zur bestehenden "ueberzogen"-Prüfung
-- ---------------------------------------------------------------------------
create or replace view employee_urlaubstage as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.aktiv,
  w.saison_jahr,
  w.erster_eintrag,
  w.letzter_eintrag,
  w.u_tage,
  greatest(0, monate.anzahl)::int as volle_kalendermonate,
  greatest(0, monate.anzahl)::int * 2 as urlaubsanspruch_tage,
  (w.u_tage > greatest(0, monate.anzahl) * 2) as ueberzogen,
  -- Nutzer-Vorgabe 2026-08-20: der Hauptfall ist eigentlich zu WENIG
  -- genommener Urlaub (bisher wurde nur "zu viel" geprüft) - offener Rest,
  -- bei einer bereits inaktiven Person praktisch eine Abgeltungspflicht.
  greatest(0, greatest(0, monate.anzahl)::int * 2 - w.u_tage) as resturlaub_tage,
  (w.u_tage < greatest(0, monate.anzahl) * 2) as zu_wenig_genommen
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden is not null or we.markierung is not null) as erster_eintrag,
    max(we.datum) filter (where we.stunden is not null or we.markierung is not null) as letzter_eintrag,
    count(*) filter (where we.markierung = 'U') as u_tage
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
join lateral (
  select
    (
      extract(year from end_adj) - extract(year from start_adj)
    ) * 12
    + (extract(month from end_adj) - extract(month from start_adj))
    + 1 as anzahl
  from (
    select
      case
        when extract(day from w.erster_eintrag) = 1
          then date_trunc('month', w.erster_eintrag)
        else date_trunc('month', w.erster_eintrag) + interval '1 month'
      end as start_adj,
      case
        when w.letzter_eintrag
          = (date_trunc('month', w.letzter_eintrag) + interval '1 month' - interval '1 day')::date
          then date_trunc('month', w.letzter_eintrag)
        else date_trunc('month', w.letzter_eintrag) - interval '1 month'
      end as end_adj
  ) x
) monate on true
where w.erster_eintrag is not null;

-- security_invoker = true: unbedenklich, employees und work_entries sind
-- ohnehin für jede angemeldete Rolle per RLS lesbar - kein Unterschied im
-- Ergebnis, silenced nur den Supabase-Security-Advisor-Hinweis.
alter view employee_urlaubstage set (security_invoker = true);
grant select on employee_urlaubstage to authenticated;

-- ---------------------------------------------------------------------------
-- 2. season_bonuses: neue Spalte für kumulierte Stundenkonto-Auszahlungen
-- ---------------------------------------------------------------------------
alter table season_bonuses
  add column if not exists stundenkonto_auszahlung_betrag numeric(10, 2) not null default 0;

-- ---------------------------------------------------------------------------
-- 3. Stundenkonto: Tabelle, Saldo-Sicht, zwei Funktionen
-- ---------------------------------------------------------------------------
create table stundenkonto_bewegungen (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,
  datum date not null default current_date,
  stunden numeric(6, 2) not null check (stunden <> 0),
  art text not null
    check (art in ('Gutschrift', 'Korrektur', 'Freizeitausgleich', 'Auszahlung')),
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now()
);

create index idx_stundenkonto_bewegungen_employee
  on stundenkonto_bewegungen (employee_id, saison_jahr);

-- Aktueller Kontostand je Mitarbeiter/Saison-Jahr - security_invoker
-- unbedenklich, stundenkonto_bewegungen ist per RLS ohnehin für jede
-- angemeldete Rolle lesbar (wie work_entries).
create or replace view employee_stundenkonto_saldo as
select employee_id, saison_jahr, sum(stunden) as saldo
from stundenkonto_bewegungen
group by employee_id, saison_jahr;

alter view employee_stundenkonto_saldo set (security_invoker = true);
grant select on employee_stundenkonto_saldo to authenticated;

-- Bucht Gutschrift/Korrektur/Freizeitausgleich - alles ohne unmittelbare
-- Lohnwirkung, deshalb dieselben Rechte wie die Stundenerfassung selbst.
create or replace function stundenkonto_buchen(
  p_employee_id uuid,
  p_saison_jahr int,
  p_datum date,
  p_stunden numeric,
  p_art text,
  p_notiz text
)
returns void language plpgsql security definer as $$
declare
  v_saldo numeric;
begin
  if current_role_name() not in ('admin', 'hr', 'zeiterfassung') then
    raise exception 'Keine Berechtigung für das Stundenkonto';
  end if;

  if p_stunden is null or p_stunden = 0 then
    raise exception 'Bitte eine Stundenzahl ungleich 0 angeben';
  end if;

  if p_art = 'Gutschrift' and p_stunden <= 0 then
    raise exception 'Eine Gutschrift muss positiv sein';
  elsif p_art = 'Freizeitausgleich' then
    if p_stunden >= 0 then
      raise exception 'Freizeitausgleich muss als negative Stundenzahl gebucht werden';
    end if;
    select coalesce(sum(stunden), 0) into v_saldo
    from stundenkonto_bewegungen
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;
    if -p_stunden > v_saldo then
      raise exception 'Nicht genug Stunden auf dem Stundenkonto (aktueller Saldo: % Std.)', v_saldo;
    end if;
  elsif p_art <> 'Korrektur' then
    raise exception 'Ungültige Art - Auszahlung nur über die dafür vorgesehene Funktion';
  end if;

  insert into stundenkonto_bewegungen (employee_id, saison_jahr, datum, stunden, art, notiz)
  values (p_employee_id, p_saison_jahr, coalesce(p_datum, current_date), p_stunden, p_art, p_notiz);
end;
$$;

grant execute on function stundenkonto_buchen(uuid, int, date, numeric, text, text) to authenticated;

-- Wandelt einen Teil des Stundenkonto-Saldos in eine Auszahlung um - admin/
-- lohnabrechnung wie "Jetzt Abrechnen" (echter Lohnbestandteil). Rechnet
-- automatisch Stunden × Stundenlohn, bucht eine negative Bewegung und
-- erhöht season_bonuses.stundenkonto_auszahlung_betrag (kumulativ - mehrere
-- Umwandlungen je Saison möglich). Ist die Person bereits abgerechnet,
-- wird zusätzlich der eingefrorene Schnappschuss aktualisiert und die
-- Änderung protokolliert - exakt dasselbe Muster wie
-- abrechnung_korrigieren (Sperre bei bereits freigegebener
-- Kassenprüfung, Eintrag in kassenbewegungen).
create or replace function stundenkonto_in_auszahlung_umwandeln(
  p_employee_id uuid,
  p_saison_jahr int,
  p_stunden numeric,
  p_notiz text
)
-- Gibt den berechneten Auszahlungsbetrag zurück (Stunden × Stundenlohn) -
-- so muss das Frontend employees.stundenlohn nicht selbst laden/anzeigen
-- (auf der Stundenerfassung sonst nur schmal für zeiterfassung geladen,
-- siehe employees-Select-Grant-Vorfall).
returns numeric language plpgsql security definer as $$
declare
  v_saldo numeric;
  v_stundenlohn numeric;
  v_betrag numeric;
  v_abgerechnet_am timestamptz;
  v_belegnummer text;
  v_zahlungsart text;
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
  s season_summary%rowtype;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung, Stundenkonto in Auszahlung umzuwandeln';
  end if;

  if p_stunden is null or p_stunden <= 0 then
    raise exception 'Bitte eine Stundenzahl größer als 0 angeben';
  end if;

  select coalesce(sum(stunden), 0) into v_saldo
  from stundenkonto_bewegungen
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if p_stunden > v_saldo then
    raise exception 'Nicht genug Stunden auf dem Stundenkonto (aktueller Saldo: % Std.)', v_saldo;
  end if;

  select stundenlohn into v_stundenlohn from employees where id = p_employee_id;
  v_betrag := round(p_stunden * coalesce(v_stundenlohn, 0), 2);

  select b.abgerechnet_am, ab.belegnummer, ab.zahlungsart
    into v_abgerechnet_am, v_belegnummer, v_zahlungsart
  from season_bonuses b
  left join auszahlungsbelege ab on ab.id = b.auszahlungsbeleg_id
  where b.employee_id = p_employee_id and b.saison_jahr = p_saison_jahr;

  if v_abgerechnet_am is not null and ist_kassenpruefung_gesperrt(v_abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  if v_abgerechnet_am is not null then
    select (snapshot ->> 'auszahlungsbetrag')::numeric into v_alter_betrag
    from season_bonuses
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;
  end if;

  insert into stundenkonto_bewegungen (employee_id, saison_jahr, stunden, art, notiz)
  values (p_employee_id, p_saison_jahr, -p_stunden, 'Auszahlung', p_notiz);

  insert into season_bonuses (employee_id, saison_jahr, stundenkonto_auszahlung_betrag)
  values (p_employee_id, p_saison_jahr, v_betrag)
  on conflict (employee_id, saison_jahr)
  do update set stundenkonto_auszahlung_betrag =
    season_bonuses.stundenkonto_auszahlung_betrag + v_betrag;

  if v_abgerechnet_am is not null then
    select * into s from season_summary
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

    v_neuer_betrag := s.auszahlungsbetrag;
    v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

    update season_bonuses
    set snapshot = to_jsonb(s) - 'snapshot'
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

    if v_belegnummer is not null then
      insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
      values (
        'Stundenkonto-Auszahlung', v_belegnummer, v_delta, v_zahlungsart, auth.uid(),
        coalesce(p_notiz || ' - ', '') || p_stunden || ' Std. umgewandelt'
      );
    end if;
  end if;

  return v_betrag;
end;
$$;

grant execute on function stundenkonto_in_auszahlung_umwandeln(uuid, int, numeric, text) to authenticated;

alter table stundenkonto_bewegungen enable row level security;

-- stundenkonto_bewegungen: wie work_entries breit lesbar - Schreiben
-- ausschließlich über stundenkonto_buchen/stundenkonto_in_auszahlung_
-- umwandeln (keine Schreib-Policy auf der Tabelle selbst, siehe Kommentar
-- oben).
create policy "stundenkonto_bewegungen_select" on stundenkonto_bewegungen for select
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 4. season_summary: stundenkonto_auszahlung_betrag fließt in bruttolohn
--    ein und wird als eigene Spalte ausgegeben (ans Ende angehängt)
-- ---------------------------------------------------------------------------
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
      + coalesce(eb.erdbeeren_praemie_summe, 0)
      -- Nutzer-Vorgabe 2026-08-20: verhält sich wie eine Prämie (fließt in
      -- Bruttolohn ein, normal lohnsteuerpflichtig), erscheint aber als
      -- eigene Spalte statt in praemien_summe eingerechnet zu werden.
      + coalesce(b.stundenkonto_auszahlung_betrag, 0) as bruttolohn,
    coalesce(b.stundenkonto_auszahlung_betrag, 0) as stundenkonto_auszahlung_betrag,
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
  steuer.verpflegungsfreie_tage,
  steuer.stundenkonto_auszahlung_betrag
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
