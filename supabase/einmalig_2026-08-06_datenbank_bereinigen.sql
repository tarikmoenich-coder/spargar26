-- ============================================================================
-- EINMALIGE, NICHT UMKEHRBARE BEREINIGUNG - im Supabase SQL Editor ausführen.
-- Leert alle operativen/importierten Daten (Personal, Stunden, Vorschüsse,
-- Kassenbuch, Dokumente-Einträge, Abrechnungen, Audit-Log), damit alles neu
-- importiert werden kann. BLEIBT ERHALTEN: Login-Zugänge (profiles) und
-- Einstellungen (arbeitsgruppen, herkuenfte, verpflegungssaetze inkl.
-- Mindestlohn, kassenpruefung_einstellungen).
--
-- WICHTIG: Bevor du das ausführst - bist du sicher? Das kann NICHT rückgängig
-- gemacht werden. Danach zusätzlich manuell im Supabase-Dashboard unter
-- "Storage" → Bucket "mitarbeiter-dokumente" alle Dateien löschen (das kann
-- dieses SQL-Skript nicht erledigen).
-- ============================================================================

truncate table
  audit_log,
  cash_checks,
  cash_deposits,
  kassenbewegungen,
  advance_recipients,
  advances,
  season_bonuses,
  auszahlungsbelege,
  beleg_zaehler,
  periods,
  work_entries,
  personal_kandidaten,
  employee_documents,
  employees
cascade;
