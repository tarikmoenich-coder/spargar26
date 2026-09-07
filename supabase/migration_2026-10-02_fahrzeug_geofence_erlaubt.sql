-- Genehmigter Ort (Nutzer-Vorgabe: z. B. ein REWE, den die Fahrzeuge zum
-- Einkaufen anfahren dürfen). Ereignisse (Bewegung / Ausfahrt), die INNERHALB
-- eines "erlaubt"-Geofence passieren, lösen keinen Alarm aus - auch außerhalb
-- der Arbeitszeit. Alles andere außerhalb der Arbeitszeit bleibt Alarm.
-- App-editierbar in /fahrzeuge/einstellungen, der Poller fasst das Feld nicht an.
alter table fahrzeug_geofence
  add column if not exists erlaubt boolean not null default false;
