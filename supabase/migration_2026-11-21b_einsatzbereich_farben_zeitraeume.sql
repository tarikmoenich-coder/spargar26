-- ============================================================================
-- Migration 2026-11-21b: Einsatzbereiche - Farbe + Saisonzeitraum je Jahr.
--
-- Nutzer-Vorgabe 2026-11-21:
--   * Personen in der Planungsliste farblich nach Einsatzbereich (auch
--     Platzhalter) -> einsatzbereiche.farbe (Hex, in den Einstellungen
--     änderbar).
--   * Saisonzeiträume je Einsatzbereich (z.B. Spargel, Erdbeeren, Zuckermais)
--     als Datumsbereich, sichtbar im Anreise-Zeitstrahl. Ändern sich jedes
--     Jahr -> eigene Tabelle je (Bereich, Saisonjahr).
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- Voraussetzung: migration_2026-11-21_personalplanung_soll_anreise.sql
-- ============================================================================

alter table einsatzbereiche add column if not exists farbe text;

update einsatzbereiche e set farbe = v.farbe
from (values
  ('Vorsaison', '#5f7f99'),
  ('Spargel', '#6a9a1f'),
  ('Erdbeeren', '#e34948'),
  ('Sortierung', '#eda100'),
  ('Verpackung', '#eb6834'),
  ('Traktorfahrer', '#2a78d6'),
  ('LKW-Fahrer', '#1baf7a'),
  ('Führungskräfte', '#6250d6'),
  ('Nachsaison', '#a0785a'),
  ('Zuckermais', '#e87ba4'),
  ('Sonstiges', '#8a8984')
) as v (wert, farbe)
where e.wert = v.wert and e.farbe is null;

create table if not exists einsatzbereich_zeitraum (
  einsatzbereich text not null
    references einsatzbereiche (wert) on update cascade on delete cascade,
  saison_jahr int not null,
  von date not null,
  bis date not null,
  updated_at timestamptz not null default now(),
  primary key (einsatzbereich, saison_jahr),
  constraint einsatzbereich_zeitraum_reihenfolge check (bis >= von)
);

alter table einsatzbereich_zeitraum enable row level security;

drop policy if exists "einsatzbereich_zeitraum_select" on einsatzbereich_zeitraum;
create policy "einsatzbereich_zeitraum_select" on einsatzbereich_zeitraum
  for select using (auth.uid() is not null);
drop policy if exists "einsatzbereich_zeitraum_write" on einsatzbereich_zeitraum;
create policy "einsatzbereich_zeitraum_write" on einsatzbereich_zeitraum
  for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

drop trigger if exists trg_einsatzbereich_zeitraum_updated_at
  on einsatzbereich_zeitraum;
create trigger trg_einsatzbereich_zeitraum_updated_at
  before update on einsatzbereich_zeitraum
  for each row execute function set_updated_at();
