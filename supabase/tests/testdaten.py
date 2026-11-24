"""Erzeugt synthetische Testdaten für die lokale Kopie der Live-Struktur.

Je Tabelle (in Fremdschlüssel-Reihenfolge) eine Zeile; Fremdschlüssel zeigen
auf die erste Zeile der Elterntabelle, damit Views mit Joins Ergebnisse
liefern. Keine echten Daten - nur Platzhalterwerte.

Aufruf: python3 testdaten.py struktur.json > testdaten.sql
"""
import json
import re
import sys

d = json.load(open(sys.argv[1]))
tabellen = {t["n"]: t for t in d["tables"]}
enums = {e["n"]: e["v"] for e in d["enums"] or []}

# Feste Werte für Spalten, deren Check-Constraints generische Werte ablehnen.
# Schlüssel: "tabelle.spalte" oder "*.spalte".
FEST = {
    "ernte_ausweis.suffix": "'ABCDEF12'",
    # Stammdaten, die live per Migration befüllt sind (Kopie hat keine Daten)
    "geschaeftsbereich.kuerzel": "'LW'",
    # live ist nur MLK eine Lohnkasse - die Test-Zeile ist ein allgemeines Buch
    "kassenbuch.typ": "'allgemein'",
    "geschaeftsbereich.bezeichnung": "'Landwirtschaft'",
    "work_entries.stunden": "8",
    "personal_kandidaten.status": "'anreiseliste'",
    "personal_kandidaten.aktivierter_employee_id": "(select id from public.employees limit 1)",
    "personal_kandidaten.verknuepfter_employee_id": "(select id from public.employees limit 1)",
    "personal_kandidaten.personal_nr": "'T-1'",
    "personal_kandidaten.name": "'Muster'",
    "personal_kandidaten.vorname": "'Max'",
    "*.geschlecht": "'M'",
    "*.richtung": "'ausgang'",
    "*.typ": None,  # je Tabelle unten
    "*.zahlungsart": "'BAR'",
    "*.status": None,
    "*.sprache": "'de'",
    "*.saison_jahr": "2026",
    "*.monat": "5",
    "*.jahr": "2026",
    "*.bis": None,
}


def fk_liste(t):
    fks = []
    for c in t["cons"] or []:
        if c["type"] != "f":
            continue
        m = re.match(
            r"FOREIGN KEY \(([^)]*)\) REFERENCES (?:public\.)?\"?((?:auth\.)?\w+)\"?\(([^)]*)\)",
            c["def"],
        )
        if not m:
            continue
        cols = [x.strip().strip('"') for x in m.group(1).split(",")]
        ref = m.group(2)
        refcols = [x.strip().strip('"') for x in m.group(3).split(",")]
        fks.append((cols, ref, refcols))
    return fks


def checks(t):
    return [c["def"] for c in t["cons"] or [] if c["type"] == "c"]


def wert_aus_check(spalte, chk):
    # "CHECK ((x = ANY (ARRAY['a'::text, 'b'::text])))" -> 'a'
    for c in chk:
        if re.search(r"\b%s\b" % re.escape(spalte), c):
            m = re.search(
                r"\b%s\b[^']*?ARRAY\[\s*'([^']*)'" % re.escape(spalte), c
            )
            if m:
                return "'" + m.group(1) + "'"
            m = re.search(r"\b%s\b\s*=\s*'([^']*)'" % re.escape(spalte), c)
            if m:
                return "'" + m.group(1) + "'"
    return None


def typwert(typ, spalte):
    base = typ.split("(")[0].strip()
    if typ.endswith("[]"):
        return "'{}'"
    if base in enums:
        return "'" + enums[base][0] + "'"
    if base.startswith("user_role"):
        return "'admin'"
    if base in ("text", "character varying", "character", "citext"):
        return "'t_" + spalte[:20] + "_' || substr(md5(random()::text), 1, 6)"
    if base in ("integer", "bigint", "smallint"):
        return "1"
    if base in ("numeric", "real", "double precision"):
        return "1"
    if base == "boolean":
        return "false"
    if base == "date":
        return "'2026-05-04'"
    if base.startswith("timestamp"):
        return "'2026-05-04 10:00+02'"
    if base.startswith("time"):
        return "'10:00'"
    if base == "uuid":
        return "gen_random_uuid()"
    if base in ("jsonb", "json"):
        return "'{}'"
    if base in ("bytea", "public.geometry", "geometry", "geography"):
        return "null"
    if base == "interval":
        return "'1 day'"
    if base == "inet":
        return "'127.0.0.1'"
    return "null"


# Topologische Reihenfolge
reihenfolge, fertig = [], set()


def besuche(n, stapel=()):
    if n in fertig or n not in tabellen or n in stapel:
        return
    for cols, ref, _ in fk_liste(tabellen[n]):
        if ref != n:
            besuche(ref, stapel + (n,))
    fertig.add(n)
    reihenfolge.append(n)


for n in sorted(tabellen):
    besuche(n)

seed_sql = []
out = ["set check_function_bodies = off;", "set session_replication_role = replica;  -- Trigger (Audit) beim Befüllen aus"]
out.append(
    "insert into auth.users(id, email) values "
    "('00000000-0000-0000-0000-0000000000a1', 'seed@test') on conflict do nothing;"
)
for n in reihenfolge:
    t = tabellen[n]
    fks = fk_liste(t)
    fkspalte = {}
    for cols, ref, refcols in fks:
        for c, rc in zip(cols, refcols):
            if ref == n:
                continue
            if ref in ("users", "auth.users"):
                fkspalte[c] = "'00000000-0000-0000-0000-0000000000a1'::uuid"
            else:
                fkspalte[c] = f'(select "{rc}" from public."{ref}" limit 1)'
    chk = checks(t)
    spalten, werte = [], []
    for c in t["cols"]:
        s = c["c"]
        if c["id"] or c["gen"]:
            continue
        if s in fkspalte:
            v = fkspalte[s]
        elif FEST.get(f"{n}.{s}"):
            v = FEST[f"{n}.{s}"]
        elif c["nn"] and c["def"] and "auth.uid()" in c["def"]:
            v = "'00000000-0000-0000-0000-0000000000a1'::uuid"
        elif not c["nn"] or c["def"] is not None:
            continue
        else:
            v = wert_aus_check(s, chk) or FEST.get(f"{n}.{s}") or FEST.get(f"*.{s}") or typwert(c["t"], s)
        spalten.append(f'"{s}"')
        werte.append(v)
    if spalten:
        sql = f'insert into public."{n}" ({", ".join(spalten)}) select {", ".join(werte)}'
    else:
        sql = f'insert into public."{n}" default values'
    out.append(sql + ";")
    seed_sql.append((n, sql))
out.append("create table if not exists public._seed_sql (tab text primary key, sql text);")
out.append("revoke all on public._seed_sql from anon, authenticated;")
for n, sql in seed_sql:
    out.append("insert into public._seed_sql values (%s, %s) on conflict (tab) do update set sql = excluded.sql;"
               % ("'" + n + "'", "$q$" + sql + "$q$"))
# Stammdaten, die live per Migration befüllt sind (die Strukturkopie hat
# keine Daten). Nur einfügen, wenn die Tabelle existiert.
STAMMDATEN = {
    "geschaeftsbereich": "insert into public.geschaeftsbereich (kuerzel, bezeichnung, personalnummer_praefix, reihenfolge) values ('VT', 'Vertrieb', 'V-', 20) on conflict do nothing;",
    "firma": "insert into public.firma (kuerzel, name, bereich, ist_standard, reihenfolge) values ('MA', 'Mömmel Agrar GmbH & Co. KG', 'LW', true, 10), ('ML', 'Mönich Landwirtschaft GmbH & Co. KG', 'LW', false, 20), ('MD', 'Mönich Direkt GmbH & Co. KG', 'VT', true, 30) on conflict do nothing;",
    "kassenbuch": "insert into public.kassenbuch (bezeichnung, kuerzel, typ, reihenfolge) values ('Mömmel Lohnkasse', 'MLK', 'lohnkasse', 1), ('Mömmel', 'MÖ', 'allgemein', 2), ('Mönich Landwirtschaft', 'ML', 'allgemein', 3), ('Mönich Direkt', 'MD', 'allgemein', 4) on conflict do nothing;",
}
for tab, sql in STAMMDATEN.items():
    if tab in tabellen:
        out.append(sql)
if "kassenbuch" in tabellen and any(c["c"] == "firma" for c in tabellen["kassenbuch"]["cols"]):
    out.append("update public.kassenbuch set firma = case kuerzel when 'MLK' then 'MA' when 'MÖ' then 'MA' when 'ML' then 'ML' when 'MD' then 'MD' end where kuerzel in ('MLK','MÖ','ML','MD');")
if "firma" in tabellen and "kassenbuch" in tabellen:
    out.append("update public.firma f set lohn_kassenbuch_id = kb.id from public.kassenbuch kb where (f.kuerzel, kb.kuerzel) in (('MA','MLK'),('ML','ML'),('MD','MD'));")
print("\n".join(out))
