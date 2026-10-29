-- ============================================================================
-- Migration 2026-10-30 (2): Reihen-Versatz (Nachbar-Feinjustierung)
--
-- Nutzer-Vorgabe: nach dem Einzeichnen der Ausrichtungslinie soll sich die
-- GESAMTE berechnete Reihenschar per zwei Pfeiltasten in 10-cm-Schritten
-- seitlich verschieben lassen (z.B. um sie näher an einen Nachbarn zu
-- rücken oder weiter weg) - die jeweils äußerste Reihe verschwindet dabei
-- von selbst, sobald sie den (in der vorigen Migration eingeführten)
-- 3-m-Randabstand zur Feldgrenze unterschreitet. Das passiert bereits
-- automatisch über die bestehende Beschneidung an der gepufferten
-- Feldkontur - nötig ist nur ein zusätzlicher, persistenter Versatz-Wert,
-- um den die Reihen-Ankerlinie vor der Berechnung verschoben wird.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Die alte 4-Parameter-
-- Signatur wird zuerst explizit gedroppt (wie schon bei der vorigen
-- Erweiterung), um Überladungen zu vermeiden.
-- ============================================================================

alter table feld_anbau_abschnitt
  add column if not exists reihen_versatz_m numeric(5, 2) not null default 0;

drop function if exists feld_reihen_aus_ausrichtung_berechnen(bigint, text, numeric, numeric);

create or replace function feld_reihen_aus_ausrichtung_berechnen(
  p_feld_id bigint,
  p_linie_geojson text,
  p_reihenabstand_m numeric,
  p_randabstand_m numeric default 3,
  p_versatz_m numeric default 0
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
  -- Normale (90° gedreht) - Richtung der parallelen Versätze UND des
  -- manuellen Nutzer-Versatzes (Pfeiltasten).
  v_px := -v_uy;
  v_py := v_ux;

  -- Linien-Mittelpunkt als Anker für Versatz 0, plus den manuellen,
  -- persistierten Nutzer-Versatz (feld_anbau_abschnitt.reihen_versatz_m) -
  -- verschiebt die GESAMTE Reihenschar seitlich, ohne die ursprünglich
  -- gezeichnete Linie selbst zu verändern.
  v_anchor_x := (ST_X(v_p1) + ST_X(v_p2)) / 2 + p_versatz_m * v_px;
  v_anchor_y := (ST_Y(v_p1) + ST_Y(v_p2)) / 2 + p_versatz_m * v_py;

  v_env := ST_Envelope(v_poly);
  v_diag := sqrt(
    power(ST_XMax(v_env) - ST_XMin(v_env), 2) + power(ST_YMax(v_env) - ST_YMin(v_env), 2)
  );
  v_max_n := ceil(v_diag / p_reihenabstand_m)::int + 2;

  for i in -v_max_n..v_max_n loop
    v_offset_x := v_anchor_x + i * p_reihenabstand_m * v_px;
    v_offset_y := v_anchor_y + i * p_reihenabstand_m * v_py;

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
        continue;
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
grant execute on function feld_reihen_aus_ausrichtung_berechnen(bigint, text, numeric, numeric, numeric) to authenticated;

-- feld_anbau_vorjahr_uebernehmen: reihen_versatz_m mit übernehmen, gleiches
-- Prinzip wie die übrigen geometriebezogenen Spalten.
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
        laufmeter_gesamt_m, reihen_versatz_m
      ) values (
        v_neu_anbau_id, v_alt_ab.bezeichnung, v_alt_ab.reihenlaenge_m,
        v_alt_ab.reihen_anzahl, v_alt_ab.reihenabstand_m,
        v_alt_ab.pflanzen_pro_lfm, v_alt_ab.sorte,
        case when v_alt_ab.standjahr is not null then v_alt_ab.standjahr + 1 end,
        v_alt_ab.pflanztyp, v_alt_ab.cotura_nr, v_alt_ab.notiz, v_alt_ab.position,
        v_alt_ab.ausrichtungslinie_geojson, v_alt_ab.reihenlaenge_min_m,
        v_alt_ab.reihenlaenge_max_m, v_alt_ab.laufmeter_gesamt_m,
        v_alt_ab.reihen_versatz_m
      );
    end loop;

    uebernommen := uebernommen + 1;
  end loop;
  return uebernommen;
end;
$$;
