-- ============================================================================
-- Migration 2026-10-17: Kautionen (Fahrer/Zimmer) nach dem Abrechnen
-- korrigierbar - Nutzer-Vorgabe 2026-09-30: "Ich kann aktuell Netto und
-- Verpfl. freie Tage in der Lohnübersicht auch nach einer Auszahlung
-- korrigieren. Bitte öffne diese Möglichkeit auch analog dazu für Fahrer
-- und Zimmerkautionen."
--
-- Exakt gleiches Muster wie abrechnung_korrigieren/
-- abrechnung_verpflegung_korrigieren (schema.sql): Pflichtgrund, Sperre bei
-- bereits freigegebener Kassenprüfung, Schnappschuss neu einfrieren,
-- Differenz auch auf dem gedruckten Beleg nachziehen
-- (auszahlungsbeleg_zeile_delta_anwenden), Delta-Protokoll in
-- kassenbewegungen. Zwei eigene Funktionen statt einer gemeinsamen
-- (dieselbe Struktur wie die beiden bestehenden Vorbilder), keine
-- abrechnungsart-Einschränkung (anders als beim Netto-Betrag) - Kautionen
-- gelten unabhängig von der Abrechnungsart.
-- ============================================================================

create or replace function abrechnung_fahrerkaution_korrigieren(
  p_employee_id uuid,
  p_saison_jahr int,
  p_neue_fahrer_kaution numeric,
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

  if p_neue_fahrer_kaution is null or p_neue_fahrer_kaution < 0 then
    raise exception 'Bitte einen gültigen Betrag (0 oder mehr) angeben';
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

  v_alter_betrag := (s.snapshot ->> 'auszahlungsbetrag')::numeric;

  update season_bonuses
  set fahrer_kaution = p_neue_fahrer_kaution
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  select * into neu from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  v_neuer_betrag := neu.auszahlungsbetrag;
  v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

  update season_bonuses
  set snapshot = to_jsonb(neu) - 'snapshot'
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  perform auszahlungsbeleg_zeile_delta_anwenden(p_employee_id, s.auszahlungsbeleg_id, s, neu);

  if v_belegnummer is not null then
    insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
    values ('Fahrerkautions-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_grund);
  end if;
end;
$$;

grant execute on function abrechnung_fahrerkaution_korrigieren(uuid, int, numeric, text) to authenticated;

create or replace function abrechnung_zimmerkaution_korrigieren(
  p_employee_id uuid,
  p_saison_jahr int,
  p_neue_zimmer_kaution numeric,
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

  if p_neue_zimmer_kaution is null or p_neue_zimmer_kaution < 0 then
    raise exception 'Bitte einen gültigen Betrag (0 oder mehr) angeben';
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

  v_alter_betrag := (s.snapshot ->> 'auszahlungsbetrag')::numeric;

  update season_bonuses
  set zimmer_kaution = p_neue_zimmer_kaution
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  select * into neu from season_summary
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  v_neuer_betrag := neu.auszahlungsbetrag;
  v_delta := coalesce(v_neuer_betrag, 0) - coalesce(v_alter_betrag, 0);

  update season_bonuses
  set snapshot = to_jsonb(neu) - 'snapshot'
  where employee_id = p_employee_id and saison_jahr = p_saison_jahr;

  perform auszahlungsbeleg_zeile_delta_anwenden(p_employee_id, s.auszahlungsbeleg_id, s, neu);

  if v_belegnummer is not null then
    insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
    values ('Zimmerkautions-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_grund);
  end if;
end;
$$;

grant execute on function abrechnung_zimmerkaution_korrigieren(uuid, int, numeric, text) to authenticated;
