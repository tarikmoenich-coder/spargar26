-- Realistische Lohn-Testdaten (30 Personen, 2 Saisons) für den Vorher/Nachher-
-- Nachweis der Lohnberechnung (Stufe 3c). Lokal nach rechte_test.sh, NICHT live.
set session_replication_role = replica;
insert into verpflegungssaetze (saison_jahr, verpflegung, wohnen, mindestlohn, kleidung_hose, kleidung_jacke, kleidung_stiefel)
  values (2025, 9.5, 8.25, 12.82, 15, 30, 25), (2026, 10, 10, 13.90, 16, 31, 26) on conflict (saison_jahr) do nothing;
insert into employees (personal_nr, name, vorname, stundenlohn, abrechnungsart, bereich)
  select 'L'||g, 'Name'||g, 'V', 12.5 + (g % 4), (array['pauschal','lohnsteuerklasse_1','sozialversicherungspflichtig'])[1 + g % 3]::abrechnungsart, 'LW'
  from generate_series(1,30) g;
insert into work_entries (employee_id, datum, stunden, markierung)
  select e.id, d::date, case when extract(dow from d) = 0 then null else 6 + (abs(hashtext(e.id::text || d::text)) % 5) end,
         case when extract(dow from d) = 0 and abs(hashtext(e.id::text)) % 3 = 0 then 'U' end
  from employees e cross join generate_series('2025-04-01'::date, '2025-07-15', '1 day') d where e.personal_nr like 'L%'
  union all
  select e.id, d::date, 7.5, null from employees e cross join generate_series('2026-04-10'::date, '2026-06-30', '1 day') d where e.personal_nr like 'L%';
insert into season_bonuses (employee_id, saison_jahr, akkord_betrag, bus_hin, bus_rueck, fahrer_kaution, zimmer_kaution, verpflegungsfreie_tage, kleidung_hose_anzahl, kleidung_jacke_anzahl, netto_extern)
  select id, 2025, 50, 80, 80, 0, 100, (abs(hashtext(id::text)) % 4), 1, 1, 2000 from employees where personal_nr like 'L%'
  on conflict do nothing;
insert into advances (belegnummer, datum, betrag, zahlungsart, art) select 'LV'||g, '2025-05-01'::timestamptz + (g||' days')::interval, 100, 'BAR', 'Vorschuss' from generate_series(1,30) g;
insert into advance_recipients (advance_id, employee_id, anteil)
  select a.id, e.id, 100 from (select id, row_number() over (order by id) r from advances where belegnummer like 'LV%') a
  join (select id, row_number() over (order by personal_nr) r from employees where personal_nr like 'L%') e on e.r = a.r;
set session_replication_role = default;
