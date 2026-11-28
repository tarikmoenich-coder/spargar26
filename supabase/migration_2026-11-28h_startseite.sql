-- ============================================================================
-- Migration 2026-11-28h: Startseite selbst gestalten (docs/startseite-kacheln-plan.md).
--
-- Je Nutzer die gewählte Größe jeder Startseiten-Kachel:
--   {"kasse": "G", "protokoll": "aus"} - fehlend = Mittel.
-- Reine Anzeige, kein Recht; jeder ändert nur sein eigenes Profil
-- (profiles_update_self; profiles_schutz sperrt nur Rollen/Bereiche/Aktiv).
-- In der Supabase SQL-Konsole ausführen. Idempotent.
-- ============================================================================

alter table public.profiles
  add column if not exists startseite jsonb not null default '{}';
