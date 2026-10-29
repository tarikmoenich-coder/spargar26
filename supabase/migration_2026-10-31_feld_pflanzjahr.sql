-- ============================================================================
-- Migration 2026-10-31 (4): Pflanzjahr statt Standjahr - Standjahr wird
-- für die jeweilige Saison automatisch abgeleitet
--
-- Nutzer-Vorgabe: "Standjahr" wurde bisher als Zähler direkt eingegeben und
-- bei "Aus Vorjahr übernehmen" per Hand um 1 hochgezählt - fehleranfällig
-- und bei mehrjährigem Rückstand (mehrere Saisons nicht gepflegt) sofort
-- falsch. Stattdessen wird jetzt das tatsächliche PFLANZJAHR (ein fester,
-- realer Kalenderjahrgang, z.B. 2023) eingegeben - das ändert sich über die
-- Jahre nie. Das Standjahr für eine konkrete Saison ergibt sich daraus
-- automatisch: saison_jahr - pflanzjahr + 1.
--
-- Datenübernahme: die bisherigen standjahr-Werte wurden immer für die
-- jeweils AKTUELLE Saison (feld_anbau.saison_jahr der Zeile) eingegeben -
-- daraus lässt sich das ursprüngliche Pflanzjahr exakt zurückrechnen, BEVOR
-- die alte Spalte gelöscht wird.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug).
-- ============================================================================

alter table feld_anbau_abschnitt
  add column if not exists pflanzjahr int;

update feld_anbau_abschnitt ab
set pflanzjahr = fa.saison_jahr - ab.standjahr + 1
from feld_anbau fa
where fa.id = ab.feld_anbau_id
  and ab.standjahr is not null
  and ab.pflanzjahr is null;

alter table feld_anbau_abschnitt
  drop column if exists standjahr;

comment on column feld_anbau_abschnitt.pflanzjahr is
  'Tatsächliches Pflanzjahr (fester Kalenderjahrgang, z.B. 2023) - ändert sich nie. Das Standjahr für eine Saison wird daraus abgeleitet: saison_jahr - pflanzjahr + 1 (siehe feld_anbau_abschnitt_berechnet).';

create or replace view feld_anbau_abschnitt_berechnet as
select
  ab.id,
  ab.feld_anbau_id,
  fa.feld_id,
  f.bezeichnung as feld_bezeichnung,
  f.kultur,
  fa.saison_jahr,
  ab.bezeichnung,
  ab.reihenlaenge_m,
  ab.reihenabstand_m,
  ab.cotura_nr,
  ab.sorte,
  ab.pflanzdatum,
  ab.pflanzjahr,
  case when ab.pflanzjahr is not null then fa.saison_jahr - ab.pflanzjahr + 1 end as standjahr,
  ab.pflanztyp,
  ab.reihen_anzahl,
  coalesce(ab.laufmeter_gesamt_m, coalesce(ab.reihenlaenge_m, 0) * coalesce(ab.reihen_anzahl, 0))
    as laufende_meter,
  round(
    coalesce(ab.laufmeter_gesamt_m, coalesce(ab.reihenlaenge_m, 0) * coalesce(ab.reihen_anzahl, 0))
      * coalesce(ab.pflanzen_pro_lfm, 0)
  )::int as anzahl_pflanzen,
  (
    coalesce(ab.laufmeter_gesamt_m, coalesce(ab.reihenlaenge_m, 0) * coalesce(ab.reihen_anzahl, 0))
    * coalesce(ab.reihenabstand_m, 0)
  ) as netto_flaeche_m2,
  round(
    (
      coalesce(ab.laufmeter_gesamt_m, coalesce(ab.reihenlaenge_m, 0) * coalesce(ab.reihen_anzahl, 0))
      * coalesce(ab.reihenabstand_m, 0)
    ) / 10000.0,
    4
  ) as netto_ha
from feld_anbau_abschnitt ab
join feld_anbau fa on fa.id = ab.feld_anbau_id
join feld f on f.id = fa.feld_id;
alter view feld_anbau_abschnitt_berechnet set (security_invoker = true);
grant select on feld_anbau_abschnitt_berechnet to authenticated;

-- feld_anbau_vorjahr_uebernehmen: pflanzjahr wird UNVERÄNDERT kopiert (kein
-- +1 mehr - es ist ein fester Kalenderjahrgang, das abgeleitete Standjahr
-- stimmt dadurch für jede Saison automatisch, auch nach mehreren
-- übersprungenen Jahren).
create or replace function feld_anbau_vorjahr_uebernehmen(
  p_saison_jahr int,
  p_quelle_jahr int
) returns int language plpgsql security invoker as $$
declare
  v_alt record;
  v_neu_anbau_id bigint;
  v_alt_ab record;
  uebernommen int := 0;
begin
  for v_alt in
    select * from feld_anbau where saison_jahr = p_quelle_jahr
  loop
    if exists (
      select 1 from feld_anbau
      where feld_id = v_alt.feld_id and saison_jahr = p_saison_jahr
    ) then
      continue;
    end if;

    insert into feld_anbau (feld_id, saison_jahr, notiz)
    values (v_alt.feld_id, p_saison_jahr, v_alt.notiz)
    returning id into v_neu_anbau_id;

    for v_alt_ab in
      select * from feld_anbau_abschnitt where feld_anbau_id = v_alt.id
    loop
      insert into feld_anbau_abschnitt (
        feld_anbau_id, bezeichnung, reihenlaenge_m, reihen_anzahl,
        reihenabstand_m, pflanzen_pro_lfm, sorte, pflanzjahr, pflanztyp,
        cotura_nr, notiz, position,
        ausrichtungslinie_geojson, reihenlaenge_min_m, reihenlaenge_max_m,
        laufmeter_gesamt_m, reihen_versatz_m,
        reihen_erster_index, reihen_letzter_index, reihen_fahrgassen
      ) values (
        v_neu_anbau_id, v_alt_ab.bezeichnung, v_alt_ab.reihenlaenge_m,
        v_alt_ab.reihen_anzahl, v_alt_ab.reihenabstand_m,
        v_alt_ab.pflanzen_pro_lfm, v_alt_ab.sorte,
        v_alt_ab.pflanzjahr,
        v_alt_ab.pflanztyp, v_alt_ab.cotura_nr, v_alt_ab.notiz, v_alt_ab.position,
        v_alt_ab.ausrichtungslinie_geojson, v_alt_ab.reihenlaenge_min_m,
        v_alt_ab.reihenlaenge_max_m, v_alt_ab.laufmeter_gesamt_m,
        v_alt_ab.reihen_versatz_m,
        v_alt_ab.reihen_erster_index, v_alt_ab.reihen_letzter_index,
        v_alt_ab.reihen_fahrgassen
      );
    end loop;

    uebernommen := uebernommen + 1;
  end loop;
  return uebernommen;
end;
$$;
