-- ============================================================================
-- Migration 2026-10-31 (5): Grundlage für Anbauübersicht + Ernteplanung
-- (Nutzer-Vorgabe: "Anbauplanung gefällt mir jetzt richtig gut" + zwei neue
-- Bausteine - mehrjährige Übersicht und Maschineneinteilung nach Stückzahl).
--
-- Drei unabhängige, kleine Ergänzungen, keine Views:
--
-- 1) Verfrühung/Verspätung je Anbau-Abschnitt (frueh/mittel/spaet) - fehlte
--    bisher komplett im Datenmodell, wird für die Erntefenster-Abdeckung in
--    der Anbauübersicht gebraucht.
-- 2) feld_anbau.geplante_maschinen - reine Stückzahl-Planung für die
--    Ernteplanung. AUSDRÜCKLICH KEINE Zuordnung zu einzelnen Maschinen
--    (Nutzer-Vorgabe: Maschinen erkennen ihr Feld später selbst per GPS,
--    siehe docs/erntewirtschaft-plan.md) - deshalb keine Änderung an
--    ernte_maschine.
-- 3) ernte_konfig-Eintrag 'kapazitaet_lfm_je_maschine' - Planungsannahme,
--    wie viele Laufmeter Reihe eine Maschine über eine Saison schafft
--    (manuell nachjustierbar, kein Messwert). Nutzt die schon bestehende
--    generische ernte_konfig-Tabelle (migration_2026-10-20).
--
-- feld_anbau_vorjahr_uebernehmen() wird NICHT angefasst: geplante_maschinen
-- soll jede Saison bewusst neu entschieden werden (Standjahr-Verschiebung
-- ändert den Bedarf), verfruehung wird dagegen wie sorte/pflanztyp mit
-- übernommen (ändert sich kaum von Jahr zu Jahr).
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Verfrühung/Verspätung
-- --------------------------------------------------------------------------
alter table feld_anbau_abschnitt
  add column if not exists verfruehung text
    check (verfruehung is null or verfruehung in ('frueh', 'mittel', 'spaet'));

comment on column feld_anbau_abschnitt.verfruehung is
  'frueh = Minitunnel+Folie, mittel = nur Folie schwarze Seite oben, spaet = Folie weisse Seite oben. Null = keine Angabe.';

-- --------------------------------------------------------------------------
-- 2) Ernteplanung: reine Stückzahl, keine Maschinen-Zuordnung
-- --------------------------------------------------------------------------
alter table feld_anbau
  add column if not exists geplante_maschinen int;

comment on column feld_anbau.geplante_maschinen is
  'Anzahl Erntemaschinen, die der Nutzer fuer dieses Feld/Saison einplant - reine Stueckzahl, keine Zuordnung zu einzelnen Maschinen (die erkennen ihr Feld spaeter selbst per GPS).';

-- --------------------------------------------------------------------------
-- 3) Kapazitäts-Planungsannahme
-- --------------------------------------------------------------------------
insert into ernte_konfig (schluessel, wert, beschreibung) values
  ('kapazitaet_lfm_je_maschine', '2000', 'Planungsannahme Ernteplanung: ca. wie viele Laufmeter Reihe eine Maschine ueber eine Saison schafft (kein Messwert, manuell nachjustierbar)')
on conflict (schluessel) do nothing;

-- --------------------------------------------------------------------------
-- 4) feld_anbau_vorjahr_uebernehmen(): verfruehung mit übernehmen (gleiche
--    Ebene wie sorte/pflanztyp) - geplante_maschinen bewusst NICHT.
-- --------------------------------------------------------------------------
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
        reihen_erster_index, reihen_letzter_index, reihen_fahrgassen,
        verfruehung
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
        v_alt_ab.reihen_fahrgassen,
        v_alt_ab.verfruehung
      );
    end loop;

    uebernommen := uebernommen + 1;
  end loop;
  return uebernommen;
end;
$$;
