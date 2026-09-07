-- Mehrere Kassenbücher (Nutzer-Vorgabe). Phase 1: Bücher + Journal je Buch +
-- Umbuchungen zwischen zwei Büchern. Die bestehende "Mömmel Lohnkasse" bleibt
-- unangetastet - ihr Saldo kommt weiter aus kassenbestand_bis(), zusätzlich
-- fließen Umbuchungen von/zu ihr über kassenbuch_buchung ein.
-- Phase 2 (separat): Kassenprüfung je Buch, Eröffnungssaldo-Sperre nach erster
-- freigegebener Prüfung.

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------
create table if not exists kassenbuch (
  id bigint generated always as identity primary key,
  bezeichnung text not null unique,
  kuerzel text not null unique,           -- Präfix der Belegnummern (z.B. MLK-2610-001)
  typ text not null check (typ in ('lohnkasse', 'allgemein')),
  -- admin-editierbar; Phase 2 sperrt das Feld, sobald das Buch eine
  -- freigegebene Kassenprüfung hat.
  eroeffnungssaldo numeric(12, 2) not null default 0,
  aktiv boolean not null default true,
  reihenfolge int not null default 0,
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_kassenbuch_updated_at before update on kassenbuch
  for each row execute function set_updated_at();

insert into kassenbuch (bezeichnung, kuerzel, typ, reihenfolge) values
  ('Mömmel Lohnkasse',      'MLK', 'lohnkasse', 1),
  ('Mömmel',                'MÖ',  'allgemein', 2),
  ('Mönich Landwirtschaft', 'ML',  'allgemein', 3),
  ('Mönich Direkt',         'MD',  'allgemein', 4)
on conflict (bezeichnung) do nothing;

create table if not exists kassenbuch_buchung (
  id bigint generated always as identity primary key,
  kassenbuch_id bigint not null references kassenbuch (id) on delete restrict,
  belegnummer text not null unique,
  datum timestamptz not null default now(),
  datum_kassenbuch date not null default current_date,
  betrag numeric(12, 2) not null check (betrag > 0),
  richtung text not null check (richtung in ('eingang', 'ausgang')),
  verwendungszweck text,
  hinweis text,
  -- Umbuchung: beide Zeilen teilen sich umbuchung_id, gegenbuchung_id zeigt auf
  -- die jeweils andere Zeile. Storno der einen storniert immer auch die andere.
  umbuchung_id uuid,
  gegenbuchung_id bigint references kassenbuch_buchung (id),
  bearbeiter_id uuid references profiles (id) default auth.uid(),
  storniert boolean not null default false,
  storniert_am timestamptz,
  storniert_von uuid references profiles (id),
  storno_grund text,
  erstellt_am timestamptz not null default now()
);
create index if not exists idx_kassenbuch_buchung_buch
  on kassenbuch_buchung (kassenbuch_id, datum);
create index if not exists idx_kassenbuch_buchung_umbuchung
  on kassenbuch_buchung (umbuchung_id) where umbuchung_id is not null;

-- ---------------------------------------------------------------------------
-- Saldo je Buch
--   allgemein : eroeffnungssaldo + Σ eingang − Σ ausgang (ohne stornierte)
--   lohnkasse : zusätzlich kassenbestand_bis() (die bestehende 4-Quellen-Formel)
-- ---------------------------------------------------------------------------
create or replace function kassenbuch_saldo_bis(
  p_kassenbuch_id bigint,
  p_bis timestamptz default now()
)
returns numeric language sql stable as $$
  select
    kb.eroeffnungssaldo
    + coalesce((
        select sum(case when b.richtung = 'eingang' then b.betrag else -b.betrag end)
        from kassenbuch_buchung b
        where b.kassenbuch_id = kb.id
          and not b.storniert
          and b.datum < p_bis
      ), 0)
    + case when kb.typ = 'lohnkasse' then kassenbestand_bis(p_bis) else 0 end
  from kassenbuch kb
  where kb.id = p_kassenbuch_id;
$$;
grant execute on function kassenbuch_saldo_bis(bigint, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Belegnummer je Buch: <kuerzel>-<YYMM>-<lfd>, eigener Zähler je (Buch, Monat)
-- ---------------------------------------------------------------------------
create or replace function kassenbuch_naechste_belegnummer(p_kassenbuch_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_kuerzel text;
begin
  select kuerzel into v_kuerzel from kassenbuch where id = p_kassenbuch_id;
  if v_kuerzel is null then
    raise exception 'Kassenbuch % nicht gefunden', p_kassenbuch_id;
  end if;
  return naechste_belegnummer(
    v_kuerzel || '-' || to_char(now() at time zone 'Europe/Berlin', 'YYMM')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Buchen (Einnahme/Ausgabe) auf ein Buch
-- ---------------------------------------------------------------------------
create or replace function kassenbuch_buchen(
  p_kassenbuch_id bigint,
  p_richtung text,
  p_betrag numeric,
  p_datum_kassenbuch date,
  p_verwendungszweck text,
  p_hinweis text default null
)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if current_role_name() not in ('admin', 'kasse') then
    raise exception 'Keine Berechtigung für Kassenbuch-Buchungen';
  end if;
  if p_richtung not in ('eingang', 'ausgang') then
    raise exception 'Ungültige Richtung: %', p_richtung;
  end if;
  if p_betrag is null or p_betrag <= 0 then
    raise exception 'Betrag muss größer als 0 sein';
  end if;
  -- Phase 2: hier Sperre bei freigegebener Kassenprüfung des Buchs prüfen.

  insert into kassenbuch_buchung (
    kassenbuch_id, belegnummer, datum_kassenbuch, betrag, richtung,
    verwendungszweck, hinweis
  ) values (
    p_kassenbuch_id,
    kassenbuch_naechste_belegnummer(p_kassenbuch_id),
    coalesce(p_datum_kassenbuch, current_date),
    p_betrag, p_richtung,
    nullif(btrim(p_verwendungszweck), ''), nullif(btrim(p_hinweis), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function kassenbuch_buchen(bigint, text, numeric, date, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Umbuchung zwischen zwei Büchern: legt atomar zwei verknüpfte Zeilen an
-- (Ausgang im Quellbuch, Eingang im Zielbuch).
-- ---------------------------------------------------------------------------
create or replace function kassenbuch_umbuchen(
  p_quelle_id bigint,
  p_ziel_id bigint,
  p_betrag numeric,
  p_datum_kassenbuch date,
  p_verwendungszweck text default null,
  p_hinweis text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_umb uuid := gen_random_uuid();
  v_datum date := coalesce(p_datum_kassenbuch, current_date);
  v_zweck text := nullif(btrim(p_verwendungszweck), '');
  v_hinweis text := nullif(btrim(p_hinweis), '');
  v_quelle_name text;
  v_ziel_name text;
  v_aus_id bigint;
  v_ein_id bigint;
begin
  if current_role_name() not in ('admin', 'kasse') then
    raise exception 'Keine Berechtigung für Umbuchungen';
  end if;
  if p_quelle_id = p_ziel_id then
    raise exception 'Quelle und Ziel müssen unterschiedliche Kassenbücher sein';
  end if;
  if p_betrag is null or p_betrag <= 0 then
    raise exception 'Betrag muss größer als 0 sein';
  end if;

  select bezeichnung into v_quelle_name from kassenbuch where id = p_quelle_id;
  select bezeichnung into v_ziel_name from kassenbuch where id = p_ziel_id;
  if v_quelle_name is null or v_ziel_name is null then
    raise exception 'Quell- oder Zielkassenbuch nicht gefunden';
  end if;
  -- Phase 2: hier Sperre bei freigegebener Kassenprüfung beider Bücher prüfen.

  insert into kassenbuch_buchung (
    kassenbuch_id, belegnummer, datum_kassenbuch, betrag, richtung,
    verwendungszweck, hinweis, umbuchung_id
  ) values (
    p_quelle_id, kassenbuch_naechste_belegnummer(p_quelle_id), v_datum,
    p_betrag, 'ausgang',
    coalesce(v_zweck, 'Umbuchung an ' || v_ziel_name), v_hinweis, v_umb
  )
  returning id into v_aus_id;

  insert into kassenbuch_buchung (
    kassenbuch_id, belegnummer, datum_kassenbuch, betrag, richtung,
    verwendungszweck, hinweis, umbuchung_id, gegenbuchung_id
  ) values (
    p_ziel_id, kassenbuch_naechste_belegnummer(p_ziel_id), v_datum,
    p_betrag, 'eingang',
    coalesce(v_zweck, 'Umbuchung von ' || v_quelle_name), v_hinweis, v_umb, v_aus_id
  )
  returning id into v_ein_id;

  update kassenbuch_buchung set gegenbuchung_id = v_ein_id where id = v_aus_id;
  return v_umb;
end;
$$;
grant execute on function kassenbuch_umbuchen(bigint, bigint, numeric, date, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Storno einer Buchung (Pflichtgrund). Bei einer Umbuchung wird immer auch
-- die Gegenbuchung mit storniert.
-- ---------------------------------------------------------------------------
create or replace function kassenbuch_buchung_stornieren(
  p_buchung_id bigint,
  p_grund text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row kassenbuch_buchung%rowtype;
begin
  if current_role_name() not in ('admin', 'kasse') then
    raise exception 'Keine Berechtigung für Storno';
  end if;
  if p_grund is null or btrim(p_grund) = '' then
    raise exception 'Ein Storno-Grund ist erforderlich';
  end if;

  select * into v_row from kassenbuch_buchung where id = p_buchung_id;
  if not found then
    raise exception 'Buchung nicht gefunden';
  end if;
  if v_row.storniert then
    raise exception 'Buchung ist bereits storniert';
  end if;
  -- Phase 2: hier Sperre bei freigegebener Kassenprüfung prüfen.

  update kassenbuch_buchung
  set storniert = true, storniert_am = now(), storniert_von = auth.uid(),
      storno_grund = btrim(p_grund)
  where id = p_buchung_id
     or (v_row.umbuchung_id is not null and umbuchung_id = v_row.umbuchung_id);
end;
$$;
grant execute on function kassenbuch_buchung_stornieren(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table kassenbuch enable row level security;
alter table kassenbuch_buchung enable row level security;

-- Lesen: wie der übrige Kasse-Bereich.
drop policy if exists "kassenbuch_select" on kassenbuch;
create policy "kassenbuch_select" on kassenbuch for select
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
-- Nur admin darf Stammdaten (v.a. Eröffnungssaldo) ändern; Anlegen/Löschen der
-- 4 Bücher passiert per Migration.
drop policy if exists "kassenbuch_update" on kassenbuch;
create policy "kassenbuch_update" on kassenbuch for update
  using (is_admin()) with check (is_admin());

drop policy if exists "kassenbuch_buchung_select" on kassenbuch_buchung;
create policy "kassenbuch_buchung_select" on kassenbuch_buchung for select
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
-- Schreiben ausschließlich über die security-definer Funktionen oben.

grant select, update on kassenbuch to authenticated;
grant select on kassenbuch_buchung to authenticated;

do $$
begin
  alter publication supabase_realtime add table kassenbuch_buchung;
exception when duplicate_object then null;
end $$;
