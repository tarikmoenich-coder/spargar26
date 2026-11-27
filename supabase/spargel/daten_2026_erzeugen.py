"""Erzeugt die einmalige Datenübernahme Spargelprämien 2026 aus der Excel.

Aufruf (openpyxl nötig):
  python3 daten_2026_erzeugen.py <Spargelprämien_2026.xlsx> > daten/spargel_2026_daten.sql
Quelle: Blatt "1 Rohdaten Flächen", Spalten C-O (Import des alten Programms) + P
(wirksame Kategorie). Felder über feld_zuordnung_2026.csv. Die Ausgabe enthält
Leistungsdaten je Personalnummer -> nicht ins Repository (daten/ ist ignoriert).
"""
import csv
import datetime
import os
import sys

import openpyxl

HIER = os.path.dirname(os.path.abspath(__file__))
STUNDENSATZ_2026 = "13.90"  # wie in der Excel (Feldstufen!L2)


def feldname(x):
    s = str(x).strip()
    try:  # Excel enthält teils falsch kodierte Umlaute (DÃ¼nen)
        s = s.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return s


def q(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"


def zahl(x):
    return "null" if x is None or x == "" else repr(float(x))


def main():
    zuordnung = {r["feld_excel"]: (r["feld_id"] or None)
                 for r in csv.DictReader(open(os.path.join(HIER, "feld_zuordnung_2026.csv")), delimiter=";")}
    wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
    zeilen = []
    fehlend = set()
    for r in wb["1 Rohdaten Flächen"].iter_rows(min_row=4, values_only=True):
        pnr, datum = r[2], r[3]
        if pnr is None or not isinstance(datum, datetime.datetime):
            continue
        nachname = str(r[4] or "")
        gruppe = nachname.strip() if nachname.strip().startswith("Gruppe") else None
        fn = feldname(r[11]) if r[11] is not None else None
        if fn is not None and fn not in zuordnung:
            fehlend.add(fn)
        fid = zuordnung.get(fn) if fn else None
        preis = r[7]
        kv = round((1.05 - float(preis)) / 0.05 * 2) / 2 if isinstance(preis, (int, float)) and preis > 0 else None
        kat = r[15] if isinstance(r[15], (int, float)) and r[15] > 0 else None
        zeilen.append("(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)" % (
            q(datum.date().isoformat()), q(str(pnr).strip()), q(gruppe), fid or "null", q(fn),
            zahl(r[6] or 0), zahl(r[9] or 0), "null" if r[10] is None else int(r[10]), zahl(kv), zahl(kat)))
    if fehlend:
        raise SystemExit(f"Feldnamen ohne Zuordnung: {sorted(fehlend)}")
    print(f"""-- Spargelprämien: Übernahme Saison 2026 aus der Excel ({len(zeilen)} Zeilen).
-- Erzeugt von supabase/spargel/daten_2026_erzeugen.py. Voraussetzung: Migration 2026-11-28d.
-- Einmalig ausführen (ein Block; bricht ab, wenn 2026 schon übernommen ist).
do $daten$
declare v_n int; v_ohne int;
begin
  if exists (select 1 from public.spargel_tag where quelle = 'excel_2026') then
    raise exception 'Saison 2026 wurde schon übernommen.';
  end if;
  insert into public.spargel_tag (datum, employee_id, personal_nr, gruppe, feld_id, feld_name, kg, stunden,
                                  kisten, kategorie_vorschlag, kategorie, stundensatz, quelle, lohnwirksam)
  select d.datum::date, e.id, d.pnr, d.gruppe, f.id, d.feld_name, d.kg, d.stunden, d.kisten, d.kv, d.kat,
         {STUNDENSATZ_2026}, 'excel_2026', false
  from (values
{chr(10).join('    ' + z + ',' for z in zeilen)[:-1]}
  ) d(datum, pnr, gruppe, feld_id, feld_name, kg, stunden, kisten, kv, kat)
  left join public.employees e on e.personal_nr = d.pnr and d.gruppe is null
  left join public.feld f on f.id = d.feld_id;

  -- Standard-Kategorie je Feld = erste Kategorie des Feldes (am ersten Erntetag die häufigste)
  insert into public.spargel_feld_kategorie (saison_jahr, feld_id, kategorie)
  select distinct on (feld_id) 2026, feld_id, kategorie
  from (select feld_id, datum, kategorie, count(*) as n from public.spargel_tag
        where quelle = 'excel_2026' and feld_id is not null and kategorie is not null
        group by feld_id, datum, kategorie) x
  order by feld_id, datum, n desc, kategorie
  on conflict do nothing;

  select count(*), count(*) filter (where employee_id is null and gruppe is null)
    into v_n, v_ohne from public.spargel_tag where quelle = 'excel_2026';
  raise notice 'Spargel 2026: % Zeilen übernommen, davon % ohne passende Personalnummer', v_n, v_ohne;
end
$daten$;""")


if __name__ == "__main__":
    main()
