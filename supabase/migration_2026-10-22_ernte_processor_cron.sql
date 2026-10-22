-- ============================================================================
-- Migration 2026-10-22: Erntewirtschaft - Processor automatisch per pg_cron
--
-- Der Processor (ernte_scan_verarbeiten(), migration_2026-10-20_erntewirtschaft_
-- kisten_zyklus.sql) lief bisher bewusst nur manuell - jetzt, nach
-- mehrfach bestandenem manuellem Test mit echten Daten (2026-10-20/21/22),
-- wird er wie im Plan vorgesehen (Teil E, "Processor (pg_cron, jede
-- Minute)") automatisch jede Minute ausgefuehrt.
--
-- cron.schedule() mit benanntem Job ist selbst idempotent: ein erneuter
-- Aufruf mit demselben Namen aktualisiert den bestehenden Job, statt einen
-- zweiten anzulegen.
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

create schema if not exists cron;
create extension if not exists pg_cron with schema cron;

select cron.schedule(
  'ernte-scan-verarbeiten',
  '* * * * *',
  $$ select ernte_scan_verarbeiten(); $$
);
