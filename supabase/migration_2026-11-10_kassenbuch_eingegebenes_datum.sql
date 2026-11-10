-- ============================================================================
-- Migration 2026-11-10: Kassenbuch nutzt das eingegebene Datum
--
-- Nutzer-Meldung 2026-11-10: "Manuelle Kassenbucheinträge bekommen
-- automatisch immer das heutige Datum. Wir müssen das Datum aber selbst
-- eingeben können."
--
-- Die Buchungsformulare (kassenbuch_buchen/kassenbuch_umbuchen, sowie das
-- Insert für cash_deposits) schreiben das vom Nutzer gewählte Datum bereits
-- korrekt in die Spalte datum_kassenbuch (date). Die Spalte "datum"
-- (timestamptz, default now()) ist dagegen der reine Anlage-Zeitstempel und
-- bleibt unverändert, sobald ein Datensatz gespeichert wird. Die beiden
-- Saldo-Funktionen haben bisher trotzdem "datum" statt "datum_kassenbuch"
-- gelesen - ein nachgetragener/rückdatierter Eintrag wurde dadurch zwar
-- gespeichert, aber im Journal und im Saldo immer so behandelt, als wäre er
-- am Tag der Eingabe gebucht worden.
--
-- Block-vs-Warnung bei Kassenprüfung bewusst nicht angefasst (Nutzer-
-- Vorgabe 2026-11-10: das bleibt vorerst ein harter Block, keine Warnung).
-- ============================================================================

create or replace function kassenbestand_bis(p_bis timestamptz default now())
returns numeric language sql stable as $$
  select
    coalesce((
      select sum(betrag) from cash_deposits
      where not storniert and datum_kassenbuch < p_bis::date
    ), 0)
    - coalesce((
      select sum(betrag) from advances
      where not storniert and zahlungsart = 'BAR' and datum < p_bis
    ), 0)
    - coalesce((
      select sum(summe_auszahlungsbetrag) from auszahlungsbeleg_summary
      where zahlungsart = 'BAR' and erstellt_am < p_bis
    ), 0)
    - coalesce((
      select sum(betrag_summe) from kautionsuebergaben
      where not storniert and erstellt_am < p_bis
    ), 0);
$$;

create or replace function kassenbuch_saldo_bis(
  p_kassenbuch_id bigint,
  p_bis timestamptz default now()
)
returns numeric language sql stable as $$
  select
    kb.eroeffnungssaldo
    + coalesce((
        select sum(case when b.richtung = 'eingang' then b.betrag else -b.betrag end)
        from kassenbuch_buchung b
        where b.kassenbuch_id = kb.id and not b.storniert and b.datum_kassenbuch < p_bis::date
      ), 0)
    + case when kb.typ = 'lohnkasse' then kassenbestand_bis(p_bis) else 0 end
  from kassenbuch kb
  where kb.id = p_kassenbuch_id;
$$;
