-- Migration 2026-08-20b: Bugfix stundenkonto_buchen - "Gutschrift" schlug
-- fälschlich mit "Ungültige Art" fehl
--
-- Nutzer-Meldung: Art "Gutschrift" + Stunden eingeben ergab den Fehler
-- "⚠ Ungültige Art - Auszahlung nur über die dafür vorgesehene Funktion".
--
-- Ursache: die if/elsif-Kette in stundenkonto_buchen prüfte als letzten
-- Zweig nur "ist es KEINE Freizeitausgleich UND KEINE Korrektur" - eine
-- gültige Gutschrift (positive Stunden) wurde in keinem vorherigen Zweig
-- behandelt und fiel dadurch in diesen Zweig. Jetzt hat jede der vier
-- Arten einen eigenen, vollständigen Zweig.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

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
  values (p_employee_id, p_saison_jahr, coalesce(p_datum, current_date), p_stunden, p_art, p_notiz);
end;
$$;

grant execute on function stundenkonto_buchen(uuid, int, date, numeric, text, text) to authenticated;
