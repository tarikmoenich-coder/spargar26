-- Nutzer-Vorgabe 2026-08-25: "Bitte mach neben Kosten/Kolben € in der
-- Statistik Zuckermais noch eine Spalte mit der Summe Negativprämie für
-- diesen Tag". negativpraemie ist das Spiegelbild der Prämie (derselbe
-- Satz, nur wenn UNTER statt ÜBER der Norm gearbeitet wurde) - bisher nur
-- client-seitig in der Personenauswertung (app/statistik/zuckermais/
-- page.tsx) nachgerechnet, jetzt hier zentral in zuckermais_praemie_tag,
-- damit Personenauswertung UND die neue "Summe Negativprämie"-Spalte in
-- zuckermais_statistik_tag garantiert dieselbe Zahl liefern.
create or replace view zuckermais_praemie_tag as
select
  r.id,
  r.employee_id,
  r.datum,
  r.kisten,
  r.stunden,
  s.norm_kolben_pro_stunde,
  s.kolben_pro_kiste,
  s.satz_pro_kolben,
  r.kisten * s.kolben_pro_kiste as kolben,
  greatest(
    (r.kisten * s.kolben_pro_kiste - r.stunden * coalesce(s.norm_kolben_pro_stunde, 0))
      * coalesce(s.satz_pro_kolben, 0),
    0
  ) as praemie,
  greatest(
    (r.stunden * coalesce(s.norm_kolben_pro_stunde, 0) - r.kisten * s.kolben_pro_kiste)
      * coalesce(s.satz_pro_kolben, 0),
    0
  ) as negativpraemie
from zuckermais_rohdaten r
left join lateral (
  select z.norm_kolben_pro_stunde, z.kolben_pro_kiste, z.satz_pro_kolben
  from zuckermais_saetze z
  where z.gueltig_ab <= r.datum
  order by z.gueltig_ab desc
  limit 1
) s on true;

create or replace view zuckermais_statistik_tag as
select
  p.datum,
  sum(p.kisten) as summe_kisten,
  sum(p.kolben) as summe_kolben,
  sum(p.stunden) as summe_stunden,
  sum(p.praemie) as summe_praemie,
  -- Summe Negativprämie für diesen Tag (Nutzer-Vorgabe 2026-08-25) -
  -- gleiche Größe wie in der Personenauswertung unten, hier über alle
  -- Personen des Tages aufsummiert statt über den Zeitraum je Person.
  sum(p.negativpraemie) as summe_negativpraemie,
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
