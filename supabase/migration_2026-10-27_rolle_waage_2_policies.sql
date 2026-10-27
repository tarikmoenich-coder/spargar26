-- Teil 2 (NACH migration_2026-10-27_rolle_waage_1_enum.sql, in einem
-- eigenen Lauf): 'waage' bekommt NUR lesenden Zugriff auf genau das, was der
-- Kiosk braucht (app/erntewirtschaft/waage/kiosk/page.tsx).
--
-- Die Sicht ernte_kiosk_wiegung (security_invoker, migration_2026-10-26_
-- ernte_kiosk.sql) joint ernte_kiste_zyklus + feld + spargel_sorte +
-- employees. feld/spargel_sorte/employees sind bereits fuer jeden
-- eingeloggten Nutzer lesbar (auth.uid() is not null) - nur
-- ernte_kiste_zyklus selbst (+ das Mitarbeiterfoto-Storage-Bucket fuer das
-- Foto im Kiosk) sind bisher auf admin/hr/management/erntewirtschaft/
-- zeiterfassung beschraenkt und muessen um 'waage' erweitert werden
-- (betrifft auch die Realtime-Subscription der Kiosk-Seite, die dieselbe
-- RLS-Policy prueft).
--
-- BEWUSST NICHT erweitert: ernte_scan/ernte_waage (die rohe Admin-Uebersicht
-- /erntewirtschaft/waage) und kein anderes Modul - 'waage' soll
-- ausschliesslich den Kiosk sehen.

drop policy if exists "ernte_kiste_zyklus_select" on ernte_kiste_zyklus;
create policy "ernte_kiste_zyklus_select" on ernte_kiste_zyklus for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung', 'waage'));

-- Mitarbeiterfoto-Bucket: bisher eine kombinierte for-all-Policy nur fuer
-- admin/hr (fuer den Ausweis-Druck gedacht, migration_2026-10-22_
-- mitarbeiter_foto.sql) - der Kiosk braucht daneben lesenden Zugriff
-- (signierte URL) fuer dieselben Rollen wie ernte_kiste_zyklus_select oben.
-- Gleiches Vorgehen wie beim Unterkunft-Fotos-Bucket (migration_2026-08-30_
-- rolle_hausmeister_2_policies.sql): select getrennt von write.
drop policy if exists "mitarbeiter_fotos_storage_admin_hr" on storage.objects;

create policy "mitarbeiter_fotos_storage_select" on storage.objects for select
  using (
    bucket_id = 'mitarbeiter-fotos'
    and current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung', 'waage')
  );

create policy "mitarbeiter_fotos_storage_write" on storage.objects for all
  using (bucket_id = 'mitarbeiter-fotos' and current_role_name() in ('admin', 'hr'))
  with check (bucket_id = 'mitarbeiter-fotos' and current_role_name() in ('admin', 'hr'));
