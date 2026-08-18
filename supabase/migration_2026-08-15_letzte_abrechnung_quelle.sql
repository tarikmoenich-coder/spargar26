-- Migration 2026-08-15: "Zuletzt abgerechnet am" enthält jetzt auch
-- nachgetragene historische Abrechnungen
--
-- Nutzer-Nachfrage: "'Zuletzt abgerechnet am:' sollte doch jetzt das von
-- mir nachgetragene historische Abrechnungsdatum enthalten oder?"
--
-- employee_letzte_abrechnung las bisher nur season_bonuses.abgerechnet_am
-- (nur ECHTE "Jetzt Abrechnen"-Aktionen in der App). Umgestellt auf
-- saison_abrechnungen - ein striktes Superset: jede echte Abrechnung
-- schreibt dort ohnehin zusätzlich mit (saison_abrechnen_batch), plus
-- jetzt auch die manuell nachgetragenen historischen Abrechnungen
-- (saison_abrechnung_nachtragen). security_invoker jetzt möglich, da
-- saison_abrechnungen (anders als season_bonuses) bereits für alle
-- angemeldeten Rollen lesbar ist.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

create or replace view employee_letzte_abrechnung as
select employee_id, max(abgerechnet_am) as abgerechnet_am
from saison_abrechnungen
group by employee_id;

alter view employee_letzte_abrechnung set (security_invoker = true);
grant select on employee_letzte_abrechnung to authenticated;
