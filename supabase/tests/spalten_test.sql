-- Spaltentest Stufe 0c: je Rolle, welche heiklen employees-Felder sind über
-- welchen Weg lesbar/schreibbar? Läuft nach rechte_matrix.sql (nutzt _subjekt).
\set QUIET on
create temp table _sp (subjekt text, pruefung text, ergebnis text);
do $$
declare
  s public._subjekt;
  t record;
  n bigint;
  erg text;
begin
  for s in select * from public._subjekt order by name loop
    for t in select * from (values
      ('employees: Grunddaten',        'select count(*) from (select id, personal_nr, name, vorname, aktiv, gruppe_nr, herkunft from public.employees) x'),
      ('employees: iban direkt',       'select count(iban) from public.employees'),
      ('employees: stundenlohn direkt','select count(stundenlohn) from public.employees'),
      ('employees: sv-nr direkt',      'select count(sozialversicherungsnummer) from public.employees'),
      ('employees: select *',          'select count(*) from (select * from public.employees) x'),
      ('personaldaten: lesen',         'select count(*) from public.employee_personaldaten'),
      ('bankdaten: lesen',             'select count(*) from public.employee_bankdaten'),
      ('lohndaten: lesen',             'select count(*) from public.employee_lohndaten'),
      ('checkliste: lesen',            'select count(*) from public.personal_kandidaten_checkliste'),
      ('personaldaten: iban ändern',   'with u as (update public.employee_personaldaten set iban = iban returning 1) select count(*) from u'),
      ('employees: iban ändern direkt','with u as (update public.employees set iban = iban returning 1) select count(*) from u'),
      ('personaldaten: anlegen',       'with u as (insert into public.employee_personaldaten (personal_nr, name, vorname, iban) values (''SPTEST'', ''X'', ''Y'', ''DE00'') returning 1) select count(*) from u')
    ) as v(pruefung, sql) loop
      begin
        perform public._als(s);
        execute t.sql into n;
        erg := n::text;
        raise exception 'ZURUECK';
      exception when raise_exception then if sqlerrm <> 'ZURUECK' then erg := 'fehler:' || sqlerrm; end if;
                when insufficient_privilege then erg := 'nein';
                when check_violation then erg := 'nein(check)';
                when others then erg := 'fehler:' || sqlstate || ' ' || left(sqlerrm, 60);
      end;
      perform set_config('role', 'none', true);
      insert into _sp values (s.name, t.pruefung, erg);
    end loop;
  end loop;
end $$;
\set QUIET off
select pruefung,
  string_agg(subjekt || '=' || ergebnis, '  ' order by subjekt) as ergebnis
from _sp where subjekt not in ('anon') group by pruefung order by pruefung;
