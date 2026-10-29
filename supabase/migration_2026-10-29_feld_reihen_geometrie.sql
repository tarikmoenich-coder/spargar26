-- ============================================================================
-- Migration 2026-10-29: Reihen-Geometrie aus der echten Feldkontur berechnen
--
-- Nutzer-Vorgabe: Spargeläcker haben oft unförmige Konturen - die Reihen
-- sind dadurch unterschiedlich lang. Statt einer einzigen geschätzten
-- "Reihenlänge" je Abschnitt (app/anbau/spargel) soll aus der echten
-- Feldkontur (feld.geometrie) + einer vom Nutzer auf der Karte
-- eingezeichneten "Ausrichtungslinie" (Position + Richtung EINER Reihe) die
-- komplette Reihen-Geometrie parallel dazu erzeugt und an der Kontur
-- beschnitten werden - liefert exakte Reihenzahl, Laufmeter gesamt und
-- Reihenlänge Min/Max/Ø statt einer groben Schätzung.
--
-- Bekannte, akzeptierte Einschränkung: die Berechnung nutzt immer die GANZE
-- feld.geometrie - bei mehreren Abschnitten auf demselben Feld (heute die
-- Ausnahme, siehe migration_2026-10-19_feld_anbau_schema.sql) würde sie
-- überzählen. Eine Teilflächen-Unterteilung je Abschnitt ist nicht Teil
-- dieser Migration.
--
-- UTM-Zone wird je Feld DYNAMISCH aus dem Längengrad bestimmt (ETRS89-UTM,
-- EPSG 25828-25838 je nach Zone) statt fest codiert - nur in einer
-- projizierten, metrischen Zone sind Meter-Versätze/-Längen exakt (der
-- geography-Typ, den z.B. feld_geojson.flaeche_brutto_ha schon für Flächen
-- nutzt, unterstützt keine Translation).
--
-- In der Supabase SQL-Konsole ausführen (ein Zug).
-- ============================================================================

alter table feld_anbau_abschnitt
  add column if not exists ausrichtungslinie_geojson text,
  add column if not exists reihenlaenge_min_m numeric(7, 2),
  add column if not exists reihenlaenge_max_m numeric(7, 2),
  add column if not exists laufmeter_gesamt_m numeric(10, 2);

-- ----------------------------------------------------------------------
-- Neue Funktion: liefert ein Teilstück je zusammenhängendem Reihenabschnitt
-- (eine Kerbe in der Feldkontur kann eine Reihe in mehrere Teile
-- zerschneiden - die werden einzeln gezählt statt fälschlich zu einer
-- Länge summiert). Aggregation (Anzahl/Summe/Min/Max) macht die Client-
-- Seite daraus, die Einzel-Geometrien dienen zusätzlich der Kartenvorschau.
-- ----------------------------------------------------------------------
create or replace function feld_reihen_aus_ausrichtung_berechnen(
  p_feld_id bigint,
  p_linie_geojson text,
  p_reihenabstand_m numeric
) returns table (
  reihen_index int,
  teil_index int,
  laenge_m numeric,
  geom_geojson text
) language plpgsql security invoker as $$
declare
  v_poly_4326 geometry;
  v_utm_srid int;
  v_poly geometry;
  v_linie geometry;
  v_p1 geometry;
  v_p2 geometry;
  v_dx double precision;
  v_dy double precision;
  v_len double precision;
  v_ux double precision;
  v_uy double precision;
  v_px double precision;
  v_py double precision;
  v_anchor_x double precision;
  v_anchor_y double precision;
  v_env geometry;
  v_diag double precision;
  v_max_n int;
  i int;
  v_offset_x double precision;
  v_offset_y double precision;
  v_row_line geometry;
  v_clipped geometry;
  v_dump record;
  v_teil int;
begin
  if p_reihenabstand_m is null or p_reihenabstand_m <= 0 then
    raise exception 'Reihenabstand muss größer 0 sein.';
  end if;

  select geometrie into v_poly_4326 from feld where id = p_feld_id;
  if v_poly_4326 is null then
    return;
  end if;

  v_utm_srid := 25800 + floor((ST_X(ST_Centroid(v_poly_4326)) + 180) / 6)::int + 1;

  v_poly := ST_Transform(v_poly_4326, v_utm_srid);
  v_linie := ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(p_linie_geojson), 4326), v_utm_srid);

  v_p1 := ST_StartPoint(v_linie);
  v_p2 := ST_EndPoint(v_linie);
  v_dx := ST_X(v_p2) - ST_X(v_p1);
  v_dy := ST_Y(v_p2) - ST_Y(v_p1);
  v_len := sqrt(power(v_dx, 2) + power(v_dy, 2));
  if v_len = 0 then
    raise exception 'Ausrichtungslinie hat keine Länge.';
  end if;
  v_ux := v_dx / v_len;
  v_uy := v_dy / v_len;
  -- Normale (90° gedreht) - Richtung der parallelen Versätze.
  v_px := -v_uy;
  v_py := v_ux;

  -- Linien-Mittelpunkt als Anker für Versatz 0 - robust unabhängig davon,
  -- wo genau der Nutzer seine zwei Klicks gesetzt hat.
  v_anchor_x := (ST_X(v_p1) + ST_X(v_p2)) / 2;
  v_anchor_y := (ST_Y(v_p1) + ST_Y(v_p2)) / 2;

  v_env := ST_Envelope(v_poly);
  v_diag := sqrt(
    power(ST_XMax(v_env) - ST_XMin(v_env), 2) + power(ST_YMax(v_env) - ST_YMin(v_env), 2)
  );
  -- +2 Reihen Sicherheitsmarge über die berechnete Bounding-Box-Diagonale
  -- hinaus, falls die Ausrichtungslinie nicht exakt zentral liegt.
  v_max_n := ceil(v_diag / p_reihenabstand_m)::int + 2;

  for i in -v_max_n..v_max_n loop
    v_offset_x := v_anchor_x + i * p_reihenabstand_m * v_px;
    v_offset_y := v_anchor_y + i * p_reihenabstand_m * v_py;

    -- Lange Parallel-Linie quer durchs ganze Feld (2x Diagonale in beide
    -- Richtungen ab dem Versatzpunkt) - garantiert volle Abdeckung
    -- unabhängig von der Länge der vom Nutzer gezeichneten Linie.
    v_row_line := ST_MakeLine(
      ST_MakePoint(v_offset_x - v_diag * v_ux, v_offset_y - v_diag * v_uy),
      ST_MakePoint(v_offset_x + v_diag * v_ux, v_offset_y + v_diag * v_uy)
    );

    v_clipped := ST_Intersection(v_row_line, v_poly);
    if v_clipped is null or ST_IsEmpty(v_clipped) then
      continue;
    end if;

    v_teil := 0;
    for v_dump in select (dump).geom as geom from ST_Dump(v_clipped) as dump loop
      if ST_Length(v_dump.geom) < 0.5 then
        continue; -- Mini-Splitter (Rundungsrauschen an der Kontur) verwerfen
      end if;
      v_teil := v_teil + 1;
      reihen_index := i;
      teil_index := v_teil;
      laenge_m := round(ST_Length(v_dump.geom)::numeric, 2);
      geom_geojson := ST_AsGeoJSON(ST_Transform(v_dump.geom, 4326));
      return next;
    end loop;
  end loop;

  return;
end;
$$;
grant execute on function feld_reihen_aus_ausrichtung_berechnen(bigint, text, numeric) to authenticated;

-- ----------------------------------------------------------------------
-- feld_anbau_abschnitt_berechnet: Laufmeter/Fläche/Pflanzenzahl nutzen ab
-- sofort die exakten, geometrisch berechneten Laufmeter, sobald vorhanden -
-- manuell gepflegte Abschnitte (laufmeter_gesamt_m weiterhin null) rechnen
-- unverändert wie bisher (reihenlaenge_m × reihen_anzahl).
-- ----------------------------------------------------------------------
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
  ab.standjahr,
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

-- ----------------------------------------------------------------------
-- feld_anbau_vorjahr_uebernehmen: die vier neuen Spalten mit übernehmen -
-- die Feldform (und damit die Ausrichtungslinie) ändert sich von Saison zu
-- Saison nicht, genau wie reihenlaenge_m & Co. heute schon kopiert werden.
-- ----------------------------------------------------------------------
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
        laufmeter_gesamt_m
      ) values (
        v_neu_anbau_id, v_alt_ab.bezeichnung, v_alt_ab.reihenlaenge_m,
        v_alt_ab.reihen_anzahl, v_alt_ab.reihenabstand_m,
        v_alt_ab.pflanzen_pro_lfm, v_alt_ab.sorte,
        case when v_alt_ab.standjahr is not null then v_alt_ab.standjahr + 1 end,
        v_alt_ab.pflanztyp, v_alt_ab.cotura_nr, v_alt_ab.notiz, v_alt_ab.position,
        v_alt_ab.ausrichtungslinie_geojson, v_alt_ab.reihenlaenge_min_m,
        v_alt_ab.reihenlaenge_max_m, v_alt_ab.laufmeter_gesamt_m
      );
      -- pflanzdatum bewusst nicht übernommen, wie beim Vorgänger.
    end loop;

    uebernommen := uebernommen + 1;
  end loop;
  return uebernommen;
end;
$$;
