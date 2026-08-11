-- Migration 2026-08-11: Controlling zeigt Personen, die trotz offenem
-- Anreiselisten-Status bereits arbeiten
--
-- Nutzer-Vorgabe: "Wenn dort noch Leute sind, weil sie keinen Arbeitsvertrag
-- haben (Nicht gedruckt), oder nicht bestandenen SV-Fragebogen, Status
-- 'offen', aber schon Stunden in der Stundenerfassung haben, dann muss
-- dieser Zustand im Controlling erscheinen." Angezeigt werden Person, Grund
-- fuer den offenen Status und die Tage seit Arbeitsbeginn.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

-- 1) "Bestanden"-Formel als wiederverwendbare Funktion (bisher direkt in
-- sv_fragebogen_auswertung ausgeschrieben) - die neue Sicht unten braucht
-- dieselbe Regel, und eine zweite handgeschriebene Kopie wuerde beim
-- naechsten Feinschliff auseinanderlaufen.
create or replace function sv_fragebogen_bestanden(f sv_fragebogen)
returns boolean language sql immutable as $$
  select
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
    and not f.unvollstaendig_fehlerhaft;
$$;

-- 2) sv_fragebogen_auswertung nutzt ab jetzt die Funktion. Spalten-
-- reihenfolge unten = die TATSAECHLICH live deployte Reihenfolge
-- (unvollstaendig_fehlerhaft/_grund stehen nach "bestanden"), sonst 42P16.
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
  sv_fragebogen_bestanden(f) as bestanden,
  -- WICHTIG: unvollstaendig_fehlerhaft/_grund stehen HIER (nach bestanden),
  -- nicht in Tabellen-Spaltenreihenfolge vor ausgefuellt_am - das ist die
  -- Position, in der sie live per "create or replace view" angehängt
  -- wurden (migration_2026-08-08_sv_fragebogen_unvollstaendig.sql). Diese
  -- SELECT-Liste muss die TATSÄCHLICH deployte Spaltenreihenfolge
  -- widerspiegeln, nicht die Tabellen-Spaltenreihenfolge - sonst 42P16
  -- (schon einmal passiert, 2026-08-10).
  f.unvollstaendig_fehlerhaft,
  f.unvollstaendig_fehlerhaft_grund,
  -- Sozialversicherungsfreier Zeitraum laut Angaben (Nutzer-Vorgabe
  -- 2026-08-10) - siehe ausführlichen Kommentar bei den sv_freier_zeitraum_
  -- *-Funktionen oben. Ans Ende angehängt (nach unvollstaendig_fehlerhaft_
  -- grund, dem tatsächlich letzten Feld der live laufenden Sicht).
  sv_freier_zeitraum_von(f) as sv_frei_von,
  sv_freier_zeitraum_bis(f) as sv_frei_bis,
  sv_freier_zeitraum_luecke(f) as sv_frei_luecke,
  sv_freier_zeitraum_luecke_von(f) as sv_frei_luecke_von,
  sv_freier_zeitraum_luecke_bis(f) as sv_frei_luecke_bis,
  -- "Offener Zustand" (Hausfrau/Rente/Selbstständigkeit): sv_frei_von oben
  -- ist dann nur das Nachweis-Datum aus dem Formular, NICHT der Beginn des
  -- SV-freien Zeitraums - der ist der tatsächliche Arbeitsbeginn (siehe
  -- employee_sv_pruefung.sv_frei_von, dort korrekt eingesetzt).
  sv_freier_zeitraum_offen(f) as sv_frei_offen,
  -- Vorbeschäftigung wahlweise als Zeitraum erfassbar (Nutzer-Vorgabe
  -- 2026-08-11) - die effektive Tage-Zahl bevorzugt den Zeitraum, falls
  -- vollständig angegeben. Ans Ende angehängt (42P16).
  f.vorbeschaeftigung_deutschland_von,
  f.vorbeschaeftigung_deutschland_bis,
  vorbeschaeftigung_deutschland_tage_effektiv(f)
    as vorbeschaeftigung_deutschland_tage_effektiv
from sv_fragebogen f;

-- security_invoker = true: die Rohantworten sind so sensibel wie andere
-- Personaldaten (SV-Nr./IBAN) - läuft mit den Rechten des aufrufenden
-- Nutzers, damit die admin/hr-only-Policy von sv_fragebogen tatsächlich
-- greift (siehe RLS weiter unten).
alter view sv_fragebogen_auswertung set (security_invoker = true);
grant select on sv_fragebogen_auswertung to authenticated;

-- 3) Neue Sicht fuer die Controlling-Seite
create or replace view anreiseliste_offen_arbeitend as
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
  (
    k.lohnsteuerabzug_antrag_gewuenscht
    and not exists (
      select 1 from employee_documents d
      where d.employee_id = e.id
        and d.kategorie = 'Formular "Doppelte Haushaltsführung"'
    )
  ) as dhh_formular_fehlt
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
