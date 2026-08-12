-- Migration 2026-08-12: Kulturkosten enthalten jetzt auch die Tagesprämien
--
-- Nutzer-Vorgabe: "Kannst du die zwei neuen Spalten in der Statistik mit
-- einem Abstand zum Rest darstellen? Mit einer eigenen Überschrift:
-- Kulturkosten. Darin enthalten dann auch die Tagesprämien. Die fehlen
-- bei der Betrachtung der reinen Gruppenkosten."
--
-- Ergänzt migration_2026-08-12_gruppen_kultur.sql: die dort neu
-- eingeführten Kennzahlen kosten_pro_kolben_gruppen (Zuckermais) und
-- kosten_pro_steige_gruppen (Erdbeeren) rechneten bisher nur mit
-- Mindestlohn × Gruppen-Stunden, ohne die Tagesprämien - jetzt wie die
-- bereits bestehende Kennzahl kosten_pro_kolben/kosten_pro_steige PLUS
-- Prämien. Bei Erdbeeren wechselt die Quelle dafür von erdbeeren_rohdaten
-- auf erdbeeren_praemie_tag (liefert Steigen UND Prämie in einem).
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

create or replace view zuckermais_statistik_tag as
select
  p.datum,
  sum(p.kisten) as summe_kisten,
  sum(p.kolben) as summe_kolben,
  sum(p.stunden) as summe_stunden,
  sum(p.praemie) as summe_praemie,
  case when sum(p.stunden) > 0 then sum(p.kolben) / sum(p.stunden) else null end
    as kolben_pro_stunde,
  case when sum(p.kolben) > 0 and v.mindestlohn is not null
    then (v.mindestlohn * sum(p.stunden) + sum(p.praemie)) / sum(p.kolben)
    else null
  end as kosten_pro_kolben,
  gs.gruppen_stunden,
  case when sum(p.kolben) > 0 and v.mindestlohn is not null and gs.gruppen_stunden is not null
    then (v.mindestlohn * gs.gruppen_stunden + sum(p.praemie)) / sum(p.kolben)
    else null
  end as kosten_pro_kolben_gruppen,
  v.mindestlohn
from zuckermais_praemie_tag p
left join verpflegungssaetze v
  on v.saison_jahr = extract(year from p.datum)::int
left join lateral (
  select sum(we.stunden) as gruppen_stunden
  from work_entries we
  join employees e on e.id = we.employee_id
  join arbeitsgruppen ag on ag.gruppe_nr = e.gruppe_nr
  where ag.kultur = 'zuckermais'
    and we.datum = p.datum
    and we.stunden is not null
) gs on true
where current_role_name() in
  ('admin', 'hr', 'lohnabrechnung', 'management', 'erntewirtschaft')
group by p.datum, v.mindestlohn, gs.gruppen_stunden
order by p.datum desc;

alter view zuckermais_statistik_tag reset (security_invoker);

grant select on zuckermais_statistik_tag to authenticated;

-- Spaltenreihenfolge bewusst so belassen (summe_praemie ans ENDE
-- angehängt, nicht vor mindestlohn eingefügt) - CREATE OR REPLACE VIEW
-- erlaubt nur ein Anhängen neuer Spalten (Fehler 42P16 sonst).
create or replace view erdbeeren_gruppenkosten_tag as
select
  d.datum,
  d.summe_steigen,
  v.mindestlohn,
  gs.gruppen_stunden,
  case when d.summe_steigen > 0 and v.mindestlohn is not null and gs.gruppen_stunden is not null
    then (v.mindestlohn * gs.gruppen_stunden + d.summe_praemie) / d.summe_steigen
    else null
  end as kosten_pro_steige_gruppen,
  d.summe_praemie
from (
  select datum, sum(steigen) as summe_steigen, sum(praemie) as summe_praemie
  from erdbeeren_praemie_tag
  group by datum
) d
left join verpflegungssaetze v
  on v.saison_jahr = extract(year from d.datum)::int
left join lateral (
  select sum(we.stunden) as gruppen_stunden
  from work_entries we
  join employees e on e.id = we.employee_id
  join arbeitsgruppen ag on ag.gruppe_nr = e.gruppe_nr
  where ag.kultur = 'erdbeeren'
    and we.datum = d.datum
    and we.stunden is not null
) gs on true
where current_role_name() in
  ('admin', 'hr', 'lohnabrechnung', 'management', 'erntewirtschaft')
order by d.datum desc;

grant select on erdbeeren_gruppenkosten_tag to authenticated;
