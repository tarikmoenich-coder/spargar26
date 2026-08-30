-- ============================================================================
-- Migration 2026-09-05: Unterkunft - Kontroll-Fotos an den Mangel haengen
--
-- Ein Foto, das bei einer Uebergabe/Zwischenkontrolle zu einem Bereich
-- aufgenommen wird, hatte bisher nur vorgang_id + bereich gesetzt. Wird aus
-- diesem Bereich ein Mangel uebernommen, blieb das Foto NICHT am Mangel
-- haengen - in der Maengelliste war es also nicht sichtbar.
--
-- Neue Vorgaenge verknuepfen das Foto jetzt beim Abschliessen (Frontend).
-- Diese Migration holt das fuer die BESTEHENDEN Maengel nach: mangel_id
-- setzen, wo Vorgang + Bereich zum Mangel passen (Beschreibung "<Bereich>: ...").
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug).
-- ============================================================================

alter table unterkunft_foto disable trigger trg_unterkunft_foto_schutz;

update unterkunft_foto f
set mangel_id = m.id
from unterkunft_mangel m
where f.mangel_id is null
  and f.vorgang_id is not null
  and f.bereich is not null
  and m.quelle_vorgang_id = f.vorgang_id
  and m.beschreibung like f.bereich || ': %';

alter table unterkunft_foto enable trigger trg_unterkunft_foto_schutz;
