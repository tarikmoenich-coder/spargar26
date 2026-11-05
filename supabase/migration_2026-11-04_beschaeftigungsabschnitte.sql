-- ============================================================================
-- Migration 2026-11-04: Explizite Beschäftigungsabschnitte
-- (Anmeldedatum/Abmeldedatum) statt impliziter Ableitung für die
-- 105-Tage/15-Wochen-SV-Prüfung
--
-- Nutzer-Vorgabe 2026-11-04/05: Bisher erkennt employee_sv_abschnitte einen
-- neuen "Beschäftigungsabschnitt" rein technisch ueber saison_abrechnungen-
-- Eintraege (jede "Jetzt Abrechnen"-Aktion), die Spanne ergibt sich aus
-- min/max der work_entries-Tage. Es gibt KEIN echtes Anmelde-/Abmeldedatum
-- im Datenmodell - eine Wiederbeschaeftigung ist dadurch nie ein sichtbares
-- Ereignis. Diese Migration fuehrt ein explizites Konzept ein, OHNE die
-- Ausgabe-Spalten von employee_sv_abschnitte zu aendern - dadurch bleiben
-- employee_sv_pruefung und ALLE Frontend-Konsumenten (lib/svPruefung.ts,
-- app/personal-sozialversicherung, app/management/sozialversicherung,
-- app/mitarbeiter, app/dashboard, lib/useControllingCounts.ts) unveraendert
-- funktionsfaehig.
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). NICHT beliebig oft
-- wiederholbar - der Backfill-Insert wuerde bei erneuter Ausfuehrung
-- Duplikate anlegen (siehe Hinweis dort). Idempotent nur bis zum Backfill.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Neue Tabelle
-- ----------------------------------------------------------------------------
create table employee_beschaeftigungsabschnitte (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete cascade,
  anmeldedatum date not null,
  abmeldedatum date,
  -- 'statuswechsel' zusaetzlich zum urspruenglich geplanten Satz: beim
  -- Statuswechsel (sozialversicherungsfrei -> -pflichtig) entsteht ein neuer
  -- employee_id - ohne eigenen Abschnitt wuerde der ALTE employee_id-Abschnitt
  -- nie schliessen und ewig weiterzaehlen (siehe statuswechselDurchfuehren()-
  -- Anpassung in app/mitarbeiter/page.tsx).
  quelle text not null check (quelle in ('aktivierung', 'reaktivierung', 'manuell', 'migriert', 'statuswechsel')),
  erzeugt_von uuid references profiles (id),
  erzeugt_am timestamptz not null default now(),
  check (abmeldedatum is null or abmeldedatum >= anmeldedatum)
);

-- Nur EIN offener (laufender) Abschnitt je Mitarbeiter - harte DB-Garantie,
-- unabhaengig davon, ueber welchen der Erzeuger-Wege ein Abschnitt entsteht.
create unique index idx_beschaeftigungsabschnitte_offen
  on employee_beschaeftigungsabschnitte (employee_id) where abmeldedatum is null;
create index idx_beschaeftigungsabschnitte_employee
  on employee_beschaeftigungsabschnitte (employee_id);

alter table employee_beschaeftigungsabschnitte enable row level security;
-- Gleiches Muster wie sv_fragebogen (migration_2026-08-08_sv_fragebogen.sql):
-- admin/hr-only. employee_sv_abschnitte/employee_sv_pruefung lesen trotzdem
-- weiter fuer management, weil sie selbst nicht security_invoker sind (siehe
-- Abschnitt 4 unten) - genau wie sv_fragebogen heute schon.
create policy "employee_beschaeftigungsabschnitte_admin_hr_all"
  on employee_beschaeftigungsabschnitte for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
grant select, insert, update, delete on employee_beschaeftigungsabschnitte to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Zwei kleine Funktionen - einzige Stellen, die Abschnitte oeffnen/
--    schliessen, damit alle Erzeuger-Stellen (Aktivierung, Abrechnen,
--    manueller Toggle, Statuswechsel) dieselbe Logik nutzen.
-- ----------------------------------------------------------------------------
create or replace function employee_beschaeftigung_anmelden(
  p_employee_id uuid,
  p_anmeldedatum date,
  p_quelle text
)
returns bigint
language plpgsql
security definer
as $$
declare
  neue_id bigint;
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung, einen Beschaeftigungsabschnitt anzumelden';
  end if;

  if exists (
    select 1 from employee_beschaeftigungsabschnitte
    where employee_id = p_employee_id and abmeldedatum is null
  ) then
    raise exception 'Mitarbeiter % hat bereits einen offenen Beschaeftigungsabschnitt - zuerst abmelden.', p_employee_id;
  end if;

  insert into employee_beschaeftigungsabschnitte (employee_id, anmeldedatum, quelle, erzeugt_von)
  values (p_employee_id, p_anmeldedatum, p_quelle, auth.uid())
  returning id into neue_id;

  return neue_id;
end;
$$;

grant execute on function employee_beschaeftigung_anmelden(uuid, date, text) to authenticated;

-- Idempotent bei bereits geschlossenem Abschnitt (kein Fehler) - wichtig fuer
-- den Differenzbeleg-Fall bei saison_abrechnen_batch (Person ist schon
-- abgemeldet, ein zweiter Aufruf im selben Jahr darf nicht scheitern).
create or replace function employee_beschaeftigung_abmelden(
  p_employee_id uuid,
  p_abmeldedatum date
)
returns void
language plpgsql
security definer
as $$
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung, einen Beschaeftigungsabschnitt abzumelden';
  end if;

  update employee_beschaeftigungsabschnitte
  set abmeldedatum = p_abmeldedatum
  where employee_id = p_employee_id and abmeldedatum is null;
end;
$$;

grant execute on function employee_beschaeftigung_abmelden(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Backfill: aus der HEUTIGEN (noch alten) employee_sv_abschnitte-Definition
--    einmalig einen Abschnitt je real erkanntem Abschnitt einfuegen, AUSSER
--    beim jeweils letzten Abschnitt eines aktuell aktiven Mitarbeiters - dort
--    bleibt abmeldedatum NULL (= laeuft noch). Dadurch bleiben bestehende
--    Tageszaehler beim Umschalten nahtlos (kein Sprung, keine kuenstliche
--    Pause). NUR EINMAL ausfuehren - ein zweiter Lauf wuerde Duplikate
--    anlegen (keine Unique-Constraint auf von/bis, bewusst, da reale
--    Wiederbeschaeftigungen durchaus identische Datumsspannen haben koennten).
-- ----------------------------------------------------------------------------
insert into employee_beschaeftigungsabschnitte (employee_id, anmeldedatum, abmeldedatum, quelle)
select
  a.employee_id,
  a.von,
  case
    when e.aktiv and a.abschnitt_nr = max(a.abschnitt_nr) over (partition by a.employee_id)
      then null
    else a.bis
  end,
  'migriert'
from employee_sv_abschnitte a
join employees e on e.id = a.employee_id;

-- ----------------------------------------------------------------------------
-- 4. Sicht-Umbau: NUR die Quelle austauschen, Ausgabe-Spalten identisch.
--    Ein Abschnitt kann ueber Silvester laufen, die 105-Tage-Regel gilt aber
--    pro Kalenderjahr - deshalb je ueberlapptem Jahr "klippen".
-- ----------------------------------------------------------------------------
create or replace view employee_sv_abschnitte as
with jahre as (
  select generate_series(
    extract(year from min(anmeldedatum))::int,
    extract(year from max(coalesce(abmeldedatum, current_date)))::int
  ) as jahr
  from employee_beschaeftigungsabschnitte
)
select
  b.employee_id,
  j.jahr as saison_jahr,
  row_number() over (partition by b.employee_id, j.jahr order by b.anmeldedatum) - 1 as abschnitt_nr,
  greatest(b.anmeldedatum, make_date(j.jahr, 1, 1)) as von,
  least(coalesce(b.abmeldedatum, current_date), make_date(j.jahr, 12, 31)) as bis,
  (least(coalesce(b.abmeldedatum, current_date), make_date(j.jahr, 12, 31))
    - greatest(b.anmeldedatum, make_date(j.jahr, 1, 1)) + 1)::int as tage
from employee_beschaeftigungsabschnitte b
cross join jahre j
where b.anmeldedatum <= make_date(j.jahr, 12, 31)
  and coalesce(b.abmeldedatum, current_date) >= make_date(j.jahr, 1, 1);

alter view employee_sv_abschnitte set (security_invoker = true);
grant select on employee_sv_abschnitte to authenticated;

-- employee_sv_pruefung selbst bleibt UNVERAENDERT (baut nur ueber die CTE
-- "abschnitte as (select * from employee_sv_abschnitte)" darauf auf) - keine
-- erneute CREATE OR REPLACE noetig.

-- ----------------------------------------------------------------------------
-- 5. saison_abrechnen_batch: neuer Parameter p_austrittsdatum (mit Default,
--    rein zur Robustheit) - schliesst den offenen Beschaeftigungsabschnitt
--    zeitgleich mit dem schon bisherigen employees.aktiv = false. Rest der
--    Funktion unveraendert uebernommen. Ein zusaetzlicher Parameter ist in
--    Postgres eine ANDERE Funktions-Signatur (Ueberladung) - die alte
--    3-Parameter-Fassung erst explizit entfernen, sonst bliebe sie als
--    inaktive Karteileiche bestehen, die bei einem versehentlichen Aufruf
--    ohne p_austrittsdatum den neuen Beschaeftigungsabschnitt NICHT schliessen
--    wuerde.
-- ----------------------------------------------------------------------------
drop function if exists saison_abrechnen_batch(uuid[], int, text);

create or replace function saison_abrechnen_batch(
  p_employee_ids uuid[],
  p_saison_jahr int,
  p_zahlungsart text default 'BAR',
  p_austrittsdatum date default current_date
)
returns text language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neuer_beleg_id bigint;
  neue_belegnummer text;
  emp_id uuid;
  v_war_abgerechnet boolean;
  v_voller_stand jsonb;
  v_zeile jsonb;
  v_fehlende_namen text;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
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

  neue_belegnummer := naechste_belegnummer('AZ-' || to_char(now(), 'MM-YYYY'));

  insert into auszahlungsbelege (belegnummer, saison_jahr, zahlungsart, erstellt_von)
  values (neue_belegnummer, p_saison_jahr, p_zahlungsart, auth.uid())
  returning id into neuer_beleg_id;

  foreach emp_id in array p_employee_ids loop
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
$$;

grant execute on function saison_abrechnen_batch(uuid[], int, text, date) to authenticated;
