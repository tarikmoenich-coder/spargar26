-- ============================================================================
-- Migration 2026-11-28e: Spargelprämien Stufe 2 - Kategorien festlegen und
-- überschreiben (docs/spargel-praemien-konzept.md, Abschnitt 3).
--
--  1. spargel_kategorie_tag: Festlegungen der Geschäftsführung je Tag - für
--     alle Felder (feld_id leer), je Feld, oder je Person (employee_id).
--  2. spargel_kategorie_feld(feld, datum): wirksame Kategorie eines Feldes an
--     einem Tag = Festlegung für das Feld an dem Tag -> sonst für alle Felder
--     an dem Tag -> sonst die letzte frühere Festlegung derselben Saison
--     (Folgetag übernimmt Vortag) -> sonst Standard-Kategorie des Feldes.
--     spargel_kategorie_person(person, feld, datum): Person-Festlegung, sonst
--     wie das Feld.
--  3. Kategorie muss in der Saison existieren (keine Kategorie 0).
--  4. spargel_tag.preis_kg: Preis je kg wird in der Tageszeile festgeschrieben
--     (2026 aus der Kategorien-Tabelle) - eine spätere Preisänderung ändert
--     keine abgerechneten Tage.
--  5. spargel_kategorien_am(datum): alle Spargelfelder mit wirksamer
--     Kategorie und woher sie kommt (für die Tagesansicht).
-- Die Zeilen 2026 (aus der Excel) bleiben unverändert - sie sind ausgezahlt.
-- Schreiben nur mit Sonderrecht "Spargel-Kategorien festlegen".
-- In der Supabase SQL-Konsole ausführen (ein einziger Block).
-- ============================================================================

do $umbau$
begin
  create table if not exists public.spargel_kategorie_tag (
    id bigint generated always as identity primary key,
    datum date not null,
    feld_id bigint references public.feld(id) on delete cascade,
    employee_id uuid references public.employees(id) on delete cascade,
    kategorie numeric(4,1) not null check (kategorie > 0),
    erstellt_von uuid default auth.uid(),
    erstellt_am timestamptz not null default now(),
    unique nulls not distinct (datum, feld_id, employee_id)
  );
  create index if not exists spargel_kategorie_tag_feld on public.spargel_kategorie_tag (feld_id, datum desc);

  -- Kategorie muss es in der Saison geben
  create or replace function public.spargel_kategorie_pruefen() returns trigger
  language plpgsql as $f$
  declare v_jahr int;
  begin
    if tg_table_name = 'spargel_kategorie_tag' then
      v_jahr := extract(year from new.datum)::int;
    else
      v_jahr := new.saison_jahr;
    end if;
    if not exists (select 1 from public.spargel_kategorie k
                   where k.saison_jahr = v_jahr and k.kategorie = new.kategorie) then
      raise exception 'Kategorie % gibt es in der Saison % nicht. Bitte zuerst unter Kategorien anlegen.',
        new.kategorie, v_jahr;
    end if;
    return new;
  end $f$;
  drop trigger if exists trg_spargel_kategorie_tag_pruefen on public.spargel_kategorie_tag;
  create trigger trg_spargel_kategorie_tag_pruefen before insert or update on public.spargel_kategorie_tag
    for each row execute function public.spargel_kategorie_pruefen();
  drop trigger if exists trg_spargel_feld_kategorie_pruefen on public.spargel_feld_kategorie;
  create trigger trg_spargel_feld_kategorie_pruefen before insert or update on public.spargel_feld_kategorie
    for each row execute function public.spargel_kategorie_pruefen();

  -- Wirksame Kategorie eines Feldes an einem Tag
  create or replace function public.spargel_kategorie_feld(p_feld bigint, p_datum date) returns numeric
  language sql stable as $f$
    select coalesce(
      (select t.kategorie from public.spargel_kategorie_tag t
        where t.employee_id is null and t.datum <= p_datum
          and extract(year from t.datum) = extract(year from p_datum)
          and (t.feld_id = p_feld or t.feld_id is null)
        -- jüngster Tag zuerst; am selben Tag geht das Feld vor "alle Felder"
        order by t.datum desc, (t.feld_id is null) limit 1),
      (select f.kategorie from public.spargel_feld_kategorie f
        where f.feld_id = p_feld and f.saison_jahr <= extract(year from p_datum)
        order by f.saison_jahr desc limit 1));
  $f$;

  create or replace function public.spargel_kategorie_person(p_employee uuid, p_feld bigint, p_datum date) returns numeric
  language sql stable as $f$
    select coalesce(
      (select t.kategorie from public.spargel_kategorie_tag t
        where t.employee_id = p_employee and t.datum = p_datum
        order by (t.feld_id = p_feld) desc nulls last limit 1),
      public.spargel_kategorie_feld(p_feld, p_datum));
  $f$;

  -- Preis festschreiben
  alter table public.spargel_tag add column if not exists preis_kg numeric(6,3);
  update public.spargel_tag t set preis_kg = k.preis_kg
  from public.spargel_kategorie k
  where t.preis_kg is null and k.saison_jahr = t.saison_jahr and k.kategorie = t.kategorie;

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
    case when gruppe is not null or bool_or(kategorie is null or preis is null or satz is null) then 0
         else greatest(sum(akkordwert) - sum(lohnanspruch), 0) end as praemie,
    case when bool_or(kategorie is null or preis is null or satz is null) then 0
         else greatest(sum(lohnanspruch) - sum(akkordwert), 0) end as fehlbetrag,
    bool_and(lohnwirksam) as lohnwirksam,
    min(quelle) as quelle
  from z
  group by datum, saison_jahr, employee_id, personal_nr, gruppe;

  -- Tagesansicht: alle Spargelfelder mit wirksamer Kategorie und Herkunft
  create or replace function public.spargel_kategorien_am(p_datum date)
  returns table (feld_id bigint, feld text, kultur text, kategorie numeric, herkunft text, herkunft_datum date)
  language sql stable as $f$
    select f.id, f.bezeichnung, f.kultur, w.kategorie,
      case when w.kategorie is null then 'keine'
           when w.t_datum is null then 'Standard des Feldes'
           when w.t_datum = p_datum and w.t_feld is not null then 'für dieses Feld festgelegt'
           when w.t_datum = p_datum then 'für alle Felder festgelegt'
           else 'übernommen' end,
      w.t_datum
    from public.feld f
    left join lateral (
      select coalesce(t.kategorie, s.kategorie) as kategorie, t.datum as t_datum, t.feld_id as t_feld
      from (select 1) x
      left join lateral (
        select tt.kategorie, tt.datum, tt.feld_id from public.spargel_kategorie_tag tt
        where tt.employee_id is null and tt.datum <= p_datum
          and extract(year from tt.datum) = extract(year from p_datum)
          and (tt.feld_id = f.id or tt.feld_id is null)
        order by tt.datum desc, (tt.feld_id is null) limit 1) t on true
      left join lateral (
        select fk.kategorie from public.spargel_feld_kategorie fk
        where fk.feld_id = f.id and fk.saison_jahr <= extract(year from p_datum)
        order by fk.saison_jahr desc limit 1) s on true
    ) w on true
    where f.aktiv and f.kultur in ('spargel', 'gruenspargel')
    order by f.bezeichnung;
  $f$;
  grant execute on function public.spargel_kategorien_am(date) to authenticated;

  alter table public.spargel_kategorie_tag enable row level security;
  revoke all on public.spargel_kategorie_tag from anon;
  grant select, insert, update, delete on public.spargel_kategorie_tag to authenticated;
  drop policy if exists spargel_kategorie_tag_lesen on public.spargel_kategorie_tag;
  create policy spargel_kategorie_tag_lesen on public.spargel_kategorie_tag for select
    using (( select public.darf_any(array['ernte.praemien:L', 'ernte.statistik:L', 'lohn.uebersicht:L']) ));
  drop policy if exists spargel_kategorie_tag_schreiben on public.spargel_kategorie_tag;
  create policy spargel_kategorie_tag_schreiben on public.spargel_kategorie_tag for all
    using (( select public.darf('sonder.spargel_kategorie:S') ))
    with check (( select public.darf('sonder.spargel_kategorie:S') ));

  drop trigger if exists trg_audit_spargel_kategorie_tag on public.spargel_kategorie_tag;
  create trigger trg_audit_spargel_kategorie_tag after insert or update or delete on public.spargel_kategorie_tag
    for each row execute function public.write_audit_log();
end
$umbau$;
