-- ============================================================================
-- Migration 2026-11-24f: Stufe 1 - mehrere Rollen je Nutzer.
--
-- Nutzer-Vorgabe 2026-11-24 (docs/zwei-personalstaemme-plan.md): ein Nutzer
-- kann mehrere Rollen haben (z.B. hr + kasse statt Notbehelf "admin";
-- später Vertrieb = hr + lohnabrechnung + kasse). Rechte = Vereinigung der
-- Rechte aller Rollen.
--
--  1. profiles.rollen (user_role[]); profiles.role bleibt als "Hauptrolle"
--     (Anzeige, Startseite) und ist immer in rollen enthalten. Ein Trigger
--     hält beides konsistent - auch für den alten App-Stand, der nur role
--     schreibt.
--  2. Neue Prüffunktionen (alle nur für AKTIVE Profile):
--       current_rollen()              alle Rollen des Aufrufers
--       hat_rolle(user_role[])        hat mindestens eine davon
--       hat_aktive_rolle()            hat überhaupt eine Rolle
--       hat_rolle_ausser(user_role[]) hat eine Rolle außerhalb der Liste
--     is_admin() = hat_rolle(admin).
--  3. ALLE Rollenprüfungen in Policies, Views und Funktionen werden von
--     current_role_name() auf diese Funktionen umgestellt (automatisch aus
--     dem Live-Stand umgeschrieben, Muster unten). Am Ende prüft die
--     Migration, dass keine Prüfung mit current_role_name() übrig ist -
--     sonst bricht sie komplett ab (nichts wird halb umgestellt).
--  4. Selbstschutz: rollen darf wie role/aktiv nur ein Admin ändern.
--
-- Für Nutzer mit EINER Rolle (alle bisherigen) ändert sich nichts - per
-- Rechte-Test (supabase/tests/rechte_test.sh) vorher/nachher identisch.
--
-- In der Supabase SQL-Konsole in einem Zug ausführen.
-- ============================================================================

begin;

-- 1) Spalte + Konsistenz ---------------------------------------------------------
alter table public.profiles
  add column if not exists rollen public.user_role[] not null default '{}';

update public.profiles set rollen = array[role] where cardinality(rollen) = 0;

create or replace function public.profiles_rollen_sync()
returns trigger language plpgsql as $$
begin
  -- Alter App-Stand ändert nur role -> rollen folgt.
  if tg_op = 'UPDATE' and new.role is distinct from old.role
     and new.rollen is not distinct from old.rollen then
    new.rollen := array[new.role];
  end if;
  -- Doppelte entfernen, Reihenfolge behalten
  new.rollen := array(
    select r from unnest(new.rollen) with ordinality as t(r, i)
    group by r order by min(i)
  );
  if cardinality(new.rollen) = 0 then
    new.rollen := array[new.role];
  end if;
  -- Hauptrolle muss enthalten sein, sonst die erste Rolle
  if not (new.role = any(new.rollen)) then
    new.role := new.rollen[1];
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_rollen_sync on public.profiles;
create trigger trg_profiles_rollen_sync
  before insert or update on public.profiles
  for each row execute function public.profiles_rollen_sync();

-- 2) Prüffunktionen --------------------------------------------------------------
create or replace function public.current_rollen()
returns public.user_role[] language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select rollen from profiles where id = auth.uid() and aktiv),
    '{}'::user_role[]
  );
$$;

create or replace function public.hat_rolle(p_rollen public.user_role[])
returns boolean language sql stable
set search_path = public
as $$
  select current_rollen() && p_rollen;
$$;

create or replace function public.hat_aktive_rolle()
returns boolean language sql stable
set search_path = public
as $$
  select cardinality(current_rollen()) > 0;
$$;

create or replace function public.hat_rolle_ausser(p_ausser public.user_role[])
returns boolean language sql stable
set search_path = public
as $$
  select exists (select 1 from unnest(current_rollen()) r where r <> all (p_ausser));
$$;

create or replace function public.is_admin()
returns boolean language sql stable
set search_path = public
as $$
  select hat_rolle(array['admin']::user_role[]);
$$;

revoke all on function public.current_rollen(), public.hat_rolle(public.user_role[]),
  public.hat_aktive_rolle(), public.hat_rolle_ausser(public.user_role[]) from public, anon;
grant execute on function public.current_rollen(), public.hat_rolle(public.user_role[]),
  public.hat_aktive_rolle(), public.hat_rolle_ausser(public.user_role[]) to authenticated, service_role;

-- current_role_name() bleibt (liefert die Hauptrolle), wird aber in keiner
-- Prüfung mehr verwendet.

-- 4) Selbstschutz inkl. rollen -----------------------------------------------------
create or replace function public.profiles_schutz()
returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role
      or new.rollen is distinct from old.rollen
      or new.aktiv is distinct from old.aktiv)
     and not is_admin() then
    raise exception
      'Rollen und Aktiv-Status können nur von einem Administrator geändert werden.';
  end if;
  return new;
end;
$$;

-- 3) Umschreiben aller Prüfungen ------------------------------------------------------
create or replace function pg_temp.rollen_umschreiben(t text) returns text
language plpgsql as $$
begin
  -- Policy-/View-Form (pg_get_expr / pg_get_viewdef)
  t := regexp_replace(t,
         '\(current_role_name\(\) IS NOT NULL\) AND \(current_role_name\(\) <> (''[a-z_]+''::user_role)\)',
         'hat_rolle_ausser(ARRAY[\1])', 'g');
  t := regexp_replace(t, 'current_role_name\(\) = ANY \((ARRAY\[[^]]*\])\)', 'hat_rolle(\1)', 'g');
  t := regexp_replace(t, 'current_role_name\(\) = (''[a-z_]+''::user_role)', 'hat_rolle(ARRAY[\1])', 'g');
  t := regexp_replace(t, 'current_role_name\(\) IS NOT NULL', 'hat_aktive_rolle()', 'g');
  -- Funktions-Quelltext (plpgsql/sql, so wie geschrieben)
  t := regexp_replace(t, '(public\.)?current_role_name\(\) not in \(([^)]*)\)',
         'not hat_rolle(array[\2]::user_role[])', 'gi');
  t := regexp_replace(t, '(public\.)?current_role_name\(\) in \(([^)]*)\)',
         'hat_rolle(array[\2]::user_role[])', 'gi');
  t := regexp_replace(t, '(public\.)?current_role_name\(\) is null',
         '(not hat_aktive_rolle())', 'gi');
  t := regexp_replace(t, '(public\.)?current_role_name\(\) is not null',
         'hat_aktive_rolle()', 'gi');
  t := regexp_replace(t, '(public\.)?current_role_name\(\) <> (''[a-z_]+'')',
         '(not hat_rolle(array[\2]::user_role[]))', 'gi');
  t := regexp_replace(t, '(public\.)?current_role_name\(\) = (''[a-z_]+'')',
         'hat_rolle(array[\2]::user_role[])', 'gi');
  return t;
end $$;

-- 3a) Policies (public + storage)
do $$
declare
  p record;
  v_using text;
  v_check text;
  v_sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') like '%current_role_name()%'
           or coalesce(with_check, '') like '%current_role_name()%')
  loop
    v_using := case when p.qual is not null then pg_temp.rollen_umschreiben(p.qual) end;
    v_check := case when p.with_check is not null then pg_temp.rollen_umschreiben(p.with_check) end;
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    begin
      execute v_sql;
    exception when insufficient_privilege then
      -- storage.objects gehört live einem Supabase-Konto - bisher ging
      -- alter policy dort aber (Migration 24b/24c). Falls nicht: Hinweis.
      raise notice 'Policy %.% nicht umgestellt: %', p.tablename, p.policyname, sqlerrm;
    end;
  end loop;
end $$;

-- 3b) Views (Optionen wie security_invoker/check_option bleiben erhalten)
do $$
declare
  v record;
  v_def text;
begin
  for v in
    select c.oid, c.relname, c.reloptions
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, false) like '%current_role_name()%'
  loop
    v_def := pg_temp.rollen_umschreiben(pg_get_viewdef(v.oid, false));
    execute format('create or replace view public.%I as %s', v.relname, rtrim(rtrim(v_def), ';'));
    if v.reloptions is not null then
      execute format('alter view public.%I set (%s)', v.relname, array_to_string(v.reloptions, ', '));
    end if;
  end loop;
end $$;

-- 3c) Funktionen (ohne current_role_name selbst und die neuen Helfer)
do $$
declare
  f record;
  v_def text;
begin
  for f in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and p.proname not in ('current_role_name', 'current_rollen', 'hat_rolle',
                            'hat_aktive_rolle', 'hat_rolle_ausser', 'is_admin')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and pg_get_functiondef(p.oid) like '%current_role_name()%'
  loop
    v_def := pg_temp.rollen_umschreiben(pg_get_functiondef(f.oid));
    execute v_def;
  end loop;
end $$;

-- 3d) Kontrolle: keine Prüfung mit current_role_name() mehr übrig
do $$
declare
  v_rest text;
begin
  select string_agg(x, ', ') into v_rest from (
    select 'policy ' || tablename || '.' || policyname as x from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%current_role_name()%'
    union all
    select 'view ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, false) like '%current_role_name()%'
    union all
    select 'funktion ' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p') and p.proname <> 'current_role_name'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and pg_get_functiondef(p.oid) like '%current_role_name()%'
  ) r;
  if v_rest is not null then
    raise exception 'Noch nicht umgestellt: % - Migration wird komplett zurückgerollt, bitte Claude melden', v_rest;
  end if;
end $$;

commit;
