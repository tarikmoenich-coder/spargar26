-- Migration 2026-08-11: Kosten-Kennzahlen rechnen mit dem gepflegten
-- Mindestlohn statt mit einem fest verdrahteten Wert
--
-- Nutzer-Vorgabe: "Das mit den 13,90 in der Statistik kannst du gleich
-- beheben. Da ist immer mein gesetzter Wert fuer Mindestlohn fuer die
-- Berechnung relevant."
--
-- Betrifft beide Statistik-Sichten (Zuckermais und Erdbeeren): "Kosten pro
-- Kolben" bzw. "Kosten pro Steige" rechneten mit fest verdrahteten 13,90 €
-- und waeren mit jeder Mindestlohn-Aenderung auseinandergelaufen. Jetzt
-- kommt der Wert aus verpflegungssaetze.mindestlohn des jeweiligen
-- Saisonjahres (gepflegt unter Einstellungen).
--
-- Bewusst KEIN Ersatzwert, wenn fuer ein Jahr kein Mindestlohn hinterlegt
-- ist: die Kennzahl bleibt dann leer, statt mit einem geratenen Wert zu
-- rechnen. Weiterhin bewusst nicht der individuelle employees.stundenlohn -
-- gefragt ist eine grobe Tages-Kennzahl ueber alle Mitarbeiter, keine
-- personenscharfe Abrechnung.
--
-- Nur der Ausdruck aendert sich, Spaltennamen und -reihenfolge bleiben -
-- daher "create or replace view" unproblematisch (kein 42P16).
--
-- In der Supabase SQL-Konsole ausfuehren.

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
  end as kosten_pro_kolben
from zuckermais_praemie_tag p
left join verpflegungssaetze v
  on v.saison_jahr = extract(year from p.datum)::int
group by p.datum, v.mindestlohn
order by p.datum desc;

alter view zuckermais_statistik_tag set (security_invoker = true);
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
  end as kosten_pro_steige
from erdbeeren_praemie_tag p
left join verpflegungssaetze v
  on v.saison_jahr = extract(year from p.datum)::int
group by p.datum, p.parzelle_id, p.parzelle_name, v.mindestlohn
order by p.datum desc;

alter view erdbeeren_statistik_tag set (security_invoker = true);
grant select on erdbeeren_statistik_tag to authenticated;
