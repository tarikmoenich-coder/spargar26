"""Übersetzt alle alten Rollenprüfungen (hat_rolle(ARRAY[...])) in Rechte-Prüfungen.

Aufruf: python3 umschreiben.py struktur.json [--sql]
Ohne --sql: Prüfbericht (je Vorkommen alte vs. neue Rollenmenge).
Mit --sql: SQL, das Policies/Views/Funktionen im Live-Stand umschreibt.
"""
import json
import re
import sys

from katalog import ROLLEN_NAMEN, rechte_von
from zuordnung import (BUCKET, BUCKET_LESEN_AUCH, ERWARTET, FUNKTION, FUNKTION_LESEN, LESEN_AUCH,
                       TABELLE, UEBERSTEUERT, VIEW)

RX = re.compile(r"hat_rolle\(\s*(?:ARRAY|array)\[([^\]]*)\]\s*(?:::\s*(?:public\.)?user_role\[\])?\s*\)")
RECHTE = {r: rechte_von(r) for r in ROLLEN_NAMEN}


def rollen_menge(text):
    return frozenset(re.sub(r"'|::(public\.)?user_role|\s", "", y) for y in text.split(","))


def rollen_von_recht(recht):
    return frozenset(r for r in ROLLEN_NAMEN if recht in RECHTE[r])


def uebersetzen(alt, kandidaten, stufe):
    """Alle Rechte aus den Kandidaten, deren Rollen in `alt` liegen."""
    rechte = sorted({k if ":" in k else f"{k}:{stufe}" for k in kandidaten})
    gewaehlt = [r for r in rechte if rollen_von_recht(r) <= alt]
    neu = frozenset().union(*[rollen_von_recht(r) for r in gewaehlt]) if gewaehlt else frozenset()
    return gewaehlt, neu


def ausdruck(rechte):
    if not rechte:
        return "false"
    return "public.darf_any(array[" + ", ".join(f"'{r}'" for r in rechte) + "])"


def vorkommen(d):
    """(art, objekt, kontext, alte_rollen, match_text) für alle Vorkommen."""
    for p in d["policies"]:
        for feld in ("using", "check"):
            for m in RX.finditer(p.get(feld) or ""):
                yield ("policy", p["t"], p, feld, rollen_menge(m.group(1)), m.group(0))
    for v in d["views"]:
        for m in RX.finditer(v["def"]):
            yield ("view", v["n"], v, None, rollen_menge(m.group(1)), m.group(0))
    for f in d["functions"]:
        n = re.search(r"FUNCTION public\.(\w+)", f["def"]).group(1)
        for m in RX.finditer(f["def"]):
            yield ("funktion", n, f, None, rollen_menge(m.group(1)), m.group(0))


def kandidaten_fuer(art, obj, kontext):
    if art == "policy":
        p = kontext
        lesen = p["cmd"] == "r"
        if obj == "objects":
            b = re.search(r"bucket_id = '([^']+)'", (p.get("using") or "") + (p.get("check") or "")).group(1)
            k = list(BUCKET.get(b, []))
            if lesen:
                k += BUCKET_LESEN_AUCH.get(b, [])
            return k, ("L" if lesen else "S")
        k = list(TABELLE.get(obj, []))
        if lesen:
            k += LESEN_AUCH.get(obj, [])
        return k, ("L" if lesen else "S")
    if art == "view":
        return VIEW.get(obj, []), "L"
    if obj in FUNKTION_LESEN:
        return FUNKTION_LESEN[obj], "L"
    return FUNKTION.get(obj, []), "S"


def main():
    d = json.load(open(sys.argv[1]))
    fehler = 0
    zeilen = []
    for art, obj, kontext, feld, alt, text in vorkommen(d):
        if obj in ("hat_rolle", "is_admin", "current_bereiche", "rechnung_speichern", "vt_darf",
                   "unterkunft_vorgang_schutz", "unterkunft_vorgang_kind_schutz"):
            continue  # werden von Hand ersetzt
        kand, stufe = kandidaten_fuer(art, obj, kontext)
        gew, neu = uebersetzen(alt, kand, stufe)
        if art == "policy" and (obj, kontext["n"], feld) in UEBERSTEUERT:
            gew = UEBERSTEUERT[(obj, kontext["n"], feld)]
            neu = frozenset().union(*[rollen_von_recht(r) for r in gew])
        ok = neu == alt
        status = "ok" if ok else ("ERWARTET " + ERWARTET[obj] if obj in ERWARTET else "FEHLT")
        if not ok and obj not in ERWARTET:
            fehler += 1
        cmd = kontext["cmd"] if art == "policy" else ""
        zeilen.append(f"{status:8} {art:8} {obj:38} {cmd:2} alt={','.join(sorted(alt))}"
                      + ("" if ok else f"  neu={','.join(sorted(neu))}") + f"  -> {' '.join(gew)}")
    for z in sorted(zeilen):
        if not z.startswith("ok"):
            print(z)
    print(f"\n{len(zeilen)} Vorkommen, {fehler} ungeklärt")


if __name__ == "__main__":
    main()
