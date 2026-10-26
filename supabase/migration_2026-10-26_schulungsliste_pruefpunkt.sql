-- ============================================================================
-- Migration 2026-10-26: Schulungsliste als Prüfpunkt der Anreiseliste
--
-- Nutzer-Vorgabe: "Jede Person muss auf mindestens einer Schulungsliste
-- stehen." Die Teilnehmer-Unterschriftenliste
-- (app/personal-anreiseliste/schulungsliste) war bisher eine reine
-- Live-Ansicht ohne Gedächtnis - sie zeigt immer nur, wer GERADE auf der
-- Anreiseliste steht, speichert aber nirgends, wer tatsächlich schon auf
-- einer gedruckten Liste stand. Neue Tabelle `schulung_teilnahme` hält das
-- fest (eine Zeile je Person + Druckvorgang), die Anreiseliste-Checkliste
-- bekommt einen neuen Punkt, der genau das prüft.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

create table if not exists schulung_teilnahme (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete cascade,
  titel text not null,
  schulung_datum date not null,
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now()
);

create index if not exists idx_schulung_teilnahme_employee
  on schulung_teilnahme (employee_id);

alter table schulung_teilnahme enable row level security;

drop policy if exists "schulung_teilnahme_admin_hr_all" on schulung_teilnahme;
create policy "schulung_teilnahme_admin_hr_all" on schulung_teilnahme for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

grant select, insert, update, delete on schulung_teilnahme to authenticated;

-- personal_kandidaten_checkliste: neuer Punkt ans Ende angehängt (nicht
-- dazwischen - CREATE OR REPLACE VIEW erlaubt nur neue Spalten am Ende,
-- siehe Kommentar in migration_2026-08-11_formulare_ohne_upload.sql).
-- Ansonsten unverändert gegenüber der dortigen Fassung.
create or replace view personal_kandidaten_checkliste as
select
  k.id as kandidat_id,
  k.aktivierter_employee_id as employee_id,
  k.gedruckt,
  k.fragebogen_erfasst,
  k.buskosten_erfasst,
  exists (
    select 1 from employee_documents d
    where d.employee_id = k.aktivierter_employee_id
      and d.kategorie = 'Ausweiskopie'
  ) as ausweiskopie_vorhanden,
  (
    k.fuehrerschein_kategorien is null
    or array_length(k.fuehrerschein_kategorien, 1) is null
    or exists (
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Führerschein Kopie'
    )
  ) as fuehrerschein_erfuellt,
  (
    coalesce(k.verheiratet_laut_fragebogen, false) = false
    or exists (
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Hochzeitsurkunde'
    )
  ) as hochzeitsurkunde_erfuellt,
  (
    k.lohnsteuerabzug_antrag_gewuenscht = false
    or exists (
      select 1 from doppelte_haushaltsfuehrung d
      where d.employee_id = k.aktivierter_employee_id
        and d.saison_jahr = extract(year from k.geplante_ankunft)::int
        and d.familienstand is not null
    )
  ) as lohnsteuerabzug_erfuellt,
  exists (
    select 1 from sv_fragebogen f
    where f.employee_id = k.aktivierter_employee_id
      and f.saison_jahr = extract(year from k.geplante_ankunft)::int
  ) as sv_fragebogen_erfasst,
  coalesce(
    (
      select fa.bestanden
      from sv_fragebogen_auswertung fa
      where fa.employee_id = k.aktivierter_employee_id
        and fa.saison_jahr = extract(year from k.geplante_ankunft)::int
    ),
    false
  ) as sv_fragebogen_bestanden,
  coalesce(
    (
      select fa.unvollstaendig_fehlerhaft
      from sv_fragebogen_auswertung fa
      where fa.employee_id = k.aktivierter_employee_id
        and fa.saison_jahr = extract(year from k.geplante_ankunft)::int
    ),
    false
  ) as sv_fragebogen_unvollstaendig_fehlerhaft,
  -- NEU (2026-10-26): mindestens einmal auf einer gedruckten
  -- Schulungs-Unterschriftenliste gestanden.
  exists (
    select 1 from schulung_teilnahme s
    where s.employee_id = k.aktivierter_employee_id
  ) as schulungsliste_erfuellt
from personal_kandidaten k
where k.status = 'anreiseliste';

alter view personal_kandidaten_checkliste set (security_invoker = true);
grant select on personal_kandidaten_checkliste to authenticated;

-- anreiseliste_offen_arbeitend (Controlling-Sicht,
-- app/management/anreiseliste): gleicher neuer Punkt, hier als "_fehlt"
-- (inverse Benennung passend zur bestehenden Konvention dieser Sicht).
-- DROP + CREATE statt OR REPLACE, weil diese Sicht schon vorher per
-- drop/create umbenannt wurde (42P16) - Spaltenreihenfolge daher frei.
drop view if exists anreiseliste_offen_arbeitend;

create view anreiseliste_offen_arbeitend as
select
  k.id as kandidat_id,
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.herkunft,
  e.aktiv,
  w.erster_arbeitstag,
  w.letzter_arbeitstag,
  (current_date - w.erster_arbeitstag) as tage_seit_arbeitsbeginn,
  not k.gedruckt as arbeitsvertrag_fehlt,
  not coalesce(
    (
      select sv_fragebogen_bestanden(f)
      from sv_fragebogen f
      where f.employee_id = e.id
        and f.saison_jahr = extract(year from w.erster_arbeitstag)::int
    ),
    false
  ) as sv_fragebogen_offen,
  not k.buskosten_erfasst as buskosten_fehlen,
  not exists (
    select 1 from employee_documents d
    where d.employee_id = e.id and d.kategorie = 'Ausweiskopie'
  ) as ausweiskopie_fehlt,
  (
    k.fuehrerschein_kategorien is not null
    and array_length(k.fuehrerschein_kategorien, 1) is not null
    and not exists (
      select 1 from employee_documents d
      where d.employee_id = e.id and d.kategorie = 'Führerschein Kopie'
    )
  ) as fuehrerschein_fehlt,
  (
    coalesce(k.verheiratet_laut_fragebogen, false)
    and not exists (
      select 1 from employee_documents d
      where d.employee_id = e.id and d.kategorie = 'Hochzeitsurkunde'
    )
  ) as hochzeitsurkunde_fehlt,
  (
    k.lohnsteuerabzug_antrag_gewuenscht
    and not exists (
      select 1 from doppelte_haushaltsfuehrung d
      where d.employee_id = e.id
        and d.saison_jahr = extract(year from w.erster_arbeitstag)::int
        and d.familienstand is not null
    )
  ) as dhh_angaben_fehlen,
  not exists (
    select 1 from schulung_teilnahme s where s.employee_id = e.id
  ) as schulungsliste_fehlt
from personal_kandidaten k
join employees e on e.id = k.aktivierter_employee_id
join lateral (
  select
    min(we.datum) as erster_arbeitstag,
    max(we.datum) as letzter_arbeitstag
  from work_entries we
  where we.employee_id = e.id
    and (we.stunden > 0 or we.markierung is not null)
) w on true
where k.status = 'anreiseliste'
  and w.erster_arbeitstag is not null;

grant select on anreiseliste_offen_arbeitend to authenticated;
