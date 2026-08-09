-- Teil 2 (NACH migration_2026-08-09_rolle_erntewirtschaft_1_enum.sql, in
-- einem eigenen Lauf): erntewirtschaft darf Zuckermais-Prämien-Rohdaten
-- schreiben, wie zeiterfassung/admin/hr. Lesen (zuckermais_rohdaten,
-- zuckermais_saetze, zuckermais_praemie_tag, zuckermais_statistik_tag,
-- employees, arbeitsgruppen) war schon vorher für alle eingeloggten
-- Rollen offen - keine weitere Änderung nötig.

drop policy if exists "zuckermais_rohdaten_write" on zuckermais_rohdaten;
create policy "zuckermais_rohdaten_write" on zuckermais_rohdaten for insert
  with check (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft'));

drop policy if exists "zuckermais_rohdaten_update" on zuckermais_rohdaten;
create policy "zuckermais_rohdaten_update" on zuckermais_rohdaten for update
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft'));
