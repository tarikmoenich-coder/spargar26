-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Fügt verpflegungssaetze.mindestlohn hinzu (versioniert je Saisonjahr, wie
-- Verpflegung/Unterkunft) - dient als Vorbelegung für den Stundenlohn neu
-- angelegter/geplanter Personen.
-- ============================================================================

alter table verpflegungssaetze
  add column mindestlohn numeric(6, 2);
