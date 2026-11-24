-- ============================================================================
-- Bereichs-Test (Stufe 2): sieht jeder Zugang nur Personen seines Bereichs?
-- Läuft auf der lokalen Kopie NACH testdaten.sql + Migration 2026-11-24h
-- (+ rechte_matrix.sql für _subjekt/_als). Legt je Tabelle mit Personen-
-- Bezug zusätzlich eine Zeile für eine Vertriebs-Person an und zählt je
-- Zugang, wie viele LW- bzw. VT-Zeilen sichtbar sind.
-- Ergebnis: public._bereich(subjekt, relation, lw, vt)
-- ============================================================================
\set QUIET on
set check_function_bodies = off;

-- 1) Vertriebs-Daten -----------------------------------------------------------
set session_replication_role = replica;
insert into public.geschaeftsbereich (kuerzel, bezeichnung, personalnummer_praefix, reihenfolge)
  values ('VT', 'Vertrieb', 'V-', 20) on conflict do nothing;
insert into public.arbeitsgruppen (gruppe_nr, bezeichnung, bereich)
  select 'VT-1', 'Stand Test', 'VT' where not exists (select 1 from public.arbeitsgruppen where gruppe_nr = 'VT-1');
insert into public.employees (personal_nr, name, vorname, bereich, gruppe_nr)
  select 'V-T1', 'Verkauf', 'Vera', 'VT', 'VT-1' where not exists (select 1 from public.employees where personal_nr = 'V-T1');
insert into public.personal_kandidaten (personal_nr, name, vorname, bereich, saison_jahr, status)
  select 'V-T2', 'Kandidat', 'Vertrieb', 'VT', 2027, 'geplant'
  where not exists (select 1 from public.personal_kandidaten where personal_nr = 'V-T2');
do $$
declare
  s record;
  v_sql text;
begin
  for s in select * from public._seed_sql loop
    continue when s.sql not like '%from public."employees" limit 1%';
    continue when s.tab in ('employees', 'personal_kandidaten');
    v_sql := replace(s.sql, 'from public."employees" limit 1',
                     'from public."employees" where bereich = ''VT'' limit 1');
    begin
      execute v_sql;
    exception when others then
      raise notice 'VT-Testzeile für % nicht angelegt: %', s.tab, sqlerrm;
    end;
  end loop;
end $$;
set session_replication_role = default;

-- 2) Vertriebs-Zugänge -----------------------------------------------------------
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000fd01', 'hr-vt@test'),
  ('00000000-0000-0000-0000-00000000fd02', 'vorlage-vt@test'),
  ('00000000-0000-0000-0000-00000000fd03', 'hr-beide-ansicht-vt@test'),
  ('00000000-0000-0000-0000-00000000fd04', 'hr-beide@test')
on conflict do nothing;
insert into public.profiles(id, full_name, role, rollen, bereiche, bereich_ansicht, aktiv) values
  ('00000000-0000-0000-0000-00000000fd01', 'HR Vertrieb', 'hr', '{hr}', '{VT}', null, true),
  ('00000000-0000-0000-0000-00000000fd02', 'Vorlage Vertrieb', 'hr', '{hr,lohnabrechnung,kasse}', '{VT}', null, true),
  ('00000000-0000-0000-0000-00000000fd03', 'HR beide, Ansicht VT', 'hr', '{hr}', '{LW,VT}', 'VT', true),
  ('00000000-0000-0000-0000-00000000fd04', 'HR beide', 'hr', '{hr}', '{LW,VT}', null, true)
on conflict (id) do update set rollen = excluded.rollen, bereiche = excluded.bereiche,
  bereich_ansicht = excluded.bereich_ansicht, aktiv = true;
delete from public._subjekt where name like '%@%';
insert into public._subjekt values
  ('hr@VT', 'authenticated', '00000000-0000-0000-0000-00000000fd01'),
  ('vorlage@VT', 'authenticated', '00000000-0000-0000-0000-00000000fd02'),
  ('hr@beide,ansicht VT', 'authenticated', '00000000-0000-0000-0000-00000000fd03'),
  ('hr@beide', 'authenticated', '00000000-0000-0000-0000-00000000fd04');

-- 3) Zählen ----------------------------------------------------------------------------
create table if not exists public._bereich (subjekt text, relation text, lw text, vt text);
truncate public._bereich;
do $$
declare
  s public._subjekt;
  rel record;
  v_lw uuid[] := array(select id from public.employees where bereich = 'LW');
  v_vt uuid[] := array(select id from public.employees where bereich = 'VT');
  n_lw bigint; n_vt bigint;
  erg_lw text; erg_vt text;
begin
  for s in select * from public._subjekt order by name loop
    for rel in
      select c.relname,
             case when c.relname in ('employees') or c.relname like 'employee\_%daten' then 'id'
                  when exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'employee_id' and not a.attisdropped) then 'employee_id'
                  when c.relname = 'personal_kandidaten' then 'aktivierter_employee_id'
             end as spalte
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind in ('r', 'v') and c.relname not like '\_%'
    loop
      continue when rel.spalte is null;
      begin
        perform public._als(s);
        execute format('select count(*) filter (where %1$I = any ($1)), count(*) filter (where %1$I = any ($2)) from public.%2$I',
                       rel.spalte, rel.relname) into n_lw, n_vt using v_lw, v_vt;
        erg_lw := n_lw::text; erg_vt := n_vt::text;
      exception when insufficient_privilege then erg_lw := 'nein'; erg_vt := 'nein';
                when others then erg_lw := 'fehler:' || sqlstate; erg_vt := erg_lw;
      end;
      perform set_config('role', 'none', true);
      insert into public._bereich values (s.name, rel.relname, erg_lw, erg_vt);
    end loop;
  end loop;
end $$;

-- 4) Funktionen: Schreiben über Bereichsgrenze ------------------------------------
create table if not exists public._bereich_fn (subjekt text, pruefung text, ergebnis text);
truncate public._bereich_fn;
do $$
declare
  s public._subjekt;
  t record;
  erg text;
  v_lw uuid := (select id from public.employees where bereich = 'LW' order by personal_nr limit 1);
  v_vt uuid := (select id from public.employees where bereich = 'VT' limit 1);
begin
  for s in select * from public._subjekt where name in ('hr@VT', 'vorlage@VT', 'hr@beide', 'admin', 'hr') loop
    for t in select * from (values
      ('stundenkonto_buchen LW', format('select public.stundenkonto_buchen(%L, 2026, ''2026-05-04'', 1, ''gutschrift'', ''t'')', v_lw)),
      ('stundenkonto_buchen VT', format('select public.stundenkonto_buchen(%L, 2026, ''2026-05-04'', 1, ''gutschrift'', ''t'')', v_vt)),
      ('Person LW anlegen',      'insert into public.employee_personaldaten (personal_nr, name, vorname, bereich) values (''T-NEU'', ''a'', ''b'', ''LW'')'),
      ('Person VT anlegen',      'insert into public.employee_personaldaten (personal_nr, name, vorname, bereich) values (''V-NEU'', ''a'', ''b'', ''VT'')'),
      ('Stunden LW eintragen',   format('insert into public.work_entries (employee_id, datum, stunden) values (%L, ''2026-06-01'', 8)', v_lw)),
      ('Stunden VT eintragen',   format('insert into public.work_entries (employee_id, datum, stunden) values (%L, ''2026-06-01'', 8)', v_vt))
    ) v(pruefung, sql) loop
      begin
        perform public._als(s);
        execute t.sql;
        raise exception 'ZURUECK';
      exception when raise_exception then
                  erg := case when sqlerrm = 'ZURUECK' then 'ok' else 'verweigert: ' || left(sqlerrm, 50) end;
                when insufficient_privilege then erg := 'verweigert (RLS/Recht)';
                when check_violation then erg := 'verweigert (check)';
                when others then erg := 'fehler ' || sqlstate || ': ' || left(sqlerrm, 50);
      end;
      perform set_config('role', 'none', true);
      insert into public._bereich_fn values (s.name, t.pruefung, erg);
    end loop;
  end loop;
end $$;
\set QUIET off
