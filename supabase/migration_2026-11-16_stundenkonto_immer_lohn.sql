-- Migration 2026-11-16: Stundenkonto ist immer Lohn
--
-- Nutzer-Vorgabe 2026-11-16:
-- 1. Jede Stundenkonto-Buchung ist verpflichtend einem Tag zugeordnet
--    (Pflichtdatum im Saisonjahr, nicht in einem abgeschlossenen Monat) -
--    damit monatsgenau abgerechnet werden kann.
-- 2. Der offene Saldo zählt SOFORT zum Bruttolohn (Saldo × hinterlegter
--    Stundenlohn, Spalte "Zulage €"), nicht erst nach "In Auszahlung
--    umwandeln".
-- 3. Der Monatsfilter der Lohnübersicht zeigt die Stundenkonto-Buchungen
--    des jeweiligen Monats (nach Buchungsdatum).
-- 4. "Jetzt Abrechnen" sperrt nicht mehr bei offenem Stundenkonto, sondern
--    wandelt den Rest automatisch in Zulage um.
-- 5. Buchungen von VOR dieser Umstellung gelten als "Datum unbestätigt" -
--    beim Abrechnen wird gefragt, ob das Datum nachgetragen oder der
--    heutige Tag gesetzt werden soll.
--
-- In der Supabase SQL-Konsole ausführen. Läuft in einem Zug, kann
-- gefahrlos ein zweites Mal ausgeführt werden - AUSSER Schritt 1b (siehe
-- dort, ist entsprechend abgesichert).

-- ---------------------------------------------------------------------------
-- 1. stundenkonto_bewegungen: zwei neue Spalten
-- ---------------------------------------------------------------------------
do $$
begin
  -- 1a/1b nur beim ERSTEN Lauf: sonst würden bei einem zweiten Lauf auch
  -- die inzwischen neu (mit Pflichtdatum) gebuchten Zeilen wieder auf
  -- "unbestätigt" gesetzt.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stundenkonto_bewegungen'
      and column_name = 'datum_bestaetigt'
  ) then
    alter table stundenkonto_bewegungen
      add column datum_bestaetigt boolean not null default true,
      add column ist_storno boolean not null default false;

    -- Bisherige Storno-Rückbuchungen nachträglich kennzeichnen (bisher nur
    -- am festen Notiz-Anfang erkennbar, siehe
    -- stundenkonto_auszahlung_stornieren).
    update stundenkonto_bewegungen
    set ist_storno = true
    where art = 'Korrektur' and notiz like 'Storno der Auszahlung vom %';

    -- 1b. Alle bisherigen echten Buchungen: Datum war nur eine Vorbelegung
    -- und muss beim Abrechnen bestätigt/nachgetragen werden.
    update stundenkonto_bewegungen
    set datum_bestaetigt = false
    where art <> 'Auszahlung' and ist_storno = false;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Buchen: Pflichtdatum, im Saisonjahr, nicht im abgeschlossenen Monat
-- ---------------------------------------------------------------------------
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

  if p_datum is null then
    raise exception 'Bitte ein Datum angeben - jede Stundenkonto-Buchung muss einem Tag zugeordnet sein';
  end if;
  if extract(year from p_datum)::int <> p_saison_jahr then
    raise exception 'Das Datum muss im Saisonjahr % liegen', p_saison_jahr;
  end if;
  if exists (
    select 1 from periods p
    where p.saison_jahr = extract(year from p_datum)::int
      and p.monat = extract(month from p_datum)::int
      and p.gesperrt = true
  ) then
    raise exception 'Der Monat %/% ist abgeschlossen - keine Stundenkonto-Buchung mehr möglich. Bitte den Monat zuerst wieder öffnen.',
      extract(month from p_datum)::int, extract(year from p_datum)::int;
  end if;

  -- Bugfix 2026-08-20: die vorherige if/elsif-Kette prüfte "ist es KEINE
  -- Freizeitausgleich UND KEINE Korrektur" als letzte Bedingung - eine
  -- gültige Gutschrift (positive Stunden) fiel dadurch fälschlich in die
  -- "Ungültige Art"-Fehlermeldung, da p_art = 'Gutschrift' in keinem der
  -- vorherigen Zweige behandelt wurde. Jetzt je Art ein eigener,
  -- vollständiger Zweig.
  if p_art = 'Gutschrift' then
    if p_stunden <= 0 then
      raise exception 'Eine Gutschrift muss positiv sein';
    end if;
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
  elsif p_art = 'Korrektur' then
    null; -- bewusst ohne Saldo-Prüfung, siehe Kommentar bei der Tabelle
  else
    raise exception 'Ungültige Art - Auszahlung nur über die dafür vorgesehene Funktion';
  end if;

  insert into stundenkonto_bewegungen (employee_id, saison_jahr, datum, stunden, art, notiz)
  values (p_employee_id, p_saison_jahr, p_datum, p_stunden, p_art, p_notiz);
end;
$$;

-- Datum einer bestehenden Buchung bestätigen bzw. nachtragen (Nutzer-
-- Vorgabe 2026-11-16): für Buchungen von vor der Pflichtdatum-Umstellung
-- (datum_bestaetigt = false) - die Lohnübersicht fragt beim "Jetzt
-- Abrechnen" danach. Unverändertes Datum = reine Bestätigung (auch in
-- einem bereits abgeschlossenen Monat erlaubt, es ändert sich ja nichts).
-- Ein GEÄNDERTES Datum verschiebt Lohn zwischen zwei Monaten - dann darf
-- weder der bisherige noch der neue Monat abgeschlossen sein.
create or replace function stundenkonto_datum_setzen(
  p_bewegung_id bigint,
  p_datum date
)
returns void language plpgsql security definer as $$
declare
  v_bewegung stundenkonto_bewegungen%rowtype;
begin
  if current_role_name() not in ('admin', 'hr', 'zeiterfassung', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für das Stundenkonto';
  end if;

  if p_datum is null then
    raise exception 'Bitte ein Datum angeben';
  end if;

  select * into v_bewegung from stundenkonto_bewegungen where id = p_bewegung_id;
  if not found then
    raise exception 'Buchung nicht gefunden';
  end if;
  if v_bewegung.art = 'Auszahlung' or v_bewegung.ist_storno then
    raise exception 'Bei dieser Buchung kann das Datum nicht geändert werden';
  end if;
  if extract(year from p_datum)::int <> v_bewegung.saison_jahr then
    raise exception 'Das Datum muss im Saisonjahr % liegen', v_bewegung.saison_jahr;
  end if;

  if p_datum <> v_bewegung.datum and exists (
    select 1 from periods p
    where p.gesperrt = true
      and (
        (p.saison_jahr = extract(year from p_datum)::int
          and p.monat = extract(month from p_datum)::int)
        or (p.saison_jahr = extract(year from v_bewegung.datum)::int
          and p.monat = extract(month from v_bewegung.datum)::int)
      )
  ) then
    raise exception 'Das Datum kann nicht von % auf % geändert werden - einer der beiden Monate ist abgeschlossen. Bitte den Monat zuerst wieder öffnen.',
      to_char(v_bewegung.datum, 'DD.MM.YYYY'), to_char(p_datum, 'DD.MM.YYYY');
  end if;

  update stundenkonto_bewegungen
  set datum = p_datum, datum_bestaetigt = true
  where id = p_bewegung_id;
end;
$$;

grant execute on function stundenkonto_datum_setzen(bigint, date) to authenticated;

grant execute on function stundenkonto_buchen(uuid, int, date, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Datum einer bestehenden Buchung bestätigen/nachtragen
-- ---------------------------------------------------------------------------
create or replace function stundenkonto_datum_setzen(
  p_bewegung_id bigint,
  p_datum date
)
returns void language plpgsql security definer as $$
declare
  v_bewegung stundenkonto_bewegungen%rowtype;
begin
  if current_role_name() not in ('admin', 'hr', 'zeiterfassung', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für das Stundenkonto';
  end if;

  if p_datum is null then
    raise exception 'Bitte ein Datum angeben';
  end if;

  select * into v_bewegung from stundenkonto_bewegungen where id = p_bewegung_id;
  if not found then
    raise exception 'Buchung nicht gefunden';
  end if;
  if v_bewegung.art = 'Auszahlung' or v_bewegung.ist_storno then
    raise exception 'Bei dieser Buchung kann das Datum nicht geändert werden';
  end if;
  if extract(year from p_datum)::int <> v_bewegung.saison_jahr then
    raise exception 'Das Datum muss im Saisonjahr % liegen', v_bewegung.saison_jahr;
  end if;

  if p_datum <> v_bewegung.datum and exists (
    select 1 from periods p
    where p.gesperrt = true
      and (
        (p.saison_jahr = extract(year from p_datum)::int
          and p.monat = extract(month from p_datum)::int)
        or (p.saison_jahr = extract(year from v_bewegung.datum)::int
          and p.monat = extract(month from v_bewegung.datum)::int)
      )
  ) then
    raise exception 'Das Datum kann nicht von % auf % geändert werden - einer der beiden Monate ist abgeschlossen. Bitte den Monat zuerst wieder öffnen.',
      to_char(v_bewegung.datum, 'DD.MM.YYYY'), to_char(p_datum, 'DD.MM.YYYY');
  end if;

  update stundenkonto_bewegungen
  set datum = p_datum, datum_bestaetigt = true
  where id = p_bewegung_id;
end;
$$;

grant execute on function stundenkonto_datum_setzen(bigint, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Storno einer Umwandlung: Rückbuchung als ist_storno kennzeichnen
-- ---------------------------------------------------------------------------
create or replace function stundenkonto_auszahlung_stornieren(
  p_bewegung_id bigint,
  p_grund text
)
returns void language plpgsql security definer as $$
declare
  v_bewegung stundenkonto_bewegungen%rowtype;
  v_abgerechnet_am timestamptz;
  v_belegnummer text;
  v_zahlungsart text;
  v_auszahlungsbeleg_id bigint;
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
  s season_summary%rowtype;
  neu season_summary%rowtype;
begin
  if current_role_name() not in ('admin', 'hr', 'lohnabrechnung', 'management') then
    raise exception 'Keine Berechtigung, eine Stundenkonto-Auszahlung zu stornieren';
  end if;

  if p_grund is null or trim(p_grund) = '' then
    raise exception 'Bitte einen Grund für die Stornierung angeben';
  end if;

  select * into v_bewegung from stundenkonto_bewegungen where id = p_bewegung_id;
  if not found then
    raise exception 'Bewegung nicht gefunden';
  end if;
  if v_bewegung.art <> 'Auszahlung' then
    raise exception 'Nur eine Umwandlung in Auszahlung kann storniert werden';
  end if;
  if v_bewegung.storniert then
    raise exception 'Diese Auszahlung wurde bereits storniert';
  end if;

  select b.abgerechnet_am, b.auszahlungsbeleg_id, ab.belegnummer, ab.zahlungsart
    into v_abgerechnet_am, v_auszahlungsbeleg_id, v_belegnummer, v_zahlungsart
  from season_bonuses b
  left join auszahlungsbelege ab on ab.id = b.auszahlungsbeleg_id
  where b.employee_id = v_bewegung.employee_id and b.saison_jahr = v_bewegung.saison_jahr;

  if v_abgerechnet_am is not null and ist_kassenpruefung_gesperrt(v_abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  if v_abgerechnet_am is not null then
    select * into s from season_summary
    where employee_id = v_bewegung.employee_id and saison_jahr = v_bewegung.saison_jahr;
    v_alter_betrag := s.auszahlungsbetrag;
  end if;

  update stundenkonto_bewegungen set storniert = true where id = p_bewegung_id;

  -- ist_storno (2026-11-16): reine Rück-Umbuchung, zählt nicht in der
  -- Monatszuordnung (season_summary_monat) - die Stunden gehören weiterhin
  -- zum Monat ihrer ursprünglichen Gutschrift.
  insert into stundenkonto_bewegungen (employee_id, saison_jahr, stunden, art, notiz, ist_storno)
  values (
    v_bewegung.employee_id, v_bewegung.saison_jahr, abs(v_bewegung.stunden), 'Korrektur',
    'Storno der Auszahlung vom ' || v_bewegung.datum || ' (' || abs(v_bewegung.stunden) || ' Std.) - ' || p_grund,
    true
  );

  update season_bonuses
  set stundenkonto_auszahlung_betrag =
    greatest(0, stundenkonto_auszahlung_betrag - coalesce(v_bewegung.betrag, 0))
  where employee_id = v_bewegung.employee_id and saison_jahr = v_bewegung.saison_jahr;

  if v_abgerechnet_am is not null then
    select * into neu from season_summary
    where employee_id = v_bewegung.employee_id and saison_jahr = v_bewegung.saison_jahr;

    v_neuer_betrag := neu.auszahlungsbetrag;
    v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

    update season_bonuses
    set snapshot = to_jsonb(neu) - 'snapshot'
    where employee_id = v_bewegung.employee_id and saison_jahr = v_bewegung.saison_jahr;

    perform auszahlungsbeleg_zeile_delta_anwenden(v_bewegung.employee_id, v_auszahlungsbeleg_id, s, neu);

    if v_belegnummer is not null then
      insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
      values (
        'Stundenkonto-Auszahlung-Storno', v_belegnummer, v_delta, v_zahlungsart, auth.uid(),
        p_grund || ' - ' || abs(v_bewegung.stunden) || ' Std. zurückgebucht'
      );
    end if;
  end if;
end;
$$;

grant execute on function stundenkonto_auszahlung_stornieren(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. season_summary: offener Saldo zählt sofort zu Zulage/Bruttolohn
--    (Spaltenliste/-reihenfolge unverändert)
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
      -- Nutzer-Vorgabe 2026-11-16 ("Stundenkonto ist immer Lohn"): zusätzlich
      -- zum bereits eingefrorenen Betrag zählt der noch OFFENE Saldo sofort
      -- mit (Saldo × hinterlegter Stundenlohn) - nicht erst nach einer
      -- Umwandlung. Beim Abrechnen wird der Saldo eingefroren
      -- (saison_abrechnen_batch), die Summe hier bleibt dabei gleich.
      + coalesce(b.stundenkonto_auszahlung_betrag, 0)
      + round(coalesce(sk.saldo, 0) * coalesce(e.stundenlohn, 0), 2) as bruttolohn,
    coalesce(b.stundenkonto_auszahlung_betrag, 0)
      + round(coalesce(sk.saldo, 0) * coalesce(e.stundenlohn, 0), 2)
      as stundenkonto_auszahlung_betrag,
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
  left join lateral (
    select sum(sb.stunden) as saldo
    from stundenkonto_bewegungen sb
    where sb.employee_id = e.id
      and sb.saison_jahr = we.saison_jahr
  ) sk on true
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

-- ---------------------------------------------------------------------------
-- 6. season_summary_monat: Stundenkonto-Buchungen des Monats
--    (zwei neue Spalten am Ende)
-- ---------------------------------------------------------------------------
create or replace view season_summary_monat as
with we as (
  select
    w.employee_id,
    extract(year from w.datum)::int as saison_jahr,
    extract(month from w.datum)::int as monat,
    sum(coalesce(w.stunden, 0) + (case when w.markierung = 'U' then 8 else 0 end)) as gesamt_stunden,
    count(*) filter (where w.stunden is not null or w.markierung is not null) as anwesenheitstage,
    max(w.datum) filter (where w.stunden is not null or w.markierung is not null) as letzter_eintrag
  from work_entries w
  group by w.employee_id, extract(year from w.datum), extract(month from w.datum)
),
sk as (
  select
    sb.employee_id,
    sb.saison_jahr,
    extract(month from sb.datum)::int as monat,
    sum(sb.stunden) as stunden
  from stundenkonto_bewegungen sb
  where sb.art <> 'Auszahlung' and sb.ist_storno = false
  group by sb.employee_id, sb.saison_jahr, extract(month from sb.datum)
  having sum(sb.stunden) <> 0
),
m as (
  select
    coalesce(we.employee_id, sk.employee_id) as employee_id,
    coalesce(we.saison_jahr, sk.saison_jahr) as saison_jahr,
    coalesce(we.monat, sk.monat) as monat,
    we.gesamt_stunden,
    we.anwesenheitstage,
    we.letzter_eintrag,
    sk.stunden as sk_stunden
  from we
  full join sk
    on sk.employee_id = we.employee_id
    and sk.saison_jahr = we.saison_jahr
    and sk.monat = we.monat
)
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.gruppe_nr,
  e.aktiv,
  m.saison_jahr,
  m.monat,
  coalesce(m.gesamt_stunden, 0) as gesamt_stunden,
  coalesce(m.anwesenheitstage, 0) as anwesenheitstage,
  m.letzter_eintrag,
  (coalesce(m.gesamt_stunden, 0) * coalesce(e.stundenlohn, 0)) as basis_brutto,
  coalesce(v.verpflegung, 0) * coalesce(m.anwesenheitstage, 0) as abzug_verpflegung,
  coalesce(v.wohnen, 0) * coalesce(m.anwesenheitstage, 0) as abzug_wohnen,
  -- Für die druckbare Monatsliste der Buchhaltung (Herkunft statt Gruppe).
  e.herkunft,
  coalesce(m.sk_stunden, 0) as stundenkonto_stunden,
  round(coalesce(m.sk_stunden, 0) * coalesce(e.stundenlohn, 0), 2) as stundenkonto_betrag
from m
join employees e on e.id = m.employee_id
left join verpflegungssaetze v on v.saison_jahr = m.saison_jahr
-- Sicherheitsfix 2026-08-12 (Supabase-Advisor "Security Definer View"):
-- gleicher Grund wie bei season_summary - verpflegungssaetze ist per RLS
-- admin-only, diese Sicht braucht die Eigentümer-Rechte dafür, darf aber
-- nicht an zeiterfassung/erntewirtschaft durchgereicht werden.
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management');

grant select on season_summary_monat to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Jetzt Abrechnen: Rest-Saldo automatisch in Zulage umwandeln
-- ---------------------------------------------------------------------------
-- Basis ist die Fassung aus migration_2026-11-04_beschaeftigungsabschnitte
-- (4 Parameter inkl. p_austrittsdatum) - gleiche Signatur, deshalb reicht
-- CREATE OR REPLACE.
create or replace function saison_abrechnen_batch(
  p_employee_ids uuid[],
  p_saison_jahr int,
  p_zahlungsart text default 'BAR',
  p_austrittsdatum date default current_date
)
returns text language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neuer_beleg_id bigint;
  neue_belegnummer text;
  emp_id uuid;
  v_war_abgerechnet boolean;
  v_voller_stand jsonb;
  v_zeile jsonb;
  v_fehlende_namen text;
  v_saldo numeric;
  v_stundenlohn numeric;
  v_sk_betrag numeric;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
  end if;

  -- Nutzer-Vorgabe 2026-11-16 ("Stundenkonto ist immer Lohn"): Buchungen
  -- von vor der Pflichtdatum-Umstellung müssen vor dem Abrechnen ein
  -- bestätigtes Datum haben (die Lohnübersicht fragt danach und ruft
  -- stundenkonto_datum_setzen) - hier nur die serverseitige Absicherung,
  -- damit die Frage nicht umgangen werden kann.
  select string_agg(distinct e.name || ', ' || e.vorname, '; ')
    into v_fehlende_namen
  from stundenkonto_bewegungen sb
  join employees e on e.id = sb.employee_id
  where sb.employee_id = any(p_employee_ids)
    and sb.saison_jahr = p_saison_jahr
    and sb.datum_bestaetigt = false
    and sb.art <> 'Auszahlung'
    and sb.ist_storno = false;

  if v_fehlende_namen is not null then
    raise exception 'Stundenkonto-Buchungen ohne bestätigtes Datum bei: % - bitte zuerst das Datum nachtragen oder bestätigen.', v_fehlende_namen;
  end if;

  -- Ein negatives Stundenkonto würde den Lohn mindern - das soll nie
  -- unbemerkt eingefroren werden, sondern vorher bewusst korrigiert sein.
  select string_agg(e.name || ', ' || e.vorname || ' (' || sk.saldo || ' Std.)', '; ')
    into v_fehlende_namen
  from employee_stundenkonto_saldo sk
  join employees e on e.id = sk.employee_id
  where sk.employee_id = any(p_employee_ids)
    and sk.saison_jahr = p_saison_jahr
    and sk.saldo < 0;

  if v_fehlende_namen is not null then
    raise exception 'Negatives Stundenkonto bei: % - bitte zuerst im Stundenkonto korrigieren.', v_fehlende_namen;
  end if;

  select string_agg(s2.name || ', ' || s2.vorname, '; ')
    into v_fehlende_namen
  from season_summary s2
  where s2.employee_id = any(p_employee_ids)
    and s2.saison_jahr = p_saison_jahr
    and s2.bruttolohn > 0
    and s2.netto is null;

  if v_fehlende_namen is not null then
    raise exception 'Bitte zuerst den Netto-Betrag aus dem Lohnprogramm eintragen für: %', v_fehlende_namen;
  end if;

  neue_belegnummer := naechste_belegnummer('AZ-' || to_char(now(), 'MM-YYYY'));

  insert into auszahlungsbelege (belegnummer, saison_jahr, zahlungsart, erstellt_von)
  values (neue_belegnummer, p_saison_jahr, p_zahlungsart, auth.uid())
  returning id into neuer_beleg_id;

  foreach emp_id in array p_employee_ids loop
    -- Nutzer-Vorgabe 2026-11-16: der noch offene Stundenkonto-Saldo wird
    -- beim Abrechnen automatisch in Zulage umgewandelt (Stunden ×
    -- hinterlegter Stundenlohn) - ersetzt die frühere Sperre "offenes
    -- Stundenkonto" und den Handknopf "In Auszahlung umwandeln". Am Lohn
    -- ändert das nichts (der Saldo steckt ohnehin schon live im Brutto,
    -- siehe season_summary) - der Betrag wird nur von "Saldo × aktueller
    -- Stundenlohn" in einen festen Euro-Betrag überführt und das Konto
    -- steht danach auf 0. Die 'Auszahlung'-Zeile zählt in der
    -- Monatszuordnung nicht mit (die Stunden bleiben beim Monat ihrer
    -- Gutschrift).
    select coalesce(sum(stunden), 0) into v_saldo
    from stundenkonto_bewegungen
    where employee_id = emp_id and saison_jahr = p_saison_jahr;

    if v_saldo > 0 then
      select stundenlohn into v_stundenlohn from employees where id = emp_id;
      v_sk_betrag := round(v_saldo * coalesce(v_stundenlohn, 0), 2);

      insert into stundenkonto_bewegungen (employee_id, saison_jahr, datum, stunden, art, notiz, betrag)
      values (
        emp_id, p_saison_jahr, current_date, -v_saldo, 'Auszahlung',
        'Automatisch beim Abrechnen in Zulage umgewandelt (Beleg ' || neue_belegnummer || ')',
        v_sk_betrag
      );

      insert into season_bonuses (employee_id, saison_jahr, stundenkonto_auszahlung_betrag)
      values (emp_id, p_saison_jahr, v_sk_betrag)
      on conflict (employee_id, saison_jahr)
      do update set stundenkonto_auszahlung_betrag =
        season_bonuses.stundenkonto_auszahlung_betrag + v_sk_betrag;
    end if;

    select * into s from season_summary
    where employee_id = emp_id and saison_jahr = p_saison_jahr;

    if found then
      v_war_abgerechnet := s.abgerechnet_am is not null;
      v_voller_stand := to_jsonb(s) - 'snapshot';
      if v_war_abgerechnet then
        v_zeile := auszahlungsbeleg_zeile_differenz(v_voller_stand, s.snapshot);
      else
        v_zeile := v_voller_stand;
      end if;

      insert into auszahlungsbeleg_zeilen (
        auszahlungsbeleg_id, employee_id, saison_jahr, personal_nr, name,
        vorname, abrechnungsart, ist_differenz, zeile
      )
      values (
        neuer_beleg_id, emp_id, p_saison_jahr, s.personal_nr, s.name,
        s.vorname, s.abrechnungsart, v_war_abgerechnet, v_zeile
      );

      insert into season_bonuses (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        snapshot, auszahlungsbeleg_id
      )
      values (
        emp_id, p_saison_jahr, now(), auth.uid(),
        v_voller_stand, neuer_beleg_id
      )
      on conflict (employee_id, saison_jahr)
      do update set
        abgerechnet_am = now(),
        abgerechnet_von = auth.uid(),
        snapshot = excluded.snapshot,
        auszahlungsbeleg_id = neuer_beleg_id;

      insert into saison_abrechnungen (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        auszahlungsbeleg_id
      )
      values (emp_id, p_saison_jahr, now(), auth.uid(), neuer_beleg_id);

      update employees set aktiv = false where id = emp_id;

      -- Neu: Beschaeftigungsabschnitt zeitgleich schliessen. Idempotent -
      -- bei einem Differenzbeleg (Person war fuer dieses Jahr schon
      -- abgemeldet) tut der zweite Aufruf nichts.
      perform employee_beschaeftigung_abmelden(emp_id, p_austrittsdatum);
    end if;
  end loop;

  return neue_belegnummer;
end;
$$;

grant execute on function saison_abrechnen_batch(uuid[], int, text, date) to authenticated;
