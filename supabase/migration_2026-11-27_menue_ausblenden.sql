-- ============================================================================
-- Migration 2026-11-27: Menüpunkte je Nutzer ausblenden.
--
-- Nutzer-Vorgabe 2026-11-27: "Die Möglichkeit etwas sehen zu DÜRFEN bedeutet
-- nicht, dass man es ständig sehen WILL." Jeder Nutzer kann Menüpunkte für
-- sich ausblenden und bei Bedarf (Vertretung) wieder einblenden.
--
-- Reine Anzeige-Einstellung, KEIN Recht: ein ausgeblendeter Menüpunkt bleibt
-- erreichbar. Gespeichert im eigenen Profil (profiles_update_self erlaubt
-- das schon; profiles_schutz sperrt nur Rollen/Bereiche/Aktiv).
--
-- In der Supabase SQL-Konsole ausführen. Idempotent.
-- ============================================================================

alter table public.profiles
  add column if not exists menue_ausgeblendet text[] not null default '{}';
