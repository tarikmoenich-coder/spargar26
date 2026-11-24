-- ============================================================================
-- Migration 2026-11-24: Zugriff OHNE Anmeldung (Rolle anon) sperren.
--
-- Befund Stufe 0 (docs/zwei-personalstaemme-plan.md), am Live-Stand geprüft:
--   * 13 Views laufen mit den Rechten ihres Eigentümers (postgres umgeht RLS)
--     und sind für anon lesbar. 5 davon prüfen gar keine Rolle - mit dem
--     öffentlichen Schlüssel (steht im JavaScript der Website) waren ohne
--     Login lesbar: profile_namen, anreiseliste_offen_arbeitend,
--     unterkunft_auszug_offen, employee_auslagen_historie,
--     employee_fuehrerschein_kategorien.
--   * Alle Funktionen sind für anon ausführbar (Postgres-Standard PUBLIC),
--     darunter security-definer-Hilfsfunktionen ohne Rollenprüfung, z.B.
--     auszahlungsbeleg_zeile_delta_anwenden (ändert Auszahlungsbeleg-Zeilen)
--     oder naechste_belegnummer (verbraucht Belegnummern).
--
-- Die App braucht anon für nichts: jede Seite arbeitet angemeldet
-- (authenticated), die Hintergrunddienste (Poller/Agenten) nutzen den
-- service_role-Schlüssel, pg_cron läuft als Eigentümer. Deshalb hier nur:
--   1. anon verliert alle Rechte auf Tabellen, Views, Sequenzen, Funktionen
--      im Schema public;
--   2. Funktionen: das Standard-Ausführrecht für PUBLIC (= auch anon) wird
--      entzogen und ausdrücklich an authenticated + service_role vergeben -
--      für angemeldete Nutzer ändert sich NICHTS;
--   3. dasselbe als Standard für künftig angelegte Objekte.
--   4. Interne Hilfsfunktion auszahlungsbeleg_zeile_delta_anwenden: nur noch
--      aus den security-definer-Funktionen (laufen als Eigentümer) aufrufbar.
--
-- Was angemeldete Nutzer welcher Rolle sehen dürfen, wird in Stufe 0 im
-- nächsten Schritt geschärft - diese Migration ändert für sie nichts.
--
-- In der Supabase SQL-Konsole in einem Zug ausführen. Idempotent.
-- ============================================================================

begin;

-- 1) Tabellen, Views, Sequenzen: anon raus ---------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 2) Funktionen (nur eigene, nicht die der Erweiterungen wie PostGIS) -------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and pg_get_userbyid(p.proowner) = current_user
      and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- 4) Interne Hilfsfunktion: niemand ruft sie direkt auf
revoke execute on function public.auszahlungsbeleg_zeile_delta_anwenden(uuid, bigint, season_summary, season_summary)
  from authenticated;

-- 3) Standard für künftige Objekte (Migrationen laufen als postgres) -------
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke all on functions from anon;
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  grant execute on functions to authenticated, service_role;

commit;

-- Kontrolle (soll 0 Zeilen liefern): Objekte in public, auf die anon noch
-- ein Recht hat.
select c.relname as objekt, 'tabelle/view' as art
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S', 'p')
  and c.relacl::text like '%anon=%'
union all
select p.proname, 'funktion'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and pg_get_userbyid(p.proowner) = current_user
  and has_function_privilege('anon', p.oid, 'execute');
