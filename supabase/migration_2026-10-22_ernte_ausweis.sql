-- ============================================================================
-- Migration 2026-10-22: Mitarbeiter-Ausweise (QR-ID-Karten) -
-- Personalnummer + geheimer Suffix statt manuell angelerntem ernte_tag
--
-- Nutzer-Vorgabe 2026-10-22: der P-Code eines Mitarbeiter-Badges soll
-- direkt aus der Personalnummer ableitbar sein ("P-<personal_nr>-<suffix>"),
-- damit ein Ausweis ganz ohne vorherigen Anlern-/Zuordnungsschritt gedruckt
-- werden kann (Knopfdruck fuer alle Mitarbeiter). Der zusaetzliche,
-- zufaellige Suffix verhindert, dass jemand, der nur die Personalnummer
-- eines Kollegen kennt, sich selbst einen funktionierenden Code basteln
-- kann, ohne dessen Karte je gesehen zu haben ("Buddy Punching") - er steht
-- NUR im QR-Code, nicht als Klartext auf der Karte. Bei "Verlust-Karte
-- drucken" wird er rotiert, die alte Karte ist damit sofort ungueltig.
--
-- BEWUSST EINE EIGENE TABELLE statt einer neuen Spalte auf "employees":
-- employees_read_for_logged_in (schema.sql) gibt JEDER eingeloggten Rolle
-- Lesezugriff auf die komplette employees-Zeile, und Spalten-Ebene-
-- Einschraenkungen sind in diesem Projekt laut dokumentiertem Vorfall vom
-- 2026-08-09 (Kommentar direkt bei dieser Policy in schema.sql) explizit
-- vermieden - eine "select *"-Abfrage verlangt in Postgres SELECT-Recht auf
-- ALLE Spalten, ein Spalten-Grant-Fehler legt sonst die ganze Personalseite
-- fuer alle Rollen lahm. Der Suffix MUSS aber geheim bleiben (sonst koennte
-- jede eingeloggte Rolle jeden Code rekonstruieren) - eine eigene, eng
-- gerechte Tabelle (nur admin/hr, wie sv_fragebogen) loest das sauber, ohne
-- an der employees-RLS zu ruehren.
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

create table if not exists ernte_ausweis (
  employee_id uuid primary key references employees (id) on delete cascade,
  suffix text not null check (suffix ~ '^[0-9A-F]{8}$'),
  erstellt_am timestamptz not null default now(),
  erstellt_von uuid references profiles (id) default auth.uid(),
  aktualisiert_am timestamptz not null default now()
);

alter table ernte_ausweis enable row level security;

-- Wie sv_fragebogen/lohnsteuerantrag: nur admin/hr, NICHT "jede
-- eingeloggte Rolle" wie bei employees selbst - der Suffix ist das
-- Geheimnis, das die Karte faelschungssicher macht.
drop policy if exists "ernte_ausweis_admin_hr_all" on ernte_ausweis;
create policy "ernte_ausweis_admin_hr_all" on ernte_ausweis for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

grant select, insert, update, delete on ernte_ausweis to authenticated;
