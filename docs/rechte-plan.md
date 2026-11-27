# Frei einstellbare Rollen (Rechte-Umbau)

Nutzer-Entscheidungen 2026-11-27 (Katalog: https://claude.ai/artifact/QQY8SNxXxShmLMTXXTPkex):

- Einteilung des Katalogs passt (je Funktion: lesen / lesen & schreiben, plus Sonderrechte).
- Grundausstattung für alle (Namen, Saisons, Gruppen, Herkünfte, Firmen, Einsatzbereiche,
  Sätze lesen, Zimmer-Belegung) ist ok - aber Landwirtschaft und Vertrieb STRIKT getrennt.
- Alle 6 Auffälligkeiten beseitigen:
  1. HR schreibt Anbau ohne Menüpunkt -> HR verliert Anbau-Schreibrecht.
  2. Management wandelt/storniert Stundenkonto-Auszahlungen -> weg.
  3. Stand-Position setzen: wer Vertriebsplanung schreiben darf (HR), nicht Management.
  4. Lohnabrechnung liest Kassenbücher ohne Menüpunkt -> nur noch die Liste der Bücher (für Vorschüsse).
  5. Admin/Management/Prüfer sehen automatisch alle Bereiche -> Bereiche nur noch über die Rolle (Admin: alle).
  6. rechnung_speichern (Rolle "buchhaltung" gibt es nicht) -> entfernen.
- Bereich (LW/VT) hängt an der Rolle; mehrere Rollen je Nutzer bleiben, Rechte + Bereiche addieren sich.
- Neue Rolle **Geschäftsführer**: alles wie Admin, außer Nutzer anlegen, Rollen ändern/vergeben,
  Änderungsvorschläge ansehen.
- Menüpunkte selbst ausblenden (reine Anzeige) - Branch `menue-ausblenden`.

## Technik

- `recht_katalog` (schluessel, modul, titel, sensibel, ...), `rolle` (schluessel, bezeichnung,
  bereiche[], rechte jsonb {"kasse.buecher":"S"}, alle_rechte, system='admin').
- `profiles.rollen` -> text[] (rolle.schluessel). `profil_rechte` (abgeleitet per Trigger):
  rechte text[] ('kasse.buecher:L', 'kasse.buecher:S', ...), bereiche[], admin.
- Prüfung in Policies: `(select darf_any(array['kasse.buecher:L', ...]))` - einmal je Abfrage.
- Umschreiben: Skript `supabase/rechte/umschreiben.py` übersetzt jede alte hat_rolle(...)
  in darf_any(...) und prüft, dass für die 10 Startrollen dieselbe Rollenmenge herauskommt.
- Abnahme: Rechte-Matrix (supabase/tests/rechte_test.sh) vorher/nachher identisch bis auf die
  gewollten Änderungen (Auffälligkeiten); Messung mit großen Datenmengen ohne Unterschied.

## Stufen

1. DB-Umbau (unsichtbar) + Client auf darf() umstellen.
2. Rollen-Editor unter Einstellungen, Geschäftsführer-Rolle anlegen.
