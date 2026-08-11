-- Migration 2026-08-11: Vorbeschaeftigung wahlweise als Zeitraum erfassen
--
-- Nutzer-Vorgabe: das Feld "Bisherige Arbeitstage in Deutschland (dieses
-- Kalenderjahr, bei anderen Arbeitgebern)" soll wahlweise als Zeitraum
-- von/bis ODER als reine Tage-Zahl erfassbar sein - bei Datumseingabe
-- berechnet die App die Tage selbst.
--
-- Ist ein vollstaendiger Zeitraum angegeben, hat dieser Vorrang; die Tage
-- werden als Kalendertage inklusive beider Randtage gerechnet (gleiche
-- Zaehlweise wie bei der 15-Wochen-Grenze).
--
-- Ausserdem: der Hinweistext im Formular sprach noch von der
-- "90-Tage-Grenze" - die gibt es seit der Umstellung auf 15 Wochen/105
-- Tage nicht mehr (siehe migration_2026-08-11_15_wochen_zusammenrechnung).
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug. Setzt die Migration 15_wochen_zusammenrechnung voraus.

-- 1) Neue Datumsfelder
alter table sv_fragebogen
  add column if not exists vorbeschaeftigung_deutschland_von date;
alter table sv_fragebogen
  add column if not exists vorbeschaeftigung_deutschland_bis date;

-- 2) Effektive Tage-Zahl: Zeitraum hat Vorrang vor der direkten Zahl
create or replace function vorbeschaeftigung_deutschland_tage_effektiv(
  f sv_fragebogen
)
returns int language sql immutable as $$
  select coalesce(
    case
      when f.vorbeschaeftigung_deutschland_von is not null
        and f.vorbeschaeftigung_deutschland_bis is not null
      then (f.vorbeschaeftigung_deutschland_bis
            - f.vorbeschaeftigung_deutschland_von + 1)
    end,
    f.vorbeschaeftigung_deutschland_tage,
    0
  );
$$;

-- 3) sv_fragebogen_auswertung: drei neue Spalten ans Ende.
-- Spaltenreihenfolge unten = die TATSAECHLICH live deployte Reihenfolge
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

-- 4) employee_sv_pruefung: nutzt ab jetzt die effektive Tage-Zahl.
-- Wieder drop + create (nichts haengt an dieser Sicht, und so ist
-- sichergestellt, dass Definition und schema.sql exakt gleich sind).
drop view if exists employee_sv_pruefung;

create view employee_sv_pruefung as
with beschaeftigungstage_roh as (
  select
    we.employee_id,
    we.datum,
    extract(year from we.datum)::int as saison_jahr,
    -- Abschnitts-Nummer = Anzahl der Abrechnungen VOR diesem Tag. "<"
    -- statt "<=": an dem Tag, an dem abgerechnet wird, gearbeitete Stunden
    -- gehören noch zum alten Abschnitt.
    (
      select count(*)
      from saison_abrechnungen sa
      where sa.employee_id = we.employee_id
        and sa.saison_jahr = extract(year from we.datum)::int
        and sa.abgerechnet_am::date < we.datum
    ) as abschnitt_nr
  from work_entries we
  where we.stunden > 0 or we.markierung is not null
),
abschnitte as (
  select
    employee_id,
    saison_jahr,
    abschnitt_nr,
    min(datum) as von,
    max(datum) as bis,
    (max(datum) - min(datum) + 1) as tage
  from beschaeftigungstage_roh
  group by employee_id, saison_jahr, abschnitt_nr
),
w as (
  select
    employee_id,
    saison_jahr,
    min(von) as erster_arbeitstag,
    max(bis) as letzter_arbeitstag,
    -- ::int (nicht bigint): tage_vor_letztem_abschnitt unten wird auf ein
    -- Datum addiert, und Postgres kennt nur "date + integer", kein
    -- "date + bigint" (Fehler 42883). sum() liefert von sich aus bigint.
    sum(tage)::int as beschaeftigungstage,
    count(*)::int as anzahl_abschnitte,
    -- Für das Austrittsdatum: der laufende (zuletzt begonnene) Abschnitt
    -- darf noch so viele Kalendertage laufen, wie vom Budget übrig ist.
    (array_agg(von order by von desc))[1] as beginn_letzter_abschnitt,
    (sum(tage) - (array_agg(tage order by von desc))[1])::int
      as tage_vor_letztem_abschnitt
  from abschnitte
  group by employee_id, saison_jahr
)
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
  -- Summe der Kalendertage ALLER Beschäftigungsabschnitte dieses
  -- Kalenderjahres (nicht die Spanne vom ersten bis zum letzten Tag).
  w.beschaeftigungstage,
  w.anzahl_abschnitte,
  -- Bisherige Beschäftigungstage in DEUTSCHLAND bei anderen Arbeitgebern
  -- laut SV-Fragebogen. Rechtlich zählt das Kalenderjahr über ALLE
  -- deutschen Arbeitgeber zusammen, nicht nur die Tage bei uns.
  coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as vorbeschaeftigung_deutschland_tage,
  (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
    as kombinierte_tage,
  greatest(
    0,
    105 - (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
  ) as rest_bis_105_tage,
  (
    (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)) > 105
  ) as ueberschritten_105_tage,
  -- Letzter Tag, an dem die Person nach der 15-Wochen-Regel noch
  -- SV-frei beschäftigt sein darf: der laufende Abschnitt darf genau so
  -- lange laufen, wie das Budget nach Abzug früherer Abschnitte und der
  -- Vorbeschäftigung noch hergibt.
  (
    w.beginn_letzter_abschnitt
    + (105 - w.tage_vor_letztem_abschnitt
         - coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
    - 1
  ) as austrittsdatum_105_tage,
  -- Empfohlenes Austrittsdatum: das frühere von der 15-Wochen-Grenze und
  -- dem Ende des SV-freien Zeitraums laut Angaben (least() ignoriert
  -- NULL, sv_frei_bis ist bei offenen Zuständen NULL).
  least(
    (
      w.beginn_letzter_abschnitt
      + (105 - w.tage_vor_letztem_abschnitt
           - coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
      - 1
    ),
    fb.sv_frei_bis
  ) as austrittsdatum_empfohlen,
  (
    (w.beschaeftigungstage + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)) > 105
    -- SV-freier Zeitraum laut Angaben deckt die tatsächliche Beschäftigung
    -- nicht ab, oder diese fällt in eine Lücke zwischen "Bezahlter Urlaub"
    -- und "Freistellung" (Nutzer-Vorgabe 2026-08-10: als kritisch werten).
    or (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    or (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    or (
      coalesce(fb.sv_frei_luecke, false)
      and w.erster_arbeitstag <= fb.sv_frei_luecke_bis
      and w.letzter_arbeitstag >= fb.sv_frei_luecke_von
    )
  ) as kritisch,
  fb.sv_frei_von,
  fb.sv_frei_bis,
  coalesce(fb.sv_frei_luecke, false) as sv_frei_luecke,
  fb.sv_frei_luecke_von,
  fb.sv_frei_luecke_bis,
  coalesce(fb.sv_frei_offen, false) as sv_frei_offen,
  (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    as ueberschritten_sv_frei_beginn,
  (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    as ueberschritten_sv_frei_ende
from employees e
join w on w.employee_id = e.id
-- Bewusst direkt gegen die Rohtabelle (nicht über die security_invoker-
-- Sicht sv_fragebogen_auswertung), damit hier eindeutig mit den Rechten
-- des Sicht-Eigentümers gelesen wird, unabhängig von der Rolle des
-- aufrufenden Nutzers.
left join lateral (
  select
    -- Effektive Tage-Zahl: bevorzugt aus dem Zeitraum von/bis berechnet,
    -- sonst die direkt eingetragene Zahl (Nutzer-Vorgabe 2026-08-11).
    vorbeschaeftigung_deutschland_tage_effektiv(f)
      as vorbeschaeftigung_deutschland_tage,
    -- Bei den offenen Zuständen (Hausfrau/Rente/Selbstständigkeit) ist das
    -- "seit"-Datum aus dem Formular nur ein Nachweis, seit wann der Zustand
    -- besteht - der SV-freie Zeitraum beginnt dort mit dem tatsächlichen
    -- Arbeitsbeginn. Bei Block 1/4 bleibt es beim Von-Datum aus den
    -- Angaben, sonst könnte "beginnt zu spät" nie auslösen.
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
-- Die 15-Wochen-Regel ist die Obergrenze für SOZIALVERSICHERUNGSFREIE
-- Beschäftigung - für bereits sozialversicherungspflichtige Personen ist
-- diese Prüfung gegenstandslos (Nutzer-Hinweis 2026-08-06).
where e.abrechnungsart <> 'sozialversicherungspflichtig';

grant select on employee_sv_pruefung to authenticated;
