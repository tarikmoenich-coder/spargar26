-- Migration 2026-08-19: Bugfix - "Anwender" fehlte im Kassenbuch bei
-- Vorschüssen (und, bisher unbemerkt, bei Einzahlungen)
--
-- advances.bearbeiter_id und cash_deposits.bearbeiter_id hatten - anders
-- als z.B. auszahlungsbelege.erstellt_von oder kautionsuebergaben.erstellt_von
-- - keinen "default auth.uid()" und wurden auch nirgends im Frontend
-- explizit gesetzt. Dadurch blieb die Spalte bei jedem neuen Vorschuss/
-- jeder neuen Einzahlung leer, während Auszahlungen und Kautionsübergaben
-- korrekt einen Bearbeiter zeigten (siehe "Bewegungen seit letzter
-- Prüfung" auf der Kasse-Seite).
--
-- WICHTIG: gilt nur für NEUE Zeilen ab jetzt - bereits bestehende
-- Vorschüsse/Einzahlungen bleiben ohne Anwender (lässt sich nachträglich
-- nicht mehr ermitteln).
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

alter table advances
  alter column bearbeiter_id set default auth.uid();

alter table cash_deposits
  alter column bearbeiter_id set default auth.uid();
