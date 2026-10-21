-- ============================================================================
-- Migration 2026-10-20: Erntewirtschaft - Maschinen, Schichten, Kisten-Zyklen
-- + Processor (Teil 2, docs/erntewirtschaft-plan.md Teil E)
--
-- Baut auf migration_2026-10-12_erntewirtschaft_waage_grundlage.sql auf
-- (ernte_waage/ernte_tag/ernte_scan existieren schon). Neu: ernte_maschine,
-- ernte_position, ernte_schicht, ernte_kiste_zyklus, ernte_konfig,
-- ernte_poller_state, und die plpgsql-Funktion ernte_scan_verarbeiten(), die
-- aus den rohen ernte_scan-Zeilen Schichten/Kisten-Zyklen macht.
--
-- BEWUSST OHNE automatischen pg_cron-Zeitplan in dieser Migration - die
-- Funktion muss erst einmal manuell aufgerufen und das Ergebnis geprueft
-- werden (select ernte_scan_verarbeiten();), bevor sie jede Minute
-- automatisch laeuft. Der Zeitplan (cron.schedule) kommt als separater,
-- kleiner Nachtrag, sobald der manuelle Test bestanden ist.
--
-- Die Poller-Erweiterung (Traccar -> ernte_position, Teil G) ist NICHT Teil
-- dieser Migration - ernte_position existiert hier nur als leere Tabelle,
-- der Processor behandelt eine fehlende Position als Normalfall (feld_id
-- bleibt dann einfach NULL), nicht als Fehler.
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Maschinen (die Spinnen)
-- --------------------------------------------------------------------------
create table if not exists ernte_maschine (
  id bigint generated always as identity primary key,
  nummer text not null unique,
  bezeichnung text,
  box_seriennummer text unique,
  traccar_unique_id text unique,
  rtk boolean not null default false,
  aktiv boolean not null default true,
  notiz text,
  erstellt_am timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ernte_maschine_updated_at on ernte_maschine;
create trigger trg_ernte_maschine_updated_at before update on ernte_maschine
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- 2. Positions-Zeitreihe (append-only, nur Poller - noch nicht gebaut).
--    feld_id per Spatial-Join gegen feld.geometrie, echter FK (Migration
--    2026-10-19 feld/feld_anbau).
-- --------------------------------------------------------------------------
create table if not exists ernte_position (
  id bigint generated always as identity primary key,
  maschine_id bigint references ernte_maschine (id) on delete set null,
  traccar_unique_id text,
  zeitpunkt timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  hoehe_m numeric,
  speed_kmh numeric,
  kurs numeric,
  fix_qualitaet smallint,
  hdop numeric,
  feld_id bigint references feld (id) on delete set null,
  erstellt_am timestamptz not null default now(),
  unique (traccar_unique_id, zeitpunkt)
);

create index if not exists idx_ernte_position_maschine_zeit
  on ernte_position (maschine_id, zeitpunkt desc);

-- --------------------------------------------------------------------------
-- 3. Tages-Login je Maschine ("wer ist gerade angemeldet").
-- --------------------------------------------------------------------------
create table if not exists ernte_schicht (
  id bigint generated always as identity primary key,
  maschine_id bigint not null references ernte_maschine (id) on delete cascade,
  employee_id uuid references employees (id) on delete set null,
  tag_uid text not null,
  beginn timestamptz not null,
  ende timestamptz,
  quelle text not null default 'scan',
  notiz text
);

create index if not exists idx_ernte_schicht_maschine_beginn
  on ernte_schicht (maschine_id, beginn desc);
create index if not exists idx_ernte_schicht_employee_offen
  on ernte_schicht (employee_id) where ende is null;

-- --------------------------------------------------------------------------
-- 4. Kisten-Zyklus: eine Zeile je Befuell- -> Wiege-Runde. Die zentrale
--    Tabelle, die am Ende Feld + Person + Gewicht zusammenfuehrt.
-- --------------------------------------------------------------------------
create table if not exists ernte_kiste_zyklus (
  id bigint generated always as identity primary key,
  tag_uid text not null,
  kiste_nr text,
  maschine_id bigint references ernte_maschine (id) on delete set null,
  schicht_id bigint references ernte_schicht (id) on delete set null,
  employee_id uuid references employees (id) on delete set null,
  befuellt_am timestamptz not null,
  befuellt_lat double precision,
  befuellt_lng double precision,
  voll_am timestamptz,
  voll_lat double precision,
  voll_lng double precision,
  feld_id bigint references feld (id) on delete set null,
  gewogen_am timestamptz,
  gewicht_brutto_kg numeric(7, 2),
  tara_kg numeric(6, 2),
  gewicht_netto_kg numeric(7, 2) generated always as (gewicht_brutto_kg - tara_kg) stored,
  waage_id bigint references ernte_waage (id) on delete set null,
  status text not null default 'offen'
    check (status in ('offen', 'gewogen', 'verworfen', 'ungeklaert')),
  notiz text
);

create index if not exists idx_ernte_kiste_zyklus_maschine_befuellt
  on ernte_kiste_zyklus (maschine_id, befuellt_am desc);
create index if not exists idx_ernte_kiste_zyklus_offen
  on ernte_kiste_zyklus (tag_uid) where status = 'offen';
create index if not exists idx_ernte_kiste_zyklus_gewogen
  on ernte_kiste_zyklus (gewogen_am) where status = 'gewogen';

-- --------------------------------------------------------------------------
-- 5. Konfigurierbare Schwellwerte (Pflichtenheft-Werte, ohne Deploy
--    nachjustierbar).
-- --------------------------------------------------------------------------
create table if not exists ernte_konfig (
  schluessel text primary key,
  wert text not null,
  beschreibung text
);

insert into ernte_konfig (schluessel, wert, beschreibung) values
  ('tara_kg_standard', '0', 'Standard-Tara in kg, falls fuer eine Kiste keine andere bekannt ist'),
  ('schicht_timeout_min', '720', 'Noch nicht vom Processor verwendet (v1) - spaeter: Schicht nach dieser Inaktivitaet automatisch beenden'),
  ('sperrzeit_tag_s', '15', 'Mehrfachlesungen desselben Codes (Dauerscan-Modus) innerhalb dieser Zeit werden ignoriert'),
  ('kiste_faellig_bis', '23:00', 'Tagesend-Uhrzeit, bis zu der eine befuellte Kiste gewogen sein sollte (fuer spaetere Ketten-Luecken-Auswertung, noch nicht Teil dieser Migration)')
on conflict (schluessel) do nothing;

-- --------------------------------------------------------------------------
-- 6. Poller-Zustand (Platzhalter fuer die noch nicht gebaute
--    Traccar-Poller-Erweiterung, Teil G).
-- --------------------------------------------------------------------------
create table if not exists ernte_poller_state (
  id int primary key default 1,
  letzter_lauf timestamptz,
  letzte_position_zeit timestamptz,
  check (id = 1)
);

insert into ernte_poller_state (id) values (1)
  on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- 7. RLS (Muster wie Teil 1 / fahrzeug)
-- --------------------------------------------------------------------------
alter table ernte_maschine enable row level security;
alter table ernte_position enable row level security;
alter table ernte_schicht enable row level security;
alter table ernte_kiste_zyklus enable row level security;
alter table ernte_konfig enable row level security;

drop policy if exists "ernte_maschine_select" on ernte_maschine;
create policy "ernte_maschine_select" on ernte_maschine for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung'));
drop policy if exists "ernte_maschine_write" on ernte_maschine;
create policy "ernte_maschine_write" on ernte_maschine for all
  using (current_role_name() in ('admin', 'hr', 'erntewirtschaft', 'zeiterfassung'))
  with check (current_role_name() in ('admin', 'hr', 'erntewirtschaft', 'zeiterfassung'));

-- KEINE Insert-Policy auf ernte_position: nur der noch zu bauende Poller
-- (Service-Key), analog zu fahrzeug_position.
drop policy if exists "ernte_position_select" on ernte_position;
create policy "ernte_position_select" on ernte_position for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung'));

-- KEINE Insert-Policy auf ernte_schicht/ernte_kiste_zyklus: nur der
-- Processor (Service-Key bzw. security definer). admin/hr duerfen
-- nachtraeglich korrigieren (z.B. employee_id nachtragen).
drop policy if exists "ernte_schicht_select" on ernte_schicht;
create policy "ernte_schicht_select" on ernte_schicht for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung'));
drop policy if exists "ernte_schicht_update" on ernte_schicht;
create policy "ernte_schicht_update" on ernte_schicht for update
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

drop policy if exists "ernte_kiste_zyklus_select" on ernte_kiste_zyklus;
create policy "ernte_kiste_zyklus_select" on ernte_kiste_zyklus for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung'));
drop policy if exists "ernte_kiste_zyklus_update" on ernte_kiste_zyklus;
create policy "ernte_kiste_zyklus_update" on ernte_kiste_zyklus for update
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

drop policy if exists "ernte_konfig_select" on ernte_konfig;
create policy "ernte_konfig_select" on ernte_konfig for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung'));
drop policy if exists "ernte_konfig_write" on ernte_konfig;
create policy "ernte_konfig_write" on ernte_konfig for all
  using (current_role_name() = 'admin')
  with check (current_role_name() = 'admin');

grant select, insert, update, delete on ernte_maschine to authenticated;
grant select on ernte_position to authenticated;
grant select, update on ernte_schicht to authenticated;
grant select, update on ernte_kiste_zyklus to authenticated;
grant select, insert, update, delete on ernte_konfig to authenticated;

-- --------------------------------------------------------------------------
-- 8. Pilot-Maschine anlegen (das heute verkabelte und getestete TRB246).
-- --------------------------------------------------------------------------
insert into ernte_maschine (nummer, bezeichnung, box_seriennummer, aktiv)
select 'SPINNE-001', 'Pilotgeraet (Praxistest 2026-10-20)', '867734083271656', true
where not exists (select 1 from ernte_maschine where box_seriennummer = '867734083271656');

-- --------------------------------------------------------------------------
-- 9. Processor: faltet ernte_scan (wo verarbeitet_am is null) in
--    ernte_schicht/ernte_kiste_zyklus. Siehe docs/erntewirtschaft-plan.md,
--    Teil E, Abschnitt "Processor (pg_cron, jede Minute)" fuer die
--    Geschaeftslogik-Spezifikation, die diese Funktion umsetzt.
--
--    Fehlerverhalten: ein Fehler bei einer einzelnen Zeile (z.B. inaktive
--    Maschine) wird in ernte_scan.verarbeitung_fehler vermerkt und bricht
--    NICHT die ganze Verarbeitung ab - die uebrigen Zeilen werden trotzdem
--    bearbeitet. "Unbekannte Maschine" gilt als endgueltiger Fehler
--    (verarbeitet_am wird gesetzt, kein Retry). "Maschine inaktiv" gilt als
--    voruebergehend (verarbeitet_am bleibt NULL, naechster Lauf versucht es
--    erneut - falls die Maschine zwischenzeitlich wieder aktiviert wird).
-- --------------------------------------------------------------------------
create or replace function ernte_scan_verarbeiten()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  zeile record;
  sperrzeit_s int;
  tara_standard numeric;
  letzte_gleiche_lesung timestamptz;
  v_maschine record;
  v_employee_id uuid;
  v_offene_schicht record;
  v_schicht_id bigint;
  v_schicht_employee_id uuid;
  v_feld_id bigint;
  v_offener_zyklus record;
begin
  select coalesce(
    (select wert::int from ernte_konfig where schluessel = 'sperrzeit_tag_s'), 15
  ) into sperrzeit_s;
  select coalesce(
    (select wert::numeric from ernte_konfig where schluessel = 'tara_kg_standard'), 0
  ) into tara_standard;

  for zeile in
    select * from ernte_scan where verarbeitet_am is null order by zeitpunkt asc
  loop
    begin
      -- Sperrzeit-Pruefung (Dauerscan-Modus meldet denselben Code
      -- mehrmals/Sekunde) - nur fuer person_login/kiste relevant, nicht fuer
      -- gewicht/batterie.
      if zeile.ereignis in ('person_login', 'kiste') then
        select max(zeitpunkt) into letzte_gleiche_lesung
        from ernte_scan
        where tag_uid = zeile.tag_uid
          and ereignis = zeile.ereignis
          and verarbeitet_am is not null
          and id <> zeile.id
          and zeitpunkt between zeile.zeitpunkt - make_interval(secs => sperrzeit_s) and zeile.zeitpunkt;

        if letzte_gleiche_lesung is not null then
          update ernte_scan set verarbeitet_am = now() where id = zeile.id;
          continue;
        end if;
      end if;

      -- Maschine ermitteln (ueber die Box-Kennung im roh-Feld - maschine_id
      -- selbst wird vom Ingest noch nicht aufgeloest, siehe ernte-ingest).
      v_maschine := null;
      if zeile.quelle = 'maschine' then
        select * into v_maschine from ernte_maschine
        where box_seriennummer = (zeile.roh ->> 'box')
        limit 1;

        if v_maschine is null then
          update ernte_scan
          set verarbeitet_am = now(),
              verarbeitung_fehler = 'unbekannte maschine: ' || coalesce(zeile.roh ->> 'box', '?')
          where id = zeile.id;
          continue;
        end if;

        if not v_maschine.aktiv then
          update ernte_scan
          set verarbeitung_fehler = 'maschine inaktiv'
          where id = zeile.id;
          continue;
        end if;
      end if;

      if zeile.ereignis = 'person_login' then
        v_employee_id := null;
        select employee_id into v_employee_id
        from ernte_tag
        where uid = zeile.tag_uid and art = 'person' and aktiv;

        -- Ein-Maschine-Regel: offene Schicht derselben Person an einer
        -- ANDEREN Maschine sofort schliessen (kein manueller Logout noetig).
        if v_employee_id is not null then
          update ernte_schicht
          set ende = zeile.zeitpunkt
          where employee_id = v_employee_id
            and ende is null
            and maschine_id <> v_maschine.id;
        end if;

        select * into v_offene_schicht from ernte_schicht
        where maschine_id = v_maschine.id and ende is null
        order by beginn desc limit 1;

        if v_offene_schicht is null then
          insert into ernte_schicht (maschine_id, employee_id, tag_uid, beginn, quelle)
          values (v_maschine.id, v_employee_id, zeile.tag_uid, zeile.zeitpunkt, 'scan');
        end if;

      elsif zeile.ereignis = 'kiste' then
        -- Bewusst ueber zwei einzelne Skalar-Variablen statt Feldzugriff auf
        -- eine moeglicherweise leere record-Variable - eindeutig statt sich
        -- auf record-NULL-Semantik zu verlassen.
        v_schicht_id := null;
        v_schicht_employee_id := null;
        select id, employee_id into v_schicht_id, v_schicht_employee_id
        from ernte_schicht
        where maschine_id = v_maschine.id and ende is null
        order by beginn desc limit 1;

        -- Juengste bekannte Position dieser Maschine zum Scan-Zeitpunkt ->
        -- Feld. Ohne Poller/Position bleibt feld_id einfach NULL (kein
        -- Fehler, siehe Migrationskopf).
        v_feld_id := null;
        select feld_id into v_feld_id from ernte_position
        where maschine_id = v_maschine.id and zeitpunkt <= zeile.zeitpunkt
        order by zeitpunkt desc limit 1;

        update ernte_kiste_zyklus
        set voll_am = zeile.zeitpunkt, voll_lat = zeile.lat, voll_lng = zeile.lng
        where id = (
          select id from ernte_kiste_zyklus
          where maschine_id = v_maschine.id and status = 'offen'
          order by befuellt_am desc limit 1
        );

        insert into ernte_kiste_zyklus (
          tag_uid, maschine_id, schicht_id, employee_id,
          befuellt_am, befuellt_lat, befuellt_lng, feld_id, status
        ) values (
          zeile.tag_uid, v_maschine.id,
          v_schicht_id, v_schicht_employee_id,
          zeile.zeitpunkt, zeile.lat, zeile.lng, v_feld_id, 'offen'
        );

      elsif zeile.ereignis = 'gewicht' then
        select * into v_offener_zyklus from ernte_kiste_zyklus
        where tag_uid = zeile.tag_uid and status = 'offen'
        order by befuellt_am desc limit 1;

        if v_offener_zyklus is null then
          insert into ernte_kiste_zyklus (
            tag_uid, befuellt_am, gewogen_am, gewicht_brutto_kg, tara_kg, waage_id, status
          ) values (
            zeile.tag_uid, zeile.zeitpunkt, zeile.zeitpunkt,
            zeile.gewicht_kg, tara_standard, zeile.waage_id, 'ungeklaert'
          );
        else
          update ernte_kiste_zyklus
          set gewogen_am = zeile.zeitpunkt,
              gewicht_brutto_kg = zeile.gewicht_kg,
              tara_kg = coalesce(tara_kg, tara_standard),
              waage_id = zeile.waage_id,
              status = 'gewogen'
          where id = v_offener_zyklus.id;
        end if;

      elsif zeile.ereignis = 'batterie' then
        -- v1.1 (ernte_maschine_energie), noch nicht gebaut - Zeile einfach
        -- als verarbeitet markieren, nichts verloren (roh bleibt in
        -- ernte_scan erhalten).
        null;
      end if;

      update ernte_scan
      set verarbeitet_am = now(), verarbeitung_fehler = null
      where id = zeile.id;

    exception when others then
      update ernte_scan set verarbeitung_fehler = sqlerrm where id = zeile.id;
    end;
  end loop;
end;
$$;

grant execute on function ernte_scan_verarbeiten() to authenticated;
