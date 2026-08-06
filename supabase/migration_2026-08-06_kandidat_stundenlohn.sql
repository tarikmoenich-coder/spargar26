-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Voraussetzung: migration_2026-08-06_personalplanung.sql wurde bereits
-- ausgeführt (fügt personal_kandidaten hinzu).
-- Ergänzt personal_kandidaten um stundenlohn - wird für den Platzhalter
-- «Stundenlohn» im generierten Arbeitsvertrag gebraucht (vor der
-- Aktivierung gibt es noch keinen employees.stundenlohn, den man ziehen
-- könnte).
-- ============================================================================

alter table personal_kandidaten
  add column stundenlohn numeric(10, 2);
