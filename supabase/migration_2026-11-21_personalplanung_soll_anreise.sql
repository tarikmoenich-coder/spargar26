-- ============================================================================
-- Migration 2026-11-21: Personalplanung - Saisonjahr, Platzhalter, Reserve,
-- Einsatzbereich, gemeinsames Soll je Herkunft.
--
-- Nutzer-Vorgabe 2026-11-21:
--   * Soll je Herkunft (= was von den Vermittlern kommen soll). Es gibt nur
--     EIN Soll: unterkunft_herkunft_plan.soll_anzahl wird ab jetzt auch in
--     der Personalplanung gepflegt, die Herkunfts-Bettenplanung nutzt
--     dieselbe Zahl (keine zweite Tabelle).
--   * Bis Jan/Feb gibt es oft nur Zahlen, keine Namen -> namenlose
--     Platzhalter (platzhalter = true, ohne Name/Personalnummer). Die HR
--     trägt später die echten Namen in die Platzhalter ein.
--   * Mehr Namen als Soll -> einzelne Personen als "Reserve" markieren;
--     Reserve zählt nicht ins Ist / den Zeitstrahl / die Bettenplanung.
--   * Grober Einsatzbereich je Person (eigene, schlanke Liste - die
--     Arbeitsgruppen der Stundenerfassung sind feiner und bleiben unberührt).
--   * Saisonjahr je Kandidat (bisher nur indirekt über die Ankunft).
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

-- 1) Einsatzbereiche ---------------------------------------------------------
create table if not exists einsatzbereiche (
  wert text primary key,
  reihenfolge int not null default 0,
  created_at timestamptz not null default now()
);

alter table einsatzbereiche enable row level security;

drop policy if exists "einsatzbereiche_select" on einsatzbereiche;
create policy "einsatzbereiche_select" on einsatzbereiche for select
  using (auth.uid() is not null);
drop policy if exists "einsatzbereiche_write" on einsatzbereiche;
create policy "einsatzbereiche_write" on einsatzbereiche for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

insert into einsatzbereiche (wert, reihenfolge) values
  ('Vorsaison', 10),
  ('Spargel', 20),
  ('Erdbeeren', 30),
  ('Sortierung', 40),
  ('Verpackung', 50),
  ('Traktorfahrer', 60),
  ('LKW-Fahrer', 70),
  ('Führungskräfte', 80),
  ('Nachsaison', 90),
  ('Zuckermais', 100),
  ('Sonstiges', 110)
on conflict (wert) do nothing;

-- 2) personal_kandidaten: neue Spalten ---------------------------------------
alter table personal_kandidaten
  add column if not exists saison_jahr int,
  add column if not exists platzhalter boolean not null default false,
  add column if not exists reserve boolean not null default false,
  add column if not exists einsatzbereich text
    references einsatzbereiche (wert) on update cascade on delete set null;

-- Saisonjahr für bestehende Zeilen nachtragen (nur wo noch leer):
--   * mit Ankunft/Arbeitsbeginn -> deren Jahr
--   * noch geplant ohne Datum -> ab September angelegt = Folgesaison
--   * sonst das Jahr des Anlegens
update personal_kandidaten
set saison_jahr = coalesce(
  extract(year from geplante_ankunft)::int,
  extract(year from arbeitsbeginn_datum)::int,
  case
    when status = 'geplant'
         and extract(month from erstellt_am at time zone 'Europe/Berlin') >= 9
      then extract(year from erstellt_am at time zone 'Europe/Berlin')::int + 1
    else extract(year from erstellt_am at time zone 'Europe/Berlin')::int
  end
)
where saison_jahr is null;

alter table personal_kandidaten alter column saison_jahr set not null;

create index if not exists idx_personal_kandidaten_saison
  on personal_kandidaten (saison_jahr, herkunft);

-- Platzhalter haben (noch) keinen Namen und keine Personalnummer.
alter table personal_kandidaten alter column personal_nr drop not null;
alter table personal_kandidaten alter column name drop not null;
alter table personal_kandidaten alter column vorname drop not null;

alter table personal_kandidaten
  drop constraint if exists personal_kandidaten_platzhalter_check;
alter table personal_kandidaten
  add constraint personal_kandidaten_platzhalter_check check (
    case
      when platzhalter then status = 'geplant'
      else personal_nr is not null and name is not null and vorname is not null
    end
  );

-- 3) Bettenplanung: "erfasst" = zugesagte Personen der Saison --------------
--    (inkl. Platzhalter, ohne Reserve), Saison jetzt aus saison_jahr statt
--    aus der Ankunft. Spalten unverändert.
create or replace view unterkunft_herkunft_abgleich as
select
  p.saison_jahr,
  p.herkunft,
  p.soll_anzahl,
  p.anreise_hinweis,
  coalesce(k.erfasst, 0)::int as erfasst,
  coalesce(zu.verplant, 0)::int as verplant,
  coalesce(bl.eingezogen, 0)::int as eingezogen
from unterkunft_herkunft_plan p
left join (
  select herkunft, saison_jahr, count(*) as erfasst
  from personal_kandidaten
  where status in ('geplant', 'anreiseliste')
    and not reserve
    and herkunft is not null
  group by 1, 2
) k on k.herkunft = p.herkunft and k.saison_jahr = p.saison_jahr
left join (
  select e.herkunft, extract(year from z.geplant_ab)::int as saison_jahr,
         count(*) as verplant
  from unterkunft_zuordnung z
  join employees e on e.id = z.employee_id
  where z.status = 'geplant' and e.herkunft is not null
  group by 1, 2
) zu on zu.herkunft = p.herkunft and zu.saison_jahr = p.saison_jahr
left join (
  select e.herkunft, extract(year from b.von)::int as saison_jahr,
         count(*) as eingezogen
  from unterkunft_belegung b
  join employees e on e.id = b.employee_id
  where b.bis is null and e.herkunft is not null
  group by 1, 2
) bl on bl.herkunft = p.herkunft and bl.saison_jahr = p.saison_jahr;
alter view unterkunft_herkunft_abgleich set (security_invoker = true);
grant select on unterkunft_herkunft_abgleich to authenticated;
