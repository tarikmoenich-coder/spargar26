-- ============================================================================
-- Migration 2026-08-30: Unterkunft - grafische Zimmerplanung (Grundriss)
--
-- Nutzer-Vorgabe: zweite Planungsebene neben der Gebaeudeliste - ein
-- schematischer Grundriss je Stockwerk, in dem die Zimmer als anklickbare
-- Kacheln liegen (Variante "Vektor-Editor auf Raster", siehe
-- docs/unterkunft-plan.md). Dafuer:
--   1. Etage wird ein eigenes Objekt (bisher nur Freitext auf dem Zimmer) -
--      damit Stockwerke eine feste Reihenfolge/Benennung je Gebaeude haben.
--   2. Zimmer bekommen Rasterkoordinaten plan_x/plan_y (Position) und
--      plan_w/plan_h (Groesse in Rastereinheiten). NULL = noch nicht auf dem
--      Grundriss platziert (liegt in der "Ablage").
--   3. Die Sicht unterkunft_zimmer_uebersicht liefert die neuen Felder mit,
--      damit die Grundriss-Seite alles in einem Query rendern kann.
--
-- Platzieren/Verschieben ist UI-seitig auf admin beschraenkt; die Spalten
-- liegen aber auf unterkunft_zimmer und fallen damit unter dessen bestehende
-- Schreib-Policy (admin + hr).
--
-- Kein ALTER TYPE - laeuft in einem Zug. In der Supabase SQL-Konsole
-- ausfuehren.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Etage als eigenes Stammdatum (Gebaeude > Etage > Zimmer)
-- ---------------------------------------------------------------------------
create table unterkunft_etage (
  id bigint generated always as identity primary key,
  gebaeude_id bigint not null references unterkunft_gebaeude (id) on delete restrict,
  -- Anzeigename, z.B. "Erdgeschoss", "1. OG", "Keller".
  name text not null,
  -- Sortierung von unten nach oben (Keller klein, Dach gross).
  reihenfolge int not null default 0,
  aktiv boolean not null default true,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (gebaeude_id, name)
);
create index idx_unterkunft_etage_gebaeude on unterkunft_etage (gebaeude_id);

create trigger trg_unterkunft_etage_updated_at before update on unterkunft_etage
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Bestandsdaten umziehen: je (Gebaeude, bisheriger etage-Text) eine
--    Etagen-Zeile. Zimmer ohne etage landen auf "Erdgeschoss".
-- ---------------------------------------------------------------------------
insert into unterkunft_etage (gebaeude_id, name, reihenfolge)
select
  s.gebaeude_id,
  coalesce(nullif(btrim(s.etage), ''), 'Erdgeschoss') as name,
  (row_number() over (
    partition by s.gebaeude_id
    order by coalesce(nullif(btrim(s.etage), ''), 'Erdgeschoss')
  )) * 10 as reihenfolge
from (select distinct gebaeude_id, etage from unterkunft_zimmer) s
on conflict (gebaeude_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Zimmer: FK auf Etage + Rasterkoordinaten fuer den Grundriss
-- ---------------------------------------------------------------------------
alter table unterkunft_zimmer
  add column etage_id bigint references unterkunft_etage (id) on delete set null,
  add column plan_x int,
  add column plan_y int,
  add column plan_w int not null default 2,
  add column plan_h int not null default 2;

update unterkunft_zimmer z
set etage_id = e.id
from unterkunft_etage e
where e.gebaeude_id = z.gebaeude_id
  and e.name = coalesce(nullif(btrim(z.etage), ''), 'Erdgeschoss');

create index idx_unterkunft_zimmer_etage on unterkunft_zimmer (etage_id);

-- Die alte Freitext-Spalte unterkunft_zimmer.etage bleibt vorerst bestehen
-- (kein Datenverlust, kein Bruch bestehender Queries). Sie wird von der UI
-- nicht mehr gepflegt und kann in einer spaeteren Migration entfallen.

-- ---------------------------------------------------------------------------
-- 4. RLS fuer die neue Tabelle: lesen alle Angemeldeten, pflegen admin + hr.
-- ---------------------------------------------------------------------------
alter table unterkunft_etage enable row level security;

create policy "unterkunft_etage_select" on unterkunft_etage for select
  using (auth.uid() is not null);
create policy "unterkunft_etage_write" on unterkunft_etage for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- ---------------------------------------------------------------------------
-- 5. Sicht neu aufbauen (Spaltensatz aendert sich) - jetzt inkl. Etage und
--    Grundriss-Koordinaten.
-- ---------------------------------------------------------------------------
drop view if exists unterkunft_zimmer_uebersicht;
create view unterkunft_zimmer_uebersicht as
select
  z.id as zimmer_id,
  z.nummer,
  z.etage,
  z.aktiv,
  z.notiz,
  z.etage_id,
  et.name as etage_name,
  et.reihenfolge as etage_reihenfolge,
  z.plan_x,
  z.plan_y,
  z.plan_w,
  z.plan_h,
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
left join unterkunft_etage et on et.id = z.etage_id
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
  z.id, z.nummer, z.etage, z.aktiv, z.notiz,
  z.etage_id, et.name, et.reihenfolge,
  z.plan_x, z.plan_y, z.plan_w, z.plan_h,
  g.id, g.name,
  lk.letzte_kontrolle_am, lk.letzte_kontrolle_typ, m.offene_maengel;

alter view unterkunft_zimmer_uebersicht set (security_invoker = true);
grant select on unterkunft_zimmer_uebersicht to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Sicht: Belegungen je Person (fuer den Unterkunfts-Block in der Suche) -
--    alle Zeitraeume, mit Gebaeude/Zimmer/Bett.
-- ---------------------------------------------------------------------------
create or replace view unterkunft_belegung_person as
select
  b.id,
  b.employee_id,
  b.von,
  b.bis,
  b.notiz,
  bt.bezeichnung as bett,
  z.id as zimmer_id,
  z.nummer as zimmer_nummer,
  g.id as gebaeude_id,
  g.name as gebaeude_name
from unterkunft_belegung b
join unterkunft_bett bt on bt.id = b.bett_id
join unterkunft_zimmer z on z.id = bt.zimmer_id
join unterkunft_gebaeude g on g.id = z.gebaeude_id;

alter view unterkunft_belegung_person set (security_invoker = true);
grant select on unterkunft_belegung_person to authenticated;
