-- Freitext, wo der GPS-Tracker im Fahrzeug verbaut ist ("unter dem Fahrersitz",
-- "im Sicherungskasten", ...) - damit die Werkstatt das Geraet wiederfindet.
alter table fahrzeug add column if not exists tracker_position text;

comment on column fahrzeug.tracker_position is
  'Einbauort des GPS-Trackers im Fahrzeug (Freitext), damit die Werkstatt ihn wiederfindet.';

-- fahrzeug_uebersicht um die Spalte ergaenzen (kurzer Text, unkritisch fuer den
-- Poll). create or replace kann keine Spalte in der Mitte einschieben -> neu
-- anlegen.
drop view if exists fahrzeug_uebersicht;
create view fahrzeug_uebersicht as
select
  f.id, f.kennzeichen, f.bezeichnung, f.typ, f.fahrer_employee_id,
  f.km_stand, f.km_stand_am, f.hu_faellig, f.vin, f.baujahr, f.notiz, f.aktiv,
  f.tracker_position,
  e.name as fahrer_name, e.vorname as fahrer_vorname,
  e.personal_nr as fahrer_personal_nr,
  t.traccar_unique_id, t.geraetetyp, t.status as tracker_status,
  t.zuletzt_gesehen as tracker_zuletzt_gesehen,
  p.zeitpunkt as pos_zeitpunkt, p.lat, p.lng, p.speed_kmh, p.kurs,
  p.zuendung, p.bewegung, p.batterie_prozent, p.gesamt_km
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
