-- ============================================================================
-- Migration 2026-09-09: Schlüssel bei Übergabe / Abnahme erfassen
--
-- Bei einer Einzugs-Übergabe wird per Dropdown erfasst, wie viele Schlüssel
-- herausgegeben wurden; bei der Auszugs-Abnahme wird dieser Wert angezeigt
-- und die Zahl der zurückgegebenen Schlüssel erfasst.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

alter table unterkunft_vorgang
  add column if not exists schluessel_ausgegeben int,
  add column if not exists schluessel_zurueck int;
