-- ============================================================================
-- Migration 2026-11-09: Familienstand/Hochzeitsdatum auf die Stammkarte
--
-- Nutzer-Vorgabe 2026-11-09: employees.familienstand/hochzeitsdatum wurden
-- bisher von keiner Stelle im Code beschrieben (nur read-only auf der
-- Personalstammkarte angezeigt), obwohl app/personal-lohnsteuer/antrag/
-- page.tsx das hochzeitsdatum bereits fuer den Finanzamt-Excel-Export
-- (Spalte "verheiratetSeit") liest - die Spalte war damit fuer jede
-- verheiratete Person immer leer. Stattdessen gab es eine unverknuepfte
-- Checkbox (personal_kandidaten.verheiratet_laut_fragebogen) auf der
-- Anreiseliste. Ab jetzt schreibt die Anreiseliste direkt in employees,
-- da der employees-Datensatz zu dem Zeitpunkt schon existiert (wird bei
-- "Anreise vorbereiten" angelegt, siehe app/personalplanung/page.tsx).
-- ============================================================================

-- Gleiche vier Werte wie doppelte_haushaltsfuehrung.familienstand. Unkritisch,
-- da die Spalte aktuell durchgehend null ist.
alter table employees
  add constraint employees_familienstand_check
  check (familienstand in ('verheiratet', 'ledig', 'verwitwet', 'geschieden_getrennt'));

-- personal_kandidaten.verheiratet_laut_fragebogen wird ab jetzt von keinem
-- Code mehr gelesen/beschrieben - bleibt als Spalte bestehen (keine Loeschung
-- alter Daten), kann spaeter in einer eigenen Migration entfernt werden.
create or replace view personal_kandidaten_checkliste as
select
  k.id as kandidat_id,
  k.aktivierter_employee_id as employee_id,
  k.gedruckt,
  k.fragebogen_erfasst,
  k.buskosten_erfasst,
  exists (
    select 1 from employee_documents d
    where d.employee_id = k.aktivierter_employee_id
      and d.kategorie = 'Ausweiskopie'
  ) as ausweiskopie_vorhanden,
  (
    k.fuehrerschein_kategorien is null
    or array_length(k.fuehrerschein_kategorien, 1) is null
    or exists (
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Führerschein Kopie'
    )
  ) as fuehrerschein_erfuellt,
  (
    coalesce(e.familienstand = 'verheiratet', false) = false
    or exists (
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Hochzeitsurkunde'
    )
  ) as hochzeitsurkunde_erfuellt,
  (
    k.lohnsteuerabzug_antrag_gewuenscht = false
    or exists (
      select 1 from doppelte_haushaltsfuehrung d
      where d.employee_id = k.aktivierter_employee_id
        and d.saison_jahr = extract(year from k.geplante_ankunft)::int
        and d.familienstand is not null
    )
  ) as lohnsteuerabzug_erfuellt,
  exists (
    select 1 from sv_fragebogen f
    where f.employee_id = k.aktivierter_employee_id
      and f.saison_jahr = extract(year from k.geplante_ankunft)::int
  ) as sv_fragebogen_erfasst,
  coalesce(
    (
      select fa.bestanden
      from sv_fragebogen_auswertung fa
      where fa.employee_id = k.aktivierter_employee_id
        and fa.saison_jahr = extract(year from k.geplante_ankunft)::int
    ),
    false
  ) as sv_fragebogen_bestanden,
  coalesce(
    (
      select fa.unvollstaendig_fehlerhaft
      from sv_fragebogen_auswertung fa
      where fa.employee_id = k.aktivierter_employee_id
        and fa.saison_jahr = extract(year from k.geplante_ankunft)::int
    ),
    false
  ) as sv_fragebogen_unvollstaendig_fehlerhaft
from personal_kandidaten k
left join employees e on e.id = k.aktivierter_employee_id
where k.status = 'anreiseliste';

alter view personal_kandidaten_checkliste set (security_invoker = true);
grant select on personal_kandidaten_checkliste to authenticated;
