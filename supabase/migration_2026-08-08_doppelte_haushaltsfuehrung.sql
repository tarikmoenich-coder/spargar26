-- Doppelte Haushaltsführung ("Bestätigung für den Nachweis der doppelten
-- Haushaltsführung - saisonbeschäftigte Arbeitskräfte") - Nachweis für
-- das Finanzamt, dass die Person im Heimatland einen eigenen Hausstand
-- unterhält (Voraussetzung für den Lohnsteuerabzug-Antrag). Ein
-- Datensatz je Person UND Saison-Jahr, analog zum SV-Fragebogen
-- (Nutzer-Vorgabe 2026-08-08). Siehe Kommentare in schema.sql.

create table doppelte_haushaltsfuehrung (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,

  familienstand text check (
    familienstand in ('verheiratet', 'ledig', 'verwitwet', 'geschieden_getrennt')
  ),
  wohnsituation text check (
    wohnsituation in (
      'eigentuemer_mieter', 'lebenspartner', 'andere_verwandte', 'keine_angabe'
    )
  ),

  antrag_gestellt boolean not null default false,
  antrag_gestellt_am date,

  ausgefuellt_am date,

  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),

  unique (employee_id, saison_jahr)
);

alter table doppelte_haushaltsfuehrung enable row level security;

create policy "doppelte_haushaltsfuehrung_admin_hr_all"
  on doppelte_haushaltsfuehrung for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
