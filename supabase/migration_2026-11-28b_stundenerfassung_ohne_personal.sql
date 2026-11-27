-- ============================================================================
-- Migration 2026-11-28b: Startrolle Stundenerfassung ohne "Personalstamm lesen".
--
-- Das Recht stand im Katalog-Entwurf, wird von der Datenbank aber nicht
-- gebraucht (Mitarbeiterfotos sieht die Rolle über "Ernte & Überblick") und
-- würde in der neuen App den Menüpunkt Personal einblenden, den die Rolle
-- bisher nicht hatte. Namen sieht sie weiterhin über die Grundausstattung.
-- Rechte der Nutzer werden per Trigger sofort neu berechnet.
-- ============================================================================

update public.rolle
set rechte = rechte - 'personal.stamm'
where id = 'zeiterfassung' and rechte ? 'personal.stamm';
