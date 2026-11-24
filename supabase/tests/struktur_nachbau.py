import json, sys, re
d = json.load(open(sys.argv[1]))
out = []
w = out.append
w("set check_function_bodies = off;")
w("create domain public.geometry as bytea;  -- PostGIS-Stub (lokal nicht installiert)")
w("create domain public.geography as bytea;")
for e in d['enums'] or []:
    vals = ", ".join("'" + v.replace("'", "''") + "'" for v in e['v'])
    w(f"create type public.{e['n']} as enum ({vals});")
# Sequenzen, die keine identity sind
idseq = set()
for s in d['sequences'] or []:
    o = s.get('owned')
    if o and o.get('dep') == 'i':
        continue
    w(f"create sequence public.{s['n']};")
# Tabellen ohne Constraints
for t in d['tables']:
    cols = []
    for c in t['cols']:
        typ = c['t']
        if 'geometry' in typ: typ = 'public.geometry'
        s = f'  "{c["c"]}" {typ}'
        if c['id']:
            s += " generated " + ("always" if c['id'] == 'a' else "by default") + " as identity"
        elif c['gen'] == 's':
            s += f" generated always as ({c['def']}) stored"
        elif c['def'] is not None:
            s += f" default {c['def']}"
        if c['nn']: s += " not null"
        cols.append(s)
    w(f'create table public."{t["n"]}" (\n' + ",\n".join(cols) + "\n);")
# Funktionen (vor Views/Constraints, Bodies nicht geprüft)
funcs = d['functions'] or []
for f in funcs:
    w(f['def'].rstrip() + ";")
# PK/Unique/Check/Exclude
for t in d['tables']:
    for c in t['cons'] or []:
        if c['type'] in ('p', 'u', 'c', 'x'):
            w(f'alter table public."{t["n"]}" add constraint "{c["n"]}" {c["def"]};')
for t in d['tables']:
    for c in t['cons'] or []:
        if c['type'] == 'f':
            w(f'alter table public."{t["n"]}" add constraint "{c["n"]}" {c["def"]};')
# Views topologisch
views = {v['n']: v for v in d['views']}
done = set(); order = []
def visit(n, stack=()):
    if n in done or n not in views: return
    for dep in views[n]['deps'] or []:
        if dep != n: visit(dep, stack + (n,))
    done.add(n); order.append(n)
for n in sorted(views): visit(n)
for n in order:
    v = views[n]
    opt = ""
    if v['opt']: opt = " with (" + ", ".join(v['opt']) + ")"
    kw = "materialized view" if v['kind'] == 'm' else "view"
    w(f'create {kw} public."{n}"{opt} as\n{v["def"].rstrip().rstrip(";")};')
for f in funcs:
    w(f['def'].rstrip() + ';')
for i in d['indexes'] or []:
    w(i + ";")
for t in d['triggers'] or []:
    w(t + ";")
# RLS + Policies
for t in d['tables']:
    if t['rls']: w(f'alter table public."{t["n"]}" enable row level security;')
    if t['force']: w(f'alter table public."{t["n"]}" force row level security;')
cmdmap = {'r': 'select', 'a': 'insert', 'w': 'update', 'd': 'delete', '*': 'all'}
for p in d['policies'] or []:
    roles = ", ".join(r if r == 'public' else f'"{r}"' for r in p['roles'])
    s = f'create policy "{p["n"]}" on {p["s"]}."{p["t"]}" as {"permissive" if p["perm"] else "restrictive"} for {cmdmap[p["cmd"]]} to {roles}'
    if p['using']: s += f" using ({p['using']})"
    if p['check']: s += f" with check ({p['check']})"
    w(s + ";")
# Grants (ACL-Strings) für Tabellen/Views/Sequenzen/Spalten/Funktionen
privmap = {'r':'select','a':'insert','w':'update','d':'delete','D':'truncate','x':'references','t':'trigger','U':'usage','X':'execute'}
def acl_grants(acl, obj, kind, col=None):
    if not acl: return
    for item in acl.strip('{}').split(','):
        item = item.strip('"')
        m = re.match(r'^(.*)=([a-zA-Z*]*)/(.*)$', item)
        if not m: continue
        role, privs, _ = m.groups()
        role = role or 'public'
        if role in ('postgres', 'supabase_admin', 'pg_database_owner'): continue
        ps = [privmap[ch] for ch in privs if ch in privmap]
        if kind == 'seq': ps = [p for p in ps if p in ('select','update','usage')]
        if kind == 'func': ps = [p for p in ps if p == 'execute']
        if not ps: continue
        rr = 'public' if role == 'public' else f'"{role}"'
        # Spaltenliste gilt in SQL nur für das direkt davor stehende Recht -
        # deshalb je Recht einzeln: grant select (c), insert (c) ...
        if col: w(f'grant {", ".join(p + " (" + col + ")" for p in ps)} on {obj} to {rr};')
        elif kind == 'func': w(f'grant execute on function {obj} to {rr};')
        elif kind == 'seq': w(f'grant {", ".join(ps)} on sequence {obj} to {rr};')
        else: w(f'grant {", ".join(ps)} on {obj} to {rr};')
w("revoke all on all tables in schema public from anon, authenticated;")
w("revoke all on all functions in schema public from public, anon, authenticated;")
for t in d['tables']:
    acl_grants(t['acl'], f'public."{t["n"]}"', 'tab')
    for c in t['cols']:
        acl_grants(c['acl'], f'public."{t["n"]}"', 'tab', col=f'"{c["c"]}"')
for v in d['views']:
    acl_grants(v['acl'], f'public."{v["n"]}"', 'tab')
for s in d['sequences'] or []:
    acl_grants(s['acl'], f'public."{s["n"]}"', 'seq')
for f in funcs:
    obj = f'public."{f["n"]}"({f["args"]})'
    if f['acl'] is None:
        w(f'grant execute on function {obj} to public;')
    else:
        acl_grants(f['acl'], obj, 'func')
print("\n".join(out))
