-- ============================================================================
-- Migration 2026-11-04: Erntewirtschaft - Live-Status der Waage im Kiosk
--
-- Nutzer-Rückmeldung nach dem ersten Praxistest am Hof: im Kiosk/Admin-
-- Protokoll soll sichtbar sein, dass die Verbindung zur Waage gerade steht
-- (aktuelles Gewicht + "zuletzt vor Xs aktualisiert"), nicht nur beim
-- tatsächlichen Wiegen einer Kiste. Der Waagen-Agent (tools/ernte-waage-
-- agent) fragt dafür zusätzlich AUSSERHALB eines Wiegevorgangs in kurzen
-- Abständen per <GN7> das Gewicht ab und schreibt das Ergebnis hier rein
-- (ein Update auf die bestehende Zeile, kein Insert).
--
-- Die Uhrzeit der Waage selbst wird bewusst NICHT live angezeigt: die
-- liefert nur der langsame <FP0>-Befehl (wartet geräteseitig bis zu 30s auf
-- Ruhelage) im Rahmen eines echten Wiegevorgangs, nicht für ein Dauer-
-- Polling geeignet. Stattdessen zählt der Zeitpunkt des letzten
-- erfolgreichen <GN7>-Pollings (Agenten-eigene Systemzeit) - für die reine
-- Frage "steht die Verbindung noch" reicht das (Nutzer-Bestätigung
-- 2026-11-04: "Ja, das reicht").
--
-- In der Supabase SQL-Konsole ausführen (ein Zug). Idempotent.
-- ============================================================================

alter table ernte_waage
  add column if not exists live_gewicht_kg numeric(7, 2),
  add column if not exists live_aktualisiert_am timestamptz;

comment on column ernte_waage.live_gewicht_kg is
  'Letztes per <GN7> abgefragtes Gewicht, unabhaengig von einem tatsaechlichen Wiegevorgang - nur fuer die Live-Verbindungsanzeige im Kiosk/Admin-Protokoll, kein Wiegeergebnis.';
comment on column ernte_waage.live_aktualisiert_am is
  'Zeitpunkt (Agenten-eigene Systemzeit, NICHT die Uhr der Waage) des letzten erfolgreichen <GN7>-Pollings - Kiosk/Admin-Seite warnt, wenn das zu lange her ist.';

-- 'waage' (Kiosk-Rolle, migration_2026-10-27_rolle_waage_2_policies.sql)
-- durfte bisher bewusst NICHT auf ernte_waage zugreifen ("soll ausschliesslich
-- den Kiosk sehen") - für die neue Live-Anzeige im Kiosk selbst muss das jetzt
-- dazukommen. Macht technisch auch ip/port der Waage für diese Rolle sichtbar
-- (interne LAN-Adresse der Hofwaage, kein echtes Geheimnis) - bewusst kein
-- eigener Spalten-Grant/View dafür, um die Policy-Landschaft nicht unnötig
-- zu verkomplizieren.
drop policy if exists "ernte_waage_select" on ernte_waage;
create policy "ernte_waage_select" on ernte_waage for select
  using (current_role_name() in ('admin', 'hr', 'management', 'erntewirtschaft', 'zeiterfassung', 'waage'));
