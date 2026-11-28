-- ============================================================================
-- Migration 2026-11-28g: Spargel-Saisonsummen für die Startseite.
--
-- Eine Zeile je Saisonjahr (nur Personen, ohne reine Gruppenzeilen 2026):
-- kg, Stunden, Prämie, Lohnanspruch, Personen-Tage gesamt / mit Prämie -
-- daraus Anteil mit Prämie und Prämienquote, ohne dass die Startseite
-- tausende Tageszeilen laden muss. Rechte wie spargel_praemie_tag
-- (security_invoker).
-- In der Supabase SQL-Konsole ausführen.
-- ============================================================================

create or replace view public.spargel_saison_summe with (security_invoker = true) as
select
  saison_jahr,
  sum(kg) as kg,
  sum(stunden) as stunden,
  sum(praemie) as praemie,
  sum(lohnanspruch) as lohnanspruch,
  count(*) as personen_tage,
  count(*) filter (where praemie > 0) as tage_mit_praemie,
  count(distinct coalesce(employee_id::text, personal_nr)) as personen,
  min(datum) as erster_tag,
  max(datum) as letzter_tag
from public.spargel_praemie_tag
where gruppe is null
group by saison_jahr;

grant select on public.spargel_saison_summe to authenticated;
