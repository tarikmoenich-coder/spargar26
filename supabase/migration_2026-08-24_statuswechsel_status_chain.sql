-- Migration 2026-08-24: Statuswechsel-Kette für die Sozialversicherung-Seite
--
-- Nutzer-Vorgabe: "Unter Sozialversicherung steht immer noch bei diesen
-- beiden inaktiven Personen 'Überschritten seit X Tagen'. Das System muss
-- mitbekommen, dass die Personen ab dem Stichtag SV-Pflichtig sind. Mir
-- fehlt da immer noch eine klare Spalte: 1. Zeitraum war von: Kurzfristig/
-- SV-Frei/SV-Pflichtig; 2. Zeitraum SV-Pflichtig/SV-Frei/etc. seit:"
--
-- Die 105-Tage-Prüfung selbst bleibt unverändert korrekt (die ALTE Nummer
-- HAT die Grenze in ihrem eigenen Zeitraum wirklich überschritten - das
-- ist ja der Grund für den Statuswechsel) - was fehlte, war die sichtbare
-- Verknüpfung "das ist inzwischen erledigt, siehe Nachfolge-Nummer X seit
-- Datum Y". Der Stichtag selbst wird nirgends gespeichert (nur transient
-- im Statuswechsel-Dialog) - hier stattdessen aus dem ersten übertragenen
-- Arbeitstag der neuen Nummer hergeleitet (verschiebt work_entries ab
-- genau diesem Datum, siehe statuswechsel_stunden_uebertragen), was in
-- der Praxis exakt dem Stichtag entspricht.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

create or replace function abrechnungsart_label(p_abrechnungsart abrechnungsart)
returns text language sql immutable as $$
  select case p_abrechnungsart
    when 'pauschal' then 'PA'
    when 'lohnsteuerklasse_1' then 'StKl 1'
    when 'sozialversicherungspflichtig' then 'SV-Pfl.'
  end;
$$;

create or replace view employee_status_chain as
select
  e.id as employee_id,
  -- Diese Nummer IST eine Nachfolge-Nummer (hat einen Vorgänger) - der
  -- Status davor + das Datum, seit dem der aktuelle Status gilt.
  case when e.vorgaenger_employee_id is not null
    then abrechnungsart_label(v.abrechnungsart)
  end as vorheriger_status,
  case when e.vorgaenger_employee_id is not null
    then (select min(we.datum) from work_entries we where we.employee_id = e.id)
  end as aktueller_status_seit,
  -- Diese Nummer HAT eine Nachfolge-Nummer (wurde per Statuswechsel
  -- abgelöst) - deren Status + Startdatum, für die Verknüpfung auf der
  -- alten (jetzt inaktiven) Nummer.
  n.personal_nr as nachfolger_personal_nr,
  case when n.id is not null
    then abrechnungsart_label(n.abrechnungsart)
  end as nachfolger_status,
  case when n.id is not null
    then (select min(we2.datum) from work_entries we2 where we2.employee_id = n.id)
  end as nachfolger_seit
from employees e
left join employees v on v.id = e.vorgaenger_employee_id
left join employees n on n.vorgaenger_employee_id = e.id;

-- security_invoker unbedenklich (wie employee_sv_abschnitte): employees
-- und work_entries sind beide bereits für jede angemeldete Rolle lesbar
-- per RLS, keine zusätzlich sensiblen Felder hier (nur IDs/Personalnummer/
-- Abrechnungsart/Datum).
alter view employee_status_chain set (security_invoker = true);
grant select on employee_status_chain to authenticated;
