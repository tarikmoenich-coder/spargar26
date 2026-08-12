-- Migration 2026-08-12 (Sicherheit): Supabase-Advisor "Security Definer View"
--
-- Auslöser: Supabase-Sicherheitswarnungen für mehrere Sichten (z.B.
-- employee_kleidung_ausgabe), die ohne "security_invoker = true" mit den
-- Rechten des Sicht-Eigentümers laufen statt mit denen der abfragenden
-- Person.
--
-- Bei genauer Prüfung aller 14 betroffenen Sichten:
--  - 6 sind bereits absichtlich so gebaut und dokumentiert (profile_namen,
--    employee_kleidung_ausgabe, employee_letzte_abrechnung,
--    anreiseliste_offen_arbeitend, employee_vorschuss_historie,
--    employee_fuehrerschein_kategorien) - zeigen jeweils nur eine schmale,
--    unkritische Auswahl (Namen/Stückzahlen/Datum/Flags), unverändert.
--  - 4 sind unbedenklich, da die zugrunde liegenden Tabellen ohnehin für
--    jede angemeldete Rolle per RLS lesbar sind - hier wird
--    security_invoker = true ergänzt, ohne Verhaltensänderung.
--  - 4 hatten eine echte Lücke: sie zeigen VOLLE sensible Daten (Lohn-
--    beträge, SV-rechtliche Einschätzung), waren aber technisch für JEDE
--    angemeldete Rolle per REST-API abrufbar (grant ... to authenticated),
--    obwohl die App diese Seiten nur bestimmten Rollen im Menü zeigt. Hier
--    wird direkt in der Sicht ein "where current_role_name() in (...)"
--    ergänzt, das exakt der bestehenden Menü-Berechtigung entspricht
--    (components/Nav.tsx) - die Sicht bleibt technisch "security definer"
--    (muss weiterhin admin/lohnabrechnung-only-Tabellen wie season_bonuses
--    lesen können), gibt einer nicht berechtigten Rolle serverseitig aber
--    nichts mehr zurück.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

-- --- Gruppe: unbedenklich, nur security_invoker ergänzt -------------------

alter view erdbeeren_bepflanzung_berechnet set (security_invoker = true);
alter view erdbeeren_bestellung_uebersicht set (security_invoker = true);
alter view erdbeeren_anbau_uebersicht set (security_invoker = true);
alter view employee_urlaubstage set (security_invoker = true);

-- --- Gruppe: echte Lücke, Rollen-Prüfung ergänzt ---------------------------

create or replace view season_summary as
with base as (
  select
    e.id as employee_id,
    e.personal_nr,
    e.name,
    e.vorname,
    e.gruppe_nr,
    e.abrechnungsart,
    e.aktiv,
    we.saison_jahr,
    we.gesamt_stunden,
    we.anwesenheitstage,
    coalesce(b.akkord_betrag, 0)
      + coalesce(b.praemie_ausgleich, 0)
      + coalesce(b.fahrer_zulage, 0)
      + coalesce(b.erdbeer_praemie, 0)
      + coalesce(b.spargel_praemie, 0)
      + coalesce(zm.zuckermais_praemie_summe, 0)
      + coalesce(eb.erdbeeren_praemie_summe, 0) as praemien_summe,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0)) as basis_brutto,
    (we.gesamt_stunden * coalesce(e.stundenlohn, 0))
      + coalesce(b.akkord_betrag, 0)
      + coalesce(b.praemie_ausgleich, 0)
      + coalesce(b.fahrer_zulage, 0)
      + coalesce(b.erdbeer_praemie, 0)
      + coalesce(b.spargel_praemie, 0)
      + coalesce(zm.zuckermais_praemie_summe, 0)
      + coalesce(eb.erdbeeren_praemie_summe, 0) as bruttolohn,
    b.netto_extern,
    b.abgerechnet_am,
    b.snapshot,
    b.auszahlungsbeleg_id,
    coalesce(b.bus_hin, 0) + coalesce(b.bus_rueck, 0) as bus_kosten,
    coalesce(b.fahrer_kaution, 0) as fahrer_kaution,
    coalesce(b.zimmer_kaution, 0) as zimmer_kaution,
    coalesce(v.verpflegung, 0) * we.anwesenheitstage as abzug_verpflegung,
    coalesce(v.wohnen, 0) * we.anwesenheitstage as abzug_wohnen,
    coalesce((
      select sum(coalesce(ar.anteil, a.betrag / greatest(cnt.n, 1)))
      from advance_recipients ar
      join advances a on a.id = ar.advance_id
      join (
        select advance_id, count(*) n from advance_recipients group by advance_id
      ) cnt on cnt.advance_id = ar.advance_id
      where ar.employee_id = e.id
        and a.storniert = false
        and extract(year from a.datum) = we.saison_jahr
    ), 0) as vorschuss_summe,
    coalesce(b.kleidung_hose_anzahl, 0) * coalesce(v.kleidung_hose, 0)
      + coalesce(b.kleidung_jacke_anzahl, 0) * coalesce(v.kleidung_jacke, 0)
      + coalesce(b.kleidung_stiefel_anzahl, 0) * coalesce(v.kleidung_stiefel, 0)
      as kleidung_betrag
  from employees e
  join lateral (
    select
      extract(year from we2.datum)::int as saison_jahr,
      sum(coalesce(we2.stunden, 0) + (case when we2.markierung = 'U' then 8 else 0 end)) as gesamt_stunden,
      count(*) filter (where we2.stunden is not null or we2.markierung is not null) as anwesenheitstage
    from work_entries we2
    where we2.employee_id = e.id
    group by extract(year from we2.datum)
  ) we on true
  left join season_bonuses b on b.employee_id = e.id and b.saison_jahr = we.saison_jahr
  left join verpflegungssaetze v on v.saison_jahr = we.saison_jahr
  left join lateral (
    select sum(pt.praemie) as zuckermais_praemie_summe
    from zuckermais_praemie_tag pt
    where pt.employee_id = e.id
      and extract(year from pt.datum) = we.saison_jahr
  ) zm on true
  left join lateral (
    select sum(ept.praemie) as erdbeeren_praemie_summe
    from erdbeeren_praemie_tag ept
    where ept.employee_id = e.id
      and extract(year from ept.datum) = we.saison_jahr
  ) eb on true
),
steuer as (
  select
    base.*,
    case when abrechnungsart = 'pauschal'
      then round(bruttolohn * 0.05275, 2)
      else 0
    end as lohnsteuer_pauschal,
    case when abrechnungsart = 'pauschal'
      then bruttolohn - round(bruttolohn * 0.05275, 2)
      else netto_extern
    end as netto
  from base
)
select
  steuer.employee_id,
  steuer.personal_nr,
  steuer.name,
  steuer.vorname,
  steuer.gruppe_nr,
  steuer.abrechnungsart,
  steuer.aktiv,
  steuer.saison_jahr,
  steuer.gesamt_stunden,
  steuer.anwesenheitstage,
  steuer.praemien_summe,
  steuer.basis_brutto,
  steuer.bruttolohn,
  steuer.netto_extern,
  steuer.abgerechnet_am,
  steuer.snapshot,
  steuer.auszahlungsbeleg_id,
  steuer.bus_kosten,
  steuer.fahrer_kaution,
  steuer.zimmer_kaution,
  steuer.abzug_verpflegung,
  steuer.abzug_wohnen,
  steuer.vorschuss_summe,
  steuer.lohnsteuer_pauschal,
  steuer.netto,
  steuer.netto - steuer.abzug_verpflegung - steuer.abzug_wohnen
    - steuer.vorschuss_summe - steuer.bus_kosten - steuer.fahrer_kaution
    - steuer.zimmer_kaution - steuer.kleidung_betrag
    as auszahlungsbetrag,
  steuer.kleidung_betrag
from steuer
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management');

grant select on season_summary to authenticated;

create or replace view season_summary_monat as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.gruppe_nr,
  e.aktiv,
  extract(year from we.datum)::int as saison_jahr,
  extract(month from we.datum)::int as monat,
  sum(coalesce(we.stunden, 0) + (case when we.markierung = 'U' then 8 else 0 end)) as gesamt_stunden,
  count(*) filter (where we.stunden is not null or we.markierung is not null) as anwesenheitstage,
  max(we.datum) filter (where we.stunden is not null or we.markierung is not null) as letzter_eintrag,
  (sum(coalesce(we.stunden, 0) + (case when we.markierung = 'U' then 8 else 0 end))
    * coalesce(e.stundenlohn, 0)) as basis_brutto,
  coalesce(v.verpflegung, 0)
    * count(*) filter (where we.stunden is not null or we.markierung is not null)
    as abzug_verpflegung,
  coalesce(v.wohnen, 0)
    * count(*) filter (where we.stunden is not null or we.markierung is not null)
    as abzug_wohnen
from employees e
join work_entries we on we.employee_id = e.id
left join verpflegungssaetze v on v.saison_jahr = extract(year from we.datum)::int
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management')
group by
  e.id, e.personal_nr, e.name, e.vorname, e.gruppe_nr, e.aktiv,
  extract(year from we.datum), extract(month from we.datum),
  v.verpflegung, v.wohnen;

grant select on season_summary_monat to authenticated;

create or replace view auszahlungsbeleg_summary as
select
  ab.id,
  ab.belegnummer,
  ab.saison_jahr,
  ab.zahlungsart,
  ab.erstellt_am,
  ab.erstellt_von,
  count(sb.employee_id) as anzahl_personen,
  sum((sb.snapshot ->> 'auszahlungsbetrag')::numeric) as summe_auszahlungsbetrag,
  bool_or(
    (sb.snapshot ->> 'auszahlungsbetrag')::numeric is distinct from ss.auszahlungsbetrag
  ) as weicht_ab
from auszahlungsbelege ab
join season_bonuses sb on sb.auszahlungsbeleg_id = ab.id
left join season_summary ss
  on ss.employee_id = sb.employee_id and ss.saison_jahr = sb.saison_jahr
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management')
group by ab.id, ab.belegnummer, ab.saison_jahr, ab.zahlungsart, ab.erstellt_am, ab.erstellt_von;

grant select on auszahlungsbeleg_summary to authenticated;

-- employee_sv_pruefung: drop + create, wie im Original (Spaltenreihenfolge
-- unveraendert, nur die WHERE-Klausel bekommt die Rollen-Pruefung dazu).
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
--
-- Sicherheitsfix 2026-08-12 (Supabase-Advisor "Security Definer View"):
-- diese Sicht liest bewusst mit den Rechten des Eigentümers direkt gegen
-- sv_fragebogen (siehe Kommentar oben bei "fb"), das per RLS admin/hr-only
-- ist - "so sensibel wie SV-Nr./IBAN" (siehe sv_fragebogen_admin_hr_all
-- weiter unten). Ohne diese Zeile wäre die abgeleitete SV-Einschätzung
-- trotzdem für JEDE angemeldete Rolle abrufbar gewesen. Rollenliste
-- entspricht den tatsächlichen Nutzern (Personal/Controlling, siehe
-- app/mitarbeiter, app/personal-sozialversicherung, app/management).
where e.abrechnungsart <> 'sozialversicherungspflichtig'
  and current_role_name() in ('admin', 'hr', 'management');

grant select on employee_sv_pruefung to authenticated;
