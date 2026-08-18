-- Migration 2026-08-14: Überweisung bei Vorschüssen - IBAN/BIC Pflicht
--
-- Drei Nutzer-Vorgaben zusammen umgesetzt:
--
-- 1. Die zweite Druckseite ("Vorschuss-Übergabe") wird nur noch gedruckt,
--    wenn "Übergeben an" tatsächlich ausgefüllt ist (reine Frontend-
--    Änderung, hier ohne SQL-Anteil).
--
-- 2. Zahlungsart-Code "AZ" (stand für "Auszahlung", war bei Vorschüssen
--    verwirrend) heißt ab jetzt "BÜ" (Überweisung) - bestehende Belege mit
--    "AZ" bleiben unverändert (korrekte Historie), nur neue Erfassungen
--    nutzen den neuen Code.
--
-- 3. Bei Zahlungsart "BÜ" sind Zahlungsempfänger, IBAN und BIC je
--    Empfänger jetzt Pflichtangaben (aus den Personalstammdaten
--    vorbefüllt, änderbar) und erscheinen auf dem Belegdruck - dafür drei
--    neue Spalten auf advance_recipients, als Schnappschuss zum
--    Erfassungszeitpunkt (nicht live aus employees gelesen).
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

alter table advance_recipients add column zahlungsempfaenger text;
alter table advance_recipients add column iban text;
alter table advance_recipients add column bic text;
