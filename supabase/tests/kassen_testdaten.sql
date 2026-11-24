-- Realistischer Geldbestand (2 Jahre) für den Kassenstand-Vorher/Nachher-Test
-- (Stufe 3b). Lokal nach rechte_test.sh ausführen, NICHT live.
set session_replication_role = replica;
insert into cash_deposits (belegnummer, datum, betrag, verwendungszweck, storniert)
  select 'E'||g, now() - (g*3 || ' days')::interval, 500 + g, 'Einzahlung', (g % 17 = 0) from generate_series(1,240) g;
insert into advances (belegnummer, datum, betrag, zahlungsart, storniert, art)
  select 'V'||g, now() - (g*2 || ' days')::interval - interval '5 hours', 37.5 + (g % 9), case when g % 5 = 0 then 'BÜ' when g % 11 = 0 then 'N/A' else 'BAR' end, (g % 13 = 0), 'Vorschuss'
  from generate_series(1,360) g;
insert into auszahlungsbelege (belegnummer, saison_jahr, zahlungsart, erstellt_am)
  select 'AZ'||g, 2025 + (g % 2), case when g % 4 = 0 then 'AZ' else 'BAR' end, now() - (g*9 || ' days')::interval from generate_series(1,80) g;
insert into auszahlungsbeleg_zeilen (auszahlungsbeleg_id, employee_id, saison_jahr, personal_nr, name, vorname, abrechnungsart, zeile)
  select ab.id, e.id, ab.saison_jahr, 'P1', 'N', 'V', 'pauschal', jsonb_build_object('auszahlungsbetrag', 100 + (ab.id % 50) + 0.37)
  from auszahlungsbelege ab cross join (select id from employees limit 1) e
  on conflict do nothing;
insert into kautionsuebergaben (belegnummer, auszahlungsbeleg_id, uebergeben_an, betrag_summe, erstellt_am, storniert)
  select 'K'||g, (select min(id) from auszahlungsbelege), 'X', 50 * g, now() - (g*20 || ' days')::interval, (g % 7 = 0) from generate_series(1,30) g;
insert into kassenbuch_buchung (kassenbuch_id, belegnummer, datum, datum_kassenbuch, betrag, richtung, storniert)
  select kb.id, kb.kuerzel||'-'||g, now() - (g*4 || ' days')::interval, current_date, 20 + g, case when g % 2 = 0 then 'eingang' else 'ausgang' end, (g % 19 = 0)
  from kassenbuch kb cross join generate_series(1,100) g;
set session_replication_role = default;
