-- ============================================================================
-- Migration 2026-11-24j: Stufe 3b - Lohnkasse je Firma.
--
-- Nutzer-Vorgabe 2026-11-24 (docs/zwei-personalstaemme-plan.md):
--   * Mömmel: Lohnkasse MLK (Lohnvorgänge) + allgemeines Kassenbuch MÖ.
--   * ML (Mönich Landwirtschaft) und MD (Mönich Direkt) werden ebenfalls
--     Lohnkassen.
--   * Nummernkreise je Kasse getrennt mit eigenem Präfix: MLK unverändert,
--     ML/MD mit "ML-" / "MD-" vor der bisherigen Nummer.
--
--  1. kassenbuch.belegnummer_praefix; ML und MD werden typ 'lohnkasse'.
--  2. Einzahlungen, Vorschüsse, Auszahlungsbelege, Kautionsübergaben
--     bekommen kassenbuch_id. Bestand und Standard = MLK (der alte App-Stand
--     bucht damit weiter wie bisher in die MLK).
--  3. Kassenstand (kassenbestand_bis), Bewegungen und die Sperre "Monat
--     geprüft" (Vorschüsse/Einzahlungen) je Kassenbuch. Der Kassenstand
--     rechnet unabhängig davon, wer ihn abfragt.
--  4. "Jetzt abrechnen" (saison_abrechnen_batch): optionaler Parameter
--     Kassenbuch (Standard MLK) - Belegnummer mit Präfix der Kasse.
--  5. Kassenbücher/Buchungen/Einzahlungen/Prüfungen nur im eigenen Bereich
--     sichtbar (Kasse Vertrieb sieht MD).
--
-- SELBSTPRÜFUNG: die Migration merkt sich vor der Änderung den Kassenstand
-- jedes Kassenbuchs zu 26 Stichtagen (jetzt + die letzten 25 Monatsanfänge)
-- und rechnet ihn danach mit den neuen Funktionen nach. Weicht ein Wert um
-- auch nur einen Cent ab, bricht die Migration ab und ändert NICHTS.
--
-- In der Supabase SQL-Konsole in einem Zug ausführen.
-- ============================================================================

begin;

-- 0) Vorher-Stand festhalten ---------------------------------------------------------
--    Lohnkassen-Anteil ausdrücklich aus den Tabellen gerechnet (gleiche
--    Formel wie kassenbestand_bis(), aber ohne die Rollenprüfung der View
--    auszahlungsbeleg_summary, die in der SQL-Konsole nichts liefern würde).
create temp table _stichtage on commit drop as
  select now() as stichtag
  union all
  select date_trunc('month', now()) - make_interval(months => n) from generate_series(0, 24) n;

create temp table _kassen_vorher on commit drop as
  select kb.id, kb.kuerzel, s.stichtag,
    kb.eroeffnungssaldo
    + coalesce((select sum(case when b.richtung = 'eingang' then b.betrag else -b.betrag end)
                from kassenbuch_buchung b
                where b.kassenbuch_id = kb.id and not b.storniert and b.datum < s.stichtag), 0)
    + case when kb.typ = 'lohnkasse' then
        coalesce((select sum(betrag) from cash_deposits where not storniert and datum < s.stichtag), 0)
        - coalesce((select sum(betrag) from advances where not storniert and zahlungsart = 'BAR' and datum < s.stichtag), 0)
        - coalesce((select sum(((z.zeile ->> 'auszahlungsbetrag'))::numeric)
                    from auszahlungsbelege ab join auszahlungsbeleg_zeilen z on z.auszahlungsbeleg_id = ab.id
                    where ab.zahlungsart = 'BAR' and ab.erstellt_am < s.stichtag), 0)
        - coalesce((select sum(betrag_summe) from kautionsuebergaben where not storniert and erstellt_am < s.stichtag), 0)
      else 0 end as saldo
  from kassenbuch kb cross join _stichtage s;

-- 1) Kassenbücher ---------------------------------------------------------------------
alter table public.kassenbuch
  add column if not exists belegnummer_praefix text not null default '';
update public.kassenbuch set belegnummer_praefix = 'ML-', typ = 'lohnkasse' where kuerzel = 'ML';
update public.kassenbuch set belegnummer_praefix = 'MD-', typ = 'lohnkasse' where kuerzel = 'MD';

-- 2) kassenbuch_id an den Lohnkassen-Bewegungen -----------------------------------------
--    Konstanter Standard = MLK: füllt den Bestand ohne Umschreiben/Trigger und
--    gilt für den alten App-Stand weiter.
do $$
declare
  v_mlk bigint := (select id from public.kassenbuch where kuerzel = 'MLK');
  t text;
begin
  if v_mlk is null then
    raise exception 'Kassenbuch MLK nicht gefunden - bitte Claude melden';
  end if;
  foreach t in array array['cash_deposits', 'advances', 'auszahlungsbelege', 'kautionsuebergaben'] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'kassenbuch_id') then
      execute format('alter table public.%I add column kassenbuch_id bigint not null default %s
                        references public.kassenbuch (id)', t, v_mlk);
      execute format('create index if not exists %I on public.%I (kassenbuch_id)', 'idx_' || t || '_kassenbuch', t);
    end if;
  end loop;
end $$;

-- nur Lohnkassen sind erlaubt
create or replace function public.lohnkasse_pruefen()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from kassenbuch where id = new.kassenbuch_id and typ = 'lohnkasse') then
    raise exception 'Kassenbuch % ist keine Lohnkasse', new.kassenbuch_id;
  end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['cash_deposits', 'advances', 'auszahlungsbelege', 'kautionsuebergaben'] loop
    execute format('drop trigger if exists trg_lohnkasse_pruefen on public.%I', t);
    execute format('create trigger trg_lohnkasse_pruefen before insert or update of kassenbuch_id on public.%I
                      for each row execute function public.lohnkasse_pruefen()', t);
  end loop;
end $$;

-- 3) Kassenstand / Bewegungen / Sperre je Kassenbuch ------------------------------------
create or replace function public.kassenbestand_bis(p_bis timestamptz, p_kassenbuch_id bigint)
returns numeric language sql stable security definer
set search_path = public
as $$
  select case
    -- Hintergrund/Konsole (ohne Login) oder berechtigte Rolle mit Zugriff
    -- auf die Firma des Kassenbuchs
    when auth.uid() is not null and not (
      hat_rolle(array['admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management']::user_role[])
      and exists (select 1 from kassenbuch kb left join firma f on f.kuerzel = kb.firma
                  where kb.id = p_kassenbuch_id
                    and (kb.firma is null or f.bereich = any (current_bereiche())))
    ) then null
    else
      coalesce((select sum(betrag) from cash_deposits
                where not storniert and datum < p_bis and kassenbuch_id = p_kassenbuch_id), 0)
      - coalesce((select sum(betrag) from advances
                  where not storniert and zahlungsart = 'BAR' and datum < p_bis and kassenbuch_id = p_kassenbuch_id), 0)
      - coalesce((select sum(((z.zeile ->> 'auszahlungsbetrag'))::numeric)
                  from auszahlungsbelege ab join auszahlungsbeleg_zeilen z on z.auszahlungsbeleg_id = ab.id
                  where ab.zahlungsart = 'BAR' and ab.erstellt_am < p_bis and ab.kassenbuch_id = p_kassenbuch_id), 0)
      - coalesce((select sum(betrag_summe) from kautionsuebergaben
                  where not storniert and erstellt_am < p_bis and kassenbuch_id = p_kassenbuch_id), 0)
  end;
$$;

-- bisheriger Aufruf ohne Kassenbuch = MLK (alter App-Stand, Saldo-Karte)
create or replace function public.kassenbestand_bis(p_bis timestamptz default now())
returns numeric language sql stable
set search_path = public
as $$
  select kassenbestand_bis(p_bis, (select id from kassenbuch where kuerzel = 'MLK'));
$$;

create or replace function public.kassenbuch_saldo_bis(p_kassenbuch_id bigint, p_bis timestamptz default now())
returns numeric language sql stable
set search_path = public
as $$
  select
    kb.eroeffnungssaldo
    + coalesce((
        select sum(case when b.richtung = 'eingang' then b.betrag else -b.betrag end)
        from kassenbuch_buchung b
        where b.kassenbuch_id = kb.id
          and not b.storniert
          and b.datum < p_bis
      ), 0)
    + case when kb.typ = 'lohnkasse' then kassenbestand_bis(p_bis, kb.id) else 0 end
  from kassenbuch kb
  where kb.id = p_kassenbuch_id;
$$;

create or replace function public.kassenbuch_bewegungen_seit(p_kassenbuch_id bigint, p_seit timestamptz)
returns integer language sql stable
set search_path = public
as $$
  select (
    coalesce((
      select count(*) from kassenbuch_buchung b
      where b.kassenbuch_id = kb.id and b.datum >= p_seit
    ), 0)
    + case when kb.typ = 'lohnkasse' then (
        coalesce((select count(*) from cash_deposits where datum >= p_seit and kassenbuch_id = kb.id), 0)
        + coalesce((select count(*) from advances where zahlungsart = 'BAR' and datum >= p_seit and kassenbuch_id = kb.id), 0)
        + coalesce((select count(*) from auszahlungsbelege where zahlungsart = 'BAR' and erstellt_am >= p_seit and kassenbuch_id = kb.id), 0)
        + coalesce((select count(*) from kautionsuebergaben where erstellt_am >= p_seit and kassenbuch_id = kb.id), 0)
      ) else 0 end
  )::integer
  from kassenbuch kb
  where kb.id = p_kassenbuch_id;
$$;

-- Sperre "Monat geprüft" je Kassenbuch (gleiche Zeitlogik wie bisher)
create or replace function public.ist_kassenpruefung_gesperrt(p_datum timestamptz, p_kassenbuch_id bigint)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from cash_checks c
    where c.freigegeben = true
      and c.kassenbuch_id = p_kassenbuch_id
      and p_datum >= c.period_from
      and p_datum <= c.period_to
  );
$$;

revoke all on function public.kassenbestand_bis(timestamptz, bigint),
  public.ist_kassenpruefung_gesperrt(timestamptz, bigint) from public, anon;
grant execute on function public.kassenbestand_bis(timestamptz, bigint),
  public.ist_kassenpruefung_gesperrt(timestamptz, bigint) to authenticated, service_role;
grant execute on function public.kassenbestand_bis(timestamptz), public.kassenbuch_saldo_bis(bigint, timestamptz),
  public.kassenbuch_bewegungen_seit(bigint, timestamptz) to authenticated, service_role;

-- Vorschüsse/Einzahlungen ändern: Sperre des EIGENEN Kassenbuchs
do $$
declare
  p record;
begin
  for p in
    select tablename, policyname, qual from pg_policies
    where schemaname = 'public' and tablename in ('advances', 'cash_deposits')
      and qual like '%ist_kassenpruefung_gesperrt(datum)%'
  loop
    execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename,
      replace(p.qual, 'ist_kassenpruefung_gesperrt(datum)', 'ist_kassenpruefung_gesperrt(datum, kassenbuch_id)'));
  end loop;
end $$;

-- 4) "Jetzt abrechnen" mit Kassenbuch ----------------------------------------------------
do $$
begin
  if md5(pg_get_functiondef('public.saison_abrechnen_batch(uuid[], integer, text, date)'::regprocedure))
     <> '16583232884b2842370251f632ba98e4' then
    raise exception 'saison_abrechnen_batch wurde seit der Vorbereitung geändert - bitte Claude melden (nichts geändert)';
  end if;
end $$;
drop function public.saison_abrechnen_batch(uuid[], integer, text, date);
CREATE OR REPLACE FUNCTION public.saison_abrechnen_batch(p_employee_ids uuid[], p_saison_jahr integer, p_zahlungsart text DEFAULT 'BAR'::text, p_austrittsdatum date DEFAULT CURRENT_DATE, p_kassenbuch_id bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  s season_summary%rowtype;
  neuer_beleg_id bigint;
  neue_belegnummer text;
  emp_id uuid;
  v_war_abgerechnet boolean;
  v_voller_stand jsonb;
  v_zeile jsonb;
  v_fehlende_namen text;
  v_saldo numeric;
  v_stundenlohn numeric;
  v_sk_betrag numeric;
  v_kassenbuch_id bigint;
  v_praefix text;
begin
  -- kassenbuch 2026-11-24 (Stufe 3b): Lohnkasse des Belegs, Standard MLK
  v_kassenbuch_id := coalesce(p_kassenbuch_id, (select id from kassenbuch where kuerzel = 'MLK'));
  select belegnummer_praefix into v_praefix from kassenbuch where id = v_kassenbuch_id and typ = 'lohnkasse';
  if not found then raise exception 'Kassenbuch % ist keine Lohnkasse', v_kassenbuch_id; end if;
  -- bereichspruefung 2026-11-24
  if exists (select 1 from unnest(p_employee_ids) x where not darf_mitarbeiter(x)) then raise exception 'Keine Berechtigung für diese Person (anderer Bereich)'; end if;
  if not hat_rolle(array['admin', 'lohnabrechnung']::user_role[]) then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
  end if;

  -- Nutzer-Vorgabe 2026-11-16 ("Stundenkonto ist immer Lohn"): Buchungen
  -- von vor der Pflichtdatum-Umstellung müssen vor dem Abrechnen ein
  -- bestätigtes Datum haben (die Lohnübersicht fragt danach und ruft
  -- stundenkonto_datum_setzen) - hier nur die serverseitige Absicherung,
  -- damit die Frage nicht umgangen werden kann.
  select string_agg(distinct e.name || ', ' || e.vorname, '; ')
    into v_fehlende_namen
  from stundenkonto_bewegungen sb
  join employees e on e.id = sb.employee_id
  where sb.employee_id = any(p_employee_ids)
    and sb.saison_jahr = p_saison_jahr
    and sb.datum_bestaetigt = false
    and sb.art <> 'Auszahlung'
    and sb.ist_storno = false;

  if v_fehlende_namen is not null then
    raise exception 'Stundenkonto-Buchungen ohne bestätigtes Datum bei: % - bitte zuerst das Datum nachtragen oder bestätigen.', v_fehlende_namen;
  end if;

  -- Ein negatives Stundenkonto würde den Lohn mindern - das soll nie
  -- unbemerkt eingefroren werden, sondern vorher bewusst korrigiert sein.
  select string_agg(e.name || ', ' || e.vorname || ' (' || sk.saldo || ' Std.)', '; ')
    into v_fehlende_namen
  from employee_stundenkonto_saldo sk
  join employees e on e.id = sk.employee_id
  where sk.employee_id = any(p_employee_ids)
    and sk.saison_jahr = p_saison_jahr
    and sk.saldo < 0;

  if v_fehlende_namen is not null then
    raise exception 'Negatives Stundenkonto bei: % - bitte zuerst im Stundenkonto korrigieren.', v_fehlende_namen;
  end if;

  select string_agg(s2.name || ', ' || s2.vorname, '; ')
    into v_fehlende_namen
  from season_summary s2
  where s2.employee_id = any(p_employee_ids)
    and s2.saison_jahr = p_saison_jahr
    and s2.bruttolohn > 0
    and s2.netto is null;

  if v_fehlende_namen is not null then
    raise exception 'Bitte zuerst den Netto-Betrag aus dem Lohnprogramm eintragen für: %', v_fehlende_namen;
  end if;

  neue_belegnummer := naechste_belegnummer(v_praefix || 'AZ-' || to_char(now(), 'MM-YYYY'));

  insert into auszahlungsbelege (belegnummer, saison_jahr, zahlungsart, erstellt_von, kassenbuch_id)
  values (neue_belegnummer, p_saison_jahr, p_zahlungsart, auth.uid(), v_kassenbuch_id)
  returning id into neuer_beleg_id;

  foreach emp_id in array p_employee_ids loop
    -- Nutzer-Vorgabe 2026-11-16: der noch offene Stundenkonto-Saldo wird
    -- beim Abrechnen automatisch in Zulage umgewandelt (Stunden ×
    -- hinterlegter Stundenlohn) - ersetzt die frühere Sperre "offenes
    -- Stundenkonto" und den Handknopf "In Auszahlung umwandeln". Am Lohn
    -- ändert das nichts (der Saldo steckt ohnehin schon live im Brutto,
    -- siehe season_summary) - der Betrag wird nur von "Saldo × aktueller
    -- Stundenlohn" in einen festen Euro-Betrag überführt und das Konto
    -- steht danach auf 0. Die 'Auszahlung'-Zeile zählt in der
    -- Monatszuordnung nicht mit (die Stunden bleiben beim Monat ihrer
    -- Gutschrift).
    select coalesce(sum(stunden), 0) into v_saldo
    from stundenkonto_bewegungen
    where employee_id = emp_id and saison_jahr = p_saison_jahr;

    if v_saldo > 0 then
      select stundenlohn into v_stundenlohn from employees where id = emp_id;
      v_sk_betrag := round(v_saldo * coalesce(v_stundenlohn, 0), 2);

      insert into stundenkonto_bewegungen (employee_id, saison_jahr, datum, stunden, art, notiz, betrag)
      values (
        emp_id, p_saison_jahr, current_date, -v_saldo, 'Auszahlung',
        'Automatisch beim Abrechnen in Zulage umgewandelt (Beleg ' || neue_belegnummer || ')',
        v_sk_betrag
      );

      insert into season_bonuses (employee_id, saison_jahr, stundenkonto_auszahlung_betrag)
      values (emp_id, p_saison_jahr, v_sk_betrag)
      on conflict (employee_id, saison_jahr)
      do update set stundenkonto_auszahlung_betrag =
        season_bonuses.stundenkonto_auszahlung_betrag + v_sk_betrag;
    end if;

    select * into s from season_summary
    where employee_id = emp_id and saison_jahr = p_saison_jahr;

    if found then
      v_war_abgerechnet := s.abgerechnet_am is not null;
      v_voller_stand := to_jsonb(s) - 'snapshot';
      if v_war_abgerechnet then
        v_zeile := auszahlungsbeleg_zeile_differenz(v_voller_stand, s.snapshot);
      else
        v_zeile := v_voller_stand;
      end if;

      insert into auszahlungsbeleg_zeilen (
        auszahlungsbeleg_id, employee_id, saison_jahr, personal_nr, name,
        vorname, abrechnungsart, ist_differenz, zeile
      )
      values (
        neuer_beleg_id, emp_id, p_saison_jahr, s.personal_nr, s.name,
        s.vorname, s.abrechnungsart, v_war_abgerechnet, v_zeile
      );

      insert into season_bonuses (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        snapshot, auszahlungsbeleg_id
      )
      values (
        emp_id, p_saison_jahr, now(), auth.uid(),
        v_voller_stand, neuer_beleg_id
      )
      on conflict (employee_id, saison_jahr)
      do update set
        abgerechnet_am = now(),
        abgerechnet_von = auth.uid(),
        snapshot = excluded.snapshot,
        auszahlungsbeleg_id = neuer_beleg_id;

      insert into saison_abrechnungen (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        auszahlungsbeleg_id
      )
      values (emp_id, p_saison_jahr, now(), auth.uid(), neuer_beleg_id);

      update employees set aktiv = false where id = emp_id;

      -- Neu: Beschaeftigungsabschnitt zeitgleich schliessen. Idempotent -
      -- bei einem Differenzbeleg (Person war fuer dieses Jahr schon
      -- abgemeldet) tut der zweite Aufruf nichts.
      perform employee_beschaeftigung_abmelden(emp_id, p_austrittsdatum);
    end if;
  end loop;

  return neue_belegnummer;
end;
$function$;
revoke all on function public.saison_abrechnen_batch(uuid[], integer, text, date, bigint) from public, anon;
grant execute on function public.saison_abrechnen_batch(uuid[], integer, text, date, bigint) to authenticated, service_role;

-- 5) Sichtbarkeit nach Bereich ------------------------------------------------------------
drop policy if exists "bereich_grenze" on public.kassenbuch;
create policy "bereich_grenze" on public.kassenbuch as restrictive for all to authenticated
  using (firma is null or firma in (select f.kuerzel from public.firma f))
  with check (firma is null or firma in (select f.kuerzel from public.firma f));
do $$
declare t text;
begin
  foreach t in array array['kassenbuch_buchung', 'cash_deposits', 'cash_checks'] loop
    execute format('drop policy if exists "bereich_grenze" on public.%I', t);
    execute format('create policy "bereich_grenze" on public.%I as restrictive for all to authenticated
      using (kassenbuch_id is null or kassenbuch_id in (select k.id from public.kassenbuch k))
      with check (kassenbuch_id is null or kassenbuch_id in (select k.id from public.kassenbuch k))', t);
  end loop;
end $$;

-- 6) Selbstprüfung: Kassenstände unverändert? --------------------------------------------
do $$
declare
  v_abw text;
begin
  select string_agg(format('%s am %s: vorher %s, nachher %s', v.kuerzel, to_char(v.stichtag, 'DD.MM.YYYY'),
                           v.saldo, kassenbuch_saldo_bis(v.id, v.stichtag)), '; ')
    into v_abw
  from _kassen_vorher v
  where v.saldo is distinct from kassenbuch_saldo_bis(v.id, v.stichtag);
  if v_abw is not null then
    raise exception 'Kassenstand weicht ab - Migration wird zurückgerollt, bitte Claude melden: %', v_abw;
  end if;
  raise notice 'Selbstprüfung ok: % Kassenstände (Kassenbücher x Stichtage) unverändert.', (select count(*) from _kassen_vorher);
end $$;

commit;
