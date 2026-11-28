# Erdbeer-Ernteerfassung – Steigen-Scan am LKW

Stand 2026-11-28, mit dem Nutzer abgestimmt. Noch nicht gebaut.

## Ziel

Schlank: Gepflückte Steigen werden am LKW per Personalkarte gezählt, Feld per GPS,
Zeit per Start/Stop-Karte. Daraus entstehen automatisch die Zeilen der bestehenden
Erdbeer-Tageserfassung (`erdbeeren_rohdaten`). **Die bestehende Prämienberechnung
bleibt unverändert.**

## Bestehende Prämie (bleibt)

- Satz je Feld mit „gültig ab“: Norm (Steigen/Std.) und Bonus (€/Steige über Norm),
  Tabelle `erdbeeren_parzellen_saetze` (Spalte heißt inzwischen `feld_id`).
- Je Person + Feld + Tag: `Prämie = max(0, (Steigen − Stunden × Norm) × Bonus)`.
- Storno je Zeile mit Grund; Weg in Saisonsumme/Lohn wie bisher (`erdbeeren_praemie_tag`).
- Sut (Abfall): wird später geklärt, bis dahin weiter von Hand.

## Ablauf am LKW

- 2–3 LKWs je Tag als zentrale Annahmestellen, stehen meist im Feld.
- Pflücker bringt volle Steige, scannt seine Personalkarte (QR `P-…`) → **+1 Steige**.
- **Sperre:** Scan derselben Person innerhalb von 5 Minuten zählt nicht – gilt über
  **alle** LKWs (kein Ausweichen zum Nachbar-LKW). Abgelehnte Scans werden gespeichert
  und sind in der App sichtbar, nicht stillschweigend verworfen.
- **Start-/Stop-Karte** je LKW (gedruckter QR, z.B. `E-START` / `E-STOP`): Vorarbeiter
  scannt „Start“ bei Erntebeginn, „Stop“ bei Ende. Pause = Stop … Start.

## Feld

- Position des LKW im Moment des Scans.
- Zugeordnet wird das **nächstgelegene Erdbeerfeld** der Saison (laut `feld_anbau`),
  nie ein Spargel- oder anderes Feld, auch wenn es näher liegt.
- Liegt kein Erdbeerfeld im Umkreis (~100 m) oder sind zwei gleich nah:
  „Feld ungeklärt“ → Büro ordnet den Zeitraum dieses LKW per Klick zu.

## Prämienzeit je Person

1. Rahmen: Start-bis-Stop-Fenster des LKW (Pausen ausgenommen).
2. **Später gekommen:** liegt der erste Scan deutlich nach Start, beginnt die Zeit
   erst „eine Steige“ vor diesem Scan (= 60 / Norm Minuten, bei Norm 6 → 10 min).
   Wer pünktlich ist, bekommt ab Start.
3. **Früher gegangen:** liegt der letzte Scan > ~30 min vor Stop, endet die Zeit mit
   dem letzten Scan.
4. **Deckel:** nie mehr als die Stunden der Stundenerfassung; sind dort Von-bis-Zeiten
   (`work_entries.vm_von … nm_bis`) eingetragen, zählt nur die Überschneidung.
5. **Feld:** Zeit an einem LKW zählt für dessen Feld; LKW-Wechsel teilt die Zeit.

Bewusst in Kauf genommen: ein pünktlicher, sehr langsamer Pflücker wird wie „später
gekommen“ behandelt – Folge höchstens eine Steigen-Zeit weniger, Prämie ist dort
ohnehin meist 0.

## Korrekturen

Büro kann je Person + Tag Steigen mit Grund hinzufügen/abziehen (vergessene Karte,
Fehlscan). Korrektur bleibt sichtbar, Rohscans werden nie verändert.

## Hardware am LKW: Pi als Hauptgerät

- **Raspberry Pi** (4 oder 5) mit ~7"-Display, Lautsprecher/Summer, 12-V-Wandler vom LKW.
- **Scanner per USB direkt am Pi.** Der Pi
  - prüft die 5-Minuten-Sperre sofort selbst (lokal, ohne Netz),
  - gibt ein Signal: heller Piep = gezählt, tiefer Doppelton = zu früh,
  - zeigt **Foto, Name und „heute: N Steigen“**,
  - puffert Scans offline (Warteschlange wie beim Waagen-Agenten) und sendet nach.
- **TRB246** liefert nur noch LTE + GPS; der Pi fragt die Position am Router ab.
- **Fotos** der aktiven Erntehelfer lädt der Pi morgens; Anzeige funktioniert offline.
- **Verbindlich zählt die Datenbank**; der Pi-Zähler ist Anzeige und gleicht sich bei
  Netz ab. Die Sperre wird in der DB zusätzlich geprüft (mehrere LKWs).
- Kein Tablet mit Webseite: Signal + Sperre müssen < 1 s und netzunabhängig kommen.
- Grob 150–200 € je LKW + Gehäuse. **Display-Lesbarkeit in der Sonne vorher an einem
  Gerät testen**, dann erst 2–3 kaufen.
- Ingest über die bestehende Edge Function `ernte-ingest` (neue Quelle `annahme`).

## Umsetzung

1. **DB + Auswertung** (ohne Hardware testbar): LKW als Annahmestelle in
   `ernte_maschine` (Typ), Scan-Ereignisse `steige`/`start`/`stop`, Sperre,
   Feldzuordnung Erdbeere, Zeitregeln, Befüllung `erdbeeren_rohdaten`, Korrekturen,
   „Feld ungeklärt“-Zuordnung, Startseiten-Kachel Erdbeeren auf Scan-Daten.
2. **Pi-Agent** (`tools/erdbeer-annahme-agent/`): Scan, Sperre, Ton, Anzeige, Fotos,
   Warteschlange, GPS vom TRB246. Lokal mit Fake-Scanner testen.
3. **Druck:** Start-/Stop-Karten je LKW.
4. Praxistest an einem LKW, dann Rollout.
