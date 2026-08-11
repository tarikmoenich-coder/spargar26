-- Migration 2026-08-11: Erdbeeren-Anbauplanung
--
-- Nutzer-Vorgabe: die gewachsene Excel "Erdbeerpflanzplanung.xlsx" (14
-- Jahresblaetter, je Jahr per Copy/Paste uebertragen) durch eine gepflegte
-- Struktur ersetzen. Neuer Menuepunkt "Anbau", nur fuer admin und
-- erntewirtschaft.
--
-- Warum die Excel unuebersichtlich wurde (aus der Datei abgelesen):
--   - Die 9 Sorten sind SPALTEN (U-AC), pro Zeile meist nur 1-2 gefuellt.
--     Jede neue Sorte = Strukturaenderung in allen 14 Blaettern; die
--     Spaltenzahl wuchs dadurch von 24 (2017) auf 47 (2025).
--   - Eine ZEILE ist mal ein ganzes Feld, mal nur ein Teilstueck davon:
--     "Bruecke" steht 3x (230/210/138 m), "Vogel" 2x, "Duenenfeld" 2x -
--     weil unterschiedlich lange Tunnel nicht abbildbar sind. 24 Planzeilen
--     fuer 19 tatsaechliche Felder.
--   - Spalte D "Tunnel" ist nur eine ANZAHL; Laenge (F) und Reihen je Block
--     (E) gelten pauschal fuer alle Tunnel der Zeile.
--   - Copy/Paste-Folgen: #REF! in Zeile 30 ("davon neue Pfl.") und 38
--     ("Folienmenge"); die Kontrollspalte AF geht wegen Kommastellen nie
--     sauber auf 0 auf (-0,36 / 31,84 / -145,6 ...).
--
-- Neue Struktur - Feld > Anbau-Jahrgang > Tunnel > Bepflanzung. Damit sind
-- Sorten Zeilen statt Spalten, ein Feld bleibt ein Feld, und jeder Tunnel
-- hat seine eigene Laenge/Reihenzahl. Pflanzenzahlen werden gerechnet
-- (Laenge x Reihen x Pflanzen-pro-lfm, in der Excel Spalte I mit 4,37 im
-- Feld bzw. 8 im Glashaus) statt getippt.
--
-- Das Praemiensystem bleibt UNBERUEHRT (Nutzer-Vorgabe): erdbeeren_rohdaten
-- und die Norm-/Bonus-Saetze haengen weiterhin nur an erdbeeren_parzellen,
-- die Praemien-Erfassung zeigt unveraendert die Feldauswahl.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

-- 1) Schlanke updated_at-Trigger-Funktion (die bestehende Variante pflegt
-- zusaetzlich eine version-Spalte, die es hier bewusst nicht gibt).
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2) Tabellen
create table erdbeeren_anbau (
  id bigint generated always as identity primary key,
  parzelle_id bigint not null references erdbeeren_parzellen (id) on delete restrict,
  saison_jahr int not null,
  -- Erwartungswerte für die Planung (Nutzer-Auswahl "Erwartung").
  erntefenster_von date,
  erntefenster_bis date,
  ertrag_erwartet_steigen numeric(10, 2),
  rodung_geplant date,
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (parzelle_id, saison_jahr)
);

create index idx_erdbeeren_anbau_saison on erdbeeren_anbau (saison_jahr);

create table erdbeeren_tunnel (
  id bigint generated always as identity primary key,
  anbau_id bigint not null references erdbeeren_anbau (id) on delete cascade,
  -- Freier Text statt Zahl: die Nummerierung vor Ort ist nicht zwingend
  -- lückenlos ("T1", "12a", ...).
  nummer text not null,
  laenge_m numeric(7, 2),
  reihen_anzahl int,
  -- Pflanzen je laufendem Meter - in der Excel Spalte I, dort je Zeile
  -- gepflegt (4,37 im Feld, 8 im Glashaus). Daraus rechnet sich die
  -- Pflanzenzahl: Länge x Reihen x Pflanzen/lfm.
  pflanzen_pro_lfm numeric(6, 2),
  -- Rollennummer der Folie (Cotura). Vorerst nur dokumentierend, das
  -- eigene Folien-Register kommt später.
  cotura_nr text,
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (anbau_id, nummer)
);

create index idx_erdbeeren_tunnel_anbau on erdbeeren_tunnel (anbau_id);

-- Bepflanzung eines Tunnels. Mehrere Zeilen je Tunnel möglich - in einem
-- Tunnel können zwei verschiedene Sorten sitzen (Nutzer-Hinweis). Genau
-- das ist in der Excel nur über eine zusätzliche FELD-Zeile abbildbar.
create table erdbeeren_bepflanzung (
  id bigint generated always as identity primary key,
  tunnel_id bigint not null references erdbeeren_tunnel (id) on delete cascade,
  sorte text not null,
  -- Wie viele der Tunnelreihen diese Sorte belegt. Leer = alle Reihen des
  -- Tunnels (der häufige Fall mit nur einer Sorte).
  reihen_anzahl int,
  pflanzdatum date,
  -- 1 = Neupflanzung, 2/3 = zweites/drittes Standjahr (starker
  -- Ertragseinfluss, deshalb eigenes Feld statt aus dem Pflanzjahr
  -- abgeleitet - Warteboden/Verlängerung passt sonst nicht).
  standjahr int,
  pflanztyp text check (
    pflanztyp is null or pflanztyp in (
      'frigo', 'gruenpflanze', 'topfgruen', 'warteboden', 'sonstiges'
    )
  ),
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create index idx_erdbeeren_bepflanzung_tunnel on erdbeeren_bepflanzung (tunnel_id);

-- Bestellplanung je Saison und Sorte (Nutzer-Vorgabe: "gleich mit").
-- Ersetzt die Handarbeit in den Excel-Zeilen 29-36 (Gesamt / bestellt /
-- selbst / Differenzbedarf / Reserve 15 % / Gesamt inkl. Reserve). Der
-- BEDARF wird nicht hier gespeichert, sondern live aus den Bepflanzungen
-- gerechnet (siehe View erdbeeren_bestellung_uebersicht) - nur die
-- Bestell-/Eigenmengen und der Reserve-Satz sind Eingaben.
create table erdbeeren_bestellung (
  id bigint generated always as identity primary key,
  saison_jahr int not null,
  sorte text not null,
  bestellt_anzahl int,
  -- Eigene Vermehrung/Restbestand, wird vom Bedarf abgezogen.
  eigene_anzahl int,
  reserve_prozent numeric(5, 2) not null default 15,
  lieferant text,
  notiz text,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (saison_jahr, sorte)
);

-- ---------------------------------------------------------------------------
-- Auswertende Sichten für die Anbauplanung
-- ---------------------------------------------------------------------------

-- Je Bepflanzung: laufende Meter und Pflanzenzahl, gerechnet statt getippt.
-- Ersetzt die Excel-Spalten I/J/K/AD/AE und die Kontrollspalte AF (die dort
-- wegen der Kommastellen nie sauber auf 0 aufgeht).
create or replace view erdbeeren_bepflanzung_berechnet as
select
  b.id,
  b.tunnel_id,
  t.anbau_id,
  a.parzelle_id,
  a.saison_jahr,
  p.name as parzelle_name,
  t.nummer as tunnel_nummer,
  t.laenge_m,
  t.cotura_nr,
  b.sorte,
  b.pflanzdatum,
  b.standjahr,
  b.pflanztyp,
  -- Leer gelassene Reihenzahl = alle Reihen des Tunnels.
  coalesce(b.reihen_anzahl, t.reihen_anzahl) as reihen_anzahl,
  (coalesce(t.laenge_m, 0) * coalesce(b.reihen_anzahl, t.reihen_anzahl, 0))
    as laufende_meter,
  round(
    coalesce(t.laenge_m, 0)
    * coalesce(b.reihen_anzahl, t.reihen_anzahl, 0)
    * coalesce(t.pflanzen_pro_lfm, 0)
  )::int as anzahl_pflanzen
from erdbeeren_bepflanzung b
join erdbeeren_tunnel t on t.id = b.tunnel_id
join erdbeeren_anbau a on a.id = t.anbau_id
join erdbeeren_parzellen p on p.id = a.parzelle_id;

grant select on erdbeeren_bepflanzung_berechnet to authenticated;

-- Bestellübersicht je Saison und Sorte: Bedarf aus der Planung, dagegen die
-- eingetragenen Bestell-/Eigenmengen. Vollständiger Ersatz für die
-- Excel-Zeilen 29-36.
create or replace view erdbeeren_bestellung_uebersicht as
select
  coalesce(bed.saison_jahr, best.saison_jahr) as saison_jahr,
  coalesce(bed.sorte, best.sorte) as sorte,
  coalesce(bed.bedarf_pflanzen, 0) as bedarf_pflanzen,
  coalesce(best.reserve_prozent, 15) as reserve_prozent,
  round(
    coalesce(bed.bedarf_pflanzen, 0)
    * (1 + coalesce(best.reserve_prozent, 15) / 100.0)
  )::int as bedarf_mit_reserve,
  best.bestellt_anzahl,
  best.eigene_anzahl,
  best.lieferant,
  -- Positiv = es fehlt noch, negativ = zu viel bestellt.
  (
    round(
      coalesce(bed.bedarf_pflanzen, 0)
      * (1 + coalesce(best.reserve_prozent, 15) / 100.0)
    )::int
    - coalesce(best.bestellt_anzahl, 0)
    - coalesce(best.eigene_anzahl, 0)
  ) as differenz
from (
  select saison_jahr, sorte, sum(anzahl_pflanzen)::int as bedarf_pflanzen
  from erdbeeren_bepflanzung_berechnet
  group by saison_jahr, sorte
) bed
full outer join erdbeeren_bestellung best
  on best.saison_jahr = bed.saison_jahr and best.sorte = bed.sorte;

grant select on erdbeeren_bestellung_uebersicht to authenticated;

-- Kennzahlen je Feld und Saison - die Zusammenfassung, die in der Excel
-- über verstreute Summenspalten (K/N/O/P-R/AD/AE) lief.
create or replace view erdbeeren_anbau_uebersicht as
select
  a.id as anbau_id,
  a.parzelle_id,
  p.name as parzelle_name,
  p.groesse_ha,
  a.saison_jahr,
  a.erntefenster_von,
  a.erntefenster_bis,
  a.ertrag_erwartet_steigen,
  a.rodung_geplant,
  a.notiz,
  count(distinct t.id)::int as anzahl_tunnel,
  coalesce(sum(bb.laufende_meter), 0) as laufende_meter,
  coalesce(sum(bb.anzahl_pflanzen), 0)::int as anzahl_pflanzen,
  -- Sorten dieses Feldes als lesbare Aufzählung (statt neun Spalten).
  (
    select string_agg(distinct b2.sorte, ', ' order by b2.sorte)
    from erdbeeren_bepflanzung b2
    join erdbeeren_tunnel t2 on t2.id = b2.tunnel_id
    where t2.anbau_id = a.id
  ) as sorten
from erdbeeren_anbau a
join erdbeeren_parzellen p on p.id = a.parzelle_id
left join erdbeeren_tunnel t on t.anbau_id = a.id
left join erdbeeren_bepflanzung_berechnet bb on bb.tunnel_id = t.id
group by
  a.id, a.parzelle_id, p.name, p.groesse_ha, a.saison_jahr,
  a.erntefenster_von, a.erntefenster_bis, a.ertrag_erwartet_steigen,
  a.rodung_geplant, a.notiz;

grant select on erdbeeren_anbau_uebersicht to authenticated;

-- Legt für ein Feld auf einen Schlag mehrere gleichartige Tunnel an
-- (Nutzer-Wunsch "Sammelanlage je Feld") - bei 182 Tunneln wäre einzeln
-- anlegen sonst nicht praktikabel. Vorhandene Nummern werden übersprungen,
-- die Funktion lässt sich also gefahrlos erneut aufrufen.
create or replace function erdbeeren_tunnel_sammelanlage(
  p_anbau_id bigint,
  p_von int,
  p_bis int,
  p_laenge_m numeric,
  p_reihen_anzahl int,
  p_pflanzen_pro_lfm numeric
)
returns int language plpgsql security invoker as $$
declare
  i int;
  angelegt int := 0;
begin
  for i in p_von..p_bis loop
    insert into erdbeeren_tunnel (
      anbau_id, nummer, laenge_m, reihen_anzahl, pflanzen_pro_lfm
    )
    values (
      p_anbau_id, i::text, p_laenge_m, p_reihen_anzahl, p_pflanzen_pro_lfm
    )
    on conflict (anbau_id, nummer) do nothing;
    if found then angelegt := angelegt + 1; end if;
  end loop;
  return angelegt;
end;
$$;

grant execute on function erdbeeren_tunnel_sammelanlage(bigint, int, int, numeric, int, numeric) to authenticated;

-- Übernimmt einen kompletten Jahrgang eines Feldes ins Zieljahr (Felder,
-- Tunnel mit Maßen, Bepflanzung ohne Pflanzdatum) - ersetzt das Copy/Paste
-- zwischen den Excel-Blättern, aber ohne die dort entstandenen #REF!-
-- Bezüge. Vorhandene Jahrgänge werden NICHT überschrieben.
create or replace function erdbeeren_anbau_vorjahr_uebernehmen(
  p_saison_jahr int,
  p_quelle_jahr int
)
returns int language plpgsql security invoker as $$
declare
  v_alt record;
  v_neu_anbau_id bigint;
  v_alt_tunnel record;
  v_neu_tunnel_id bigint;
  uebernommen int := 0;
begin
  for v_alt in
    select * from erdbeeren_anbau where saison_jahr = p_quelle_jahr
  loop
    -- Feld schon fürs Zieljahr geplant? Dann unangetastet lassen.
    if exists (
      select 1 from erdbeeren_anbau
      where parzelle_id = v_alt.parzelle_id and saison_jahr = p_saison_jahr
    ) then
      continue;
    end if;

    insert into erdbeeren_anbau (parzelle_id, saison_jahr, notiz)
    values (v_alt.parzelle_id, p_saison_jahr, v_alt.notiz)
    returning id into v_neu_anbau_id;

    for v_alt_tunnel in
      select * from erdbeeren_tunnel where anbau_id = v_alt.id
    loop
      insert into erdbeeren_tunnel (
        anbau_id, nummer, laenge_m, reihen_anzahl, pflanzen_pro_lfm,
        cotura_nr, notiz
      )
      values (
        v_neu_anbau_id, v_alt_tunnel.nummer, v_alt_tunnel.laenge_m,
        v_alt_tunnel.reihen_anzahl, v_alt_tunnel.pflanzen_pro_lfm,
        v_alt_tunnel.cotura_nr, v_alt_tunnel.notiz
      )
      returning id into v_neu_tunnel_id;

      -- Bepflanzung mitnehmen, aber OHNE Pflanzdatum und mit erhöhtem
      -- Standjahr: die Fläche steht ein Jahr länger, neu gepflanzt wird
      -- erst durch eine bewusste Eingabe.
      insert into erdbeeren_bepflanzung (
        tunnel_id, sorte, reihen_anzahl, standjahr, pflanztyp
      )
      select
        v_neu_tunnel_id, b.sorte, b.reihen_anzahl,
        case when b.standjahr is not null then b.standjahr + 1 end,
        b.pflanztyp
      from erdbeeren_bepflanzung b
      where b.tunnel_id = v_alt_tunnel.id;
    end loop;

    uebernommen := uebernommen + 1;
  end loop;
  return uebernommen;
end;
$$;

grant execute on function erdbeeren_anbau_vorjahr_uebernehmen(int, int) to authenticated;

-- 3) Trigger
create trigger trg_erdbeeren_anbau_updated_at before update on erdbeeren_anbau
  for each row execute function set_updated_at();
create trigger trg_erdbeeren_tunnel_updated_at before update on erdbeeren_tunnel
  for each row execute function set_updated_at();
create trigger trg_erdbeeren_bepflanzung_updated_at before update on erdbeeren_bepflanzung
  for each row execute function set_updated_at();
create trigger trg_erdbeeren_bestellung_updated_at before update on erdbeeren_bestellung
  for each row execute function set_updated_at();

-- 4) Row Level Security: lesen alle Angemeldeten, pflegen admin und
-- erntewirtschaft (die den Anbau planen).
alter table erdbeeren_anbau enable row level security;
alter table erdbeeren_tunnel enable row level security;
alter table erdbeeren_bepflanzung enable row level security;
alter table erdbeeren_bestellung enable row level security;

create policy "erdbeeren_anbau_select" on erdbeeren_anbau for select
  using (auth.uid() is not null);
create policy "erdbeeren_anbau_write" on erdbeeren_anbau for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));
create policy "erdbeeren_tunnel_select" on erdbeeren_tunnel for select
  using (auth.uid() is not null);
create policy "erdbeeren_tunnel_write" on erdbeeren_tunnel for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));
create policy "erdbeeren_bepflanzung_select" on erdbeeren_bepflanzung for select
  using (auth.uid() is not null);
create policy "erdbeeren_bepflanzung_write" on erdbeeren_bepflanzung for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));
create policy "erdbeeren_bestellung_select" on erdbeeren_bestellung for select
  using (auth.uid() is not null);
create policy "erdbeeren_bestellung_write" on erdbeeren_bestellung for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));
