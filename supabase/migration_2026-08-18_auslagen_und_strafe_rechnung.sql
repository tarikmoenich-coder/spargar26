-- Migration 2026-08-18: Auslagen auf der Suche-Seite + neue Vorschussart
-- "Strafe/Rechnung" mit Belegupload
--
-- Nutzer-Vorgabe (drei Teile):
-- 1. Arbeitskleidung-Seite zeigt jetzt die hinterlegten Preise in den
--    Spaltenüberschriften (reine Frontend-Änderung, kein SQL nötig).
-- 2. Suche-Seite: Buskosten, Kaution(en) und berechnete Arbeitskleidung
--    werden zusätzlich als "Auslage"-Positionen unter Vorschüsse
--    aufgeführt (Datum: "Saison {Jahr}" statt eines echten Datums, da
--    season_bonuses nur einen gemeinsamen updated_at je Mitarbeiter+Jahr
--    hat).
-- 3. Neue Vorschussart "Strafe/Rechnung": genau eine Person, mit
--    Belegupload (Strafzettel/Rechnung), Beleg per Direktlink in
--    Vorschuss-Seite UND Suche-Seite abrufbar (signierte URL, 60s).
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

-- ---------------------------------------------------------------------------
-- 1. advances: neue Spalten für Vorschussart + Beleg-Referenz
-- ---------------------------------------------------------------------------
alter table advances
  add column if not exists art text not null default 'Vorschuss'
    check (art in ('Vorschuss', 'Strafe/Rechnung')),
  add column if not exists beleg_dateiname text,
  add column if not exists beleg_storage_path text;

-- ---------------------------------------------------------------------------
-- 2. Privater Storage-Bucket für Strafe/Rechnung-Belege - getrennt von
--    "mitarbeiter-dokumente" (dort nur admin/hr), da kasse hier ebenfalls
--    hochladen/lesen darf, aber keinen Zugriff auf die eigentlichen
--    Personaldokumente bekommen soll.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('vorschuss-belege', 'vorschuss-belege', false)
on conflict (id) do nothing;

-- Strafe/Rechnung-Belege: gleiche Rollenaufteilung wie advance_recipients_rw
-- (lesen: wie bisherige Vorschuss-Rechte, schreiben: wie advances_write).
create policy "vorschuss_belege_storage_select" on storage.objects for select
  using (
    bucket_id = 'vorschuss-belege'
    and current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer')
  );
create policy "vorschuss_belege_storage_insert" on storage.objects for insert
  with check (
    bucket_id = 'vorschuss-belege' and current_role_name() in ('admin', 'kasse')
  );
create policy "vorschuss_belege_storage_delete" on storage.objects for delete
  using (
    bucket_id = 'vorschuss-belege' and current_role_name() in ('admin', 'kasse')
  );

-- ---------------------------------------------------------------------------
-- 3. employee_vorschuss_historie: art + Beleg-Referenz ans Ende angehängt
--    (CREATE OR REPLACE VIEW darf bestehende Spalten weder umbenennen noch
--    ihre Reihenfolge ändern). beleg_storage_path/beleg_dateiname sind
--    bewusst per current_role_name() maskiert - "art" allein ist unkritisch
--    (wie begruendung breit sichtbar), aber der Beleg-Verweis soll nur den
--    Rollen mit den bisherigen Vorschuss-Rechten zugänglich sein, nicht
--    z.B. zeiterfassung, die diese Sicht ebenfalls lesen darf.
-- ---------------------------------------------------------------------------
create or replace view employee_vorschuss_historie as
select
  ar.employee_id,
  a.datum,
  ar.anteil as betrag,
  a.zahlungsart,
  a.storniert,
  a.begruendung,
  a.art,
  case when current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer')
    then a.beleg_storage_path else null end as beleg_storage_path,
  case when current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer')
    then a.beleg_dateiname else null end as beleg_dateiname
from advance_recipients ar
join advances a on a.id = ar.advance_id;

grant select on employee_vorschuss_historie to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Neue View: Bus/Kaution(en)/Arbeitskleidung je Mitarbeiter+Saison für
--    die "Suche"-Seite. Bewusst NICHT security_invoker - season_bonuses UND
--    verpflegungssaetze sind per RLS eingeschränkt (siehe
--    employee_kleidung_ausgabe), aber genau wie bei den echten Vorschüssen
--    sollen alle Rollen hier Auskunft geben können.
-- ---------------------------------------------------------------------------
create or replace view employee_auslagen_historie as
select
  b.employee_id,
  b.saison_jahr,
  coalesce(b.bus_hin, 0) + coalesce(b.bus_rueck, 0) as bus_kosten,
  coalesce(b.fahrer_kaution, 0) as fahrer_kaution,
  coalesce(b.zimmer_kaution, 0) as zimmer_kaution,
  coalesce(b.kleidung_hose_anzahl, 0) * coalesce(v.kleidung_hose, 0)
    as kleidung_hose_betrag,
  coalesce(b.kleidung_jacke_anzahl, 0) * coalesce(v.kleidung_jacke, 0)
    as kleidung_jacke_betrag,
  coalesce(b.kleidung_stiefel_anzahl, 0) * coalesce(v.kleidung_stiefel, 0)
    as kleidung_stiefel_betrag
from season_bonuses b
left join verpflegungssaetze v on v.saison_jahr = b.saison_jahr;

grant select on employee_auslagen_historie to authenticated;
