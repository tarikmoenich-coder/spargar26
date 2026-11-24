-- ============================================================================
-- Migration 2026-11-24d: Stufe 0c (Teil 1 von 2) - Views für heikle Personenfelder.
--
-- Nutzer-Entscheidung 2026-11-24 (docs/zwei-personalstaemme-plan.md):
--   Grunddaten (Nummer, Name, Gruppe, Herkunft, aktiv, Foto, ...)  alle Rollen
--   Stundenlohn                         admin, hr, lohnabrechnung, management
--   IBAN, BIC, Zahlungsempfänger        admin, hr, kasse, lohnabrechnung
--   SV-Nr., Steuer-ID, Anschrift, Geburtsdaten, Familienstand,
--   Kontakt, Schwarze Liste             admin, hr
--
-- Bisher waren alle Spalten von employees für jede angemeldete Rolle lesbar
-- (Schutz nur über die Abfragen der Seiten).
--
-- Umsetzung - die DATEN BLEIBEN IN employees (Lohnberechnung, Abrechnung,
-- SEPA-Logik in der Datenbank laufen unverändert weiter):
--   1. Die heiklen Spalten von employees sind über die API (Rolle
--      authenticated) weder lesbar noch schreibbar (Spaltenrechte).
--   2. Zugriff nur noch über drei Views mit Rollenfilter:
--        employee_personaldaten  alle Spalten, lesen + anlegen + ändern,
--                                nur admin/hr (ersetzt für die Personal-
--                                Seiten den direkten Zugriff auf employees)
--        employee_bankdaten      id, iban, bic, zahlungsempfaenger (lesen)
--        employee_lohndaten      id, stundenlohn (lesen)
--      Die Views laufen als Eigentümer (security_barrier, Filter auf die
--      Rolle des Aufrufers). employee_personaldaten mit CHECK OPTION: anlegen
--      und ändern nur, wenn der Aufrufer admin/hr ist.
--   3. personal_kandidaten_checkliste liest den Familienstand jetzt über
--      employee_personaldaten.
--
-- WICHTIG für spätere Migrationen: neue Spalten in employees erscheinen
-- NICHT automatisch in employee_personaldaten (select * wird beim Anlegen
-- aufgelöst) und sind für authenticated erst nach einem Spalten-Grant
-- lesbar. Dann die View neu anlegen + Grant ergänzen.
--
-- REIHENFOLGE (ohne Ausfall):
--   1. DIESE Datei (Teil 1): legt nur die Views an - ändert an bestehenden
--      Rechten nichts, die App läuft unverändert weiter.
--   2. Code-Stand auf main (Personal-Seiten lesen/schreiben über
--      employee_personaldaten) - warten, bis Vercel "Ready" meldet.
--   3. migration_2026-11-24e_personaldaten_rechte.sql (Teil 2): entzieht
--      die direkten Spaltenrechte auf employees.
--
-- In der Supabase SQL-Konsole in einem Zug ausführen.
-- ============================================================================

begin;

-- 1) Views -------------------------------------------------------------------
drop view if exists public.employee_personaldaten;
create view public.employee_personaldaten
with (security_barrier = true) as
  select * from public.employees
  where current_role_name() in ('admin', 'hr')
with local check option;
comment on view public.employee_personaldaten is
  'Vollständiger Personaldatensatz inkl. heikler Felder - nur admin/hr (Stufe 0c, 2026-11-24). Bei neuen employees-Spalten neu anlegen.';

drop view if exists public.employee_bankdaten;
create view public.employee_bankdaten
with (security_barrier = true) as
  select id, iban, bic, zahlungsempfaenger from public.employees
  where current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung');
comment on view public.employee_bankdaten is
  'Bankverbindung - admin, hr, kasse, lohnabrechnung (Stufe 0c, 2026-11-24).';

drop view if exists public.employee_lohndaten;
create view public.employee_lohndaten
with (security_barrier = true) as
  select id, stundenlohn from public.employees
  where current_role_name() in ('admin', 'hr', 'lohnabrechnung', 'management');
comment on view public.employee_lohndaten is
  'Stundenlohn - admin, hr, lohnabrechnung, management (Stufe 0c, 2026-11-24).';

revoke all on public.employee_personaldaten, public.employee_bankdaten, public.employee_lohndaten from anon, public;
grant select, insert, update on public.employee_personaldaten to authenticated;
grant select on public.employee_bankdaten, public.employee_lohndaten to authenticated;
grant all on public.employee_personaldaten, public.employee_bankdaten, public.employee_lohndaten to service_role;

-- 3) Checkliste der Anreiseliste: Familienstand über die Personal-View ----------
do $$
declare
  v_def text := pg_get_viewdef('public.personal_kandidaten_checkliste'::regclass, false);
  v_neu text;
begin
  if v_def like '%employee_personaldaten%' then
    return;
  end if;
  v_neu := regexp_replace(v_def, '\mJOIN employees\M', 'JOIN employee_personaldaten', 'g');
  if v_neu = v_def then
    raise exception 'personal_kandidaten_checkliste: kein "JOIN employees" gefunden - bitte Claude melden';
  end if;
  execute 'create or replace view public.personal_kandidaten_checkliste with (security_invoker = true) as ' || rtrim(rtrim(v_neu), ';');
end $$;

commit;
