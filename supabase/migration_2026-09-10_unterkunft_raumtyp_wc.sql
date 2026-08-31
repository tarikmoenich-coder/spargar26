-- ============================================================================
-- Migration 2026-09-10: Raumtyp "wc" ergänzen ("Bad" und "WC" getrennt)
--
-- Bisher deckte der Raumtyp 'bad' ("Bad/WC") beides ab. Ab jetzt gibt es
-- 'bad' (nur Bad) und zusätzlich 'wc' (nur WC). art ist eine text-Spalte mit
-- CHECK (kein Enum) - es reicht, die CHECK-Bedingungen zu erweitern.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

alter table unterkunft_zimmer
  drop constraint if exists unterkunft_zimmer_art_check;
alter table unterkunft_zimmer
  add constraint unterkunft_zimmer_art_check
  check (art in ('zimmer', 'kueche', 'bad', 'wc', 'flur', 'gemeinschaft'));

alter table unterkunft_kontroll_intervall
  drop constraint if exists unterkunft_kontroll_intervall_art_check;
alter table unterkunft_kontroll_intervall
  add constraint unterkunft_kontroll_intervall_art_check
  check (art in ('zimmer', 'kueche', 'bad', 'wc', 'flur', 'gemeinschaft'));

insert into unterkunft_kontroll_intervall (art, gruen_bis_tage, gelb_bis_tage)
values ('wc', 7, 21)
on conflict (art) do nothing;
