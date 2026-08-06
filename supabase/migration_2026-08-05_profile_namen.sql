-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Schmale, breit zugängliche Sicht auf Benutzer-Namen (nur id + full_name),
-- damit z.B. der "Bearbeiter" bei Kassenbewegungen für alle sichtbaren
-- Rollen korrekt angezeigt wird, nicht nur für admin bzw. die handelnde
-- Person selbst (profiles_select erlaubt nur die eigene Zeile).
-- ============================================================================

create or replace view profile_namen as
select id, full_name from profiles;

grant select on profile_namen to authenticated;
