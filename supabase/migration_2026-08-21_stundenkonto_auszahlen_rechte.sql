-- Migration 2026-08-21: "In Auszahlung umwandeln" auch für hr/management
--
-- Nutzer-Vorgabe: hr und management dürfen "In Auszahlung umwandeln"
-- ebenfalls sehen/nutzen (nicht nur admin/lohnabrechnung wie beim
-- ursprünglichen Bau am 2026-08-20) - ausdrücklich NICHT zeiterfassung
-- (die weiterhin nur "Buchen" darf). Muss exakt zu
-- kannStundenkontoAuszahlen in lib/stundenkontoRechte.ts passen.
--
-- Teil eines größeren Umbaus (siehe auch das direkt bearbeitbare
-- Stunden-Feld + Stundenkonto-Werkzeugleiste im Controlling-
-- Stundenmonitoring, app/management/page.tsx) - rein frontend-seitig,
-- keine eigene Migration nötig, nur diese eine Rollenänderung in der
-- Datenbank-Funktion.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

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
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
  s season_summary%rowtype;
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
