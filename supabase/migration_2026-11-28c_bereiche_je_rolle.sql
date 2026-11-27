-- ============================================================================
-- Migration 2026-11-28c: Rechte-Umbau Stufe 2 - Geschäftsbereiche je Rolle.
--
-- Nutzer-Vorgabe 2026-11-27/28 (docs/rechte-plan.md): Landwirtschaft /
-- Vertrieb hängt an der ROLLE, und zwar je Rolle getrennt: wer "HR" nur für
-- Landwirtschaft und "Kasse" nur für Vertrieb hat, macht HR nur in der
-- Landwirtschaft und Kasse nur im Vertrieb.
--
--  1. profil_rechte.rechte_bereich: je Recht die Bereiche der Rollen, die es
--     geben ({"kasse.buecher:S": ["VT"], ...}). Administrator: alle Bereiche.
--  2. Rollen bekommen die Bereiche ihrer bisherigen Nutzer. Hatten Nutzer
--     derselben Rolle verschiedene Bereiche, entsteht je weiterer Kombination
--     eine eigene Rolle (z.B. "Personal (HR) (Vertrieb)") - niemand bekommt
--     mehr oder weniger als vorher. profiles.bereiche wird nicht mehr benutzt.
--  3. bereiche_fuer(rechte[]) / bereich_filter_fuer(rechte[]): Bereiche, in
--     denen der Nutzer eines dieser Rechte hat (mit gewählter Ansicht).
--  4. Jede Bereichs-Grenze (Policy bereich_grenze) wird in Grenzen für
--     Lesen / Anlegen / Ändern / Löschen aufgeteilt; welche Rechte je Befehl
--     zählen, liest die Migration aus den Policies der Tabelle selbst ab.
--     Views und Funktionen ebenso (Rechte aus ihrem Text). Was ohne
--     bestimmtes Recht lesbar ist (Grundausstattung), gilt in allen
--     Bereichen des Nutzers.
--
-- In der Supabase SQL-Konsole ausführen (ein einziger Block).
-- ============================================================================

do $umbau$
declare
  r record;
  k record;
  t record;
  obj record;
  v_text text;
  v_using text;
  v_check text;
  v_rechte text[];
  v_basis boolean;
  v_cmd text;
  v_id text;
  v_bez text;
  v_n int := 0;
  v_rest text;
  v_erste boolean;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'profil_rechte') then
    raise exception 'Bitte zuerst die Migration 2026-11-28 (Rechte-Katalog) einspielen.';
  end if;

  -- 1) Rechte je Bereich vorberechnen -----------------------------------------------
  alter table public.profil_rechte add column if not exists rechte_bereich jsonb not null default '{}';

  create or replace function public.profil_rechte_berechnen(p_id uuid default null)
  returns void language plpgsql security definer set search_path = public as $f$
  begin
    with ro as (
      select p.id as pid, r.rechte, r.alle_rechte,
        case when r.system_admin then (select array_agg(kuerzel) from geschaeftsbereich)
             else r.bereiche end as rb
      from profiles p join rolle r on r.id = any(p.rollen)
      where p.aktiv and (p_id is null or p.id = p_id)
    ), x as (
      select ro.pid, k.id || ':' || st.s as recht, ro.rb
      from ro cross join recht_katalog k cross join (values ('L'), ('S')) st(s)
      where ro.alle_rechte
      union all
      select ro.pid, e.key || ':L', ro.rb from ro, jsonb_each_text(ro.rechte) e
      union all
      select ro.pid, e.key || ':S', ro.rb from ro, jsonb_each_text(ro.rechte) e where e.value = 'S'
    ), agg as (
      select x.pid, x.recht,
        coalesce(array_agg(distinct b order by b) filter (where b in (select kuerzel from geschaeftsbereich)), '{}') as bs
      from x left join lateral unnest(x.rb) b on true
      group by x.pid, x.recht
    )
    insert into profil_rechte (profile_id, rechte, rechte_bereich, bereiche, admin, angemeldet, buero, berechnet_am)
    select p.id,
      coalesce((select array_agg(a.recht order by a.recht) from agg a where a.pid = p.id), '{}'),
      coalesce((select jsonb_object_agg(a.recht, a.bs) from agg a where a.pid = p.id), '{}'),
      coalesce((select array_agg(distinct b order by b) from agg a, unnest(a.bs) b where a.pid = p.id), '{}'),
      p.aktiv and exists (select 1 from rolle ro2 where ro2.id = any(p.rollen) and ro2.system_admin),
      p.aktiv and cardinality(p.rollen) > 0,
      p.aktiv and exists (
        select 1 from rolle ro2 where ro2.id = any(p.rollen)
          and (ro2.alle_rechte or exists (select 1 from jsonb_object_keys(ro2.rechte) kk where kk <> 'sonder.waage_kiosk'))),
      now()
    from profiles p
    where p_id is null or p.id = p_id
    on conflict (profile_id) do update set rechte = excluded.rechte, rechte_bereich = excluded.rechte_bereich,
      bereiche = excluded.bereiche, admin = excluded.admin, angemeldet = excluded.angemeldet,
      buero = excluded.buero, berechnet_am = excluded.berechnet_am;
  end $f$;
  revoke all on function public.profil_rechte_berechnen(uuid) from public, anon, authenticated;

  -- Bereiche am Nutzer zählen nicht mehr: Trigger nur noch auf Rollen/Aktiv
  drop trigger if exists trg_profil_rechte on public.profiles;
  create trigger trg_profil_rechte after insert or update of rollen, role, aktiv on public.profiles
    for each row execute function public.profil_rechte_trigger_profil();

  -- 2) Bereiche an die Rollen (aus den bisherigen Nutzern) ------------------------
  -- Schutz-Trigger kurz aus: die Migration läuft ohne angemeldeten Admin.
  alter table public.profiles disable trigger trg_profiles_schutz;

  update public.rolle set bereiche = coalesce((select array_agg(kuerzel order by kuerzel) from geschaeftsbereich), '{LW}')
  where id = 'geschaeftsfuehrer' or system_admin;

  for r in select * from public.rolle where not system_admin and id <> 'geschaeftsfuehrer' order by sortierung loop
    v_erste := true;
    for k in
      select b.bereiche, count(*) as n
      from (
        select coalesce((select array_agg(x order by x) from unnest(p.bereiche) x
                         where x in (select kuerzel from geschaeftsbereich)), '{LW}') as bereiche
        from public.profiles p
        where r.id = any(p.rollen)
      ) b
      group by b.bereiche
      order by count(*) desc, b.bereiche
    loop
      if v_erste then
        update public.rolle set bereiche = k.bereiche where id = r.id;
        v_erste := false;
      else
        v_id := r.id || '_' || lower(array_to_string(k.bereiche, '_'));
        select r.bezeichnung || ' (' || string_agg(g.bezeichnung, ' + ' order by g.kuerzel) || ')'
          into v_bez from public.geschaeftsbereich g where g.kuerzel = any(k.bereiche);
        insert into public.rolle (id, bezeichnung, beschreibung, rechte, alle_rechte, system_admin, bereiche, sortierung)
        values (v_id, v_bez, r.beschreibung, r.rechte, r.alle_rechte, false, k.bereiche, r.sortierung)
        on conflict (id) do nothing;
        update public.profiles p
        set rollen = array_replace(p.rollen, r.id, v_id),
            role = case when p.role = r.id then v_id else p.role end
        where r.id = any(p.rollen)
          and coalesce((select array_agg(x order by x) from unnest(p.bereiche) x
                        where x in (select kuerzel from geschaeftsbereich)), '{LW}') = k.bereiche;
        v_n := v_n + 1;
      end if;
    end loop;
    if v_erste then
      -- Rolle ohne Nutzer: Landwirtschaft
      update public.rolle set bereiche = '{LW}' where id = r.id and cardinality(bereiche) = 0;
    end if;
  end loop;

  alter table public.profiles enable trigger trg_profiles_schutz;
  raise notice 'Bereiche je Rolle: % zusätzliche Rollen für abweichende Bereiche', v_n;

  perform public.profil_rechte_berechnen(null);

  -- 3) Prüffunktionen ---------------------------------------------------------------
  -- Bereiche, in denen der Aufrufer eines der Rechte hat (null = irgendein
  -- Recht / Grundausstattung). Mit gewählter Ansicht nur dieser Bereich.
  create or replace function public.bereiche_fuer(p_rechte text[]) returns text[]
  language sql stable security definer set search_path = public as $f$
    with m as (
      select r.rechte_bereich, r.bereiche, p.bereich_ansicht
      from profil_rechte r join profiles p on p.id = r.profile_id
      where r.profile_id = auth.uid()
    ), b as (
      select case when p_rechte is null then m.bereiche
             else coalesce((select array_agg(distinct x order by x)
                            from jsonb_each(m.rechte_bereich) e, jsonb_array_elements_text(e.value) x
                            where e.key = any(p_rechte)), '{}') end as bs,
             m.bereich_ansicht, m.bereiche
      from m
    )
    select coalesce((
      select case when b.bereich_ansicht is not null and b.bereich_ansicht = any(b.bereiche)
                  then array(select x from unnest(b.bs) x where x = b.bereich_ansicht)
                  else b.bs end
      from b), '{}');
  $f$;

  create or replace function public.bereich_filter_fuer(p_rechte text[]) returns boolean
  language sql stable security definer set search_path = public as $f$
    select exists (select 1 from geschaeftsbereich g where g.kuerzel <> all (public.bereiche_fuer(p_rechte)));
  $f$;

  create or replace function public.current_bereiche() returns text[]
  language sql stable as $f$ select public.bereiche_fuer(null) $f$;

  create or replace function public.vt_darf(p_schreiben boolean default false) returns boolean
  language sql stable security definer set search_path = public as $f$
    select darf_any(a) and 'VT' = any (bereiche_fuer(a))
    from (select case when p_schreiben then array['vertrieb.planung:S']
                      else array['vertrieb.planung:L'] end as a) x;
  $f$;

  -- 4a) Bereichs-Grenzen je Befehl --------------------------------------------------
  for t in
    select tablename, qual, with_check from pg_policies
    where schemaname = 'public' and policyname = 'bereich_grenze'
  loop
    foreach v_cmd in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      -- Rechte aus den erlaubenden Policies dieser Tabelle für diesen Befehl
      select array_agg(distinct m[1] order by m[1]),
             bool_or(coalesce(pp.qual, '') || coalesce(pp.with_check, '') !~ '[a-z_]+\.[a-z_]+:[LS]')
        into v_rechte, v_basis
      from pg_policies pp
      left join lateral regexp_matches(coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, ''),
                                       '''([a-z_]+(?:\.[a-z_]+)?:[LS])''', 'g') m on true
      where pp.schemaname = 'public' and pp.tablename = t.tablename
        and pp.permissive = 'PERMISSIVE' and pp.cmd in (v_cmd, 'ALL');

      v_using := t.qual;
      v_check := coalesce(t.with_check, t.qual);
      if not coalesce(v_basis, true) and v_rechte is not null then
        v_using := replace(replace(v_using, 'current_bereiche()', format('bereiche_fuer(%L::text[])', v_rechte)),
                           'bereich_filter_aktiv()', format('bereich_filter_fuer(%L::text[])', v_rechte));
        v_check := replace(replace(v_check, 'current_bereiche()', format('bereiche_fuer(%L::text[])', v_rechte)),
                           'bereich_filter_aktiv()', format('bereich_filter_fuer(%L::text[])', v_rechte));
      end if;
      execute format('drop policy if exists %I on public.%I', 'bereich_' || lower(v_cmd), t.tablename);
      if v_cmd = 'SELECT' then
        execute format('create policy bereich_select on public.%I as restrictive for select using (%s)', t.tablename, v_using);
      elsif v_cmd = 'INSERT' then
        execute format('create policy bereich_insert on public.%I as restrictive for insert with check (%s)', t.tablename, v_check);
      elsif v_cmd = 'UPDATE' then
        execute format('create policy bereich_update on public.%I as restrictive for update using (%s) with check (%s)', t.tablename, v_using, v_check);
      else
        execute format('create policy bereich_delete on public.%I as restrictive for delete using (%s)', t.tablename, v_using);
      end if;
    end loop;
    execute format('drop policy bereich_grenze on public.%I', t.tablename);
  end loop;

  -- 4b) Views mit Bereichsfilter: Rechte aus dem View-Text
  for obj in
    select c.oid, c.relname, c.reloptions, pg_get_viewdef(c.oid, false) as def
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, false) ~ 'current_bereiche\(\)|bereich_filter_aktiv\(\)'
  loop
    select array_agg(distinct m[1] order by m[1]) into v_rechte
    from regexp_matches(obj.def, '''([a-z_]+(?:\.[a-z_]+)?:[LS])''', 'g') m;
    continue when v_rechte is null;  -- Grundausstattung: alle Bereiche des Nutzers
    v_text := replace(replace(obj.def, 'current_bereiche()', format('bereiche_fuer(%L::text[])', v_rechte)),
                      'bereich_filter_aktiv()', format('bereich_filter_fuer(%L::text[])', v_rechte));
    execute format('create or replace view public.%I as %s', obj.relname, rtrim(rtrim(v_text), ';'));
    if obj.reloptions is not null then
      execute format('alter view public.%I set (%s)', obj.relname, array_to_string(obj.reloptions, ', '));
    end if;
  end loop;

  -- 4c) Funktionen mit Bereichsprüfung: Rechte aus dem Funktions-Text
  for obj in
    select pr.oid, pr.proname, pg_get_functiondef(pr.oid) as def
    from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.prokind in ('f', 'p')
      and pr.proname not in ('current_bereiche', 'bereich_filter_aktiv', 'bereiche_fuer',
                             'bereich_filter_fuer', 'vt_darf', 'profil_rechte_berechnen')
      and not exists (select 1 from pg_depend dd where dd.objid = pr.oid and dd.deptype = 'e')
      and pg_get_functiondef(pr.oid) ~ 'current_bereiche\s*\(\)|bereich_filter_aktiv\s*\(\)'
  loop
    select array_agg(distinct m[1] order by m[1]) into v_rechte
    from regexp_matches(obj.def, '''([a-z_]+(?:\.[a-z_]+)?:[LS])''', 'g') m;
    continue when v_rechte is null;
    v_text := regexp_replace(obj.def, 'current_bereiche\s*\(\)', format('bereiche_fuer(%L::text[])', v_rechte), 'g');
    v_text := regexp_replace(v_text, 'bereich_filter_aktiv\s*\(\)', format('bereich_filter_fuer(%L::text[])', v_rechte), 'g');
    execute v_text;
  end loop;

  -- 5) Kontrolle ---------------------------------------------------------------------
  select string_agg(tablename, ', ') into v_rest from pg_policies
  where schemaname = 'public' and policyname = 'bereich_grenze';
  if v_rest is not null then
    raise exception 'Bereichs-Grenze nicht umgestellt: %', v_rest;
  end if;
  if exists (select 1 from rolle where cardinality(bereiche) = 0) then
    raise exception 'Rolle ohne Bereich: %', (select string_agg(id, ', ') from rolle where cardinality(bereiche) = 0);
  end if;
end
$umbau$;
