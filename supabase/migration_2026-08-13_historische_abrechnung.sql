-- Migration 2026-08-13: Historische Abrechnung nachtragen
--
-- Nutzer-Problem beim In-Betrieb-Nehmen: Mitarbeiter/Stunden wurden
-- importiert, aber reale Abrechnungen VOR App-Start (über das alte
-- Excel-System) sind der App unbekannt. Die 15-Wochen-Abschnitts-
-- Erkennung in employee_sv_pruefung erkennt Abschnitte AUSSCHLIESSLICH
-- über saison_abrechnungen-Einträge - ohne Nachtrag rechnet die App
-- fälschlich mit einem einzigen, nie unterbrochenen Abschnitt seit dem
-- ersten importierten Arbeitstag ("die ganzen Zahlen stimmen nicht").
--
-- Lösung: zwei neue admin/hr-only Funktionen, die NUR einen "Uhr
-- zurückgesetzt"-Marker in saison_abrechnungen anlegen/entfernen - ohne
-- Auszahlungsbeleg/season_bonuses/employees.aktiv anzufassen. Die
-- bestehende 105-Tage-Logik selbst wird dafür nicht verändert. UI:
-- "Abschnitts-Historie" auf Personal → Sozialversicherung, je Person
-- aufklappbar.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

create or replace function saison_abrechnung_nachtragen(
  p_employee_id uuid,
  p_saison_jahr int,
  p_abgerechnet_am date
)
returns bigint language plpgsql security definer as $$
declare
  neue_id bigint;
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung, eine historische Abrechnung nachzutragen';
  end if;

  insert into saison_abrechnungen (employee_id, saison_jahr, abgerechnet_am, abgerechnet_von)
  values (p_employee_id, p_saison_jahr, p_abgerechnet_am::timestamptz, auth.uid())
  returning id into neue_id;

  return neue_id;
end;
$$;

grant execute on function saison_abrechnung_nachtragen(uuid, int, date) to authenticated;

create or replace function saison_abrechnung_nachtrag_entfernen(p_id bigint)
returns void language plpgsql security definer as $$
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung, einen Abrechnungs-Nachtrag zu entfernen';
  end if;

  delete from saison_abrechnungen
  where id = p_id and auszahlungsbeleg_id is null;

  if not found then
    raise exception 'Eintrag nicht gefunden oder ist eine echte Abrechnung (kann nicht entfernt werden)';
  end if;
end;
$$;

grant execute on function saison_abrechnung_nachtrag_entfernen(bigint) to authenticated;
