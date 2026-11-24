-- ============================================================================
-- Migration 2026-11-24c: Stufe 0b - Lese-Rechte je Rolle schärfen.
--
-- Nutzer-Entscheidung 2026-11-24 (Plan docs/zwei-personalstaemme-plan.md,
-- Abschnitt Stufe 0). Abgesichert mit supabase/tests/rechte_test.sh:
-- Rechte-Matrix vorher/nachher unterscheidet sich nur an den gewollten
-- Stellen.
--
--  1. Eigentümer-Views (umgehen RLS) bekommen einen Rollenfilter:
--       profile_namen                 alle aktiven Rollen
--       anreiseliste_offen_arbeitend  admin, hr, management
--       unterkunft_auszug_offen       admin, hr, erntewirtschaft, hausmeister
--       employee_auslagen_historie    Lohn-Rollen*
--       employee_vorschuss_historie   Lohn-Rollen*
--     (*Lohn-Rollen = admin, hr, kasse, lohnabrechnung, pruefer, management)
--  2. Lesen von Stunden/Lohn/Unterkunft nur noch für die Rollen, die es
--     brauchen:
--       work_entries             alle außer hausmeister, waage
--       stundenkonto_bewegungen  alle außer erntewirtschaft, hausmeister, waage
--       saison_abrechnungen      Lohn-Rollen
--       auszahlungsbelege        Lohn-Rollen
--       unterkunft_* + Fotos     alle außer waage
--  3. Funktionen ohne Rollenprüfung:
--       naechste_belegnummer     nur admin, kasse, lohnabrechnung
--       ernte_scan_verarbeiten   nur mit aktiver Rolle (oder Hintergrunddienst)
--       arbeitstage_lock_erwerben nur mit aktiver Rolle
--       interne Hilfsfunktionen  nicht mehr direkt aufrufbar
--  4. Fehler behoben: Änderungsprotokoll-Trigger erwartete überall eine
--     Spalte "id" - "Monat sperren" (periods) brach deshalb ab.
--  5. Alte, ungenutzte View employees_public entfernt.
--
-- In der Supabase SQL-Konsole in einem Zug ausführen. Idempotent.
-- ============================================================================

begin;

-- 1) Eigentümer-Views mit Rollenfilter ---------------------------------------
--    Die View wird um ihre eigene (live) Definition gelegt:
--    select * from (<bisherige Definition>) v where <Rollenfilter>.
--    Spalten, Rechte und Optionen bleiben gleich. Markiert per Kommentar,
--    damit ein zweiter Lauf nicht doppelt filtert.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('profile_namen',                'current_role_name() is not null'),
      ('anreiseliste_offen_arbeitend', 'current_role_name() in (''admin'', ''hr'', ''management'')'),
      ('unterkunft_auszug_offen',      'current_role_name() in (''admin'', ''hr'', ''erntewirtschaft'', ''hausmeister'')'),
      ('employee_auslagen_historie',   'current_role_name() in (''admin'', ''hr'', ''kasse'', ''lohnabrechnung'', ''pruefer'', ''management'')'),
      ('employee_vorschuss_historie',  'current_role_name() in (''admin'', ''hr'', ''kasse'', ''lohnabrechnung'', ''pruefer'', ''management'')')
    ) as t(view_name, filter)
  loop
    if coalesce(obj_description(('public.' || r.view_name)::regclass, 'pg_class'), '') like 'rollenfilter:%' then
      continue;
    end if;
    execute format(
      'create or replace view public.%I as select * from (%s) v where %s',
      r.view_name,
      rtrim(rtrim(pg_get_viewdef(('public.' || r.view_name)::regclass, false)), ';'),
      r.filter
    );
    execute format('comment on view public.%I is %L', r.view_name, 'rollenfilter: ' || r.filter);
  end loop;
end $$;

-- 2) Lese-Regeln je Rolle ------------------------------------------------------
alter policy "work_entries_select" on public.work_entries
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'kasse', 'lohnabrechnung', 'pruefer', 'management', 'erntewirtschaft'));

alter policy "stundenkonto_bewegungen_select" on public.stundenkonto_bewegungen
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));

alter policy "saison_abrechnungen_select" on public.saison_abrechnungen
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));

alter policy "auszahlungsbelege_select" on public.auszahlungsbelege
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));

do $$
declare
  p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename like 'unterkunft\_%'
      and cmd = 'SELECT'
      and qual = '(current_role_name() IS NOT NULL)'
  loop
    execute format(
      'alter policy %I on public.%I using (current_role_name() is not null and current_role_name() <> ''waage'')',
      p.policyname, p.tablename
    );
  end loop;
end $$;

-- 3) Funktionen ------------------------------------------------------------------
--    Rollenprüfung als erste Anweisung in den bestehenden (live) Funktions-
--    text einsetzen - der Rest der Funktion bleibt unverändert.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('public.naechste_belegnummer(text)',
       'if current_role_name() is null or current_role_name() not in (''admin'', ''kasse'', ''lohnabrechnung'') then raise exception ''Keine Berechtigung (Belegnummer)''; end if;'),
      ('public.ernte_scan_verarbeiten()',
       'if auth.uid() is not null and current_role_name() is null then raise exception ''Keine Berechtigung''; end if;'),
      ('public.arbeitstage_lock_erwerben(uuid)',
       'if current_role_name() is null then raise exception ''Keine Berechtigung''; end if;')
    ) as t(sig, pruefung)
  loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    continue when v_def like '%-- rollenpruefung 2026-11-24%';
    -- Zeilenenden live teils Windows-Stil (\r\n) - beide zulassen.
    if v_def !~ E'\nbegin\r?\n' then
      raise exception 'Funktion % hat kein erwartetes "begin" - bitte Claude melden', r.sig;
    end if;
    -- ohne Flag "g": nur das erste "begin" (Beginn des Funktionsrumpfs)
    v_def := regexp_replace(v_def, E'\nbegin(\r?\n)',
               E'\nbegin\\1  -- rollenpruefung 2026-11-24\\1  ' || replace(r.pruefung, '\', '\\') || E'\\1');
    execute v_def;
  end loop;
end $$;

-- Interne Hilfsfunktionen: nur aus anderen security-definer-Funktionen
-- (laufen als Eigentümer) bzw. von Hintergrunddiensten (service_role).
revoke execute on function public.kassenbuch_naechste_belegnummer(bigint) from authenticated;
revoke execute on function public.arbeitskleidung_bestand_synchronisieren(uuid, integer) from authenticated;
revoke execute on function public.ernte_position_feld_zuordnen() from authenticated;

-- 4) Änderungsprotokoll: Tabellen ohne Spalte "id" (periods) ------------------
create or replace function public.write_audit_log()
returns trigger language plpgsql security definer
as $$
declare
  v_neu jsonb := case when TG_OP <> 'DELETE' then to_jsonb(new) end;
  v_alt jsonb := case when TG_OP <> 'INSERT' then to_jsonb(old) end;
  v_zeile jsonb := coalesce(v_neu, v_alt);
begin
  insert into audit_log (actor_id, entity, entity_id, action, before_data, after_data)
  values (
    auth.uid(),
    TG_TABLE_NAME,
    coalesce(
      v_zeile ->> 'id',
      -- periods: Schlüssel ist (saison_jahr, monat)
      (v_zeile ->> 'saison_jahr') || '-' || lpad(v_zeile ->> 'monat', 2, '0'),
      '?'
    ),
    lower(TG_OP),
    v_alt,
    v_neu
  );
  return coalesce(new, old);
end;
$$;

-- 5) Ungenutzte Alt-View ---------------------------------------------------------
drop view if exists public.employees_public;

commit;

-- 6) Storage: Unterkunft-Fotos (eigener Schritt, wie in 2026-11-24b) ----------
do $$
begin
  alter policy "unterkunft_fotos_storage_select" on storage.objects
    using (bucket_id = 'unterkunft-fotos' and current_role_name() is not null and current_role_name() <> 'waage');
  raise notice 'Storage-Policy umgestellt';
exception when others then
  raise notice 'Storage-Policy NICHT umgestellt: % - bitte Claude melden', sqlerrm;
end $$;
