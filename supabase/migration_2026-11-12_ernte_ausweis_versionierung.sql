-- ============================================================================
-- Migration 2026-11-12: Versionsnummer für Mitarbeiterausweise
-- (app/erntewirtschaft/ausweise) - "vG.D": G = Generation (startet bei 1,
-- +1 bei jeder Verlust-Karte/Suffix-Rotation), D = der wievielte Druck
-- innerhalb der aktuellen Generation (startet bei 1 bei Ausstellung/
-- Verlust-Karte, +1 bei jedem "Erneut drucken" derselben Karte).
--
-- Nutzer-Vorgabe 2026-11-12: "1. Karte, 1. Druck = v1.1. Nach 'Karte
-- erneut drucken': v1.2 usw. Wird eine Ersatzkarte gedruckt: v2.1" - damit
-- jederzeit (auf der Karte selbst UND in der App) erkennbar ist, wie oft
-- eine Karte gedruckt und wie oft eine Verlust-Karte vergeben wurde.
--
-- generation/letzter_druck_nr auf ernte_ausweis selbst (schnelle Anzeige in
-- der Liste, kein Aggregat nötig) + eigene Protokoll-Tabelle
-- ernte_ausweis_druck (volle Historie je Druckvorgang, inkl. Grund).
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

alter table ernte_ausweis add column if not exists generation smallint not null default 1;
alter table ernte_ausweis add column if not exists letzter_druck_nr smallint not null default 1;

create table if not exists ernte_ausweis_druck (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  generation smallint not null,
  druck_nr smallint not null,
  grund text not null check (grund in ('neu', 'erneut', 'verlust')),
  gedruckt_am timestamptz not null default now(),
  gedruckt_von uuid references profiles (id) default auth.uid()
);

create index if not exists ernte_ausweis_druck_employee_idx
  on ernte_ausweis_druck (employee_id, generation);

alter table ernte_ausweis_druck enable row level security;

-- Gleiches Muster wie ernte_ausweis selbst - nur admin/hr.
drop policy if exists "ernte_ausweis_druck_admin_hr_all" on ernte_ausweis_druck;
create policy "ernte_ausweis_druck_admin_hr_all" on ernte_ausweis_druck for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

grant select, insert, update, delete on ernte_ausweis_druck to authenticated;
