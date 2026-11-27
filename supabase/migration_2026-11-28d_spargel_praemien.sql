-- ============================================================================
-- Migration 2026-11-28d: Spargelprämien Stufe 1 - Kategorien, Tageszeilen,
-- Berechnung (docs/spargel-praemien-konzept.md).
--
--  1. spargel_kategorie: je Saisonjahr Kategorie -> Preis je kg (2026 aus der
--     Excel: 1,05 € - 0,05 € x Kategorie, halbe Stufen, 1 bis 15).
--  2. spargel_feld_kategorie: Standard-Kategorie je Feld und Saisonjahr
--     (2026 = erste Kategorie des Feldes in den Rohdaten, kommt mit den Daten).
--  3. spargel_tag: Tageszeilen Person x Tag x Feld (2026 einmalig aus der
--     Excel, später aus der Ernteerfassung). Festgeschrieben: Kategorie und
--     Stundensatz. Gruppenzeilen ohne Person bekommen keine Prämie.
--  4. Sicht spargel_praemie_tag: je Person (bzw. Gruppe) und Tag Akkordwert,
--     Lohnanspruch, Prämie (nur positiv) und Fehlbetrag (nur Info).
--  5. Neues Sonderrecht "Spargel-Kategorien festlegen" (nur Geschäftsführung;
--     Administrator und Geschäftsführer haben es über "alle Rechte").
--
-- Die Daten 2026 kommen mit einer eigenen Datei (nicht im Repository, enthält
-- Leistungsdaten je Personalnummer).
-- In der Supabase SQL-Konsole ausführen (ein einziger Block).
-- ============================================================================

do $umbau$
begin
  -- 1) Kategorien ----------------------------------------------------------------
  create table if not exists public.spargel_kategorie (
    saison_jahr int not null,
    kategorie numeric(4,1) not null check (kategorie > 0),
    preis_kg numeric(6,3) not null check (preis_kg >= 0),
    primary key (saison_jahr, kategorie)
  );
  insert into public.spargel_kategorie (saison_jahr, kategorie, preis_kg)
  select 2026, k, 1.05 - 0.05 * k from generate_series(1.0, 15.0, 0.5) k
  on conflict do nothing;

  -- 2) Standard-Kategorie je Feld ------------------------------------------------
  create table if not exists public.spargel_feld_kategorie (
    saison_jahr int not null,
    feld_id bigint not null references public.feld(id) on delete cascade,
    kategorie numeric(4,1) not null check (kategorie > 0),
    primary key (saison_jahr, feld_id)
  );

  -- 3) Tageszeilen ---------------------------------------------------------------
  create table if not exists public.spargel_tag (
    id bigint generated always as identity primary key,
    datum date not null,
    saison_jahr int generated always as (extract(year from datum)::int) stored,
    employee_id uuid references public.employees(id),
    personal_nr text,                    -- wie geliefert (auch ohne Treffer)
    gruppe text,                         -- Gruppenzeile ohne Person: keine Prämie
    feld_id bigint references public.feld(id),
    feld_name text,                      -- Feldname aus der Quelle
    kg numeric(9,2) not null check (kg >= 0),
    stunden numeric(6,2) not null check (stunden >= 0),
    kisten int,
    kategorie_vorschlag numeric(4,1),    -- 2026: aus Preis/kg des alten Programms
    kategorie numeric(4,1) check (kategorie > 0),  -- wirksame Kategorie
    stundensatz numeric(6,2),            -- festgeschrieben; leer = Mindestlohn des Jahres
    quelle text not null check (quelle in ('excel_2026', 'ernteerfassung')),
    -- fließt in den Lohn (2026: nein, lief über die Excel)
    lohnwirksam boolean not null default false,
    erstellt_am timestamptz not null default now()
  );
  create index if not exists spargel_tag_datum on public.spargel_tag (datum);
  create index if not exists spargel_tag_employee on public.spargel_tag (employee_id, datum);
  create index if not exists spargel_tag_feld on public.spargel_tag (feld_id, datum);

  -- 4) Berechnung je Person (bzw. Gruppe) und Tag ---------------------------------
  create or replace view public.spargel_praemie_tag with (security_invoker = true) as
  with z as (
    select t.*,
      k.preis_kg,
      coalesce(t.stundensatz, v.mindestlohn) as satz,
      t.kg * k.preis_kg as akkordwert,
      t.stunden * coalesce(t.stundensatz, v.mindestlohn) as lohnanspruch
    from public.spargel_tag t
    left join public.spargel_kategorie k on k.saison_jahr = t.saison_jahr and k.kategorie = t.kategorie
    left join public.verpflegungssaetze v on v.saison_jahr = t.saison_jahr
  )
  select
    datum, saison_jahr, employee_id, personal_nr, gruppe,
    min(feld_id) as feld_id,
    string_agg(distinct coalesce(feld_name, ''), ', ') as feld_name,
    count(distinct coalesce(feld_id::text, feld_name)) as felder,
    sum(kg) as kg,
    sum(stunden) as stunden,
    sum(kisten) as kisten,
    min(kategorie) as kategorie_min,
    max(kategorie) as kategorie_max,
    bool_or(kategorie is distinct from kategorie_vorschlag) as kategorie_geaendert,
    bool_or(kategorie is null or preis_kg is null or satz is null) as unvollstaendig,
    sum(akkordwert) as akkordwert,
    sum(lohnanspruch) as lohnanspruch,
    case when gruppe is not null or bool_or(kategorie is null or preis_kg is null or satz is null) then 0
         else greatest(sum(akkordwert) - sum(lohnanspruch), 0) end as praemie,
    case when bool_or(kategorie is null or preis_kg is null or satz is null) then 0
         else greatest(sum(lohnanspruch) - sum(akkordwert), 0) end as fehlbetrag,
    bool_and(lohnwirksam) as lohnwirksam,
    min(quelle) as quelle
  from z
  group by datum, saison_jahr, employee_id, personal_nr, gruppe;

  -- 5) Recht + Zugriffe ----------------------------------------------------------
  insert into public.recht_katalog (id, modul, titel, unter, sensibel, nur_lesen, sortierung)
  values ('sonder.spargel_kategorie', 'Sonderrechte', 'Spargel-Kategorien festlegen',
          'Preise je Kategorie, Standard je Feld, Kategorien je Tag/Feld/Person überschreiben',
          false, false, 47)
  on conflict (id) do nothing;

  alter table public.spargel_kategorie enable row level security;
  alter table public.spargel_feld_kategorie enable row level security;
  alter table public.spargel_tag enable row level security;
  revoke all on public.spargel_kategorie, public.spargel_feld_kategorie, public.spargel_tag from anon;
  grant select, insert, update, delete on public.spargel_kategorie, public.spargel_feld_kategorie to authenticated;
  grant select on public.spargel_tag, public.spargel_praemie_tag to authenticated;
  revoke insert, update, delete on public.spargel_tag from authenticated;

  drop policy if exists spargel_kategorie_lesen on public.spargel_kategorie;
  create policy spargel_kategorie_lesen on public.spargel_kategorie for select
    using (( select public.darf_any(array['ernte.praemien:L', 'ernte.statistik:L', 'lohn.uebersicht:L']) ));
  drop policy if exists spargel_kategorie_schreiben on public.spargel_kategorie;
  create policy spargel_kategorie_schreiben on public.spargel_kategorie for all
    using (( select public.darf('sonder.spargel_kategorie:S') ))
    with check (( select public.darf('sonder.spargel_kategorie:S') ));

  drop policy if exists spargel_feld_kategorie_lesen on public.spargel_feld_kategorie;
  create policy spargel_feld_kategorie_lesen on public.spargel_feld_kategorie for select
    using (( select public.darf_any(array['ernte.praemien:L', 'ernte.statistik:L', 'lohn.uebersicht:L']) ));
  drop policy if exists spargel_feld_kategorie_schreiben on public.spargel_feld_kategorie;
  create policy spargel_feld_kategorie_schreiben on public.spargel_feld_kategorie for all
    using (( select public.darf('sonder.spargel_kategorie:S') ))
    with check (( select public.darf('sonder.spargel_kategorie:S') ));

  drop policy if exists spargel_tag_lesen on public.spargel_tag;
  create policy spargel_tag_lesen on public.spargel_tag for select
    using (( select public.darf_any(array['ernte.praemien:L', 'ernte.statistik:L', 'lohn.uebersicht:L']) ));
  -- Bereichsgrenze wie bei den anderen Personen-Tabellen (Spargel = Landwirtschaft)
  drop policy if exists bereich_select on public.spargel_tag;
  create policy bereich_select on public.spargel_tag as restrictive for select
    using (employee_id is null or employee_id in (
      select e.id from public.employees e
      where e.bereich = any (( select public.bereiche_fuer(array['ernte.praemien:L', 'ernte.statistik:L', 'lohn.uebersicht:L']) )::text[])));

  drop trigger if exists trg_audit_spargel_kategorie on public.spargel_kategorie;
  create trigger trg_audit_spargel_kategorie after insert or update or delete on public.spargel_kategorie
    for each row execute function public.write_audit_log();
  drop trigger if exists trg_audit_spargel_feld_kategorie on public.spargel_feld_kategorie;
  create trigger trg_audit_spargel_feld_kategorie after insert or update or delete on public.spargel_feld_kategorie
    for each row execute function public.write_audit_log();
end
$umbau$;
