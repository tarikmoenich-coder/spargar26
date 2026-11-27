"""Rechte-Matrix als Markdown-Tabelle (aus psql-Export von public._matrix).

Zelle: L = lesen (Zeilen sichtbar), A = anlegen, Ä = ändern, X = löschen,
· = verweigert bzw. 0 Zeilen, ? = Fehler. Views haben nur L.
Aufruf: python3 matrix_bericht.py matrix.txt > bericht.md
"""
import sys

SUBJEKTE = ["anon", "ohne_profil", "inaktiv_admin", "admin", "geschaeftsfuehrer", "hr", "zeiterfassung",
            "kasse", "lohnabrechnung", "pruefer", "management", "erntewirtschaft",
            "hausmeister", "waage"]
m = {}
for zeile in open(sys.argv[1]):
    if not zeile.strip():
        continue
    rel, art, sub, erg = zeile.rstrip("\n").split("|")
    m.setdefault(rel, {}).setdefault(sub, {})[art] = erg


def ok(v):
    return v not in ("nein", "0") and not v.startswith("fehler")


def zelle(d):
    if not d:
        return ""
    sel = d.get("select", "nein")
    s = "L" if ok(sel) else ("?" if sel.startswith("fehler") else "·")
    if "insert" in d:
        s += "A" if ok(d["insert"]) else ("?" if d["insert"].startswith("fehler") else "·")
        s += "Ä" if ok(d["update"]) else ("?" if d["update"].startswith("fehler") else "·")
        s += "X" if ok(d["delete"]) else ("?" if d["delete"].startswith("fehler") else "·")
    return s


print("| Tabelle/View | " + " | ".join(SUBJEKTE) + " |")
print("|---|" + "---|" * len(SUBJEKTE))
for rel in sorted(m):
    print(f"| `{rel}` | " + " | ".join(zelle(m[rel].get(s)) for s in SUBJEKTE) + " |")
