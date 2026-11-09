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
--
-- WICHTIG (42P16): CREATE OR REPLACE VIEW erlaubt nur neue Spalten am Ende,
-- keine Aenderung der Reihenfolge und kein Entfernen - die bestehenden
-- Spalten (inkl. des zuletzt per migration_2026-10-26_schulungsliste_
-- pruefpunkt.sql angehaengten schulungsliste_erfuellt) bleiben deshalb 1:1
-- erhalten, nur hochzeitsurkunde_erfuellt bekommt eine neue Bedingung + der
-- employees-Join wird ergaenzt.
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
  ) as sv_fragebogen_unvollstaendig_fehlerhaft,
  exists (
    select 1 from schulung_teilnahme s
    where s.employee_id = k.aktivierter_employee_id
  ) as schulungsliste_erfuellt
from personal_kandidaten k
left join employees e on e.id = k.aktivierter_employee_id
where k.status = 'anreiseliste';

alter view personal_kandidaten_checkliste set (security_invoker = true);
grant select on personal_kandidaten_checkliste to authenticated;

-- anreiseliste_offen_arbeitend (Controlling-Sicht, app/management/
-- anreiseliste): gleiche Umstellung auf employees.familienstand. DROP +
-- CREATE wie beim letzten Umbau dieser Sicht (gleicher 42P16-Grund,
-- Spaltenreihenfolge dadurch wieder frei).
drop view if exists anreiseliste_offen_arbeitend;

create view anreiseliste_offen_arbeitend as
select
  k.id as kandidat_id,
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.herkunft,
  e.aktiv,
  w.erster_arbeitstag,
  w.letzter_arbeitstag,
  (current_date - w.erster_arbeitstag) as tage_seit_arbeitsbeginn,
  not k.gedruckt as arbeitsvertrag_fehlt,
  not coalesce(
    (
      select sv_fragebogen_bestanden(f)
      from sv_fragebogen f
      where f.employee_id = e.id
        and f.saison_jahr = extract(year from w.erster_arbeitstag)::int
    ),
    false
  ) as sv_fragebogen_offen,
  not k.buskosten_erfasst as buskosten_fehlen,
  not exists (
    select 1 from employee_documents d
    where d.employee_id = e.id and d.kategorie = 'Ausweiskopie'
  ) as ausweiskopie_fehlt,
  (
    k.fuehrerschein_kategorien is not null
    and array_length(k.fuehrerschein_kategorien, 1) is not null
    and not exists (
      select 1 from employee_documents d
      where d.employee_id = e.id and d.kategorie = 'Führerschein Kopie'
    )
  ) as fuehrerschein_fehlt,
  (
    coalesce(e.familienstand = 'verheiratet', false)
    and not exists (
      select 1 from employee_documents d
      where d.employee_id = e.id and d.kategorie = 'Hochzeitsurkunde'
    )
  ) as hochzeitsurkunde_fehlt,
  (
    k.lohnsteuerabzug_antrag_gewuenscht
    and not exists (
      select 1 from doppelte_haushaltsfuehrung d
      where d.employee_id = e.id
        and d.saison_jahr = extract(year from w.erster_arbeitstag)::int
        and d.familienstand is not null
    )
  ) as dhh_angaben_fehlen,
  not exists (
    select 1 from schulung_teilnahme s where s.employee_id = e.id
  ) as schulungsliste_fehlt
from personal_kandidaten k
join employees e on e.id = k.aktivierter_employee_id
join lateral (
  select
    min(we.datum) as erster_arbeitstag,
    max(we.datum) as letzter_arbeitstag
  from work_entries we
  where we.employee_id = e.id
    and (we.stunden > 0 or we.markierung is not null)
) w on true
where k.status = 'anreiseliste'
  and w.erster_arbeitstag is not null;

grant select on anreiseliste_offen_arbeitend to authenticated;
