-- Kassenbücher Phase 2: Kassenprüfung je Buch.
-- cash_checks bekommt kassenbuch_id (bestehende Zeilen -> Mömmel Lohnkasse).
-- ist_kassenpruefung_gesperrt() bleibt in Signatur UND Bedeutung gleich
-- (= Lohnkasse) - die 5 Aufrufstellen im Lohn-/Vorschuss-Code und die zwei
-- RLS-Policies auf advances/cash_deposits werden NICHT angefasst. Für die
-- neuen Bücher gibt es eine eigene Sperr-Funktion.

-- ---------------------------------------------------------------------------
-- cash_checks je Kassenbuch
-- ---------------------------------------------------------------------------
alter table cash_checks
  add column if not exists kassenbuch_id bigint references kassenbuch (id);

update cash_checks
set kassenbuch_id = (select id from kassenbuch where typ = 'lohnkasse')
where kassenbuch_id is null;

alter table cash_checks alter column kassenbuch_id set not null;

create index if not exists idx_cash_checks_buch
  on cash_checks (kassenbuch_id, check_zeit desc);

-- ---------------------------------------------------------------------------
-- Sperr-Funktionen
-- ---------------------------------------------------------------------------
-- Lohnkasse: gleiche Bedeutung wie bisher (alle Alt-Zeilen sind Lohnkasse),
-- nur explizit auf typ = 'lohnkasse' eingegrenzt, damit eine freigegebene
-- Prüfung eines anderen Buchs die Lohn-/Vorschuss-Belege nicht mitsperrt.
create or replace function ist_kassenpruefung_gesperrt(p_datum timestamptz)
returns boolean language sql stable security definer as $$
  select exists (
    select 1
    from cash_checks c
    join kassenbuch kb on kb.id = c.kassenbuch_id
    where c.freigegeben = true
      and kb.typ = 'lohnkasse'
      and p_datum >= c.period_from
      and p_datum <= c.period_to
  );
$$;

-- Für die "allgemeinen" Bücher: ist das Kassenbuch-Datum durch eine
-- freigegebene Prüfung genau dieses Buchs gesperrt?
create or replace function ist_kassenbuch_pruefung_gesperrt(
  p_datum date,
  p_kassenbuch_id bigint
)
returns boolean language sql stable security definer as $$
  select exists (
    select 1
    from cash_checks c
    where c.kassenbuch_id = p_kassenbuch_id
      and c.freigegeben = true
      and p_datum >= c.period_from::date
      and p_datum <= c.period_to::date
  );
$$;
grant execute on function ist_kassenbuch_pruefung_gesperrt(date, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Sperre in die Buchungs-/Umbuchungs-/Storno-Funktionen einbauen
-- (die "-- Phase 2:"-Marker aus Phase 1 werden hier ausgefüllt).
-- ---------------------------------------------------------------------------
create or replace function kassenbuch_buchen(
  p_kassenbuch_id bigint,
  p_richtung text,
  p_betrag numeric,
  p_datum_kassenbuch date,
  p_verwendungszweck text,
  p_hinweis text default null
)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_datum date := coalesce(p_datum_kassenbuch, current_date);
begin
  if current_role_name() not in ('admin', 'kasse') then
    raise exception 'Keine Berechtigung für Kassenbuch-Buchungen';
  end if;
  if p_richtung not in ('eingang', 'ausgang') then
    raise exception 'Ungültige Richtung: %', p_richtung;
  end if;
  if p_betrag is null or p_betrag <= 0 then
    raise exception 'Betrag muss größer als 0 sein';
  end if;
  if ist_kassenbuch_pruefung_gesperrt(v_datum, p_kassenbuch_id) then
    raise exception 'Für dieses Datum gibt es bereits eine freigegebene Kassenprüfung dieses Buchs. Bitte zunächst die Kassenprüfung wiedereröffnen.';
  end if;

  insert into kassenbuch_buchung (
    kassenbuch_id, belegnummer, datum_kassenbuch, betrag, richtung,
    verwendungszweck, hinweis
  ) values (
    p_kassenbuch_id, kassenbuch_naechste_belegnummer(p_kassenbuch_id),
    v_datum, p_betrag, p_richtung,
    nullif(btrim(p_verwendungszweck), ''), nullif(btrim(p_hinweis), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

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

  insert into kassenbuch_buchung (
    kassenbuch_id, belegnummer, datum_kassenbuch, betrag, richtung,
    verwendungszweck, hinweis, umbuchung_id
  ) values (
    p_quelle_id, kassenbuch_naechste_belegnummer(p_quelle_id), v_datum,
    p_betrag, 'ausgang',
    coalesce(v_zweck, 'Umbuchung an ' || v_ziel_name), v_hinweis, v_umb
  )
  returning id into v_aus_id;
  insert into kassenbuch_buchung (
    kassenbuch_id, belegnummer, datum_kassenbuch, betrag, richtung,
    verwendungszweck, hinweis, umbuchung_id, gegenbuchung_id
  ) values (
    p_ziel_id, kassenbuch_naechste_belegnummer(p_ziel_id), v_datum,
    p_betrag, 'eingang',
    coalesce(v_zweck, 'Umbuchung von ' || v_quelle_name), v_hinweis, v_umb, v_aus_id
  )
  returning id into v_ein_id;
  update kassenbuch_buchung set gegenbuchung_id = v_ein_id where id = v_aus_id;
  return v_umb;
end;
$$;

create or replace function kassenbuch_buchung_stornieren(
  p_buchung_id bigint,
  p_grund text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row kassenbuch_buchung%rowtype;
  v_gegen kassenbuch_buchung%rowtype;
begin
  if current_role_name() not in ('admin', 'kasse') then
    raise exception 'Keine Berechtigung für Storno';
  end if;
  if p_grund is null or btrim(p_grund) = '' then
    raise exception 'Ein Storno-Grund ist erforderlich';
  end if;
  select * into v_row from kassenbuch_buchung where id = p_buchung_id;
  if not found then
    raise exception 'Buchung nicht gefunden';
  end if;
  if v_row.storniert then
    raise exception 'Buchung ist bereits storniert';
  end if;
  if ist_kassenbuch_pruefung_gesperrt(v_row.datum_kassenbuch, v_row.kassenbuch_id) then
    raise exception 'Diese Buchung fällt in eine bereits freigegebene Kassenprüfung und kann nicht storniert werden. Bitte zunächst die Kassenprüfung wiedereröffnen.';
  end if;
  if v_row.umbuchung_id is not null then
    select * into v_gegen from kassenbuch_buchung
    where umbuchung_id = v_row.umbuchung_id and id <> v_row.id;
    if found and ist_kassenbuch_pruefung_gesperrt(v_gegen.datum_kassenbuch, v_gegen.kassenbuch_id) then
      raise exception 'Die Gegenbuchung fällt in eine bereits freigegebene Kassenprüfung. Bitte zunächst die betroffene Kassenprüfung wiedereröffnen.';
    end if;
  end if;

  update kassenbuch_buchung
  set storniert = true, storniert_am = now(), storniert_von = auth.uid(),
      storno_grund = btrim(p_grund)
  where id = p_buchung_id
     or (v_row.umbuchung_id is not null and umbuchung_id = v_row.umbuchung_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Eröffnungssaldo sperren, sobald das Buch eine freigegebene Prüfung hat.
-- ---------------------------------------------------------------------------
create or replace function kassenbuch_eroeffnung_schutz()
returns trigger language plpgsql as $$
begin
  if new.eroeffnungssaldo is distinct from old.eroeffnungssaldo
     and exists (
       select 1 from cash_checks
       where kassenbuch_id = old.id and freigegeben = true
     ) then
    raise exception 'Der Eröffnungssaldo kann nicht mehr geändert werden - das Kassenbuch hat bereits eine freigegebene Kassenprüfung.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kassenbuch_eroeffnung_schutz on kassenbuch;
create trigger trg_kassenbuch_eroeffnung_schutz before update on kassenbuch
  for each row execute function kassenbuch_eroeffnung_schutz();
