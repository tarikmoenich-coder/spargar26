-- ============================================================================
-- Migration 2026-09-07: Abgeschlossene Auszugs-Abnahmen -> Belegung beenden
--
-- Der Vorgangstyp "auszug" (Abnahme) hat bisher nur das Protokoll angelegt,
-- die zugehörige unterkunft_belegung aber offen gelassen (bis IS NULL).
-- Dadurch zählte die ausgezogene Person in Suche / Grundriss / Übersicht
-- weiter als "aktuell". Ab sofort schließt die Übergabe-Seite die Belegung
-- beim Abschließen mit; dieser Lauf zieht die Altfälle nach.
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Mehrfachlauf schadet
-- nicht - bis wird nur gesetzt, wo es noch NULL ist.
-- ============================================================================

-- 1. Vorgang mit ausdrücklich gewählter Belegung: genau diese schließen.
update unterkunft_belegung b
set bis = v.abgeschlossen_am::date
from unterkunft_vorgang v
where v.typ = 'auszug'
  and v.abgeschlossen
  and not v.storniert
  and v.belegung_id = b.id
  and b.bis is null
  and v.abgeschlossen_am::date >= b.von;

-- 2. Vorgang ohne Belegungsbezug: nur eindeutige Fälle - das Zimmer hat
--    genau eine offene Belegung. Diese zum Abnahmedatum schließen.
--    (Mehrdeutige Zimmer bleiben unangetastet und sind manuell zu prüfen.)
update unterkunft_belegung b
set bis = v.abgeschlossen_am::date
from unterkunft_vorgang v
where v.typ = 'auszug'
  and v.abgeschlossen
  and not v.storniert
  and v.belegung_id is null
  and b.zimmer_id = v.zimmer_id
  and b.bis is null
  and v.abgeschlossen_am::date >= b.von
  and (
    select count(*) from unterkunft_belegung b2
    where b2.zimmer_id = v.zimmer_id and b2.bis is null
  ) = 1;
