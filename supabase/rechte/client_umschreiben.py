"""Übersetzt hatRolle(profile, "a", "b") im App-Code in darf(profile, "x:S", ...).

Aufruf: python3 client_umschreiben.py [--schreiben]
Ohne --schreiben: Bericht. Gleiche Prüfung wie in der Datenbank: für jede
Startrolle muss die neue Prüfung genauso entscheiden wie die alte.
"""
import os
import re
import sys

from katalog import KEYS, ROLLEN_NAMEN, rechte_von

WURZEL = os.path.join(os.path.dirname(__file__), "..", "..")
RECHTE = {r: rechte_von(r) for r in ROLLEN_NAMEN}

# Pfad-Teil -> Katalog-Module (Präfixe)
BEREICHE = [
    (r"personal|mitarbeiter|PersonalTabs|SvFragebogen|DoppelteHaushalt|Beschaeftigungs|Ausweis|FormularDokument|Dokument", ["personal.", "lohn.saison"]),
    (r"unterkunft|Unterkunft", ["unterkunft."]),
    (r"fahrzeug|Fahrzeug", ["fahrzeuge."]),
    (r"erfassung|arbeitskleidung|lager|ErfassungTabs|Stundenkonto|ZeitenZelle|GruppenAuswahl|arbeitsgruppen", ["erfassung.", "lohn.stundenkonto"]),
    (r"uebersicht|vorschuesse|auszahlungen|LohnTabs|AbzugAusnahmen|AbrechnungsHistorie|UmbuchungForm", ["lohn."]),
    (r"kasse|Kassen|Kasse", ["kasse.", "sonder.kasse_freigeben"]),
    (r"praemien|anbau|statistik|qualitaet|erntewirtschaft|Ernte|Mais|FeldKarte|Reihen", ["ernte."]),
    (r"vertrieb|Vertrieb|Stand|Tour", ["vertrieb."]),
    (r"management|Controlling", ["controlling", "personal.", "lohn."]),
    (r"aenderungsprotokoll", ["sonder.protokoll"]),
    (r"einstellungen|Einstellungen", ["einstellungen.", "erfassung.gruppen"]),
]

RX = re.compile(r"hatRolle\(\s*profile\s*,\s*((?:\"[a-z_]+\"\s*,?\s*)+)\)")


def rollen_von_recht(recht):
    return frozenset(r for r in ROLLEN_NAMEN if recht in RECHTE[r])


def kandidaten(pfad):
    praefixe = []
    for muster, p in BEREICHE:
        if re.search(muster, pfad):
            praefixe += p
    keys = [k for k in KEYS if any(k == p or k.startswith(p) for p in praefixe)] if praefixe else []
    return keys


def loesen(alt, keys):
    """Erst nur S, dann nur L, dann gemischt - jeweils maximal innerhalb alt."""
    for stufen in (("S",), ("L",), ("S", "L")):
        rechte = sorted({f"{k}:{s}" for k in keys for s in stufen})
        gew = [r for r in rechte if rollen_von_recht(r) <= alt]
        # nur die "stärksten" behalten: L weglassen, wenn S derselben Funktion reicht
        neu = frozenset().union(*[rollen_von_recht(r) for r in gew]) if gew else frozenset()
        if neu == alt:
            # Überflüssige entfernen (gierig)
            noetig = list(gew)
            for r in sorted(gew, key=lambda x: len(rollen_von_recht(x))):
                probe = [x for x in noetig if x != r]
                if probe and frozenset().union(*[rollen_von_recht(x) for x in probe]) == alt:
                    noetig = probe
            return noetig
    return None


def main():
    schreiben = "--schreiben" in sys.argv
    offen = 0
    for ordner in ("app", "components", "lib"):
        for wurzel, _, dateien in os.walk(os.path.join(WURZEL, ordner)):
            for d in dateien:
                if not d.endswith((".ts", ".tsx")):
                    continue
                pfad = os.path.join(wurzel, d)
                rel = os.path.relpath(pfad, WURZEL)
                text = open(pfad).read()
                if "hatRolle(" not in text or rel == "lib/rollen.ts":
                    continue
                keys = kandidaten(rel)

                def ersetzen(m):
                    nonlocal offen
                    alt = frozenset(re.findall(r'"([a-z_]+)"', m.group(1)))
                    if alt == frozenset({"admin"}):
                        print(f"ADMIN   {rel}: {m.group(0)}")
                        offen += 1
                        return m.group(0)
                    loes = loesen(alt, keys)
                    if loes is None:
                        loes = loesen(alt, KEYS)
                        if loes is None:
                            print(f"FEHLT   {rel}: {m.group(0)}")
                            offen += 1
                            return m.group(0)
                        print(f"GLOBAL  {rel}: {sorted(alt)} -> {loes}")
                    neu = "darf(profile, " + ", ".join(f'"{r}"' for r in loes) + ")"
                    if not schreiben:
                        print(f"ok      {rel}: {sorted(alt)} -> {neu}")
                    return neu

                neu_text = RX.sub(ersetzen, text)
                if schreiben and neu_text != text:
                    open(pfad, "w").write(neu_text)
    print(f"\n{offen} offen")


if __name__ == "__main__":
    main()
