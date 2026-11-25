-- ============================================================================
-- Migration 2026-11-25g: Personen zusammenführen / Saisonjahre verschieben
-- (Seite /personal-zusammenfuehren).
--
-- Nutzer-Vorgabe 2026-11-25 (nach dem HSC-Abgleich Landwirtschaft): Dubletten
-- im Personalstamm zusammenführen, und Saisonjahre, die durch falsch
-- vergebene Personalnummern an der falschen Person hängen, umhängen.
--
--   employees_zusammenfuehren(p_bleibt, p_weg)
--       zieht ALLES von p_weg auf p_bleibt um (jede Tabelle mit Verweis auf
--       employees - automatisch über die Fremdschlüssel, neue Tabellen sind
--       später von selbst dabei), füllt leere Stammfelder von p_bleibt aus
--       p_weg und LÖSCHT p_weg (Nutzer-Entscheidung; das Änderungsprotokoll
--       behält die alten Werte). Echte Überschneidungen (z.B. Stunden am
--       selben Tag, zwei offene Beschäftigungszeiträume, unterschiedliche
--       Firma in derselben Saison) -> Abbruch, nichts wird geändert.
--   employee_jahre_verschieben(p_von, p_nach, p_jahre)
--       hängt Saisonjahre (Anwesenheit, Firma je Saison, Beschäftigungs-
--       zeiträume mit Beginn in diesen Jahren) um. Verweigert, wenn in diesen
--       Jahren schon Stunden, Vorschüsse, Abrechnungen o.ä. an p_von hängen.
--
-- Nur admin/hr, beide Personen im selben Bereich und der Bereich muss für
-- den Nutzer freigeschaltet sein. Alles-oder-nichts. Jede Anweisung einzeln
-- wiederholbar.
-- ============================================================================

create or replace function public.employees_zusammenfuehren(p_bleibt uuid, p_weg uuid)
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  v_b employees;
  v_w employees;
  r record;
  v_n int;
  v_erg jsonb := '{}'::jsonb;
  v_spalten text;
  v_text text;
begin
  if not hat_rolle(array['admin', 'hr']::user_role[]) then
    raise exception 'Keine Berechtigung (nur Admin/Personal).';
  end if;
  if p_bleibt is null or p_weg is null or p_bleibt = p_weg then
    raise exception 'Bitte zwei verschiedene Personen wählen.';
  end if;
  select * into v_b from employees where id = p_bleibt for update;
  select * into v_w from employees where id = p_weg for update;
  if v_b.id is null or v_w.id is null then
    raise exception 'Person nicht gefunden.';
  end if;
  if v_b.bereich <> v_w.bereich then
    raise exception 'Personen aus verschiedenen Bereichen können nicht zusammengeführt werden.';
  end if;
  if not (v_b.bereich = any (current_bereiche())) then
    raise exception 'Bereich % ist für dich nicht freigeschaltet.', v_b.bereich;
  end if;

  -- Sonderfälle vorab: Saisonjahre / Firma je Saison / offene Zeiträume
  select string_agg(w2.saison_jahr::text, ', ') into v_text
    from employee_saison w2 join employee_saison b2
      on b2.employee_id = p_bleibt and b2.saison_jahr = w2.saison_jahr
   where w2.employee_id = p_weg and b2.firma <> w2.firma;
  if v_text is not null then
    raise exception 'Unterschiedliche Firma in Saison %. Bitte erst in der Stammkarte angleichen.', v_text;
  end if;
  delete from employee_saison w2 using employee_saison b2
   where w2.employee_id = p_weg and b2.employee_id = p_bleibt and b2.saison_jahr = w2.saison_jahr;
  delete from employee_saison_praesenz w2 using employee_saison_praesenz b2
   where w2.employee_id = p_weg and b2.employee_id = p_bleibt and b2.saison_jahr = w2.saison_jahr;
  if exists (select 1 from employee_beschaeftigungsabschnitte where employee_id = p_bleibt and abmeldedatum is null)
     and exists (select 1 from employee_beschaeftigungsabschnitte where employee_id = p_weg and abmeldedatum is null) then
    raise exception 'Beide Personen haben einen offenen Beschäftigungszeitraum. Bitte erst einen abmelden.';
  end if;

  -- Statuswechsel-Kette
  update employees set vorgaenger_employee_id = case when v_w.vorgaenger_employee_id = p_bleibt then null else v_w.vorgaenger_employee_id end
   where id = p_bleibt and vorgaenger_employee_id = p_weg;
  update employees set vorgaenger_employee_id = p_bleibt
   where vorgaenger_employee_id = p_weg and id <> p_bleibt;

  -- alle übrigen Verweise auf employees umhängen
  for r in
    select c.conrelid::regclass as tab, a.attname as spalte
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.employees'::regclass
       and array_length(c.conkey, 1) = 1
       and not (c.conrelid = 'public.employees'::regclass)
     order by 1, 2
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tab, r.spalte, r.spalte)
        using p_bleibt, p_weg;
      get diagnostics v_n = row_count;
    exception when unique_violation then
      raise exception 'Überschneidung in % (%): beide Personen haben dort einen Eintrag für denselben Tag/dieselbe Saison. Bitte erst bereinigen. (%)',
        r.tab, r.spalte, sqlerrm;
    end;
    if v_n > 0 then
      v_erg := v_erg || jsonb_build_object(r.tab::text, coalesce((v_erg ->> r.tab::text)::int, 0) + v_n);
    end if;
  end loop;

  -- leere Stammfelder von "bleibt" aus "weg" füllen
  select string_agg(format('%1$I = coalesce(e.%1$I, w.%1$I)', attname), ', ') into v_spalten
    from pg_attribute
   where attrelid = 'public.employees'::regclass and attnum > 0 and not attisdropped
     and attname not in ('id', 'personal_nr', 'bereich', 'aktiv', 'notiz', 'version', 'created_at',
                         'updated_at', 'vorgaenger_employee_id', 'schwarze_liste', 'schwarze_liste_grund',
                         'schwarze_liste_von', 'schwarze_liste_am');
  execute format('update employees e set %s from employees w where e.id = $1 and w.id = $2', v_spalten)
    using p_bleibt, p_weg;
  update employees e set
    aktiv = e.aktiv or w.aktiv,
    schwarze_liste = e.schwarze_liste or w.schwarze_liste,
    schwarze_liste_grund = coalesce(e.schwarze_liste_grund, w.schwarze_liste_grund),
    schwarze_liste_von = coalesce(e.schwarze_liste_von, w.schwarze_liste_von),
    schwarze_liste_am = coalesce(e.schwarze_liste_am, w.schwarze_liste_am),
    notiz = concat_ws('; ', nullif(e.notiz, ''), nullif(w.notiz, ''),
                      format('zusammengeführt mit Nr. %s (%s)', w.personal_nr, to_char(now(), 'DD.MM.YYYY')))
    from employees w
   where e.id = p_bleibt and w.id = p_weg;

  delete from employees where id = p_weg;
  return v_erg || jsonb_build_object('geloescht', v_w.personal_nr);
end;
$$;
revoke all on function public.employees_zusammenfuehren(uuid, uuid) from public, anon;
grant execute on function public.employees_zusammenfuehren(uuid, uuid) to authenticated;

create or replace function public.employee_jahre_verschieben(p_von uuid, p_nach uuid, p_jahre int[])
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  v uuid := p_von;
  vb text;
  nb text;
  v_text text;
  n1 int;
  n2 int;
  n3 int;
begin
  if not hat_rolle(array['admin', 'hr']::user_role[]) then
    raise exception 'Keine Berechtigung (nur Admin/Personal).';
  end if;
  if p_von is null or p_nach is null or p_von = p_nach or coalesce(array_length(p_jahre, 1), 0) = 0 then
    raise exception 'Bitte zwei verschiedene Personen und mindestens ein Jahr wählen.';
  end if;
  select bereich into vb from employees where id = p_von;
  select bereich into nb from employees where id = p_nach;
  if vb is null or nb is null then
    raise exception 'Person nicht gefunden.';
  end if;
  if vb <> nb then
    raise exception 'Personen aus verschiedenen Bereichen.';
  end if;
  if not (vb = any (current_bereiche())) then
    raise exception 'Bereich % ist für dich nicht freigeschaltet.', vb;
  end if;

  -- In diesen Jahren dürfen keine Bewegungsdaten an der Person hängen
  select string_agg(x, ', ') into v_text from (
    select 'Stunden ' || string_agg(distinct extract(year from datum)::text, '/') x from work_entries
     where employee_id = v and extract(year from datum)::int = any (p_jahre) having count(*) > 0
    union all
    select 'Abrechnung ' || string_agg(distinct saison_jahr::text, '/') from saison_abrechnungen
     where employee_id = v and saison_jahr = any (p_jahre) having count(*) > 0
    union all
    select 'Saisonwerte ' || string_agg(distinct saison_jahr::text, '/') from season_bonuses
     where employee_id = v and saison_jahr = any (p_jahre) having count(*) > 0
    union all
    select 'Stundenkonto ' || string_agg(distinct saison_jahr::text, '/') from stundenkonto_bewegungen
     where employee_id = v and saison_jahr = any (p_jahre) having count(*) > 0
    union all
    select 'SV-Fragebogen ' || string_agg(distinct saison_jahr::text, '/') from sv_fragebogen
     where employee_id = v and saison_jahr = any (p_jahre) having count(*) > 0
    union all
    select 'Vorschüsse ' || string_agg(distinct extract(year from a.datum)::text, '/') from advance_recipients ar
      join advances a on a.id = ar.advance_id
     where ar.employee_id = v and extract(year from a.datum)::int = any (p_jahre) having count(*) > 0
    union all
    select 'Zuckermais ' || string_agg(distinct extract(year from datum)::text, '/') from zuckermais_rohdaten
     where employee_id = v and extract(year from datum)::int = any (p_jahre) having count(*) > 0
    union all
    select 'Erdbeeren ' || string_agg(distinct extract(year from datum)::text, '/') from erdbeeren_rohdaten
     where employee_id = v and extract(year from datum)::int = any (p_jahre) having count(*) > 0
  ) t;
  if v_text is not null then
    raise exception 'In diesen Jahren hängen schon Daten an der Person (%). Dafür bitte zusammenführen oder von Hand umbuchen.', v_text;
  end if;

  -- Firma je Saison: Widerspruch -> Abbruch, gleich -> zusammenlegen
  select string_agg(a.saison_jahr::text, ', ') into v_text
    from employee_saison a join employee_saison z on z.employee_id = p_nach and z.saison_jahr = a.saison_jahr
   where a.employee_id = p_von and a.saison_jahr = any (p_jahre) and a.firma <> z.firma;
  if v_text is not null then
    raise exception 'Unterschiedliche Firma in Saison %. Bitte erst angleichen.', v_text;
  end if;
  delete from employee_saison a using employee_saison z
   where a.employee_id = p_von and z.employee_id = p_nach and z.saison_jahr = a.saison_jahr
     and a.saison_jahr = any (p_jahre);
  update employee_saison set employee_id = p_nach
   where employee_id = p_von and saison_jahr = any (p_jahre);

  delete from employee_saison_praesenz a using employee_saison_praesenz z
   where a.employee_id = p_von and z.employee_id = p_nach and z.saison_jahr = a.saison_jahr
     and a.saison_jahr = any (p_jahre);
  update employee_saison_praesenz set employee_id = p_nach
   where employee_id = p_von and saison_jahr = any (p_jahre);
  get diagnostics n1 = row_count;

  if exists (select 1 from employee_beschaeftigungsabschnitte
              where employee_id = p_von and abmeldedatum is null
                and extract(year from anmeldedatum)::int = any (p_jahre))
     and exists (select 1 from employee_beschaeftigungsabschnitte where employee_id = p_nach and abmeldedatum is null) then
    raise exception 'Beide hätten danach einen offenen Beschäftigungszeitraum. Bitte erst einen abmelden.';
  end if;
  update employee_beschaeftigungsabschnitte set employee_id = p_nach
   where employee_id = p_von and extract(year from anmeldedatum)::int = any (p_jahre);
  get diagnostics n3 = row_count;

  select count(*) into n2 from employee_saison where employee_id = p_nach and saison_jahr = any (p_jahre);
  return jsonb_build_object('saisonjahre', n1, 'firma_je_saison', n2, 'zeitraeume', n3);
end;
$$;
revoke all on function public.employee_jahre_verschieben(uuid, uuid, int[]) from public, anon;
grant execute on function public.employee_jahre_verschieben(uuid, uuid, int[]) to authenticated;
