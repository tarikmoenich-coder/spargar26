-- ============================================================================
-- Migration 2026-11-25c: Vertriebsplanung V1 - Stände, Öffnungszeiten, Touren
-- (docs/vertriebsplanung-plan.md).
--
-- Nutzer-Vorgaben 2026-11-25:
--   * 95 feste Stände; Öffnung je Wochentag Vormittag/Nachmittag mit
--     Uhrzeiten, die je Stand UND je Wochentag verschieden sein können.
--   * Feste Touren, sonntags andere als Montag-Samstag.
--   * Je Stand in der Tour "fährt mit" oder "nur Ware" (Verkäufer kommt
--     selbst). Fahrer = Verkäufer des letzten mitfahrenden Stands; er fährt
--     hin und zurück (kein Wechsel am Tag) - wird nicht gespeichert, sondern
--     im Grundplan (V3) abgeleitet.
--
-- Rechte: nur wer den Bereich Vertrieb sieht (current_bereiche()).
--   Lesen:  admin, hr, lohnabrechnung, management, pruefer
--   Pflegen: admin, hr
--
-- Jede Anweisung einzeln wiederholbar (Supabase-Konsole führt einzeln aus).
-- ============================================================================

-- 1) Rechte-Prüfung -------------------------------------------------------------
create or replace function public.vt_darf(p_schreiben boolean default false)
returns boolean language sql stable security definer
set search_path = public
as $$
  select 'VT' = any (current_bereiche())
     and hat_rolle(case when p_schreiben
                     then array['admin', 'hr']::user_role[]
                     else array['admin', 'hr', 'lohnabrechnung', 'management', 'pruefer']::user_role[]
                   end);
$$;
revoke all on function public.vt_darf(boolean) from public, anon;
grant execute on function public.vt_darf(boolean) to authenticated, service_role;

-- 2) Stände ---------------------------------------------------------------------
create table if not exists public.vt_stand (
  id bigint generated always as identity primary key,
  nummer int not null unique check (nummer > 0),
  name text not null check (btrim(name) <> ''),
  adresse text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  radius_m int not null default 100 check (radius_m between 10 and 2000),
  aktiv boolean not null default true,
  notiz text,
  erstellt_von uuid references public.profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vt_stand_koordinaten_paar check ((lat is null) = (lng is null))
);
drop trigger if exists trg_vt_stand_updated_at on public.vt_stand;
create trigger trg_vt_stand_updated_at before update on public.vt_stand
  for each row execute function public.set_updated_at();

-- 3) Öffnungszeiten: Zeile vorhanden = an diesem Halbtag geöffnet ------------------
--    wochentag ISO: 1 = Montag ... 7 = Sonntag
create table if not exists public.vt_stand_zeit (
  id bigint generated always as identity primary key,
  stand_id bigint not null references public.vt_stand (id) on delete cascade,
  wochentag smallint not null check (wochentag between 1 and 7),
  halbtag text not null check (halbtag in ('VM', 'NM')),
  von time not null,
  bis time not null,
  constraint vt_stand_zeit_reihenfolge check (bis > von),
  constraint vt_stand_zeit_eindeutig unique (stand_id, wochentag, halbtag)
);

-- 4) Touren -------------------------------------------------------------------------
create table if not exists public.vt_tour (
  id bigint generated always as identity primary key,
  tagesart text not null check (tagesart in ('MO_SA', 'SO')),
  nummer int not null check (nummer > 0),
  name text,
  fahrzeug_id bigint references public.fahrzeug (id) on delete set null,
  abfahrt time,
  aktiv boolean not null default true,
  notiz text,
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vt_tour_nummer_eindeutig unique (tagesart, nummer),
  constraint vt_tour_id_tagesart unique (id, tagesart)
);
drop trigger if exists trg_vt_tour_updated_at on public.vt_tour;
create trigger trg_vt_tour_updated_at before update on public.vt_tour
  for each row execute function public.set_updated_at();

-- Stände einer Tour in Reihenfolge. tagesart wird mitgeführt, damit ein
-- Stand je Tagesart nur in EINER Tour stecken kann.
create table if not exists public.vt_tour_stand (
  id bigint generated always as identity primary key,
  tour_id bigint not null,
  tagesart text not null,
  stand_id bigint not null references public.vt_stand (id) on delete cascade,
  reihenfolge int not null check (reihenfolge > 0),
  nur_ware boolean not null default false,
  constraint vt_tour_stand_tour foreign key (tour_id, tagesart)
    references public.vt_tour (id, tagesart) on update cascade on delete cascade,
  constraint vt_tour_stand_einmal_je_tagesart unique (tagesart, stand_id),
  constraint vt_tour_stand_reihenfolge unique (tour_id, reihenfolge)
);
create index if not exists idx_vt_tour_stand_stand on public.vt_tour_stand (stand_id);
create index if not exists idx_vt_tour_fahrzeug on public.vt_tour (fahrzeug_id);

-- 5) RLS ------------------------------------------------------------------------------
alter table public.vt_stand enable row level security;
alter table public.vt_stand_zeit enable row level security;
alter table public.vt_tour enable row level security;
alter table public.vt_tour_stand enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['vt_stand', 'vt_stand_zeit', 'vt_tour', 'vt_tour_stand'] loop
    execute format('drop policy if exists "vt_lesen" on public.%I', t);
    execute format('create policy "vt_lesen" on public.%I for select to authenticated
                      using ((select public.vt_darf(false)))', t);
    execute format('drop policy if exists "vt_pflegen" on public.%I', t);
    execute format('create policy "vt_pflegen" on public.%I for all to authenticated
                      using ((select public.vt_darf(true)))
                      with check ((select public.vt_darf(true)))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists trg_audit_%s on public.%I', t, t);
    execute format('create trigger trg_audit_%s after insert or update or delete on public.%I
                      for each row execute function public.write_audit_log()', t, t);
  end loop;
end $$;

-- 6) Stände einer Tour in einem Zug setzen (Reihenfolge + nur Ware) -------------------
--    security invoker: RLS gilt wie bei direkten Schreibzugriffen.
create or replace function public.vt_tour_staende_setzen(
  p_tour_id bigint,
  p_stand_ids bigint[],
  p_nur_ware boolean[]
)
returns void language plpgsql
set search_path = public
as $$
declare
  v_tagesart text;
  v_konflikt text;
begin
  if not vt_darf(true) then
    raise exception 'Keine Berechtigung für die Tourenplanung.';
  end if;
  select tagesart into v_tagesart from vt_tour where id = p_tour_id;
  if v_tagesart is null then
    raise exception 'Tour nicht gefunden.';
  end if;
  if coalesce(array_length(p_stand_ids, 1), 0) <> coalesce(array_length(p_nur_ware, 1), 0) then
    raise exception 'Stände und "nur Ware" passen nicht zusammen.';
  end if;
  if (select count(*) <> count(distinct s) from unnest(p_stand_ids) s) then
    raise exception 'Ein Stand ist doppelt in der Tour.';
  end if;

  select string_agg(format('Stand %s ist schon in Tour %s', s.nummer, t.nummer), '; ')
    into v_konflikt
    from vt_tour_stand ts
    join vt_tour t on t.id = ts.tour_id
    join vt_stand s on s.id = ts.stand_id
   where ts.tagesart = v_tagesart
     and ts.tour_id <> p_tour_id
     and ts.stand_id = any (p_stand_ids);
  if v_konflikt is not null then
    raise exception '%', v_konflikt;
  end if;

  delete from vt_tour_stand where tour_id = p_tour_id;
  insert into vt_tour_stand (tour_id, tagesart, stand_id, reihenfolge, nur_ware)
  select p_tour_id, v_tagesart, s.stand_id, s.nr, coalesce(p_nur_ware[s.nr], false)
    from unnest(p_stand_ids) with ordinality as s(stand_id, nr);
end;
$$;
revoke all on function public.vt_tour_staende_setzen(bigint, bigint[], boolean[]) from public, anon;
grant execute on function public.vt_tour_staende_setzen(bigint, bigint[], boolean[]) to authenticated;
