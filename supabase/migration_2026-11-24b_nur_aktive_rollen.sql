-- ============================================================================
-- Migration 2026-11-24b: Lesen nur noch mit AKTIVER Rolle statt "angemeldet".
--
-- Befund Stufe 0 (docs/zwei-personalstaemme-plan.md), am Live-Stand geprüft:
--   * 38 Lese-Regeln (u.a. employees inkl. IBAN/SV-Nr., work_entries,
--     saison_abrechnungen, stundenkonto_bewegungen, Unterkunft) prüften nur
--     `auth.uid() is not null` = "hat irgendeinen Login". Zusammen mit der
--     (inzwischen abgeschalteten) Selbst-Registrierung konnte sich ein
--     Fremder ein Konto anlegen und diese Daten lesen.
--   * current_role_name() beachtete profiles.aktiv nicht: ein deaktivierter
--     Nutzer behielt alle Datenbank-Rechte seiner Rolle.
--
-- Änderung (Verhalten für AKTIVE Nutzer mit Profil unverändert):
--   1. current_role_name() liefert nur noch für aktive Profile eine Rolle.
--      Damit greifen ALLE Rollen-Prüfungen (Policies, Funktionen, is_admin)
--      für deaktivierte Nutzer nicht mehr.
--   2. Jede Policy mit genau `auth.uid() IS NOT NULL` wird zu
--      `current_role_name() IS NOT NULL` (= aktives Profil mit Rolle).
--   3. Dasselbe für die Unterkunft-Fotos im Storage.
--
-- Unverändert: profiles_select / profiles_update_self (eigene Zeile über
-- auth.uid() - die App muss das eigene Profil lesen können, auch um
-- "deaktiviert" anzuzeigen).
--
-- In der Supabase SQL-Konsole in einem Zug ausführen. Idempotent.
-- ============================================================================

begin;

-- 1) Rolle nur für aktive Profile ------------------------------------------
create or replace function public.current_role_name()
returns user_role language sql stable security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid() and aktiv;
$$;

-- 2) "angemeldet" -> "aktive Rolle" in allen betroffenen Policies -----------
do $$
declare
  p record;
  n int := 0;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and qual = '(auth.uid() IS NOT NULL)'
      and with_check is null
  loop
    execute format(
      'alter policy %I on %I.%I using (current_role_name() is not null)',
      p.policyname, p.schemaname, p.tablename
    );
    n := n + 1;
  end loop;
  raise notice 'Policies umgestellt: %', n;
end $$;

commit;

-- 3) Storage: Unterkunft-Fotos (eigener Schritt - darf 1+2 nicht blockieren;
--    bei fehlender Berechtigung nur ein Hinweis statt Abbruch)
do $$
begin
  alter policy "unterkunft_fotos_storage_select" on storage.objects
    using (bucket_id = 'unterkunft-fotos' and current_role_name() is not null);
  raise notice 'Storage-Policy umgestellt';
exception when others then
  raise notice 'Storage-Policy NICHT umgestellt: % - bitte Claude melden', sqlerrm;
end $$;

-- Kontrolle (soll 0 Zeilen liefern): Policies, die noch nur "angemeldet"
-- prüfen (ohne die beiden profiles-Regeln für die eigene Zeile).
select schemaname, tablename, policyname, qual
from pg_policies
where schemaname in ('public', 'storage')
  and qual ilike '%auth.uid() IS NOT NULL%';
