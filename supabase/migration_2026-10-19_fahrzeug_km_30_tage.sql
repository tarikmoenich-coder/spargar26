-- Migration 2026-10-19: km-Überblick ("welche Fahrzeuge fahren viel")
--
-- Nutzer-Vorgabe: kein exaktes Fahrtenbuch, nur ein Überblick - der echte,
-- manuell gepflegte Tacho (fahrzeug.km_stand, HU-relevant) bleibt
-- unangetastet. Stattdessen eine rein aus Tracker-Daten abgeleitete
-- Kennzahl: wie viele km hat ein Fahrzeug in den letzten 30 Tagen laut
-- Traccar-Positionsdaten zurückgelegt.
--
-- Liefert je Fahrzeug den ältesten Kilometerstand (gesamt_km, aus Traccars
-- totalDistance) innerhalb der letzten 30 Tage - serverseitig per DISTINCT ON
-- berechnet statt tausender Positionszeilen client-seitig zu laden. Die App
-- bildet daraus das Delta zu fahrzeug_uebersicht.gesamt_km (aktuellster Wert).

create or replace view fahrzeug_km_vor_30_tagen as
select distinct on (fahrzeug_id) fahrzeug_id, gesamt_km
from fahrzeug_position
where zeitpunkt >= now() - interval '30 days'
  and gesamt_km is not null
  and fahrzeug_id is not null
order by fahrzeug_id, zeitpunkt asc;

alter view fahrzeug_km_vor_30_tagen set (security_invoker = true);
grant select on fahrzeug_km_vor_30_tagen to authenticated;
