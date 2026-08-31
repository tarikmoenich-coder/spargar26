-- ============================================================================
-- Migration 2026-09-12: Mängel in Reinigung vs. Reparatur trennen
--
-- kategorie:
--   'reinigung'  – Bewohner behebt selbst (Sauberkeit/Ordnung); treibt die
--                  Kontrollfrist im Kontrollplan.
--   'reparatur'  – muss instand gesetzt werden (Hausmeister/Handwerker);
--                  eigener Reiter "Reparaturen", treibt die Kontrollfrist NICHT.
--   'sonstiges'  – unklassifiziert (Default, Altbestand).
--
-- verursachung (nur bei Reparaturen relevant):
--   'bewohner'    – mutwillig/fahrlässig -> Kostenweitergabe
--   'verschleiss' – normale Instandhaltung
--   'unklar'      – noch zu klären (Default)
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

alter table unterkunft_mangel
  add column if not exists kategorie text not null default 'sonstiges';
alter table unterkunft_mangel
  drop constraint if exists unterkunft_mangel_kategorie_check;
alter table unterkunft_mangel
  add constraint unterkunft_mangel_kategorie_check
  check (kategorie in ('reinigung', 'reparatur', 'sonstiges'));

alter table unterkunft_mangel
  add column if not exists verursachung text not null default 'unklar';
alter table unterkunft_mangel
  drop constraint if exists unterkunft_mangel_verursachung_check;
alter table unterkunft_mangel
  add constraint unterkunft_mangel_verursachung_check
  check (verursachung in ('verschleiss', 'bewohner', 'unklar'));

-- Verursacher: mehrere Personen möglich (Gemeinschaftsraum-Schäden), auch
-- Nicht-Bewohner. Kein FK auf Array-Elemente - Prüfung in der App. Die
-- geschätzten Kosten werden gleichmäßig auf die Personen aufgeteilt.
alter table unterkunft_mangel
  drop column if exists verursacher_employee_id;
alter table unterkunft_mangel
  add column if not exists verursacher_employee_ids uuid[] not null default '{}';
alter table unterkunft_mangel
  add column if not exists kosten_geschaetzt numeric(10, 2);
alter table unterkunft_mangel
  add column if not exists faellig_am date;

create index if not exists idx_unterkunft_mangel_kategorie
  on unterkunft_mangel (kategorie);

-- Checklisten-Position hält bei einem Mangel schon die Einordnung fest, damit
-- die Übernahme beim Abschließen (auch bei mehreren Räumen am Stück) stimmt.
alter table unterkunft_vorgang_position
  add column if not exists mangel_kategorie text;
alter table unterkunft_vorgang_position
  drop constraint if exists unterkunft_vorgang_position_mangel_kategorie_check;
alter table unterkunft_vorgang_position
  add constraint unterkunft_vorgang_position_mangel_kategorie_check
  check (mangel_kategorie in ('reinigung', 'reparatur', 'sonstiges'));

alter table unterkunft_vorgang_position
  add column if not exists mangel_verursachung text;
alter table unterkunft_vorgang_position
  drop constraint if exists unterkunft_vorgang_position_mangel_verursachung_check;
alter table unterkunft_vorgang_position
  add constraint unterkunft_vorgang_position_mangel_verursachung_check
  check (mangel_verursachung in ('verschleiss', 'bewohner', 'unklar'));
