-- ============================================================================
-- Migration 2026-10-31: Erste/letzte Reihe statt Randabstand-Puffer
--
-- Nutzer-Vorgabe: der pauschale 3m-Randabstand (ST_Buffer, Migration
-- 2026-10-30) war bei unförmigen Feldkonturen mal zu viel, mal zu wenig -
-- robuster: der Nutzer zeichnet die ERSTE und die LETZTE echte Reihe exakt
-- nach (statt nur einer "Ausrichtungslinie" irgendwo auf dem Feld). Die
-- Reihenzahl ergibt sich aus dem Abstand zwischen beiden Linien geteilt
-- durch den Reihenabstand, alle Zwischen-Reihen liegen exakt gleichmäßig
-- dazwischen - keine geschätzte Marge mehr nötig, weil beide Außengrenzen
-- selbst schon echte, nachgezeichnete Reihen sind.
--
-- ausrichtungslinie_geojson behält seine Bedeutung (jetzt explizit: erste
-- Reihe), neu dazu kommt ausrichtungslinie_letzte_geojson.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Alle älteren Signaturen
-- von feld_reihen_aus_ausrichtung_berechnen() werden zuerst explizit
-- gedroppt (gleiches Vorgehen wie bei den vorigen Erweiterungen).
-- ============================================================================

alter table feld_anbau_abschnitt
  add column if not exists ausrichtungslinie_letzte_geojson text;

drop function if exists feld_reihen_aus_ausrichtung_berechnen(bigint, text, numeric);
drop function if exists feld_reihen_aus_ausrichtung_berechnen(bigint, text, numeric, numeric);
drop function if exists feld_reihen_aus_ausrichtung_berechnen(bigint, text, numeric, numeric, numeric);

create or replace function feld_reihen_aus_ausrichtung_berechnen(
  p_feld_id bigint,
  p_linie_erste_geojson text,
  p_linie_letzte_geojson text,
  p_reihenabstand_m numeric,
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
  v_linie_a geometry;
  v_linie_b geometry;
  v_dir_a_x double precision;
  v_dir_a_y double precision;
  v_dir_b_x double precision;
  v_dir_b_y double precision;
  v_len double precision;
  v_dir_x double precision;
  v_dir_y double precision;
  v_norm_x double precision;
  v_norm_y double precision;
  v_mid_a_x double precision;
  v_mid_a_y double precision;
  v_mid_b_x double precision;
  v_mid_b_y double precision;
  v_delta double precision;
  v_n int;
  v_step double precision;
  v_env geometry;
  v_diag double precision;
  i int;
  v_s double precision;
  v_px double precision;
  v_py double precision;
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

  -- Keine Randabstand-Verkleinerung mehr - die volle, echte Feldkontur dient
  -- als Zuschnitt für die Reihenlänge, die Reihenzahl kommt allein aus dem
  -- Abstand zwischen den beiden vom Nutzer gezeichneten Grenz-Reihen.
  v_poly := ST_Transform(v_poly_4326, v_utm_srid);

  v_linie_a := ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(p_linie_erste_geojson), 4326), v_utm_srid);
  v_linie_b := ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(p_linie_letzte_geojson), 4326), v_utm_srid);

  v_dir_a_x := ST_X(ST_EndPoint(v_linie_a)) - ST_X(ST_StartPoint(v_linie_a));
  v_dir_a_y := ST_Y(ST_EndPoint(v_linie_a)) - ST_Y(ST_StartPoint(v_linie_a));
  v_len := sqrt(power(v_dir_a_x, 2) + power(v_dir_a_y, 2));
  if v_len = 0 then
    raise exception 'Erste Reihen-Linie hat keine Länge.';
  end if;
  v_dir_a_x := v_dir_a_x / v_len;
  v_dir_a_y := v_dir_a_y / v_len;

  v_dir_b_x := ST_X(ST_EndPoint(v_linie_b)) - ST_X(ST_StartPoint(v_linie_b));
  v_dir_b_y := ST_Y(ST_EndPoint(v_linie_b)) - ST_Y(ST_StartPoint(v_linie_b));
  v_len := sqrt(power(v_dir_b_x, 2) + power(v_dir_b_y, 2));
  if v_len = 0 then
    raise exception 'Letzte Reihen-Linie hat keine Länge.';
  end if;
  v_dir_b_x := v_dir_b_x / v_len;
  v_dir_b_y := v_dir_b_y / v_len;

  -- Falls die zweite Linie "rückwärts" geklickt wurde (Klickreihenfolge
  -- entgegengesetzt zur ersten) - Richtung spiegeln, bevor gemittelt wird,
  -- sonst würden sich beide Richtungsvektoren beim Mitteln aufheben.
  if (v_dir_a_x * v_dir_b_x + v_dir_a_y * v_dir_b_y) < 0 then
    v_dir_b_x := -v_dir_b_x;
    v_dir_b_y := -v_dir_b_y;
  end if;

  v_dir_x := v_dir_a_x + v_dir_b_x;
  v_dir_y := v_dir_a_y + v_dir_b_y;
  v_len := sqrt(power(v_dir_x, 2) + power(v_dir_y, 2));
  v_dir_x := v_dir_x / v_len;
  v_dir_y := v_dir_y / v_len;
  -- Normale (90° gedreht) - Richtung zwischen den Reihen.
  v_norm_x := -v_dir_y;
  v_norm_y := v_dir_x;

  v_mid_a_x := (ST_X(ST_StartPoint(v_linie_a)) + ST_X(ST_EndPoint(v_linie_a))) / 2;
  v_mid_a_y := (ST_Y(ST_StartPoint(v_linie_a)) + ST_Y(ST_EndPoint(v_linie_a))) / 2;
  v_mid_b_x := (ST_X(ST_StartPoint(v_linie_b)) + ST_X(ST_EndPoint(v_linie_b))) / 2;
  v_mid_b_y := (ST_Y(ST_StartPoint(v_linie_b)) + ST_Y(ST_EndPoint(v_linie_b))) / 2;

  -- Signierter Abstand von der ersten zur letzten Reihe entlang der Normalen.
  v_delta := (v_mid_b_x - v_mid_a_x) * v_norm_x + (v_mid_b_y - v_mid_a_y) * v_norm_y;
  v_n := round(abs(v_delta) / p_reihenabstand_m)::int;
  if v_n < 1 then
    raise exception 'Erste und letzte Reihe liegen zu dicht beieinander (Abstand % m) - bitte die letzte Reihe erneut einzeichnen.',
      round(abs(v_delta)::numeric, 2);
  end if;
  -- Effektiver Reihenabstand: verteilt den echten, gemessenen Gesamtabstand
  -- gleichmäßig auf v_n Intervalle - reproduziert exakt die beiden
  -- gezeichneten Grenz-Reihen, statt einen eventuellen Rest auf eine Seite
  -- zu schlagen.
  v_step := v_delta / v_n;

  v_env := ST_Envelope(v_poly);
  v_diag := sqrt(
    power(ST_XMax(v_env) - ST_XMin(v_env), 2) + power(ST_YMax(v_env) - ST_YMin(v_env), 2)
  );

  for i in 0..v_n loop
    v_s := i * v_step + p_versatz_m;
    v_px := v_mid_a_x + v_s * v_norm_x;
    v_py := v_mid_a_y + v_s * v_norm_y;

    v_row_line := ST_SetSRID(
      ST_MakeLine(
        ST_MakePoint(v_px - v_diag * v_dir_x, v_py - v_diag * v_dir_y),
        ST_MakePoint(v_px + v_diag * v_dir_x, v_py + v_diag * v_dir_y)
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
grant execute on function feld_reihen_aus_ausrichtung_berechnen(bigint, text, text, numeric, numeric) to authenticated;

-- feld_anbau_vorjahr_uebernehmen: zweite Linie mit übernehmen, gleiches
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
        ausrichtungslinie_geojson, ausrichtungslinie_letzte_geojson,
        reihenlaenge_min_m, reihenlaenge_max_m,
        laufmeter_gesamt_m, reihen_versatz_m
      ) values (
        v_neu_anbau_id, v_alt_ab.bezeichnung, v_alt_ab.reihenlaenge_m,
        v_alt_ab.reihen_anzahl, v_alt_ab.reihenabstand_m,
        v_alt_ab.pflanzen_pro_lfm, v_alt_ab.sorte,
        case when v_alt_ab.standjahr is not null then v_alt_ab.standjahr + 1 end,
        v_alt_ab.pflanztyp, v_alt_ab.cotura_nr, v_alt_ab.notiz, v_alt_ab.position,
        v_alt_ab.ausrichtungslinie_geojson, v_alt_ab.ausrichtungslinie_letzte_geojson,
        v_alt_ab.reihenlaenge_min_m, v_alt_ab.reihenlaenge_max_m, v_alt_ab.laufmeter_gesamt_m,
        v_alt_ab.reihen_versatz_m
      );
    end loop;

    uebernommen := uebernommen + 1;
  end loop;
  return uebernommen;
end;
$$;
