-- ============================================================================
-- Migration 2026-11-28: Rechte-Umbau Stufe 1 - Rechte-Katalog statt fester Rollen.
--
-- Nutzer-Vorgabe 2026-11-27 (docs/rechte-plan.md): Rollen sollen später in
-- der App frei einstellbar sein (je Funktion lesen / lesen & schreiben).
-- ERZEUGT von supabase/rechte/migration_erzeugen.py - nicht von Hand ändern.
--
--  1. recht_katalog (alle Funktionen), rolle (Rollen als Datensätze, die
--     bisherigen 10 als Startrollen + neu "Geschäftsführer"),
--     profil_rechte (je Nutzer vorberechnete Rechte, per Trigger aktuell).
--  2. profiles.role/rollen: Text statt festem Typ (Schlüssel aus rolle).
--     Die bisherigen Rollennamen bleiben -> die jetzige App läuft weiter.
--  3. ALLE Rollenprüfungen in Policies/Views/Funktionen werden auf
--     darf_any(array['funktion:L'|'funktion:S']) umgestellt. Die Zuordnung
--     ist so gewählt, dass jede Startrolle genau ihre bisherigen Rechte hat
--     (geprüft per Rechte-Matrix), bis auf die gewollten Bereinigungen:
--       - HR: kein Schreibrecht mehr auf Anbau (Felder/Sorten)
--       - Management: Stundenkonto-Auszahlungen nicht mehr umwandeln/stornieren
--       - Stand-Position setzen: wer Vertrieb pflegt (HR), nicht Management
--       - Lohnabrechnung: keine Kassenbücher/Einzahlungen mehr (nur die Liste
--         der Bücher für Vorschüsse)
--       - Bereiche nur noch laut Nutzer (Management/Prüfer nicht mehr
--         automatisch alle); Admin sieht alle
--       - Funktion rechnung_speichern (Rolle "buchhaltung" gibt es nicht) entfernt
--       - HR/Prüfer konnten Vorschuss-Empfänger löschen -> nur noch lesen
--       - Stundenerfassung darf eigene QS-Kontrollen/Strichlisten-Einträge löschen
--  4. Prüfung einmal je Abfrage: darf_any liest die vorberechnete Liste.
--  5. Am Ende Kontrolle: keine alte Rollenprüfung übrig, sonst bricht die
--     Migration komplett ab (nichts wird halb umgestellt).
--
-- In der Supabase SQL-Konsole ausführen (ein einziger Block).
-- ============================================================================

do $umbau$
declare
  z jsonb := $zuordnung${
 "funktion|abrechnung_fahrerkaution_korrigieren": {
  "admin,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S'])"
 },
 "funktion|abrechnung_korrigieren": {
  "admin,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S'])"
 },
 "funktion|abrechnung_verpflegung_korrigieren": {
  "admin,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S'])"
 },
 "funktion|abrechnung_zimmerkaution_korrigieren": {
  "admin,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S'])"
 },
 "funktion|arbeitskleidung_ausgabe_buchen": {
  "admin,hr,zeiterfassung": "public.darf_any(array['erfassung.kleidung:S'])"
 },
 "funktion|arbeitskleidung_ausgabe_stornieren": {
  "admin,hr,zeiterfassung": "public.darf_any(array['erfassung.kleidung:S'])"
 },
 "funktion|employee_beschaeftigung_abmelden": {
  "admin,hr": "public.darf_any(array['personal.sv:S'])"
 },
 "funktion|employee_beschaeftigung_anmelden": {
  "admin,hr": "public.darf_any(array['personal.sv:S'])"
 },
 "funktion|employee_jahre_verschieben": {
  "admin,hr": "public.darf_any(array['personal.verwaltung:S'])"
 },
 "funktion|employees_zusammenfuehren": {
  "admin,hr": "public.darf_any(array['personal.verwaltung:S'])"
 },
 "funktion|kandidat_buskosten_setzen": {
  "admin,hr": "public.darf_any(array['personal.planung:S'])"
 },
 "funktion|kassenbestand_bis": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "funktion|kassenbuch_buchen": {
  "admin,kasse": "public.darf_any(array['kasse.buecher:S'])"
 },
 "funktion|kassenbuch_buchung_stornieren": {
  "admin,kasse": "public.darf_any(array['kasse.buecher:S'])"
 },
 "funktion|kassenbuch_umbuchen": {
  "admin,kasse": "public.darf_any(array['kasse.buecher:S'])"
 },
 "funktion|lw_personal_nr_umnummerieren": {
  "admin,hr": "public.darf_any(array['personal.verwaltung:S'])"
 },
 "funktion|lw_stamm_ergaenzen": {
  "admin,hr": "public.darf_any(array['personal.verwaltung:S'])"
 },
 "funktion|naechste_belegnummer": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['kasse.buecher:S', 'lohn.auszahlungen:S', 'lohn.vorschuesse:S'])"
 },
 "funktion|saison_abrechnen_batch": {
  "admin,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S'])"
 },
 "funktion|saison_abrechnung_nachtrag_entfernen": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "funktion|saison_abrechnung_nachtragen": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "funktion|statuswechsel_stunden_uebertragen": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "funktion|stundenkonto_auszahlung_stornieren": {
  "admin,hr,lohnabrechnung,management": "public.darf_any(array['lohn.stundenkonto:S'])"
 },
 "funktion|stundenkonto_buchen": {
  "admin,hr,zeiterfassung": "public.darf_any(array['erfassung.stunden:S'])"
 },
 "funktion|stundenkonto_datum_setzen": {
  "admin,hr,lohnabrechnung,zeiterfassung": "public.darf_any(array['erfassung.stunden:S', 'lohn.stundenkonto:S'])"
 },
 "funktion|stundenkonto_in_auszahlung_umwandeln": {
  "admin,hr,lohnabrechnung,management": "public.darf_any(array['lohn.stundenkonto:S'])"
 },
 "funktion|unterkunft_vorgang_kind_schutz": {
  "admin": "public.darf_any(array['einstellungen.grund:S'])"
 },
 "funktion|unterkunft_vorgang_schutz": {
  "admin": "public.darf_any(array['einstellungen.grund:S'])"
 },
 "funktion|vorschuss_korrigieren": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.vorschuesse:S'])"
 },
 "funktion|vt_stand_position_setzen": {
  "admin,management": "public.vt_darf(true)"
 },
 "policy|advance_recipients|advance_recipients_rw|check": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.vorschuesse:S'])"
 },
 "policy|advance_recipients|advance_recipients_rw|using": {
  "admin,hr,kasse,lohnabrechnung,pruefer": "public.darf_any(array['lohn.vorschuesse:S'])"
 },
 "policy|advances|advances_select|using": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "policy|advances|advances_update|using": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.vorschuesse:S'])"
 },
 "policy|advances|advances_write|check": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.vorschuesse:S'])"
 },
 "policy|arbeitsgruppen|arbeitsgruppen_write|check": {
  "admin,zeiterfassung": "public.darf_any(array['erfassung.gruppen:S'])"
 },
 "policy|arbeitsgruppen|arbeitsgruppen_write|using": {
  "admin,zeiterfassung": "public.darf_any(array['erfassung.gruppen:S'])"
 },
 "policy|arbeitstage_bearbeitung_lock|arbeitstage_lock_write|check": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|arbeitstage_bearbeitung_lock|arbeitstage_lock_write|using": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|audit_log|audit_log_select|using": {
  "admin,pruefer": "public.darf_any(array['sonder.protokoll:L'])"
 },
 "policy|auszahlungsbeleg_zeilen|auszahlungsbeleg_zeilen_select|using": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "policy|auszahlungsbelege|auszahlungsbelege_select|using": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "policy|cash_checks|cash_checks_select|using": {
  "admin,kasse,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'kasse.pruefung:L', 'sonder.kasse_freigeben:L'])"
 },
 "policy|cash_checks|cash_checks_update|using": {
  "admin,pruefer": "public.darf_any(array['sonder.kasse_freigeben:S'])"
 },
 "policy|cash_checks|cash_checks_write|check": {
  "admin,kasse": "public.darf_any(array['kasse.pruefung:S'])"
 },
 "policy|cash_deposits|cash_deposits_select|using": {
  "admin,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L'])"
 },
 "policy|cash_deposits|cash_deposits_update|using": {
  "admin,kasse": "public.darf_any(array['kasse.buecher:S'])"
 },
 "policy|cash_deposits|cash_deposits_write|check": {
  "admin,kasse": "public.darf_any(array['kasse.buecher:S'])"
 },
 "policy|doppelte_haushaltsfuehrung|doppelte_haushaltsfuehrung_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.lohnsteuer:S'])"
 },
 "policy|doppelte_haushaltsfuehrung|doppelte_haushaltsfuehrung_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.lohnsteuer:S'])"
 },
 "policy|einsatzbereich_zeitraum|einsatzbereich_zeitraum_write|check": {
  "admin,hr": "public.darf_any(array['einstellungen.einsatzbereiche:S'])"
 },
 "policy|einsatzbereich_zeitraum|einsatzbereich_zeitraum_write|using": {
  "admin,hr": "public.darf_any(array['einstellungen.einsatzbereiche:S'])"
 },
 "policy|einsatzbereiche|einsatzbereiche_write|check": {
  "admin,hr": "public.darf_any(array['einstellungen.einsatzbereiche:S'])"
 },
 "policy|einsatzbereiche|einsatzbereiche_write|using": {
  "admin,hr": "public.darf_any(array['einstellungen.einsatzbereiche:S'])"
 },
 "policy|employee_abzug_ausnahme|employee_abzug_ausnahme_select|using": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.uebersicht:L'])"
 },
 "policy|employee_abzug_ausnahme|employee_abzug_ausnahme_write|check": {
  "admin,hr,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S', 'personal.stamm:S'])"
 },
 "policy|employee_abzug_ausnahme|employee_abzug_ausnahme_write|using": {
  "admin,hr,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S', 'personal.stamm:S'])"
 },
 "policy|employee_beschaeftigungsabschnitte|employee_beschaeftigungsabschnitte_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.sv:S'])"
 },
 "policy|employee_beschaeftigungsabschnitte|employee_beschaeftigungsabschnitte_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.sv:S'])"
 },
 "policy|employee_documents|employee_documents_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.dokumente:S'])"
 },
 "policy|employee_documents|employee_documents_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.dokumente:S'])"
 },
 "policy|employee_saison_praesenz|employee_saison_praesenz_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|employee_saison_praesenz|employee_saison_praesenz_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|employee_saison|employee_saison_write|check": {
  "admin,hr,lohnabrechnung": "public.darf_any(array['lohn.saison:S', 'personal.stamm:S'])"
 },
 "policy|employee_saison|employee_saison_write|using": {
  "admin,hr,lohnabrechnung": "public.darf_any(array['lohn.saison:S', 'personal.stamm:S'])"
 },
 "policy|employees|employees_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|employees|employees_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|erdbeeren_bestellung|erdbeeren_bestellung_write|check": {
  "admin,erntewirtschaft": "public.darf_any(array['ernte.bestellung:S'])"
 },
 "policy|erdbeeren_bestellung|erdbeeren_bestellung_write|using": {
  "admin,erntewirtschaft": "public.darf_any(array['ernte.bestellung:S'])"
 },
 "policy|erdbeeren_rohdaten|erdbeeren_rohdaten_delete|using": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.praemien:S'])"
 },
 "policy|erdbeeren_rohdaten|erdbeeren_rohdaten_update|using": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.praemien:S'])"
 },
 "policy|erdbeeren_rohdaten|erdbeeren_rohdaten_write|check": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.praemien:S'])"
 },
 "policy|ernte_ausweis_druck|ernte_ausweis_druck_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['ernte.ausweise:S'])"
 },
 "policy|ernte_ausweis_druck|ernte_ausweis_druck_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['ernte.ausweise:S'])"
 },
 "policy|ernte_ausweis|ernte_ausweis_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['ernte.ausweise:S'])"
 },
 "policy|ernte_ausweis|ernte_ausweis_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['ernte.ausweise:S'])"
 },
 "policy|ernte_kiste_zyklus|ernte_kiste_zyklus_select|using": {
  "admin,erntewirtschaft,hr,management,waage,zeiterfassung": "public.darf_any(array['ernte.ernte:L', 'ernte.waage:L', 'sonder.waage_kiosk:L'])"
 },
 "policy|ernte_kiste_zyklus|ernte_kiste_zyklus_update|check": {
  "admin,hr": "public.darf_any(array['ernte.ernte:S'])"
 },
 "policy|ernte_kiste_zyklus|ernte_kiste_zyklus_update|using": {
  "admin,hr": "public.darf_any(array['ernte.ernte:S'])"
 },
 "policy|ernte_konfig|ernte_konfig_select|using": {
  "admin,erntewirtschaft,hr,management,zeiterfassung": "public.darf_any(array['einstellungen.grund:L', 'ernte.ernte:L'])"
 },
 "policy|ernte_konfig|ernte_konfig_write|check": {
  "admin": "public.darf_any(array['einstellungen.grund:S'])"
 },
 "policy|ernte_konfig|ernte_konfig_write|using": {
  "admin": "public.darf_any(array['einstellungen.grund:S'])"
 },
 "policy|ernte_maschine|ernte_maschine_select|using": {
  "admin,erntewirtschaft,hr,management,zeiterfassung": "public.darf_any(array['ernte.ernte:L', 'ernte.maschinen:L'])"
 },
 "policy|ernte_maschine|ernte_maschine_write|check": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.maschinen:S'])"
 },
 "policy|ernte_maschine|ernte_maschine_write|using": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.maschinen:S'])"
 },
 "policy|ernte_poller_state|ernte_poller_state_select|using": {
  "admin,erntewirtschaft,hr,management,zeiterfassung": "public.darf_any(array['ernte.ernte:L', 'ernte.maschinen:L'])"
 },
 "policy|ernte_position|ernte_position_select|using": {
  "admin,erntewirtschaft,hr,management,zeiterfassung": "public.darf_any(array['ernte.ernte:L', 'ernte.maschinen:L'])"
 },
 "policy|ernte_scan|ernte_scan_select|using": {
  "admin,erntewirtschaft,hr,management,zeiterfassung": "public.darf_any(array['ernte.ernte:L', 'ernte.waage:L'])"
 },
 "policy|ernte_schicht|ernte_schicht_select|using": {
  "admin,erntewirtschaft,hr,management,zeiterfassung": "public.darf_any(array['ernte.ernte:L', 'ernte.waage:L'])"
 },
 "policy|ernte_schicht|ernte_schicht_update|check": {
  "admin,hr": "public.darf_any(array['ernte.ernte:S'])"
 },
 "policy|ernte_schicht|ernte_schicht_update|using": {
  "admin,hr": "public.darf_any(array['ernte.ernte:S'])"
 },
 "policy|ernte_tag|ernte_tag_select|using": {
  "admin,erntewirtschaft,hr,management,zeiterfassung": "public.darf_any(array['ernte.ernte:L'])"
 },
 "policy|ernte_tag|ernte_tag_write|check": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.ernte:S', 'ernte.praemien:S'])"
 },
 "policy|ernte_tag|ernte_tag_write|using": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.ernte:S', 'ernte.praemien:S'])"
 },
 "policy|ernte_waage|ernte_waage_select|using": {
  "admin,erntewirtschaft,hr,management,waage,zeiterfassung": "public.darf_any(array['ernte.ernte:L', 'ernte.waage:L', 'ernte.waagen:L', 'sonder.waage_kiosk:L'])"
 },
 "policy|ernte_waage|ernte_waage_write|check": {
  "admin,hr": "public.darf_any(array['ernte.waage:S', 'ernte.waagen:S'])"
 },
 "policy|ernte_waage|ernte_waage_write|using": {
  "admin,hr": "public.darf_any(array['ernte.waage:S', 'ernte.waagen:S'])"
 },
 "policy|fahrzeug_arbeitszeit|fahrzeug_arbeitszeit_select|using": {
  "admin,hr,management": "public.darf_any(array['fahrzeuge.stammdaten:L', 'fahrzeuge.uebersicht:L'])"
 },
 "policy|fahrzeug_arbeitszeit|fahrzeug_arbeitszeit_write|check": {
  "admin,hr": "public.darf_any(array['fahrzeuge.stammdaten:S'])"
 },
 "policy|fahrzeug_arbeitszeit|fahrzeug_arbeitszeit_write|using": {
  "admin,hr": "public.darf_any(array['fahrzeuge.stammdaten:S'])"
 },
 "policy|fahrzeug_ereignis|fahrzeug_ereignis_select|using": {
  "admin,hr,management": "public.darf_any(array['fahrzeuge.uebersicht:L'])"
 },
 "policy|fahrzeug_geofence|fahrzeug_geofence_select|using": {
  "admin,hr,management": "public.darf_any(array['fahrzeuge.stammdaten:L', 'fahrzeuge.uebersicht:L'])"
 },
 "policy|fahrzeug_geofence|fahrzeug_geofence_write|check": {
  "admin,hr": "public.darf_any(array['fahrzeuge.stammdaten:S'])"
 },
 "policy|fahrzeug_geofence|fahrzeug_geofence_write|using": {
  "admin,hr": "public.darf_any(array['fahrzeuge.stammdaten:S'])"
 },
 "policy|fahrzeug_poller_state|fahrzeug_poller_state_select|using": {
  "admin,hr,management": "public.darf_any(array['fahrzeuge.uebersicht:L'])"
 },
 "policy|fahrzeug_position|fahrzeug_position_select|using": {
  "admin,hr,management": "public.darf_any(array['fahrzeuge.uebersicht:L'])"
 },
 "policy|fahrzeug_tracker|fahrzeug_tracker_select|using": {
  "admin,hr,management": "public.darf_any(array['fahrzeuge.stammdaten:L', 'fahrzeuge.uebersicht:L'])"
 },
 "policy|fahrzeug_tracker|fahrzeug_tracker_write|check": {
  "admin,hr": "public.darf_any(array['fahrzeuge.stammdaten:S'])"
 },
 "policy|fahrzeug_tracker|fahrzeug_tracker_write|using": {
  "admin,hr": "public.darf_any(array['fahrzeuge.stammdaten:S'])"
 },
 "policy|fahrzeug|fahrzeug_select|using": {
  "admin,hr,management": "public.darf_any(array['fahrzeuge.stammdaten:L', 'fahrzeuge.uebersicht:L'])"
 },
 "policy|fahrzeug|fahrzeug_write|check": {
  "admin,hr": "public.darf_any(array['fahrzeuge.stammdaten:S'])"
 },
 "policy|fahrzeug|fahrzeug_write|using": {
  "admin,hr": "public.darf_any(array['fahrzeuge.stammdaten:S'])"
 },
 "policy|feld_anbau_abschnitt|feld_anbau_abschnitt_write|check": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.anbau:S'])"
 },
 "policy|feld_anbau_abschnitt|feld_anbau_abschnitt_write|using": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.anbau:S'])"
 },
 "policy|feld_anbau|feld_anbau_write|check": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.anbau:S'])"
 },
 "policy|feld_anbau|feld_anbau_write|using": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.anbau:S'])"
 },
 "policy|feld|feld_write|check": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.anbau:S'])"
 },
 "policy|feld|feld_write|using": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.anbau:S'])"
 },
 "policy|firmen_bankdaten|firmen_bankdaten_select|using": {
  "admin,hr,kasse": "public.darf_any(array['einstellungen.grund:L', 'kasse.buecher:S', 'personal.stamm:S'])"
 },
 "policy|firmenhandy|firmenhandy_select|using": {
  "admin,hr,management": "public.darf_any(array['fahrzeuge.uebersicht:L', 'personal.handys:L'])"
 },
 "policy|firmenhandy|firmenhandy_write|check": {
  "admin,hr": "public.darf_any(array['personal.handys:S'])"
 },
 "policy|firmenhandy|firmenhandy_write|using": {
  "admin,hr": "public.darf_any(array['personal.handys:S'])"
 },
 "policy|kassenbewegungen|kassenbewegungen_select|using": {
  "admin,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L'])"
 },
 "policy|kassenbuch_buchung|kassenbuch_buchung_select|using": {
  "admin,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L'])"
 },
 "policy|kassenbuch|kassenbuch_select|using": {
  "admin,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:S', 'lohn.vorschuesse:S'])"
 },
 "policy|kautionsuebergabe_personen|kautionsuebergabe_personen_select|using": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "policy|kautionsuebergabe_personen|kautionsuebergabe_personen_write|check": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S', 'lohn.vorschuesse:S'])"
 },
 "policy|kautionsuebergaben|kautionsuebergaben_select|using": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "policy|kautionsuebergaben|kautionsuebergaben_update|using": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S', 'lohn.vorschuesse:S'])"
 },
 "policy|kautionsuebergaben|kautionsuebergaben_write|check": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S', 'lohn.vorschuesse:S'])"
 },
 "policy|kleidung_ausgaben|kleidung_ausgaben_select|using": {
  "admin,hr,lohnabrechnung,management,zeiterfassung": "public.darf_any(array['controlling:L', 'erfassung.kleidung:L', 'lohn.uebersicht:S'])"
 },
 "policy|kleidung_lagerbestand|kleidung_lagerbestand_select|using": {
  "admin,hr": "public.darf_any(array['erfassung.lager:L'])"
 },
 "policy|kleidung_lagerbestand|kleidung_lagerbestand_write|check": {
  "admin,hr": "public.darf_any(array['erfassung.lager:S'])"
 },
 "policy|kleidung_lagerbestand|kleidung_lagerbestand_write|using": {
  "admin,hr": "public.darf_any(array['erfassung.lager:S'])"
 },
 "policy|lohnsteuerantrag_position|lohnsteuerantrag_position_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.lohnsteuer:S'])"
 },
 "policy|lohnsteuerantrag_position|lohnsteuerantrag_position_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.lohnsteuer:S'])"
 },
 "policy|lohnsteuerantrag|lohnsteuerantrag_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.lohnsteuer:S'])"
 },
 "policy|lohnsteuerantrag|lohnsteuerantrag_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.lohnsteuer:S'])"
 },
 "policy|objects|mitarbeiter_dokumente_storage_admin_hr|check": {
  "admin,hr": "public.darf_any(array['personal.dokumente:S'])"
 },
 "policy|objects|mitarbeiter_dokumente_storage_admin_hr|using": {
  "admin,hr": "public.darf_any(array['personal.dokumente:S'])"
 },
 "policy|objects|mitarbeiter_fotos_storage_select|using": {
  "admin,erntewirtschaft,hr,management,waage,zeiterfassung": "public.darf_any(array['ernte.ernte:L', 'personal.stamm:L', 'sonder.waage_kiosk:L'])"
 },
 "policy|objects|mitarbeiter_fotos_storage_write|check": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|objects|mitarbeiter_fotos_storage_write|using": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|objects|unterkunft_fotos_storage_write|check": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.maengel:S'])"
 },
 "policy|objects|unterkunft_fotos_storage_write|using": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.maengel:S'])"
 },
 "policy|objects|vorschuss_belege_storage_delete|using": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.belege:S'])"
 },
 "policy|objects|vorschuss_belege_storage_insert|check": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.belege:S'])"
 },
 "policy|objects|vorschuss_belege_storage_select|using": {
  "admin,hr,kasse,lohnabrechnung,pruefer": "public.darf_any(array['lohn.belege:L'])"
 },
 "policy|periods|periods_write|check": {
  "admin,hr": "public.darf_any(array['einstellungen.saisons:S'])"
 },
 "policy|periods|periods_write|using": {
  "admin,hr": "public.darf_any(array['einstellungen.saisons:S'])"
 },
 "policy|personal_kandidaten|personal_kandidaten_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.planung:S'])"
 },
 "policy|personal_kandidaten|personal_kandidaten_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.planung:S'])"
 },
 "policy|qs_kontrolle|qs_kontrolle_delete|using": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.qualitaet:S'])"
 },
 "policy|qs_kontrolle|qs_kontrolle_insert|check": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.qualitaet:S'])"
 },
 "policy|qs_kontrolle|qs_kontrolle_update|using": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.qualitaet:S'])"
 },
 "policy|saison_abrechnungen|saison_abrechnungen_select|using": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "policy|schulung_teilnahme|schulung_teilnahme_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|schulung_teilnahme|schulung_teilnahme_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.stamm:S'])"
 },
 "policy|season_bonuses|season_bonuses_rw|check": {
  "admin,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S'])"
 },
 "policy|season_bonuses|season_bonuses_rw|using": {
  "admin,lohnabrechnung": "public.darf_any(array['lohn.uebersicht:S'])"
 },
 "policy|sepa_export|sepa_export_select|using": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "policy|sepa_export|sepa_export_write|check": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.auszahlungen:S'])"
 },
 "policy|sepa_export|sepa_export_write|using": {
  "admin,kasse,lohnabrechnung": "public.darf_any(array['lohn.auszahlungen:S'])"
 },
 "policy|spargel_sorte|spargel_sorte_write|check": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.anbau:S'])"
 },
 "policy|spargel_sorte|spargel_sorte_write|using": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.anbau:S'])"
 },
 "policy|stundenkonto_bewegungen|stundenkonto_bewegungen_select|using": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer,zeiterfassung": "public.darf_any(array['controlling:L', 'erfassung.stunden:L', 'lohn.auszahlungen:L', 'lohn.stundenkonto:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "policy|sv_fragebogen_vorbeschaeftigung|sv_fragebogen_vorbeschaeftigung_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.sv:S'])"
 },
 "policy|sv_fragebogen_vorbeschaeftigung|sv_fragebogen_vorbeschaeftigung_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.sv:S'])"
 },
 "policy|sv_fragebogen|sv_fragebogen_admin_hr_all|check": {
  "admin,hr": "public.darf_any(array['personal.sv:S'])"
 },
 "policy|sv_fragebogen|sv_fragebogen_admin_hr_all|using": {
  "admin,hr": "public.darf_any(array['personal.sv:S'])"
 },
 "policy|unterkunft_belastung|unterkunft_belastung_delete|using": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S'])"
 },
 "policy|unterkunft_belastung|unterkunft_belastung_insert|check": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S'])"
 },
 "policy|unterkunft_belastung|unterkunft_belastung_select|using": {
  "admin,hausmeister,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['unterkunft.kosten:L'])"
 },
 "policy|unterkunft_belastung|unterkunft_belastung_update|check": {
  "admin,hr,kasse": "public.darf_any(array['unterkunft.kosten:S'])"
 },
 "policy|unterkunft_belastung|unterkunft_belastung_update|using": {
  "admin,hr,kasse": "public.darf_any(array['unterkunft.kosten:S'])"
 },
 "policy|unterkunft_belegung|unterkunft_belegung_write|check": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S'])"
 },
 "policy|unterkunft_belegung|unterkunft_belegung_write|using": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S'])"
 },
 "policy|unterkunft_checkliste_vorlage|unterkunft_checkliste_vorlage_write|check": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_checkliste_vorlage|unterkunft_checkliste_vorlage_write|using": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_foto|unterkunft_foto_write|check": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S', 'unterkunft.kontrollen:S', 'unterkunft.maengel:S'])"
 },
 "policy|unterkunft_foto|unterkunft_foto_write|using": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S', 'unterkunft.kontrollen:S', 'unterkunft.maengel:S'])"
 },
 "policy|unterkunft_gebaeude|unterkunft_gebaeude_write|check": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_gebaeude|unterkunft_gebaeude_write|using": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_herkunft_kontingent|unterkunft_herkunft_kontingent_select|using": {
  "admin,hausmeister,hr,management": "public.darf_any(array['controlling:L', 'unterkunft.planung:L'])"
 },
 "policy|unterkunft_herkunft_kontingent|unterkunft_herkunft_kontingent_write|check": {
  "admin,hr": "public.darf_any(array['unterkunft.planung:S'])"
 },
 "policy|unterkunft_herkunft_kontingent|unterkunft_herkunft_kontingent_write|using": {
  "admin,hr": "public.darf_any(array['unterkunft.planung:S'])"
 },
 "policy|unterkunft_herkunft_plan|unterkunft_herkunft_plan_select|using": {
  "admin,hr,management": "public.darf_any(array['controlling:L'])"
 },
 "policy|unterkunft_herkunft_plan|unterkunft_herkunft_plan_write|check": {
  "admin,hr": "public.darf_any(array['unterkunft.planung:S'])"
 },
 "policy|unterkunft_herkunft_plan|unterkunft_herkunft_plan_write|using": {
  "admin,hr": "public.darf_any(array['unterkunft.planung:S'])"
 },
 "policy|unterkunft_kontroll_intervall|unterkunft_kontroll_intervall_write|check": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_kontroll_intervall|unterkunft_kontroll_intervall_write|using": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_mangel|unterkunft_mangel_write|check": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.maengel:S'])"
 },
 "policy|unterkunft_mangel|unterkunft_mangel_write|using": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.maengel:S'])"
 },
 "policy|unterkunft_vorgang_position|unterkunft_vorgang_position_write|check": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S', 'unterkunft.kontrollen:S', 'unterkunft.maengel:S'])"
 },
 "policy|unterkunft_vorgang_position|unterkunft_vorgang_position_write|using": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S', 'unterkunft.kontrollen:S', 'unterkunft.maengel:S'])"
 },
 "policy|unterkunft_vorgang|unterkunft_vorgang_write|check": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S', 'unterkunft.kontrollen:S', 'unterkunft.maengel:S'])"
 },
 "policy|unterkunft_vorgang|unterkunft_vorgang_write|using": {
  "admin,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:S', 'unterkunft.kontrollen:S', 'unterkunft.maengel:S'])"
 },
 "policy|unterkunft_wohneinheit|unterkunft_wohneinheit_write|check": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_wohneinheit|unterkunft_wohneinheit_write|using": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_zimmer|unterkunft_zimmer_write|check": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_zimmer|unterkunft_zimmer_write|using": {
  "admin,hr": "public.darf_any(array['unterkunft.immobilien:S'])"
 },
 "policy|unterkunft_zuordnung|unterkunft_zuordnung_hausmeister_abschluss|check": {
  "hausmeister": "public.darf_any(array['unterkunft.belegung:S'])"
 },
 "policy|unterkunft_zuordnung|unterkunft_zuordnung_hausmeister_abschluss|using": {
  "hausmeister": "public.darf_any(array['unterkunft.belegung:S'])"
 },
 "policy|unterkunft_zuordnung|unterkunft_zuordnung_write|check": {
  "admin,hr": "public.darf_any(array['unterkunft.zuweisen:S'])"
 },
 "policy|unterkunft_zuordnung|unterkunft_zuordnung_write|using": {
  "admin,hr": "public.darf_any(array['unterkunft.zuweisen:S'])"
 },
 "policy|work_entries|work_entries_select|using": {
  "admin,erntewirtschaft,hr,kasse,lohnabrechnung,management,pruefer,zeiterfassung": "public.darf_any(array['controlling:L', 'erfassung.stunden:L', 'ernte.ernte:L', 'ernte.praemien:L', 'ernte.qualitaet:L', 'ernte.statistik:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "policy|work_entries|work_entries_update|using": {
  "admin,hr,zeiterfassung": "public.darf_any(array['erfassung.stunden:S'])"
 },
 "policy|work_entries|work_entries_write|check": {
  "admin,hr,zeiterfassung": "public.darf_any(array['erfassung.stunden:S'])"
 },
 "policy|zuckermais_annahme|zuckermais_annahme_delete|using": {
  "admin,erntewirtschaft,hr": "public.darf_any(array['ernte.qualitaet:S'])"
 },
 "policy|zuckermais_annahme|zuckermais_annahme_insert|check": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.qualitaet:S'])"
 },
 "policy|zuckermais_annahme|zuckermais_annahme_update|using": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.qualitaet:S'])"
 },
 "policy|zuckermais_druck|zuckermais_druck_write|check": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.praemien:S'])"
 },
 "policy|zuckermais_druck|zuckermais_druck_write|using": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.praemien:S'])"
 },
 "policy|zuckermais_rohdaten|zuckermais_rohdaten_delete|using": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.praemien:S'])"
 },
 "policy|zuckermais_rohdaten|zuckermais_rohdaten_update|using": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.praemien:S'])"
 },
 "policy|zuckermais_rohdaten|zuckermais_rohdaten_write|check": {
  "admin,erntewirtschaft,hr,zeiterfassung": "public.darf_any(array['ernte.praemien:S'])"
 },
 "view|anreiseliste_offen_arbeitend": {
  "admin,hr,management": "public.darf_any(array['controlling:L', 'personal.planung:L'])"
 },
 "view|auszahlungsbeleg_summary": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "view|employee_auslagen_historie": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['controlling:L', 'kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "view|employee_bankdaten": {
  "admin,hr,kasse,lohnabrechnung": "public.darf_any(array['personal.bank:L'])"
 },
 "view|employee_lohndaten": {
  "admin,hr,lohnabrechnung,management": "public.darf_any(array['controlling:L', 'lohn.uebersicht:S', 'personal.stamm:S'])"
 },
 "view|employee_personaldaten": {
  "admin,hr": "public.darf_any(array['personal.persoenlich:L'])"
 },
 "view|employee_sv_pruefung": {
  "admin,hr,management": "public.darf_any(array['controlling:L', 'personal.sv:L'])"
 },
 "view|employee_vorschuss_historie": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.belege:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])",
  "admin,hr,kasse,lohnabrechnung,pruefer": "public.darf_any(array['lohn.belege:L'])"
 },
 "view|erdbeeren_gruppenkosten_tag": {
  "admin,erntewirtschaft,hr,lohnabrechnung,management": "public.darf_any(array['ernte.statistik:L'])"
 },
 "view|erdbeeren_statistik_tag": {
  "admin,erntewirtschaft,hr,lohnabrechnung,management": "public.darf_any(array['ernte.statistik:L'])"
 },
 "view|season_summary": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['controlling:L', 'kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "view|season_summary_monat": {
  "admin,hr,kasse,lohnabrechnung,management,pruefer": "public.darf_any(array['controlling:L', 'kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L'])"
 },
 "view|unterkunft_auszug_offen": {
  "admin,erntewirtschaft,hausmeister,hr": "public.darf_any(array['unterkunft.belegung:L'])"
 },
 "view|zuckermais_statistik_tag": {
  "admin,erntewirtschaft,hr,lohnabrechnung,management": "public.darf_any(array['ernte.statistik:L'])"
 }
}$zuordnung$::jsonb;
  ziel jsonb;
  p record;
  m text[];
  t text;
  v_using text;
  v_check text;
  v_sql text;
  v_key text;
  v_rest text;
  v_anzahl int := 0;
begin
  -- 1) Katalog --------------------------------------------------------------------
  create table if not exists public.recht_katalog (
    id text primary key,
    modul text not null,
    titel text not null,
    unter text not null default '',
    sensibel boolean not null default false,
    nur_lesen boolean not null default false,
    sortierung int not null default 0
  );
  insert into public.recht_katalog (id, modul, titel, unter, sensibel, nur_lesen, sortierung) values
      ('personal.planung', 'Personal', 'Planung & Anreiseliste', 'Personalplanung, Platzhalter, Anreiseliste, Buskosten', false, false, 0),
      ('personal.stamm', 'Personal', 'Personalstamm', 'Stammkarte, Status, Saisons, Firma/Bereich', false, false, 1),
      ('personal.persoenlich', 'Personal', 'Persönliche Daten', 'Adresse, Geburtsdatum, Ausweis, Familienstand', true, false, 2),
      ('personal.bank', 'Personal', 'Bankverbindung', 'IBAN für Überweisungen', true, false, 3),
      ('personal.sv', 'Personal', 'Sozialversicherung', 'SV-Prüfung, SV-Fragebogen, An-/Abmeldung, Beschäftigungsabschnitte', true, false, 4),
      ('personal.lohnsteuer', 'Personal', 'Lohnsteuer', 'Doppelte Haushaltsführung, Antrag ans Finanzamt', true, false, 5),
      ('personal.dokumente', 'Personal', 'Dokumente', 'Hochgeladene Ausweise, Urkunden, Verträge', true, false, 6),
      ('personal.verwaltung', 'Personal', 'Personalnummern, Import, Zusammenführen', 'Nummern vergeben, Listen einlesen, Dubletten zusammenlegen', false, false, 7),
      ('personal.handys', 'Personal', 'Firmenhandys', '', false, false, 8),
      ('unterkunft.immobilien', 'Unterkunft', 'Immobilien & Stammdaten', 'Gebäude, Wohnungen, Zimmer, Grundrisse, Checklisten, Kontrollintervalle', false, false, 9),
      ('unterkunft.zuweisen', 'Unterkunft', 'Zimmer zuweisen', 'Personen auf Zimmer verteilen, Einzüge planen', false, false, 10),
      ('unterkunft.belegung', 'Unterkunft', 'Belegung', 'Belegungsplan, Einzug, Auszüge, Übergabe/Abnahme', false, false, 11),
      ('unterkunft.kontrollen', 'Unterkunft', 'Kontrollen', 'Kontrollplan, Zwischenkontrolle', false, false, 12),
      ('unterkunft.maengel', 'Unterkunft', 'Mängel & Reparaturen', 'Mängel melden, Fotos, Reparaturen erledigen', false, false, 13),
      ('unterkunft.planung', 'Unterkunft', 'Herkunfts-Planung', 'Betten-Kontingente je Herkunft', false, false, 14),
      ('unterkunft.kosten', 'Unterkunft', 'Kosten an Bewohner', 'Schäden/Belastungen, die vom Lohn abgezogen werden', false, false, 15),
      ('erfassung.stunden', 'Stundenerfassung', 'Stunden erfassen', 'Erfassung, Wochenansicht, Import, Stundenkonto buchen', false, false, 16),
      ('erfassung.kleidung', 'Stundenerfassung', 'Arbeitskleidung', 'Ausgabe buchen und stornieren', false, false, 17),
      ('erfassung.lager', 'Stundenerfassung', 'Kleidungslager', 'Bestand pflegen', false, false, 18),
      ('erfassung.gruppen', 'Stundenerfassung', 'Arbeitsgruppen', 'Gruppen anlegen und Personen zuordnen', false, false, 19),
      ('lohn.uebersicht', 'Lohn', 'Lohnübersicht & Abrechnung', 'Netto, Buskosten, Kautionen, Prämien-Boni, Abzüge, Abrechnen, Korrekturen, Monatsdruck', false, false, 20),
      ('lohn.saison', 'Lohn', 'Saison-Zuordnung', 'Firma/Bereich je Saison, Saison nachtragen', false, false, 21),
      ('lohn.vorschuesse', 'Lohn', 'Vorschüsse', 'Erfassen, stornieren, korrigieren', false, false, 22),
      ('lohn.belege', 'Lohn', 'Vorschuss-Belege', 'Fotos der Quittungen zu Vorschüssen', true, false, 23),
      ('lohn.auszahlungen', 'Lohn', 'Auszahlungen & SEPA', 'Auszahlungsbelege, SEPA-Dateien je Firma', false, false, 24),
      ('lohn.stundenkonto', 'Lohn', 'Stundenkonto auszahlen', 'Saldo in Auszahlung umwandeln, stornieren', false, false, 25),
      ('kasse.buecher', 'Kassenbuch', 'Kassenbücher', 'Buchen, umbuchen, stornieren, Einzahlungen', false, false, 26),
      ('kasse.pruefung', 'Kassenbuch', 'Kassenprüfung', 'Zählen und Prüfung anlegen', false, false, 27),
      ('ernte.praemien', 'Erntewirtschaft', 'Prämien erfassen', 'Zuckermais, Spargel, Erdbeeren, Gruppenaufteilung, Strichliste drucken', false, false, 28),
      ('ernte.statistik', 'Erntewirtschaft', 'Statistik', 'Zuckermais, Spargel, Erdbeeren', false, true, 29),
      ('ernte.qualitaet', 'Erntewirtschaft', 'Qualität', 'Schichtkontrolle, Strichliste / Nacharbeit', false, false, 30),
      ('ernte.anbau', 'Erntewirtschaft', 'Anbau', 'Erdbeeren, Spargel, Übersicht, Ernteplanung, Felder, Sorten', false, false, 31),
      ('ernte.bestellung', 'Erntewirtschaft', 'Erdbeer-Bestellung', '', false, false, 32),
      ('ernte.ernte', 'Erntewirtschaft', 'Ernte & Überblick', 'Karte der Spinnen, Kisten, Schichten, Lücken nachtragen', false, false, 33),
      ('ernte.waage', 'Erntewirtschaft', 'Waage', 'Wiegungen ansehen', false, true, 34),
      ('ernte.maschinen', 'Erntewirtschaft', 'Maschinen', 'Spargelspinnen und Tracker zuordnen', false, false, 35),
      ('ernte.waagen', 'Erntewirtschaft', 'Waagen einrichten', '', false, false, 36),
      ('ernte.ausweise', 'Erntewirtschaft', 'Ernte-Ausweise', 'QR-Ausweise drucken (enthält Sicherheitscode)', true, false, 37),
      ('vertrieb.planung', 'Vertrieb', 'Vertriebsplanung', 'Stände, Karte, Touren, Verfügbarkeit, Grundplan, Woche, Tagesplan', false, false, 38),
      ('fahrzeuge.uebersicht', 'Fahrzeuge', 'Übersicht', 'Karte, Streckenverlauf, Hofzeiten & Alarme', false, true, 39),
      ('fahrzeuge.stammdaten', 'Fahrzeuge', 'Stammdaten', 'Fahrzeuge, Tracker, Hof-Zonen, Einstellungen', false, false, 40),
      ('controlling', 'Controlling', 'Controlling', 'Übersicht, Anreiseliste, SV, Stundenmonitoring, Arbeitstage am Stück, Auszahlungs-Abweichungen, Urlaub', false, true, 41),
      ('einstellungen.einsatzbereiche', 'Einstellungen', 'Einsatzbereiche', '', false, false, 42),
      ('einstellungen.saisons', 'Einstellungen', 'Saisons', 'Saisons und Abrechnungszeiträume anlegen', false, false, 43),
      ('einstellungen.grund', 'Einstellungen', 'Sätze, Firmen & Grundeinstellungen', 'Prämien- und Verpflegungssätze, Firmen mit Bankdaten, Geschäftsbereiche, Herkünfte, Ernte- und Kassenprüfungs-Einstellungen', false, false, 44),
      ('sonder.kasse_freigeben', 'Sonderrechte', 'Kassenprüfung freigeben', 'Nie die eigene (Vier-Augen-Prinzip)', false, false, 45),
      ('sonder.protokoll', 'Sonderrechte', 'Änderungsprotokoll einsehen', '', true, false, 46),
      ('sonder.waage_kiosk', 'Sonderrechte', 'Waagen-Bildschirm', 'Kiosk an der Hofwaage', false, false, 47)
  on conflict (id) do update set modul = excluded.modul, titel = excluded.titel, unter = excluded.unter,
    sensibel = excluded.sensibel, nur_lesen = excluded.nur_lesen, sortierung = excluded.sortierung;

  -- 2) Rollen ---------------------------------------------------------------------
  create table if not exists public.rolle (
    id text primary key check (id ~ '^[a-z0-9_]+$'),
    bezeichnung text not null unique,
    beschreibung text not null default '',
    rechte jsonb not null default '{}' check (jsonb_typeof(rechte) = 'object'),
    alle_rechte boolean not null default false,
    -- Administrator: fest, nicht bearbeitbar, verwaltet Nutzer/Rollen/Vorschläge
    system_admin boolean not null default false,
    -- Bereiche der Rolle (LW/VT) - ab Stufe 2 (Rollen-Editor) maßgeblich,
    -- bis dahin gelten die Bereiche am Nutzer (profiles.bereiche).
    bereiche text[] not null default '{}',
    sortierung int not null default 100,
    erstellt_am timestamptz not null default now()
  );
  insert into public.rolle (id, bezeichnung, beschreibung, rechte, alle_rechte, system_admin, sortierung) values
      ('admin', 'Administrator', 'Voller Zugriff, Nutzer und Rollen verwalten, Vorschläge.', '{}'::jsonb, true, true, 0),
      ('geschaeftsfuehrer', 'Geschäftsführer', 'Alles wie Administrator, außer Nutzer anlegen, Rollen ändern/vergeben und Änderungsvorschläge ansehen.', '{}'::jsonb, true, false, 1),
      ('hr', 'Personal (HR)', '', '{"personal.planung": "S", "personal.stamm": "S", "personal.persoenlich": "S", "personal.bank": "S", "personal.sv": "S", "personal.lohnsteuer": "S", "personal.dokumente": "S", "personal.verwaltung": "S", "personal.handys": "S", "unterkunft.immobilien": "S", "unterkunft.zuweisen": "S", "unterkunft.belegung": "S", "unterkunft.kontrollen": "S", "unterkunft.maengel": "S", "unterkunft.planung": "S", "unterkunft.kosten": "S", "erfassung.stunden": "S", "erfassung.kleidung": "S", "erfassung.lager": "S", "lohn.uebersicht": "L", "lohn.saison": "S", "lohn.vorschuesse": "L", "lohn.belege": "L", "lohn.auszahlungen": "L", "lohn.stundenkonto": "S", "ernte.praemien": "S", "ernte.statistik": "L", "ernte.qualitaet": "S", "ernte.ernte": "S", "ernte.waage": "L", "ernte.maschinen": "S", "ernte.waagen": "S", "ernte.ausweise": "S", "vertrieb.planung": "S", "fahrzeuge.uebersicht": "L", "fahrzeuge.stammdaten": "S", "controlling": "L", "einstellungen.einsatzbereiche": "S", "einstellungen.saisons": "S"}'::jsonb, false, false, 2),
      ('zeiterfassung', 'Stundenerfassung', '', '{"personal.stamm": "L", "erfassung.stunden": "S", "erfassung.kleidung": "S", "erfassung.gruppen": "S", "ernte.praemien": "S", "ernte.qualitaet": "S", "ernte.ernte": "L", "ernte.waage": "L", "ernte.maschinen": "S"}'::jsonb, false, false, 3),
      ('kasse', 'Kasse', '', '{"personal.bank": "L", "unterkunft.kosten": "S", "lohn.uebersicht": "L", "lohn.vorschuesse": "S", "lohn.belege": "S", "lohn.auszahlungen": "S", "kasse.buecher": "S", "kasse.pruefung": "S"}'::jsonb, false, false, 4),
      ('lohnabrechnung', 'Lohnabrechnung', '', '{"personal.bank": "L", "unterkunft.kosten": "L", "lohn.uebersicht": "S", "lohn.saison": "S", "lohn.vorschuesse": "S", "lohn.belege": "S", "lohn.auszahlungen": "S", "lohn.stundenkonto": "S", "ernte.praemien": "L", "ernte.statistik": "L", "ernte.qualitaet": "L", "vertrieb.planung": "L"}'::jsonb, false, false, 5),
      ('pruefer', 'Prüfer', '', '{"unterkunft.kosten": "L", "lohn.uebersicht": "L", "lohn.vorschuesse": "L", "lohn.belege": "L", "lohn.auszahlungen": "L", "kasse.buecher": "L", "kasse.pruefung": "L", "vertrieb.planung": "L", "sonder.kasse_freigeben": "S", "sonder.protokoll": "S"}'::jsonb, false, false, 6),
      ('management', 'Management', '', '{"unterkunft.kosten": "L", "lohn.uebersicht": "L", "lohn.vorschuesse": "L", "lohn.auszahlungen": "L", "kasse.buecher": "L", "kasse.pruefung": "L", "ernte.praemien": "L", "ernte.statistik": "L", "ernte.qualitaet": "L", "ernte.ernte": "L", "ernte.waage": "L", "vertrieb.planung": "L", "fahrzeuge.uebersicht": "L", "fahrzeuge.stammdaten": "L", "controlling": "L"}'::jsonb, false, false, 7),
      ('erntewirtschaft', 'Erntewirtschaft', '', '{"unterkunft.immobilien": "L", "unterkunft.belegung": "L", "unterkunft.kontrollen": "L", "unterkunft.maengel": "L", "ernte.praemien": "S", "ernte.statistik": "L", "ernte.qualitaet": "S", "ernte.anbau": "S", "ernte.bestellung": "S", "ernte.ernte": "L", "ernte.waage": "L", "ernte.maschinen": "S"}'::jsonb, false, false, 8),
      ('hausmeister', 'Hausmeister', '', '{"unterkunft.immobilien": "L", "unterkunft.belegung": "S", "unterkunft.maengel": "S", "unterkunft.planung": "L", "unterkunft.kosten": "L"}'::jsonb, false, false, 9),
      ('waage', 'Waage', '', '{"sonder.waage_kiosk": "S"}'::jsonb, false, false, 10)
  on conflict (id) do nothing;

  -- Rechte einer Rolle müssen im Katalog stehen (L/S)
  create or replace function public.rolle_pruefen() returns trigger language plpgsql as $f$
  declare k text; s text;
  begin
    for k, s in select * from jsonb_each_text(new.rechte) loop
      if not exists (select 1 from recht_katalog where id = k) then
        raise exception 'Unbekanntes Recht: %', k;
      end if;
      if s not in ('L', 'S') then
        raise exception 'Stufe muss L oder S sein (%: %)', k, s;
      end if;
    end loop;
    if tg_op = 'UPDATE' and old.system_admin and not new.system_admin then
      raise exception 'Die Rolle Administrator kann nicht geändert werden.';
    end if;
    if tg_op = 'UPDATE' and old.system_admin and (new.rechte <> old.rechte or new.alle_rechte <> old.alle_rechte) then
      raise exception 'Die Rolle Administrator kann nicht geändert werden.';
    end if;
    return new;
  end $f$;
  drop trigger if exists trg_rolle_pruefen on public.rolle;
  create trigger trg_rolle_pruefen before insert or update on public.rolle
    for each row execute function public.rolle_pruefen();

  create or replace function public.rolle_loeschen_pruefen() returns trigger language plpgsql as $f$
  begin
    if old.system_admin then
      raise exception 'Die Rolle Administrator kann nicht gelöscht werden.';
    end if;
    if exists (select 1 from profiles where old.id = any(rollen)) then
      raise exception 'Rolle "%" ist noch Nutzern zugewiesen.', old.bezeichnung;
    end if;
    return old;
  end $f$;
  drop trigger if exists trg_rolle_loeschen on public.rolle;
  create trigger trg_rolle_loeschen before delete on public.rolle
    for each row execute function public.rolle_loeschen_pruefen();

  drop trigger if exists trg_audit_rolle on public.rolle;
  create trigger trg_audit_rolle after insert or update or delete on public.rolle
    for each row execute function public.write_audit_log();

  -- 3) profiles: Rollen als Text --------------------------------------------------
  alter table public.profiles alter column role drop default;
  alter table public.profiles alter column rollen drop default;
  alter table public.profiles alter column role type text using role::text;
  alter table public.profiles alter column rollen type text[] using rollen::text[];
  alter table public.profiles alter column role set default 'zeiterfassung';
  alter table public.profiles alter column rollen set default '{}';

  create or replace function public.profiles_rollen_pruefen() returns trigger language plpgsql as $f$
  declare r text;
  begin
    foreach r in array new.rollen loop
      if not exists (select 1 from rolle where id = r) then
        raise exception 'Unbekannte Rolle: %', r;
      end if;
    end loop;
    return new;
  end $f$;
  drop trigger if exists trg_profiles_rollen_pruefen on public.profiles;
  create trigger trg_profiles_rollen_pruefen before insert or update of rollen, role on public.profiles
    for each row execute function public.profiles_rollen_pruefen();

  -- 4) Vorberechnete Rechte je Nutzer ---------------------------------------------
  create table if not exists public.profil_rechte (
    profile_id uuid primary key references public.profiles(id) on delete cascade,
    rechte text[] not null default '{}',
    bereiche text[] not null default '{}',
    admin boolean not null default false,
    -- hat mindestens eine Rolle (auch nur Waage)
    angemeldet boolean not null default false,
    -- Büro-Nutzer: hat ein Recht außer dem Waagen-Bildschirm
    buero boolean not null default false,
    berechnet_am timestamptz not null default now()
  );

  create or replace function public.profil_rechte_berechnen(p_id uuid default null)
  returns void language plpgsql security definer set search_path = public as $f$
  begin
    insert into profil_rechte (profile_id, rechte, bereiche, admin, angemeldet, buero, berechnet_am)
    select p.id,
      case when not p.aktiv then '{}'::text[] else coalesce((
        select array_agg(distinct x order by x) from (
          select k.id || ':' || s as x
          from rolle r cross join recht_katalog k cross join (values ('L'), ('S')) st(s)
          where r.id = any(p.rollen) and r.alle_rechte
          union
          select e.key || ':L' from rolle r, jsonb_each_text(r.rechte) e
          where r.id = any(p.rollen)
          union
          select e.key || ':S' from rolle r, jsonb_each_text(r.rechte) e
          where r.id = any(p.rollen) and e.value = 'S'
        ) a), '{}') end,
      case when not p.aktiv then '{}'::text[]
           when exists (select 1 from rolle r where r.id = any(p.rollen) and r.system_admin)
             then coalesce((select array_agg(kuerzel order by kuerzel) from geschaeftsbereich), '{}')
           else coalesce((select array_agg(b order by b) from unnest(p.bereiche) b
                          where b in (select kuerzel from geschaeftsbereich)), '{}') end,
      p.aktiv and exists (select 1 from rolle r where r.id = any(p.rollen) and r.system_admin),
      p.aktiv and cardinality(p.rollen) > 0,
      p.aktiv and exists (
        select 1 from rolle r where r.id = any(p.rollen)
          and (r.alle_rechte or exists (select 1 from jsonb_object_keys(r.rechte) k where k <> 'sonder.waage_kiosk'))),
      now()
    from profiles p
    where p_id is null or p.id = p_id
    on conflict (profile_id) do update set rechte = excluded.rechte, bereiche = excluded.bereiche,
      admin = excluded.admin, angemeldet = excluded.angemeldet, buero = excluded.buero,
      berechnet_am = excluded.berechnet_am;
  end $f$;
  revoke all on function public.profil_rechte_berechnen(uuid) from public, anon, authenticated;

  create or replace function public.profil_rechte_trigger_profil() returns trigger
  language plpgsql security definer set search_path = public as $f$
  begin
    perform profil_rechte_berechnen(new.id);
    return null;
  end $f$;
  drop trigger if exists trg_profil_rechte on public.profiles;
  create trigger trg_profil_rechte after insert or update of rollen, role, aktiv, bereiche on public.profiles
    for each row execute function public.profil_rechte_trigger_profil();

  create or replace function public.profil_rechte_trigger_alle() returns trigger
  language plpgsql security definer set search_path = public as $f$
  begin
    perform profil_rechte_berechnen(null);
    return null;
  end $f$;
  drop trigger if exists trg_profil_rechte_rolle on public.rolle;
  create trigger trg_profil_rechte_rolle after insert or update or delete on public.rolle
    for each statement execute function public.profil_rechte_trigger_alle();
  drop trigger if exists trg_profil_rechte_katalog on public.recht_katalog;
  create trigger trg_profil_rechte_katalog after insert or update or delete on public.recht_katalog
    for each statement execute function public.profil_rechte_trigger_alle();
  drop trigger if exists trg_profil_rechte_bereich on public.geschaeftsbereich;
  create trigger trg_profil_rechte_bereich after insert or update or delete on public.geschaeftsbereich
    for each statement execute function public.profil_rechte_trigger_alle();

  perform public.profil_rechte_berechnen(null);

  -- 5) Prüffunktionen ---------------------------------------------------------------
  create or replace function public.meine_rechte() returns public.profil_rechte
  language sql stable security definer set search_path = public as $f$
    select * from profil_rechte where profile_id = auth.uid()
  $f$;

  -- Hat der Aufrufer mindestens eines der Rechte ('funktion:L' / 'funktion:S')?
  create or replace function public.darf_any(p_rechte text[]) returns boolean
  language sql stable as $f$ select coalesce((public.meine_rechte()).rechte && p_rechte, false) $f$;

  create or replace function public.darf(p_recht text) returns boolean
  language sql stable as $f$ select public.darf_any(array[p_recht]) $f$;

  create or replace function public.is_admin() returns boolean
  language sql stable as $f$ select coalesce((public.meine_rechte()).admin, false) $f$;

  create or replace function public.hat_aktive_rolle() returns boolean
  language sql stable as $f$ select coalesce((public.meine_rechte()).angemeldet, false) $f$;

  create or replace function public.buero() returns boolean
  language sql stable as $f$ select coalesce((public.meine_rechte()).buero, false) $f$;

  create or replace function public.current_bereiche() returns text[]
  language sql stable security definer set search_path = public as $f$
    select case
      when p.bereich_ansicht is not null and p.bereich_ansicht = any(r.bereiche)
        then array[p.bereich_ansicht]
      else coalesce(r.bereiche, '{}')
    end
    from profiles p left join profil_rechte r on r.profile_id = p.id
    where p.id = auth.uid()
  $f$;

  create or replace function public.vt_darf(p_schreiben boolean default false) returns boolean
  language sql stable security definer set search_path = public as $f$
    select 'VT' = any (coalesce(current_bereiche(), '{}'))
       and darf_any(case when p_schreiben then array['vertrieb.planung:S']
                         else array['vertrieb.planung:L'] end);
  $f$;

  create or replace function public.profiles_schutz() returns trigger language plpgsql as $f$
  begin
    if (new.role is distinct from old.role
        or new.rollen is distinct from old.rollen
        or new.bereiche is distinct from old.bereiche
        or new.aktiv is distinct from old.aktiv)
       and not is_admin() then
      raise exception
        'Rollen, Bereiche und Aktiv-Status können nur von einem Administrator geändert werden.';
    end if;
    return new;
  end $f$;

  -- 6) Rechte auf die neuen Tabellen ------------------------------------------------
  alter table public.recht_katalog enable row level security;
  alter table public.rolle enable row level security;
  alter table public.profil_rechte enable row level security;
  revoke all on public.recht_katalog, public.rolle, public.profil_rechte from anon;
  grant select on public.recht_katalog, public.profil_rechte to authenticated;
  grant select, insert, update, delete on public.rolle to authenticated;
  revoke insert, update, delete on public.recht_katalog, public.profil_rechte from authenticated;
  drop policy if exists recht_katalog_lesen on public.recht_katalog;
  create policy recht_katalog_lesen on public.recht_katalog for select using ((select public.hat_aktive_rolle()));
  drop policy if exists rolle_lesen on public.rolle;
  create policy rolle_lesen on public.rolle for select using ((select public.hat_aktive_rolle()));
  drop policy if exists rolle_admin on public.rolle;
  create policy rolle_admin on public.rolle for all using ((select public.is_admin())) with check ((select public.is_admin()));
  drop policy if exists profil_rechte_lesen on public.profil_rechte;
  create policy profil_rechte_lesen on public.profil_rechte for select
    using (profile_id = auth.uid() or (select public.is_admin()));

  -- 7) Alte Rollenprüfungen umschreiben ------------------------------------------
  -- Policies (public + storage)
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(hat_rolle|hat_rolle_ausser|current_rollen)\('
  loop
    v_using := p.qual;
    v_check := p.with_check;
    -- hat_rolle(ARRAY[...]) -> darf_any(...) laut Zuordnung
    for v_key, t in select 'using', v_using union all select 'check', v_check loop
      continue when t is null;
      ziel := z -> ('policy|' || p.tablename || '|' || p.policyname || '|' || v_key);
      for m in select regexp_matches(t, '(hat_rolle\(\s*(?:ARRAY|array)\[([^\]]*)\]\s*(?:::\s*(?:public\.)?user_role\[\])?\s*\))', 'g') loop
        v_rest := (select string_agg(x, ',' order by x) from (
                     select distinct regexp_replace(trim(y), '''|::(public\.)?user_role', '', 'g') x
                     from unnest(string_to_array(m[2], ',')) y) s);
        if ziel is null or not ziel ? v_rest then
          raise exception 'Keine Zuordnung für Policy %.% (%) [%]', p.tablename, p.policyname, v_key, v_rest;
        end if;
        t := replace(t, m[1], ziel ->> v_rest);
        v_anzahl := v_anzahl + 1;
      end loop;
      t := replace(t, 'hat_rolle_ausser(ARRAY[''waage''::user_role])', 'public.buero()');
      -- Vorschlag eintragen: jeder Nutzer mit Rolle
      t := replace(t, 'cardinality(( SELECT current_rollen() AS current_rollen)) > 0', '( SELECT public.hat_aktive_rolle() AS hat_aktive_rolle)');
      if v_key = 'using' then v_using := t; else v_check := t; end if;
    end loop;
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;

  -- is_admin() in Einstellungs-Policies: auch der Geschäftsführer darf das
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename not in ('profiles', 'verbesserungsvorschlag', 'rolle', 'profil_rechte')
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_admin()%'
  loop
    v_using := replace(p.qual, 'is_admin()', 'public.darf(''einstellungen.grund:S'')');
    v_check := replace(p.with_check, 'is_admin()', 'public.darf(''einstellungen.grund:S'')');
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;

  -- Fix: Vorschuss-Empfänger lesen getrennt vom Schreiben
  drop policy if exists advance_recipients_lesen on public.advance_recipients;
  create policy advance_recipients_lesen on public.advance_recipients for select
    using (( SELECT public.darf_any(array['kasse.buecher:L', 'lohn.auszahlungen:L', 'lohn.uebersicht:L', 'lohn.vorschuesse:L']) AS darf_any));

  -- Views (Optionen wie security_invoker bleiben erhalten)
  for p in
    select c.oid, c.relname, c.reloptions, pg_get_viewdef(c.oid, false) as def
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, false) ~ 'hat_rolle\('
  loop
    t := p.def;
    ziel := z -> ('view|' || p.relname);
    for m in select regexp_matches(t, '(hat_rolle\(\s*(?:ARRAY|array)\[([^\]]*)\]\s*(?:::\s*(?:public\.)?user_role\[\])?\s*\))', 'g') loop
      v_rest := (select string_agg(x, ',' order by x) from (
                   select distinct regexp_replace(trim(y), '''|::(public\.)?user_role', '', 'g') x
                   from unnest(string_to_array(m[2], ',')) y) s);
      if ziel is null or not ziel ? v_rest then
        raise exception 'Keine Zuordnung für View % [%]', p.relname, v_rest;
      end if;
      t := replace(t, m[1], ziel ->> v_rest);
      v_anzahl := v_anzahl + 1;
    end loop;
    execute format('create or replace view public.%I as %s', p.relname, rtrim(rtrim(t), ';'));
    if p.reloptions is not null then
      execute format('alter view public.%I set (%s)', p.relname, array_to_string(p.reloptions, ', '));
    end if;
  end loop;

  -- Funktionen
  for p in
    select pr.oid, pr.proname, pg_get_functiondef(pr.oid) as def
    from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.prokind in ('f', 'p')
      and pr.proname not in ('hat_rolle', 'hat_rolle_ausser', 'current_rollen', 'current_role_name',
                             'rechnung_speichern')
      and not exists (select 1 from pg_depend dd where dd.objid = pr.oid and dd.deptype = 'e')
      and pg_get_functiondef(pr.oid) ~ 'hat_rolle\('
  loop
    t := p.def;
    ziel := z -> ('funktion|' || p.proname);
    for m in select regexp_matches(t, '(hat_rolle\(\s*(?:ARRAY|array)\[([^\]]*)\]\s*(?:::\s*(?:public\.)?user_role\[\])?\s*\))', 'g') loop
      v_rest := (select string_agg(x, ',' order by x) from (
                   select distinct regexp_replace(trim(y), '''|::(public\.)?user_role', '', 'g') x
                   from unnest(string_to_array(m[2], ',')) y) s);
      if ziel is null or not ziel ? v_rest then
        raise exception 'Keine Zuordnung für Funktion % [%]', p.proname, v_rest;
      end if;
      t := replace(t, m[1], ziel ->> v_rest);
      v_anzahl := v_anzahl + 1;
    end loop;
    execute t;
  end loop;

  -- 8) Altes entfernen ---------------------------------------------------------------
  for p in
    select pr.oid::regprocedure as sig from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public'
      and pr.proname in ('rechnung_speichern', 'hat_rolle', 'hat_rolle_ausser', 'current_rollen', 'current_role_name')
  loop
    execute format('drop function %s', p.sig);
  end loop;

  -- profiles_rollen_sync arbeitet unverändert mit Text weiter (Hauptrolle in rollen)

  -- 9) Kontrolle ---------------------------------------------------------------------
  select string_agg(x, ', ') into v_rest from (
    select 'policy ' || tablename || '.' || policyname as x from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(hat_rolle|hat_rolle_ausser|current_rollen|current_role_name)\(|user_role'
    union all
    select 'view ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, false) ~ '(hat_rolle|hat_rolle_ausser|current_rollen|current_role_name)\(|user_role'
    union all
    select 'funktion ' || pr.proname from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend dd where dd.objid = pr.oid and dd.deptype = 'e')
      and pg_get_functiondef(pr.oid) ~ '(hat_rolle|hat_rolle_ausser|current_rollen|current_role_name)\(|user_role'
  ) r;
  if v_rest is not null then
    raise exception 'Noch nicht umgestellt: % - Migration wird komplett zurückgerollt, bitte Claude melden', v_rest;
  end if;
  if (select count(*) from rolle) < 11 or (select count(*) from recht_katalog) <> 48 then
    raise exception 'Katalog/Rollen unvollständig';
  end if;
  raise notice 'Rechte-Umbau: % Rollenprüfungen umgestellt', v_anzahl;
end
$umbau$;

