-- Kassenbestand zu einem beliebigen Zeitpunkt (Nutzer-Vorgabe 2026-08-24:
-- "Journal mit laufendem Saldo" für das Kassenbuch, wie ein echtes
-- Kassenbuch mit Jahres-Eröffnungssaldo). Dieselbe Formel wie bisher
-- clientseitig in app/kasse/page.tsx (Einzahlungen − Bar-Vorschüsse −
-- Bar-Auszahlungen − Kautionsübergaben, jeweils ohne stornierte Belege),
-- aber als echtes SQL SUM() ohne Zeilenlimit - die bisherige clientseitige
-- Berechnung lud dafür nur die letzten 100-200 Belege je Tabelle
-- (`.limit(100)`/`.limit(200)`), was bei mehr Belegen über mehrere Saisons
-- hinweg zu einem stillschweigend falschen Saldo geführt hätte. p_bis
-- default now() liefert den aktuellen Kassensaldo, ein früherer Zeitpunkt
-- den Eröffnungssaldo eines beliebigen Zeitraums (z.B. 1. Januar für den
-- Jahres-Eröffnungssaldo im Journal). security invoker (keine erhöhten
-- Rechte nötig) - die aufrufenden Rollen dürfen alle vier Quellen ohnehin
-- direkt lesen.
create or replace function kassenbestand_bis(p_bis timestamptz default now())
returns numeric language sql stable as $$
  select
    coalesce((
      select sum(betrag) from cash_deposits
      where not storniert and datum < p_bis
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

grant execute on function kassenbestand_bis(timestamptz) to authenticated;
