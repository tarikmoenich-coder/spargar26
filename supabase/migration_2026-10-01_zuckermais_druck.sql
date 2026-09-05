-- Nutzer-Vorgabe: sichtbar machen, ob die Zuckermais-Tagesliste für einen
-- Tag schon gedruckt wurde (Symbol in Prämien-Erfassung + Statistik).
-- Ein Datensatz je Tag, wird bei jedem Klick auf "Tagesliste drucken"
-- überschrieben (letzter Druck zählt - Nachdrucke sind normal, kein Fehler).

create table if not exists zuckermais_druck (
  datum date primary key,
  zuletzt_gedruckt_am timestamptz not null default now(),
  zuletzt_gedruckt_von uuid references profiles (id) default auth.uid()
);

alter table zuckermais_druck enable row level security;

drop policy if exists "zuckermais_druck_select" on zuckermais_druck;
create policy "zuckermais_druck_select" on zuckermais_druck for select
  using (auth.uid() is not null);

-- Gleiche Rollen wie beim Erfassen der Rohdaten selbst (siehe
-- zuckermais_rohdaten_write) - wer die Liste erfassen darf, darf auch
-- vermerken, dass sie gedruckt wurde.
drop policy if exists "zuckermais_druck_write" on zuckermais_druck;
create policy "zuckermais_druck_write" on zuckermais_druck for all
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft'));

grant select, insert, update on zuckermais_druck to authenticated;
