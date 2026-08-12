-- Migration 2026-08-11: Statuswechsel ueberträgt Stunden ab dem Stichtag
--
-- Nutzer-Vorgabe: "Der Knopf 'Statuswechsel' tut momentan noch nicht ganz
-- was er soll. Er legt eine neue Person mit der gleichen Personalnummer
-- (suffix 'a') an, und stellt die alte Nummer inaktiv. Das ist auch
-- korrekt. Aber dann muessen Stunden, die ab dem eingegebenen (SV-Pfl.)
-- Datum eingetragen wurden, auf die neue Personalnummer uebertragen
-- werden. Die bereits erfolgten Vorschuesse und Praemien bleiben vom
-- Statuswechsel unberuehrt, da sie sich nicht auf den
-- Beschaeftigungszeitraum auswirken."
--
-- Nutzer-Entscheidung zu gesperrten Monaten: liegt der Stichtag oder ein
-- spaeteres Datum mit erfassten Stunden in einem bereits per
-- Monatsabschluss gesperrten Monat, wird der Statuswechsel komplett
-- VERWEIGERT (nicht nur teilweise durchgefuehrt) - klare Fehlermeldung,
-- welcher Monat zuerst entsperrt werden muss.
--
-- Zwei neue Funktionen, bewusst SECURITY INVOKER: admin/hr duerfen
-- work_entries ohnehin direkt schreiben; die bestehende
-- work_entries_update-Policy sperrt Monatsabschluss-gesperrte Monate
-- "ausnahmslos fuer alle Rollen inkl. admin" - das soll hier unveraendert
-- gelten, ein SECURITY DEFINER wuerde diese Regel aufweichen.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

create or replace function statuswechsel_gesperrter_monat(
  p_employee_id uuid,
  p_stichtag date
)
returns text language sql security invoker stable as $$
  select to_char(min(we.datum), 'MM/YYYY')
  from work_entries we
  join periods p
    on p.saison_jahr = extract(year from we.datum)::int
    and p.monat = extract(month from we.datum)::int
  where we.employee_id = p_employee_id
    and we.datum >= p_stichtag
    and p.gesperrt;
$$;

grant execute on function statuswechsel_gesperrter_monat(uuid, date) to authenticated;

create or replace function statuswechsel_stunden_uebertragen(
  p_alt_employee_id uuid,
  p_neu_employee_id uuid,
  p_stichtag date
)
returns int language plpgsql security invoker as $$
declare
  v_gesperrter_monat text;
  v_anzahl int;
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung für Statuswechsel';
  end if;

  -- Erneute Prüfung (nicht nur clientseitig vor dem Anlegen der neuen
  -- Nummer) - verweigert die Übertragung vollständig, statt Stunden in
  -- gesperrten Monaten unbemerkt an der alten Nummer stehen zu lassen.
  v_gesperrter_monat := statuswechsel_gesperrter_monat(p_alt_employee_id, p_stichtag);
  if v_gesperrter_monat is not null then
    raise exception 'Monat % ist bereits per Monatsabschluss gesperrt - bitte zuerst entsperren, bevor der Statuswechsel durchgeführt wird.', v_gesperrter_monat;
  end if;

  update work_entries
  set employee_id = p_neu_employee_id
  where employee_id = p_alt_employee_id
    and datum >= p_stichtag;

  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

grant execute on function statuswechsel_stunden_uebertragen(uuid, uuid, date) to authenticated;
