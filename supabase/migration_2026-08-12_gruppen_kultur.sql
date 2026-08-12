-- Migration 2026-08-12: Arbeitsgruppen einer Kultur zuordnen
--
-- Nutzer-Vorgabe: "Könnte ich in den Einstellungen die Gruppen (für die
-- Stundenerfassung) auch einer Kultur zuordnen (Zuckermais, Spargel,
-- Erdbeeren), sodass ich die darin erfassten Stunden x Mindestlohn auf die
-- an diesem Tag geerntete Menge umlegen kann?"
--
-- Ergänzt die neue Kennzahl "Kosten/Kolben (Gruppen)" bzw. "Kosten/Steige
-- (Gruppen)" auf den Statistik-Seiten: rechnet - anders als die bereits
-- bestehende Kennzahl - nicht mit den in der Prämien-Erfassung
-- eingetragenen Stunden, sondern mit den Stunden aus der ALLGEMEINEN
-- Stundenerfassung aller Arbeitsgruppen, die hier einer Kultur zugeordnet
-- werden - damit zählen z.B. auch Sortierer/Träger mit, die nicht einzeln
-- in der Prämien-Erfassung stehen.
--
-- Nebenbefund beim Umbau: zuckermais_statistik_tag/erdbeeren_statistik_tag
-- waren beide security_invoker = true, verpflegungssaetze (Mindestlohn)
-- ist aber per RLS admin-only lesbar - dadurch war kosten_pro_kolben/
-- kosten_pro_steige für JEDE andere Rolle als admin lautlos leer, obwohl
-- die Statistik-Seite gerade für hr/lohnabrechnung/management/
-- erntewirtschaft gedacht ist (siehe components/Nav.tsx). Gleich mit
-- behoben, wie bei season_summary_monat: Eigentümer-Rechte statt
-- security_invoker + eigene Rollen-Prüfung.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

alter table arbeitsgruppen add column kultur text
  check (kultur in ('zuckermais', 'erdbeeren', 'spargel'));

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
    then (v.mindestlohn * gs.gruppen_stunden) / sum(p.kolben)
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

create or replace view erdbeeren_statistik_tag as
select
  p.datum,
  p.parzelle_id,
  p.parzelle_name,
  sum(p.steigen) as summe_steigen,
  sum(p.sut) as summe_sut,
  sum(p.stunden) as summe_stunden,
  sum(p.praemie) as summe_praemie,
  case when sum(p.stunden) > 0 then sum(p.steigen) / sum(p.stunden) else null end
    as steigen_pro_stunde,
  case when sum(p.steigen) > 0 and v.mindestlohn is not null
    then (v.mindestlohn * sum(p.stunden) + sum(p.praemie)) / sum(p.steigen)
    else null
  end as kosten_pro_steige,
  v.mindestlohn
from erdbeeren_praemie_tag p
left join verpflegungssaetze v
  on v.saison_jahr = extract(year from p.datum)::int
where current_role_name() in
  ('admin', 'hr', 'lohnabrechnung', 'management', 'erntewirtschaft')
group by p.datum, p.parzelle_id, p.parzelle_name, v.mindestlohn
order by p.datum desc;

alter view erdbeeren_statistik_tag reset (security_invoker);
grant select on erdbeeren_statistik_tag to authenticated;

create or replace view erdbeeren_gruppenkosten_tag as
select
  d.datum,
  d.summe_steigen,
  v.mindestlohn,
  gs.gruppen_stunden,
  case when d.summe_steigen > 0 and v.mindestlohn is not null and gs.gruppen_stunden is not null
    then (v.mindestlohn * gs.gruppen_stunden) / d.summe_steigen
    else null
  end as kosten_pro_steige_gruppen
from (
  select datum, sum(steigen) as summe_steigen
  from erdbeeren_rohdaten
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
