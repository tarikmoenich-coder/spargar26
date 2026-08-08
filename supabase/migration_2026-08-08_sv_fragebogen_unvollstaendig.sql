-- Neues Feld "Erfassungsbogen unvollständig/fehlerhaft" mit Begründung
-- (Nutzer-Vorgabe 2026-08-08): unterscheidet "Bogen wurde bereits
-- geprüft, ist aber nicht verwertbar" von "noch gar nicht angesehen"
-- (kein Datensatz). Zählt automatisch als "nicht bestanden".

alter table sv_fragebogen
  add column unvollstaendig_fehlerhaft boolean not null default false;
alter table sv_fragebogen
  add column unvollstaendig_fehlerhaft_grund text;

-- WICHTIG: explizite Spaltenliste, NICHT "f.*" - siehe ausführlichen
-- Kommentar in schema.sql. Reihenfolge der bereits vorhandenen Spalten
-- bewusst unverändert gelassen (exakt wie in der bisher live laufenden
-- Sicht), neue Spalten (unvollstaendig_fehlerhaft/_grund) ans Ende
-- angehängt - sonst wieder Fehler 42P16 wie beim letzten Mal.
create or replace view sv_fragebogen_auswertung as
select
  f.id,
  f.employee_id,
  f.saison_jahr,
  f.beschaeftigt_heimatland,
  f.beschaeftigt_firma,
  f.beschaeftigt_taetigkeit,
  f.bezahlter_urlaub,
  f.bezahlter_urlaub_von,
  f.bezahlter_urlaub_bis,
  f.unbezahlter_urlaub,
  f.unbezahlter_urlaub_von,
  f.unbezahlter_urlaub_bis,
  f.freistellung,
  f.freistellung_von,
  f.freistellung_bis,
  f.freistellung_grund,
  f.selbststaendig,
  f.selbststaendig_seit,
  f.selbststaendig_taetigkeit,
  f.arbeitslos,
  f.arbeitslos_seit,
  f.arbeitsamt_name,
  f.arbeitsamt_aktenzeichen,
  f.schule_studium,
  f.schule_seit,
  f.schule_name,
  f.schule_ende,
  f.schulferien_waehrend_beschaeftigung,
  f.schulferien_von,
  f.schulferien_bis,
  f.rente,
  f.rente_seit,
  f.rente_art,
  f.rente_traeger,
  f.hausmann,
  f.hausmann_seit,
  f.lebensunterhalt_sonstiges,
  f.vorbeschaeftigung_deutschland_tage,
  f.vorbeschaeftigung_deutschland_arbeitgeber,
  f.ausgeloest_durch_lohnprogramm_hinweis,
  f.ausgefuellt_am,
  f.erfasst_von,
  f.erfasst_am,
  f.updated_by,
  f.updated_at,
  (
    (
      coalesce(f.beschaeftigt_heimatland, false)
      or coalesce(f.selbststaendig, false)
      or coalesce(f.schule_studium, false)
      or coalesce(f.rente, false)
      or coalesce(f.hausmann, false)
    )
    and not coalesce(f.arbeitslos, false)
  )
  and not f.unvollstaendig_fehlerhaft as bestanden,
  f.unvollstaendig_fehlerhaft,
  f.unvollstaendig_fehlerhaft_grund
from sv_fragebogen f;

-- personal_kandidaten_checkliste: gleiche Unterscheidung auch auf der
-- Anreiseliste sichtbar (Spalte ans Ende angehängt - setzt voraus, dass
-- migration_2026-08-08_anreiseliste_sv_verknuepfung.sql bereits gelaufen
-- ist, siehe Dateinamen-Reihenfolge in der README).
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
