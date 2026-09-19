-- Migration 2026-09-19: Personalplanung lockerer + Fehler "duplicate key value
-- violates unique constraint personal_kandidaten_personal_nr_key".
--
-- Ursache: personal_kandidaten.personal_nr war über ALLE Zeilen eindeutig,
-- auch über stornierte. Die App behandelt die Nummer eines stornierten
-- Kandidaten aber als frei (Nächste freie Nr.) und versuchte sie erneut zu
-- vergeben -> Fehler beim Anlegen.
--
-- 1) Eindeutigkeit gilt nur noch für nicht stornierte Kandidaten.
alter table personal_kandidaten
  drop constraint if exists personal_kandidaten_personal_nr_key;
create unique index if not exists personal_kandidaten_personal_nr_aktiv_key
  on personal_kandidaten (personal_nr)
  where status <> 'storniert';

-- 2) Nutzer-Vorgabe: Kandidaten ohne Begründung wieder entfernen können.
--    Die Seite löscht geplante Kandidaten jetzt direkt (kein Storno mit
--    Pflichtgrund mehr). Damit trotzdem nachvollziehbar bleibt, wer wen
--    entfernt hat, wird auch das Löschen im Audit-Log mitgeschrieben.
drop trigger if exists trg_audit_personal_kandidaten on personal_kandidaten;
create trigger trg_audit_personal_kandidaten
  after insert or update or delete on personal_kandidaten
  for each row execute function write_audit_log();
