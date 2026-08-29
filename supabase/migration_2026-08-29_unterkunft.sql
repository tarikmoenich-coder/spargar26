-- ============================================================================
-- Migration 2026-08-29: Modul "Unterkunft" (Zimmerverwaltung)
--
-- Nutzer-Vorgabe: Zimmerübergabe/-abnahme per App mit Fotodokumentation,
-- Zwischenkontrollen je Zimmer mit Fotos, Mängelerfassung - bisher lief die
-- Zimmerkontrolle bar/außerhalb der App (siehe Kommentar bei season_bonuses
-- in schema.sql). Fundament davor: Zimmerplanung Gebäude > Zimmer > Bett >
-- Belegung.
--
-- Umfang v1 (abgestimmt 2026-08-29):
--   - keine eigene Rolle: Pflege durch admin + hr (eigene Rolle 'hausmeister'
--     später über getrennte enum-Migration nachziehbar)
--   - Belegung BETTGENAU, Doppelbelegung per EXCLUDE-Constraint verhindert
--   - Unterschrift v1: Name + Haken "Zustand bestätigt" (kein Zeichen-Pad)
--   - Checkliste: Standard-Set als Seed, über die Vorlage später änderbar
--   - "meist online" + Retry: unterkunft_vorgang hat eine client-vergebbare
--     UUID als PK -> idempotenter Upsert, "Abschließen" ist ein 2. Schritt
--
-- Angelehnt an die bestehenden ADR (siehe Kopf von schema.sql):
--   ADR-005 Append-only Audit-Log (Trigger write_audit_log)
--   ADR-006 Rechte serverseitig via RLS
--   ADR-007 Versionierte Vorlage mit "gültig ab"
--   ADR-011 Kein Hard-Delete bei abgeschlossenen Vorgängen - Storno
--
-- In der Supabase SQL-Konsole ausführen. Kein ALTER TYPE, läuft in einem Zug.
-- ============================================================================

-- btree_gist wird für den EXCLUDE-Constraint auf unterkunft_belegung
-- gebraucht (Gleichheit auf bett_id + Überschneidung auf dem Zeitraum in
-- EINEM GiST-Index).
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Stammdaten: Gebäude > Zimmer > Bett
-- ---------------------------------------------------------------------------
create table unterkunft_gebaeude (
  id bigint generated always as identity primary key,
  name text not null unique,
  adresse text,
  notiz text,
  aktiv boolean not null default true,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create table unterkunft_zimmer (
  id bigint generated always as identity primary key,
  gebaeude_id bigint not null references unterkunft_gebaeude (id) on delete restrict,
  nummer text not null,
  etage text,
  -- Soll-Bettenzahl (Planungshinweis) - die tatsächliche Kapazität ergibt
  -- sich aus den angelegten unterkunft_bett-Zeilen.
  bettenzahl int,
  notiz text,
  aktiv boolean not null default true,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (gebaeude_id, nummer)
);

create index idx_unterkunft_zimmer_gebaeude on unterkunft_zimmer (gebaeude_id);

create table unterkunft_bett (
  id bigint generated always as identity primary key,
  zimmer_id bigint not null references unterkunft_zimmer (id) on delete restrict,
  -- z.B. "1", "Bett A", "oben links".
  bezeichnung text not null,
  aktiv boolean not null default true,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  unique (zimmer_id, bezeichnung)
);

create index idx_unterkunft_bett_zimmer on unterkunft_bett (zimmer_id);

-- Legt für ein Zimmer auf einen Schlag N durchnummerierte Betten an
-- (analog erdbeeren_tunnel_sammelanlage). Vorhandene Bezeichnungen werden
-- übersprungen, die Funktion ist gefahrlos wiederholbar.
create or replace function unterkunft_bett_sammelanlage(
  p_zimmer_id bigint,
  p_anzahl int
)
returns int language plpgsql security invoker as $$
declare
  i int;
  angelegt int := 0;
begin
  for i in 1..greatest(p_anzahl, 0) loop
    insert into unterkunft_bett (zimmer_id, bezeichnung)
    values (p_zimmer_id, i::text)
    on conflict (zimmer_id, bezeichnung) do nothing;
    if found then angelegt := angelegt + 1; end if;
  end loop;
  return angelegt;
end;
$$;

grant execute on function unterkunft_bett_sammelanlage(bigint, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Belegung (bettgenau) - wer schläft wann in welchem Bett
-- ---------------------------------------------------------------------------
create table unterkunft_belegung (
  id bigint generated always as identity primary key,
  bett_id bigint not null references unterkunft_bett (id) on delete restrict,
  employee_id uuid not null references employees (id) on delete restrict,
  von date not null,
  -- Offen (noch nicht ausgezogen), solange bis null ist.
  bis date,
  notiz text,
  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  check (bis is null or bis >= von),
  -- Keine zwei überlappenden Belegungen für dasselbe Bett. Offene
  -- Belegungen (bis null) laufen bis 'infinity' und überschneiden sich
  -- daher ebenfalls.
  constraint unterkunft_belegung_kein_doppel exclude using gist (
    bett_id with =,
    daterange(von, coalesce(bis, 'infinity'::date), '[]') with &&
  )
);

create index idx_unterkunft_belegung_bett on unterkunft_belegung (bett_id);
create index idx_unterkunft_belegung_employee on unterkunft_belegung (employee_id);

-- ---------------------------------------------------------------------------
-- 3. Checklisten-Vorlage (versioniert, ADR-007)
-- ---------------------------------------------------------------------------
create table unterkunft_checkliste_vorlage (
  id bigint generated always as identity primary key,
  bereich text not null,
  reihenfolge int not null default 0,
  aktiv boolean not null default true,
  gueltig_ab date not null default current_date,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  unique (bereich, gueltig_ab)
);

insert into unterkunft_checkliste_vorlage (bereich, reihenfolge, gueltig_ab) values
  ('Wände / Decke',      10, date '2026-01-01'),
  ('Boden',              20, date '2026-01-01'),
  ('Fenster',            30, date '2026-01-01'),
  ('Türen',              40, date '2026-01-01'),
  ('Bad / WC',           50, date '2026-01-01'),
  ('Küche',              60, date '2026-01-01'),
  ('Möbel',              70, date '2026-01-01'),
  ('Betten / Matratzen', 80, date '2026-01-01'),
  ('Elektro / Licht',    90, date '2026-01-01'),
  ('Sauberkeit',        100, date '2026-01-01'),
  ('Schlüssel',         110, date '2026-01-01');

-- ---------------------------------------------------------------------------
-- 4. Vorgang (Übergabe / Abnahme / Zwischenkontrolle) + Positionen + Fotos
-- ---------------------------------------------------------------------------
-- PK ist eine UUID, die auch der Client vergeben darf (gen_random_uuid als
-- Vorgabe, falls nicht mitgeschickt). Damit ist das Anlegen ein idempotenter
-- Upsert und "Abschließen" ein separater Schritt - Grundlage für späteres
-- Offline-Nachrüsten ohne Schemaänderung.
create table unterkunft_vorgang (
  id uuid primary key default gen_random_uuid(),
  zimmer_id bigint not null references unterkunft_zimmer (id) on delete restrict,
  -- Optionaler Bezug zur konkreten Belegung (bei Ein-/Auszug).
  belegung_id bigint references unterkunft_belegung (id) on delete set null,
  typ text not null check (typ in ('einzug', 'auszug', 'zwischenkontrolle')),
  durchgefuehrt_von uuid references profiles (id) default auth.uid(),
  durchgefuehrt_am timestamptz not null default now(),
  gesamtzustand text check (
    gesamtzustand is null
    or gesamtzustand in ('gut', 'gebrauchsspuren', 'maengel')
  ),
  notiz text,
  -- v1: Name der anwesenden Person + Haken statt Unterschriften-Pad.
  unterschrift_name text,
  zustand_bestaetigt boolean not null default false,
  abgeschlossen boolean not null default false,
  abgeschlossen_am timestamptz,
  -- Storno statt Löschen (ADR-011) - nur admin, siehe Schutz-Trigger.
  storniert boolean not null default false,
  storno_grund text,
  storniert_von uuid references profiles (id),
  storniert_am timestamptz,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create index idx_unterkunft_vorgang_zimmer on unterkunft_vorgang (zimmer_id);
create index idx_unterkunft_vorgang_belegung on unterkunft_vorgang (belegung_id);

create table unterkunft_vorgang_position (
  id bigint generated always as identity primary key,
  vorgang_id uuid not null references unterkunft_vorgang (id) on delete cascade,
  -- Kopie des Vorlagen-Bereichs zum Zeitpunkt der Erfassung (Text, nicht
  -- FK) - eine spätere Änderung der Vorlage lässt alte Protokolle
  -- unangetastet.
  bereich text not null,
  zustand text not null default 'io' check (zustand in ('io', 'mangel', 'na')),
  bemerkung text,
  unique (vorgang_id, bereich)
);

create index idx_unterkunft_vorgang_position_vorgang
  on unterkunft_vorgang_position (vorgang_id);

create table unterkunft_mangel (
  id bigint generated always as identity primary key,
  zimmer_id bigint not null references unterkunft_zimmer (id) on delete restrict,
  quelle_vorgang_id uuid references unterkunft_vorgang (id) on delete set null,
  beschreibung text not null,
  schwere text not null default 'mittel' check (schwere in ('gering', 'mittel', 'hoch')),
  status text not null default 'offen' check (status in ('offen', 'in_arbeit', 'behoben')),
  gemeldet_von uuid references profiles (id) default auth.uid(),
  gemeldet_am timestamptz not null default now(),
  behoben_von uuid references profiles (id),
  behoben_am timestamptz,
  behebung_notiz text,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create index idx_unterkunft_mangel_zimmer on unterkunft_mangel (zimmer_id);
create index idx_unterkunft_mangel_status on unterkunft_mangel (status);

-- Fotos hängen entweder an einem Vorgang (ggf. an einer Checklisten-Position
-- über "bereich") ODER an einem Mangel.
create table unterkunft_foto (
  id bigint generated always as identity primary key,
  vorgang_id uuid references unterkunft_vorgang (id) on delete cascade,
  mangel_id bigint references unterkunft_mangel (id) on delete cascade,
  bereich text,
  -- Pfad im privaten Bucket "unterkunft-fotos", z.B.
  -- "<zimmer_id>/<vorgang_id>/<uuid>.jpg".
  storage_path text not null unique,
  dateiname text not null,
  breite int,
  hoehe int,
  -- Zeitstempel des Geräts (aus der Datei), rein dokumentierend - maßgeblich
  -- ist hochgeladen_am (Server).
  aufgenommen_am timestamptz,
  hochgeladen_von uuid references profiles (id) default auth.uid(),
  hochgeladen_am timestamptz not null default now(),
  check (vorgang_id is not null or mangel_id is not null)
);

create index idx_unterkunft_foto_vorgang on unterkunft_foto (vorgang_id);
create index idx_unterkunft_foto_mangel on unterkunft_foto (mangel_id);

-- ---------------------------------------------------------------------------
-- 5. Schutz-Trigger: abgeschlossener Vorgang ist append-only (ADR-011)
-- ---------------------------------------------------------------------------
create or replace function unterkunft_vorgang_schutz()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' and old.abgeschlossen then
    raise exception
      'Abgeschlossener Zimmer-Vorgang kann nicht gelöscht werden (Storno statt Löschen).';
  end if;
  if TG_OP = 'UPDATE' and old.abgeschlossen and current_role_name() <> 'admin' then
    raise exception
      'Abgeschlossener Zimmer-Vorgang kann nur von einem Admin geändert (storniert) werden.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_unterkunft_vorgang_schutz
  before update or delete on unterkunft_vorgang
  for each row execute function unterkunft_vorgang_schutz();

-- Positionen und Fotos eines abgeschlossenen Vorgangs sind für alle außer
-- admin gesperrt (Ergänzung/Korrektur nur solange der Vorgang offen ist).
create or replace function unterkunft_vorgang_kind_schutz()
returns trigger language plpgsql as $$
declare
  v_vorgang uuid := coalesce(new.vorgang_id, old.vorgang_id);
begin
  if v_vorgang is not null
     and current_role_name() <> 'admin'
     and exists (
       select 1 from unterkunft_vorgang v
       where v.id = v_vorgang and v.abgeschlossen
     )
  then
    raise exception
      'Der zugehörige Zimmer-Vorgang ist abgeschlossen - Positionen/Fotos sind gesperrt.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_unterkunft_vorgang_position_schutz
  before insert or update or delete on unterkunft_vorgang_position
  for each row execute function unterkunft_vorgang_kind_schutz();

create trigger trg_unterkunft_foto_schutz
  before insert or update or delete on unterkunft_foto
  for each row execute function unterkunft_vorgang_kind_schutz();

-- ---------------------------------------------------------------------------
-- 6. updated_at-Trigger (schlanke Variante, keine version-Spalte)
-- ---------------------------------------------------------------------------
create trigger trg_unterkunft_gebaeude_updated_at before update on unterkunft_gebaeude
  for each row execute function set_updated_at();
create trigger trg_unterkunft_zimmer_updated_at before update on unterkunft_zimmer
  for each row execute function set_updated_at();
create trigger trg_unterkunft_vorgang_updated_at before update on unterkunft_vorgang
  for each row execute function set_updated_at();
create trigger trg_unterkunft_mangel_updated_at before update on unterkunft_mangel
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Audit-Log (ADR-005) - für die lohn-/rechtlich relevanten Vorgänge:
--    Belegung (Grundlage Unterkunftsabzug/Kaution), Vorgang, Mangel.
-- ---------------------------------------------------------------------------
create trigger trg_audit_unterkunft_belegung
  after insert or update or delete on unterkunft_belegung
  for each row execute function write_audit_log();
create trigger trg_audit_unterkunft_vorgang
  after insert or update or delete on unterkunft_vorgang
  for each row execute function write_audit_log();
create trigger trg_audit_unterkunft_mangel
  after insert or update on unterkunft_mangel
  for each row execute function write_audit_log();

-- ---------------------------------------------------------------------------
-- 8. Auswertende Sichten
-- ---------------------------------------------------------------------------
-- Aktuelle Belegung je Bett (heute), mit Personendaten.
create or replace view unterkunft_belegung_aktuell as
select
  b.id,
  b.bett_id,
  bt.zimmer_id,
  b.employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  b.von,
  b.bis,
  b.notiz
from unterkunft_belegung b
join unterkunft_bett bt on bt.id = b.bett_id
join employees e on e.id = b.employee_id
where b.von <= current_date
  and (b.bis is null or b.bis >= current_date);

alter view unterkunft_belegung_aktuell set (security_invoker = true);
grant select on unterkunft_belegung_aktuell to authenticated;

-- Zimmerübersicht für den Belegungsplan: Kapazität, heute belegt/frei,
-- letzte abgeschlossene Kontrolle, Anzahl offener Mängel.
create or replace view unterkunft_zimmer_uebersicht as
select
  z.id as zimmer_id,
  z.nummer,
  z.etage,
  z.aktiv,
  g.id as gebaeude_id,
  g.name as gebaeude_name,
  count(distinct bt.id) filter (where bt.aktiv)::int as betten,
  count(distinct ba.id)::int as belegt,
  (count(distinct bt.id) filter (where bt.aktiv) - count(distinct ba.id))::int as frei,
  lk.letzte_kontrolle_am,
  lk.letzte_kontrolle_typ,
  coalesce(m.offene_maengel, 0)::int as offene_maengel
from unterkunft_zimmer z
join unterkunft_gebaeude g on g.id = z.gebaeude_id
left join unterkunft_bett bt on bt.zimmer_id = z.id
left join unterkunft_belegung ba
  on ba.bett_id = bt.id
  and ba.von <= current_date
  and (ba.bis is null or ba.bis >= current_date)
left join lateral (
  select v.abgeschlossen_am as letzte_kontrolle_am, v.typ as letzte_kontrolle_typ
  from unterkunft_vorgang v
  where v.zimmer_id = z.id and v.abgeschlossen and not v.storniert
  order by v.abgeschlossen_am desc
  limit 1
) lk on true
left join (
  select zimmer_id, count(*) as offene_maengel
  from unterkunft_mangel
  where status <> 'behoben'
  group by zimmer_id
) m on m.zimmer_id = z.id
group by
  z.id, z.nummer, z.etage, z.aktiv, g.id, g.name,
  lk.letzte_kontrolle_am, lk.letzte_kontrolle_typ, m.offene_maengel;

alter view unterkunft_zimmer_uebersicht set (security_invoker = true);
grant select on unterkunft_zimmer_uebersicht to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Row Level Security: lesen alle Angemeldeten, pflegen admin + hr.
--    (Append-only für abgeschlossene Vorgänge über die Schutz-Trigger oben.)
-- ---------------------------------------------------------------------------
alter table unterkunft_gebaeude enable row level security;
alter table unterkunft_zimmer enable row level security;
alter table unterkunft_bett enable row level security;
alter table unterkunft_belegung enable row level security;
alter table unterkunft_checkliste_vorlage enable row level security;
alter table unterkunft_vorgang enable row level security;
alter table unterkunft_vorgang_position enable row level security;
alter table unterkunft_mangel enable row level security;
alter table unterkunft_foto enable row level security;

create policy "unterkunft_gebaeude_select" on unterkunft_gebaeude for select
  using (auth.uid() is not null);
create policy "unterkunft_gebaeude_write" on unterkunft_gebaeude for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create policy "unterkunft_zimmer_select" on unterkunft_zimmer for select
  using (auth.uid() is not null);
create policy "unterkunft_zimmer_write" on unterkunft_zimmer for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create policy "unterkunft_bett_select" on unterkunft_bett for select
  using (auth.uid() is not null);
create policy "unterkunft_bett_write" on unterkunft_bett for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create policy "unterkunft_belegung_select" on unterkunft_belegung for select
  using (auth.uid() is not null);
create policy "unterkunft_belegung_write" on unterkunft_belegung for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create policy "unterkunft_checkliste_vorlage_select" on unterkunft_checkliste_vorlage for select
  using (auth.uid() is not null);
create policy "unterkunft_checkliste_vorlage_write" on unterkunft_checkliste_vorlage for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create policy "unterkunft_vorgang_select" on unterkunft_vorgang for select
  using (auth.uid() is not null);
create policy "unterkunft_vorgang_write" on unterkunft_vorgang for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create policy "unterkunft_vorgang_position_select" on unterkunft_vorgang_position for select
  using (auth.uid() is not null);
create policy "unterkunft_vorgang_position_write" on unterkunft_vorgang_position for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create policy "unterkunft_mangel_select" on unterkunft_mangel for select
  using (auth.uid() is not null);
create policy "unterkunft_mangel_write" on unterkunft_mangel for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

create policy "unterkunft_foto_select" on unterkunft_foto for select
  using (auth.uid() is not null);
create policy "unterkunft_foto_write" on unterkunft_foto for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- ---------------------------------------------------------------------------
-- 10. Privater Storage-Bucket für die Fotos (Zugriff über signierte URLs).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('unterkunft-fotos', 'unterkunft-fotos', false)
on conflict (id) do nothing;

create policy "unterkunft_fotos_storage_admin_hr" on storage.objects for all
  using (bucket_id = 'unterkunft-fotos' and current_role_name() in ('admin', 'hr'))
  with check (bucket_id = 'unterkunft-fotos' and current_role_name() in ('admin', 'hr'));
