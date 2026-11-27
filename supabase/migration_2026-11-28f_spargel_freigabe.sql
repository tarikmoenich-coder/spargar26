-- ============================================================================
-- Migration 2026-11-28f: Spargelprämien Stufe 3 - Tage aus der Ernteerfassung,
-- Prüfen, Freigeben, Lohn (docs/spargel-praemien-konzept.md).
--
--  1. spargel_tag_vorschau(datum): je Person und Feld kg/Kisten aus den
--     gewogenen Kisten (Erntetag = Tag der Befüllung, Europe/Berlin),
--     Grünspargel-Gruppenmaschinen (max_personen > 1) je Maschine und Feld
--     mit allen angemeldeten Personen. Stunden VORERST aus dem Stundenzettel
--     (work_entries) - die Prämienstunden aus den Maschinendaten folgen nach
--     der Kalibrierung mit einer echten Maschine (CTE "stunden" tauschen).
--     Kategorie aus Stufe 2, Preis und Mindestlohn der Saison, Prüfhinweise.
--  2. spargel_tag: Spalten für Gruppen (maschine_id, praemie_fest,
--     fehlbetrag_fest), Stundenherkunft und -korrektur.
--     Sicht spargel_praemie_tag nutzt bei Gruppen den festen Anteil.
--  3. spargel_freigabe + spargel_tag_freigeben(datum, korrekturen) /
--     spargel_freigabe_aufheben(datum): schreibt einen Tag fest (nur mit
--     Sonderrecht), Aufheben nur solange niemand davon abgerechnet ist.
--  4. Lohn: freigegebene Spargelprämie fließt in season_summary
--     (praemien_summe, bruttolohn) - zusätzlich zum Handfeld spargel_praemie.
-- In der Supabase SQL-Konsole ausführen (ein einziger Block).
-- ============================================================================

do $umbau$
declare
  v_def text;
  v_neu text;
begin
  -- 2) Spalten ------------------------------------------------------------------
  alter table public.spargel_tag
    add column if not exists maschine_id bigint references public.ernte_maschine(id),
    add column if not exists praemie_fest numeric(10,2),     -- Gruppenanteil (festgeschrieben)
    add column if not exists fehlbetrag_fest numeric(10,2),
    add column if not exists stunden_quelle text check (stunden_quelle in ('maschine', 'stundenzettel', 'hand', 'excel')),
    add column if not exists stunden_vorschlag numeric(6,2), -- vor einer Handkorrektur
    add column if not exists stunden_grund text;             -- Begründung der Korrektur
  update public.spargel_tag set stunden_quelle = 'excel' where quelle = 'excel_2026' and stunden_quelle is null;

  create or replace view public.spargel_praemie_tag with (security_invoker = true) as
  with z as (
    select t.*,
      coalesce(t.preis_kg, k.preis_kg) as preis,
      coalesce(t.stundensatz, v.mindestlohn) as satz,
      t.kg * coalesce(t.preis_kg, k.preis_kg) as akkordwert,
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
    bool_or(kategorie is null or preis is null or satz is null) as unvollstaendig,
    sum(akkordwert) as akkordwert,
    sum(lohnanspruch) as lohnanspruch,
    case when bool_or(praemie_fest is not null) then coalesce(sum(praemie_fest), 0)
         when gruppe is not null or bool_or(kategorie is null or preis is null or satz is null) then 0
         else greatest(sum(akkordwert) - sum(lohnanspruch), 0) end as praemie,
    case when bool_or(fehlbetrag_fest is not null) then coalesce(sum(fehlbetrag_fest), 0)
         when bool_or(kategorie is null or preis is null or satz is null) then 0
         else greatest(sum(lohnanspruch) - sum(akkordwert), 0) end as fehlbetrag,
    bool_and(lohnwirksam) as lohnwirksam,
    min(quelle) as quelle,
    bool_or(maschine_id is not null and praemie_fest is not null) as gruppenanteil
  from z
  group by datum, saison_jahr, employee_id, personal_nr, gruppe;

  -- 1) Vorschau aus der Ernteerfassung -----------------------------------------
  create or replace function public.spargel_tag_vorschau(p_datum date)
  returns table (
    employee_id uuid, personal_nr text, name text, feld_id bigint, feld_name text,
    maschine_id bigint, maschine text, gruppe_personen int,
    kg numeric, kisten int, stunden numeric, stunden_quelle text,
    kategorie numeric, preis_kg numeric, stundensatz numeric,
    akkordwert numeric, lohnanspruch numeric, praemie numeric, fehlbetrag numeric,
    hinweise text[])
  language sql stable security invoker set search_path = public as $f$
    with
    kiste as (
      select z.employee_id, z.feld_id, z.maschine_id, m.max_personen, m.nummer, m.bezeichnung as mbez,
             z.gewicht_netto_kg as kg
      from ernte_kiste_zyklus z
      join ernte_maschine m on m.id = z.maschine_id
      where z.status = 'gewogen'
        and (z.befuellt_am at time zone 'Europe/Berlin')::date = p_datum
    ),
    -- Einzelmaschinen: je Person und Feld
    einzel as (
      select k.employee_id, k.feld_id, null::bigint as maschine_id, null::text as maschine,
             1 as gruppe_personen, sum(k.kg) as kg, count(*)::int as kisten
      from kiste k where coalesce(k.max_personen, 1) <= 1 and k.employee_id is not null
      group by k.employee_id, k.feld_id
    ),
    -- Gruppenmaschinen: je Maschine und Feld, Personen = alle Anmeldungen des Tages
    gruppe as (
      select k.maschine_id, k.feld_id, coalesce(k.nummer::text || ' ' || coalesce(k.mbez, ''), k.maschine_id::text) as maschine,
             sum(k.kg) as kg, count(*)::int as kisten
      from kiste k where coalesce(k.max_personen, 1) > 1
      group by k.maschine_id, k.feld_id, k.nummer, k.mbez
    ),
    gruppe_person as (
      select distinct g.maschine_id, g.feld_id, s.employee_id
      from gruppe g
      join ernte_schicht s on s.maschine_id = g.maschine_id
        and (s.beginn at time zone 'Europe/Berlin')::date = p_datum and s.employee_id is not null
    ),
    gruppe_n as (select maschine_id, feld_id, count(*)::int as n from gruppe_person group by 1, 2),
    -- Stunden: VORERST Stundenzettel (später Prämienstunden aus Maschinendaten)
    stunden as (
      select w.employee_id, sum(w.stunden) as std from work_entries w
      where w.datum = p_datum and w.stunden is not null group by w.employee_id
    ),
    -- Personenzeilen (Einzel) mit Stunden anteilig nach kg, falls mehrere Felder
    p_einzel as (
      select e.employee_id, e.feld_id, e.maschine_id, e.maschine, 1 as gruppe_personen, e.kg, e.kisten,
             st.std * e.kg / nullif(sum(e.kg) over (partition by e.employee_id), 0) as stunden
      from einzel e left join stunden st on st.employee_id = e.employee_id
    ),
    p_gruppe as (
      select gp.employee_id, g.feld_id, g.maschine_id, g.maschine, gn.n as gruppe_personen,
             g.kg / gn.n as kg, g.kisten, st.std as stunden, g.kg as gruppe_kg
      from gruppe g
      join gruppe_n gn on gn.maschine_id = g.maschine_id and gn.feld_id is not distinct from g.feld_id
      join gruppe_person gp on gp.maschine_id = g.maschine_id and gp.feld_id is not distinct from g.feld_id
      left join stunden st on st.employee_id = gp.employee_id
    ),
    alle as (
      select employee_id, feld_id, maschine_id, maschine, gruppe_personen, kg, kisten, stunden, null::numeric as gruppe_kg from p_einzel
      union all
      select employee_id, feld_id, maschine_id, maschine, gruppe_personen, kg, kisten, stunden, gruppe_kg from p_gruppe
    ),
    bewertet as (
      select a.*,
        case when a.maschine_id is null then spargel_kategorie_person(a.employee_id, a.feld_id, p_datum)
             else spargel_kategorie_feld(a.feld_id, p_datum) end as kategorie,
        v.mindestlohn as stundensatz
      from alle a
      left join verpflegungssaetze v on v.saison_jahr = extract(year from p_datum)::int
    ),
    mit_preis as (
      select b.*, k.preis_kg
      from bewertet b
      left join spargel_kategorie k on k.saison_jahr = extract(year from p_datum)::int and k.kategorie = b.kategorie
    ),
    -- Gruppen: Prämie der Maschine = Akkordwert − Summe Lohnansprüche, gleich verteilt
    gruppe_summe as (
      select maschine_id, feld_id, sum(coalesce(stunden, 0) * stundensatz) as lohn_summe, count(*) as n
      from mit_preis where maschine_id is not null group by maschine_id, feld_id
    ),
    ungeklaert as (
      select count(*) as n from ernte_kiste_zyklus z
      where z.status in ('offen', 'ungeklaert')
        and (coalesce(z.befuellt_am, z.gewogen_am) at time zone 'Europe/Berlin')::date = p_datum
    )
    select mp.employee_id, e.personal_nr, e.name || ', ' || e.vorname, mp.feld_id, f.bezeichnung,
      mp.maschine_id, mp.maschine, mp.gruppe_personen,
      round(mp.kg, 2), mp.kisten, round(mp.stunden, 2),
      case when mp.stunden is null then null else 'stundenzettel' end,
      mp.kategorie, mp.preis_kg, mp.stundensatz,
      round(mp.kg * mp.preis_kg, 2),
      round(mp.stunden * mp.stundensatz, 2),
      case when mp.maschine_id is not null then
             round(greatest(mp.gruppe_kg * mp.preis_kg - gs.lohn_summe, 0) / gs.n, 2)
           else round(greatest(mp.kg * mp.preis_kg - mp.stunden * mp.stundensatz, 0), 2) end,
      case when mp.maschine_id is not null then
             round(greatest(gs.lohn_summe - mp.gruppe_kg * mp.preis_kg, 0) / gs.n, 2)
           else round(greatest(mp.stunden * mp.stundensatz - mp.kg * mp.preis_kg, 0), 2) end,
      array_remove(array[
        case when mp.stunden is null then 'Stunden fehlen' end,
        case when mp.feld_id is null then 'Kisten ohne Feld' end,
        case when mp.kategorie is null then 'Kategorie fehlt' end,
        case when mp.kategorie is not null and mp.preis_kg is null then 'Kategorie ohne Preis' end,
        case when mp.stundensatz is null then 'Mindestlohn der Saison fehlt' end,
        case when (select n from ungeklaert) > 0 then 'ungeklärte Kisten an diesem Tag' end
      ], null)
    from mit_preis mp
    join employees e on e.id = mp.employee_id
    left join feld f on f.id = mp.feld_id
    left join gruppe_summe gs on gs.maschine_id = mp.maschine_id and gs.feld_id is not distinct from mp.feld_id
    order by f.bezeichnung nulls first, e.name, e.vorname;
  $f$;
  grant execute on function public.spargel_tag_vorschau(date) to authenticated;

  -- 3) Freigabe -----------------------------------------------------------------
  create table if not exists public.spargel_freigabe (
    datum date primary key,
    freigegeben_von uuid default auth.uid(),
    freigegeben_am timestamptz not null default now(),
    zeilen int not null default 0,
    praemie numeric(12,2) not null default 0
  );
  alter table public.spargel_freigabe enable row level security;
  revoke all on public.spargel_freigabe from anon;
  grant select on public.spargel_freigabe to authenticated;
  drop policy if exists spargel_freigabe_lesen on public.spargel_freigabe;
  create policy spargel_freigabe_lesen on public.spargel_freigabe for select
    using (( select public.darf_any(array['ernte.praemien:L', 'ernte.statistik:L', 'lohn.uebersicht:L']) ));
  drop trigger if exists trg_audit_spargel_freigabe on public.spargel_freigabe;
  create trigger trg_audit_spargel_freigabe after insert or update or delete on public.spargel_freigabe
    for each row execute function public.write_audit_log();

  -- p_korrekturen: [{"employee_id": "...", "feld_id": 12, "stunden": 8.5, "grund": "..."}]
  create or replace function public.spargel_tag_freigeben(p_datum date, p_korrekturen jsonb default '[]')
  returns int language plpgsql security definer set search_path = public as $f$
  declare v_n int; v_praemie numeric;
  begin
    if not darf('sonder.spargel_kategorie:S') then
      raise exception 'Keine Berechtigung (Spargelprämien freigeben).';
    end if;
    if exists (select 1 from spargel_freigabe where datum = p_datum) then
      raise exception 'Der % ist bereits freigegeben.', to_char(p_datum, 'DD.MM.YYYY');
    end if;
    if exists (select 1 from spargel_tag where datum = p_datum and quelle = 'excel_2026') then
      raise exception 'Für diesen Tag gibt es Daten aus der Excel 2026 - nicht freigebbar.';
    end if;
    if exists (select 1 from jsonb_array_elements(p_korrekturen) k
               where coalesce(trim(k->>'grund'), '') = '' or (k->>'stunden')::numeric < 0) then
      raise exception 'Jede Stundenkorrektur braucht eine Begründung und Stunden ab 0.';
    end if;

    -- Vorschau mit Korrekturen; Gruppen werden mit korrigierten Stunden neu verteilt
    with v as (
      select vv.*, k.stunden_neu, k.grund
      from spargel_tag_vorschau(p_datum) vv
      left join lateral (
        select (x->>'stunden')::numeric as stunden_neu, x->>'grund' as grund
        from jsonb_array_elements(p_korrekturen) x
        where (x->>'employee_id')::uuid = vv.employee_id
          and (x->>'feld_id')::bigint is not distinct from vv.feld_id
        limit 1) k on true
    ), s as (
      select v.*, coalesce(v.stunden_neu, v.stunden) as std from v
    ), gs as (
      select maschine_id, feld_id, sum(std * stundensatz) as lohn_summe, sum(kg) as kg_summe, count(*) as n
      from s where maschine_id is not null group by 1, 2
    ), fertig as (
      select s.*,
        case when s.maschine_id is not null then round(greatest(gs.kg_summe * s.preis_kg - gs.lohn_summe, 0) / gs.n, 2) end as p_fest,
        case when s.maschine_id is not null then round(greatest(gs.lohn_summe - gs.kg_summe * s.preis_kg, 0) / gs.n, 2) end as f_fest
      from s left join gs on gs.maschine_id = s.maschine_id and gs.feld_id is not distinct from s.feld_id
    )
    select count(*) filter (where std is null or kategorie is null or preis_kg is null or stundensatz is null)
      into v_n from fertig;
    if v_n > 0 then
      raise exception '% Zeile(n) unvollständig (Stunden, Kategorie, Preis oder Mindestlohn fehlt) - bitte erst klären.', v_n;
    end if;

    insert into spargel_tag (datum, employee_id, personal_nr, feld_id, feld_name, kg, stunden, kisten,
                             kategorie_vorschlag, kategorie, preis_kg, stundensatz, quelle, lohnwirksam,
                             maschine_id, praemie_fest, fehlbetrag_fest, stunden_quelle, stunden_vorschlag, stunden_grund)
    with v as (
      select vv.*, k.stunden_neu, k.grund
      from spargel_tag_vorschau(p_datum) vv
      left join lateral (
        select (x->>'stunden')::numeric as stunden_neu, x->>'grund' as grund
        from jsonb_array_elements(p_korrekturen) x
        where (x->>'employee_id')::uuid = vv.employee_id
          and (x->>'feld_id')::bigint is not distinct from vv.feld_id
        limit 1) k on true
    ), s as (
      select v.*, coalesce(v.stunden_neu, v.stunden) as std from v
    ), gs as (
      select maschine_id, feld_id, sum(std * stundensatz) as lohn_summe, sum(kg) as kg_summe, count(*) as n
      from s where maschine_id is not null group by 1, 2
    )
    select p_datum, s.employee_id, s.personal_nr, s.feld_id, s.feld_name, s.kg, s.std, s.kisten,
      case when s.maschine_id is null then spargel_kategorie_feld(s.feld_id, p_datum) else s.kategorie end,
      s.kategorie, s.preis_kg, s.stundensatz, 'ernteerfassung', true,
      s.maschine_id,
      case when s.maschine_id is not null then round(greatest(gs.kg_summe * s.preis_kg - gs.lohn_summe, 0) / gs.n, 2) end,
      case when s.maschine_id is not null then round(greatest(gs.lohn_summe - gs.kg_summe * s.preis_kg, 0) / gs.n, 2) end,
      case when s.stunden_neu is not null then 'hand' else s.stunden_quelle end,
      case when s.stunden_neu is not null then s.stunden end,
      s.grund
    from s left join gs on gs.maschine_id = s.maschine_id and gs.feld_id is not distinct from s.feld_id;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'Für den % gibt es keine gewogenen Spargelkisten.', to_char(p_datum, 'DD.MM.YYYY');
    end if;

    select coalesce(sum(praemie), 0) into v_praemie from spargel_praemie_tag where datum = p_datum and quelle = 'ernteerfassung';
    insert into spargel_freigabe (datum, zeilen, praemie) values (p_datum, v_n, v_praemie);
    return v_n;
  end $f$;
  revoke all on function public.spargel_tag_freigeben(date, jsonb) from public, anon;
  grant execute on function public.spargel_tag_freigeben(date, jsonb) to authenticated;

  create or replace function public.spargel_freigabe_aufheben(p_datum date)
  returns void language plpgsql security definer set search_path = public as $f$
  begin
    if not darf('sonder.spargel_kategorie:S') then
      raise exception 'Keine Berechtigung (Spargelprämien freigeben).';
    end if;
    if exists (
      select 1 from spargel_tag t
      join season_bonuses b on b.employee_id = t.employee_id and b.saison_jahr = t.saison_jahr
      where t.datum = p_datum and t.quelle = 'ernteerfassung' and b.abgerechnet_am is not null) then
      raise exception 'Mindestens eine Person dieses Tages ist schon abgerechnet - Freigabe kann nicht zurückgenommen werden.';
    end if;
    delete from spargel_tag where datum = p_datum and quelle = 'ernteerfassung';
    delete from spargel_freigabe where datum = p_datum;
  end $f$;
  revoke all on function public.spargel_freigabe_aufheben(date) from public, anon;
  grant execute on function public.spargel_freigabe_aufheben(date) to authenticated;

  update public.recht_katalog
  set titel = 'Spargelprämien festlegen und freigeben',
      unter = 'Kategorien und Preise festlegen/überschreiben, Tage prüfen und freigeben'
  where id = 'sonder.spargel_kategorie';

  -- 4) Lohn: freigegebene Spargelprämie in season_summary -----------------------
  v_def := pg_get_viewdef('public.season_summary'::regclass, false);
  if position('spargel_praemie_tag' in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, 'COALESCE(b.spargel_praemie, (0)::numeric)', ''))) / length('COALESCE(b.spargel_praemie, (0)::numeric)') <> 2
       or (length(v_def) - length(replace(v_def, ') zm ON (true))', ''))) / length(') zm ON (true))') <> 1 then
      raise exception 'season_summary: erwartete Stellen nicht gefunden - nichts geändert, bitte Claude melden';
    end if;
    v_neu := replace(v_def, 'COALESCE(b.spargel_praemie, (0)::numeric)',
      '(COALESCE(b.spargel_praemie, (0)::numeric) + COALESCE(sp.spargel_praemie_summe, (0)::numeric))');
    v_neu := replace(v_neu, ') zm ON (true))',
      ') zm ON (true)) LEFT JOIN LATERAL ( SELECT sum(st.praemie) AS spargel_praemie_summe FROM spargel_praemie_tag st '
      || 'WHERE ((st.employee_id = e.id) AND (st.saison_jahr = we.saison_jahr) AND st.lohnwirksam)) sp ON (true)');
    execute 'create or replace view public.season_summary as ' || rtrim(rtrim(v_neu), ';');
  end if;
end
$umbau$;
