-- Fahrzeuge: An-/Abmeldung mit Datum (Nutzer-Vorgabe 2026-09-16). Bei einer
-- wachsenden Flotte (Richtung 150 Fahrzeuge) reicht das bisherige reine
-- "aktiv" an/aus nicht mehr - es soll nachvollziehbar sein, seit wann ein
-- Fahrzeug angemeldet bzw. seit wann es abgemeldet ist. "aktiv" bleibt das
-- Feld, nach dem gefiltert wird (Karte/Liste blenden abgemeldete Fahrzeuge
-- standardmäßig aus), wird aber jetzt zusammen mit den beiden Datumsfeldern
-- gepflegt (An-/Abmelden setzt automatisch das jeweilige Datum).

alter table fahrzeug add column if not exists angemeldet_seit date;
alter table fahrzeug add column if not exists abgemeldet_am date;

create or replace view fahrzeug_uebersicht as
select
  f.id, f.kennzeichen, f.bezeichnung, f.typ, f.fahrer_employee_id,
  f.km_stand, f.km_stand_am, f.hu_faellig, f.vin, f.baujahr, f.notiz, f.aktiv,
  f.tracker_position,
  e.name as fahrer_name, e.vorname as fahrer_vorname,
  e.personal_nr as fahrer_personal_nr,
  t.traccar_unique_id, t.geraetetyp, t.status as tracker_status,
  t.zuletzt_gesehen as tracker_zuletzt_gesehen,
  p.zeitpunkt as pos_zeitpunkt, p.lat, p.lng, p.speed_kmh, p.kurs,
  p.zuendung, p.bewegung, p.batterie_prozent, p.gesamt_km,
  -- Neu ans Ende angehängt (42P16: "create or replace view" verbietet
  -- Positionswechsel bestehender Spalten).
  f.angemeldet_seit, f.abgemeldet_am
from fahrzeug f
left join employees e on e.id = f.fahrer_employee_id
left join fahrzeug_tracker t on t.fahrzeug_id = f.id
left join lateral (
  select * from fahrzeug_position pp
  where pp.fahrzeug_id = f.id
  order by pp.zeitpunkt desc limit 1
) p on true;

alter view fahrzeug_uebersicht set (security_invoker = true);
grant select on fahrzeug_uebersicht to authenticated;
