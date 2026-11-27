"""Rollen + Katalog als Testdaten (lokaler Nachbau enthält nur die Struktur).

Aufruf: python3 seed_erzeugen.py > seed.sql  (Stand = katalog.py)
"""
import json
from katalog import KATALOG, START_ROLLEN


def q(s):
    return "'" + s.replace("'", "''") + "'"


print("delete from public.rolle where id like 't\\_%';")
print("insert into public.recht_katalog (id, modul, titel, unter, sensibel, nur_lesen, sortierung) values")
print(",\n".join(f"({q(k)}, {q(m)}, {q(t)}, {q(u)}, {str(s).lower()}, {str(nl).lower()}, {i})"
                 for i, (k, m, t, u, s, nl) in enumerate(KATALOG)) + "\non conflict (id) do nothing;")
werte = ["('admin', 'Administrator', '', '{}'::jsonb, true, true, '{LW,VT}', 0)",
         "('geschaeftsfuehrer', 'Geschäftsführer', '', '{}'::jsonb, true, false, '{LW,VT}', 1)"]
for i, (k, bez, beschr, rechte) in enumerate(START_ROLLEN):
    werte.append(f"({q(k)}, {q(bez)}, '', {q(json.dumps(rechte, ensure_ascii=False))}::jsonb, false, false, '{{}}', {i + 2})")
print("insert into public.rolle (id, bezeichnung, beschreibung, rechte, alle_rechte, system_admin, bereiche, sortierung) values")
print(",\n".join(werte) + "\non conflict (id) do nothing;")
print("select public.profil_rechte_berechnen(null);")
