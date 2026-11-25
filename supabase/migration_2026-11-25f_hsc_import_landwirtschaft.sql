-- ============================================================================
-- Migration 2026-11-25f: HSC-Abgleich Landwirtschaft (Seite
-- /personal-import-hsc-lw, Logik lib/hscImportLw.ts).
--
-- Nutzer-Vorgabe 2026-11-25: der Landwirtschafts-Stamm wird gegen die
-- HSC-Exporte (Mömmel, Mönich Landwirtschaft) abgeglichen, HSC hat bei der
-- Personalnummer Vorrang. Dafür zwei Funktionen:
--
--   lw_personal_nr_umnummerieren(p_paare)  Personalnummern in EINEM Schritt
--       ändern (Ketten wie A bekommt Nr von B, B die von C funktionieren,
--       weil erst alle auf eine Zwischennummer gehen). Verknüpfte Kandidaten
--       der Personalplanung mit derselben alten Nummer ziehen mit.
--   lw_stamm_ergaenzen(p_daten)  Stammfelder vieler Personen auf einmal
--       setzen (nur eine feste Liste von Feldern).
--
-- Beide nur für admin/hr mit Bereich Landwirtschaft, nur für Personen aus
-- dem Bereich Landwirtschaft. Alles-oder-nichts (Fehler -> nichts geändert).
-- Jede Anweisung einzeln wiederholbar.
-- ============================================================================

create or replace function public.lw_personal_nr_umnummerieren(p_paare jsonb)
returns int language plpgsql security definer
set search_path = public
as $$
declare
  v_anzahl int;
  v_text text;
begin
  if not (hat_rolle(array['admin', 'hr']::user_role[]) and 'LW' = any (current_bereiche())) then
    raise exception 'Keine Berechtigung (nur Admin/Personal mit Bereich Landwirtschaft).';
  end if;

  create temp table if not exists _lw_umn (id uuid primary key, alt text, neu text) on commit drop;
  truncate _lw_umn;
  insert into _lw_umn (id, neu)
  select (x ->> 'id')::uuid, btrim(x ->> 'neu') from jsonb_array_elements(p_paare) x;
  update _lw_umn u set alt = e.personal_nr from employees e where e.id = u.id;
  get diagnostics v_anzahl = row_count;

  if exists (select 1 from _lw_umn where alt is null) then
    raise exception 'Unbekannte Person in der Liste.';
  end if;
  select string_agg(e.personal_nr, ', ') into v_text
    from _lw_umn u join employees e on e.id = u.id where e.bereich <> 'LW';
  if v_text is not null then
    raise exception 'Nur Personen der Landwirtschaft: %', v_text;
  end if;
  if exists (select 1 from _lw_umn where neu is null or neu = '' or neu ~ '^[A-Za-z]+-') then
    raise exception 'Ungültige neue Personalnummer.';
  end if;
  select string_agg(neu, ', ') into v_text
    from (select lower(neu) neu from _lw_umn group by 1 having count(*) > 1) d;
  if v_text is not null then
    raise exception 'Neue Nummer mehrfach vergeben: %', v_text;
  end if;
  -- Ziel-Nummer bei einer Person, die NICHT mit umnummeriert wird
  select string_agg(e.personal_nr, ', ') into v_text
    from _lw_umn u join employees e on lower(e.personal_nr) = lower(u.neu)
   where e.id not in (select id from _lw_umn);
  if v_text is not null then
    raise exception 'Nummer schon vergeben: %', v_text;
  end if;

  -- 1) Zwischennummern, 2) Zielnummern
  update employees e set personal_nr = '~umn~' || e.id from _lw_umn u where e.id = u.id;
  update employees e set personal_nr = u.neu from _lw_umn u where e.id = u.id;

  -- Kandidaten der Personalplanung, die mit der Person verknüpft sind
  update personal_kandidaten k set personal_nr = '~umn~' || k.id
    from _lw_umn u
   where (k.aktivierter_employee_id = u.id or k.verknuepfter_employee_id = u.id)
     and lower(k.personal_nr) = lower(u.alt);
  update personal_kandidaten k set personal_nr = u.neu
    from _lw_umn u
   where (k.aktivierter_employee_id = u.id or k.verknuepfter_employee_id = u.id)
     and k.personal_nr = '~umn~' || k.id;

  return v_anzahl;
end;
$$;
revoke all on function public.lw_personal_nr_umnummerieren(jsonb) from public, anon;
grant execute on function public.lw_personal_nr_umnummerieren(jsonb) to authenticated;

create or replace function public.lw_stamm_ergaenzen(p_daten jsonb)
returns int language plpgsql security definer
set search_path = public
as $$
declare
  v_erlaubt text[] := array[
    'name', 'vorname', 'geburtsdatum', 'geschlecht', 'geburtsname', 'geburtsort',
    'staatsangehoerigkeit', 'nationalitaet', 'familienstand', 'strasse', 'hausnummer',
    'plz', 'ort', 'land', 'telefon_privat', 'email_privat', 'sozialversicherungsnummer',
    'steuer_id', 'iban', 'bic', 'zahlungsempfaenger', 'notiz'];
  v_text text;
  v_anzahl int;
begin
  if not (hat_rolle(array['admin', 'hr']::user_role[]) and 'LW' = any (current_bereiche())) then
    raise exception 'Keine Berechtigung (nur Admin/Personal mit Bereich Landwirtschaft).';
  end if;
  select string_agg(distinct k, ', ') into v_text
    from jsonb_array_elements(p_daten) x, jsonb_object_keys(x -> 'patch') k
   where k <> all (v_erlaubt);
  if v_text is not null then
    raise exception 'Feld nicht erlaubt: %', v_text;
  end if;
  select string_agg(e.personal_nr, ', ') into v_text
    from jsonb_array_elements(p_daten) x join employees e on e.id = (x ->> 'id')::uuid
   where e.bereich <> 'LW';
  if v_text is not null then
    raise exception 'Nur Personen der Landwirtschaft: %', v_text;
  end if;

  update employees e
     set (name, vorname, geburtsdatum, geschlecht, geburtsname, geburtsort,
          staatsangehoerigkeit, nationalitaet, familienstand, strasse, hausnummer,
          plz, ort, land, telefon_privat, email_privat, sozialversicherungsnummer,
          steuer_id, iban, bic, zahlungsempfaenger, notiz)
       = (select r.name, r.vorname, r.geburtsdatum, r.geschlecht, r.geburtsname, r.geburtsort,
                 r.staatsangehoerigkeit, r.nationalitaet, r.familienstand, r.strasse, r.hausnummer,
                 r.plz, r.ort, r.land, r.telefon_privat, r.email_privat, r.sozialversicherungsnummer,
                 r.steuer_id, r.iban, r.bic, r.zahlungsempfaenger, r.notiz
            from jsonb_populate_record(e, d.patch) r)
    from (select (x ->> 'id')::uuid as id, x -> 'patch' as patch from jsonb_array_elements(p_daten) x) d
   where e.id = d.id;
  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;
revoke all on function public.lw_stamm_ergaenzen(jsonb) from public, anon;
grant execute on function public.lw_stamm_ergaenzen(jsonb) to authenticated;
