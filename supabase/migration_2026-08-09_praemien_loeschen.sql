-- Nutzer-Vorgabe 2026-08-09: versehentlich am falschen Tag (bzw. an der
-- falschen Parzelle) eingetragene Prämien-Werte müssen wieder rauszu-
-- bekommen sein ("Alle speichern" löscht jetzt einen bereits bestehenden
-- Eintrag, wenn er auf 0 zurückgesetzt wurde). Dafür fehlte bisher eine
-- DELETE-Berechtigung. GLEICHZEITIG aber: "ein Wert, der eine
-- abgeschlossene Auszahlung betrifft, sollte nicht mehr abgeändert werden
-- dürfen" - Schreiben/Ändern/Löschen ist deshalb ab sofort gesperrt,
-- sobald die betroffene Person für die jeweilige Saison bereits
-- abgerechnet ("Jetzt Abrechnen") ist.

-- Prüft, ob eine Person für die Saison, in die das übergebene Datum fällt,
-- bereits abgerechnet ist. security definer, da season_bonuses selbst nur
-- für admin/lohnabrechnung lesbar ist (season_bonuses_rw) -
-- zeiterfassung/erntewirtschaft dürfen Prämien erfassen, aber nicht
-- direkt in season_bonuses schauen; ohne security definer würde die
-- Prüfung für sie immer "nicht abgerechnet" ergeben.
create or replace function ist_saison_abgerechnet(p_employee_id uuid, p_datum date)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from season_bonuses b
    where b.employee_id = p_employee_id
      and b.saison_jahr = extract(year from p_datum)::int
      and b.abgerechnet_am is not null
  );
$$;

drop policy if exists "zuckermais_rohdaten_write" on zuckermais_rohdaten;
create policy "zuckermais_rohdaten_write" on zuckermais_rohdaten for insert
  with check (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );

drop policy if exists "zuckermais_rohdaten_update" on zuckermais_rohdaten;
create policy "zuckermais_rohdaten_update" on zuckermais_rohdaten for update
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );

create policy "zuckermais_rohdaten_delete" on zuckermais_rohdaten for delete
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );

drop policy if exists "erdbeeren_rohdaten_write" on erdbeeren_rohdaten;
create policy "erdbeeren_rohdaten_write" on erdbeeren_rohdaten for insert
  with check (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );

drop policy if exists "erdbeeren_rohdaten_update" on erdbeeren_rohdaten;
create policy "erdbeeren_rohdaten_update" on erdbeeren_rohdaten for update
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );

create policy "erdbeeren_rohdaten_delete" on erdbeeren_rohdaten for delete
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
    and not ist_saison_abgerechnet(employee_id, datum)
  );
