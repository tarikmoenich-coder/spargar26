-- ============================================================================
-- Migration 2026-11-24g: Rollenprüfung einmal je Abfrage statt je Zeile.
--
-- Nutzer-Meldung 2026-11-24 nach Stufe 1: Seiten laden spürbar langsamer
-- (z.B. Fahrzeuge → Übersicht). Ursache (von mir mit Stufe 1 eingebaut):
-- hat_rolle(...) wurde in jeder Policy für JEDE Zeile neu ausgewertet, mit
-- zwei Funktionsaufrufen und einem Blick in profiles. Lokal gemessen mit
-- 300.000 GPS-Positionen: vor Stufe 1 1,2 s, nach Stufe 1 10 s, mit dieser
-- Migration 0,04 s.
--
-- Änderung (Rechte bleiben exakt gleich):
--   1. Jede Rollenprüfung in Policies und Views wird in "(select ...)"
--      gefasst - Postgres wertet sie dann einmal je Abfrage aus (übliche
--      Supabase-Empfehlung).
--   2. hat_rolle/hat_aktive_rolle/hat_rolle_ausser/is_admin ohne eigenes
--      search_path (schema-qualifiziert), damit Postgres sie auch dort, wo
--      sie nicht eingefasst sind (Funktionen), einbetten kann.
--
-- In der Supabase SQL-Konsole in einem Zug ausführen. Idempotent.
-- ============================================================================

begin;

-- 2) Helfer einbettbar --------------------------------------------------------------
create or replace function public.hat_rolle(p_rollen public.user_role[])
returns boolean language sql stable
as $$ select public.current_rollen() && p_rollen $$;

create or replace function public.hat_aktive_rolle()
returns boolean language sql stable
as $$ select cardinality(public.current_rollen()) > 0 $$;

create or replace function public.hat_rolle_ausser(p_ausser public.user_role[])
returns boolean language sql stable
as $$ select exists (select 1 from unnest(public.current_rollen()) r where r <> all (p_ausser)) $$;

create or replace function public.is_admin()
returns boolean language sql stable
as $$ select public.hat_rolle(array['admin']::public.user_role[]) $$;

-- 1) Einfassen ----------------------------------------------------------------------
create or replace function pg_temp.einfassen(t text) returns text
language plpgsql as $$
begin
  -- schon eingefasst (Darstellung von Postgres: "( SELECT hat_rolle(...) AS ...)")
  if t ~ 'SELECT (hat_rolle|hat_aktive_rolle|hat_rolle_ausser|is_admin)\(' then
    return t;
  end if;
  t := regexp_replace(t, '(hat_rolle_ausser|hat_rolle)\((ARRAY\[[^]]*\])\)', '(select \1(\2))', 'g');
  t := regexp_replace(t, 'hat_aktive_rolle\(\)', '(select hat_aktive_rolle())', 'g');
  t := regexp_replace(t, 'is_admin\(\)', '(select is_admin())', 'g');
  return t;
end $$;

-- Policies
do $$
declare
  p record;
  v_sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(hat_rolle|hat_aktive_rolle|hat_rolle_ausser|is_admin)\('
  loop
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then v_sql := v_sql || ' using (' || pg_temp.einfassen(p.qual) || ')'; end if;
    if p.with_check is not null then v_sql := v_sql || ' with check (' || pg_temp.einfassen(p.with_check) || ')'; end if;
    begin
      execute v_sql;
    exception when insufficient_privilege then
      raise notice 'Policy %.% nicht umgestellt: %', p.tablename, p.policyname, sqlerrm;
    end;
  end loop;
end $$;

-- Views (Optionen bleiben erhalten)
do $$
declare
  v record;
begin
  for v in
    select c.oid, c.relname, c.reloptions
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, false) ~ '(hat_rolle|hat_aktive_rolle|hat_rolle_ausser|is_admin)\('
  loop
    execute format('create or replace view public.%I as %s', v.relname,
                   rtrim(rtrim(pg_temp.einfassen(pg_get_viewdef(v.oid, false))), ';'));
    if v.reloptions is not null then
      execute format('alter view public.%I set (%s)', v.relname, array_to_string(v.reloptions, ', '));
    end if;
  end loop;
end $$;

-- Kontrolle: keine nicht eingefasste Prüfung in Policies/Views übrig
do $$
declare
  v_rest text;
begin
  select string_agg(x, ', ') into v_rest from (
    select 'policy ' || tablename || '.' || policyname as x from pg_policies
    where schemaname in ('public', 'storage')
      and regexp_replace(coalesce(qual, '') || coalesce(with_check, ''),
            'SELECT (hat_rolle|hat_aktive_rolle|hat_rolle_ausser|is_admin)\(', '', 'g')
          ~ '(hat_rolle|hat_aktive_rolle|hat_rolle_ausser|is_admin)\('
    union all
    select 'view ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and regexp_replace(pg_get_viewdef(c.oid, false),
            'SELECT (hat_rolle|hat_aktive_rolle|hat_rolle_ausser|is_admin)\(', '', 'g')
          ~ '(hat_rolle|hat_aktive_rolle|hat_rolle_ausser|is_admin)\('
  ) r;
  if v_rest is not null then
    raise exception 'Nicht eingefasst: % - Migration wird zurückgerollt, bitte Claude melden', v_rest;
  end if;
end $$;

commit;
