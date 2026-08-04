-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Macht "Herkunft" zu einer festen, gepflegten Liste (wie Arbeitsgruppen)
-- statt Freitext, damit "nach Herkunft auswählen/filtern" bei Vorschüssen
-- zuverlässig funktioniert.
-- ============================================================================

create table herkuenfte (
  wert text primary key,
  reihenfolge int not null default 0,
  created_at timestamptz not null default now()
);

-- Bereits vorhandene Herkunft-Werte aus dem Personalstamm übernehmen (z.B.
-- aus einem früheren Import), damit die FK-Verknüpfung unten nicht scheitert.
insert into herkuenfte (wert)
select distinct herkunft
from employees
where herkunft is not null and trim(herkunft) <> ''
on conflict (wert) do nothing;

alter table employees
  add constraint employees_herkunft_fkey
  foreign key (herkunft) references herkuenfte (wert)
  on update cascade on delete set null;

alter table herkuenfte enable row level security;

create policy "herkuenfte_select" on herkuenfte for select
  using (auth.uid() is not null);
create policy "herkuenfte_admin_write" on herkuenfte for all
  using (is_admin()) with check (is_admin());
