-- Neue Rolle "erntewirtschaft" (Nutzer-Vorgabe 2026-08-09): nur Zugriff
-- auf Prämien (Erfassung) und Statistik, sonst nichts - eigener
-- Arbeitsbereich wie zeiterfassung bei der Stundenerfassung.
--
-- WICHTIG: dieser Schritt MUSS separat ausgeführt und committet werden,
-- bevor migration_2026-08-09_rolle_erntewirtschaft_2_policies.sql läuft -
-- Postgres erlaubt es nicht, einen frisch hinzugefügten Enum-Wert in
-- derselben Transaktion zu verwenden (current_role_name() gibt user_role
-- zurück, ein Vergleich mit 'erntewirtschaft' braucht also einen Cast auf
-- den Enum-Typ - das würde sonst mit "unsafe use of new value of enum
-- type" fehlschlagen). Im Supabase SQL Editor: diese Datei allein
-- ausführen, erst danach Teil 2 in einem neuen Lauf.

alter type user_role add value 'erntewirtschaft';
