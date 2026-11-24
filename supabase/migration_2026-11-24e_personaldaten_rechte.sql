-- ============================================================================
-- Migration 2026-11-24e: Stufe 0c (Teil 2 von 2) - direkte Spaltenrechte auf
-- heikle Felder von employees entziehen.
--
-- ERST AUSFÜHREN, wenn Teil 1 (migration_2026-11-24d_...) eingespielt ist
-- UND der Code-Stand mit employee_personaldaten/-bankdaten/-lohndaten live
-- ist (Vercel "Ready"). Begründung und Rollen siehe Teil 1.
--
-- Rückweg (falls eine Seite klemmt):
--   grant select, insert, update on public.employees to authenticated;
-- ============================================================================

begin;

-- 2) Spaltenrechte auf employees -------------------------------------------------
--    Erst alle Tabellenrechte von authenticated entfernen, dann gezielt die
--    unkritischen Spalten wieder freigeben (lesen/anlegen/ändern). Die RLS-
--    Policies (wer welche Zeilen sieht/ändert) bleiben unverändert.
revoke select, insert, update on public.employees from authenticated;
do $$
declare
  v_heikel text[] := array[
    'sozialversicherungsnummer', 'steuer_id', 'strasse', 'hausnummer', 'plz',
    'ort', 'land', 'geburtsdatum', 'geburtsname', 'geburtsort',
    'familienstand', 'hochzeitsdatum', 'telefon_privat', 'email_privat',
    'schwarze_liste', 'schwarze_liste_grund', 'schwarze_liste_von',
    'schwarze_liste_am', 'iban', 'bic', 'zahlungsempfaenger', 'stundenlohn'
  ];
  v_frei text;
  v_fehlend text;
begin
  -- Sicherheitsnetz: jede als heikel genannte Spalte muss existieren
  select string_agg(h, ', ') into v_fehlend
  from unnest(v_heikel) h
  where not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'employees'
                      and column_name = h);
  if v_fehlend is not null then
    raise exception 'Spalte(n) fehlen in employees: % - bitte Claude melden', v_fehlend;
  end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_frei
  from information_schema.columns
  where table_schema = 'public' and table_name = 'employees'
    and column_name <> all (v_heikel);

  execute format('grant select (%s) on public.employees to authenticated', v_frei);
  execute format('grant insert (%s) on public.employees to authenticated', v_frei);
  execute format('grant update (%s) on public.employees to authenticated', v_frei);
end $$;

commit;

-- Kontrolle: welche employees-Spalten sind für authenticated lesbar?
-- (Erwartung: keine der heiklen Spalten)
select column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'employees'
  and grantee = 'authenticated' and privilege_type = 'SELECT'
  and column_name in ('iban', 'bic', 'zahlungsempfaenger', 'sozialversicherungsnummer',
                      'steuer_id', 'stundenlohn', 'geburtsdatum', 'familienstand');
