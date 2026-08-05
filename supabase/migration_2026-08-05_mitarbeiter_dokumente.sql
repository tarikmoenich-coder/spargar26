-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Dokumenten-Upload je Mitarbeiter (z.B. Hochzeitsurkunde, Ausweiskopie).
-- Feste Kategorie-Liste (Nutzer-Vorgabe) - muss synchron mit
-- lib/types.ts DOKUMENT_KATEGORIEN gehalten werden. Zugriff wie bei
-- anderen sensiblen Personaldaten (SV-Nr., IBAN) nur admin/hr.
-- ============================================================================

create table employee_documents (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  kategorie text not null check (kategorie in (
    'Hochzeitsurkunde',
    'Ausweiskopie',
    'Führerschein Kopie',
    'Arbeitsvertrag',
    'Werks- und Mietvertrag',
    'Formular "Doppelte Haushaltsführung"',
    'Formular zur Feststellung der Versicherungspflicht',
    'Sonstiges'
  )),
  dateiname text not null,
  -- Pfad im Storage-Bucket "mitarbeiter-dokumente", z.B.
  -- "<employee_id>/<zeitstempel>_<dateiname>".
  storage_path text not null unique,
  hochgeladen_von uuid references profiles (id),
  hochgeladen_am timestamptz not null default now()
);

create index idx_employee_documents_employee on employee_documents (employee_id);

create trigger trg_audit_employee_documents
  after insert or update or delete on employee_documents
  for each row execute function write_audit_log();

alter table employee_documents enable row level security;

create policy "employee_documents_admin_hr_all" on employee_documents for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- Privater Storage-Bucket für die eigentlichen Dateien (kein öffentlicher
-- Zugriff - Downloads laufen über zeitlich begrenzte signierte URLs).
insert into storage.buckets (id, name, public)
values ('mitarbeiter-dokumente', 'mitarbeiter-dokumente', false)
on conflict (id) do nothing;

create policy "mitarbeiter_dokumente_storage_admin_hr" on storage.objects for all
  using (bucket_id = 'mitarbeiter-dokumente' and current_role_name() in ('admin', 'hr'))
  with check (bucket_id = 'mitarbeiter-dokumente' and current_role_name() in ('admin', 'hr'));
