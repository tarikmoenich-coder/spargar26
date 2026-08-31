-- ============================================================================
-- Migration 2026-09-11: Checklisten-Vorlage je Raumtyp
--
-- Bisher galt eine flache Checkliste für jede Übergabe/Kontrolle. Jetzt hängt
-- jeder Checklisten-Bereich an einem Raumtyp (art); beim Start eines Vorgangs
-- werden nur die Bereiche des jeweiligen Raumtyps als Positionen angelegt.
-- Gemeinschaftsräume bekommen dadurch kurze, passende Listen.
--
-- Bestehende Bereiche werden als Schlafzimmer-Checkliste ('zimmer') behandelt.
-- Für Küche/Bad/WC/Flur/Gemeinschaftsraum werden knappe Startlisten angelegt
-- (in den Stammdaten frei anpassbar).
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

alter table unterkunft_checkliste_vorlage
  add column if not exists art text not null default 'zimmer';

alter table unterkunft_checkliste_vorlage
  drop constraint if exists unterkunft_checkliste_vorlage_art_check;
alter table unterkunft_checkliste_vorlage
  add constraint unterkunft_checkliste_vorlage_art_check
  check (art in ('zimmer', 'kueche', 'bad', 'wc', 'flur', 'gemeinschaft'));

-- Unique-Bedingung um art erweitern (gleicher Bereich darf je Raumtyp einmal
-- existieren).
alter table unterkunft_checkliste_vorlage
  drop constraint if exists unterkunft_checkliste_vorlage_bereich_gueltig_ab_key;
alter table unterkunft_checkliste_vorlage
  drop constraint if exists unterkunft_checkliste_vorlage_art_bereich_gueltig_ab_key;
alter table unterkunft_checkliste_vorlage
  add constraint unterkunft_checkliste_vorlage_art_bereich_gueltig_ab_key
  unique (art, bereich, gueltig_ab);

-- Knappe Startlisten für die Gemeinschaftsräume.
insert into unterkunft_checkliste_vorlage (bereich, reihenfolge, gueltig_ab, art) values
  ('Herd / Ofen',            10, date '2026-01-01', 'kueche'),
  ('Küchenzeile / Spüle',    20, date '2026-01-01', 'kueche'),
  ('Kühlschrank',            30, date '2026-01-01', 'kueche'),
  ('Sauberkeit',             40, date '2026-01-01', 'kueche'),
  ('Dusche / Wanne',         10, date '2026-01-01', 'bad'),
  ('Waschbecken',            20, date '2026-01-01', 'bad'),
  ('Fliesen / Silikon',      30, date '2026-01-01', 'bad'),
  ('Sauberkeit',             40, date '2026-01-01', 'bad'),
  ('WC / Spülung',           10, date '2026-01-01', 'wc'),
  ('Waschbecken',            20, date '2026-01-01', 'wc'),
  ('Sauberkeit',             30, date '2026-01-01', 'wc'),
  ('Boden / Wände',          10, date '2026-01-01', 'flur'),
  ('Beleuchtung',            20, date '2026-01-01', 'flur'),
  ('Sauberkeit',             30, date '2026-01-01', 'flur'),
  ('Möbel / Ausstattung',    10, date '2026-01-01', 'gemeinschaft'),
  ('Boden / Wände',          20, date '2026-01-01', 'gemeinschaft'),
  ('Sauberkeit',             30, date '2026-01-01', 'gemeinschaft')
on conflict on constraint unterkunft_checkliste_vorlage_art_bereich_gueltig_ab_key
  do nothing;
