-- Migration 2026-09-20: drei nicht mehr genutzte Sichten entfernen.
--
-- Aufräumen (Nutzer-Vorgabe 2026-09-20): keine dieser Sichten wird von der
-- App noch abgefragt.
--   - employee_letzte_aenderung: früher die Spalte "Zuletzt geändert" im
--     Personalstamm (seit dem Umbau 2026-09-16 entfernt); die Sicht las bei
--     jedem Laden für admin den Änderungsverlauf (audit_log) aus.
--   - qs_kontrolle_tag: Tagesaggregat der Schichtkontrolle, wird nirgends
--     verwendet (die Statistik rechnet selbst).
--   - employees_public: abgespeckte Mitarbeiter-Sicht, seit der Umstellung
--     auf employees_read_for_logged_in nicht mehr angesprochen.
-- Bei Bedarf lassen sich alle drei aus dem Git-Verlauf von schema.sql (vor
-- diesem Commit) wieder anlegen.
drop view if exists employee_letzte_aenderung;
drop view if exists qs_kontrolle_tag;
drop view if exists employees_public;
