-- Rollenstruktur glattziehen, Teil 1: profiles absichern + Admin-Schreibweg.
--
-- Problem bisher: profiles_update_self (for update using id = auth.uid())
-- erlaubte JEDEM eingeloggten Nutzer, die eigene Zeile ohne
-- Spalten-Einschränkung zu ändern - also sich selbst role='admin' bzw.
-- aktiv=true zu setzen. Und es gab KEINE Policy, mit der ein Admin die Rolle
-- eines anderen Nutzers über die App hätte ändern können (nur Table-Editor).

-- 1) role/aktiv der eigenen Zeile nur noch für Admins änderbar. full_name /
--    sprache (Selbst-Service) bleiben über profiles_update_self erlaubt.
create or replace function profiles_schutz()
returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role
      or new.aktiv is distinct from old.aktiv)
     and not is_admin() then
    raise exception
      'Rolle und Aktiv-Status können nur von einem Administrator geändert werden.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_schutz on profiles;
create trigger trg_profiles_schutz before update on profiles
  for each row execute function profiles_schutz();

-- 2) Admin darf alle Profile lesen/anlegen/ändern (Nutzerverwaltung in der App).
drop policy if exists "profiles_admin_all" on profiles;
create policy "profiles_admin_all" on profiles for all
  using (is_admin()) with check (is_admin());

-- 3) Änderungen an profiles (v.a. Rollenwechsel) ins Änderungsprotokoll.
drop trigger if exists trg_audit_profiles on profiles;
create trigger trg_audit_profiles
  after insert or update or delete on profiles
  for each row execute function write_audit_log();
