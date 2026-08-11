-- Migration 2026-08-11: Lohnsteuer-Status statt Ja/Nein "Antrag gestellt"
--
-- Nutzer-Vorgabe: eigene Seite "Personal -> Lohnsteuer" (analog zur Seite
-- "Sozialversicherung"). Der bisherige Ja/Nein-Wert "Antrag gestellt" wird
-- durch einen vierstufigen Verfahrensstand ersetzt:
--   kein_antrag       - noch kein Antrag beim Finanzamt gestellt
--   antrag_gestellt   - Antrag gestellt, Bescheid steht aus
--   freibetrag_erteilt- Finanzamt hat den Freibetrag erteilt
--   kein_freibetrag   - Finanzamt hat abgelehnt / kein Freibetrag
--
-- WICHTIG (Nutzer-Klarstellung): das Ausfuellen des Formulars "Doppelte
-- Haushaltsfuehrung" ist NOCH KEIN gestellter Antrag - das Formular ist nur
-- der Nachweis des eigenen Hausstands im Heimatland. Der Status wird daher
-- immer manuell gesetzt, nie automatisch abgeleitet.
--
-- In der Supabase SQL-Konsole ausfuehren. Enthaelt einen Spalten-Drop am
-- Ende (antrag_gestellt) - die Daten werden vorher in den neuen Status
-- ueberfuehrt, siehe Schritt 2.

-- 1) Neue Status-Spalte
alter table doppelte_haushaltsfuehrung
  add column if not exists lohnsteuer_status text not null default 'kein_antrag';

-- 2) Bestehende Ja/Nein-Werte in den neuen Status ueberfuehren, BEVOR die
-- alte Spalte entfernt wird (nur ausfuehren, solange die alte Spalte noch
-- existiert - macht die Migration wiederholbar).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'doppelte_haushaltsfuehrung'
      and column_name = 'antrag_gestellt'
  ) then
    execute $sql$
      update doppelte_haushaltsfuehrung
      set lohnsteuer_status = case
        when antrag_gestellt then 'antrag_gestellt'
        else 'kein_antrag'
      end
    $sql$;
  end if;
end $$;

-- 3) Pruefregel erst jetzt setzen (nach der Datenueberfuehrung, damit kein
-- Altbestand die Regel verletzt).
alter table doppelte_haushaltsfuehrung
  drop constraint if exists doppelte_haushaltsfuehrung_lohnsteuer_status_check;
alter table doppelte_haushaltsfuehrung
  add constraint doppelte_haushaltsfuehrung_lohnsteuer_status_check check (
    lohnsteuer_status in (
      'kein_antrag', 'antrag_gestellt', 'freibetrag_erteilt', 'kein_freibetrag'
    )
  );

-- 4) Alte Spalte entfernen - der Status oben ist ab jetzt die einzige
-- Wahrheit (zwei parallele Felder waeren eine Fehlerquelle).
alter table doppelte_haushaltsfuehrung drop column if exists antrag_gestellt;
