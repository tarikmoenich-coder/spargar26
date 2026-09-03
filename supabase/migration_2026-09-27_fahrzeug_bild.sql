-- Fahrzeugfoto: kleines Vorschaubild (client-seitig auf ~320 px / JPEG
-- verkleinert) direkt als data-URL in der Zeile. Dient nur der optischen
-- Zuordnung auf der Karte (Foto ueber dem Kennzeichen). Kein Storage-Bucket
-- noetig; die Spalte erbt die RLS-Policies von fahrzeug (Schreiben admin/hr).
alter table fahrzeug add column if not exists bild text;

comment on column fahrzeug.bild is
  'Fahrzeugfoto als data-URL (~320 px, JPEG), nur zur optischen Zuordnung auf der Karte. Nicht in fahrzeug_uebersicht, damit der 20-s-Poll schlank bleibt.';
