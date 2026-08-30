-- ============================================================================
-- Migration 2026-08-31: Unterkunft - Wohneinheit-Ebene + schwebende Belegung
--
-- Nutzer-Vorgaben (2026-08-31, siehe docs/unterkunft-plan.md):
--   1. Neue Ebene "Wohneinheit" (= mehrere Zimmer + gemeinsam Bad/Kueche)
--      zwischen Gebaeude und Zimmer. Ersetzt unterkunft_etage - die Etage
--      wird nur noch ein Text-Label auf der Wohneinheit + Umschalter in der
--      UI. Kaum Daten vorhanden, daher wird unterkunft_etage hier abgebaut.
--   2. Zwei Belegungs-Zustaende:
--      - schwebend: geplante Zuordnung Person -> Wohneinheit (optional schon
--        Zimmer), noch KEINE Uebergabe. Neue Tabelle unterkunft_zuordnung.
--      - fest: Zimmeruebergabe abgeschlossen -> daraus entsteht die
--        bettgenaue unterkunft_belegung (unveraendert), die Zuordnung wird
--        'erledigt'.
--   3. Zuordnung nur ZIMMERGENAU (kein Bett - das faellt erst bei der
--      Uebergabe).
--   4. "Belegung planen" (Zuordnung anlegen/umplanen): nur admin + hr.
--      hausmeister darf eine Zuordnung nur abschliessen/stornieren.
--
-- Kein ALTER TYPE - laeuft in einem Zug. In der Supabase SQL-Konsole
-- ausfuehren.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Wohneinheit + FK am Zimmer, Bestandsdaten aus unterkunft_etage ziehen
-- ---------------------------------------------------------------------------
create table unterkunft_wohneinheit (
  id bigint generated always as identity primary key,
  gebaeude_id bigint not null references unterkunft_gebaeude (id) on delete restrict,
  name text not null,
  -- Freitext-Etikett fuer den Etagen-Umschalter, z.B. "EG", "1. OG".
  etage_label text,
  reihenfolge int not null default 0,
  aktiv boolean not null default true,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (gebaeude_id, name)
);
create index idx_unterkunft_wohneinheit_gebaeude on unterkunft_wohneinheit (gebaeude_id);
create trigger trg_unterkunft_wohneinheit_updated_at before update on unterkunft_wohneinheit
  for each row execute function set_updated_at();

alter table unterkunft_zimmer
  add column wohneinheit_id bigint references unterkunft_wohneinheit (id) on delete set null;
create index idx_unterkunft_zimmer_wohneinheit on unterkunft_zimmer (wohneinheit_id);

-- Je bisheriger Etage eine Wohneinheit gleichen Namens (Etage-Label = Name).
insert into unterkunft_wohneinheit (gebaeude_id, name, etage_label, reihenfolge)
select gebaeude_id, name, name, reihenfolge
from unterkunft_etage
on conflict (gebaeude_id, name) do nothing;

update unterkunft_zimmer z
set wohneinheit_id = w.id
from unterkunft_etage e
join unterkunft_wohneinheit w
  on w.gebaeude_id = e.gebaeude_id and w.name = e.name
where z.etage_id = e.id;

-- unterkunft_etage abbauen (die Sicht haengt an etage_id -> zuerst weg,
-- unten neu aufgebaut).
drop view if exists unterkunft_zimmer_uebersicht;
alter table unterkunft_zimmer drop column etage_id;
drop table unterkunft_etage;

alter table unterkunft_wohneinheit enable row level security;
create policy "unterkunft_wohneinheit_select" on unterkunft_wohneinheit for select
  using (auth.uid() is not null);
create policy "unterkunft_wohneinheit_write" on unterkunft_wohneinheit for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- ---------------------------------------------------------------------------
-- 2. Schwebende Belegungsplanung
-- ---------------------------------------------------------------------------
create table unterkunft_zuordnung (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  wohneinheit_id bigint not null references unterkunft_wohneinheit (id) on delete restrict,
  -- optional schon ein Zimmer (kein Bett - Nutzer-Vorgabe: nur zimmergenau)
  zimmer_id bigint references unterkunft_zimmer (id) on delete set null,
  geplant_ab date not null default current_date,
  status text not null default 'schwebend'
    check (status in ('schwebend', 'erledigt', 'storniert')),
  notiz text,
  -- beim Uebergang auf 'erledigt' gesetzt (durch die Zimmeruebergabe)
  belegung_id bigint references unterkunft_belegung (id) on delete set null,
  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);
create index idx_unterkunft_zuordnung_employee on unterkunft_zuordnung (employee_id);
create index idx_unterkunft_zuordnung_wohneinheit on unterkunft_zuordnung (wohneinheit_id);
create index idx_unterkunft_zuordnung_zimmer on unterkunft_zuordnung (zimmer_id);
-- Hoechstens eine offene (schwebende) Zuordnung je Person.
create unique index uq_unterkunft_zuordnung_offen
  on unterkunft_zuordnung (employee_id) where status = 'schwebend';

create trigger trg_unterkunft_zuordnung_updated_at before update on unterkunft_zuordnung
  for each row execute function set_updated_at();
create trigger trg_audit_unterkunft_zuordnung
  after insert or update on unterkunft_zuordnung
  for each row execute function write_audit_log();

alter table unterkunft_zuordnung enable row level security;
create policy "unterkunft_zuordnung_select" on unterkunft_zuordnung for select
  using (auth.uid() is not null);
create policy "unterkunft_zuordnung_write" on unterkunft_zuordnung for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
-- hausmeister darf eine Zuordnung NUR abschliessen/stornieren (im Rahmen der
-- Uebergabe), nicht anlegen oder umplanen.
create policy "unterkunft_zuordnung_hausmeister_abschluss" on unterkunft_zuordnung for update
  using (current_role_name() = 'hausmeister')
  with check (current_role_name() = 'hausmeister' and status in ('erledigt', 'storniert'));

-- ---------------------------------------------------------------------------
-- 3. Sichten neu / erweitert
-- ---------------------------------------------------------------------------

-- 3a. Zimmerübersicht (jetzt mit Wohneinheit + Anzahl schwebender Zuordnungen)
create view unterkunft_zimmer_uebersicht as
select
  z.id as zimmer_id,
  z.nummer,
  z.aktiv,
  z.notiz,
  z.wohneinheit_id,
  w.name as wohneinheit_name,
  w.etage_label,
  w.reihenfolge as wohneinheit_reihenfolge,
  z.plan_x, z.plan_y, z.plan_w, z.plan_h,
  g.id as gebaeude_id,
  g.name as gebaeude_name,
  count(distinct bt.id) filter (where bt.aktiv)::int as betten,
  count(distinct ba.id)::int as belegt,
  (count(distinct bt.id) filter (where bt.aktiv) - count(distinct ba.id))::int as frei,
  coalesce(zu.schwebend, 0)::int as schwebend,
  lk.letzte_kontrolle_am,
  lk.letzte_kontrolle_typ,
  coalesce(m.offene_maengel, 0)::int as offene_maengel
from unterkunft_zimmer z
join unterkunft_gebaeude g on g.id = z.gebaeude_id
left join unterkunft_wohneinheit w on w.id = z.wohneinheit_id
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
left join (
  select zimmer_id, count(*) as schwebend
  from unterkunft_zuordnung
  where status = 'schwebend' and zimmer_id is not null
  group by zimmer_id
) zu on zu.zimmer_id = z.id
group by
  z.id, z.nummer, z.aktiv, z.notiz,
  z.wohneinheit_id, w.name, w.etage_label, w.reihenfolge,
  z.plan_x, z.plan_y, z.plan_w, z.plan_h,
  g.id, g.name,
  zu.schwebend,
  lk.letzte_kontrolle_am, lk.letzte_kontrolle_typ, m.offene_maengel;

alter view unterkunft_zimmer_uebersicht set (security_invoker = true);
grant select on unterkunft_zimmer_uebersicht to authenticated;

-- 3b. Wohneinheit-Übersicht (Karten): Betten, fest belegt, schwebend, frei
create view unterkunft_wohneinheit_uebersicht as
select
  w.id as wohneinheit_id,
  w.name,
  w.etage_label,
  w.reihenfolge,
  w.aktiv,
  g.id as gebaeude_id,
  g.name as gebaeude_name,
  count(distinct z.id) filter (where z.aktiv)::int as zimmer,
  count(distinct bt.id)::int as betten,
  count(distinct ba.id)::int as fest,
  coalesce(zu.schwebend, 0)::int as schwebend,
  (count(distinct bt.id) - count(distinct ba.id))::int as frei
from unterkunft_wohneinheit w
join unterkunft_gebaeude g on g.id = w.gebaeude_id
left join unterkunft_zimmer z on z.wohneinheit_id = w.id and z.aktiv
left join unterkunft_bett bt on bt.zimmer_id = z.id and bt.aktiv
left join unterkunft_belegung ba
  on ba.bett_id = bt.id
  and ba.von <= current_date
  and (ba.bis is null or ba.bis >= current_date)
left join (
  select wohneinheit_id, count(*) as schwebend
  from unterkunft_zuordnung
  where status = 'schwebend'
  group by wohneinheit_id
) zu on zu.wohneinheit_id = w.id
group by w.id, w.name, w.etage_label, w.reihenfolge, w.aktiv, g.id, g.name, zu.schwebend;

alter view unterkunft_wohneinheit_uebersicht set (security_invoker = true);
grant select on unterkunft_wohneinheit_uebersicht to authenticated;

-- 3c. Schwebende Zuordnungen mit Person + Herkunft + geplantem Zimmer
create view unterkunft_zuordnung_offen as
select
  zu.id,
  zu.employee_id,
  zu.wohneinheit_id,
  zu.zimmer_id,
  zu.geplant_ab,
  zu.notiz,
  e.personal_nr,
  e.name,
  e.vorname,
  e.herkunft,
  w.name as wohneinheit_name,
  w.etage_label,
  w.gebaeude_id,
  g.name as gebaeude_name,
  z.nummer as zimmer_nummer
from unterkunft_zuordnung zu
join employees e on e.id = zu.employee_id
join unterkunft_wohneinheit w on w.id = zu.wohneinheit_id
join unterkunft_gebaeude g on g.id = w.gebaeude_id
left join unterkunft_zimmer z on z.id = zu.zimmer_id
where zu.status = 'schwebend';

alter view unterkunft_zuordnung_offen set (security_invoker = true);
grant select on unterkunft_zuordnung_offen to authenticated;

-- 3d. Personen ohne Bleibe: aktive Mitarbeiter ohne laufende Belegung UND
--     ohne schwebende Zuordnung (Ausgangsliste fuer "Belegung planen").
--     geplante_ankunft / Anreiselisten-Flag aus personal_kandidaten, falls
--     verknuepft.
create view unterkunft_person_offen as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.herkunft,
  k.geplante_ankunft,
  (k.status = 'anreiseliste') as auf_anreiseliste
from employees e
left join personal_kandidaten k
  on k.aktivierter_employee_id = e.id and k.status = 'anreiseliste'
where e.aktiv
  and not exists (
    select 1 from unterkunft_zuordnung zu
    where zu.employee_id = e.id and zu.status = 'schwebend'
  )
  and not exists (
    select 1
    from unterkunft_belegung b
    where b.employee_id = e.id
      and b.von <= current_date
      and (b.bis is null or b.bis >= current_date)
  );

alter view unterkunft_person_offen set (security_invoker = true);
grant select on unterkunft_person_offen to authenticated;

-- 3e. unterkunft_belegung_aktuell / _person um Herkunft (+ Wohneinheit).
--     drop+create statt "create or replace" (Spalten kommen in der Mitte dazu).
drop view if exists unterkunft_belegung_aktuell;
create view unterkunft_belegung_aktuell as
select
  b.id, b.bett_id, bt.zimmer_id, z.wohneinheit_id,
  b.employee_id,
  e.personal_nr, e.name, e.vorname, e.herkunft,
  b.von, b.bis, b.notiz
from unterkunft_belegung b
join unterkunft_bett bt on bt.id = b.bett_id
join unterkunft_zimmer z on z.id = bt.zimmer_id
join employees e on e.id = b.employee_id
where b.von <= current_date
  and (b.bis is null or b.bis >= current_date);
alter view unterkunft_belegung_aktuell set (security_invoker = true);
grant select on unterkunft_belegung_aktuell to authenticated;

drop view if exists unterkunft_belegung_person;
create view unterkunft_belegung_person as
select
  b.id, b.employee_id, b.von, b.bis, b.notiz,
  bt.bezeichnung as bett,
  z.id as zimmer_id, z.nummer as zimmer_nummer, z.wohneinheit_id,
  w.name as wohneinheit_name,
  g.id as gebaeude_id, g.name as gebaeude_name
from unterkunft_belegung b
join unterkunft_bett bt on bt.id = b.bett_id
join unterkunft_zimmer z on z.id = bt.zimmer_id
left join unterkunft_wohneinheit w on w.id = z.wohneinheit_id
join unterkunft_gebaeude g on g.id = z.gebaeude_id;
alter view unterkunft_belegung_person set (security_invoker = true);
grant select on unterkunft_belegung_person to authenticated;
