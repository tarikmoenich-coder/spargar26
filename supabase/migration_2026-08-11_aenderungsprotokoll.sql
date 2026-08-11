-- Migration 2026-08-11: Aenderungsprotokoll sichtbar machen
--
-- Nutzer-Vorgabe: "Es muss ein Aenderungsprotokoll fuer jede Person
-- erstellt werden, damit ersichtlich ist, wann welcher Nutzer zuletzt einen
-- Mitarbeiter bearbeitet hat. Sichtbar nur fuer Admin. Auch bei den Stunden
-- und beim Vorschuss muss irgendwie ein Aenderungsprotokoll angelegt
-- werden, wenn es nicht schon da ist."
--
-- Befund: das append-only Audit-Log (Tabelle audit_log + Trigger
-- write_audit_log) existiert bereits seit Beginn und erfasst employees,
-- work_entries, advances, Kassenbuch, Dokumente, Praemien, Monatsabschluss
-- und Kandidaten - jeweils mit Zeitpunkt, Nutzer, Aktion sowie dem
-- kompletten Datensatz vorher und nachher. Es fehlte NUR die Anzeige.
--
-- Diese Migration ergaenzt daher lediglich:
--   1. Delete-Trigger fuer die Praemien-Rohdaten (dort wird als einziger
--      der genannten Bereiche tatsaechlich geloescht - ein geleertes Feld
--      entfernt den Eintrag; ohne delete-Trigger verschwand diese
--      lohnrelevante Aenderung spurlos).
--   2. Zwei Sichten fuer die Anzeige.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

-- 1) Praemien-Rohdaten: delete mitprotokollieren. Einem bestehenden Trigger
-- laesst sich kein Event hinzufuegen - daher neu anlegen.
drop trigger if exists trg_audit_zuckermais_rohdaten on zuckermais_rohdaten;
create trigger trg_audit_zuckermais_rohdaten
  after insert or update or delete on zuckermais_rohdaten
  for each row execute function write_audit_log();

drop trigger if exists trg_audit_erdbeeren_rohdaten on erdbeeren_rohdaten;
create trigger trg_audit_erdbeeren_rohdaten
  after insert or update or delete on erdbeeren_rohdaten
  for each row execute function write_audit_log();

-- 2) Aufbereitete Sicht: Nutzername statt UUID, plus einheitlicher
-- Personenbezug ueber alle Bereiche (bei 'employees' ist die entity_id
-- selbst die Personen-ID, sonst steckt sie im Datensatz).
create or replace view audit_log_ansicht as
select
  a.id,
  a.occurred_at,
  a.actor_id,
  p.full_name as actor_name,
  a.entity,
  a.entity_id,
  a.action,
  a.before_data,
  a.after_data,
  case
    when a.entity = 'employees' then a.entity_id
    else coalesce(a.after_data, a.before_data) ->> 'employee_id'
  end as betroffene_employee_id
from audit_log a
left join profile_namen p on p.id = a.actor_id;

alter view audit_log_ansicht set (security_invoker = true);
grant select on audit_log_ansicht to authenticated;

-- 3) Letzte Aenderung am Stammdatensatz je Mitarbeiter (Spalte auf der
-- Personal-Seite).
create or replace view employee_letzte_aenderung as
select distinct on (a.entity_id)
  a.entity_id as employee_id,
  a.occurred_at,
  a.actor_id,
  p.full_name as actor_name,
  a.action
from audit_log a
left join profile_namen p on p.id = a.actor_id
where a.entity = 'employees'
order by a.entity_id, a.occurred_at desc;

alter view employee_letzte_aenderung set (security_invoker = true);
grant select on employee_letzte_aenderung to authenticated;
