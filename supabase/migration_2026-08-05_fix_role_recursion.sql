-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- WICHTIGER BUGFIX: current_role_name() löste bei Nicht-Admin/HR-Rollen
-- eine Endlosschleife aus ("stack depth limit exceeded", Fehler 54001),
-- weil die Funktion beim Lesen von profiles wieder die RLS-Policy
-- "profiles_select" auslöste, die selbst is_admin() -> current_role_name()
-- aufruft. Betraf u.a. die Stundenerfassung für die Rolle "zeiterfassung"
-- (leere Seite statt Mitarbeiterliste).
-- ============================================================================

create or replace function current_role_name()
returns user_role language sql stable security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;
