-- Migration 2026-08-11: Feldverwaltung gehoert zur Anbauplanung
--
-- Nutzer-Vorgabe: "Die Parzellenverwaltung musst du jetzt aber neu denken.
-- Das macht keinen Sinn, die in Praemien zu belassen, wenn die
-- Anbauplanung woanders stattfindet. In 'Praemien' duerfen nur die 'Saetze'
-- verwaltet werden, nicht aber die Parzellen."
--
-- Die Felder werden ab jetzt unter "Anbau -> Felder" gepflegt. Damit die
-- Rolle erntewirtschaft ihre eigene Planungsseite auch bedienen kann,
-- bekommt sie dort Schreibrecht - bisher durfte das nur admin. Die
-- Norm-/Bonus-Saetze bleiben unveraendert admin-only und bleiben in
-- Praemien.
--
-- In der Supabase SQL-Konsole ausfuehren.

drop policy if exists "erdbeeren_parzellen_write" on erdbeeren_parzellen;
create policy "erdbeeren_parzellen_write" on erdbeeren_parzellen for all
  using (current_role_name() in ('admin', 'erntewirtschaft'))
  with check (current_role_name() in ('admin', 'erntewirtschaft'));
