-- ============================================================================
-- Migration 2026-10-30: Randabstand (Vorgewende) in der Reihen-Berechnung
--
-- Nutzer-Vorgabe: feld_reihen_aus_ausrichtung_berechnen() soll einen festen
-- Abstand zur Feldgrenze berücksichtigen (Vorgewende zum Wenden der
-- Erntemaschine - Reihen reichen praktisch nie bis an den echten
-- Feldrand). Neuer Parameter p_randabstand_m (Default 3, wie vom Nutzer
-- angegeben) - CREATE OR REPLACE FUNCTION mit einem zusätzlichen
-- Default-Parameter am Ende ist erlaubt, ohne die Funktion zu droppen.
--
-- Umsetzung: die Feldgeometrie wird VOR der Reihen-Berechnung per
-- ST_Buffer(..., -p_randabstand_m) nach innen verkleinert (funktioniert nur
-- korrekt in der metrischen UTM-Zone, daher nach dem ST_Transform) - alle
-- Reihen werden danach wie gehabt an dieser verkleinerten Kontur
-- beschnitten.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Die alte 3-Parameter-
-- Signatur wird zuerst explizit gedroppt (statt sich auf CREATE OR REPLACE
-- zu verlassen) - vermeidet jedes Risiko, dass beide Fassungen als zwei
-- getrennte Überladungen nebeneinander stehen bleiben.
-- ============================================================================

drop function if exists feld_reihen_aus_ausrichtung_berechnen(bigint, text, numeric);

create or replace function feld_reihen_aus_ausrichtung_berechnen(
  p_feld_id bigint,
  p_linie_geojson text,
  p_reihenabstand_m numeric,
  p_randabstand_m numeric default 3
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
  if p_randabstand_m is null or p_randabstand_m < 0 then
    raise exception 'Randabstand darf nicht negativ sein.';
  end if;

  select geometrie into v_poly_4326 from feld where id = p_feld_id;
  if v_poly_4326 is null then
    return;
  end if;

  v_utm_srid := 25800 + floor((ST_X(ST_Centroid(v_poly_4326)) + 180) / 6)::int + 1;

  v_poly := ST_Transform(v_poly_4326, v_utm_srid);
  -- Vorgewende: Feldkontur um den Randabstand nach innen verkleinern, BEVOR
  -- die Reihen daran beschnitten werden - alles danach rechnet transparent
  -- gegen diese verkleinerte Fläche weiter.
  if p_randabstand_m > 0 then
    v_poly := ST_Buffer(v_poly, -p_randabstand_m);
  end if;
  if v_poly is null or ST_IsEmpty(v_poly) then
    return; -- Feld schmaler als 2x Randabstand - keine Fläche übrig
  end if;

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
    -- ST_MakePoint/ST_MakeLine setzen KEINE SRID (bleibt 0) - ohne
    -- ST_SetSRID hier bricht ST_Intersection gegen v_poly (SRID v_utm_srid)
    -- mit "mixed SRID geometries" ab (Praxis-Fehler 2026-10-30).
    v_row_line := ST_SetSRID(
      ST_MakeLine(
        ST_MakePoint(v_offset_x - v_diag * v_ux, v_offset_y - v_diag * v_uy),
        ST_MakePoint(v_offset_x + v_diag * v_ux, v_offset_y + v_diag * v_uy)
      ),
      v_utm_srid
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
grant execute on function feld_reihen_aus_ausrichtung_berechnen(bigint, text, numeric, numeric) to authenticated;
