-- ============================================================================
-- Migration 2026-10-31 (3): Fahrgassen - einfacher Abzug von der Reihenzahl
--
-- Nutzer-Vorgabe: Fahrgassen (unbepflanzte Technikgassen innerhalb der
-- ausgewählten Reihen) sollen als einfache Zahl eingegeben und von der
-- Reihenanzahl abgezogen werden, damit Reihenzahl/Laufmeter/Netto-Fläche/
-- Pflanzenzahl konsistent bleiben. Bewusst KEIN Versuch, einzelne Reihen als
-- "das ist eine Fahrgasse" zu markieren (welche genau, ist für die Zahlen
-- unerheblich) - reine Arithmetik auf Client-Seite (siehe
-- components/ReihenAusrichtungKarte.tsx), die RPC
-- feld_reihen_aus_ausrichtung_berechnen() bleibt unverändert.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug).
-- ============================================================================

alter table feld_anbau_abschnitt
  add column if not exists reihen_fahrgassen int not null default 0;

comment on column feld_anbau_abschnitt.reihen_fahrgassen is
  'Anzahl unbepflanzter Fahrgassen innerhalb der ausgewählten ersten/letzten Reihe - wird clientseitig von der rohen Reihenzahl (und proportional vom Laufmeter) abgezogen, bevor reihen_anzahl/laufmeter_gesamt_m geschrieben werden.';

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
        reihenabstand_m, pflanzen_pro_lfm, sorte, standjahr, pflanztyp,
        cotura_nr, notiz, position,
        ausrichtungslinie_geojson, reihenlaenge_min_m, reihenlaenge_max_m,
        laufmeter_gesamt_m, reihen_versatz_m,
        reihen_erster_index, reihen_letzter_index, reihen_fahrgassen
      ) values (
        v_neu_anbau_id, v_alt_ab.bezeichnung, v_alt_ab.reihenlaenge_m,
        v_alt_ab.reihen_anzahl, v_alt_ab.reihenabstand_m,
        v_alt_ab.pflanzen_pro_lfm, v_alt_ab.sorte,
        case when v_alt_ab.standjahr is not null then v_alt_ab.standjahr + 1 end,
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
