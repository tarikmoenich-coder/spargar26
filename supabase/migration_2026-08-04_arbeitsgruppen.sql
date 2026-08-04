-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Ergänzt Arbeitsgruppen (z.B. "Sortierer", "Träger", "Schälmannschaft") für
-- die Gruppierung auf der Stundenerfassung und die gedruckten
-- Gruppenstundenzettel.
-- ============================================================================

create table arbeitsgruppen (
  gruppe_nr text primary key,
  bezeichnung text not null,
  reihenfolge int not null default 0,
  created_at timestamptz not null default now()
);

alter table employees
  add constraint employees_gruppe_nr_fkey
  foreign key (gruppe_nr) references arbeitsgruppen (gruppe_nr)
  on update cascade on delete set null;

alter table arbeitsgruppen enable row level security;

create policy "arbeitsgruppen_select" on arbeitsgruppen for select
  using (auth.uid() is not null);
create policy "arbeitsgruppen_admin_write" on arbeitsgruppen for all
  using (is_admin()) with check (is_admin());
