-- ============================================================================
-- Migration 2026-11-25: Stufe 3c - Lohnberechnung: Sätze je Bereich,
-- Unterkunft/Verpflegung-Ausnahmen als Zeiträume, Minijob.
--
-- Nutzer-Vorgabe 2026-11-24 (docs/zwei-personalstaemme-plan.md):
--   * Verkäufer haben eigene Sätze für Unterkunft/Verpflegung (und Kleidung).
--   * Viele Verkäufer wohnen/essen nicht bei uns; Wechsel auf "ohne Essen"
--     ab einem bestimmten Monat muss gehen.
--   * Minijob als Beschäftigungsart; Netto rechnet HSC, die App dokumentiert
--     (RV-Befreiung) und warnt bei Überschreiten der Minijob-Grenze.
--
-- Für alle heutigen Personen (alle Landwirtschaft, keine Ausnahmen) ändert
-- sich an der Berechnung NICHTS. Nachweis: Schritt 4 rechnet jede Zeile der
-- Saison- und der Monats-Lohnübersicht vorher und nachher und stellt nur
-- um, wenn alle Zeilen auf den Cent identisch sind. Schritt 4 ist EIN
-- DO-Block - Postgres führt ihn ganz oder gar nicht aus (auch in der
-- Supabase-Konsole, die Anweisungen einzeln ausführt).
--
-- Reihenfolge in der Datei = Reihenfolge der Ausführung; jede Anweisung ist
-- für sich wiederholbar.
-- ============================================================================

-- 1) Minijob als Abrechnungsart (eigene Anweisung - Enum-Werte müssen vor
--    ihrer Verwendung festgeschrieben sein)
alter type public.abrechnungsart add value if not exists 'minijob';

-- 2) Neue Tabellen / Spalten --------------------------------------------------------
-- 2a) Sätze je Bereich (nur für Bereiche AUSSER Landwirtschaft - die
--     Landwirtschaft nutzt weiter verpflegungssaetze). Ohne Eintrag gelten
--     die Sätze aus verpflegungssaetze.
create table if not exists public.bereich_saetze (
  saison_jahr int not null,
  bereich text not null references public.geschaeftsbereich (kuerzel) on update cascade,
  verpflegung numeric(6, 2),
  wohnen numeric(6, 2),
  kleidung_hose numeric(6, 2),
  kleidung_jacke numeric(6, 2),
  kleidung_stiefel numeric(6, 2),
  primary key (saison_jahr, bereich),
  check (bereich <> 'LW')
);
alter table public.bereich_saetze enable row level security;
drop policy if exists "bereich_saetze_select" on public.bereich_saetze;
create policy "bereich_saetze_select" on public.bereich_saetze for select
  using ((select hat_aktive_rolle()));
drop policy if exists "bereich_saetze_admin" on public.bereich_saetze;
create policy "bereich_saetze_admin" on public.bereich_saetze for all
  using ((select is_admin())) with check ((select is_admin()));
revoke all on public.bereich_saetze from anon;
grant select, insert, update, delete on public.bereich_saetze to authenticated;

-- 2b) Ausnahmen: Zeiträume OHNE Verpflegung bzw. OHNE Unterkunft. Ohne
--     Eintrag wird wie bisher jeder Anwesenheitstag berechnet.
create table if not exists public.employee_abzug_ausnahme (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  art text not null check (art in ('verpflegung', 'unterkunft')),
  von date not null,
  bis date,
  notiz text,
  erstellt_von uuid references public.profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  check (bis is null or bis >= von)
);
create index if not exists idx_employee_abzug_ausnahme on public.employee_abzug_ausnahme (employee_id, art);
alter table public.employee_abzug_ausnahme enable row level security;
drop policy if exists "employee_abzug_ausnahme_select" on public.employee_abzug_ausnahme;
create policy "employee_abzug_ausnahme_select" on public.employee_abzug_ausnahme for select
  using ((select hat_rolle(array['admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management']::user_role[])));
drop policy if exists "employee_abzug_ausnahme_write" on public.employee_abzug_ausnahme;
create policy "employee_abzug_ausnahme_write" on public.employee_abzug_ausnahme for all
  using ((select hat_rolle(array['admin', 'hr', 'lohnabrechnung']::user_role[])))
  with check ((select hat_rolle(array['admin', 'hr', 'lohnabrechnung']::user_role[])));
drop policy if exists "bereich_grenze" on public.employee_abzug_ausnahme;
create policy "bereich_grenze" on public.employee_abzug_ausnahme as restrictive for all to authenticated
  using (not (select bereich_filter_aktiv()) or employee_id in (
    select e.id from public.employees e where e.bereich = any ((select current_bereiche())::text[])))
  with check (not (select bereich_filter_aktiv()) or employee_id in (
    select e.id from public.employees e where e.bereich = any ((select current_bereiche())::text[])));
revoke all on public.employee_abzug_ausnahme from anon;
grant select, insert, update, delete on public.employee_abzug_ausnahme to authenticated;
drop trigger if exists trg_audit_employee_abzug_ausnahme on public.employee_abzug_ausnahme;
create trigger trg_audit_employee_abzug_ausnahme after insert or update or delete on public.employee_abzug_ausnahme
  for each row execute function public.write_audit_log();

-- 2c) Minijob: RV-Befreiung (Dokumentation) und Minijob-Grenze je Jahr
alter table public.employees add column if not exists minijob_rv_befreit boolean not null default false;
grant select (minijob_rv_befreit), insert (minijob_rv_befreit), update (minijob_rv_befreit)
  on public.employees to authenticated;
alter table public.verpflegungssaetze add column if not exists minijob_grenze numeric(8, 2);

-- employee_personaldaten neu anlegen, damit die neue Spalte enthalten ist
-- (select * wird beim Anlegen aufgelöst) - Filter wie bisher.
create or replace view public.employee_personaldaten as
  select * from public.employees
  where (select hat_rolle(array['admin', 'hr']::user_role[]))
    and (not (select bereich_filter_aktiv()) or bereich = any ((select current_bereiche())::text[]))
with local check option;
alter view public.employee_personaldaten set (security_barrier = true);

-- 3) Beschriftung Minijob
create or replace function public.abrechnungsart_label(p_abrechnungsart abrechnungsart)
returns text language sql immutable
as $$
  select case p_abrechnungsart::text
    when 'pauschal' then 'PA'
    when 'lohnsteuerklasse_1' then 'StKl 1'
    when 'sozialversicherungspflichtig' then 'SV-Pfl.'
    when 'minijob' then 'Minijob'
    else p_abrechnungsart::text
  end;
$$;

-- 4) Lohnberechnung umstellen - MIT NACHWEIS, ALLES IN EINEM BLOCK --------------------
do $$
declare
  v_ss_alt text := rtrim(rtrim(pg_get_viewdef('public.season_summary'::regclass, false)), ';');
  v_sm_alt text := rtrim(rtrim(pg_get_viewdef('public.season_summary_monat'::regclass, false)), ';');
  v_ss_neu text;
  v_sm_neu text;
  v_abw bigint;
  v_zeilen bigint;
  v_zeilen_m bigint;
begin
  if v_ss_alt like '%employee_abzug_ausnahme%' then
    raise notice 'Lohnberechnung ist bereits umgestellt - nichts zu tun.';
    return;
  end if;

  v_ss_neu := v_ss_alt;
  v_sm_neu := v_sm_alt;

  -- Saison: Tage mit Verpflegung / Unterkunft (Anwesenheitstage ohne
  -- Ausnahme-Zeiträume)
  if (length(v_ss_neu) - length(replace(v_ss_neu,
      'count(*) FILTER (WHERE ((we2.stunden IS NOT NULL) OR (we2.markierung IS NOT NULL))) AS anwesenheitstage', '')))
      / length('count(*) FILTER (WHERE ((we2.stunden IS NOT NULL) OR (we2.markierung IS NOT NULL))) AS anwesenheitstage') <> 1 then
    raise exception 'season_summary: Stelle "anwesenheitstage" nicht eindeutig gefunden - nichts geändert, bitte Claude melden';
  end if;
  v_ss_neu := replace(v_ss_neu,
    'count(*) FILTER (WHERE ((we2.stunden IS NOT NULL) OR (we2.markierung IS NOT NULL))) AS anwesenheitstage',
    'count(*) FILTER (WHERE ((we2.stunden IS NOT NULL) OR (we2.markierung IS NOT NULL))) AS anwesenheitstage, '
    || 'count(*) FILTER (WHERE (((we2.stunden IS NOT NULL) OR (we2.markierung IS NOT NULL)) AND NOT EXISTS (SELECT 1 FROM employee_abzug_ausnahme x '
    || 'WHERE x.employee_id = e.id AND x.art = ''verpflegung'' AND we2.datum >= x.von AND (x.bis IS NULL OR we2.datum <= x.bis)))) AS verpflegungstage, '
    || 'count(*) FILTER (WHERE (((we2.stunden IS NOT NULL) OR (we2.markierung IS NOT NULL)) AND NOT EXISTS (SELECT 1 FROM employee_abzug_ausnahme x '
    || 'WHERE x.employee_id = e.id AND x.art = ''unterkunft'' AND we2.datum >= x.von AND (x.bis IS NULL OR we2.datum <= x.bis)))) AS wohntage');

  -- Saison: Abzüge mit Sätzen je Bereich und Ausnahme-Tagen
  if position('(COALESCE(v_1.verpflegung, (0)::numeric) * (GREATEST((0)::bigint, (we.anwesenheitstage - COALESCE(b.verpflegungsfreie_tage, 0))))::numeric) AS abzug_verpflegung' in v_ss_neu) = 0
     or position('(COALESCE(v_1.wohnen, (0)::numeric) * (we.anwesenheitstage)::numeric) AS abzug_wohnen' in v_ss_neu) = 0
     or position('LEFT JOIN verpflegungssaetze v_1 ON ((v_1.saison_jahr = we.saison_jahr)))' in v_ss_neu) = 0
     or position('COALESCE(v_1.kleidung_hose, (0)::numeric)' in v_ss_neu) = 0 then
    raise exception 'season_summary: erwartete Formel nicht gefunden - nichts geändert, bitte Claude melden';
  end if;
  v_ss_neu := replace(v_ss_neu,
    '(COALESCE(v_1.verpflegung, (0)::numeric) * (GREATEST((0)::bigint, (we.anwesenheitstage - COALESCE(b.verpflegungsfreie_tage, 0))))::numeric) AS abzug_verpflegung',
    '(COALESCE(bs.verpflegung, v_1.verpflegung, (0)::numeric) * (GREATEST((0)::bigint, (we.verpflegungstage - COALESCE(b.verpflegungsfreie_tage, 0))))::numeric) AS abzug_verpflegung');
  v_ss_neu := replace(v_ss_neu,
    '(COALESCE(v_1.wohnen, (0)::numeric) * (we.anwesenheitstage)::numeric) AS abzug_wohnen',
    '(COALESCE(bs.wohnen, v_1.wohnen, (0)::numeric) * (we.wohntage)::numeric) AS abzug_wohnen');
  v_ss_neu := replace(v_ss_neu, 'COALESCE(v_1.kleidung_hose, (0)::numeric)', 'COALESCE(bs.kleidung_hose, v_1.kleidung_hose, (0)::numeric)');
  v_ss_neu := replace(v_ss_neu, 'COALESCE(v_1.kleidung_jacke, (0)::numeric)', 'COALESCE(bs.kleidung_jacke, v_1.kleidung_jacke, (0)::numeric)');
  v_ss_neu := replace(v_ss_neu, 'COALESCE(v_1.kleidung_stiefel, (0)::numeric)', 'COALESCE(bs.kleidung_stiefel, v_1.kleidung_stiefel, (0)::numeric)');
  v_ss_neu := replace(v_ss_neu,
    'LEFT JOIN verpflegungssaetze v_1 ON ((v_1.saison_jahr = we.saison_jahr)))',
    'LEFT JOIN verpflegungssaetze v_1 ON ((v_1.saison_jahr = we.saison_jahr))) '
    || 'LEFT JOIN bereich_saetze bs ON (((bs.saison_jahr = we.saison_jahr) AND (bs.bereich = e.bereich)))');

  -- Monat: dieselben Tage je Monat und dieselben Sätze
  if position('count(*) FILTER (WHERE ((w.stunden IS NOT NULL) OR (w.markierung IS NOT NULL))) AS anwesenheitstage,' in v_sm_neu) = 0
     or position('we.anwesenheitstage,' in v_sm_neu) = 0
     or position('(COALESCE(v_1.verpflegung, (0)::numeric) * (COALESCE(m.anwesenheitstage, (0)::bigint))::numeric) AS abzug_verpflegung' in v_sm_neu) = 0
     or position('(COALESCE(v_1.wohnen, (0)::numeric) * (COALESCE(m.anwesenheitstage, (0)::bigint))::numeric) AS abzug_wohnen' in v_sm_neu) = 0
     or position('LEFT JOIN verpflegungssaetze v_1 ON ((v_1.saison_jahr = m.saison_jahr)))' in v_sm_neu) = 0 then
    raise exception 'season_summary_monat: erwartete Formel nicht gefunden - nichts geändert, bitte Claude melden';
  end if;
  v_sm_neu := replace(v_sm_neu,
    'count(*) FILTER (WHERE ((w.stunden IS NOT NULL) OR (w.markierung IS NOT NULL))) AS anwesenheitstage,',
    'count(*) FILTER (WHERE ((w.stunden IS NOT NULL) OR (w.markierung IS NOT NULL))) AS anwesenheitstage, '
    || 'count(*) FILTER (WHERE (((w.stunden IS NOT NULL) OR (w.markierung IS NOT NULL)) AND NOT EXISTS (SELECT 1 FROM employee_abzug_ausnahme x '
    || 'WHERE x.employee_id = w.employee_id AND x.art = ''verpflegung'' AND w.datum >= x.von AND (x.bis IS NULL OR w.datum <= x.bis)))) AS verpflegungstage, '
    || 'count(*) FILTER (WHERE (((w.stunden IS NOT NULL) OR (w.markierung IS NOT NULL)) AND NOT EXISTS (SELECT 1 FROM employee_abzug_ausnahme x '
    || 'WHERE x.employee_id = w.employee_id AND x.art = ''unterkunft'' AND w.datum >= x.von AND (x.bis IS NULL OR w.datum <= x.bis)))) AS wohntage,');
  v_sm_neu := replace(v_sm_neu, 'we.anwesenheitstage,', 'we.anwesenheitstage, we.verpflegungstage, we.wohntage,');
  v_sm_neu := replace(v_sm_neu,
    '(COALESCE(v_1.verpflegung, (0)::numeric) * (COALESCE(m.anwesenheitstage, (0)::bigint))::numeric) AS abzug_verpflegung',
    '(COALESCE(bs.verpflegung, v_1.verpflegung, (0)::numeric) * (COALESCE(m.verpflegungstage, (0)::bigint))::numeric) AS abzug_verpflegung');
  v_sm_neu := replace(v_sm_neu,
    '(COALESCE(v_1.wohnen, (0)::numeric) * (COALESCE(m.anwesenheitstage, (0)::bigint))::numeric) AS abzug_wohnen',
    '(COALESCE(bs.wohnen, v_1.wohnen, (0)::numeric) * (COALESCE(m.wohntage, (0)::bigint))::numeric) AS abzug_wohnen');
  v_sm_neu := replace(v_sm_neu,
    'LEFT JOIN verpflegungssaetze v_1 ON ((v_1.saison_jahr = m.saison_jahr)))',
    'LEFT JOIN verpflegungssaetze v_1 ON ((v_1.saison_jahr = m.saison_jahr))) '
    || 'LEFT JOIN bereich_saetze bs ON (((bs.saison_jahr = m.saison_jahr) AND (bs.bereich = e.bereich)))');

  -- Nachweis: beide Fassungen OHNE Rollen-/Bereichsfilter rechnen (die
  -- Filter würden in der Konsole ohne Login alles ausblenden) und Zeile für
  -- Zeile vergleichen (EXCEPT ALL in beide Richtungen).
  drop table if exists _ss_alt;
  drop table if exists _sm_alt;
  execute 'create temp table _ss_alt on commit drop as ' || regexp_replace(regexp_replace(v_ss_alt,
    'WHERE \( SELECT hat_rolle\(ARRAY\[[^]]*\]\) AS hat_rolle\)\) v', ') v'),
    '\) v\s+WHERE \(\(NOT \( SELECT bereich_filter_aktiv\(\).*$', ') v');
  execute 'create temp table _sm_alt on commit drop as ' || regexp_replace(regexp_replace(v_sm_alt,
    'WHERE \( SELECT hat_rolle\(ARRAY\[[^]]*\]\) AS hat_rolle\)\) v', ') v'),
    '\) v\s+WHERE \(\(NOT \( SELECT bereich_filter_aktiv\(\).*$', ') v');

  execute 'create or replace view public.season_summary as ' || v_ss_neu;
  execute 'create or replace view public.season_summary_monat as ' || v_sm_neu;

  v_ss_neu := regexp_replace(regexp_replace(v_ss_neu,
    'WHERE \( SELECT hat_rolle\(ARRAY\[[^]]*\]\) AS hat_rolle\)\) v', ') v'),
    '\) v\s+WHERE \(\(NOT \( SELECT bereich_filter_aktiv\(\).*$', ') v');
  v_sm_neu := regexp_replace(regexp_replace(v_sm_neu,
    'WHERE \( SELECT hat_rolle\(ARRAY\[[^]]*\]\) AS hat_rolle\)\) v', ') v'),
    '\) v\s+WHERE \(\(NOT \( SELECT bereich_filter_aktiv\(\).*$', ') v');

  select count(*) into v_zeilen from _ss_alt;
  select count(*) into v_zeilen_m from _sm_alt;
  execute format('select count(*) from ((select * from _ss_alt except all select * from (%s) n)
                    union all (select * from (%s) n2 except all select * from _ss_alt)) d', v_ss_neu, v_ss_neu)
    into v_abw;
  if v_abw > 0 then
    raise exception 'Saison-Lohnübersicht: % abweichende Zeilen - Lohnberechnung NICHT umgestellt, bitte Claude melden', v_abw;
  end if;
  execute format('select count(*) from ((select * from _sm_alt except all select * from (%s) n)
                    union all (select * from (%s) n2 except all select * from _sm_alt)) d', v_sm_neu, v_sm_neu)
    into v_abw;
  if v_abw > 0 then
    raise exception 'Monats-Lohnübersicht: % abweichende Zeilen - Lohnberechnung NICHT umgestellt, bitte Claude melden', v_abw;
  end if;
  if v_zeilen = 0 then
    raise exception 'Nachweis ohne Daten (0 Zeilen) - Filter wurden nicht entfernt, nichts geändert, bitte Claude melden';
  end if;

  raise notice 'Lohnberechnung umgestellt. Nachweis ok: % Saison-Zeilen und % Monats-Zeilen vorher = nachher (auf den Cent).',
    v_zeilen, v_zeilen_m;
end $$;
