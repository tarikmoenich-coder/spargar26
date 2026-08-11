-- Migration 2026-08-11: Fach-Formulare nicht mehr als Datei-Upload
--
-- Nutzer-Vorgabe: "Bitte das Formular Doppelte Haushaltsfuehrung und
-- Formular Versicherungspflicht als Dokument Upload entfernen. Wir werden
-- das doch nicht hochladen. ... Diese Dokumente sollen nur noch ueber die
-- Eingabemaske abgefragt werden und damit als 'vollstaendig' in der
-- Anreiseliste markiert werden."
--
-- Beide Kategorien fallen damit weg. Die Anreiseliste-Checkliste prueft ab
-- jetzt die ERFASSTEN ANGABEN statt eines hochgeladenen Dokuments:
-- lohnsteuerabzug_erfuellt ist erfuellt, sobald auf "Personal -> Lohnsteuer"
-- der Familienstand erfasst ist (die Kernangabe des Formulars). Beim
-- SV-Fragebogen war das schon vorher so - der prueft ohnehin die Tabelle
-- sv_fragebogen, nie ein Dokument.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

-- 1) Sicherheitsnetz: falls doch schon Dateien in diesen Kategorien liegen,
-- bricht die Migration mit klarer Meldung ab, statt am CHECK-Constraint zu
-- scheitern. Dann bitte zuerst klaeren, was mit den Dateien passieren soll.
do $$
declare
  v_anzahl int;
begin
  select count(*) into v_anzahl
  from employee_documents
  where kategorie in (
    'Formular "Doppelte Haushaltsführung"',
    'Formular zur Feststellung der Versicherungspflicht'
  );
  if v_anzahl > 0 then
    raise exception 'Es liegen noch % Datei(en) in den zu entfernenden Kategorien. Bitte zuerst klaeren, ob diese geloescht werden sollen - danach diese Migration erneut ausfuehren.', v_anzahl;
  end if;
end $$;

-- 2) Kategorien aus der Pruefregel entfernen
alter table employee_documents
  drop constraint if exists employee_documents_kategorie_check;
alter table employee_documents
  add constraint employee_documents_kategorie_check check (kategorie in (
    'Hochzeitsurkunde',
    'Ausweiskopie',
    'Führerschein Kopie',
    'Arbeitsvertrag',
    'Werks- und Mietvertrag',
    'Sonstiges'
  ));

-- 3) Anreiseliste-Checkliste: lohnsteuerabzug_erfuellt prueft jetzt die
-- erfassten Angaben. Nur der Ausdruck aendert sich, Spaltenname und
-- -position bleiben - daher "create or replace view" unproblematisch.
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
  -- Prüft seit 2026-08-11 die ERFASSTEN ANGABEN statt eines hochgeladenen
  -- Formulars (Nutzer-Vorgabe: "Diese Dokumente sollen nur noch über die
  -- Eingabemaske abgefragt werden ... ein Dateiupload ist nicht mehr
  -- notwendig"). Erfüllt, sobald auf "Personal → Lohnsteuer" der
  -- Familienstand erfasst ist - das ist die Kernangabe des Formulars.
  (
    k.lohnsteuerabzug_antrag_gewuenscht = false
    or exists (
      select 1 from doppelte_haushaltsfuehrung d
      where d.employee_id = k.aktivierter_employee_id
        and d.saison_jahr = extract(year from k.geplante_ankunft)::int
        and d.familienstand is not null
    )
  ) as lohnsteuerabzug_erfuellt,
  -- SV-Fragebogen (Nutzer-Vorgabe 2026-08-08: löst das alte manuelle
  -- fragebogen_erfasst-Häkchen als Vollständigkeits-Kriterium ab). Kein
  -- eigenes Saison-Jahr-Feld auf personal_kandidaten - Jahr wird aus dem
  -- geplanten Ankunftsdatum abgeleitet. "erfasst" = Datensatz existiert,
  -- "bestanden" = zusätzlich laut Auswertung SV-frei plausibel möglich.
  -- Ans Ende angehängt (nicht dazwischen) - siehe Kommentar bei
  -- employee_sv_pruefung weiter unten zum Grund (Fehler 42P16).
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
where k.status = 'anreiseliste';

alter view personal_kandidaten_checkliste set (security_invoker = true);
grant select on personal_kandidaten_checkliste to authenticated;

-- 4) Controlling-Sicht: dhh_formular_fehlt heisst jetzt
-- dhh_angaben_fehlen und prueft ebenfalls die erfassten Angaben.
-- Namensaenderung -> drop + create noetig (42P16).
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
    coalesce(k.verheiratet_laut_fragebogen, false)
    and not exists (
      select 1 from employee_documents d
      where d.employee_id = e.id and d.kategorie = 'Hochzeitsurkunde'
    )
  ) as hochzeitsurkunde_fehlt,
  -- Angaben zur doppelten Haushaltsführung (Personal → Lohnsteuer) - seit
  -- 2026-08-11 wird die erfasste Angabe geprüft, nicht mehr ein
  -- hochgeladenes Formular.
  (
    k.lohnsteuerabzug_antrag_gewuenscht
    and not exists (
      select 1 from doppelte_haushaltsfuehrung d
      where d.employee_id = e.id
        and d.saison_jahr = extract(year from w.erster_arbeitstag)::int
        and d.familienstand is not null
    )
  ) as dhh_angaben_fehlen
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
  -- Nur Personen, die tatsächlich schon gearbeitet haben - erst dann ist
  -- ein offener Status wirklich kritisch (vorher ist die Anreiseliste ja
  -- genau der richtige Ort dafür).
  and w.erster_arbeitstag is not null;

grant select on anreiseliste_offen_arbeitend to authenticated;
