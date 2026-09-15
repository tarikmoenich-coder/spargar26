-- Personalstamm: private Telefonnummer, private E-Mail-Adresse, Funktion/
-- Abteilung (Nutzer-Vorgabe 2026-09-18). "funktion" ist zusätzlich Teil des
-- Firmenhandy-Kontakt-Syncs (app/api/firmenhandy-sync, als vCard TITLE),
-- damit sich ein Kontakt auf dem Handy leichter finden lässt (z.B. Suche
-- nach "Vorarbeiter"). telefon_privat/email_privat sind reine
-- Personalstamm-Angaben ohne externen Sync.

alter table employees add column if not exists telefon_privat text;
alter table employees add column if not exists email_privat text;
alter table employees add column if not exists funktion text;
