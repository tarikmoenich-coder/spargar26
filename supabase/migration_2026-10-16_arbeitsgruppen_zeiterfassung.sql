-- Rolle "zeiterfassung" darf Arbeitsgruppen pflegen (anlegen/ändern/löschen),
-- sonst nichts in den Einstellungen. Lesen war schon für alle eingeloggten Rollen erlaubt.
drop policy if exists "arbeitsgruppen_admin_write" on arbeitsgruppen;
create policy "arbeitsgruppen_write" on arbeitsgruppen for all
  using (current_role_name() in ('admin', 'zeiterfassung'))
  with check (current_role_name() in ('admin', 'zeiterfassung'));
