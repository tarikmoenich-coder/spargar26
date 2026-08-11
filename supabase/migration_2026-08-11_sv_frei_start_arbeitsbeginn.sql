-- Migration 2026-08-11: SV-freier Zeitraum startet bei offenen Zustaenden
-- mit dem Arbeitsbeginn statt mit dem Nachweis-Datum
--
-- Nutzer-Korrektur: "Das Start Datum bei 'SV-Freier Zeitraum' ist im
-- Testfall, in dem die Person 'Hausfrau' ist, das Datum des Antrags. Das
-- Startdatum ist aber immer das 'aktiv seit' Datum der Person. Anders macht
-- das auch keinen Sinn."
--
-- Umsetzung (auf Rueckfrage vom Nutzer bestaetigt): das gilt NUR fuer die
-- "offenen Zustaende" - Bloecke 2/5/6 (Selbststaendigkeit, Rentenbezug,
-- Hausfrau/Hausmann). Dort ist das "seit"-Datum auf dem Formular lediglich
-- ein Nachweis, seit wann der Zustand besteht, und kein Beginn eines
-- SV-freien Zeitraums.
--
-- Bei Block 1 (Bezahlter Urlaub / Freistellung) und Block 4 (Schulferien)
-- bleibt es bewusst beim echten Von-Datum aus den Angaben: das sind echte
-- Von-Bis-Zeitraeume, und nur so kann die Pruefung "SV-freier Zeitraum
-- beginnt zu spaet" ueberhaupt noch ausloesen (fruehere Nutzer-Vorgabe:
-- "Der SV-Frei Zeitraum in den Angaben darf nie kuerzer sein als der
-- tatsaechliche Abrechnungszeitraum des Mitarbeiters").
--
-- In der Supabase SQL-Konsole ausfuehren. Reine Funktions-/Sicht-Aenderung,
-- kein ALTER TYPE - laeuft in einem Zug.

-- 1) Neue Hilfsfunktion: erkennt die offenen Zustaende. Bewusst mit
-- derselben Vorrang-Reihenfolge wie sv_freier_zeitraum_von (Block 1 und
-- Block 4 gehen vor).
create or replace function sv_freier_zeitraum_offen(f sv_fragebogen)
returns boolean language sql immutable as $$
  select
    not coalesce(f.beschaeftigt_heimatland, false)
    and not (
      coalesce(f.schule_studium, false)
      and coalesce(f.schulferien_waehrend_beschaeftigung, false)
    )
    and (
      coalesce(f.hausmann, false)
      or coalesce(f.rente, false)
      or coalesce(f.selbststaendig, false)
    );
$$;

-- 2) sv_fragebogen_auswertung: neue Spalte sv_frei_offen ans Ende.
-- Achtung: die Spaltenreihenfolge unten entspricht der TATSAECHLICH live
-- deployten Sicht (unvollstaendig_fehlerhaft/_grund stehen nach
-- "bestanden") - nicht der Tabellen-Spaltenreihenfolge, sonst 42P16.
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
  f.unvollstaendig_fehlerhaft_grund,
  sv_freier_zeitraum_von(f) as sv_frei_von,
  sv_freier_zeitraum_bis(f) as sv_frei_bis,
  sv_freier_zeitraum_luecke(f) as sv_frei_luecke,
  sv_freier_zeitraum_luecke_von(f) as sv_frei_luecke_von,
  sv_freier_zeitraum_luecke_bis(f) as sv_frei_luecke_bis,
  sv_freier_zeitraum_offen(f) as sv_frei_offen
from sv_fragebogen f;

alter view sv_fragebogen_auswertung set (security_invoker = true);
grant select on sv_fragebogen_auswertung to authenticated;

-- 3) employee_sv_pruefung: sv_frei_von wird bei offenen Zustaenden auf den
-- Arbeitsbeginn gesetzt. Das passiert bewusst im fb-Join und nicht erst in
-- der SELECT-Liste, damit Anzeige UND kritisch-Formel garantiert denselben
-- Wert verwenden. Nebeneffekt (gewollt): ueberschritten_sv_frei_beginn kann
-- bei offenen Zustaenden nicht mehr ausloesen - der Zeitraum beginnt dort ja
-- per Definition mit dem ersten Arbeitstag.
create or replace view employee_sv_pruefung as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.abrechnungsart,
  e.aktiv,
  w.saison_jahr,
  w.erster_arbeitstag,
  w.letzter_arbeitstag,
  w.beschaeftigungstage,
  greatest(0, 90 - w.beschaeftigungstage) as rest_bis_90_tage,
  (w.erster_arbeitstag + 104) as austrittsdatum_15_wochen,
  floor((w.letzter_arbeitstag - w.erster_arbeitstag) / 7.0)::int as wochen_seit_start,
  (w.beschaeftigungstage > 90) as ueberschritten_90_tage,
  (w.letzter_arbeitstag > (w.erster_arbeitstag + 104)) as ueberschritten_15_wochen,
  (
    w.letzter_arbeitstag > (w.erster_arbeitstag + 104)
    or (
      coalesce(fb.vorbeschaeftigung_deutschland_tage, 0) > 0
      and (w.beschaeftigungstage + fb.vorbeschaeftigung_deutschland_tage) > 90
    )
    or (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    or (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    or (
      coalesce(fb.sv_frei_luecke, false)
      and w.erster_arbeitstag <= fb.sv_frei_luecke_bis
      and w.letzter_arbeitstag >= fb.sv_frei_luecke_von
    )
  ) as kritisch,
  coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as vorbeschaeftigung_deutschland_tage,
  w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as kombinierte_tage,
  greatest(
    0,
    90 - (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
  ) as rest_bis_90_tage_kombiniert,
  least(
    (w.erster_arbeitstag + 104),
    fb.sv_frei_bis,
    case when coalesce(fb.vorbeschaeftigung_deutschland_tage, 0) > 0
      then w.erster_arbeitstag + (89 - fb.vorbeschaeftigung_deutschland_tage)
    end
  ) as austrittsdatum_empfohlen,
  fb.sv_frei_von,
  fb.sv_frei_bis,
  coalesce(fb.sv_frei_luecke, false) as sv_frei_luecke,
  fb.sv_frei_luecke_von,
  fb.sv_frei_luecke_bis,
  (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    as ueberschritten_sv_frei_beginn,
  (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    as ueberschritten_sv_frei_ende,
  case when coalesce(fb.vorbeschaeftigung_deutschland_tage, 0) > 0
    then w.erster_arbeitstag + (89 - fb.vorbeschaeftigung_deutschland_tage)
  end as austrittsdatum_90_tage_kombiniert,
  coalesce(fb.sv_frei_offen, false) as sv_frei_offen
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden > 0) as erster_arbeitstag,
    max(we.datum) filter (where we.stunden > 0) as letzter_arbeitstag,
    (
      max(we.datum) filter (where we.stunden > 0)
      - min(we.datum) filter (where we.stunden > 0) + 1
    )::bigint as beschaeftigungstage
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
left join lateral (
  select
    f.vorbeschaeftigung_deutschland_tage,
    case when sv_freier_zeitraum_offen(f) then w.erster_arbeitstag
      else sv_freier_zeitraum_von(f) end as sv_frei_von,
    sv_freier_zeitraum_bis(f) as sv_frei_bis,
    sv_freier_zeitraum_luecke(f) as sv_frei_luecke,
    sv_freier_zeitraum_luecke_von(f) as sv_frei_luecke_von,
    sv_freier_zeitraum_luecke_bis(f) as sv_frei_luecke_bis,
    sv_freier_zeitraum_offen(f) as sv_frei_offen
  from sv_fragebogen f
  where f.employee_id = e.id and f.saison_jahr = w.saison_jahr
) fb on true
where w.erster_arbeitstag is not null
  and e.abrechnungsart <> 'sozialversicherungspflichtig';

grant select on employee_sv_pruefung to authenticated;
