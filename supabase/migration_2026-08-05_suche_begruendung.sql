-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Begründung bei Vorschüssen in der "employee_vorschuss_historie"-View
-- (Basis der "Suche"-Seite) mit aufnehmen - Nutzer-Vorgabe: muss dort
-- zwingend sichtbar sein, ist kein Datenschutzrisiko mehr wert als die
-- Kenntnis des Betrags selbst.
-- ============================================================================

-- Achtung: CREATE OR REPLACE VIEW darf bestehende Spalten weder umbenennen
-- noch ihre Reihenfolge ändern - neue Spalten müssen ans Ende. Deshalb
-- steht "begruendung" hier hinter "storniert" statt davor.
create or replace view employee_vorschuss_historie as
select
  ar.employee_id,
  a.datum,
  ar.anteil as betrag,
  a.zahlungsart,
  a.storniert,
  a.begruendung
from advance_recipients ar
join advances a on a.id = ar.advance_id;

grant select on employee_vorschuss_historie to authenticated;
