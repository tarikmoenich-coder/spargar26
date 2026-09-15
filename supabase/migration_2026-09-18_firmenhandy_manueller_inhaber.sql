-- Firmenhandy: manuell eingetragener Inhaber-Name für Personen ohne
-- Spargar-Personalstammdatensatz (Nutzer-Vorgabe 2026-09-18: "Es lässt sich
-- auch kein Kontakt eintragen, der nicht in der Spargar geführt ist. Wir
-- haben aber Festangestellte, die müssen da auch in diesen Nummernpool").
-- Wird nur genutzt/angezeigt, wenn employee_id leer ist.

alter table firmenhandy add column if not exists inhaber_name text;
