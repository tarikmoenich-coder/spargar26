"""Erzeugt die Migration "Rechte-Umbau Stufe 1" aus katalog.py + zuordnung.py.

Aufruf: python3 migration_erzeugen.py struktur.json > ../migration_2026-11-28_rechte_katalog.sql

Die Migration ist EIN DO-Block (die Supabase-Konsole führt Anweisungen
einzeln aus, begin/commit wirken dort nicht - ein Fehler im DO-Block rollt
dagegen alles zurück).
"""
import json
import sys

from katalog import KATALOG, KEYS, START_ROLLEN
from umschreiben import RX, ausdruck, kandidaten_fuer, rollen_menge, rollen_von_recht, uebersetzen, vorkommen
from zuordnung import UEBERSTEUERT

# Funktionen/Policies, deren Rollenprüfung von Hand ersetzt wird
HAND = {
    ("funktion", "vt_stand_position_setzen"): "public.vt_darf(true)",
    ("funktion", "unterkunft_vorgang_schutz"): "public.darf_any(array['einstellungen.grund:S'])",
    ("funktion", "unterkunft_vorgang_kind_schutz"): "public.darf_any(array['einstellungen.grund:S'])",
    ("policy", "qs_kontrolle"): "public.darf_any(array['ernte.qualitaet:S'])",
    ("policy", "zuckermais_annahme"): "public.darf_any(array['ernte.qualitaet:S'])",
}
UEBERGEHEN = {"hat_rolle", "is_admin", "current_bereiche", "rechnung_speichern", "vt_darf",
              "current_rollen", "hat_rolle_ausser", "hat_aktive_rolle", "current_role_name"}


def q(s):
    return "'" + s.replace("'", "''") + "'"


def zuordnung_json(d):
    """{schluessel: {rollen: ausdruck}} je Policy-Feld/View/Funktion."""
    z = {}
    for art, obj, kontext, feld, alt, text in vorkommen(d):
        if obj in UEBERGEHEN:
            continue
        rollen = ",".join(sorted(alt))
        if art == "policy":
            key = f"policy|{obj}|{kontext['n']}|{feld}"
            if (obj, kontext["n"], feld) in UEBERSTEUERT:
                expr = ausdruck(UEBERSTEUERT[(obj, kontext["n"], feld)])
            elif ("policy", obj) in HAND and kontext["cmd"] == "d":
                expr = HAND[("policy", obj)]
            else:
                kand, stufe = kandidaten_fuer(art, obj, kontext)
                gew, neu = uebersetzen(alt, kand, stufe)
                expr = ausdruck(gew)
        else:
            key = f"{art}|{obj}"
            if (art, obj) in HAND:
                expr = HAND[(art, obj)]
            else:
                kand, stufe = kandidaten_fuer(art, obj, kontext)
                gew, neu = uebersetzen(alt, kand, stufe)
                expr = ausdruck(gew)
        if expr == "false":
            raise SystemExit(f"Leere Zuordnung für {key} [{rollen}]")
        z.setdefault(key, {})
        if z[key].get(rollen, expr) != expr:
            raise SystemExit(f"Widerspruch {key} [{rollen}]")
        z[key][rollen] = expr
    return z


def main():
    d = json.load(open(sys.argv[1]))
    z = zuordnung_json(d)
    katalog_values = ",\n      ".join(
        f"({q(k)}, {q(m)}, {q(t)}, {q(u)}, {'true' if s else 'false'}, {'true' if nl else 'false'}, {i})"
        for i, (k, m, t, u, s, nl) in enumerate(KATALOG))
    rollen_values = [
        "('admin', 'Administrator', 'Voller Zugriff, Nutzer und Rollen verwalten, Vorschläge.', '{}'::jsonb, true, true, 0)",
        "('geschaeftsfuehrer', 'Geschäftsführer', 'Alles wie Administrator, außer Nutzer anlegen, Rollen ändern/vergeben und Änderungsvorschläge ansehen.', '{}'::jsonb, true, false, 1)",
    ]
    for i, (k, bez, beschr, rechte) in enumerate(START_ROLLEN):
        rollen_values.append(f"({q(k)}, {q(bez)}, {q(beschr)}, {q(json.dumps(rechte, ensure_ascii=False))}::jsonb, false, false, {i + 2})")
    rollen_sql = ",\n      ".join(rollen_values)
    zj = json.dumps(z, ensure_ascii=False, sort_keys=True, indent=1)
    assert "$zuordnung$" not in zj

    print(VORLAGE.replace("%%KATALOG%%", katalog_values)
          .replace("%%ROLLEN%%", rollen_sql)
          .replace("%%ZUORDNUNG%%", zj)
          .replace("%%ANZAHL%%", str(len(KEYS))))


VORLAGE = r"""-- ============================================================================
-- Migration 2026-11-28: Rechte-Umbau Stufe 1 - Rechte-Katalog statt fester Rollen.
--
-- Nutzer-Vorgabe 2026-11-27 (docs/rechte-plan.md): Rollen sollen später in
-- der App frei einstellbar sein (je Funktion lesen / lesen & schreiben).
-- ERZEUGT von supabase/rechte/migration_erzeugen.py - nicht von Hand ändern.
--
--  1. recht_katalog (alle Funktionen), rolle (Rollen als Datensätze, die
--     bisherigen 10 als Startrollen + neu "Geschäftsführer"),
--     profil_rechte (je Nutzer vorberechnete Rechte, per Trigger aktuell).
--  2. profiles.role/rollen: Text statt festem Typ (Schlüssel aus rolle).
--     Die bisherigen Rollennamen bleiben -> die jetzige App läuft weiter.
--  3. ALLE Rollenprüfungen in Policies/Views/Funktionen werden auf
--     darf_any(array['funktion:L'|'funktion:S']) umgestellt. Die Zuordnung
--     ist so gewählt, dass jede Startrolle genau ihre bisherigen Rechte hat
--     (geprüft per Rechte-Matrix), bis auf die gewollten Bereinigungen:
--       - HR: kein Schreibrecht mehr auf Anbau (Felder/Sorten)
--       - Management: Stundenkonto-Auszahlungen nicht mehr umwandeln/stornieren
--       - Stand-Position setzen: wer Vertrieb pflegt (HR), nicht Management
--       - Lohnabrechnung: keine Kassenbücher/Einzahlungen mehr (nur die Liste
--         der Bücher für Vorschüsse)
--       - Bereiche nur noch laut Nutzer (Management/Prüfer nicht mehr
--         automatisch alle); Admin sieht alle
--       - Funktion rechnung_speichern (Rolle "buchhaltung" gibt es nicht) entfernt
--       - HR/Prüfer konnten Vorschuss-Empfänger löschen -> nur noch lesen
--       - Stundenerfassung darf eigene QS-Kontrollen/Strichlisten-Einträge löschen
--  4. Prüfung einmal je Abfrage: darf_any liest die vorberechnete Liste.
--  5. Am Ende Kontrolle: keine alte Rollenprüfung übrig, sonst bricht die
--     Migration komplett ab (nichts wird halb umgestellt).
--
-- In der Supabase SQL-Konsole ausführen (ein einziger Block).
-- ============================================================================

do $umbau$
declare
  z jsonb := $zuordnung$%%ZUORDNUNG%%$zuordnung$::jsonb;
  ziel jsonb;
  p record;
  m text[];
  t text;
  v_using text;
  v_check text;
  v_sql text;
  v_key text;
  v_rest text;
  v_anzahl int := 0;
begin
  -- 1) Katalog --------------------------------------------------------------------
  create table if not exists public.recht_katalog (
    id text primary key,
    modul text not null,
    titel text not null,
    unter text not null default '',
    sensibel boolean not null default false,
    nur_lesen boolean not null default false,
    sortierung int not null default 0
  );
  insert into public.recht_katalog (id, modul, titel, unter, sensibel, nur_lesen, sortierung) values
      %%KATALOG%%
  on conflict (id) do update set modul = excluded.modul, titel = excluded.titel, unter = excluded.unter,
    sensibel = excluded.sensibel, nur_lesen = excluded.nur_lesen, sortierung = excluded.sortierung;

  -- 2) Rollen ---------------------------------------------------------------------
  create table if not exists public.rolle (
    id text primary key check (id ~ '^[a-z0-9_]+$'),
    bezeichnung text not null unique,
    beschreibung text not null default '',
    rechte jsonb not null default '{}' check (jsonb_typeof(rechte) = 'object'),
    alle_rechte boolean not null default false,
    -- Administrator: fest, nicht bearbeitbar, verwaltet Nutzer/Rollen/Vorschläge
    system_admin boolean not null default false,
    -- Bereiche der Rolle (LW/VT) - ab Stufe 2 (Rollen-Editor) maßgeblich,
    -- bis dahin gelten die Bereiche am Nutzer (profiles.bereiche).
    bereiche text[] not null default '{}',
    sortierung int not null default 100,
    erstellt_am timestamptz not null default now()
  );
  insert into public.rolle (id, bezeichnung, beschreibung, rechte, alle_rechte, system_admin, sortierung) values
      %%ROLLEN%%
  on conflict (id) do nothing;

  -- Rechte einer Rolle müssen im Katalog stehen (L/S)
  create or replace function public.rolle_pruefen() returns trigger language plpgsql as $f$
  declare k text; s text;
  begin
    for k, s in select * from jsonb_each_text(new.rechte) loop
      if not exists (select 1 from recht_katalog where id = k) then
        raise exception 'Unbekanntes Recht: %', k;
      end if;
      if s not in ('L', 'S') then
        raise exception 'Stufe muss L oder S sein (%: %)', k, s;
      end if;
    end loop;
    if tg_op = 'UPDATE' and old.system_admin and not new.system_admin then
      raise exception 'Die Rolle Administrator kann nicht geändert werden.';
    end if;
    if tg_op = 'UPDATE' and old.system_admin and (new.rechte <> old.rechte or new.alle_rechte <> old.alle_rechte) then
      raise exception 'Die Rolle Administrator kann nicht geändert werden.';
    end if;
    return new;
  end $f$;
  drop trigger if exists trg_rolle_pruefen on public.rolle;
  create trigger trg_rolle_pruefen before insert or update on public.rolle
    for each row execute function public.rolle_pruefen();

  create or replace function public.rolle_loeschen_pruefen() returns trigger language plpgsql as $f$
  begin
    if old.system_admin then
      raise exception 'Die Rolle Administrator kann nicht gelöscht werden.';
    end if;
    if exists (select 1 from profiles where old.id = any(rollen)) then
      raise exception 'Rolle "%" ist noch Nutzern zugewiesen.', old.bezeichnung;
    end if;
    return old;
  end $f$;
  drop trigger if exists trg_rolle_loeschen on public.rolle;
  create trigger trg_rolle_loeschen before delete on public.rolle
    for each row execute function public.rolle_loeschen_pruefen();

  drop trigger if exists trg_audit_rolle on public.rolle;
  create trigger trg_audit_rolle after insert or update or delete on public.rolle
    for each row execute function public.write_audit_log();

  -- 3) profiles: Rollen als Text --------------------------------------------------
  alter table public.profiles alter column role drop default;
  alter table public.profiles alter column rollen drop default;
  alter table public.profiles alter column role type text using role::text;
  alter table public.profiles alter column rollen type text[] using rollen::text[];
  alter table public.profiles alter column role set default 'zeiterfassung';
  alter table public.profiles alter column rollen set default '{}';

  create or replace function public.profiles_rollen_pruefen() returns trigger language plpgsql as $f$
  declare r text;
  begin
    foreach r in array new.rollen loop
      if not exists (select 1 from rolle where id = r) then
        raise exception 'Unbekannte Rolle: %', r;
      end if;
    end loop;
    return new;
  end $f$;
  drop trigger if exists trg_profiles_rollen_pruefen on public.profiles;
  create trigger trg_profiles_rollen_pruefen before insert or update of rollen, role on public.profiles
    for each row execute function public.profiles_rollen_pruefen();

  -- 4) Vorberechnete Rechte je Nutzer ---------------------------------------------
  create table if not exists public.profil_rechte (
    profile_id uuid primary key references public.profiles(id) on delete cascade,
    rechte text[] not null default '{}',
    bereiche text[] not null default '{}',
    admin boolean not null default false,
    -- hat mindestens eine Rolle (auch nur Waage)
    angemeldet boolean not null default false,
    -- Büro-Nutzer: hat ein Recht außer dem Waagen-Bildschirm
    buero boolean not null default false,
    berechnet_am timestamptz not null default now()
  );

  create or replace function public.profil_rechte_berechnen(p_id uuid default null)
  returns void language plpgsql security definer set search_path = public as $f$
  begin
    insert into profil_rechte (profile_id, rechte, bereiche, admin, angemeldet, buero, berechnet_am)
    select p.id,
      case when not p.aktiv then '{}'::text[] else coalesce((
        select array_agg(distinct x order by x) from (
          select k.id || ':' || s as x
          from rolle r cross join recht_katalog k cross join (values ('L'), ('S')) st(s)
          where r.id = any(p.rollen) and r.alle_rechte
          union
          select e.key || ':L' from rolle r, jsonb_each_text(r.rechte) e
          where r.id = any(p.rollen)
          union
          select e.key || ':S' from rolle r, jsonb_each_text(r.rechte) e
          where r.id = any(p.rollen) and e.value = 'S'
        ) a), '{}') end,
      case when not p.aktiv then '{}'::text[]
           when exists (select 1 from rolle r where r.id = any(p.rollen) and r.system_admin)
             then coalesce((select array_agg(kuerzel order by kuerzel) from geschaeftsbereich), '{}')
           else coalesce((select array_agg(b order by b) from unnest(p.bereiche) b
                          where b in (select kuerzel from geschaeftsbereich)), '{}') end,
      p.aktiv and exists (select 1 from rolle r where r.id = any(p.rollen) and r.system_admin),
      p.aktiv and cardinality(p.rollen) > 0,
      p.aktiv and exists (
        select 1 from rolle r where r.id = any(p.rollen)
          and (r.alle_rechte or exists (select 1 from jsonb_object_keys(r.rechte) k where k <> 'sonder.waage_kiosk'))),
      now()
    from profiles p
    where p_id is null or p.id = p_id
    on conflict (profile_id) do update set rechte = excluded.rechte, bereiche = excluded.bereiche,
      admin = excluded.admin, angemeldet = excluded.angemeldet, buero = excluded.buero,
      berechnet_am = excluded.berechnet_am;
  end $f$;
  revoke all on function public.profil_rechte_berechnen(uuid) from public, anon, authenticated;

  create or replace function public.profil_rechte_trigger_profil() returns trigger
  language plpgsql security definer set search_path = public as $f$
  begin
    perform profil_rechte_berechnen(new.id);
    return null;
  end $f$;
  drop trigger if exists trg_profil_rechte on public.profiles;
  create trigger trg_profil_rechte after insert or update of rollen, role, aktiv, bereiche on public.profiles
    for each row execute function public.profil_rechte_trigger_profil();

  create or replace function public.profil_rechte_trigger_alle() returns trigger
  language plpgsql security definer set search_path = public as $f$
  begin
    perform profil_rechte_berechnen(null);
    return null;
  end $f$;
  drop trigger if exists trg_profil_rechte_rolle on public.rolle;
  create trigger trg_profil_rechte_rolle after insert or update or delete on public.rolle
    for each statement execute function public.profil_rechte_trigger_alle();
  drop trigger if exists trg_profil_rechte_katalog on public.recht_katalog;
  create trigger trg_profil_rechte_katalog after insert or update or delete on public.recht_katalog
    for each statement execute function public.profil_rechte_trigger_alle();
  drop trigger if exists trg_profil_rechte_bereich on public.geschaeftsbereich;
  create trigger trg_profil_rechte_bereich after insert or update or delete on public.geschaeftsbereich
    for each statement execute function public.profil_rechte_trigger_alle();

  perform public.profil_rechte_berechnen(null);

  -- 5) Prüffunktionen ---------------------------------------------------------------
  create or replace function public.meine_rechte() returns public.profil_rechte
  language sql stable security definer set search_path = public as $f$
    select * from profil_rechte where profile_id = auth.uid()
  $f$;

  -- Hat der Aufrufer mindestens eines der Rechte ('funktion:L' / 'funktion:S')?
  create or replace function public.darf_any(p_rechte text[]) returns boolean
  language sql stable as $f$ select coalesce((public.meine_rechte()).rechte && p_rechte, false) $f$;

  create or replace function public.darf(p_recht text) returns boolean
  language sql stable as $f$ select public.darf_any(array[p_recht]) $f$;

  create or replace function public.is_admin() returns boolean
  language sql stable as $f$ select coalesce((public.meine_rechte()).admin, false) $f$;

  create or replace function public.hat_aktive_rolle() returns boolean
  language sql stable as $f$ select coalesce((public.meine_rechte()).angemeldet, false) $f$;

  create or replace function public.buero() returns boolean
  language sql stable as $f$ select coalesce((public.meine_rechte()).buero, false) $f$;

  create or replace function public.current_bereiche() returns text[]
  language sql stable security definer set search_path = public as $f$
    select case
      when p.bereich_ansicht is not null and p.bereich_ansicht = any(r.bereiche)
        then array[p.bereich_ansicht]
      else coalesce(r.bereiche, '{}')
    end
    from profiles p left join profil_rechte r on r.profile_id = p.id
    where p.id = auth.uid()
  $f$;

  create or replace function public.vt_darf(p_schreiben boolean default false) returns boolean
  language sql stable security definer set search_path = public as $f$
    select 'VT' = any (coalesce(current_bereiche(), '{}'))
       and darf_any(case when p_schreiben then array['vertrieb.planung:S']
                         else array['vertrieb.planung:L'] end);
  $f$;

  create or replace function public.profiles_schutz() returns trigger language plpgsql as $f$
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
  end $f$;

  -- 6) Rechte auf die neuen Tabellen ------------------------------------------------
  alter table public.recht_katalog enable row level security;
  alter table public.rolle enable row level security;
  alter table public.profil_rechte enable row level security;
  revoke all on public.recht_katalog, public.rolle, public.profil_rechte from anon;
  grant select on public.recht_katalog, public.profil_rechte to authenticated;
  grant select, insert, update, delete on public.rolle to authenticated;
  revoke insert, update, delete on public.recht_katalog, public.profil_rechte from authenticated;
  drop policy if exists recht_katalog_lesen on public.recht_katalog;
  create policy recht_katalog_lesen on public.recht_katalog for select using ((select public.hat_aktive_rolle()));
  drop policy if exists rolle_lesen on public.rolle;
  create policy rolle_lesen on public.rolle for select using ((select public.hat_aktive_rolle()));
  drop policy if exists rolle_admin on public.rolle;
  create policy rolle_admin on public.rolle for all using ((select public.is_admin())) with check ((select public.is_admin()));
  drop policy if exists profil_rechte_lesen on public.profil_rechte;
  create policy profil_rechte_lesen on public.profil_rechte for select
    using (profile_id = auth.uid() or (select public.is_admin()));

  -- 7) Alte Rollenprüfungen umschreiben ------------------------------------------
  -- Policies (public + storage)
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(hat_rolle|hat_rolle_ausser|current_rollen)\('
  loop
    v_using := p.qual;
    v_check := p.with_check;
    -- hat_rolle(ARRAY[...]) -> darf_any(...) laut Zuordnung
    for v_key, t in select 'using', v_using union all select 'check', v_check loop
      continue when t is null;
      ziel := z -> ('policy|' || p.tablename || '|' || p.policyname || '|' || v_key);
      for m in select regexp_matches(t, '(hat_rolle\(\s*(?:ARRAY|array)\[([^\]]*)\]\s*(?:::\s*(?:public\.)?user_role\[\])?\s*\))', 'g') loop
        v_rest := (select string_agg(x, ',' order by x) from (
                     select distinct regexp_replace(trim(y), '''|::(public\.)?user_role', '', 'g') x
                     from unnest(string_to_array(m[2], ',')) y) s);
        if ziel is null or not ziel ? v_rest then
          raise exception 'Keine Zuordnung für Policy %.% (%) [%]', p.tablename, p.policyname, v_key, v_rest;
        end if;
        t := replace(t, m[1], ziel ->> v_rest);
        v_anzahl := v_anzahl + 1;
      end loop;
      t := replace(t, 'hat_rolle_ausser(ARRAY[''waage''::user_role])', 'public.buero()');
      -- Vorschlag eintragen: jeder Nutzer mit Rolle
      t := replace(t, 'cardinality(( SELECT current_rollen() AS current_rollen)) > 0', '( SELECT public.hat_aktive_rolle() AS hat_aktive_rolle)');
      if v_key = 'using' then v_using := t; else v_check := t; end if;
    end loop;
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;

  -- is_admin() in Einstellungs-Policies: auch der Geschäftsführer darf das
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename not in ('profiles', 'verbesserungsvorschlag', 'rolle', 'profil_rechte')
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_admin()%'
  loop
    v_using := replace(p.qual, 'is_admin()', 'public.darf(''einstellungen.grund:S'')');
    v_check := replace(p.with_check, 'is_admin()', 'public.darf(''einstellungen.grund:S'')');
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;

  -- Fix: Vorschuss-Empfänger lesen getrennt vom Schreiben
  drop policy if exists advance_recipients_lesen on public.advance_recipients;
  create policy advance_recipients_lesen on public.advance_recipients for select
    using (( SELECT public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L']) AS darf_any));

  -- Views (Optionen wie security_invoker bleiben erhalten)
  for p in
    select c.oid, c.relname, c.reloptions, pg_get_viewdef(c.oid, false) as def
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, false) ~ 'hat_rolle\('
  loop
    t := p.def;
    ziel := z -> ('view|' || p.relname);
    for m in select regexp_matches(t, '(hat_rolle\(\s*(?:ARRAY|array)\[([^\]]*)\]\s*(?:::\s*(?:public\.)?user_role\[\])?\s*\))', 'g') loop
      v_rest := (select string_agg(x, ',' order by x) from (
                   select distinct regexp_replace(trim(y), '''|::(public\.)?user_role', '', 'g') x
                   from unnest(string_to_array(m[2], ',')) y) s);
      if ziel is null or not ziel ? v_rest then
        raise exception 'Keine Zuordnung für View % [%]', p.relname, v_rest;
      end if;
      t := replace(t, m[1], ziel ->> v_rest);
      v_anzahl := v_anzahl + 1;
    end loop;
    execute format('create or replace view public.%I as %s', p.relname, rtrim(rtrim(t), ';'));
    if p.reloptions is not null then
      execute format('alter view public.%I set (%s)', p.relname, array_to_string(p.reloptions, ', '));
    end if;
  end loop;

  -- Funktionen
  for p in
    select pr.oid, pr.proname, pg_get_functiondef(pr.oid) as def
    from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.prokind in ('f', 'p')
      and pr.proname not in ('hat_rolle', 'hat_rolle_ausser', 'current_rollen', 'current_role_name',
                             'rechnung_speichern')
      and not exists (select 1 from pg_depend dd where dd.objid = pr.oid and dd.deptype = 'e')
      and pg_get_functiondef(pr.oid) ~ 'hat_rolle\('
  loop
    t := p.def;
    ziel := z -> ('funktion|' || p.proname);
    for m in select regexp_matches(t, '(hat_rolle\(\s*(?:ARRAY|array)\[([^\]]*)\]\s*(?:::\s*(?:public\.)?user_role\[\])?\s*\))', 'g') loop
      v_rest := (select string_agg(x, ',' order by x) from (
                   select distinct regexp_replace(trim(y), '''|::(public\.)?user_role', '', 'g') x
                   from unnest(string_to_array(m[2], ',')) y) s);
      if ziel is null or not ziel ? v_rest then
        raise exception 'Keine Zuordnung für Funktion % [%]', p.proname, v_rest;
      end if;
      t := replace(t, m[1], ziel ->> v_rest);
      v_anzahl := v_anzahl + 1;
    end loop;
    execute t;
  end loop;

  -- 8) Altes entfernen ---------------------------------------------------------------
  for p in
    select pr.oid::regprocedure as sig from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public'
      and pr.proname in ('rechnung_speichern', 'hat_rolle', 'hat_rolle_ausser', 'current_rollen', 'current_role_name')
  loop
    execute format('drop function %s', p.sig);
  end loop;

  -- profiles_rollen_sync arbeitet unverändert mit Text weiter (Hauptrolle in rollen)

  -- 9) Kontrolle ---------------------------------------------------------------------
  select string_agg(x, ', ') into v_rest from (
    select 'policy ' || tablename || '.' || policyname as x from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(hat_rolle|hat_rolle_ausser|current_rollen|current_role_name)\(|user_role'
    union all
    select 'view ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, false) ~ '(hat_rolle|hat_rolle_ausser|current_rollen|current_role_name)\(|user_role'
    union all
    select 'funktion ' || pr.proname from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend dd where dd.objid = pr.oid and dd.deptype = 'e')
      and pg_get_functiondef(pr.oid) ~ '(hat_rolle|hat_rolle_ausser|current_rollen|current_role_name)\(|user_role'
  ) r;
  if v_rest is not null then
    raise exception 'Noch nicht umgestellt: % - Migration wird komplett zurückgerollt, bitte Claude melden', v_rest;
  end if;
  if (select count(*) from rolle) < 11 or (select count(*) from recht_katalog) <> %%ANZAHL%% then
    raise exception 'Katalog/Rollen unvollständig';
  end if;
  raise notice 'Rechte-Umbau: % Rollenprüfungen umgestellt', v_anzahl;
end
$umbau$;
"""

if __name__ == "__main__":
    main()
