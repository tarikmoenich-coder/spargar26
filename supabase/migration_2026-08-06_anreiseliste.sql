-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- Anreiseliste: erweitert personal_kandidaten um Führerschein-Selbstauskunft,
-- Druck-/Checklisten-Felder für die neue Anreiseliste-Seite, und eine neue
-- Vollständigkeits-Prüfung (View), die live berechnet statt gespeichert wird.
-- ============================================================================

-- 1) Neue Spalten auf personal_kandidaten -----------------------------------

-- "if not exists" je Spalte: macht das Skript gefahrlos erneut ausführbar,
-- falls ein vorheriger Versuch (z.B. wegen des Fehlers unten bei Schritt 2)
-- teilweise durchgelaufen sein sollte.
alter table personal_kandidaten
  add column if not exists fuehrerschein_kategorien text[]
    check (fuehrerschein_kategorien is null
      or fuehrerschein_kategorien <@ array['B', 'BE', 'C', 'CE']),
  add column if not exists gedruckt boolean not null default false,
  add column if not exists gedruckt_am timestamptz,
  add column if not exists fragebogen_erfasst boolean not null default false,
  add column if not exists verheiratet_laut_fragebogen boolean,
  add column if not exists lohnsteuerabzug_antrag_gewuenscht boolean not null default false,
  add column if not exists buskosten_erfasst boolean not null default false;

-- 2) status-Constraint erweitern ---------------------------------------------
-- Der bisherige Status 'angereist' (= "fertig") wird durch die neu live
-- berechnete Vollständigkeits-Prüfung ersetzt. Henne-Ei-Problem: der neue
-- Constraint erlaubt 'angereist' nicht mehr (also schlägt er beim Hinzufügen
-- an bestehenden 'angereist'-Zeilen fehl), der alte Constraint erlaubt aber
-- 'anreiseliste' noch nicht (also schlägt das Ummappen vorher fehl). Lösung:
-- den neuen Constraint zunächst mit NOT VALID hinzufügen (überspringt die
-- Prüfung bestehender Zeilen, gilt aber schon für neue Schreibvorgänge -
-- die folgende Ummappung wird also bereits korrekt durchgesetzt), dann
-- ummappen, dann den Constraint nachträglich validieren.

alter table personal_kandidaten drop constraint if exists personal_kandidaten_status_check;
alter table personal_kandidaten
  add constraint personal_kandidaten_status_check
  check (status in ('geplant', 'anreiseliste', 'storniert'))
  not valid;

update personal_kandidaten set status = 'anreiseliste' where status = 'angereist';

alter table personal_kandidaten validate constraint personal_kandidaten_status_check;

-- 3) Neue View: Vollständigkeits-Prüfung für die Anreiseliste ---------------

drop view if exists personal_kandidaten_checkliste;
create view personal_kandidaten_checkliste as
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
      select 1 from employee_documents d
      where d.employee_id = k.aktivierter_employee_id
        and d.kategorie = 'Formular "Doppelte Haushaltsführung"'
    )
  ) as lohnsteuerabzug_erfuellt
from personal_kandidaten k
where k.status = 'anreiseliste';

alter view personal_kandidaten_checkliste set (security_invoker = true);
grant select on personal_kandidaten_checkliste to authenticated;

-- 4) Buskosten aus der Anreiseliste setzen dürfen ---------------------------
-- (season_bonuses ist laut season_bonuses_rw nur admin/lohnabrechnung
-- erlaubt - kontrollierter Ausnahmeweg für hr, gleiches Muster wie
-- saison_abrechnen_batch.)

create or replace function kandidat_buskosten_setzen(
  p_kandidat_id uuid,
  p_bus_hin numeric
)
returns void language plpgsql security definer as $$
declare
  v_employee_id uuid;
  v_saison_jahr int;
begin
  if current_role_name() not in ('admin', 'hr') then
    raise exception 'Keine Berechtigung für die Anreiseliste';
  end if;

  select aktivierter_employee_id, coalesce(extract(year from geplante_ankunft)::int, extract(year from current_date)::int)
    into v_employee_id, v_saison_jahr
  from personal_kandidaten
  where id = p_kandidat_id;

  if v_employee_id is null then
    raise exception 'Kandidat hat noch keinen aktivierten Mitarbeiter';
  end if;

  insert into season_bonuses (employee_id, saison_jahr, bus_hin)
  values (v_employee_id, v_saison_jahr, p_bus_hin)
  on conflict (employee_id, saison_jahr)
  do update set bus_hin = excluded.bus_hin;

  update personal_kandidaten set buskosten_erfasst = true where id = p_kandidat_id;
end;
$$;

grant execute on function kandidat_buskosten_setzen(uuid, numeric) to authenticated;
