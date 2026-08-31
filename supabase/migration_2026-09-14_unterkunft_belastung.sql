-- ============================================================================
-- Migration 2026-09-14: Belastungen aus Reparaturen (Vorschlag → Bestätigung)
--
-- Aus dem Reparaturen-Board wird je verschuldendem Bewohner ein
-- Belastungs-Vorschlag (anteilige Reparaturkosten) erzeugt. Auf der
-- Vorschüsse-Seite bestätigt admin/kasse den Vorschlag: dann entsteht ein
-- echter Vorschuss (advances, art 'Strafe/Rechnung') und der Betrag wird vom
-- Lohn abgezogen. Bis dahin passiert nichts.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

create table if not exists unterkunft_belastung (
  id bigint generated always as identity primary key,
  mangel_id bigint not null references unterkunft_mangel (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete restrict,
  betrag numeric(10, 2) not null check (betrag > 0),
  status text not null default 'offen'
    check (status in ('offen', 'bestaetigt', 'abgelehnt')),
  -- Gesetzt, sobald bestätigt: der daraus erzeugte Vorschuss.
  advance_id bigint references advances (id) on delete set null,
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  bestaetigt_von uuid references profiles (id),
  bestaetigt_am timestamptz,
  updated_at timestamptz not null default now(),
  unique (mangel_id, employee_id)
);
create index if not exists idx_unterkunft_belastung_mangel
  on unterkunft_belastung (mangel_id);
create index if not exists idx_unterkunft_belastung_status
  on unterkunft_belastung (status);

drop trigger if exists trg_unterkunft_belastung_updated_at on unterkunft_belastung;
create trigger trg_unterkunft_belastung_updated_at
  before update on unterkunft_belastung
  for each row execute function set_updated_at();

alter table unterkunft_belastung enable row level security;

drop policy if exists "unterkunft_belastung_select" on unterkunft_belastung;
create policy "unterkunft_belastung_select" on unterkunft_belastung for select
  using (
    current_role_name() in (
      'admin', 'hr', 'hausmeister', 'kasse', 'lohnabrechnung',
      'pruefer', 'management'
    )
  );

-- Vorschlag anlegen / zurücknehmen: Unterkunft-Rollen.
drop policy if exists "unterkunft_belastung_insert" on unterkunft_belastung;
create policy "unterkunft_belastung_insert" on unterkunft_belastung for insert
  with check (current_role_name() in ('admin', 'hr', 'hausmeister'));
drop policy if exists "unterkunft_belastung_delete" on unterkunft_belastung;
create policy "unterkunft_belastung_delete" on unterkunft_belastung for delete
  using (current_role_name() in ('admin', 'hr', 'hausmeister'));

-- Bestätigen / ablehnen: wie beim Vorschuss selbst (admin/kasse), plus hr.
drop policy if exists "unterkunft_belastung_update" on unterkunft_belastung;
create policy "unterkunft_belastung_update" on unterkunft_belastung for update
  using (current_role_name() in ('admin', 'hr', 'kasse'))
  with check (current_role_name() in ('admin', 'hr', 'kasse'));
