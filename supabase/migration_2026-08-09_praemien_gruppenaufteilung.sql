-- Prämien → Gruppenaufteilung (Nutzer-Vorgabe 2026-08-09): Zugehörigkeit
-- zu den Prämien-Erfassungen ist unabhängig von den Stundenerfassungs-
-- Gruppen (employees.gruppe_nr, bleiben unverändert wichtig/unangetastet).
-- Eigene, einfache An/Aus-Flags je Kultur, damit Prämien → Zuckermais/
-- Erdbeeren/Spargel standardmäßig nur die tatsächlich zugeordneten
-- Mitarbeiter zeigen statt aller aktiven Personen.

alter table employees add column praemien_zuckermais boolean not null default false;
alter table employees add column praemien_erdbeeren boolean not null default false;
alter table employees add column praemien_spargel boolean not null default false;

-- Spalten-Grant erweitern, damit auch zeiterfassung/erntewirtschaft (nicht
-- nur admin/hr) diese Flags zum Filtern der Prämien-Erfassungsseiten lesen
-- können - gleiches Muster wie die übrigen, breit lesbaren Felder.
revoke select on employees from authenticated;
grant select (id, personal_nr, gruppe_nr, herkunft, nationalitaet, name, vorname,
  geburtsdatum, ort, land, stundenlohn, saison_beginn, saison_ende, aktiv,
  praemien_zuckermais, praemien_erdbeeren, praemien_spargel)
  on employees to authenticated;
