-- Nachtrag zu migration_2026-08-24_arbeitskleidung_lagerbestand.sql
-- (Nutzer-Vorgabe 2026-08-25: eigene Seite "Lager", Datumsstempel je
-- Anfangsbestand, Zugriff nur admin/hr - "Den Lagerbestand soll nur
-- 'admin und hr' sehen und bearbeiten können. 'Stundenerfassung' macht
-- nur die Ausgabe"). Nur für den Fall gedacht, dass die ursprüngliche
-- Migration (ohne diesen Nachtrag) bereits ausgeführt wurde - sonst
-- reicht das erneute Ausführen der vollständigen (jetzt erweiterten)
-- migration_2026-08-24_arbeitskleidung_lagerbestand.sql.

-- Setzt updated_at/updated_by zuverlässig bei JEDER Änderung (nicht nur
-- beim ersten Insert, wo "default now()" schon reicht) - Nutzer-Vorgabe:
-- "Den Anfangsbestand mit Datumsstempel versehen". Serverseitig statt
-- client-seitig gesetzt, damit der Zeitstempel nicht vom Client
-- manipulierbar ist.
create or replace function kleidung_lagerbestand_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_kleidung_lagerbestand_touch on kleidung_lagerbestand;
create trigger trg_kleidung_lagerbestand_touch
  before insert or update on kleidung_lagerbestand
  for each row execute function kleidung_lagerbestand_touch();

-- Lagerbestand (eigene Seite "Lager") jetzt nur admin/hr - sehen UND
-- bearbeiten. Ausgabe-Log (auf der Arbeitskleidung-Seite) bleibt
-- unverändert admin/hr/zeiterfassung/lohnabrechnung/management.
drop policy if exists "kleidung_lagerbestand_select" on kleidung_lagerbestand;
create policy "kleidung_lagerbestand_select" on kleidung_lagerbestand for select
  using (current_role_name() in ('admin', 'hr'));
