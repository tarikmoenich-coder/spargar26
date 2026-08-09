-- DRINGENDER FIX (2026-08-09-Vorfall): die vorherige Migration
-- (migration_2026-08-09_praemien_gruppenaufteilung.sql) hat den Spalten-
-- Grant auf employees erweitert - dabei ist erstmals wirksam geworden,
-- dass "select *" in Postgres SELECT-Recht auf ALLE Spalten der Tabelle
-- braucht. Da die Grant-Liste dort nie alle Spalten enthielt, führte das
-- zu 403 Forbidden für JEDE "select *"-Abfrage auf employees, für ALLE
-- Rollen inkl. admin/hr (Personal-Seite komplett gesperrt).
--
-- Fix: volle SELECT-Berechtigung auf Tabellenebene statt einer
-- Spaltenliste. Die für zeiterfassung/erntewirtschaft erreichbaren Seiten
-- wurden separat so angepasst, dass sie nie "select *" auf employees
-- nutzen, sondern gezielt nur die benötigten (unsensiblen) Spalten
-- abfragen - der Schutz von SV-Nr./Steuer-ID/IBAN/BIC läuft also über die
-- Abfragen selbst, nicht mehr über einen Datenbank-Grant.

grant select on employees to authenticated;
