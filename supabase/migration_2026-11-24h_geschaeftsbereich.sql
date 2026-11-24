-- ============================================================================
-- Migration 2026-11-24h: Stufe 2 - Geschäftsbereich (Landwirtschaft /
-- Vertrieb) als Rechte-Grenze.
--
-- Nutzer-Vorgabe 2026-11-24 (docs/zwei-personalstaemme-plan.md):
--   * Verkäufer (Vertrieb, Mönich Direkt) müssen absolut getrennt von den
--     Mitarbeitern der Landwirtschaft verwaltet werden können.
--   * Mönich und Mömmel (beide Landwirtschaft) brauchen KEINE Rechte-
--     Trennung - deren Trennung (Kassenbuch, Lohn-Monatsfilter, Kosten)
--     kommt über die Firma je Saison in Stufe 3.
--   * admin, management, pruefer sehen alles.
--   * Unterkunft: Bewohner (Name/Zimmer) bereichsübergreifend sichtbar
--     (gemeinsame Häuser), Geld (Belastungen) getrennt.
--
--  1. Tabelle geschaeftsbereich (LW, VT) mit Personalnummer-Präfix.
--  2. employees.bereich, personal_kandidaten.bereich, arbeitsgruppen.bereich
--     (Bestand = LW); Personalnummer im Vertrieb beginnt mit "V-".
--  3. profiles.bereiche (freigegebene Bereiche, nur admin änderbar) und
--     profiles.bereich_ansicht (Umschalter "Alle / LW / VT", vom Nutzer
--     selbst änderbar, nur innerhalb der Freigabe wirksam).
--  4. current_bereiche() / bereich_filter_aktiv() / darf_mitarbeiter().
--  5. EINSCHRÄNKENDE (restrictive) Policies auf allen Tabellen mit Personen-
--     Bezug - werden mit allen bestehenden Policies per UND verknüpft, die
--     bestehenden Rollen-Regeln bleiben unverändert.
--  6. Eigentümer-Views (umgehen RLS) filtern ausdrücklich.
--  7. security-definer-Funktionen mit Personen-Bezug prüfen den Bereich.
--
-- Für die heutigen Daten ändert sich nichts: alle Personen und alle Nutzer
-- sind LW. Abgesichert mit supabase/tests/rechte_test.sh + bereich_test.sql.
--
-- In der Supabase SQL-Konsole in einem Zug ausführen.
-- ============================================================================

begin;

-- 1) Bereiche ------------------------------------------------------------------
create table if not exists public.geschaeftsbereich (
  kuerzel text primary key,
  bezeichnung text not null,
  personalnummer_praefix text not null default '',
  reihenfolge int not null default 0
);
insert into public.geschaeftsbereich (kuerzel, bezeichnung, personalnummer_praefix, reihenfolge) values
  ('LW', 'Landwirtschaft', '', 10),
  ('VT', 'Vertrieb', 'V-', 20)
on conflict (kuerzel) do nothing;

alter table public.geschaeftsbereich enable row level security;
drop policy if exists "geschaeftsbereich_select" on public.geschaeftsbereich;
create policy "geschaeftsbereich_select" on public.geschaeftsbereich for select
  using ((select hat_aktive_rolle()));
drop policy if exists "geschaeftsbereich_admin" on public.geschaeftsbereich;
create policy "geschaeftsbereich_admin" on public.geschaeftsbereich for all
  using ((select is_admin())) with check ((select is_admin()));
revoke all on public.geschaeftsbereich from anon;
grant select on public.geschaeftsbereich to authenticated;
grant insert, update, delete on public.geschaeftsbereich to authenticated;

-- 2) Bereich an Personen, Kandidaten, Arbeitsgruppen ----------------------------
alter table public.employees
  add column if not exists bereich text not null default 'LW'
    references public.geschaeftsbereich (kuerzel) on update cascade;
alter table public.personal_kandidaten
  add column if not exists bereich text not null default 'LW'
    references public.geschaeftsbereich (kuerzel) on update cascade;
alter table public.arbeitsgruppen
  add column if not exists bereich text not null default 'LW'
    references public.geschaeftsbereich (kuerzel) on update cascade;
create index if not exists idx_employees_bereich on public.employees (bereich, id);

-- employees hat Spaltenrechte (Stufe 0c): neue Spalte freigeben
grant select (bereich), insert (bereich), update (bereich) on public.employees to authenticated;

-- Personalnummer: Vertrieb mit "V-", Landwirtschaft ohne. NOT VALID = gilt
-- für neue/geänderte Zeilen; Bestand wird danach geprüft (nur Hinweis).
alter table public.employees drop constraint if exists employees_bereich_personalnummer_check;
alter table public.employees add constraint employees_bereich_personalnummer_check
  check ((bereich = 'VT') = (personal_nr like 'V-%')) not valid;
do $$
begin
  alter table public.employees validate constraint employees_bereich_personalnummer_check;
exception when check_violation then
  raise notice 'Hinweis: bestehende Personalnummern mit "V-" in der Landwirtschaft - Regel gilt nur für neue Änderungen.';
end $$;

-- employee_personaldaten (select * - neue Spalte aufnehmen, Filter kommt in 6)
create or replace view public.employee_personaldaten as
  select * from public.employees
  where (select hat_rolle(array['admin', 'hr']::user_role[]))
with local check option;
alter view public.employee_personaldaten set (security_barrier = true);

-- 3) Freigabe je Nutzer + Umschalter -----------------------------------------------
alter table public.profiles
  add column if not exists bereiche text[] not null default '{LW}',
  add column if not exists bereich_ansicht text;

create or replace function public.profiles_schutz()
returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role
      or new.rollen is distinct from old.rollen
      or new.bereiche is distinct from old.bereiche
      or new.aktiv is distinct from old.aktiv)
     and not is_admin() then
    raise exception
      'Rollen, Bereiche und Aktiv-Status können nur von einem Administrator geändert werden.';
  end if;
  return new;
end;
$$;

-- 4) Prüffunktionen ------------------------------------------------------------------
-- Freigegebene Bereiche des Aufrufers (admin/management/pruefer: alle),
-- eingeschränkt auf die gewählte Ansicht, falls gesetzt und erlaubt.
create or replace function public.current_bereiche()
returns text[] language sql stable security definer
set search_path = public
as $$
  with erlaubt as (
    select case
      when hat_rolle(array['admin', 'management', 'pruefer']::user_role[])
        then (select coalesce(array_agg(kuerzel), '{}') from geschaeftsbereich)
      else coalesce((select bereiche from profiles where id = auth.uid() and aktiv), '{}')
    end as b
  )
  select case
    when p.bereich_ansicht is not null and p.bereich_ansicht = any(e.b)
      then array[p.bereich_ansicht]
    else e.b
  end
  from erlaubt e
  left join profiles p on p.id = auth.uid();
$$;

-- true, wenn der Aufrufer NICHT alle Bereiche sieht (dann wird gefiltert).
create or replace function public.bereich_filter_aktiv()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from geschaeftsbereich g where g.kuerzel <> all (current_bereiche()));
$$;

create or replace function public.darf_mitarbeiter(p_employee_id uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select not bereich_filter_aktiv()
      or p_employee_id is null
      or exists (select 1 from employees e
                 where e.id = p_employee_id and e.bereich = any (current_bereiche()));
$$;

revoke all on function public.current_bereiche(), public.bereich_filter_aktiv(),
  public.darf_mitarbeiter(uuid) from public, anon;
grant execute on function public.current_bereiche(), public.bereich_filter_aktiv(),
  public.darf_mitarbeiter(uuid) to authenticated, service_role;

-- 5) Einschränkende Policies --------------------------------------------------------
--    Muster für Tabellen mit employee_id (einmal je Abfrage ausgewertet):
--      not bereich_filter_aktiv() or employee_id in (Personen meiner Bereiche)
do $$
declare
  t record;
  v_filter text;
begin
  -- direkte Bereichs-Spalte
  for t in select * from (values ('employees'), ('personal_kandidaten'), ('arbeitsgruppen')) v(tab) loop
    execute format('drop policy if exists "bereich_grenze" on public.%I', t.tab);
    execute format(
      'create policy "bereich_grenze" on public.%I as restrictive for all to authenticated
         using (bereich = any ((select current_bereiche())::text[]))
         with check (bereich = any ((select current_bereiche())::text[]))', t.tab);
  end loop;

  -- über employee_id (Unterkunft-Belegung/-Zuordnung bewusst NICHT, siehe Kopf;
  -- Fahrzeug-Fahrer nicht - Fahrzeuge sind kein Personaldatensatz)
  for t in
    select * from (values
      ('advance_recipients', 'employee_id'),
      ('arbeitstage_bearbeitung_lock', 'employee_id'),
      ('auszahlungsbeleg_zeilen', 'employee_id'),
      ('doppelte_haushaltsfuehrung', 'employee_id'),
      ('employee_beschaeftigungsabschnitte', 'employee_id'),
      ('employee_documents', 'employee_id'),
      ('employee_saison_praesenz', 'employee_id'),
      ('erdbeeren_rohdaten', 'employee_id'),
      ('ernte_ausweis', 'employee_id'),
      ('ernte_ausweis_druck', 'employee_id'),
      ('ernte_kiste_zyklus', 'employee_id'),
      ('ernte_schicht', 'employee_id'),
      ('ernte_tag', 'employee_id'),
      ('firmenhandy', 'employee_id'),
      ('kautionsuebergabe_personen', 'employee_id'),
      ('kleidung_ausgaben', 'employee_id'),
      ('lohnsteuerantrag_position', 'employee_id'),
      ('saison_abrechnungen', 'employee_id'),
      ('schulung_teilnahme', 'employee_id'),
      ('season_bonuses', 'employee_id'),
      ('stundenkonto_bewegungen', 'employee_id'),
      ('sv_fragebogen', 'employee_id'),
      ('unterkunft_belastung', 'employee_id'),
      ('work_entries', 'employee_id'),
      ('zuckermais_annahme', 'employee_id'),
      ('zuckermais_rohdaten', 'employee_id')
    ) v(tab, spalte)
  loop
    v_filter := format(
      '(not (select bereich_filter_aktiv()) or %1$I is null or %1$I in (
          select e.id from public.employees e where e.bereich = any ((select current_bereiche())::text[])))',
      t.spalte);
    execute format('drop policy if exists "bereich_grenze" on public.%I', t.tab);
    execute format(
      'create policy "bereich_grenze" on public.%I as restrictive for all to authenticated
         using %s with check %s', t.tab, v_filter, v_filter);
  end loop;

  -- über Zuordnungstabellen: Vorschuss / Auszahlungsbeleg / Kautionsübergabe
  -- sichtbar, wenn mindestens eine beteiligte Person im eigenen Bereich ist
  -- (oder noch niemand zugeordnet ist - beim Anlegen).
  execute 'drop policy if exists "bereich_grenze" on public.advances';
  execute $p$create policy "bereich_grenze" on public.advances as restrictive for all to authenticated
    using (not (select bereich_filter_aktiv())
           or not exists (select 1 from public.advance_recipients r where r.advance_id = advances.id)
           or exists (select 1 from public.advance_recipients r join public.employees e on e.id = r.employee_id
                      where r.advance_id = advances.id and e.bereich = any ((select current_bereiche())::text[])))$p$;

  execute 'drop policy if exists "bereich_grenze" on public.auszahlungsbelege';
  execute $p$create policy "bereich_grenze" on public.auszahlungsbelege as restrictive for all to authenticated
    using (not (select bereich_filter_aktiv())
           or not exists (select 1 from public.auszahlungsbeleg_zeilen z where z.auszahlungsbeleg_id = auszahlungsbelege.id)
           or exists (select 1 from public.auszahlungsbeleg_zeilen z join public.employees e on e.id = z.employee_id
                      where z.auszahlungsbeleg_id = auszahlungsbelege.id and e.bereich = any ((select current_bereiche())::text[])))$p$;

  execute 'drop policy if exists "bereich_grenze" on public.kautionsuebergaben';
  execute $p$create policy "bereich_grenze" on public.kautionsuebergaben as restrictive for all to authenticated
    using (not (select bereich_filter_aktiv())
           or not exists (select 1 from public.kautionsuebergabe_personen k where k.kautionsuebergabe_id = kautionsuebergaben.id)
           or exists (select 1 from public.kautionsuebergabe_personen k join public.employees e on e.id = k.employee_id
                      where k.kautionsuebergabe_id = kautionsuebergaben.id and e.bereich = any ((select current_bereiche())::text[])))$p$;
end $$;

-- 6) Eigentümer-Views: Bereichsfilter ------------------------------------------------
do $$
declare
  r record;
  v_opt text[];
begin
  for r in
    select * from (values
      ('season_summary', 'employee_id'),
      ('season_summary_monat', 'employee_id'),
      ('anreiseliste_offen_arbeitend', 'employee_id'),
      ('employee_auslagen_historie', 'employee_id'),
      ('employee_vorschuss_historie', 'employee_id'),
      ('employee_fuehrerschein_kategorien', 'employee_id'),
      ('employee_sv_pruefung', 'employee_id'),
      ('employee_personaldaten', 'id'),
      ('employee_bankdaten', 'id'),
      ('employee_lohndaten', 'id')
    ) v(view_name, spalte)
  loop
    continue when pg_get_viewdef(('public.' || r.view_name)::regclass, false) like '%bereich_filter_aktiv%';
    select reloptions into v_opt from pg_class where oid = ('public.' || r.view_name)::regclass;
    if r.view_name = 'employee_personaldaten' then
      -- einfache View bleibt auto-updatable: Filter direkt in WHERE
      execute $v$create or replace view public.employee_personaldaten as
        select * from public.employees
        where (select hat_rolle(array['admin', 'hr']::user_role[]))
          and (not (select bereich_filter_aktiv()) or bereich = any ((select current_bereiche())::text[]))
        with local check option$v$;
    else
      -- Filter einmal je Abfrage (nicht je Zeile): Personen-Liste der
      -- eigenen Bereiche als Unterabfrage (die View läuft als Eigentümer,
      -- employees-RLS greift hier nicht - deshalb der ausdrückliche Filter).
      execute format(
        'create or replace view public.%I as select * from (%s) v
           where not (select bereich_filter_aktiv())
              or v.%I in (select e.id from public.employees e where e.bereich = any ((select current_bereiche())::text[]))',
        r.view_name,
        rtrim(rtrim(pg_get_viewdef(('public.' || r.view_name)::regclass, false)), ';'),
        r.spalte);
    end if;
    if v_opt is not null then
      execute format('alter view public.%I set (%s)', r.view_name, array_to_string(v_opt, ', '));
    end if;
  end loop;
end $$;

-- 7) security-definer-Funktionen: Bereichsprüfung als erste Anweisung -----------------
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('public.abrechnung_fahrerkaution_korrigieren(uuid,integer,numeric,text)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.abrechnung_korrigieren(uuid,integer,numeric,text)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.abrechnung_verpflegung_korrigieren(uuid,integer,integer,text)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.abrechnung_zimmerkaution_korrigieren(uuid,integer,numeric,text)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.arbeitskleidung_ausgabe_buchen(uuid,integer,text,text,integer)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.arbeitstage_lock_erwerben(uuid)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.employee_beschaeftigung_abmelden(uuid,date)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.employee_beschaeftigung_anmelden(uuid,date,text)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.saison_abrechnung_nachtragen(uuid,integer,date)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.stundenkonto_buchen(uuid,integer,date,numeric,text,text)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.stundenkonto_in_auszahlung_umwandeln(uuid,integer,numeric,text)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.vorschuss_korrigieren(bigint,uuid,numeric,text)', 'not darf_mitarbeiter(p_employee_id)'),
      ('public.saison_abrechnen_batch(uuid[],integer,text,date)',
       'exists (select 1 from unnest(p_employee_ids) x where not darf_mitarbeiter(x))'),
      ('public.stundenkonto_auszahlung_stornieren(bigint,text)',
       'not darf_mitarbeiter((select b.employee_id from stundenkonto_bewegungen b where b.id = p_bewegung_id))'),
      ('public.saison_abrechnung_nachtrag_entfernen(bigint)',
       'not darf_mitarbeiter((select s.employee_id from saison_abrechnungen s where s.id = p_id))')
    ) as t(sig, bedingung)
  loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    continue when v_def like '%-- bereichspruefung 2026-11-24%';
    if v_def !~ E'\nbegin\r?\n' then
      raise exception 'Funktion % hat kein erwartetes "begin" - bitte Claude melden', r.sig;
    end if;
    v_def := regexp_replace(v_def, E'\nbegin(\r?\n)',
               E'\nbegin\\1  -- bereichspruefung 2026-11-24\\1  if '
               || replace(r.bedingung, '\', '\\')
               || E' then raise exception ''Keine Berechtigung für diese Person (anderer Bereich)''; end if;\\1');
    execute v_def;
  end loop;
end $$;

commit;
