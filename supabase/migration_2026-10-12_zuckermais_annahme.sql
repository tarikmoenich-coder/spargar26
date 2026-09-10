-- Digitale Strichliste / Nacharbeitsquote Zuckermais-Halle
-- (Nutzer-Vorgabe 2026-09-10): Entscheidend ist die an der Kistenannahme
-- gefuehrte Akkord-Strichliste - je Person und Schicht wie viele Kisten
-- i.O. angenommen und wie viele in die Nacharbeit gegangen sind. Das Papier-
-- A3-Blatt (druckbar unter /praemien/zuckermais/strichliste) bleibt das
-- Live-Arbeitsblatt; hier kommt am Schichtende nur die Summe je Person rein
-- ("Summen am Schichtende eintippen").
--
-- Konsequenz-Modell bewusst NICHT enthalten - erstmal nur Anzeige in
-- /statistik/zuckermais. Die daraus abgeleitete Naharbeitsquote je Person
-- soll eine Saison lang beobachtet und kalibriert werden, bevor sie an die
-- Praemie gekoppelt wird.
--
-- Re-runnable: create table if not exists / create or replace view /
-- drop policy/trigger if exists.

create table if not exists zuckermais_annahme (
  id bigint generated always as identity primary key,
  datum date not null default current_date,
  -- Vor-/Nachmittag wie auf dem Papierblatt (je Halbschicht ein Blatt).
  schicht text not null check (schicht in ('vormittag', 'nachmittag')),
  employee_id uuid not null references employees (id) on delete restrict,
  -- Angenommene Kisten (Summe der Kreuze der Person auf dem Blatt).
  kisten_io int not null default 0 check (kisten_io >= 0),
  -- Kisten dieser Person, die in die Nacharbeit gingen.
  kisten_nacharbeit int not null default 0 check (kisten_nacharbeit >= 0),
  notiz text,
  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Eine Zeile je Person und Halbschicht - erneutes Speichern aktualisiert.
  constraint zuckermais_annahme_uniq unique (datum, schicht, employee_id)
);

create index if not exists idx_zuckermais_annahme_datum
  on zuckermais_annahme (datum desc, schicht);

-- Je Zeile die Nacharbeitsquote in % (Nacharbeit / alle Kisten der Person).
-- NULL, wenn die Person in der Schicht gar keine Kisten hatte.
create or replace view zuckermais_annahme_quote as
select
  a.*,
  (a.kisten_io + a.kisten_nacharbeit) as kisten_gesamt,
  case
    when (a.kisten_io + a.kisten_nacharbeit) > 0
    then round(
      a.kisten_nacharbeit::numeric
        / (a.kisten_io + a.kisten_nacharbeit) * 100,
      1
    )
  end as nacharbeit_prozent,
  e.name as employee_name,
  e.vorname as employee_vorname,
  e.personal_nr
from zuckermais_annahme a
join employees e on e.id = a.employee_id;

alter view zuckermais_annahme_quote set (security_invoker = true);
grant select on zuckermais_annahme_quote to authenticated;

-- Tagesaggregat je Person (fuer die Statistik-Tabelle mit Zeitraumfilter
-- summiert die App selbst weiter).
create or replace view zuckermais_annahme_person_tag as
select
  datum,
  employee_id,
  min(e.name) as employee_name,
  min(e.vorname) as employee_vorname,
  min(e.personal_nr) as personal_nr,
  sum(kisten_io)::int as kisten_io,
  sum(kisten_nacharbeit)::int as kisten_nacharbeit,
  sum(kisten_io + kisten_nacharbeit)::int as kisten_gesamt,
  case
    when sum(kisten_io + kisten_nacharbeit) > 0
    then round(
      sum(kisten_nacharbeit)::numeric
        / sum(kisten_io + kisten_nacharbeit) * 100,
      1
    )
  end as nacharbeit_prozent
from zuckermais_annahme a
join employees e on e.id = a.employee_id
group by datum, employee_id;

alter view zuckermais_annahme_person_tag set (security_invoker = true);
grant select on zuckermais_annahme_person_tag to authenticated;

-- updated_at pflegen (generische Funktion, existiert bereits).
drop trigger if exists trg_zuckermais_annahme_updated_at on zuckermais_annahme;
create trigger trg_zuckermais_annahme_updated_at before update on zuckermais_annahme
  for each row execute function set_updated_at();

-- Aenderungsprotokoll.
drop trigger if exists trg_audit_zuckermais_annahme on zuckermais_annahme;
create trigger trg_audit_zuckermais_annahme
  after insert or update or delete on zuckermais_annahme
  for each row execute function write_audit_log();

-- RLS analog qs_kontrolle: lesen alle Angemeldeten (Statistik); erfassen/
-- aendern admin/hr/zeiterfassung/erntewirtschaft; loeschen admin/hr/
-- erntewirtschaft.
alter table zuckermais_annahme enable row level security;

drop policy if exists "zuckermais_annahme_select" on zuckermais_annahme;
create policy "zuckermais_annahme_select" on zuckermais_annahme for select
  using (auth.uid() is not null);

drop policy if exists "zuckermais_annahme_insert" on zuckermais_annahme;
create policy "zuckermais_annahme_insert" on zuckermais_annahme for insert
  with check (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
  );

drop policy if exists "zuckermais_annahme_update" on zuckermais_annahme;
create policy "zuckermais_annahme_update" on zuckermais_annahme for update
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
  );

drop policy if exists "zuckermais_annahme_delete" on zuckermais_annahme;
create policy "zuckermais_annahme_delete" on zuckermais_annahme for delete
  using (current_role_name() in ('admin', 'hr', 'erntewirtschaft'));
