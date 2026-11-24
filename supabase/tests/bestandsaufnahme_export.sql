-- ============================================================================
-- Bestandsaufnahme Rechte (Stufe 0, Plan docs/zwei-personalstaemme-plan.md)
--
-- NUR LESEN - ändert nichts. In der Supabase SQL-Konsole ausführen; das
-- Ergebnis ist EINE Zelle mit JSON (Struktur, keine Personendaten):
-- RLS-Schalter je Tabelle, alle Policies (public + storage), Views mit
-- Optionen, Funktionen (security definer ja/nein + Prüfsumme), Grants für
-- anon/authenticated, Spalten-Grants, Storage-Buckets, Rollen-Enum.
-- ============================================================================
select jsonb_build_object(
  'version', version(),
  'rollen', (select to_jsonb(enum_range(null::user_role))),
  'tabellen', (
    select jsonb_agg(jsonb_build_object(
      't', c.relname, 'rls', c.relrowsecurity, 'force', c.relforcerowsecurity
    ) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ),
  'policies', (
    select jsonb_agg(jsonb_build_object(
      's', schemaname, 't', tablename, 'p', policyname, 'perm', permissive,
      'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check
    ) order by schemaname, tablename, policyname)
    from pg_policies where schemaname in ('public', 'storage')
  ),
  'views', (
    select jsonb_agg(jsonb_build_object(
      'v', c.relname, 'kind', c.relkind, 'opt', c.reloptions,
      'owner', pg_get_userbyid(c.relowner),
      'md5', md5(pg_get_viewdef(c.oid, true))
    ) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and not exists (select 1 from pg_depend d
                      where d.objid = c.oid and d.deptype = 'e')
  ),
  'funktionen', (
    select jsonb_agg(jsonb_build_object(
      'f', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
      'secdef', p.prosecdef, 'config', p.proconfig,
      'exec_auth', has_function_privilege('authenticated', p.oid, 'execute'),
      'exec_anon', has_function_privilege('anon', p.oid, 'execute'),
      'md5', md5(pg_get_functiondef(p.oid))
    ) order by p.proname, 2)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')
  ),
  'grants', (
    select jsonb_agg(jsonb_build_object('t', t, 'r', r, 'priv', priv) order by t, r)
    from (
      select table_name as t, grantee as r,
             string_agg(privilege_type, ',' order by privilege_type) as priv
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
      group by 1, 2
    ) g
  ),
  'spaltengrants', (
    select jsonb_agg(jsonb_build_object('t', c.relname, 'col', a.attname, 'acl', a.attacl::text)
                     order by c.relname, a.attname)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attacl is not null and a.attnum > 0
  ),
  'buckets', (
    select jsonb_agg(jsonb_build_object('id', id, 'public', public) order by id)
    from storage.buckets
  )
)::text as bestand;
