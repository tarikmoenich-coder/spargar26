-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Monatsabschluss: Monatsfilter/-ansicht in der Lohnübersicht (Stunden,
-- Anwesenheitstage, Basis-Brutto, Verpflegung/Unterkunft je Monat) +
-- Sperren/Wiederöffnen einzelner Monate (periods-Tabelle, bisher im
-- Schema vorbereitet, aber nie ans Frontend angebunden).
-- ============================================================================

-- 1) periods: Felder fürs Wiederöffnen (Pflichtgrund, wie bei Storno/
--    Vorschuss-Korrektur) ---------------------------------------------------

alter table periods
  add column entsperrt_von uuid references profiles (id) default auth.uid(),
  add column entsperrt_am timestamptz,
  add column entsperrt_grund text;

-- default auth.uid() auch fürs bereits bestehende gesperrt_von nachrüsten.
alter table periods alter column gesperrt_von set default auth.uid();

create trigger trg_audit_periods
  after insert or update on periods
  for each row execute function write_audit_log();

-- 2) Neue View: Monats-Stunden/-Brutto/-Verpflegung je Mitarbeiter --------
--    (bewusst getrennt von season_summary - siehe Kommentar in schema.sql)

create or replace view season_summary_monat as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.gruppe_nr,
  e.aktiv,
  extract(year from we.datum)::int as saison_jahr,
  extract(month from we.datum)::int as monat,
  sum(coalesce(we.stunden, 0) + (case when we.markierung = 'U' then 8 else 0 end)) as gesamt_stunden,
  count(*) filter (where we.stunden is not null or we.markierung is not null) as anwesenheitstage,
  max(we.datum) filter (where we.stunden is not null or we.markierung is not null) as letzter_eintrag,
  (sum(coalesce(we.stunden, 0) + (case when we.markierung = 'U' then 8 else 0 end))
    * coalesce(e.stundenlohn, 0)) as basis_brutto,
  coalesce(v.verpflegung, 0)
    * count(*) filter (where we.stunden is not null or we.markierung is not null)
    as abzug_verpflegung,
  coalesce(v.wohnen, 0)
    * count(*) filter (where we.stunden is not null or we.markierung is not null)
    as abzug_wohnen
from employees e
join work_entries we on we.employee_id = e.id
left join verpflegungssaetze v on v.saison_jahr = extract(year from we.datum)::int
group by
  e.id, e.personal_nr, e.name, e.vorname, e.gruppe_nr, e.aktiv,
  extract(year from we.datum), extract(month from we.datum),
  v.verpflegung, v.wohnen;

grant select on season_summary_monat to authenticated;

-- 3) work_entries: Schreiben in gesperrtem Monat blockieren ---------------

drop policy "work_entries_write" on work_entries;
create policy "work_entries_write" on work_entries for insert
  with check (
    current_role_name() in ('admin', 'zeiterfassung', 'hr')
    and not exists (
      select 1 from periods p
      where p.saison_jahr = extract(year from datum)::int
        and p.monat = extract(month from datum)::int
        and p.gesperrt = true
    )
  );

drop policy "work_entries_update" on work_entries;
create policy "work_entries_update" on work_entries for update
  using (
    current_role_name() in ('admin', 'zeiterfassung', 'hr')
    and not exists (
      select 1 from periods p
      where p.saison_jahr = extract(year from datum)::int
        and p.monat = extract(month from datum)::int
        and p.gesperrt = true
    )
  );

-- 4) periods: admin UND hr dürfen sperren/entsperren (bisher nur admin) --

drop policy "periods_admin_write" on periods;
create policy "periods_write" on periods for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
