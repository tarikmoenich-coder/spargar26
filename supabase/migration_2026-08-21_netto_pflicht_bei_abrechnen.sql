-- Migration 2026-08-21: "Jetzt Abrechnen" verweigert fehlenden Netto-Betrag
--
-- Nutzer-Vorgabe: "Mir ist es nun schon mehrfach passiert, dass ich auf
-- 'jetzt abrechnen' geklickt habe und vergessen habe den Netto-Betrag aus
-- dem Lohnprogramm einzugeben. Das muss unterbunden werden. Ein Fehler
-- muss aufpoppen, wenn ein Brutto Wert, aber kein dazugehöriger
-- Netto-Wert existiert."
--
-- Betrifft nur Lohnsteuerklasse 1/sozialversicherungspflichtig (dort trägt
-- Lohnbuchhaltung netto_extern von Hand ein) - bei 'pauschal' ist netto
-- immer automatisch berechnet, nie null.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

create or replace function saison_abrechnen_batch(
  p_employee_ids uuid[],
  p_saison_jahr int,
  p_zahlungsart text default 'BAR'
)
returns text language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neuer_beleg_id bigint;
  neue_belegnummer text;
  emp_id uuid;
  v_war_abgerechnet boolean;
  v_voller_stand jsonb;
  v_zeile jsonb;
  v_fehlende_namen text;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
  end if;

  -- Nutzer-Vorgabe 2026-08-21: "ich habe vergessen, den Netto-Betrag aus
  -- dem Lohnprogramm einzugeben" (mehrfach passiert) - blockiert das
  -- gesamte Abrechnen, wenn mindestens eine ausgewählte Person einen
  -- Bruttolohn > 0 hat, aber noch keinen Netto-Betrag. Betrifft nur
  -- Lohnsteuerklasse 1/sozialversicherungspflichtig (dort trägt
  -- Lohnbuchhaltung netto_extern von Hand ein, siehe season_bonuses) -
  -- bei 'pauschal' ist netto immer automatisch berechnet, nie null.
  select string_agg(s2.name || ', ' || s2.vorname, '; ')
    into v_fehlende_namen
  from season_summary s2
  where s2.employee_id = any(p_employee_ids)
    and s2.saison_jahr = p_saison_jahr
    and s2.bruttolohn > 0
    and s2.netto is null;

  if v_fehlende_namen is not null then
    raise exception 'Bitte zuerst den Netto-Betrag aus dem Lohnprogramm eintragen für: %', v_fehlende_namen;
  end if;

  neue_belegnummer := naechste_belegnummer('AZ-' || to_char(now(), 'MM-YYYY'));

  insert into auszahlungsbelege (belegnummer, saison_jahr, zahlungsart, erstellt_von)
  values (neue_belegnummer, p_saison_jahr, p_zahlungsart, auth.uid())
  returning id into neuer_beleg_id;

  foreach emp_id in array p_employee_ids loop
    select * into s from season_summary
    where employee_id = emp_id and saison_jahr = p_saison_jahr;

    if found then
      -- Nutzer-Vorgabe 2026-08-21: war diese Person für dieses Saisonjahr
      -- schon EINMAL abgerechnet (z.B. reaktiviert und mit nachgetragenen
      -- Stunden), zeigt dieser Beleg nur die DIFFERENZ seit der letzten
      -- Abrechnung, nicht nochmal den vollen (kumulierten) Saison-Betrag -
      -- siehe auszahlungsbeleg_zeilen weiter oben.
      v_war_abgerechnet := s.abgerechnet_am is not null;
      -- 'snapshot' aus s selbst entfernen, sonst würde sich bei mehrfachem
      -- Abrechnen derselben Person der alte Schnappschuss im neuen
      -- verschachteln.
      v_voller_stand := to_jsonb(s) - 'snapshot';
      if v_war_abgerechnet then
        v_zeile := auszahlungsbeleg_zeile_differenz(v_voller_stand, s.snapshot);
      else
        v_zeile := v_voller_stand;
      end if;

      insert into auszahlungsbeleg_zeilen (
        auszahlungsbeleg_id, employee_id, saison_jahr, personal_nr, name,
        vorname, abrechnungsart, ist_differenz, zeile
      )
      values (
        neuer_beleg_id, emp_id, p_saison_jahr, s.personal_nr, s.name,
        s.vorname, s.abrechnungsart, v_war_abgerechnet, v_zeile
      );

      -- season_bonuses bleibt weiterhin der laufende GESAMTSTAND der Saison
      -- (Basis für die Abweichungsanzeige auf der Lohnübersicht und für den
      -- Vergleichswert beim nächsten Differenzbeleg oben) - hier also
      -- unverändert der volle kumulierte Stand, nicht die Differenz.
      insert into season_bonuses (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        snapshot, auszahlungsbeleg_id
      )
      values (
        emp_id, p_saison_jahr, now(), auth.uid(),
        v_voller_stand, neuer_beleg_id
      )
      on conflict (employee_id, saison_jahr)
      do update set
        abgerechnet_am = now(),
        abgerechnet_von = auth.uid(),
        snapshot = excluded.snapshot,
        auszahlungsbeleg_id = neuer_beleg_id;

      -- Zusätzlich in die Historie (siehe saison_abrechnungen):
      -- season_bonuses überschreibt abgerechnet_am bei erneutem Abrechnen,
      -- die SV-Prüfung braucht aber jeden einzelnen Abschnitts-Endzeitpunkt.
      insert into saison_abrechnungen (
        employee_id, saison_jahr, abgerechnet_am, abgerechnet_von,
        auszahlungsbeleg_id
      )
      values (emp_id, p_saison_jahr, now(), auth.uid(), neuer_beleg_id);

      update employees set aktiv = false where id = emp_id;
    end if;
  end loop;

  return neue_belegnummer;
end;
$$;

grant execute on function saison_abrechnen_batch(uuid[], int, text) to authenticated;
