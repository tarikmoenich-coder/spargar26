-- ============================================================================
-- Migration 2026-10-22: Mitarbeiterfoto für den Ausweis-Druck
-- (app/erntewirtschaft/ausweise)
--
-- Genau EIN aktuelles Foto je Mitarbeiter reicht (anders als
-- employee_documents, das eine Liste mehrerer Dokument-Kategorien
-- verwaltet) - deshalb bewusst nur eine Spalte auf employees statt einer
-- eigenen Tabelle. Keine zusätzliche RLS-Einschränkung nötig: ein Foto ist
-- nicht so sensibel wie SV-Nr./IBAN/der ernte_ausweis-Suffix, bleibt also
-- von der bestehenden employees_admin_hr_all/employees_read_for_logged_in
-- abgedeckt.
--
-- Storage-Bucket/Policy gleiches Muster wie "mitarbeiter-dokumente"
-- (migration_2026-08-05_mitarbeiter_dokumente.sql): privater Bucket, Zugriff
-- nur admin/hr, Anzeige über zeitlich begrenzte signierte URLs. Pfad ist
-- bewusst einfach die employee_id OHNE Dateiendung (Content-Type wird beim
-- Upload separat gesetzt) - ein erneuter Upload überschreibt (upsert) damit
-- immer denselben Pfad, unabhängig vom ursprünglichen Dateiformat, ohne
-- verwaiste alte Dateien zurückzulassen.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

alter table employees add column if not exists foto_pfad text;

insert into storage.buckets (id, name, public)
values ('mitarbeiter-fotos', 'mitarbeiter-fotos', false)
on conflict (id) do nothing;

drop policy if exists "mitarbeiter_fotos_storage_admin_hr" on storage.objects;
create policy "mitarbeiter_fotos_storage_admin_hr" on storage.objects for all
  using (bucket_id = 'mitarbeiter-fotos' and current_role_name() in ('admin', 'hr'))
  with check (bucket_id = 'mitarbeiter-fotos' and current_role_name() in ('admin', 'hr'));
