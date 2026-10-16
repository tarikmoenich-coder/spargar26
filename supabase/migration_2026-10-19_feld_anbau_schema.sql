-- ============================================================================
-- Migration 2026-10-19: Generisches Feld/Anbau-Schema - löst die
-- Erdbeeren-spezifische Kette (erdbeeren_parzellen/_anbau/_tunnel/
-- _bepflanzung) ab.
--
-- Hintergrund: Fürs Spargelspinnen-Projekt muss erfasst werden, auf welchem
-- Feld eine Erntemaschine steht (docs/erntewirtschaft-plan.md, Teil E/G -
-- "ernte_feld" dort war als eigene Tabelle skizziert, wird hier durch dieses
-- generische "feld" ERSETZT, keine zweite Tabelle). Gleichzeitig soll
-- Spargel-Prämie (aktuell nur ein manueller Saisonbetrag,
-- app/praemien/spargel) später denselben Feldbezug nutzen können. Keine
-- Produktivdaten in den alten Erdbeeren-Tabellen vorhanden -> sauberer
-- Neubau statt Datenmigration.
--
-- "feld" + "feld_anbau" + "feld_anbau_abschnitt" sind kulturübergreifend
-- (Erdbeeren/Spargel/Grünspargel/Sonstiges). Die Prämien-/Rohdaten-Kette
-- (erdbeeren_parzellen_saetze/erdbeeren_rohdaten) bleibt bewusst
-- Erdbeeren-spezifisch (Spargel bekommt später ein eigenes,
-- waagenbasiertes Modell) - nur ihre Fremdschlüssel-Spalte wird von
-- parzelle_id auf feld_id umgehängt.
--
-- Korrektur gegenüber dem ersten Anlauf dieser Migration (Fehler beim
-- Einspielen): erdbeeren_praemie_tag/_statistik_tag/_gruppenkosten_tag
-- werden NICHT gedroppt - season_summary (Lohnabrechnung) UND die Funktion
-- auszahlungsbeleg_zeile_delta_anwenden(...) hängen an erdbeeren_praemie_tag
-- ("cannot drop view ... because other objects depend on it"). Da sich die
-- Ausgabespalten nicht ändern, werden sie per CREATE OR REPLACE VIEW
-- umgeschrieben (erdbeeren_praemie_tag) bzw. gar nicht angefasst
-- (erdbeeren_statistik_tag/erdbeeren_gruppenkosten_tag referenzieren
-- ohnehin nur erdbeeren_praemie_tag, nie erdbeeren_parzellen direkt - ihre
-- Bodies brauchen keine Änderung). Gleiches Muster wie bereits in
-- migration_2026-10-10_erdbeeren_praemie_storno.sql verwendet.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). PostGIS muss im
-- Supabase-Dashboard aktiv sein (Database -> Extensions), bevor diese
-- Migration läuft.
-- ============================================================================

create extension if not exists postgis;

-- ----------------------------------------------------------------------
-- 1) Views droppen, die erdbeeren_anbau/_tunnel/_bepflanzung referenzieren
--    (Kind zu Eltern, sonst scheitert DROP TABLE wegen Abhängigkeiten).
--    Nichts anderes hängt an diesen dreien (geprüft) - sie werden unten
--    durch neu benannte Views ersetzt, nicht per CREATE OR REPLACE
--    umgeschrieben.
-- ----------------------------------------------------------------------
drop view if exists erdbeeren_bestellung_uebersicht;
drop view if exists erdbeeren_anbau_uebersicht;
drop view if exists erdbeeren_bepflanzung_berechnet;

-- ----------------------------------------------------------------------
-- 2) Alte RPCs droppen.
-- ----------------------------------------------------------------------
drop function if exists erdbeeren_tunnel_sammelanlage(bigint, int, int, numeric, int, numeric);
drop function if exists erdbeeren_tunnel_reihenfolge_setzen(bigint[]);
drop function if exists erdbeeren_anbau_vorjahr_uebernehmen(int, int);

-- ----------------------------------------------------------------------
-- 3) Alte Anbau-Planungstabellen droppen (Kind zu Eltern).
-- ----------------------------------------------------------------------
drop table if exists erdbeeren_bepflanzung;
drop table if exists erdbeeren_tunnel;
drop table if exists erdbeeren_anbau;

-- ----------------------------------------------------------------------
-- 4) erdbeeren_parzellen_saetze/erdbeeren_rohdaten bleiben als Tabellen
--    bestehen (Prämienlogik bleibt Erdbeeren-spezifisch) - nur die Spalte
--    umbenennen, die FKs werden unten (Schritt 6) umgehängt.
-- ----------------------------------------------------------------------
alter table erdbeeren_parzellen_saetze rename column parzelle_id to feld_id;
alter table erdbeeren_rohdaten rename column parzelle_id to feld_id;

-- ----------------------------------------------------------------------
-- 5) Neue, kulturübergreifende Tabellen.
-- ----------------------------------------------------------------------
create table feld (
  id bigint generated always as identity primary key,
  bezeichnung text not null unique,
  -- nullable: frisch aus Pachtwesen2026 importierte Felder kennen ihre
  -- Kultur noch nicht, die wird erst in spargar26 zugeordnet.
  kultur text check (kultur in ('erdbeeren', 'spargel', 'gruenspargel', 'sonstiges')),
  -- Brutto-Flächengeometrie (reale Grenze) - Netto-Hektarfläche wird separat
  -- aus feld_anbau_abschnitt berechnet (Reihen x Länge x Abstand), siehe
  -- feld_anbau_abschnitt_berechnet unten.
  geometrie geometry(Polygon, 4326),
  aktiv boolean not null default true,
  -- Cross-Projekt-Bezug zu Pachtwesen2026 (anderes Supabase-Projekt, kein
  -- FK möglich) - beide nullable, weil frei gezeichnete Felder ohne
  -- Pachtwesen-Bezug ausdrücklich erlaubt sind.
  pachtwesen_schlag_id uuid,
  pachtwesen_geometrie_hash text,
  -- Review-Mechanik für einen erneuten Import, wenn sich der Schlag in
  -- Pachtwesen2026 geändert hat, OHNE eine bereits verfeinerte Geometrie
  -- hier stillschweigend zu überschreiben (Nutzer-Vorgabe).
  pachtwesen_geometrie_hash_neu text,
  pachtwesen_geometrie_geojson_neu text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);
create index idx_feld_geometrie on feld using gist (geometrie);
create index idx_feld_pachtwesen_schlag on feld (pachtwesen_schlag_id);
create index idx_feld_kultur on feld (kultur);
create trigger trg_feld_updated_at before update on feld
  for each row execute function set_updated_at();

create table feld_anbau (
  id bigint generated always as identity primary key,
  feld_id bigint not null references feld (id) on delete restrict,
  saison_jahr int not null,
  erntefenster_von date,
  erntefenster_bis date,
  ertrag_erwartet numeric(10, 2),
  ertrag_einheit text default 'steigen',
  rodung_geplant date,
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (feld_id, saison_jahr)
);
create index idx_feld_anbau_saison on feld_anbau (saison_jahr);
create trigger trg_feld_anbau_updated_at before update on feld_anbau
  for each row execute function set_updated_at();

-- Kollabiert erdbeeren_tunnel + erdbeeren_bepflanzung zu EINER Ebene: eine
-- Zeile = eine benannte, physisch zusammenhängende Pflanzreihe + ihre Sorte.
-- Spargel bekommt i.d.R. genau eine Zeile je Anbau-Jahrgang; Erdbeeren eine
-- Zeile je Tunnel (zwei Zeilen mit gleicher bezeichnung bei geteilter Sorte
-- im selben Tunnel - bewusster, dokumentierter Kompromiss statt einer
-- dritten Tabelle, siehe erntewirtschaft-plan/Praxis).
create table feld_anbau_abschnitt (
  id bigint generated always as identity primary key,
  feld_anbau_id bigint not null references feld_anbau (id) on delete cascade,
  bezeichnung text not null,            -- Freitext, nicht lückenlos nummeriert
  reihen_anzahl int,
  reihenlaenge_m numeric(7, 2),
  reihenabstand_m numeric(5, 2),        -- treibt die Netto-Hektarfläche
  pflanzen_pro_lfm numeric(6, 2),
  sorte text,
  pflanzdatum date,
  standjahr int,
  pflanztyp text check (pflanztyp is null or pflanztyp in
    ('frigo', 'gruenpflanze', 'topfgruen', 'warteboden', 'sonstiges')),
  cotura_nr text,
  position int,
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);
create index idx_feld_anbau_abschnitt_anbau on feld_anbau_abschnitt (feld_anbau_id);
create trigger trg_feld_anbau_abschnitt_updated_at before update on feld_anbau_abschnitt
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------
-- 6) erdbeeren_praemie_tag JETZT auf "feld" umstellen (CREATE OR REPLACE,
--    kein DROP) - muss passieren, BEVOR erdbeeren_parzellen unten
--    gedroppt wird, sonst hängt die alte Fassung dieser View noch daran
--    und blockiert den Drop. Ausgabespalten bleiben exakt gleich
--    (parzelle_id/parzelle_name), damit erdbeeren_statistik_tag,
--    erdbeeren_gruppenkosten_tag, season_summary, app/suche, app/dashboard
--    unverändert weiterlaufen - ihre Bodies werden deshalb gar nicht
--    angefasst.
-- ----------------------------------------------------------------------
create or replace view erdbeeren_praemie_tag as
select
  r.id,
  r.employee_id,
  r.feld_id as parzelle_id,
  f.bezeichnung as parzelle_name,
  r.datum,
  r.steigen,
  r.stunden,
  r.sut,
  s.norm_steigen_pro_stunde,
  s.bonus_pro_steige,
  case
    when r.praemie_storniert then 0::numeric
    else greatest(
      (r.steigen - r.stunden * coalesce(s.norm_steigen_pro_stunde, 0))
        * coalesce(s.bonus_pro_steige, 0),
      0
    )
  end as praemie,
  r.praemie_storniert,
  r.storno_grund,
  r.storno_am
from erdbeeren_rohdaten r
join feld f on f.id = r.feld_id
left join lateral (
  select z.norm_steigen_pro_stunde, z.bonus_pro_steige
  from erdbeeren_parzellen_saetze z
  where z.feld_id = r.feld_id
    and z.gueltig_ab <= r.datum
  order by z.gueltig_ab desc
  limit 1
) s on true;
alter view erdbeeren_praemie_tag set (security_invoker = true);
grant select on erdbeeren_praemie_tag to authenticated;

-- ----------------------------------------------------------------------
-- 7) Alte FKs auf erdbeeren_parzellen droppen, neue auf feld anlegen, dann
--    erdbeeren_parzellen droppen (jetzt sicher - erdbeeren_praemie_tag
--    zeigt seit Schritt 6 schon auf "feld", nichts referenziert
--    erdbeeren_parzellen mehr).
-- ----------------------------------------------------------------------
alter table erdbeeren_parzellen_saetze
  drop constraint erdbeeren_parzellen_saetze_parzelle_id_fkey,
  add constraint erdbeeren_parzellen_saetze_feld_id_fkey
    foreign key (feld_id) references feld (id) on delete restrict;
alter table erdbeeren_rohdaten
  drop constraint erdbeeren_rohdaten_parzelle_id_fkey,
  add constraint erdbeeren_rohdaten_feld_id_fkey
    foreign key (feld_id) references feld (id) on delete restrict;

drop table if exists erdbeeren_parzellen;

-- ----------------------------------------------------------------------
-- 8) Neue berechnete Views (ersetzen erdbeeren_bepflanzung_berechnet /
--    erdbeeren_anbau_uebersicht), erdbeeren_bestellung_uebersicht neu auf
--    die neue Quelle zeigen lassen - MIT Kultur-Filter, sonst verfälschen
--    künftige Spargel-Pflanzungen die Erdbeeren-Bestellmengen.
-- ----------------------------------------------------------------------
create or replace view feld_anbau_abschnitt_berechnet as
select
  ab.id,
  ab.feld_anbau_id,
  fa.feld_id,
  f.bezeichnung as feld_bezeichnung,
  f.kultur,
  fa.saison_jahr,
  ab.bezeichnung,
  ab.reihenlaenge_m,
  ab.reihenabstand_m,
  ab.cotura_nr,
  ab.sorte,
  ab.pflanzdatum,
  ab.standjahr,
  ab.pflanztyp,
  ab.reihen_anzahl,
  (coalesce(ab.reihenlaenge_m, 0) * coalesce(ab.reihen_anzahl, 0)) as laufende_meter,
  round(
    coalesce(ab.reihenlaenge_m, 0) * coalesce(ab.reihen_anzahl, 0) * coalesce(ab.pflanzen_pro_lfm, 0)
  )::int as anzahl_pflanzen,
  -- Netto-Fläche: bewusst NICHT aus feld.geometrie (das ist die Brutto-
  -- Fläche) - rechnet aus Reihen-Anzahl x -länge x -abstand.
  (coalesce(ab.reihenlaenge_m, 0) * coalesce(ab.reihen_anzahl, 0) * coalesce(ab.reihenabstand_m, 0))
    as netto_flaeche_m2,
  round(
    (coalesce(ab.reihenlaenge_m, 0) * coalesce(ab.reihen_anzahl, 0) * coalesce(ab.reihenabstand_m, 0)) / 10000.0,
    4
  ) as netto_ha
from feld_anbau_abschnitt ab
join feld_anbau fa on fa.id = ab.feld_anbau_id
join feld f on f.id = fa.feld_id;
alter view feld_anbau_abschnitt_berechnet set (security_invoker = true);
grant select on feld_anbau_abschnitt_berechnet to authenticated;

create or replace view feld_anbau_uebersicht as
select
  fa.id as anbau_id,
  fa.feld_id,
  f.bezeichnung as feld_bezeichnung,
  f.kultur,
  fa.saison_jahr,
  fa.erntefenster_von,
  fa.erntefenster_bis,
  fa.ertrag_erwartet,
  fa.ertrag_einheit,
  fa.rodung_geplant,
  fa.notiz,
  count(ab.id)::int as anzahl_abschnitte,
  coalesce(sum(bb.laufende_meter), 0) as laufende_meter,
  coalesce(sum(bb.anzahl_pflanzen), 0)::int as anzahl_pflanzen,
  coalesce(sum(bb.netto_ha), 0) as netto_ha,
  (
    select string_agg(distinct ab2.sorte, ', ' order by ab2.sorte)
    from feld_anbau_abschnitt ab2
    where ab2.feld_anbau_id = fa.id and ab2.sorte is not null
  ) as sorten
from feld_anbau fa
join feld f on f.id = fa.feld_id
left join feld_anbau_abschnitt ab on ab.feld_anbau_id = fa.id
left join feld_anbau_abschnitt_berechnet bb on bb.id = ab.id
group by fa.id, f.bezeichnung, f.kultur, fa.feld_id, fa.saison_jahr,
  fa.erntefenster_von, fa.erntefenster_bis, fa.ertrag_erwartet,
  fa.ertrag_einheit, fa.rodung_geplant, fa.notiz;
alter view feld_anbau_uebersicht set (security_invoker = true);
grant select on feld_anbau_uebersicht to authenticated;

create or replace view erdbeeren_bestellung_uebersicht as
select
  coalesce(bed.saison_jahr, best.saison_jahr) as saison_jahr,
  coalesce(bed.sorte, best.sorte) as sorte,
  coalesce(bed.bedarf_pflanzen, 0) as bedarf_pflanzen,
  coalesce(best.reserve_prozent, 15) as reserve_prozent,
  round(coalesce(bed.bedarf_pflanzen, 0) * (1 + coalesce(best.reserve_prozent, 15) / 100.0))::int
    as bedarf_mit_reserve,
  best.bestellt_anzahl, best.eigene_anzahl, best.lieferant,
  (
    round(coalesce(bed.bedarf_pflanzen, 0) * (1 + coalesce(best.reserve_prozent, 15) / 100.0))::int
    - coalesce(best.bestellt_anzahl, 0) - coalesce(best.eigene_anzahl, 0)
  ) as differenz
from (
  select bb.saison_jahr, bb.sorte, sum(bb.anzahl_pflanzen)::int as bedarf_pflanzen
  from feld_anbau_abschnitt_berechnet bb
  where bb.kultur = 'erdbeeren'
  group by bb.saison_jahr, bb.sorte
) bed
full outer join erdbeeren_bestellung best
  on best.saison_jahr = bed.saison_jahr and best.sorte = bed.sorte;
alter view erdbeeren_bestellung_uebersicht set (security_invoker = true);
grant select on erdbeeren_bestellung_uebersicht to authenticated;

-- ----------------------------------------------------------------------
-- 9) Neue RPCs (crop-agnostisch - funktioniert identisch für Erdbeerens
--    Jahreswechsel wie für Spargels "8 Jahre unverändert übernehmen").
-- ----------------------------------------------------------------------
create or replace function feld_anbau_abschnitt_sammelanlage(
  p_feld_anbau_id bigint,
  p_von int,
  p_bis int,
  p_reihenlaenge_m numeric,
  p_reihen_anzahl int,
  p_pflanzen_pro_lfm numeric,
  p_reihenabstand_m numeric default null
) returns int language plpgsql security invoker as $$
declare
  i int;
  angelegt int := 0;
  naechste_position int;
begin
  select coalesce(max(position), 0) into naechste_position
  from feld_anbau_abschnitt where feld_anbau_id = p_feld_anbau_id;

  for i in p_von..p_bis loop
    if not exists (
      select 1 from feld_anbau_abschnitt
      where feld_anbau_id = p_feld_anbau_id and bezeichnung = i::text
    ) then
      naechste_position := naechste_position + 1;
      insert into feld_anbau_abschnitt (
        feld_anbau_id, bezeichnung, reihenlaenge_m, reihen_anzahl,
        pflanzen_pro_lfm, reihenabstand_m, position
      ) values (
        p_feld_anbau_id, i::text, p_reihenlaenge_m, p_reihen_anzahl,
        p_pflanzen_pro_lfm, p_reihenabstand_m, naechste_position
      );
      angelegt := angelegt + 1;
    end if;
  end loop;
  return angelegt;
end;
$$;
grant execute on function feld_anbau_abschnitt_sammelanlage(bigint, int, int, numeric, int, numeric, numeric) to authenticated;

create or replace function feld_anbau_abschnitt_reihenfolge_setzen(p_ids bigint[])
returns void language sql security invoker as $$
  update feld_anbau_abschnitt t
  set position = pos.idx
  from unnest(p_ids) with ordinality as pos(id, idx)
  where t.id = pos.id;
$$;
grant execute on function feld_anbau_abschnitt_reihenfolge_setzen(bigint[]) to authenticated;

create or replace function feld_anbau_vorjahr_uebernehmen(
  p_saison_jahr int,
  p_quelle_jahr int
) returns int language plpgsql security invoker as $$
declare
  v_alt record;
  v_neu_anbau_id bigint;
  v_alt_ab record;
  uebernommen int := 0;
begin
  for v_alt in
    select * from feld_anbau where saison_jahr = p_quelle_jahr
  loop
    if exists (
      select 1 from feld_anbau
      where feld_id = v_alt.feld_id and saison_jahr = p_saison_jahr
    ) then
      continue;
    end if;

    insert into feld_anbau (feld_id, saison_jahr, notiz)
    values (v_alt.feld_id, p_saison_jahr, v_alt.notiz)
    returning id into v_neu_anbau_id;

    for v_alt_ab in
      select * from feld_anbau_abschnitt where feld_anbau_id = v_alt.id
    loop
      insert into feld_anbau_abschnitt (
        feld_anbau_id, bezeichnung, reihenlaenge_m, reihen_anzahl,
        reihenabstand_m, pflanzen_pro_lfm, sorte, standjahr, pflanztyp,
        cotura_nr, notiz, position
      ) values (
        v_neu_anbau_id, v_alt_ab.bezeichnung, v_alt_ab.reihenlaenge_m,
        v_alt_ab.reihen_anzahl, v_alt_ab.reihenabstand_m,
        v_alt_ab.pflanzen_pro_lfm, v_alt_ab.sorte,
        case when v_alt_ab.standjahr is not null then v_alt_ab.standjahr + 1 end,
        v_alt_ab.pflanztyp, v_alt_ab.cotura_nr, v_alt_ab.notiz, v_alt_ab.position
      );
      -- pflanzdatum bewusst nicht übernommen, wie beim Vorgänger.
    end loop;

    uebernommen := uebernommen + 1;
  end loop;
  return uebernommen;
end;
$$;
grant execute on function feld_anbau_vorjahr_uebernehmen(int, int) to authenticated;

-- Setzt die Geometrie eines Feldes aus GeoJSON - PostgREST kann PostGIS-
-- Geometrie nicht direkt aus einem JS-Insert annehmen (gleiches Muster wie
-- Pachtwesen2026s Teilflächen-RPCs).
create or replace function feld_geometrie_setzen(p_feld_id bigint, p_geojson text)
returns void language sql security invoker as $$
  update feld
  set geometrie = ST_SetSRID(ST_GeomFromGeoJSON(p_geojson), 4326)
  where id = p_feld_id;
$$;
grant execute on function feld_geometrie_setzen(bigint, text) to authenticated;

-- ----------------------------------------------------------------------
-- 10) RLS. Breiter als die alte Erdbeeren-Regel: "feld" wird jetzt auch
--     vom Erntewirtschaft-Modul gebraucht (docs/erntewirtschaft-plan.md
--     sah für "ernte_feld" admin/hr-Schreibrecht + erntewirtschaft/
--     zeiterfassung für laufende Korrekturen vor).
-- ----------------------------------------------------------------------
alter table feld enable row level security;
alter table feld_anbau enable row level security;
alter table feld_anbau_abschnitt enable row level security;

create policy "feld_select" on feld for select using (auth.uid() is not null);
create policy "feld_write" on feld for all
  using (current_role_name() in ('admin', 'hr', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'hr', 'erntewirtschaft'));

create policy "feld_anbau_select" on feld_anbau for select using (auth.uid() is not null);
create policy "feld_anbau_write" on feld_anbau for all
  using (current_role_name() in ('admin', 'hr', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'hr', 'erntewirtschaft'));

create policy "feld_anbau_abschnitt_select" on feld_anbau_abschnitt for select using (auth.uid() is not null);
create policy "feld_anbau_abschnitt_write" on feld_anbau_abschnitt for all
  using (current_role_name() in ('admin', 'hr', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'hr', 'erntewirtschaft'));
