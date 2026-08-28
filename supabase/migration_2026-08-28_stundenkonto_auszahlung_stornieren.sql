-- Nutzer-Vorgabe 2026-08-28: "Ich habe ein Stundenkonto fälschlicherweise
-- in Auszahlung umgewandelt, jetzt stehen sie als Zulage im Lohn und ich
-- bekomme sie nicht mehr raus". Bisher gab es KEINEN Weg, eine "In
-- Auszahlung umwandeln"-Aktion rückgängig zu machen.

-- Neue Spalten: betrag hält den bei der Umwandlung tatsächlich berechneten
-- Auszahlungsbetrag fest (nötig, damit eine spätere Stornierung exakt
-- denselben Betrag wieder herausrechnen kann, auch falls sich der
-- Stundenlohn der Person inzwischen geändert hat). storniert verhindert
-- eine doppelte Stornierung derselben Zeile.
alter table stundenkonto_bewegungen
  add column if not exists betrag numeric(10, 2),
  add column if not exists storniert boolean not null default false;

-- Backfill für bereits bestehende 'Auszahlung'-Zeilen ohne betrag: mit dem
-- AKTUELLEN Stundenlohn der Person berechnet (die historische Umwandlung
-- selbst kannte keinen anderen Wert - für den Regelfall einer kurz zuvor
-- versehentlich gebuchten Umwandlung ist das exakt richtig, bei länger
-- zurückliegenden Buchungen nach einer zwischenzeitlichen
-- Stundenlohn-Änderung eine bestmögliche Annäherung).
update stundenkonto_bewegungen sb
set betrag = round(abs(sb.stunden) * coalesce(e.stundenlohn, 0), 2)
from employees e
where e.id = sb.employee_id
  and sb.art = 'Auszahlung'
  and sb.betrag is null;

-- stundenkonto_in_auszahlung_umwandeln: schreibt ab jetzt zusätzlich den
-- berechneten Betrag auf die Bewegungszeile (einzige inhaltliche Änderung
-- gegenüber der bisherigen Fassung).
create or replace function stundenkonto_in_auszahlung_umwandeln(
  p_employee_id uuid,
  p_saison_jahr int,
  p_stunden numeric,
  p_notiz text
)
returns numeric language plpgsql security definer as $$
declare
  v_saldo numeric;
  v_stundenlohn numeric;
  v_betrag numeric;
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

  select b.abgerechnet_am, b.auszahlungsbeleg_id, ab.belegnummer, ab.zahlungsart
    into v_abgerechnet_am, v_auszahlungsbeleg_id, v_belegnummer, v_zahlungsart
  from season_bonuses b
  left join auszahlungsbelege ab on ab.id = b.auszahlungsbeleg_id
  where b.employee_id = p_employee_id and b.saison_jahr = p_saison_jahr;

  if v_abgerechnet_am is not null and ist_kassenpruefung_gesperrt(v_abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  if v_abgerechnet_am is not null then
    select * into s from season_summary
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;
    v_alter_betrag := s.auszahlungsbetrag;
  end if;

  insert into stundenkonto_bewegungen (employee_id, saison_jahr, stunden, art, notiz, betrag)
  values (p_employee_id, p_saison_jahr, -p_stunden, 'Auszahlung', p_notiz, v_betrag);

  insert into season_bonuses (employee_id, saison_jahr, stundenkonto_auszahlung_betrag)
  values (p_employee_id, p_saison_jahr, v_betrag)
  on conflict (employee_id, saison_jahr)
  do update set stundenkonto_auszahlung_betrag =
    season_bonuses.stundenkonto_auszahlung_betrag + v_betrag;

  if v_abgerechnet_am is not null then
    select * into neu from season_summary
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

    v_neuer_betrag := neu.auszahlungsbetrag;
    v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

    update season_bonuses
    set snapshot = to_jsonb(neu) - 'snapshot'
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

    perform auszahlungsbeleg_zeile_delta_anwenden(p_employee_id, v_auszahlungsbeleg_id, s, neu);

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

-- Macht eine "In Auszahlung umwandeln"-Aktion rückgängig. Bucht die Stunden
-- NICHT durch Löschen der ursprünglichen Zeile zurück (Audit-Trail bliebe
-- sonst unvollständig), sondern durch eine zusätzliche, ausgleichende
-- 'Korrektur'-Bewegung (positiv, ohne Saldo-Prüfung) - die ursprüngliche
-- 'Auszahlung'-Zeile bleibt sichtbar stehen, wird nur als storniert
-- markiert. Zieht denselben Betrag (aus der gespeicherten betrag-Spalte,
-- nicht neu berechnet) wieder von
-- season_bonuses.stundenkonto_auszahlung_betrag ab. Ist die Person bereits
-- abgerechnet, exakt dasselbe Schnappschuss-/Kassenbewegungs-Muster wie bei
-- der Umwandlung selbst bzw. abrechnung_korrigieren.
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

  insert into stundenkonto_bewegungen (employee_id, saison_jahr, stunden, art, notiz)
  values (
    v_bewegung.employee_id, v_bewegung.saison_jahr, abs(v_bewegung.stunden), 'Korrektur',
    'Storno der Auszahlung vom ' || v_bewegung.datum || ' (' || abs(v_bewegung.stunden) || ' Std.) - ' || p_grund
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
