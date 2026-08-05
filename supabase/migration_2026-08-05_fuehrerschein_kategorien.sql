-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Führerschein-Klassen (B, BE, C, CE) beim Hochladen einer "Führerschein
-- Kopie" erfassen und breit sichtbar machen (Personal, Stundenerfassung,
-- Lohnübersicht) - ohne die eigentlichen Dokumente breiter zugänglich zu
-- machen (employee_documents bleibt admin/hr-only).
-- ============================================================================

alter table employee_documents
  add column fuehrerschein_kategorien text[]
    check (fuehrerschein_kategorien is null
      or fuehrerschein_kategorien <@ array['B', 'BE', 'C', 'CE']);

create or replace view employee_fuehrerschein_kategorien as
select distinct on (employee_id)
  employee_id,
  fuehrerschein_kategorien,
  hochgeladen_am
from employee_documents
where kategorie = 'Führerschein Kopie' and fuehrerschein_kategorien is not null
order by employee_id, hochgeladen_am desc;

grant select on employee_fuehrerschein_kategorien to authenticated;
