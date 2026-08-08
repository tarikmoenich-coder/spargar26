-- Verknüpft die Anreiseliste mit dem echten SV-Fragebogen (Nutzer-Vorgabe
-- 2026-08-08): löst das alte manuelle "Fragebogen erfasst"-Häkchen als
-- Vollständigkeits-Kriterium ab. Kein eigenes Saison-Jahr-Feld auf
-- personal_kandidaten - Jahr wird aus dem geplanten Ankunftsdatum
-- abgeleitet.

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
    coalesce(k.verheiratet_laut_fragebogen, false) = false
    or exists (
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Hochzeitsurkunde'
    )
  ) as hochzeitsurkunde_erfuellt,
  (
    k.lohnsteuerabzug_antrag_gewuenscht = false
    or exists (
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Formular "Doppelte Haushaltsführung"'
    )
  ) as lohnsteuerabzug_erfuellt,
  -- Neue Spalten ans Ende angehängt (nicht dazwischen!) - "create or
  -- replace view" erlaubt nur das Anhängen neuer Spalten am Ende, sonst
  -- Fehler 42P16 "cannot change name of view column".
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
  ) as sv_fragebogen_bestanden
from personal_kandidaten k
where k.status = 'anreiseliste';

alter view personal_kandidaten_checkliste set (security_invoker = true);
grant select on personal_kandidaten_checkliste to authenticated;
