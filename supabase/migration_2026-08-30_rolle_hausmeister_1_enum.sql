-- Neue Rolle "hausmeister" (Nutzer-Vorgabe 2026-08-30): sieht ausschliesslich
-- das Modul "Unterkunft" (+ Suche) und darf dort die laufende Arbeit erledigen
-- - Belegung, Uebergabe/Abnahme, Zwischenkontrolle, Maengel, Fotos. Die
-- Stammdaten (Gebaeude/Zimmer/Betten/Checkliste) bleiben admin/hr vorbehalten,
-- ebenso das Platzieren der Zimmer im Grundriss (nur admin, UI-seitig).
--
-- WICHTIG: dieser Schritt MUSS separat ausgefuehrt und committet werden, BEVOR
-- migration_2026-08-30_rolle_hausmeister_2_policies.sql laeuft - Postgres
-- erlaubt es nicht, einen frisch hinzugefuegten Enum-Wert in derselben
-- Transaktion zu verwenden (current_role_name() gibt user_role zurueck, ein
-- Vergleich mit 'hausmeister' braucht also einen Cast auf den Enum-Typ - das
-- wuerde sonst mit "unsafe use of new value of enum type" fehlschlagen). Im
-- Supabase SQL Editor: diese Datei allein ausfuehren, erst danach Teil 2 in
-- einem neuen Lauf. (Gleiches Vorgehen wie bei 'erntewirtschaft', siehe
-- migration_2026-08-09_rolle_erntewirtschaft_1_enum.sql.)

alter type user_role add value 'hausmeister';
