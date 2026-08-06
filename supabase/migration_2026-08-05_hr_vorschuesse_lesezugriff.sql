-- ============================================================================
-- Migration für bestehende Projekte: im Supabase SQL Editor ausführen.
-- hr bekommt Lesezugriff auf Vorschüsse (wie lohnabrechnung/pruefer/
-- management) - der Reiter "Vorschüsse" unter "Lohn" war für hr sichtbar,
-- aber wegen fehlender Leserechte leer.
-- ============================================================================

drop policy "advances_select" on advances;
create policy "advances_select" on advances for select
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));

drop policy "advance_recipients_rw" on advance_recipients;
create policy "advance_recipients_rw" on advance_recipients for all
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer'))
  with check (current_role_name() in ('admin', 'kasse'));
