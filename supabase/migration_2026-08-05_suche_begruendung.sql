-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Begründung bei Vorschüssen in der "employee_vorschuss_historie"-View
-- (Basis der "Suche"-Seite) mit aufnehmen - Nutzer-Vorgabe: muss dort
-- zwingend sichtbar sein, ist kein Datenschutzrisiko mehr wert als die
-- Kenntnis des Betrags selbst.
-- ============================================================================

create or replace view employee_vorschuss_historie as
select
  ar.employee_id,
  a.datum,
  ar.anteil as betrag,
  a.zahlungsart,
  a.begruendung,
  a.storniert
from advance_recipients ar
join advances a on a.id = ar.advance_id;

grant select on employee_vorschuss_historie to authenticated;
