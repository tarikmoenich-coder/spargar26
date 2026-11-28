-- ============================================================================
-- Migration 2026-11-28l: Wetter & Frost (Stufe 1), Konzept docs/wetter-konzept.md
--
--  1. Recht "wetter" (lesen: alle Rollen, schreiben: Erntewirtschaft; Admin und
--     Geschäftsführer haben ohnehin alle Rechte).
--  2. wetter_station / wetter_stunde: DWD-MOSMIX-Vorhersage je Punkt, stündlich.
--     Schreibt NUR der wetter-poller (Service-Key) - keine Schreib-Policy.
--  3. wetter_frost_regel: Schwellen je Kultur (Erdbeeren, Grünspargel).
--  4. feld_bluete: Erdbeerfeld "in Blüte" von/bis je Saison.
--  5. wetter_feld (Feld -> nächster Vorhersagepunkt, füllt der Poller), Sichten
--     feld_wetter und wetter_frost (Warnstunden der nächsten 48 h).
--
-- Ein DO-Block (Supabase-Konsole führt Anweisungen einzeln aus), wiederholbar.
-- ============================================================================

do $umbau$
begin
  -- 1) Recht ---------------------------------------------------------------------
  insert into public.recht_katalog (id, modul, titel, unter, sensibel, nur_lesen, sortierung)
  values ('wetter', 'Wetter', 'Wetter & Frost',
          'Vorhersage je Feld, Frostwarnung; schreiben = Frost-Schwellen und Erdbeer-Blüte pflegen',
          false, false, 48)
  on conflict (id) do nothing;

  update public.rolle
     set rechte = rechte || jsonb_build_object('wetter', case when id = 'erntewirtschaft' then 'S' else 'L' end)
   where not alle_rechte and not (rechte ? 'wetter');

  -- 2) Vorhersage ----------------------------------------------------------------
  create table if not exists public.wetter_station (
    id text primary key,                 -- MOSMIX-Kennung, z.B. 'L857'
    name text not null,
    lat double precision not null,
    lng double precision not null,
    hoehe_m int,
    ausgabe timestamptz,                 -- Ausgabezeit der zuletzt geladenen Vorhersage
    geladen_am timestamptz
  );

  create table if not exists public.wetter_stunde (
    station_id text not null references public.wetter_station (id) on delete cascade,
    zeit timestamptz not null,           -- Ende der Stunde (DWD-Zeitschritt, UTC)
    t2m numeric(5, 2),                   -- °C in 2 m
    t5cm numeric(5, 2),                  -- °C 5 cm über dem Boden
    td numeric(5, 2),                    -- Taupunkt °C
    regen_mm numeric(6, 2),              -- l/m² in dieser Stunde
    regen_wahrsch int,                   -- % für > 0,1 mm in dieser Stunde
    sonne_min int,                       -- Sonnenminuten in dieser Stunde
    wolken_proz int,                     -- Bedeckung %
    wind_ms numeric(5, 2),
    primary key (station_id, zeit)
  );
  create index if not exists idx_wetter_stunde_zeit on public.wetter_stunde (zeit);

  -- 3) Frostschwellen --------------------------------------------------------------
  create table if not exists public.wetter_frost_regel (
    kultur text primary key check (kultur in ('erdbeeren', 'gruenspargel')),
    vorwarnung numeric(4, 1) not null,
    kritisch numeric(4, 1) not null,
    gruenspargel_ernte_von text not null default '04-01',  -- MM-TT, wenn kein Erntefenster gepflegt
    gruenspargel_ernte_bis text not null default '06-24',
    check (kritisch <= vorwarnung)
  );
  insert into public.wetter_frost_regel (kultur, vorwarnung, kritisch) values
    ('erdbeeren', 1, -1),
    ('gruenspargel', 1, -2)
  on conflict (kultur) do nothing;

  -- 4) Erdbeerblüte ------------------------------------------------------------------
  create table if not exists public.feld_bluete (
    feld_id bigint not null references public.feld (id) on delete cascade,
    saison_jahr int not null,
    von date not null,
    bis date,                            -- null = blüht noch
    geaendert_von uuid default auth.uid() references public.profiles (id),
    geaendert_am timestamptz not null default now(),
    primary key (feld_id, saison_jahr),
    check (bis is null or bis >= von)
  );

  -- Rechte / RLS
  alter table public.wetter_station enable row level security;
  alter table public.wetter_stunde enable row level security;
  alter table public.wetter_frost_regel enable row level security;
  alter table public.feld_bluete enable row level security;
  revoke all on public.wetter_station, public.wetter_stunde, public.wetter_frost_regel, public.feld_bluete from anon;
  grant select on public.wetter_station, public.wetter_stunde to authenticated;
  revoke insert, update, delete on public.wetter_station, public.wetter_stunde from authenticated;
  grant select, update on public.wetter_frost_regel to authenticated;
  grant select, insert, update, delete on public.feld_bluete to authenticated;

  drop policy if exists wetter_station_lesen on public.wetter_station;
  create policy wetter_station_lesen on public.wetter_station for select using (( select public.darf('wetter:L') ));
  drop policy if exists wetter_stunde_lesen on public.wetter_stunde;
  create policy wetter_stunde_lesen on public.wetter_stunde for select using (( select public.darf('wetter:L') ));
  drop policy if exists wetter_frost_regel_lesen on public.wetter_frost_regel;
  create policy wetter_frost_regel_lesen on public.wetter_frost_regel for select using (( select public.darf('wetter:L') ));
  drop policy if exists wetter_frost_regel_schreiben on public.wetter_frost_regel;
  create policy wetter_frost_regel_schreiben on public.wetter_frost_regel for update
    using (( select public.darf('wetter:S') )) with check (( select public.darf('wetter:S') ));
  drop policy if exists feld_bluete_lesen on public.feld_bluete;
  create policy feld_bluete_lesen on public.feld_bluete for select using (( select public.darf('wetter:L') ));
  drop policy if exists feld_bluete_schreiben on public.feld_bluete;
  create policy feld_bluete_schreiben on public.feld_bluete for all
    using (( select public.darf('wetter:S') )) with check (( select public.darf('wetter:S') ));

  drop trigger if exists trg_audit_wetter_frost_regel on public.wetter_frost_regel;
  create trigger trg_audit_wetter_frost_regel after insert or update or delete on public.wetter_frost_regel
    for each row execute function public.write_audit_log();
  drop trigger if exists trg_audit_feld_bluete on public.feld_bluete;
  create trigger trg_audit_feld_bluete after insert or update or delete on public.feld_bluete
    for each row execute function public.write_audit_log();

  -- 5) Feld -> Vorhersagepunkt (füllt der Poller: Feldmittelpunkt aus der
  --    Geometrie, nächster MOSMIX-Punkt). Bewusst ohne PostGIS-Rechnung in der
  --    Sicht - einfacher und überall gleich prüfbar.
  create table if not exists public.wetter_feld (
    feld_id bigint primary key references public.feld (id) on delete cascade,
    lat double precision not null,
    lng double precision not null,
    station_id text references public.wetter_station (id) on delete set null,
    entfernung_km numeric(6, 1),
    aktualisiert timestamptz not null default now()
  );
  alter table public.wetter_feld enable row level security;
  revoke all on public.wetter_feld from anon;
  grant select on public.wetter_feld to authenticated;
  revoke insert, update, delete on public.wetter_feld from authenticated;
  drop policy if exists wetter_feld_lesen on public.wetter_feld;
  create policy wetter_feld_lesen on public.wetter_feld for select using (( select public.darf('wetter:L') ));

  -- Sichten mit Eigentümer-Rechten + darf('wetter:L'): wer Wetter sehen darf,
  -- sieht Feldnamen und Kultur, auch ohne Recht auf die Anbau-Seiten.
  execute $v$
  create or replace view public.feld_wetter as
  select fe.id as feld_id, fe.bezeichnung, fe.kultur, wf.lat, wf.lng,
         wf.station_id, ws.name as station_name, wf.entfernung_km
  from public.feld fe
  join public.wetter_feld wf on wf.feld_id = fe.id
  left join public.wetter_station ws on ws.id = wf.station_id
  where fe.aktiv and public.darf('wetter:L')
  $v$;

  -- Frostrelevant: Erdbeeren in Blüte (feld_bluete, Saison = Jahr der Stunde),
  -- Grünspargel im Erntefenster (feld_anbau, sonst Zeitraum aus der Regel).
  execute $v$
  create or replace view public.wetter_frost as
  with fw as (
    select * from public.feld_wetter where kultur in ('erdbeeren', 'gruenspargel') and station_id is not null
  ),
  h as (
    select fw.feld_id, fw.bezeichnung, fw.kultur, fw.station_id, fw.station_name,
           st.zeit, st.t2m, st.t5cm, st.td, st.wolken_proz, st.wind_ms,
           r.vorwarnung, r.kritisch, r.gruenspargel_ernte_von, r.gruenspargel_ernte_bis,
           (st.zeit at time zone 'Europe/Berlin')::date as tag
    from fw
    join public.wetter_frost_regel r on r.kultur = fw.kultur
    join public.wetter_stunde st on st.station_id = fw.station_id
    where st.zeit > now() and st.zeit <= now() + interval '48 hours'
  )
  select h.feld_id, h.bezeichnung, h.kultur, h.station_id, h.station_name, h.zeit,
         h.t2m, h.t5cm, h.td, h.wolken_proz, h.wind_ms, h.vorwarnung, h.kritisch,
         case when h.t5cm <= h.kritisch then 'kritisch' else 'vorwarnung' end as stufe,
         case when h.t5cm <= h.vorwarnung then 'Bodentemperatur'
              else 'Strahlungsfrost (klar, trocken)' end as grund
  from h
  where (
      h.t5cm <= h.vorwarnung
      or (h.td <= 0 and coalesce(h.wolken_proz, 100) <= 40 and h.t5cm <= h.vorwarnung + 2)
    )
    and (
      (h.kultur = 'erdbeeren' and exists (
         select 1 from public.feld_bluete b
         where b.feld_id = h.feld_id and b.saison_jahr = extract(year from h.tag)::int
           and h.tag >= b.von and (b.bis is null or h.tag <= b.bis)))
      or
      (h.kultur = 'gruenspargel' and coalesce(
         (select h.tag between a.erntefenster_von and a.erntefenster_bis
            from public.feld_anbau a
           where a.feld_id = h.feld_id and a.saison_jahr = extract(year from h.tag)::int
             and a.erntefenster_von is not null and a.erntefenster_bis is not null),
         to_char(h.tag, 'MM-DD') between h.gruenspargel_ernte_von and h.gruenspargel_ernte_bis))
    )
  $v$;

  revoke all on public.feld_wetter, public.wetter_frost from anon;
  grant select on public.feld_wetter, public.wetter_frost to authenticated;
end
$umbau$;
