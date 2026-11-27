"""hatRolle(profile, ...) im App-Code -> darf(profile, ...) mit fachlich passendem Recht.

Je Datei: Liste (alte Rollen, neue Rechte). Gleiche Rollenmenge in einer
Datei mehrfach -> Liste in Reihenfolge des Vorkommens.
Aufruf: python3 client_zuordnung.py [--schreiben]
Prüft für jede Stelle, dass die Startrollen gleich entscheiden (Ausnahmen in GEWOLLT).
"""
import os
import re
import sys

from katalog import ROLLEN_NAMEN, rechte_von

W = os.path.join(os.path.dirname(__file__), "..", "..")
RECHTE = {r: rechte_von(r) for r in ROLLEN_NAMEN}
ADMIN = "istAdmin(profile)"  # nur echter Administrator (nicht Geschäftsführer)

Z = {
    "app/kasse-pruefung/page.tsx": [("admin,kasse", "kasse.pruefung:S"), ("admin,pruefer", "sonder.kasse_freigeben:S")],
    "app/erntewirtschaft/stammdaten/page.tsx": [("admin,erntewirtschaft,hr,zeiterfassung", "ernte.maschinen:S"),
                                               ("admin,hr", "ernte.waagen:S"), ("admin", "einstellungen.grund:S")],
    "app/erntewirtschaft/ausweise/page.tsx": [("admin,hr", "ernte.ausweise:S")],
    "app/anbau/bestellung/page.tsx": [("admin,erntewirtschaft", "ernte.bestellung:S")],
    "app/anbau/ernteplanung/page.tsx": [("admin,erntewirtschaft", "ernte.anbau:S"), ("admin", "einstellungen.grund:S")],
    "app/anbau/erdbeeren/page.tsx": [("admin,erntewirtschaft", "ernte.anbau:S")],
    "app/anbau/spargel/page.tsx": [("admin,erntewirtschaft", "ernte.anbau:S")],
    "app/anbau/felder/page.tsx": [("admin,erntewirtschaft", "ernte.anbau:S")],
    "app/anbau/felder/[id]/page.tsx": [("admin,erntewirtschaft", "ernte.anbau:S")],
    "app/personalstammkarte/page.tsx": [("admin,hr", "personal.persoenlich:L")],
    "app/suche/page.tsx": [("admin,hr,kasse,lohnabrechnung,management,pruefer", "lohn.vorschuesse:L"),
                           ("admin,hr,kasse,lohnabrechnung,management,pruefer,zeiterfassung", "erfassung.stunden:L,lohn.uebersicht:L")],
    "app/dashboard/page.tsx": [("admin,pruefer", "sonder.kasse_freigeben:S"),
                               ("admin", ADMIN),
                               ("admin,erntewirtschaft", "ernte.anbau:S")],
    "app/vorschlaege/page.tsx": [("admin", ADMIN)],
    "app/erntewirtschaft/ernte/page.tsx": [("admin,hr", "ernte.ernte:S")],
    "app/statistik/zuckermais/page.tsx": [("admin,hr,management", "controlling:L")],
    "app/fahrzeuge/stammdaten/page.tsx": [("admin,hr", "fahrzeuge.stammdaten:S")],
    "app/fahrzeuge/einstellungen/page.tsx": [("admin,hr", "fahrzeuge.stammdaten:S")],
    "app/praemien/erdbeeren/page.tsx": [("admin,erntewirtschaft,hr,zeiterfassung", "ernte.praemien:S"), ("admin", "einstellungen.grund:S")],
    "app/praemien/zuckermais/page.tsx": [("admin,erntewirtschaft,hr,zeiterfassung", "ernte.praemien:S"), ("admin", "einstellungen.grund:S")],
    "app/personalplanung/page.tsx": [("admin,hr", "personal.planung:S")],
    "app/qualitaet/strichliste/page.tsx": [("admin,erntewirtschaft,hr,zeiterfassung", "ernte.qualitaet:S")],
    "app/qualitaet/page.tsx": [("admin,erntewirtschaft,hr,zeiterfassung", "ernte.qualitaet:S"),
                               ("admin,erntewirtschaft,hr", "ernte.qualitaet:S"), ("admin", "einstellungen.grund:S")],
    "app/personal-zusammenfuehren/page.tsx": [("admin,hr", "personal.verwaltung:S")],
    "app/praemien/gruppenaufteilung/page.tsx": [("admin,hr", "personal.stamm:S")],
    "app/management/arbeitstage/page.tsx": [("admin,hr,zeiterfassung", "erfassung.stunden:S")],
    "app/management/urlaub/page.tsx": [("admin,hr,zeiterfassung", "erfassung.stunden:S")],
    "app/management/stundenmonitoring/page.tsx": [("admin,hr,zeiterfassung", "erfassung.stunden:S")],
    "app/personal-sozialversicherung/page.tsx": [("admin,hr", "personal.sv:S")],
    "app/vorschuesse/page.tsx": [("admin,kasse,lohnabrechnung", "lohn.vorschuesse:S"),
                                 ("admin,hr,kasse,lohnabrechnung,pruefer", "lohn.belege:L")],
    "app/lager/page.tsx": [("admin,hr", "erfassung.lager:S")],
    "app/vertrieb/page.tsx": [("admin,hr", "vertrieb.planung:S"), ("admin,management", "vertrieb.planung:S")],
    "app/vertrieb/karte/page.tsx": [("admin,management", "vertrieb.planung:S")],
    "app/vertrieb/woche/page.tsx": [("admin,hr", "vertrieb.planung:S")],
    "app/vertrieb/grundplan/page.tsx": [("admin,hr", "vertrieb.planung:S")],
    "app/vertrieb/druck/tag/page.tsx": [("admin,hr", "vertrieb.planung:S")],
    "app/vertrieb/druck/aenderung/page.tsx": [("admin,hr", "vertrieb.planung:S")],
    "app/vertrieb/touren/page.tsx": [("admin,hr", "vertrieb.planung:S")],
    "app/vertrieb/verfuegbarkeit/page.tsx": [("admin,hr", "vertrieb.planung:S")],
    "app/vertrieb/import/page.tsx": [("admin,hr", "vertrieb.planung:S")],
    "app/erfassung/page.tsx": [("admin,hr", "personal.stamm:S"), ("admin,hr,zeiterfassung", "erfassung.stunden:S")],
    "app/mitarbeiter/page.tsx": [("admin,hr", "personal.stamm:S"), ("admin", "einstellungen.grund:S")],
    "app/personal-import-historie/page.tsx": [("admin,hr", "personal.verwaltung:S")],
    "app/auszahlungen/page.tsx": [("admin,kasse,lohnabrechnung", "lohn.auszahlungen:S")],
    "app/kasse/page.tsx": [("admin,kasse", "kasse.buecher:S")],
    "app/kasse/buch/page.tsx": [("admin,kasse", "kasse.buecher:S")],
    "app/kasse/uebersicht/page.tsx": [("admin", "einstellungen.grund:S"), ("kasse", "kasse.buecher:S")],
    "app/einstellungen/arbeitsgruppen/page.tsx": [("admin,zeiterfassung", "erfassung.gruppen:S")],
    "app/einstellungen/einsatzbereiche/page.tsx": [("admin", "einstellungen.grund:S")],
    "app/einstellungen/herkuenfte/page.tsx": [("admin", "einstellungen.grund:S")],
    "app/einstellungen/page.tsx": [("admin", "einstellungen.grund:S")],
    "app/einstellungen/nutzer/page.tsx": [("admin", ADMIN)],
    "app/aenderungsprotokoll/page.tsx": [("admin,pruefer", "sonder.protokoll:S")],
    "app/personalnummern/page.tsx": [("admin,hr", "personal.verwaltung:S")],
    "app/personal-dokumente/page.tsx": [("admin,hr", "personal.dokumente:L")],
    "app/personal-import/page.tsx": [("admin,hr", "personal.verwaltung:S")],
    "app/personal-import-hsc/page.tsx": [("admin,hr", "personal.verwaltung:S")],
    "app/personal-import-hsc-lw/page.tsx": [("admin,hr", "personal.verwaltung:S")],
    "app/personal-anreiseliste/page.tsx": [("admin,hr", "personal.planung:S")],
    "app/personal-anreiseliste/kamera/page.tsx": [("admin,hr", "personal.planung:S")],
    "app/personal-anreiseliste/schulungsliste/page.tsx": [("admin,hr", "personal.planung:L")],
    "app/personal-lohnsteuer/page.tsx": [("admin,hr", "personal.lohnsteuer:S")],
    "app/personal-lohnsteuer/antrag/page.tsx": [("admin,hr", "personal.lohnsteuer:S")],
    "app/personal-firmenhandys/page.tsx": [("admin,hr", "personal.handys:S")],
    "app/uebersicht/beleg/page.tsx": [("admin,hr,kasse,lohnabrechnung,management,pruefer", "lohn.uebersicht:L")],
    "app/uebersicht/page.tsx": [("admin,lohnabrechnung", "lohn.uebersicht:S"), ("admin,hr", "einstellungen.saisons:S"),
                                ("admin,hr,lohnabrechnung", "lohn.saison:S")],
    "app/arbeitskleidung/page.tsx": [("admin,hr,zeiterfassung", "erfassung.kleidung:S"), ("admin,hr", "erfassung.lager:S")],
    "app/unterkunft/uebergabe/page.tsx": [("admin,hausmeister,hr", "unterkunft.belegung:S")],
    "app/unterkunft/page.tsx": [("admin", "einstellungen.grund:S"), ("admin,hr", "unterkunft.immobilien:S"),
                                ("admin,hausmeister,hr", "unterkunft.belegung:S")],
    "app/unterkunft/kontrolle/page.tsx": [("admin,hr", "unterkunft.kontrollen:S")],
    "app/unterkunft/stammdaten/page.tsx": [("admin,hr", "unterkunft.immobilien:S"), ("admin", "einstellungen.grund:S")],
    "app/unterkunft/reparaturen/page.tsx": [("admin,hausmeister,hr", "unterkunft.maengel:S")],
    "app/unterkunft/maengel/page.tsx": [("admin,hausmeister,hr", "unterkunft.maengel:S")],
    "app/unterkunft/belegung/page.tsx": [("admin,hr", "unterkunft.zuweisen:S")],
    "app/unterkunft/planung/page.tsx": [("admin,hr", "unterkunft.planung:S")],
    "components/VorschlagKnopf.tsx": [("admin", ADMIN)],
    "lib/stundenkontoRechte.ts": [("admin,hr,zeiterfassung", "erfassung.stunden:S"),
                                  ("admin,hr,lohnabrechnung,management", "lohn.stundenkonto:S,controlling:L")],
}

# Bewusste Abweichungen (Datei, alte Rollen) -> Grund
GEWOLLT = {
    ("app/vertrieb/page.tsx", "admin,management"): "Stand-Position: HR statt Management",
    ("app/vertrieb/karte/page.tsx", "admin,management"): "Stand-Position: HR statt Management",
    ("app/qualitaet/page.tsx", "admin,erntewirtschaft,hr"): "Stundenerfassung darf löschen (wie DB)",
    ("app/kasse/uebersicht/page.tsx", "kasse"): "steht als (isAdmin || kasse) - Admin hat es ohnehin",
}

RX = re.compile(r"hatRolle\(\s*profile\s*,\s*((?:\"[a-z_]+\"\s*,?\s*)+)\)")


def rollen(recht):
    return frozenset(r for r in ROLLEN_NAMEN if recht in RECHTE[r])


def main():
    schreiben = "--schreiben" in sys.argv
    fehler = 0
    for datei, liste in Z.items():
        pfad = os.path.join(W, datei)
        text = open(pfad).read()
        rest = list(liste)

        def ersetzen(m):
            nonlocal fehler
            alt = ",".join(sorted(re.findall(r'"([a-z_]+)"', m.group(1))))
            idx = next((i for i, (a, _) in enumerate(rest) if a == alt), None)
            if idx is None:
                print(f"KEINE ZUORDNUNG {datei}: {alt}")
                fehler += 1
                return m.group(0)
            _, neu = rest.pop(idx)
            if neu == ADMIN:
                neue_rollen = frozenset({"admin"})
                ausdruck = ADMIN
            else:
                rechte = neu.split(",")
                neue_rollen = frozenset().union(*[rollen(r) for r in rechte])
                ausdruck = "darf(profile, " + ", ".join(f'"{r}"' for r in rechte) + ")"
            if neue_rollen != frozenset(alt.split(",")):
                grund = GEWOLLT.get((datei, alt))
                if grund:
                    print(f"gewollt {datei}: {alt} -> {','.join(sorted(neue_rollen))} ({grund})")
                else:
                    print(f"ABWEICHUNG {datei}: {alt} -> {','.join(sorted(neue_rollen))} [{neu}]")
                    fehler += 1
            return ausdruck

        neu_text = RX.sub(ersetzen, text)
        for a, _ in rest:
            print(f"UNBENUTZT {datei}: {a}")
            fehler += 1
        if schreiben and neu_text != text:
            open(pfad, "w").write(neu_text)
    print(f"{fehler} Fehler")


if __name__ == "__main__":
    main()
