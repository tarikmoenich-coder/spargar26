-- ============================================================================
-- Rechte-Matrix: was darf welcher Zugang je Tabelle/View?
-- Läuft NUR auf der lokalen Kopie (nachbau_laden.sh + testdaten.py), als
-- Superuser. Ergebnis in public._matrix(subjekt, relation, art, ergebnis):
--   art = select | insert | update | delete
--   ergebnis: Anzahl Zeilen (select/update/delete), 'ja' (insert ok),
--             'nein' (Recht/RLS verweigert), 'fehler:<code>' (sonstiges)
-- Alle Schreibversuche werden zurückgerollt.
-- ============================================================================
set check_function_bodies = off;

-- Test-Zugänge: je Rolle ein aktives Profil, dazu inaktiv / ohne Profil.
create table if not exists public._subjekt (name text primary key, pgrolle text, uid uuid);
truncate public._subjekt;
revoke all on public._subjekt from anon, authenticated;
do $$
declare r text; i int := 0;
begin
  insert into public._subjekt values ('anon', 'anon', null);
  insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000ff01', 'ohneprofil@test') on conflict do nothing;
  insert into public._subjekt values ('ohne_profil', 'authenticated', '00000000-0000-0000-0000-00000000ff01');
  insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000ff02', 'inaktiv@test') on conflict do nothing;
  insert into public.profiles(id, full_name, role, aktiv) values ('00000000-0000-0000-0000-00000000ff02', 'Inaktiv (admin)', 'admin', false)
    on conflict (id) do update set role = 'admin', aktiv = false;
  insert into public._subjekt values ('inaktiv_admin', 'authenticated', '00000000-0000-0000-0000-00000000ff02');
  -- Rollen: seit dem Rechte-Umbau aus der Tabelle rolle (inkl. neuer Rollen
  -- wie Geschäftsführer), vorher aus dem Typ user_role.
  for r in execute case when to_regclass('public.rolle') is not null
                        then 'select id from public.rolle order by sortierung, id'
                        else 'select unnest(enum_range(null::user_role))::text' end loop
    i := i + 1;
    insert into auth.users(id, email) values (('00000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, r || '@test') on conflict do nothing;
    insert into public.profiles(id, full_name, role, aktiv) values (('00000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'Test ' || r, r, true)
      on conflict (id) do update set role = excluded.role, aktiv = true;
    insert into public._subjekt values (r, 'authenticated', ('00000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid);
  end loop;
  -- Mehrfachrollen (ab Stufe 1, Spalte profiles.rollen): Rechte müssen die
  -- Vereinigung der Einzelrollen sein.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'rollen') then
    insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000fe01', 'hr+kasse@test'),
      ('00000000-0000-0000-0000-00000000fe02', 'hausmeister+waage@test') on conflict do nothing;
    execute $x$insert into public.profiles(id, full_name, role, rollen, aktiv) values
      ('00000000-0000-0000-0000-00000000fe01', 'Test hr+kasse', 'hr', '{hr,kasse}', true),
      ('00000000-0000-0000-0000-00000000fe02', 'Test hausmeister+waage', 'hausmeister', '{hausmeister,waage}', true)
      on conflict (id) do update set role = excluded.role, rollen = excluded.rollen, aktiv = true$x$;
    insert into public._subjekt values ('hr+kasse', 'authenticated', '00000000-0000-0000-0000-00000000fe01'),
      ('hausmeister+waage', 'authenticated', '00000000-0000-0000-0000-00000000fe02');
  end if;
end $$;

create table if not exists public._matrix (subjekt text, relation text, art text, ergebnis text);
truncate public._matrix;
revoke all on public._matrix from anon, authenticated;

create or replace function public._als(p_subjekt public._subjekt) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_subjekt.uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_subjekt.pgrolle, true);
  perform set_config('role', p_subjekt.pgrolle, true);
end $$;

do $$
declare
  s public._subjekt;
  rel record;
  n bigint;
  erg text;
  ergebnisse text[][];
  spalte text;
  ins text;
begin
  for s in select * from public._subjekt order by name loop
    ergebnisse := array[]::text[][];
    for rel in
      select c.relname, c.relkind from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm') and c.relname not like '\_%'
      order by c.relname
    loop
      -- SELECT
      begin
        perform public._als(s);
        execute format('select count(*) from public.%I', rel.relname) into n;
        erg := n::text;
      exception when insufficient_privilege then erg := 'nein';
                when others then erg := 'fehler:' || sqlstate;
      end;
      perform set_config('role', 'none', true);
      ergebnisse := ergebnisse || array[[rel.relname, 'select', erg]];
      continue when rel.relkind <> 'r';

      -- UPDATE (erste Nicht-Schlüssel-Spalte auf sich selbst setzen)
      select a.attname into spalte from pg_attribute a
      where a.attrelid = ('public.' || quote_ident(rel.relname))::regclass and a.attnum > 0 and not a.attisdropped
        and a.attgenerated = '' and a.attidentity = ''
        and not exists (select 1 from pg_index i where i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey))
      order by a.attnum limit 1;
      begin
        perform public._als(s);
        execute format('update public.%I set %I = %I', rel.relname, spalte, spalte);
        get diagnostics n = row_count;
        raise exception 'ZURUECK:%', n;
      exception when raise_exception then
                  erg := case when sqlerrm like 'ZURUECK:%' then substr(sqlerrm, 9) else 'fehler:P0001' end;
                when insufficient_privilege then erg := 'nein';
                when others then erg := 'fehler:' || sqlstate;
      end;
      perform set_config('role', 'none', true);
      ergebnisse := ergebnisse || array[[rel.relname, 'update', erg]];

      -- DELETE
      begin
        perform public._als(s);
        execute format('delete from public.%I', rel.relname);
        get diagnostics n = row_count;
        raise exception 'ZURUECK:%', n;
      exception when raise_exception then
                  erg := case when sqlerrm like 'ZURUECK:%' then substr(sqlerrm, 9) else 'fehler:P0001' end;
                when insufficient_privilege then erg := 'nein';
                when foreign_key_violation then erg := 'ja(fk)';
                when others then erg := 'fehler:' || sqlstate;
      end;
      perform set_config('role', 'none', true);
      ergebnisse := ergebnisse || array[[rel.relname, 'delete', erg]];

      -- INSERT (Testdaten-Zeile erneut)
      select sql into ins from public._seed_sql where tab = rel.relname;
      begin
        perform public._als(s);
        execute ins;
        raise exception 'ZURUECK:ja';
      exception when raise_exception then
                  erg := case when sqlerrm like 'ZURUECK:%' then substr(sqlerrm, 9) else 'fehler:P0001' end;
                when insufficient_privilege then erg := 'nein';
                when unique_violation then erg := 'ja(unique)';
                when others then erg := 'fehler:' || sqlstate;
      end;
      perform set_config('role', 'none', true);
      ergebnisse := ergebnisse || array[[rel.relname, 'insert', erg]];
    end loop;
    insert into public._matrix
      select s.name, ergebnisse[i][1], ergebnisse[i][2], ergebnisse[i][3]
      from generate_subscripts(ergebnisse, 1) i;
  end loop;
end $$;

select subjekt, count(*) from public._matrix group by 1 order by 1;
