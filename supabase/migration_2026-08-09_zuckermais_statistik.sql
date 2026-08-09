-- Neuer Menüpunkt "Statistik" (Nutzer-Vorgabe 2026-08-09) - analog zu
-- "Prämien" mit eigenen Untermenüs Spargel/Erdbeeren/Zuckermais, hier
-- erstmal nur Zuckermais. Tagesstatistik über alle Mitarbeiter: Summe
-- Kisten/Kolben/Stunden/Prämien, Durchschnitt Kolben/Std., Kosten/Kolben.
-- Kosten/Kolben verwendet einen festen Stundenlohn von 13,90 € (Nutzer-
-- Vorgabe, exakt wie angegeben - NICHT der individuelle
-- employees.stundenlohn, da hier eine grobe Tages-Kennzahl über alle
-- Mitarbeiter gefragt ist, keine personenscharfe Abrechnung).

create or replace view zuckermais_statistik_tag as
select
  datum,
  sum(kisten) as summe_kisten,
  sum(kolben) as summe_kolben,
  sum(stunden) as summe_stunden,
  sum(praemie) as summe_praemie,
  case when sum(stunden) > 0 then sum(kolben) / sum(stunden) else null end
    as kolben_pro_stunde,
  case when sum(kolben) > 0
    then (13.90 * sum(stunden) + sum(praemie)) / sum(kolben)
    else null
  end as kosten_pro_kolben
from zuckermais_praemie_tag
group by datum
order by datum desc;

alter view zuckermais_statistik_tag set (security_invoker = true);
grant select on zuckermais_statistik_tag to authenticated;
