"""Rechte-Katalog + Startrollen (Single Source für den Rechte-Umbau 2026-11-27).

Aus dieser Datei werden erzeugt:
  - die Katalog-/Rollen-Daten der Migration (recht_katalog, rolle)
  - lib/rechteKatalog.ts (Anzeige im Rollen-Editor)
Die Startrollen bilden die 10 bisherigen Rollen 1:1 ab (Abnahme per
Rechte-Matrix), bis auf die vom Nutzer gewollten Bereinigungen
(docs/rechte-plan.md, Auffälligkeiten 1-6).

Stufen: "L" = lesen, "S" = lesen & schreiben. Sonderrechte nur "S".
"""

# (schluessel, modul, titel, unter, sensibel, nur_lesen)
KATALOG = [
    ("personal.planung", "Personal", "Planung & Anreiseliste", "Personalplanung, Platzhalter, Anreiseliste, Buskosten", False, False),
    ("personal.stamm", "Personal", "Personalstamm", "Stammkarte, Status, Saisons, Firma/Bereich", False, False),
    ("personal.persoenlich", "Personal", "Persönliche Daten", "Adresse, Geburtsdatum, Ausweis, Familienstand", True, False),
    ("personal.bank", "Personal", "Bankverbindung", "IBAN für Überweisungen", True, False),
    ("personal.sv", "Personal", "Sozialversicherung", "SV-Prüfung, SV-Fragebogen, An-/Abmeldung, Beschäftigungsabschnitte", True, False),
    ("personal.lohnsteuer", "Personal", "Lohnsteuer", "Doppelte Haushaltsführung, Antrag ans Finanzamt", True, False),
    ("personal.dokumente", "Personal", "Dokumente", "Hochgeladene Ausweise, Urkunden, Verträge", True, False),
    ("personal.verwaltung", "Personal", "Personalnummern, Import, Zusammenführen", "Nummern vergeben, Listen einlesen, Dubletten zusammenlegen", False, False),
    ("personal.handys", "Personal", "Firmenhandys", "", False, False),
    ("unterkunft.immobilien", "Unterkunft", "Immobilien & Stammdaten", "Gebäude, Wohnungen, Zimmer, Grundrisse, Checklisten, Kontrollintervalle", False, False),
    ("unterkunft.zuweisen", "Unterkunft", "Zimmer zuweisen", "Personen auf Zimmer verteilen, Einzüge planen", False, False),
    ("unterkunft.belegung", "Unterkunft", "Belegung", "Belegungsplan, Einzug, Auszüge, Übergabe/Abnahme", False, False),
    ("unterkunft.kontrollen", "Unterkunft", "Kontrollen", "Kontrollplan, Zwischenkontrolle", False, False),
    ("unterkunft.maengel", "Unterkunft", "Mängel & Reparaturen", "Mängel melden, Fotos, Reparaturen erledigen", False, False),
    ("unterkunft.planung", "Unterkunft", "Herkunfts-Planung", "Betten-Kontingente je Herkunft", False, False),
    ("unterkunft.kosten", "Unterkunft", "Kosten an Bewohner", "Schäden/Belastungen, die vom Lohn abgezogen werden", False, False),
    ("erfassung.stunden", "Stundenerfassung", "Stunden erfassen", "Erfassung, Wochenansicht, Import, Stundenkonto buchen", False, False),
    ("erfassung.kleidung", "Stundenerfassung", "Arbeitskleidung", "Ausgabe buchen und stornieren", False, False),
    ("erfassung.lager", "Stundenerfassung", "Kleidungslager", "Bestand pflegen", False, False),
    ("erfassung.gruppen", "Stundenerfassung", "Arbeitsgruppen", "Gruppen anlegen und Personen zuordnen", False, False),
    ("lohn.uebersicht", "Lohn", "Lohnübersicht & Abrechnung", "Netto, Buskosten, Kautionen, Prämien-Boni, Abzüge, Abrechnen, Korrekturen, Monatsdruck", False, False),
    ("lohn.saison", "Lohn", "Saison-Zuordnung", "Firma/Bereich je Saison, Saison nachtragen", False, False),
    ("lohn.vorschuesse", "Lohn", "Vorschüsse", "Erfassen, stornieren, korrigieren", False, False),
    ("lohn.belege", "Lohn", "Vorschuss-Belege", "Fotos der Quittungen zu Vorschüssen", True, False),
    ("lohn.auszahlungen", "Lohn", "Auszahlungen & SEPA", "Auszahlungsbelege, SEPA-Dateien je Firma", False, False),
    ("lohn.stundenkonto", "Lohn", "Stundenkonto auszahlen", "Saldo in Auszahlung umwandeln, stornieren", False, False),
    ("kasse.buecher", "Kassenbuch", "Kassenbücher", "Buchen, umbuchen, stornieren, Einzahlungen", False, False),
    ("kasse.pruefung", "Kassenbuch", "Kassenprüfung", "Zählen und Prüfung anlegen", False, False),
    ("ernte.praemien", "Erntewirtschaft", "Prämien erfassen", "Zuckermais, Spargel, Erdbeeren, Gruppenaufteilung, Strichliste drucken", False, False),
    ("ernte.statistik", "Erntewirtschaft", "Statistik", "Zuckermais, Spargel, Erdbeeren", False, True),
    ("ernte.qualitaet", "Erntewirtschaft", "Qualität", "Schichtkontrolle, Strichliste / Nacharbeit", False, False),
    ("ernte.anbau", "Erntewirtschaft", "Anbau", "Erdbeeren, Spargel, Übersicht, Ernteplanung, Felder, Sorten", False, False),
    ("ernte.bestellung", "Erntewirtschaft", "Erdbeer-Bestellung", "", False, False),
    ("ernte.ernte", "Erntewirtschaft", "Ernte & Überblick", "Karte der Spinnen, Kisten, Schichten, Lücken nachtragen", False, False),
    ("ernte.waage", "Erntewirtschaft", "Waage", "Wiegungen ansehen", False, True),
    ("ernte.maschinen", "Erntewirtschaft", "Maschinen", "Spargelspinnen und Tracker zuordnen", False, False),
    ("ernte.waagen", "Erntewirtschaft", "Waagen einrichten", "", False, False),
    ("ernte.ausweise", "Erntewirtschaft", "Ernte-Ausweise", "QR-Ausweise drucken (enthält Sicherheitscode)", True, False),
    ("vertrieb.planung", "Vertrieb", "Vertriebsplanung", "Stände, Karte, Touren, Verfügbarkeit, Grundplan, Woche, Tagesplan", False, False),
    ("fahrzeuge.uebersicht", "Fahrzeuge", "Übersicht", "Karte, Streckenverlauf, Hofzeiten & Alarme", False, True),
    ("fahrzeuge.stammdaten", "Fahrzeuge", "Stammdaten", "Fahrzeuge, Tracker, Hof-Zonen, Einstellungen", False, False),
    ("controlling", "Controlling", "Controlling", "Übersicht, Anreiseliste, SV, Stundenmonitoring, Arbeitstage am Stück, Auszahlungs-Abweichungen, Urlaub", False, True),
    ("einstellungen.einsatzbereiche", "Einstellungen", "Einsatzbereiche", "", False, False),
    ("einstellungen.saisons", "Einstellungen", "Saisons", "Saisons und Abrechnungszeiträume anlegen", False, False),
    ("einstellungen.grund", "Einstellungen", "Sätze, Firmen & Grundeinstellungen", "Prämien- und Verpflegungssätze, Firmen mit Bankdaten, Geschäftsbereiche, Herkünfte, Ernte- und Kassenprüfungs-Einstellungen", False, False),
    ("sonder.kasse_freigeben", "Sonderrechte", "Kassenprüfung freigeben", "Nie die eigene (Vier-Augen-Prinzip)", False, False),
    ("sonder.protokoll", "Sonderrechte", "Änderungsprotokoll einsehen", "", True, False),
    ("sonder.waage_kiosk", "Sonderrechte", "Waagen-Bildschirm", "Kiosk an der Hofwaage", False, False),
]
KEYS = [k[0] for k in KATALOG]

# (schluessel, bezeichnung, beschreibung, rechte)
START_ROLLEN = [
    ("hr", "Personal (HR)", "", {
        "personal.planung": "S", "personal.stamm": "S", "personal.persoenlich": "S", "personal.bank": "S",
        "personal.sv": "S", "personal.lohnsteuer": "S", "personal.dokumente": "S", "personal.verwaltung": "S",
        "personal.handys": "S",
        "unterkunft.immobilien": "S", "unterkunft.zuweisen": "S", "unterkunft.belegung": "S", "unterkunft.kontrollen": "S",
        "unterkunft.maengel": "S", "unterkunft.planung": "S", "unterkunft.kosten": "S",
        "erfassung.stunden": "S", "erfassung.kleidung": "S", "erfassung.lager": "S",
        "lohn.uebersicht": "L", "lohn.saison": "S", "lohn.vorschuesse": "L", "lohn.belege": "L", "lohn.auszahlungen": "L",
        "lohn.stundenkonto": "S",
        "ernte.praemien": "S", "ernte.statistik": "L", "ernte.qualitaet": "S", "ernte.ernte": "S",
        "ernte.waage": "L", "ernte.maschinen": "S", "ernte.waagen": "S", "ernte.ausweise": "S",
        "vertrieb.planung": "S",
        "fahrzeuge.uebersicht": "L", "fahrzeuge.stammdaten": "S",
        "controlling": "L",
        "einstellungen.einsatzbereiche": "S", "einstellungen.saisons": "S",
    }),
    ("zeiterfassung", "Stundenerfassung", "", {
        "personal.stamm": "L",
        "erfassung.stunden": "S", "erfassung.kleidung": "S", "erfassung.gruppen": "S",
        "ernte.praemien": "S", "ernte.qualitaet": "S", "ernte.ernte": "L", "ernte.waage": "L",
        "ernte.maschinen": "S",
    }),
    ("kasse", "Kasse", "", {
        "personal.bank": "L", "unterkunft.kosten": "S",
        "lohn.uebersicht": "L", "lohn.vorschuesse": "S", "lohn.belege": "S", "lohn.auszahlungen": "S",
        "kasse.buecher": "S", "kasse.pruefung": "S",
    }),
    ("lohnabrechnung", "Lohnabrechnung", "", {
        "personal.bank": "L", "unterkunft.kosten": "L",
        "lohn.uebersicht": "S", "lohn.saison": "S", "lohn.vorschuesse": "S", "lohn.belege": "S", "lohn.auszahlungen": "S",
        "lohn.stundenkonto": "S",
        "ernte.praemien": "L", "ernte.statistik": "L", "ernte.qualitaet": "L",
        "vertrieb.planung": "L",
    }),
    ("pruefer", "Prüfer", "", {
        "unterkunft.kosten": "L",
        "lohn.uebersicht": "L", "lohn.vorschuesse": "L", "lohn.belege": "L", "lohn.auszahlungen": "L",
        "kasse.buecher": "L", "kasse.pruefung": "L",
        "vertrieb.planung": "L",
        "sonder.kasse_freigeben": "S", "sonder.protokoll": "S",
    }),
    ("management", "Management", "", {
        "unterkunft.kosten": "L",
        "lohn.uebersicht": "L", "lohn.vorschuesse": "L", "lohn.auszahlungen": "L",
        "kasse.buecher": "L", "kasse.pruefung": "L",
        "ernte.praemien": "L", "ernte.statistik": "L", "ernte.qualitaet": "L", "ernte.ernte": "L",
        "ernte.waage": "L",
        "vertrieb.planung": "L",
        "fahrzeuge.uebersicht": "L", "fahrzeuge.stammdaten": "L",
        "controlling": "L",
    }),
    ("erntewirtschaft", "Erntewirtschaft", "", {
        "unterkunft.immobilien": "L", "unterkunft.belegung": "L", "unterkunft.kontrollen": "L",
        "unterkunft.maengel": "L",
        "ernte.praemien": "S", "ernte.statistik": "L", "ernte.qualitaet": "S", "ernte.anbau": "S",
        "ernte.bestellung": "S", "ernte.ernte": "L", "ernte.waage": "L", "ernte.maschinen": "S",
    }),
    ("hausmeister", "Hausmeister", "", {
        "unterkunft.immobilien": "L", "unterkunft.belegung": "S", "unterkunft.maengel": "S",
        "unterkunft.planung": "L", "unterkunft.kosten": "L",
    }),
    ("waage", "Waage", "", {"sonder.waage_kiosk": "S"}),
]
ROLLEN_NAMEN = ["admin"] + [r[0] for r in START_ROLLEN]


def rechte_von(rolle):
    """Menge 'key:L'/'key:S' einer Startrolle (admin: alles)."""
    if rolle == "admin":
        return {f"{k}:{s}" for k in KEYS for s in "LS"}
    d = dict((r[0], r[3]) for r in START_ROLLEN)[rolle]
    out = set()
    for k, s in d.items():
        assert k in KEYS, k
        out.add(f"{k}:L")
        if s == "S":
            out.add(f"{k}:S")
    return out
