-- ============================================================================
-- Migration 2026-10-18: Kassenprüfungs-Bestandteile auf der Kassenbücher-
-- Übersicht (Nutzer-Vorgabe 2026-09-30): je Karte "Letzte Kassenprüfung"
-- mit Datum, damaligem Kassenbestand (Ist) und Anzahl Kassenbewegungen
-- seitdem. Datum/Ist kommen direkt aus cash_checks (kein neuer Code nötig),
-- die Anzahl braucht diese neue Funktion - gleiche lohnkasse/allgemein-
-- Unterscheidung wie kassenbuch_saldo_bis, aber COUNT(*) statt SUM().
-- ============================================================================

create or replace function kassenbuch_bewegungen_seit(
  p_kassenbuch_id bigint,
  p_seit timestamptz
)
returns int language sql stable as $$
  select
    coalesce((
      select count(*) from kassenbuch_buchung b
      where b.kassenbuch_id = kb.id and b.datum >= p_seit
    ), 0)
    + case when kb.typ = 'lohnkasse' then (
        coalesce((select count(*) from cash_deposits where datum >= p_seit), 0)
        + coalesce((select count(*) from advances where zahlungsart = 'BAR' and datum >= p_seit), 0)
        + coalesce((select count(*) from auszahlungsbeleg_summary where zahlungsart = 'BAR' and erstellt_am >= p_seit), 0)
        + coalesce((select count(*) from kautionsuebergaben where erstellt_am >= p_seit), 0)
      ) else 0 end
  from kassenbuch kb
  where kb.id = p_kassenbuch_id;
$$;
grant execute on function kassenbuch_bewegungen_seit(bigint, timestamptz) to authenticated;
