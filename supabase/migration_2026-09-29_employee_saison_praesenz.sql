-- Jahreshistorie "Person war in Saison X da" - OHNE Jahresdetails.
--
-- Hintergrund: die komplette Personaldatei der Vorjahre liegt bisher nur als
-- Excel vor (eine Zeile je Person UND Jahr, ~6.600 Zeilen bis Ende 2025),
-- gepflegt, damit Personalnummern nicht doppelt vergeben werden. Der
-- Historie-Import (/personal-import-historie) dampft das auf eine
-- employees-Zeile je personal_nr ein (jüngstes Jahr liefert die Stammdaten,
-- alle inaktiv) - die Jahre landen hier.
--
-- Nutzer-Vorgabe 2026-09-04: "Ich brauche keine Jahresdetails. Nur das Wissen,
-- dass die Person da war." -> bewusst KEINE gruppe/lohn/herkunft je Jahr.
-- min(saison_jahr)/max(saison_jahr) ergeben erste/letzte Saison.

create table if not exists employee_saison_praesenz (
  employee_id uuid not null references employees (id) on delete cascade,
  saison_jahr int not null check (saison_jahr between 1990 and 2100),
  -- 'import' = aus dem Historie-Import, 'manuell' = später von Hand gesetzt
  quelle text not null default 'import',
  erfasst_am timestamptz not null default now(),
  primary key (employee_id, saison_jahr)
);

create index if not exists idx_employee_saison_praesenz_jahr
  on employee_saison_praesenz (saison_jahr);

alter table employee_saison_praesenz enable row level security;

-- Nicht sensibel (nur Personen-ID + Jahr): Lesen für alle eingeloggten Rollen
-- wie bei employees, Pflege nur admin/hr.
drop policy if exists "employee_saison_praesenz_select" on employee_saison_praesenz;
create policy "employee_saison_praesenz_select" on employee_saison_praesenz
  for select using (auth.uid() is not null);

drop policy if exists "employee_saison_praesenz_admin_hr_all" on employee_saison_praesenz;
create policy "employee_saison_praesenz_admin_hr_all" on employee_saison_praesenz
  for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

grant select, insert, update, delete on employee_saison_praesenz to authenticated;
