-- Umbuchung zwischen zwei Kassenbüchern: beide Zeilen (Ausgang im
-- Quellbuch, Eingang im Zielbuch) bekommen jetzt DIESELBE Belegnummer
-- statt zwei unterschiedlicher, je Buch eigener Nummern - Nutzer-Vorgabe
-- 2026-09-17: "Macht es nicht Sinn bei einer Umbuchung ... für beide
-- Kassenbücher dieselbe Belegnummer zu erzeugen?" Macht die Gegenbuchung
-- in beiden Journalen auf einen Blick als zusammengehörig erkennbar
-- (bisher nur über den Verwendungszweck-Text "Umbuchung an/von ..." bzw.
-- intern über umbuchung_id/gegenbuchung_id).
--
-- Voraussetzung: belegnummer war bisher GLOBAL eindeutig (ging bisher auf,
-- weil jede Nummer mit dem Kürzel ihres Buchs beginnt) - jetzt nur noch je
-- Kassenbuch eindeutig, sonst würde dieselbe Nummer auf beiden Seiten der
-- Unique-Regel widersprechen. Normale Ein-/Ausgabe-Buchungen bleiben wie
-- bisher je Buch nummeriert (kassenbuch_naechste_belegnummer, Kürzel-
-- Präfix), nur Umbuchungen bekommen ein eigenes Präfix "UB-" mit eigenem
-- Monats-Zähler.

alter table kassenbuch_buchung
  drop constraint if exists kassenbuch_buchung_belegnummer_key;
alter table kassenbuch_buchung
  drop constraint if exists kassenbuch_buchung_kassenbuch_id_belegnummer_key;
alter table kassenbuch_buchung
  add constraint kassenbuch_buchung_kassenbuch_id_belegnummer_key
  unique (kassenbuch_id, belegnummer);

create or replace function kassenbuch_umbuchen(
  p_quelle_id bigint,
  p_ziel_id bigint,
  p_betrag numeric,
  p_datum_kassenbuch date,
  p_verwendungszweck text default null,
  p_hinweis text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_umb uuid := gen_random_uuid();
  v_datum date := coalesce(p_datum_kassenbuch, current_date);
  v_zweck text := nullif(btrim(p_verwendungszweck), '');
  v_hinweis text := nullif(btrim(p_hinweis), '');
  v_quelle_name text;
  v_ziel_name text;
  v_beleg text;
  v_aus_id bigint;
  v_ein_id bigint;
begin
  if current_role_name() not in ('admin', 'kasse') then
    raise exception 'Keine Berechtigung für Umbuchungen';
  end if;
  if p_quelle_id = p_ziel_id then
    raise exception 'Quelle und Ziel müssen unterschiedliche Kassenbücher sein';
  end if;
  if p_betrag is null or p_betrag <= 0 then
    raise exception 'Betrag muss größer als 0 sein';
  end if;
  select bezeichnung into v_quelle_name from kassenbuch where id = p_quelle_id;
  select bezeichnung into v_ziel_name from kassenbuch where id = p_ziel_id;
  if v_quelle_name is null or v_ziel_name is null then
    raise exception 'Quell- oder Zielkassenbuch nicht gefunden';
  end if;
  if ist_kassenbuch_pruefung_gesperrt(v_datum, p_quelle_id)
     or ist_kassenbuch_pruefung_gesperrt(v_datum, p_ziel_id) then
    raise exception 'Für dieses Datum ist eines der beiden Kassenbücher durch eine freigegebene Kassenprüfung gesperrt.';
  end if;
  -- Eigener, buchübergreifender Zähler (nicht kassenbuch_naechste_belegnummer -
  -- die ist je Buch eigenständig und würde auf beiden Seiten unterschiedliche
  -- Nummern erzeugen) - beide Zeilen dieser Umbuchung bekommen dieselbe.
  v_beleg := naechste_belegnummer(
    'UB-' || to_char(now() at time zone 'Europe/Berlin', 'YYMM')
  );
  insert into kassenbuch_buchung (
    kassenbuch_id, belegnummer, datum_kassenbuch, betrag, richtung,
    verwendungszweck, hinweis, umbuchung_id
  ) values (
    p_quelle_id, v_beleg, v_datum,
    p_betrag, 'ausgang',
    coalesce(v_zweck, 'Umbuchung an ' || v_ziel_name), v_hinweis, v_umb
  )
  returning id into v_aus_id;
  insert into kassenbuch_buchung (
    kassenbuch_id, belegnummer, datum_kassenbuch, betrag, richtung,
    verwendungszweck, hinweis, umbuchung_id, gegenbuchung_id
  ) values (
    p_ziel_id, v_beleg, v_datum,
    p_betrag, 'eingang',
    coalesce(v_zweck, 'Umbuchung von ' || v_quelle_name), v_hinweis, v_umb, v_aus_id
  )
  returning id into v_ein_id;
  update kassenbuch_buchung set gegenbuchung_id = v_ein_id where id = v_aus_id;
  return v_umb;
end;
$$;
grant execute on function kassenbuch_umbuchen(bigint, bigint, numeric, date, text, text)
  to authenticated;
