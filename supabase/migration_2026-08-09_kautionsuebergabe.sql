-- Kautionsübergabe (Nutzer-Vorgabe 2026-08-09): die bei der Auszahlung
-- einbehaltene Zimmerkaution wird real an den Hausmeister übergeben - erst
-- dann wird sie auch als tatsächliche Kassenausgabe fällig. Analog zum
-- Vorschuss-Übergabebeleg: Zusammenfassung + Personen/Beträge, EIN
-- Unterschriftsfeld für den Hausmeister. Erscheint direkt im Anschluss an
-- den zugehörigen Auszahlungsbeleg.

create table kautionsuebergaben (
  id bigint generated always as identity primary key,
  belegnummer text not null unique,
  auszahlungsbeleg_id bigint not null references auszahlungsbelege (id),
  uebergeben_an text not null,
  betrag_summe numeric(10, 2) not null check (betrag_summe > 0),
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  storniert boolean not null default false,
  storniert_am timestamptz,
  storniert_von uuid references profiles (id),
  storno_grund text
);

create table kautionsuebergabe_personen (
  kautionsuebergabe_id bigint not null references kautionsuebergaben (id) on delete restrict,
  employee_id uuid not null references employees (id) on delete restrict,
  betrag numeric(10, 2) not null,
  primary key (kautionsuebergabe_id, employee_id)
);

alter table kautionsuebergaben enable row level security;
alter table kautionsuebergabe_personen enable row level security;

create policy "kautionsuebergaben_select" on kautionsuebergaben for select
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
create policy "kautionsuebergaben_write" on kautionsuebergaben for insert
  with check (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'));
create policy "kautionsuebergaben_update" on kautionsuebergaben for update
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'));
create policy "kautionsuebergabe_personen_select" on kautionsuebergabe_personen for select
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));
create policy "kautionsuebergabe_personen_write" on kautionsuebergabe_personen for insert
  with check (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'));
