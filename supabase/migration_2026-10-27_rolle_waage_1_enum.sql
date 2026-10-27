-- Neue Rolle "waage" (Nutzer-Vorgabe 2026-10-27): ausschliesslich fuer den
-- Kiosk-Bildschirm am Waagen-PC (app/erntewirtschaft/waage/kiosk) - sieht
-- sonst nichts (kein Dashboard, keine Admin-Rohdatenuebersicht
-- /erntewirtschaft/waage mit den einzelnen Scan-Zeilen, kein anderes Modul).
--
-- WICHTIG: dieser Schritt MUSS separat ausgefuehrt und committet werden, BEVOR
-- migration_2026-10-27_rolle_waage_2_policies.sql laeuft - Postgres erlaubt
-- es nicht, einen frisch hinzugefuegten Enum-Wert in derselben Transaktion
-- zu verwenden (current_role_name() gibt user_role zurueck, ein Vergleich
-- mit 'waage' wuerde sonst mit "unsafe use of new value of enum type"
-- fehlschlagen). Im Supabase SQL Editor: diese Datei allein ausfuehren, erst
-- danach Teil 2 in einem neuen Lauf. (Gleiches Vorgehen wie bei
-- 'hausmeister'/'erntewirtschaft', siehe migration_2026-08-30_rolle_
-- hausmeister_1_enum.sql.)

alter type user_role add value 'waage';
