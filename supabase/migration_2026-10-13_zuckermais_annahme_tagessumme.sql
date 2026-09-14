-- Zuckermais: "Kisten i.O." nicht mehr doppelt erfassen (Nutzer-Feedback
-- 2026-09-14): "Kisten i.O." in der Strichliste (zuckermais_annahme) war
-- dieselbe Zahl wie zuckermais_rohdaten.kisten (die Prämien-Tagesmenge je
-- Person) - nur ein zweites Mal von Hand eingetippt. Ab jetzt wird in der
-- App nur noch die Nacharbeit zusätzlich erfasst; "i.O." leitet sich aus
-- den bereits erfassten Prämien-Kisten des Tages ab
-- (Prämien-Kisten - Nacharbeit), wird also nicht mehr gespeichert.
--
-- Zugleich Vereinfachung auf Tagesebene (Nutzer-Vorgabe: "Vormittag und
-- Nachmittag kann zu Tagessumme zusammengefasst werden") - Prämien kennt
-- ohnehin keine Halbschicht. Die Papier-Strichliste an der Kistenannahme
-- bleibt unverändert nach Vormittag/Nachmittag getrennt; nur die Zahl, die
-- am Ende in die App eingetippt wird, ist ab jetzt eine Tagessumme.
--
-- Re-runnable: drop/add constraint + drop column if exists.

alter table zuckermais_annahme drop constraint if exists zuckermais_annahme_uniq;
alter table zuckermais_annahme drop column if exists schicht;
alter table zuckermais_annahme drop column if exists kisten_io;
alter table zuckermais_annahme
  add constraint zuckermais_annahme_uniq unique (datum, employee_id);

drop index if exists idx_zuckermais_annahme_datum;
create index if not exists idx_zuckermais_annahme_datum
  on zuckermais_annahme (datum desc);

-- Ersetzt die bisherige Sicht: "i.O." und "gesamt" kommen jetzt aus den
-- Prämien-Kisten des Tages (zuckermais_rohdaten), nicht mehr aus einer
-- eigenen Spalte. Fehlt der Prämien-Eintrag noch (Kisten für den Tag noch
-- nicht erfasst), bleiben i.O./gesamt/Quote bewusst NULL statt fälschlich
-- 0 bzw. 100 % Nacharbeit zu suggerieren.
create or replace view zuckermais_annahme_quote as
select
  a.id,
  a.datum,
  a.employee_id,
  a.kisten_nacharbeit,
  a.notiz,
  a.erfasst_von,
  a.erfasst_am,
  a.updated_at,
  r.kisten as kisten_praemie,
  case
    when r.kisten is not null then greatest(r.kisten - a.kisten_nacharbeit, 0)
  end as kisten_io,
  r.kisten as kisten_gesamt,
  case
    when r.kisten is not null and r.kisten > 0
    then round(a.kisten_nacharbeit::numeric / r.kisten * 100, 1)
  end as nacharbeit_prozent,
  e.name as employee_name,
  e.vorname as employee_vorname,
  e.personal_nr
from zuckermais_annahme a
join employees e on e.id = a.employee_id
left join zuckermais_rohdaten r
  on r.employee_id = a.employee_id and r.datum = a.datum;

alter view zuckermais_annahme_quote set (security_invoker = true);
grant select on zuckermais_annahme_quote to authenticated;

-- Ersatzlos entfallen: bei Tagesgranularität ist zuckermais_annahme_quote
-- bereits die "je Tag"-Zeile, eine eigene Aggregat-Sicht braucht es nicht
-- mehr (die Statistik summiert die Jahres-Zeilen wie gehabt clientseitig).
drop view if exists zuckermais_annahme_person_tag;
