-- ============================================================================
-- Prüfabfrage zu Migration 2026-11-24j (NUR LESEN - ändert nichts).
--
-- Hintergrund: die Selbstprüfung der Migration lief in der SQL-Konsole nicht
-- (Anweisungen wurden einzeln ausgeführt, die temporäre Vorher-Tabelle war
-- sofort weg). Diese Abfrage holt den Vergleich nach:
--
--   "bisher" = Kassenstand nach der ALTEN Formel (nur MLK war Lohnkasse,
--              alle Einzahlungen/Vorschüsse/Belege/Kautionen zählten zu ihr)
--   "jetzt"  = Kassenstand nach der NEUEN Funktion kassenbuch_saldo_bis()
--
-- je Kassenbuch zu 26 Stichtagen (jetzt + die letzten 25 Monatsanfänge).
-- Alles in Ordnung, wenn die LETZTE Zeile "Abweichungen: 0" zeigt.
-- Zusätzlich die Kassenbuch-Einstellungen (Typ, Präfix, Firma) zur Kontrolle.
-- ============================================================================
with stichtage as (
  select now() as stichtag
  union all
  select date_trunc('month', now()) - make_interval(months => n) from generate_series(0, 24) n
),
vergleich as (
  select kb.kuerzel, s.stichtag,
    kb.eroeffnungssaldo
    + coalesce((select sum(case when b.richtung = 'eingang' then b.betrag else -b.betrag end)
                from kassenbuch_buchung b
                where b.kassenbuch_id = kb.id and not b.storniert and b.datum < s.stichtag), 0)
    + case when kb.kuerzel = 'MLK' then
        coalesce((select sum(betrag) from cash_deposits where not storniert and datum < s.stichtag), 0)
        - coalesce((select sum(betrag) from advances where not storniert and zahlungsart = 'BAR' and datum < s.stichtag), 0)
        - coalesce((select sum(((z.zeile ->> 'auszahlungsbetrag'))::numeric)
                    from auszahlungsbelege ab join auszahlungsbeleg_zeilen z on z.auszahlungsbeleg_id = ab.id
                    where ab.zahlungsart = 'BAR' and ab.erstellt_am < s.stichtag), 0)
        - coalesce((select sum(betrag_summe) from kautionsuebergaben where not storniert and erstellt_am < s.stichtag), 0)
      else 0 end as bisher,
    kassenbuch_saldo_bis(kb.id, s.stichtag) as jetzt
  from kassenbuch kb cross join stichtage s
)
select 'Einstellung' as art, kuerzel || ': Typ ' || typ || ', Präfix "' || belegnummer_praefix || '", Firma ' || coalesce(firma, '-') as ergebnis
from kassenbuch
union all
select 'Abweichung', kuerzel || ' am ' || to_char(stichtag, 'DD.MM.YYYY') || ': bisher ' || bisher || ', jetzt ' || jetzt
from vergleich where bisher is distinct from jetzt
union all
select 'Zusammenfassung', 'Geprüfte Kassenstände: ' || count(*) || ' - Abweichungen: ' || count(*) filter (where bisher is distinct from jetzt)
from vergleich;
