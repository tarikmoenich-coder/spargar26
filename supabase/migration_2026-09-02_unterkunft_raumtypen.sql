-- ============================================================================
-- Migration 2026-09-02: Unterkunft - Raumtypen fuer den Grundriss
--
-- Nutzer-Vorgabe: klare farbliche Unterscheidung zwischen Zimmern,
-- Sanitaereinrichtungen und Fluren. Dafuer bekommt unterkunft_zimmer.art
-- eigene Werte statt nur 'zimmer' | 'gemeinschaft':
--   'zimmer'       - Schlafzimmer (Betten/Belegung/Uebergabe)
--   'kueche'       - Kueche
--   'bad'          - Bad / WC (Sanitaer)
--   'flur'         - Flur / Gang
--   'gemeinschaft' - sonstiger Gemeinschaftsraum (Fallback)
--
-- Nur Constraint + Daten-Update, keine Sicht-Aenderung (die Sichten
-- unterscheiden weiterhin nur "zimmer" vs. "nicht zimmer").
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug).
-- ============================================================================

alter table unterkunft_zimmer
  drop constraint if exists unterkunft_zimmer_art_check;
alter table unterkunft_zimmer
  add constraint unterkunft_zimmer_art_check
  check (art in ('zimmer', 'kueche', 'bad', 'flur', 'gemeinschaft'));

-- Bereits angelegte Gemeinschaftsraeume anhand ihres Namens einsortieren.
update unterkunft_zimmer
set art = case
  when nummer ilike 'k%che%' then 'kueche'
  when nummer ilike 'bad%' or nummer ilike 'wc%' then 'bad'
  when nummer ilike 'flur%' or nummer ilike 'gang%' then 'flur'
  else 'gemeinschaft'
end
where art = 'gemeinschaft';
