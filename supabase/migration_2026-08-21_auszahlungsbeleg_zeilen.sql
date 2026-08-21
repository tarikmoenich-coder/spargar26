-- Migration 2026-08-21: Differenzbeleg für erneut abgerechnete Personen
--
-- Nutzer-Frage: "Person abgerechnet, deaktiviert, reaktiviert, Stunden
-- nachgetragen, erneut abgerechnet - kommt dann eine weitere Abrechnung?"
--
-- Untersuchung ergab zwei reale Probleme, beide mit derselben Ursache:
-- season_bonuses hat UNIQUE(employee_id, saison_jahr) und hält pro Person/
-- Jahr genau EINE Zeile inkl. snapshot (eingefrorener Stand) und
-- auszahlungsbeleg_id. saison_abrechnen_batch überschreibt diese Zeile bei
-- jedem erneuten Abrechnen.
--
-- 1. Doppelzahlungsrisiko: season_summary rechnet immer KUMULATIV für die
--    gesamte Saison, nie "seit der letzten Abrechnung". Ein erneutes
--    "Jetzt Abrechnen" für dieselbe Person zeigte wieder den KOMPLETTEN
--    Saison-Betrag, nicht nur die Differenz seit der letzten Abrechnung.
-- 2. Historische Belege wurden rückwirkend verfälscht: sowohl
--    auszahlungsbeleg_summary als auch die Auszahlungen-Seite lasen den
--    Beleg-Inhalt über season_bonuses.auszahlungsbeleg_id - sobald dieser
--    Verweis bei einer erneuten Abrechnung auf den neuen Beleg wanderte,
--    verschwand die Person (und ihr Betrag) rückwirkend aus dem alten,
--    bereits gedruckten/ausgezahlten Beleg (inkl. Kassenbuch-Summe und
--    Kautions-Kandidatenliste).
--
-- Lösung: neue, unveränderliche (append-only) Tabelle
-- auszahlungsbeleg_zeilen hält pro (Beleg, Person) die für GENAU DIESEN
-- Beleg gültigen Beträge fest, unabhängig davon, was später mit
-- season_bonuses passiert. season_bonuses bleibt unverändert bestehen und
-- weiterhin der laufende Gesamtstand der Saison. War eine Person für dieses
-- Saisonjahr schon einmal abgerechnet, erzeugt "Jetzt Abrechnen" nur noch
-- eine DIFFERENZ-Zeile (ist_differenz = true) statt des vollen,
-- kumulierten Saison-Betrags. Abschnitt 7 füllt zusätzlich bereits
-- bestehende Auszahlungsbelege einmalig aus season_bonuses nach, sonst
-- wären sie auf der Auszahlungen-Seite plötzlich nicht mehr sichtbar.
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug. Durchgehend mit "if not exists"/"drop ... if exists"/"on conflict do
-- nothing" geschrieben, damit ein erneutes Ausführen (z.B. nach einem
-- Abbruch mitten im Skript) gefahrlos möglich ist.

-- ---------------------------------------------------------------------------
-- 1. Neue Tabelle
-- ---------------------------------------------------------------------------
create table if not exists auszahlungsbeleg_zeilen (
  id bigint generated always as identity primary key,
  auszahlungsbeleg_id bigint not null references auszahlungsbelege (id),
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,
  personal_nr text not null,
  name text not null,
  vorname text not null,
  abrechnungsart text not null,
  -- true, wenn diese Zeile die DIFFERENZ zu einer früheren Abrechnung
  -- derselben Person/Saison ist (nicht der volle Saison-Betrag) - Person
  -- war also schon einmal für dieses Jahr abgerechnet und wurde seither
  -- reaktiviert.
  ist_differenz boolean not null default false,
  -- Gleiche Feldnamen wie season_summary (basis_brutto, praemien_summe,
  -- stundenkonto_auszahlung_betrag, bruttolohn, lohnsteuer_pauschal, netto,
  -- abzug_verpflegung, abzug_wohnen, vorschuss_summe, bus_kosten,
  -- fahrer_kaution, zimmer_kaution, kleidung_betrag, verpflegungsfreie_tage,
  -- gesamt_stunden, anwesenheitstage, auszahlungsbetrag) - bei
  -- ist_differenz = true die DIFFERENZ, sonst der volle Wert. Gleiche
  -- Struktur wie season_bonuses.snapshot, damit anzeige() im Frontend
  -- (app/auszahlungen/page.tsx) unverändert weiterverwendet werden kann.
  zeile jsonb not null,
  erstellt_am timestamptz not null default now()
);

create unique index if not exists idx_auszahlungsbeleg_zeilen_beleg_employee
  on auszahlungsbeleg_zeilen (auszahlungsbeleg_id, employee_id);

alter table auszahlungsbeleg_zeilen enable row level security;

-- auszahlungsbeleg_zeilen: enthält Beträge, deshalb wie season_bonuses/
-- auszahlungsbeleg_summary auf die Lohn-Rollen beschränkt (nicht wie
-- saison_abrechnungen für alle angemeldeten Rollen). Nur lesend per Policy -
-- geschrieben ausschließlich über saison_abrechnen_batch bzw. die
-- Korrektur-Funktionen (alle security definer).
drop policy if exists "auszahlungsbeleg_zeilen_select" on auszahlungsbeleg_zeilen;
create policy "auszahlungsbeleg_zeilen_select" on auszahlungsbeleg_zeilen for select
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management'));

-- ---------------------------------------------------------------------------
-- 2. Differenzbeleg-Hilfsfunktionen
-- ---------------------------------------------------------------------------
create or replace function auszahlungsbeleg_zeile_felder()
returns text[] language sql immutable as $$
  select array[
    'gesamt_stunden', 'anwesenheitstage', 'basis_brutto', 'praemien_summe',
    'stundenkonto_auszahlung_betrag', 'bruttolohn', 'lohnsteuer_pauschal',
    'netto', 'abzug_verpflegung', 'abzug_wohnen', 'vorschuss_summe',
    'bus_kosten', 'fahrer_kaution', 'zimmer_kaution', 'kleidung_betrag',
    'verpflegungsfreie_tage', 'auszahlungsbetrag'
  ];
$$;

create or replace function auszahlungsbeleg_zeile_differenz(v_neu jsonb, v_alt jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_ergebnis jsonb := v_neu;
  v_feld text;
begin
  foreach v_feld in array auszahlungsbeleg_zeile_felder() loop
    v_ergebnis := jsonb_set(
      v_ergebnis, array[v_feld],
      to_jsonb(
        coalesce((v_neu ->> v_feld)::numeric, 0)
        - coalesce((v_alt ->> v_feld)::numeric, 0)
      )
    );
  end loop;
  return v_ergebnis;
end;
$$;

create or replace function auszahlungsbeleg_zeile_delta_anwenden(
  p_employee_id uuid,
  p_beleg_id bigint,
  p_alt season_summary,
  p_neu season_summary
)
returns void language plpgsql security definer as $$
declare
  v_zeile jsonb;
  v_feld text;
  v_alt_jsonb jsonb := to_jsonb(p_alt) - 'snapshot';
  v_neu_jsonb jsonb := to_jsonb(p_neu) - 'snapshot';
  v_delta numeric;
begin
  if p_beleg_id is null then
    return;
  end if;

  select zeile into v_zeile from auszahlungsbeleg_zeilen
  where auszahlungsbeleg_id = p_beleg_id and employee_id = p_employee_id
  for update;

  if not found then
    -- Sollte nicht vorkommen (jede abgerechnete Person hat eine Zeile im
    -- zuletzt erstellten Beleg) - sicherheitshalber kein Fehler, damit eine
    -- Korrektur nicht an einer fehlenden historischen Zeile scheitert.
    return;
  end if;

  foreach v_feld in array auszahlungsbeleg_zeile_felder() loop
    v_delta := coalesce((v_neu_jsonb ->> v_feld)::numeric, 0)
      - coalesce((v_alt_jsonb ->> v_feld)::numeric, 0);
    if v_delta <> 0 then
      v_zeile := jsonb_set(
        v_zeile, array[v_feld],
        to_jsonb(coalesce((v_zeile ->> v_feld)::numeric, 0) + v_delta)
      );
    end if;
  end loop;

  update auszahlungsbeleg_zeilen set zeile = v_zeile
  where auszahlungsbeleg_id = p_beleg_id and employee_id = p_employee_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. saison_abrechnen_batch: erzeugt pro Person eine auszahlungsbeleg_zeilen-
--    Zeile (voll oder Differenz), season_bonuses-Logik selbst unverändert.
-- ---------------------------------------------------------------------------
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
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für "Jetzt Abrechnen"';
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

-- ---------------------------------------------------------------------------
-- 4. Korrektur-Funktionen: Differenz zusätzlich auf die Beleg-Zeile des
--    aktuellen Belegs nachziehen (bisher nur in season_bonuses.snapshot).
-- ---------------------------------------------------------------------------
create or replace function abrechnung_korrigieren(
  p_employee_id uuid,
  p_saison_jahr int,
  p_neuer_netto_extern numeric,
  p_grund text
)
returns void language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neu season_summary%rowtype;
  v_belegnummer text;
  v_zahlungsart text;
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für Abrechnungs-Korrektur';
  end if;

  if p_grund is null or trim(p_grund) = '' then
    raise exception 'Bitte eine Begründung für die Korrektur angeben';
  end if;

  if p_neuer_netto_extern is null then
    raise exception 'Bitte einen Netto-Betrag angeben';
  end if;

  select * into s from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if not found or s.abgerechnet_am is null then
    raise exception 'Diese Person ist für dieses Jahr nicht abgerechnet - bitte das normale Eingabefeld auf der Lohnübersicht nutzen';
  end if;

  if s.abrechnungsart = 'pauschal' then
    raise exception 'Bei Abrechnungsart "pauschal" wird Netto automatisch berechnet und kann nicht manuell korrigiert werden';
  end if;

  if ist_kassenpruefung_gesperrt(s.abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  select ab.belegnummer, ab.zahlungsart into v_belegnummer, v_zahlungsart
  from auszahlungsbelege ab where ab.id = s.auszahlungsbeleg_id;

  -- Bewusst der eingefrorene (nicht der live) Betrag als "vorher" - das
  -- ist der Betrag, der tatsächlich als Kassenbestand gezählt wird, und
  -- kann seit der Auszahlung bereits vom Live-Wert abweichen - diese
  -- Korrektur soll nur die eigene Netto-Änderung ausweisen, keine
  -- unabhängige Drift mit einrechnen.
  v_alter_betrag := (s.snapshot ->> 'auszahlungsbetrag')::numeric;

  update season_bonuses
  set netto_extern = p_neuer_netto_extern
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  select * into neu from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  v_neuer_betrag := neu.auszahlungsbetrag;
  v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

  -- Schnappschuss neu einfrieren, wie saison_abrechnen_batch - "snapshot"
  -- aus neu selbst entfernen, sonst verschachtelt sich der alte
  -- Schnappschuss im neuen.
  update season_bonuses
  set snapshot = to_jsonb(neu) - 'snapshot'
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  -- Nutzer-Vorgabe 2026-08-21: die Korrektur muss auch auf dem tatsächlich
  -- gedruckten Beleg sichtbar werden, nicht nur im laufenden Gesamtstand
  -- (season_bonuses) - siehe auszahlungsbeleg_zeilen/-zeile_delta_anwenden.
  perform auszahlungsbeleg_zeile_delta_anwenden(p_employee_id, s.auszahlungsbeleg_id, s, neu);

  if v_belegnummer is not null then
    insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
    values ('Abrechnungs-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_grund);
  end if;
end;
$$;

grant execute on function abrechnung_korrigieren(uuid, int, numeric, text) to authenticated;

create or replace function abrechnung_verpflegung_korrigieren(
  p_employee_id uuid,
  p_saison_jahr int,
  p_neue_verpflegungsfreie_tage int,
  p_grund text
)
returns void language plpgsql security definer as $$
declare
  s season_summary%rowtype;
  neu season_summary%rowtype;
  v_belegnummer text;
  v_zahlungsart text;
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
begin
  if current_role_name() not in ('admin', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für Abrechnungs-Korrektur';
  end if;

  if p_grund is null or trim(p_grund) = '' then
    raise exception 'Bitte eine Begründung für die Korrektur angeben';
  end if;

  if p_neue_verpflegungsfreie_tage is null or p_neue_verpflegungsfreie_tage < 0 then
    raise exception 'Bitte eine gültige Anzahl Tage (0 oder mehr) angeben';
  end if;

  select * into s from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if not found or s.abgerechnet_am is null then
    raise exception 'Diese Person ist für dieses Jahr nicht abgerechnet - bitte das normale Eingabefeld auf der Lohnübersicht nutzen';
  end if;

  if ist_kassenpruefung_gesperrt(s.abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  select ab.belegnummer, ab.zahlungsart into v_belegnummer, v_zahlungsart
  from auszahlungsbelege ab where ab.id = s.auszahlungsbeleg_id;

  -- Bewusst der eingefrorene (nicht der live) Betrag als "vorher" - siehe
  -- gleiche Begründung in abrechnung_korrigieren.
  v_alter_betrag := (s.snapshot ->> 'auszahlungsbetrag')::numeric;

  update season_bonuses
  set verpflegungsfreie_tage = p_neue_verpflegungsfreie_tage
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  select * into neu from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  v_neuer_betrag := neu.auszahlungsbetrag;
  v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

  update season_bonuses
  set snapshot = to_jsonb(neu) - 'snapshot'
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  -- Nutzer-Vorgabe 2026-08-21: siehe gleiche Begründung in
  -- abrechnung_korrigieren.
  perform auszahlungsbeleg_zeile_delta_anwenden(p_employee_id, s.auszahlungsbeleg_id, s, neu);

  if v_belegnummer is not null then
    insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
    values ('Verpflegungs-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_grund);
  end if;
end;
$$;

grant execute on function abrechnung_verpflegung_korrigieren(uuid, int, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. stundenkonto_in_auszahlung_umwandeln: liest jetzt die volle "Vorher"-
--    Zeile (nicht nur den Betrag) und zieht die Differenz ebenfalls auf die
--    Beleg-Zeile des aktuellen Belegs nach.
-- ---------------------------------------------------------------------------
create or replace function stundenkonto_in_auszahlung_umwandeln(
  p_employee_id uuid,
  p_saison_jahr int,
  p_stunden numeric,
  p_notiz text
)
returns numeric language plpgsql security definer as $$
declare
  v_saldo numeric;
  v_stundenlohn numeric;
  v_betrag numeric;
  v_abgerechnet_am timestamptz;
  v_belegnummer text;
  v_zahlungsart text;
  v_auszahlungsbeleg_id bigint;
  v_alter_betrag numeric;
  v_neuer_betrag numeric;
  v_delta numeric;
  s season_summary%rowtype;
  neu season_summary%rowtype;
begin
  if current_role_name() not in ('admin', 'hr', 'lohnabrechnung', 'management') then
    raise exception 'Keine Berechtigung, Stundenkonto in Auszahlung umzuwandeln';
  end if;

  if p_stunden is null or p_stunden <= 0 then
    raise exception 'Bitte eine Stundenzahl größer als 0 angeben';
  end if;

  select coalesce(sum(stunden), 0) into v_saldo
  from stundenkonto_bewegungen
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  if p_stunden > v_saldo then
    raise exception 'Nicht genug Stunden auf dem Stundenkonto (aktueller Saldo: % Std.)', v_saldo;
  end if;

  select stundenlohn into v_stundenlohn from employees where id = p_employee_id;
  v_betrag := round(p_stunden * coalesce(v_stundenlohn, 0), 2);

  select b.abgerechnet_am, b.auszahlungsbeleg_id, ab.belegnummer, ab.zahlungsart
    into v_abgerechnet_am, v_auszahlungsbeleg_id, v_belegnummer, v_zahlungsart
  from season_bonuses b
  left join auszahlungsbelege ab on ab.id = b.auszahlungsbeleg_id
  where b.employee_id = p_employee_id and b.saison_jahr = p_saison_jahr;

  if v_abgerechnet_am is not null and ist_kassenpruefung_gesperrt(v_abgerechnet_am) then
    raise exception 'Dieser Auszahlungsbeleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  -- Nutzer-Vorgabe 2026-08-21: volle "Vorher"-Zeile (nicht nur den Betrag)
  -- einlesen, damit die Differenz auch auf dem tatsächlich gedruckten Beleg
  -- nachgezogen werden kann (auszahlungsbeleg_zeile_delta_anwenden) -
  -- gleiches Muster wie abrechnung_korrigieren/
  -- abrechnung_verpflegung_korrigieren.
  if v_abgerechnet_am is not null then
    select * into s from season_summary
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;
    v_alter_betrag := s.auszahlungsbetrag;
  end if;

  insert into stundenkonto_bewegungen (employee_id, saison_jahr, stunden, art, notiz)
  values (p_employee_id, p_saison_jahr, -p_stunden, 'Auszahlung', p_notiz);

  insert into season_bonuses (employee_id, saison_jahr, stundenkonto_auszahlung_betrag)
  values (p_employee_id, p_saison_jahr, v_betrag)
  on conflict (employee_id, saison_jahr)
  do update set stundenkonto_auszahlung_betrag =
    season_bonuses.stundenkonto_auszahlung_betrag + v_betrag;

  if v_abgerechnet_am is not null then
    select * into neu from season_summary
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

    v_neuer_betrag := neu.auszahlungsbetrag;
    v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

    update season_bonuses
    set snapshot = to_jsonb(neu) - 'snapshot'
    where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

    perform auszahlungsbeleg_zeile_delta_anwenden(p_employee_id, v_auszahlungsbeleg_id, s, neu);

    if v_belegnummer is not null then
      insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
      values (
        'Stundenkonto-Auszahlung', v_belegnummer, v_delta, v_zahlungsart, auth.uid(),
        coalesce(p_notiz || ' - ', '') || p_stunden || ' Std. umgewandelt'
      );
    end if;
  end if;

  return v_betrag;
end;
$$;

grant execute on function stundenkonto_in_auszahlung_umwandeln(uuid, int, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Sicht auszahlungsbeleg_summary: Quelle von season_bonuses auf
--    auszahlungsbeleg_zeilen umgestellt, weicht_ab durch enthaelt_differenz
--    ersetzt.
-- ---------------------------------------------------------------------------
-- drop statt create-or-replace: Postgres verweigert create-or-replace, wenn
-- sich Spaltennamen ändern ("weicht_ab" -> "enthaelt_differenz", 42P16) -
-- unbedenklich, keine andere Sicht/Funktion greift auf diese Sicht zu.
drop view if exists auszahlungsbeleg_summary;

create view auszahlungsbeleg_summary as
select
  ab.id,
  ab.belegnummer,
  ab.saison_jahr,
  ab.zahlungsart,
  ab.erstellt_am,
  ab.erstellt_von,
  count(az.employee_id) as anzahl_personen,
  sum((az.zeile ->> 'auszahlungsbetrag')::numeric) as summe_auszahlungsbetrag,
  bool_or(az.ist_differenz) as enthaelt_differenz
from auszahlungsbelege ab
join auszahlungsbeleg_zeilen az on az.auszahlungsbeleg_id = ab.id
where current_role_name() in
  ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management')
group by ab.id, ab.belegnummer, ab.saison_jahr, ab.zahlungsart, ab.erstellt_am, ab.erstellt_von;

grant select on auszahlungsbeleg_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Backfill: bereits bestehende Auszahlungsbelege bekommen eine Zeile in
--    der neuen Tabelle, sonst verschwinden sie aus auszahlungsbeleg_summary
--    (INNER JOIN, siehe oben) - Nutzer-Meldung 2026-08-21: "Jetzt sehe ich
--    die ursprünglichen bereits durchgeführten Auszahlungsbelege nicht
--    mehr". Unbedenklich mit ist_differenz = false: VOR dieser Migration
--    gab es das Differenzbeleg-Konzept noch nicht, season_bonuses.snapshot
--    war für jede Person/Saison IMMER der volle (nie ein Differenz-)Betrag.
--    Nur der jeweils AKTUELLSTE Beleg je Person/Saison lässt sich so
--    wiederherstellen (season_bonuses hält nur eine Zeile) - eine Person,
--    die schon VOR dieser Migration mehrfach abgerechnet wurde, hat ihre
--    älteren Belege bereits vorher verloren (der ursprüngliche, hier
--    behobene Bug) und bekommt hier nur den letzten Stand zugeordnet.
--    "on conflict do nothing" macht diesen Block gefahrlos wiederholbar.
--    Bewusst NICHT in schema.sql übernommen (anders als der Rest dieser
--    Migration) - ein frischer Install hat keine season_bonuses-Altdaten
--    zum Nachfüllen, dort wäre dieser Block reine Altdaten-Reparatur ohne
--    Bezug zur eigentlichen Struktur.
-- ---------------------------------------------------------------------------
insert into auszahlungsbeleg_zeilen (
  auszahlungsbeleg_id, employee_id, saison_jahr, personal_nr, name, vorname,
  abrechnungsart, ist_differenz, zeile
)
select
  b.auszahlungsbeleg_id,
  b.employee_id,
  b.saison_jahr,
  coalesce(b.snapshot ->> 'personal_nr', e.personal_nr),
  coalesce(b.snapshot ->> 'name', e.name),
  coalesce(b.snapshot ->> 'vorname', e.vorname),
  coalesce(b.snapshot ->> 'abrechnungsart', e.abrechnungsart::text),
  false,
  b.snapshot
from season_bonuses b
join employees e on e.id = b.employee_id
where b.auszahlungsbeleg_id is not null
  and b.snapshot is not null
on conflict (auszahlungsbeleg_id, employee_id) do nothing;
