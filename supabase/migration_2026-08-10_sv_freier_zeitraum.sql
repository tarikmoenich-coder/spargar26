-- Migration 2026-08-10: Sozialversicherungsfreier Zeitraum
--
-- Nutzer-Vorgabe: aus den SV-Fragebogen-Angaben (Bezahlter Urlaub +
-- Freistellung bei "Beschäftigung im Heimatland", Schulferien bei
-- "Schule/Studium", offene Zeiträume bei Selbstständigkeit/Rente/Hausmann)
-- wird ein "SV-freier Zeitraum" abgeleitet und gegen den tatsächlichen
-- Beschäftigungszeitraum (erster/letzter Arbeitstag) geprüft. Eine Über-
-- schreitung - oder eine Lücke zwischen "Bezahlter Urlaub" und "Freistellung",
-- die in die tatsächliche Beschäftigung fällt - zählt als kritisch, genau wie
-- die bestehende 90-Tage-/15-Wochen-Prüfung. Das "normale" empfohlene
-- Austrittsdatum ist ab jetzt das frühere von 15-Wochen-Ende und SV-frei-Ende
-- (die separate 90-Tage-Kombinationsprüfung für den Wiederkehr-Fall bleibt
-- unverändert).
--
-- In der Supabase SQL-Konsole ausführen. Reine Funktions-/Sicht-Änderungen,
-- keine ALTER TYPE-Anweisung enthalten - kann in einem Zug laufen.

-- 1) Wiederverwendbare Funktionen für den SV-freien Zeitraum
create or replace function sv_freier_zeitraum_von(f sv_fragebogen)
returns date language sql immutable as $$
  select case
    when coalesce(f.beschaeftigt_heimatland, false)
      then least(f.bezahlter_urlaub_von, f.freistellung_von)
    when coalesce(f.schule_studium, false)
      and coalesce(f.schulferien_waehrend_beschaeftigung, false)
      then f.schulferien_von
    when coalesce(f.hausmann, false) then f.hausmann_seit
    when coalesce(f.rente, false) then f.rente_seit
    when coalesce(f.selbststaendig, false) then f.selbststaendig_seit
  end;
$$;

create or replace function sv_freier_zeitraum_bis(f sv_fragebogen)
returns date language sql immutable as $$
  select case
    when coalesce(f.beschaeftigt_heimatland, false)
      then greatest(f.bezahlter_urlaub_bis, f.freistellung_bis)
    when coalesce(f.schule_studium, false)
      and coalesce(f.schulferien_waehrend_beschaeftigung, false)
      then f.schulferien_bis
  end;
$$;

create or replace function sv_freier_zeitraum_luecke(f sv_fragebogen)
returns boolean language sql immutable as $$
  select
    coalesce(f.beschaeftigt_heimatland, false)
    and f.bezahlter_urlaub_von is not null and f.bezahlter_urlaub_bis is not null
    and f.freistellung_von is not null and f.freistellung_bis is not null
    and (
      (f.bezahlter_urlaub_bis - f.bezahlter_urlaub_von + 1)
      + (f.freistellung_bis - f.freistellung_von + 1)
    ) < (
      greatest(f.bezahlter_urlaub_bis, f.freistellung_bis)
      - least(f.bezahlter_urlaub_von, f.freistellung_von) + 1
    );
$$;

create or replace function sv_freier_zeitraum_luecke_von(f sv_fragebogen)
returns date language sql immutable as $$
  select case when sv_freier_zeitraum_luecke(f)
    then case when f.bezahlter_urlaub_von <= f.freistellung_von
      then f.bezahlter_urlaub_bis + 1 else f.freistellung_bis + 1 end
  end;
$$;

create or replace function sv_freier_zeitraum_luecke_bis(f sv_fragebogen)
returns date language sql immutable as $$
  select case when sv_freier_zeitraum_luecke(f)
    then case when f.bezahlter_urlaub_von <= f.freistellung_von
      then f.freistellung_von - 1 else f.bezahlter_urlaub_von - 1 end
  end;
$$;

-- 2) sv_fragebogen_auswertung: neue Spalten ans Ende angehängt
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
  f.unvollstaendig_fehlerhaft,
  f.unvollstaendig_fehlerhaft_grund,
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
  sv_freier_zeitraum_von(f) as sv_frei_von,
  sv_freier_zeitraum_bis(f) as sv_frei_bis,
  sv_freier_zeitraum_luecke(f) as sv_frei_luecke,
  sv_freier_zeitraum_luecke_von(f) as sv_frei_luecke_von,
  sv_freier_zeitraum_luecke_bis(f) as sv_frei_luecke_bis
from sv_fragebogen f;

alter view sv_fragebogen_auswertung set (security_invoker = true);
grant select on sv_fragebogen_auswertung to authenticated;

-- 3) employee_sv_pruefung: kritisch-Formel erweitert, neue Spalten ans Ende
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
  w.arbeitstage_ueber0,
  greatest(0, 90 - w.arbeitstage_ueber0) as rest_bis_90_tage,
  (w.erster_arbeitstag + 104) as austrittsdatum_15_wochen,
  floor((w.letzter_arbeitstag - w.erster_arbeitstag) / 7.0)::int as wochen_seit_start,
  (w.arbeitstage_ueber0 > 90) as ueberschritten_90_tage,
  (w.letzter_arbeitstag > (w.erster_arbeitstag + 104)) as ueberschritten_15_wochen,
  (
    w.arbeitstage_ueber0 > 90
    or w.letzter_arbeitstag > (w.erster_arbeitstag + 104)
    or (w.arbeitstage_ueber0 + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)) > 90
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
  w.arbeitstage_ueber0 + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as kombinierte_tage,
  greatest(
    0,
    90 - (w.arbeitstage_ueber0 + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
  ) as rest_bis_90_tage_kombiniert,
  least((w.erster_arbeitstag + 104), fb.sv_frei_bis) as austrittsdatum_empfohlen,
  fb.sv_frei_von,
  fb.sv_frei_bis,
  coalesce(fb.sv_frei_luecke, false) as sv_frei_luecke,
  fb.sv_frei_luecke_von,
  fb.sv_frei_luecke_bis,
  (fb.sv_frei_von is not null and w.erster_arbeitstag < fb.sv_frei_von)
    as ueberschritten_sv_frei_beginn,
  (fb.sv_frei_bis is not null and w.letzter_arbeitstag > fb.sv_frei_bis)
    as ueberschritten_sv_frei_ende
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden > 0) as erster_arbeitstag,
    max(we.datum) filter (where we.stunden > 0) as letzter_arbeitstag,
    count(distinct we.datum) filter (where we.stunden > 0) as arbeitstage_ueber0
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
left join lateral (
  select
    f.vorbeschaeftigung_deutschland_tage,
    sv_freier_zeitraum_von(f) as sv_frei_von,
    sv_freier_zeitraum_bis(f) as sv_frei_bis,
    sv_freier_zeitraum_luecke(f) as sv_frei_luecke,
    sv_freier_zeitraum_luecke_von(f) as sv_frei_luecke_von,
    sv_freier_zeitraum_luecke_bis(f) as sv_frei_luecke_bis
  from sv_fragebogen f
  where f.employee_id = e.id and f.saison_jahr = w.saison_jahr
) fb on true
where w.erster_arbeitstag is not null
  and e.abrechnungsart <> 'sozialversicherungspflichtig';

grant select on employee_sv_pruefung to authenticated;
