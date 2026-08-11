-- Migration 2026-08-11: 15-Wochen-Regel als alleinige Tage-Grenze,
-- Zusammenrechnung mehrerer Beschaeftigungsabschnitte
--
-- Nutzer-Recherche (lohndialog.de, kurzfristige Beschaeftigung) mit zwei
-- Konsequenzen fuer die bisherige Logik:
--
-- 1. Die 90-Arbeitstage-Grenze gilt nur fuer Beschaeftigungen an WENIGER
--    als 5 Tagen pro Woche. Das kommt im Betrieb nicht vor - Nutzer:
--    "Fuer uns findet die 90 Tage Regellung praktisch keine Anwendung".
--    Maszgeblich sind allein die 15 Wochen = 105 Kalendertage. Die gesamte
--    90-Tage-Mechanik entfaellt damit.
--
-- 2. Die Zeitraeume muessen NICHT am Stueck laufen: "Alle kurzfristigen
--    Beschaeftigungen innerhalb eines Kalenderjahres werden
--    zusammengerechnet." Bisher zaehlte die reine Spanne vom ersten bis
--    zum letzten Arbeitstag - eine Pause zwischen zwei Einsaetzen zaehlte
--    damit faelschlich mit.
--
-- Abschnitts-Erkennung (Nutzer-Vorgabe): eine ABRECHNUNG beendet den
-- Beschaeftigungsabschnitt (saison_abrechnen_batch setzt dabei
-- employees.aktiv = false). Dafuer braucht es die neue Historie
-- saison_abrechnungen - season_bonuses selbst hat unique (employee_id,
-- saison_jahr) und ueberschreibt abgerechnet_am bei jeder erneuten
-- Abrechnung.
--
-- Ausserdem (Nutzer-Vorgabe): Tage mit Markierung statt Stunden (z.B. "U"
-- fuer Urlaub) zaehlen jetzt zur Beschaeftigungsdauer - waehrend Urlaub
-- besteht das Beschaeftigungsverhaeltnis fort.
--
-- In der Supabase SQL-Konsole ausfuehren. Enthaelt kein ALTER TYPE, laeuft
-- in einem Zug.

-- 1) Historie aller Abrechnungen je Person und Saison
create table if not exists saison_abrechnungen (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,
  abgerechnet_am timestamptz not null default now(),
  abgerechnet_von uuid references profiles (id),
  auszahlungsbeleg_id bigint references auszahlungsbelege (id)
);

create index if not exists idx_saison_abrechnungen_employee
  on saison_abrechnungen (employee_id, saison_jahr, abgerechnet_am);

alter table saison_abrechnungen enable row level security;

drop policy if exists "saison_abrechnungen_select" on saison_abrechnungen;
create policy "saison_abrechnungen_select" on saison_abrechnungen for select
  using (auth.uid() is not null);

-- 2) Bereits erfolgte Abrechnungen einmalig aus season_bonuses uebernehmen,
-- damit bestehende Faelle nicht ohne Historie dastehen. Nur einfuegen, was
-- noch nicht drin ist (macht die Migration wiederholbar).
insert into saison_abrechnungen (
  employee_id, saison_jahr, abgerechnet_am, abgerechnet_von, auszahlungsbeleg_id
)
select sb.employee_id, sb.saison_jahr, sb.abgerechnet_am, sb.abgerechnet_von,
       sb.auszahlungsbeleg_id
from season_bonuses sb
where sb.abgerechnet_am is not null
  and not exists (
    select 1 from saison_abrechnungen sa
    where sa.employee_id = sb.employee_id
      and sa.saison_jahr = sb.saison_jahr
      and sa.abgerechnet_am = sb.abgerechnet_am
  );

-- 3) saison_abrechnen_batch schreibt ab jetzt zusaetzlich in die Historie
create or replace function saison_abrechnen_batch(
  p_employee_ids uuid[],
  p_saison_jahr int,
  p_zahlungsart text default 'BAR'
)
returns text language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neuer_beleg_id bigint;
  neue_belegnummer text;
  emp_id uuid;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
  end if;

  neue_belegnummer := naechste_belegnummer('AZ-' || to_char(now(), 'MM-YYYY'));

  insert into auszahlungsbelege (belegnummer, saison_jahr, zahlungsart, erstellt_von)
  values (neue_belegnummer, p_saison_jahr, p_zahlungsart, auth.uid())
  returning id into neuer_beleg_id;

  foreach emp_id in array p_employee_ids loop
    select * into s from season_summary
    where employee_id = emp_id and saison_jahr = p_saison_jahr;

    if found then
      -- 'snapshot' aus s selbst entfernen, sonst würde sich bei mehrfachem
      -- Abrechnen derselben Person der alte Schnappschuss im neuen
      -- verschachteln.
      insert into season_bonuses (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        snapshot, auszahlungsbeleg_id
      )
      values (
        emp_id, p_saison_jahr, now(), auth.uid(),
        to_jsonb(s) - 'snapshot', neuer_beleg_id
      )
      on conflict (employee_id, saison_jahr)
      do update set
        abgerechnet_am = now(),
        abgerechnet_von = auth.uid(),
        snapshot = excluded.snapshot,
        auszahlungsbeleg_id = neuer_beleg_id;

      -- Zusätzlich in die Historie (siehe saison_abrechnungen oben):
      -- season_bonuses überschreibt abgerechnet_am bei erneutem Abrechnen,
      -- die SV-Prüfung braucht aber jeden einzelnen Abschnitts-Endzeitpunkt.
      insert into saison_abrechnungen (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        auszahlungsbeleg_id
      )
      values (emp_id, p_saison_jahr, now(), auth.uid(), neuer_beleg_id);

      update employees set aktiv = false where id = emp_id;
    end if;
  end loop;

  return neue_belegnummer;
end;
$$;

grant execute on function saison_abrechnen_batch(uuid[], int, text) to authenticated;

-- 4) Prueffsicht komplett neu (Spaltennamen UND -reihenfolge aendern
-- sich, daher drop + create statt create or replace - sonst 42P16).
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
    f.vorbeschaeftigung_deutschland_tage,
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
