-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Neues Feld "Übergeben an" bei Vorschüssen (z.B. Gruppenleiter, der das
-- Geld zur Verteilung an die einzelnen Empfänger bekommt) - erscheint auf
-- dem separaten Übergabe-Beleg beim Drucken.
-- ============================================================================

alter table advances add column uebergeben_an text;
