-- Migration 2026-08-11 (Sicherheit): RLS fuer beleg_zaehler aktivieren
--
-- Auslöser: Supabase-Sicherheits-E-Mail vom 09.08.2026, Scan
-- "rls_disabled_in_public" - kritisch eingestuft: "Anyone with your project
-- URL can read, edit, and delete all data in this table because
-- Row-Level Security is not enabled."
--
-- Befund: beleg_zaehler (zentrale Belegnummern-Vergabe, ADR-010) war die
-- EINZIGE Tabelle im ganzen Schema ohne RLS - beim Durchbau bisher
-- schlicht vergessen. Enthaelt keine Personendaten (nur Monat + laufende
-- Nummer), aber die Funktion naechste_belegnummer() wird direkt vom
-- Client per .rpc() aufgerufen (Auszahlungen-, Kasse- und
-- Vorschuesse-Seite) - ohne RLS haette theoretisch jeder mit dem
-- Projekt-API-Key die Zaehler direkt per REST-API lesen/aendern/loeschen
-- koennen (Supabase gewaehrt anon/authenticated standardmaessig
-- Tabellen-Grants, RLS ist die einzige Schranke davor). Folge waere z.B.
-- gewesen: zurueckgesetzte oder doppelt vergebene Belegnummern
-- (belegnummer ist in advances/auszahlungsbelege/cash_deposits/
-- kautionsuebergaben jeweils UNIQUE, ein manipulierter Zaehler haette dort
-- Fehler beim naechsten echten Beleg ausgeloest).
--
-- Fix: RLS aktiviert, aber bewusst OHNE jede Policy - die Tabelle ist
-- damit fuer alle Rollen vollstaendig gesperrt, ausser ueber die jetzt
-- SECURITY DEFINER laufende Funktion naechste_belegnummer() (gleiches
-- Muster wie kandidat_buskosten_setzen/saison_abrechnen_batch an anderer
-- Stelle im Schema - der Funktions-Eigentuemer umgeht als Tabellen-
-- Eigentuemer die RLS automatisch).
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

alter table beleg_zaehler enable row level security;

create or replace function naechste_belegnummer(prefix_monat text)
returns text language plpgsql security definer set search_path = public as $$
declare
  neue_nr int;
begin
  insert into beleg_zaehler (monatsschluessel, naechste_nummer)
  values (prefix_monat, 2)
  on conflict (monatsschluessel)
  do update set naechste_nummer = beleg_zaehler.naechste_nummer + 1
  returning naechste_nummer - 1 into neue_nr;

  return prefix_monat || '-' || lpad(neue_nr::text, 3, '0');
end;
$$;

grant execute on function naechste_belegnummer(text) to authenticated;
