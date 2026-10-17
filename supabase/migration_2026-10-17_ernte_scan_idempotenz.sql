-- ============================================================================
-- Migration 2026-10-17: Erntewirtschaft - Idempotenz fuer ernte_scan
--
-- Die Ingest-Edge-Function ernte-ingest (docs/erntewirtschaft-plan.md, Teil C)
-- WIRD exakte Duplikate bekommen: sowohl der ernte-scan-agent
-- (tools/ernte-scan-agent/) als auch ein spaeterer Waagen-Pfad legen bei
-- einem fehlgeschlagenen Versand denselben Payload erneut in die lokale
-- Warteschlange und senden ihn beim naechsten Versuch erneut - das ist
-- gewolltes Verhalten (siehe queue.mjs/agent.sh), die Ingest-Funktion muss
-- also doppelte Zeilen stillschweigend verwerfen koennen ("on conflict do
-- nothing"), statt sie doppelt zu zaehlen.
--
-- ernte_scan (migration_2026-10-12_erntewirtschaft_waage_grundlage.sql) hat
-- dafuer noch keinen Unique-Index. "tag_uid" ist bei Ereignissen ohne Code
-- (z.B. "batterie") NULL - ein Unique-Index direkt auf (quelle, tag_uid,
-- ereignis, zeitpunkt) wuerde solche NULL-Werte NICHT als Duplikat erkennen
-- (NULL <> NULL in Postgres-Unique-Indizes), deshalb der normalisierte,
-- generierte Spalte tag_uid_norm (leerer String statt NULL).
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

alter table ernte_scan
  add column if not exists tag_uid_norm text generated always as (coalesce(tag_uid, '')) stored;

create unique index if not exists idx_ernte_scan_idempotenz
  on ernte_scan (quelle, tag_uid_norm, ereignis, zeitpunkt);

comment on column ernte_scan.tag_uid_norm is
  'Normalisierte Kopie von tag_uid (NULL -> leerer String) nur fuer den Idempotenz-Unique-Index - nicht direkt verwenden, siehe idx_ernte_scan_idempotenz.';
