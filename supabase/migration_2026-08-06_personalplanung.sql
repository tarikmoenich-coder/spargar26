-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Personalplanung: Schwarze-Liste-Flag auf employees + neue Tabelle
-- personal_kandidaten für Personen VOR der Aktivierung (Anreise), mit
-- reservierter (aber noch nicht final vergebener) Personalnummer.
-- ============================================================================

-- 1) employees: Schwarze-Liste-Flag -----------------------------------------

alter table employees
  add column schwarze_liste boolean not null default false,
  add column schwarze_liste_grund text,
  add column schwarze_liste_von uuid references profiles (id),
  add column schwarze_liste_am timestamptz;

-- 2) Neue Tabelle: Kandidaten vor der Aktivierung ---------------------------

create table personal_kandidaten (
  id uuid primary key default gen_random_uuid(),
  personal_nr text not null unique,
  name text not null,
  vorname text not null,
  geburtsdatum date,
  nationalitaet text,
  herkunft text references herkuenfte (wert)
    on update cascade on delete set null,
  verknuepfter_employee_id uuid references employees (id) on delete set null,
  arbeitsbeginn_datum date,
  arbeitsende_datum date,
  geplante_ankunft date,
  status text not null default 'geplant'
    check (status in ('geplant', 'angereist', 'storniert')),
  storniert_grund text,
  notiz text,
  aktivierter_employee_id uuid references employees (id) on delete set null,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create index idx_personal_kandidaten_status on personal_kandidaten (status);

-- 3) Trigger: Audit-Log + updated_at/version (nutzt bestehende Funktionen) --

create trigger trg_audit_personal_kandidaten
  after insert or update on personal_kandidaten
  for each row execute function write_audit_log();

create trigger trg_personal_kandidaten_updated_at before update on personal_kandidaten
  for each row execute function set_updated_at_and_version();

-- 4) RLS: wie employees nur admin/hr -----------------------------------------

alter table personal_kandidaten enable row level security;

create policy "personal_kandidaten_admin_hr_all" on personal_kandidaten for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
