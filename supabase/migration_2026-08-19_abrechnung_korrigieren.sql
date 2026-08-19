-- Migration 2026-08-19: Nachträgliche Korrektur eines falsch eingegebenen
-- Netto-Betrags NACH dem Abrechnen
--
-- Nutzer-Vorgabe: "Der Auszahlungsbetrag stimmt jetzt nicht mehr, weil ich
-- den Netto-Betrag falsch eingegeben habe. Aber alle Felder sind nun
-- gesperrt. Können wir da eine Korrektur Funktion mit Log und Begründung
-- einbauen?"
--
-- Sobald abgerechnet_am gesetzt ist, liest die Lohnübersicht NICHT mehr
-- live, sondern aus dem eingefrorenen season_bonuses.snapshot - dort
-- hinein fließt auch die Auszahlungsbeleg-Summe und darüber der
-- Kassenbestand (Kasse-Seite). Diese Funktion aktualisiert deshalb
-- zusätzlich den Schnappschuss und protokolliert die Korrektur wie bei
-- vorschuss_korrigieren (Pflichtgrund, Eintrag in kassenbewegungen, Sperre
-- bei bereits freigegebener Kassenprüfung).
--
-- Bewusst NUR netto_extern (kleinster, gezielter Eingriff). Bewusst KEIN
-- Differenzbeleg - die tatsächliche Nachzahlung/Rückforderung läuft wie
-- bei der Kautions-Rückzahlung außerhalb der App, die Korrektur passt nur
-- die Buchung an.
--
-- Zusätzlich ein kleiner Bugfix auf der Kasse-Seite: die Liste "Bewegungen
-- seit letzter Prüfung" hatte die Art jeder kassenbewegungen-Zeile fest
-- auf "Vorschuss-Korrektur" verdrahtet, statt die echte Spalte zu lesen -
-- sonst wäre eine neue Abrechnungs-Korrektur dort falsch beschriftet
-- worden (reine Frontend-Änderung, kein SQL nötig).
--
-- In der Supabase SQL-Konsole ausfuehren. Kein ALTER TYPE, laeuft in einem
-- Zug.

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
  -- kann seit der Auszahlung bereits vom Live-Wert abweichen (siehe
  -- weichtAb() im Frontend) - diese Korrektur soll nur die eigene
  -- Netto-Änderung ausweisen, keine unabhängige Drift mit einrechnen.
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

  if v_belegnummer is not null then
    insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
    values ('Abrechnungs-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_grund);
  end if;
end;
$$;

grant execute on function abrechnung_korrigieren(uuid, int, numeric, text) to authenticated;
