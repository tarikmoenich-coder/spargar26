-- ============================================================================
-- Migration 2026-11-25b: Stufe 4 - Vorbereitung Import Vertriebs-Personal
-- aus HSC (Anita Mönich + Mönich Direkt).
--
-- Nutzer-Entscheidungen 2026-11-25:
--   * Anita Mönich (alte Vertriebsfirma) als historische Firma im Bereich
--     Vertrieb - Saisons bis zum Wechsel gehören dorthin. Kein Kassenbuch,
--     nicht für neue Zuordnungen (firma.aktiv = false).
--   * Kurzfristig Beschäftigte im Vertrieb (HSC-Personengruppe 110) bekommen
--     eine eigene Abrechnungsart "kurzfristig": keine App-Lohnsteuer (die
--     5,275 % von "pauschal" gelten nur für Aushilfen in der
--     Landwirtschaft), Netto aus HSC - wie Minijob/SV-pflichtig.
--   * Beschäftigungszeiträume aus HSC als Beschäftigungsabschnitte mit
--     Quelle 'import'.
--
-- Jede Anweisung einzeln wiederholbar (die Supabase-Konsole führt sie
-- einzeln aus). Ändert keine bestehende Berechnung.
-- ============================================================================

-- 1) Abrechnungsart "kurzfristig" (eigene Anweisung)
alter type public.abrechnungsart add value if not exists 'kurzfristig';

-- 2) Beschriftung
create or replace function public.abrechnungsart_label(p_abrechnungsart abrechnungsart)
returns text language sql immutable
as $$
  select case p_abrechnungsart::text
    when 'pauschal' then 'PA'
    when 'lohnsteuerklasse_1' then 'StKl 1'
    when 'sozialversicherungspflichtig' then 'SV-Pfl.'
    when 'minijob' then 'Minijob'
    when 'kurzfristig' then 'Kurzfr.'
    else p_abrechnungsart::text
  end;
$$;

-- 3) Firmen: aktiv-Kennzeichen + historische Firma Anita Mönich
alter table public.firma add column if not exists aktiv boolean not null default true;
insert into public.firma (kuerzel, name, bereich, ist_standard, reihenfolge, aktiv)
values ('AM', 'Anita Mönich', 'VT', false, 40, false)
on conflict (kuerzel) do nothing;

-- 4) Beschäftigungsabschnitte: Quelle 'import' zulassen
alter table public.employee_beschaeftigungsabschnitte
  drop constraint if exists employee_beschaeftigungsabschnitte_quelle_check;
alter table public.employee_beschaeftigungsabschnitte
  add constraint employee_beschaeftigungsabschnitte_quelle_check
  check (quelle = any (array['aktivierung', 'reaktivierung', 'manuell', 'migriert', 'statuswechsel', 'import']));
