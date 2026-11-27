"""Welche Katalog-Funktionen gelten für welche Tabelle/View/Funktion.

Je Objekt eine Liste von Katalog-Schlüsseln. Beim Übersetzen einer alten
Rollenprüfung nimmt umschreiben.py daraus alle Rechte (Stufe L in
Lese-Policies, S in Schreib-Policies/Funktionen), deren Startrollen
innerhalb der alten Rollenmenge liegen, und prüft, dass zusammen genau die
alte Rollenmenge herauskommt.

LESEN_AUCH: zusätzliche Funktionen, die eine Tabelle nur LESEN dürfen
(z.B. Lohn liest die Stunden, aus denen er entsteht).
"""

LOHN_LESEN = ["lohn.uebersicht", "lohn.vorschuesse", "lohn.auszahlungen", "controlling"]
ERNTE_LESEN = ["ernte.praemien", "ernte.statistik", "ernte.qualitaet"]

TABELLE = {
    # Personal
    "personal_kandidaten": ["personal.planung"],
    "employees": ["personal.stamm"],
    "employee_saison": ["personal.stamm", "lohn.saison"],
    "employee_saison_praesenz": ["personal.stamm"],
    "schulung_teilnahme": ["personal.stamm"],
    "employee_beschaeftigungsabschnitte": ["personal.sv"],
    "sv_fragebogen": ["personal.sv"],
    "sv_fragebogen_vorbeschaeftigung": ["personal.sv"],
    "doppelte_haushaltsfuehrung": ["personal.lohnsteuer"],
    "lohnsteuerantrag": ["personal.lohnsteuer"],
    "lohnsteuerantrag_position": ["personal.lohnsteuer"],
    "employee_documents": ["personal.dokumente"],
    "firmenhandy": ["personal.handys"],
    # Unterkunft
    "unterkunft_gebaeude": ["unterkunft.immobilien"],
    "unterkunft_wohneinheit": ["unterkunft.immobilien"],
    "unterkunft_zimmer": ["unterkunft.immobilien"],
    "unterkunft_checkliste_vorlage": ["unterkunft.immobilien"],
    "unterkunft_kontroll_intervall": ["unterkunft.immobilien"],
    "unterkunft_belegung": ["unterkunft.belegung"],
    "unterkunft_zuordnung": ["unterkunft.zuweisen"],
    "unterkunft_vorgang": ["unterkunft.belegung", "unterkunft.kontrollen", "unterkunft.maengel"],
    "unterkunft_vorgang_position": ["unterkunft.belegung", "unterkunft.kontrollen", "unterkunft.maengel"],
    "unterkunft_mangel": ["unterkunft.maengel"],
    "unterkunft_foto": ["unterkunft.maengel", "unterkunft.kontrollen", "unterkunft.belegung"],
    "unterkunft_herkunft_kontingent": ["unterkunft.planung"],
    "unterkunft_herkunft_plan": ["unterkunft.planung"],
    "unterkunft_belastung": ["unterkunft.kosten", "unterkunft.belegung"],
    # Stundenerfassung
    "work_entries": ["erfassung.stunden"],
    "arbeitstage_bearbeitung_lock": ["erfassung.stunden", "personal.stamm"],
    "stundenkonto_bewegungen": ["erfassung.stunden", "lohn.stundenkonto"],
    "kleidung_ausgaben": ["erfassung.kleidung"],
    "kleidung_lagerbestand": ["erfassung.lager"],
    "arbeitsgruppen": ["erfassung.gruppen"],
    # Lohn
    "advances": ["lohn.vorschuesse"],
    "advance_recipients": ["lohn.vorschuesse"],
    "auszahlungsbelege": ["lohn.auszahlungen"],
    "auszahlungsbeleg_zeilen": ["lohn.auszahlungen"],
    "sepa_export": ["lohn.auszahlungen"],
    "saison_abrechnungen": ["lohn.uebersicht"],
    "season_bonuses": ["lohn.uebersicht"],
    "employee_abzug_ausnahme": ["lohn.uebersicht", "personal.stamm"],
    "kautionsuebergaben": ["lohn.uebersicht", "lohn.vorschuesse"],
    "kautionsuebergabe_personen": ["lohn.uebersicht", "lohn.vorschuesse"],
    # Kasse
    "kassenbuch": ["kasse.buecher"],
    "kassenbuch_buchung": ["kasse.buecher"],
    "kassenbewegungen": ["kasse.buecher"],
    "cash_deposits": ["kasse.buecher"],
    "cash_checks": ["kasse.pruefung", "sonder.kasse_freigeben"],
    # Ernte
    "zuckermais_rohdaten": ["ernte.praemien"],
    "erdbeeren_rohdaten": ["ernte.praemien"],
    "zuckermais_druck": ["ernte.praemien"],
    "zuckermais_annahme": ["ernte.qualitaet"],
    "qs_kontrolle": ["ernte.qualitaet"],
    "erdbeeren_bestellung": ["ernte.bestellung"],
    "feld": ["ernte.anbau"],
    "feld_anbau": ["ernte.anbau"],
    "feld_anbau_abschnitt": ["ernte.anbau"],
    "spargel_sorte": ["ernte.anbau"],
    "ernte_tag": ["ernte.ernte", "ernte.praemien"],
    "ernte_schicht": ["ernte.ernte"],
    "ernte_kiste_zyklus": ["ernte.ernte"],
    "ernte_scan": ["ernte.ernte"],
    "ernte_position": ["ernte.ernte"],
    "ernte_poller_state": ["ernte.ernte"],
    "ernte_maschine": ["ernte.maschinen"],
    "ernte_waage": ["ernte.waagen", "ernte.waage"],
    "ernte_ausweis": ["ernte.ausweise"],
    "ernte_ausweis_druck": ["ernte.ausweise"],
    # Fahrzeuge
    "fahrzeug": ["fahrzeuge.stammdaten"],
    "fahrzeug_tracker": ["fahrzeuge.stammdaten"],
    "fahrzeug_geofence": ["fahrzeuge.stammdaten"],
    "fahrzeug_arbeitszeit": ["fahrzeuge.stammdaten"],
    "fahrzeug_ereignis": ["fahrzeuge.uebersicht"],
    "fahrzeug_position": ["fahrzeuge.uebersicht"],
    "fahrzeug_poller_state": ["fahrzeuge.uebersicht"],
    # Einstellungen
    "einsatzbereiche": ["einstellungen.einsatzbereiche"],
    "einsatzbereich_zeitraum": ["einstellungen.einsatzbereiche"],
    "periods": ["einstellungen.saisons"],
    "bereich_saetze": ["einstellungen.grund"],
    "verpflegungssaetze": ["einstellungen.grund"],
    "zuckermais_saetze": ["einstellungen.grund"],
    "erdbeeren_parzellen_saetze": ["einstellungen.grund"],
    "firma": ["einstellungen.grund"],
    "firmen_bankdaten": ["einstellungen.grund"],
    "geschaeftsbereich": ["einstellungen.grund"],
    "herkuenfte": ["einstellungen.grund"],
    "kassenpruefung_einstellungen": ["einstellungen.grund"],
    "ernte_konfig": ["einstellungen.grund"],
    # Sonder
    "audit_log": ["sonder.protokoll"],
}

LESEN_AUCH = {
    "employees": ["personal.planung"],
    "employee_saison": LOHN_LESEN,
    "work_entries": LOHN_LESEN + ERNTE_LESEN + ["ernte.ernte"],
    "stundenkonto_bewegungen": LOHN_LESEN,
    "kleidung_ausgaben": ["lohn.uebersicht:S", "controlling", "ernte.praemien"],
    "saison_abrechnungen": ["lohn.vorschuesse", "lohn.auszahlungen"],
    "advances": ["lohn.uebersicht", "lohn.auszahlungen", "kasse.buecher"],
    "advance_recipients": ["lohn.uebersicht", "lohn.auszahlungen", "kasse.buecher"],
    "auszahlungsbelege": ["lohn.uebersicht", "lohn.vorschuesse", "kasse.buecher"],
    "auszahlungsbeleg_zeilen": ["lohn.uebersicht", "lohn.vorschuesse", "kasse.buecher"],
    "sepa_export": ["lohn.uebersicht", "lohn.vorschuesse"],
    "kautionsuebergaben": ["lohn.vorschuesse", "lohn.auszahlungen", "kasse.buecher"],
    "kautionsuebergabe_personen": ["lohn.vorschuesse", "lohn.auszahlungen", "kasse.buecher"],
    "employee_abzug_ausnahme": ["kasse.buecher"],
    "season_bonuses": [],
    "cash_deposits": ["lohn.uebersicht", "lohn.vorschuesse", "lohn.auszahlungen"],
    "kassenbuch": ["lohn.vorschuesse:S", "lohn.auszahlungen:S"],
    "cash_checks": ["kasse.buecher"],
    "unterkunft_belastung": [],
    "erdbeeren_rohdaten": ["ernte.statistik"],
    "zuckermais_rohdaten": ["ernte.statistik"],
    "ernte_kiste_zyklus": ["ernte.waage", "sonder.waage_kiosk"],
    "ernte_waage": ["ernte.ernte", "sonder.waage_kiosk"],
    "ernte_konfig": ["ernte.ernte"],
    "ernte_scan": ["ernte.waage"],
    "ernte_position": ["ernte.maschinen"],
    "ernte_poller_state": ["ernte.maschinen"],
    "ernte_schicht": ["ernte.waage"],
    "ernte_maschine": ["ernte.ernte"],
    "fahrzeug": ["fahrzeuge.uebersicht"],
    "fahrzeug_tracker": ["fahrzeuge.uebersicht"],
    "fahrzeug_geofence": ["fahrzeuge.uebersicht"],
    "fahrzeug_arbeitszeit": ["fahrzeuge.uebersicht"],
    "firmenhandy": ["fahrzeuge.uebersicht"],
    "unterkunft_herkunft_kontingent": ["controlling"],
    "unterkunft_herkunft_plan": ["controlling"],
    "personal_kandidaten": ["controlling"],
    "firmen_bankdaten": ["kasse.buecher:S", "personal.stamm:S"],
    "kleidung_lagerbestand": [],
    "kassenbewegungen": ["lohn.vorschuesse", "lohn.auszahlungen"],
    "kassenbuch_buchung": ["lohn.vorschuesse", "lohn.auszahlungen"],
}

# Storage-Buckets (Tabelle storage.objects): Bucket -> Funktionen
BUCKET = {
    "mitarbeiter-dokumente": ["personal.dokumente"],
    "mitarbeiter-fotos": ["personal.stamm"],
    "unterkunft-fotos": ["unterkunft.maengel"],
    "vorschuss-belege": ["lohn.belege"],
}
BUCKET_LESEN_AUCH = {
    "mitarbeiter-fotos": ["ernte.ernte", "sonder.waage_kiosk"],  # Ausweise/Kiosk zeigen Fotos
}

# Einzelne Vorkommen von Hand: (objekt, policy, feld) -> Rechte
UEBERSTEUERT = {
    # Hausmeister schließt Zuordnungen ab (erledigt/storniert); admin/hr dürfen
    # ohnehin alles über unterkunft_zuordnung_write.
    ("unterkunft_zuordnung", "unterkunft_zuordnung_hausmeister_abschluss", "using"): ["unterkunft.belegung:S"],
    ("unterkunft_zuordnung", "unterkunft_zuordnung_hausmeister_abschluss", "check"): ["unterkunft.belegung:S"],
    # Fix 7: HR/Prüfer konnten Vorschuss-Empfänger ändern/löschen (USING der
    # FOR-ALL-Policy enthielt die Leserollen). Lesen bekommt eine eigene Policy.
    ("advance_recipients", "advance_recipients_rw", "using"): ["lohn.vorschuesse:S"],
}

# Views (lesen) mit eigener Rollenprüfung im View-Text
VIEW = {
    "anreiseliste_offen_arbeitend": ["personal.planung", "controlling"],
    "auszahlungsbeleg_summary": ["lohn.auszahlungen", "lohn.uebersicht", "lohn.vorschuesse", "kasse.buecher"],
    "employee_auslagen_historie": LOHN_LESEN + ["kasse.buecher"],
    "employee_bankdaten": ["personal.bank"],
    "employee_lohndaten": ["personal.stamm:S", "lohn.uebersicht:S", "controlling"],
    "employee_personaldaten": ["personal.persoenlich"],
    "employee_sv_pruefung": ["personal.sv", "controlling"],
    "employee_vorschuss_historie": ["lohn.vorschuesse", "lohn.uebersicht", "lohn.auszahlungen", "kasse.buecher", "lohn.belege"],
    "erdbeeren_gruppenkosten_tag": ERNTE_LESEN,
    "erdbeeren_statistik_tag": ERNTE_LESEN,
    "zuckermais_statistik_tag": ERNTE_LESEN,
    "season_summary": LOHN_LESEN + ["kasse.buecher"],
    "season_summary_monat": LOHN_LESEN + ["kasse.buecher"],
    "unterkunft_auszug_offen": ["unterkunft.belegung"],
}

# Funktionen (schreiben, Stufe S) mit Rollenprüfung im Rumpf
FUNKTION = {
    "abrechnung_fahrerkaution_korrigieren": ["lohn.uebersicht"],
    "abrechnung_korrigieren": ["lohn.uebersicht"],
    "abrechnung_verpflegung_korrigieren": ["lohn.uebersicht"],
    "abrechnung_zimmerkaution_korrigieren": ["lohn.uebersicht"],
    "saison_abrechnen_batch": ["lohn.uebersicht"],
    "arbeitskleidung_ausgabe_buchen": ["erfassung.kleidung"],
    "arbeitskleidung_ausgabe_stornieren": ["erfassung.kleidung"],
    "employee_beschaeftigung_abmelden": ["personal.sv"],
    "employee_beschaeftigung_anmelden": ["personal.sv"],
    "employee_jahre_verschieben": ["personal.verwaltung"],
    "employees_zusammenfuehren": ["personal.verwaltung"],
    "lw_personal_nr_umnummerieren": ["personal.verwaltung"],
    "lw_stamm_ergaenzen": ["personal.verwaltung"],
    "kandidat_buskosten_setzen": ["personal.planung"],
    "statuswechsel_stunden_uebertragen": ["personal.stamm"],
    "saison_abrechnung_nachtragen": ["personal.stamm"],
    "saison_abrechnung_nachtrag_entfernen": ["personal.stamm"],
    "kassenbuch_buchen": ["kasse.buecher"],
    "kassenbuch_buchung_stornieren": ["kasse.buecher"],
    "kassenbuch_umbuchen": ["kasse.buecher"],
    "naechste_belegnummer": ["kasse.buecher", "lohn.vorschuesse", "lohn.auszahlungen"],
    "vorschuss_korrigieren": ["lohn.vorschuesse"],
    "stundenkonto_buchen": ["erfassung.stunden"],
    "stundenkonto_datum_setzen": ["erfassung.stunden", "lohn.stundenkonto"],
    "stundenkonto_auszahlung_stornieren": ["lohn.stundenkonto"],
    "stundenkonto_in_auszahlung_umwandeln": ["lohn.stundenkonto"],
    "vt_stand_position_setzen": ["vertrieb.planung"],
}
# Lesende Funktionen (Stufe L)
FUNKTION_LESEN = {
    "kassenbestand_bis": ["kasse.buecher", "lohn.vorschuesse", "lohn.auszahlungen", "lohn.uebersicht"],
}

# Gewollte Abweichungen (Nutzer 2026-11-27, docs/rechte-plan.md):
# (objekt, alte Rollenmenge) -> neue Rollenmenge wird so akzeptiert
ERWARTET = {
    # 1. HR verliert Anbau-Schreibrecht
    "feld": "HR ohne Anbau", "feld_anbau": "HR ohne Anbau", "feld_anbau_abschnitt": "HR ohne Anbau",
    "spargel_sorte": "HR ohne Anbau",
    # 2. Management ohne Stundenkonto-Auszahlung
    "stundenkonto_auszahlung_stornieren": "Management ohne Stundenkonto",
    "stundenkonto_in_auszahlung_umwandeln": "Management ohne Stundenkonto",
    # 3. Stand-Position: HR statt Management
    "vt_stand_position_setzen": "HR statt Management",
    # 4. Lohnabrechnung ohne Kassenbuch-Einsicht
    "kassenbewegungen": "Lohnabrechnung ohne Kassenbuch", "kassenbuch_buchung": "Lohnabrechnung ohne Kassenbuch",
    "cash_deposits": "Lohnabrechnung ohne Kassenbuch",
    # Löschen gehört zu "schreiben" (keine eigene Stufe): Stundenerfassung darf
    # eigene QS-Kontrollen/Strichlisten-Einträge künftig auch löschen.
    "qs_kontrolle": "Stundenerfassung darf löschen", "zuckermais_annahme": "Stundenerfassung darf löschen",
    # siehe UEBERSTEUERT
    "unterkunft_zuordnung": "Hausmeister-Abschluss (admin/hr haben es ohnehin)",
    "advance_recipients": "Fix 7: HR/Prüfer nicht mehr löschen",
}
