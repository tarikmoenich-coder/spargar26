# Wetter & Frost – Konzept

Stand 2026-11-28, mit dem Nutzer abgestimmt. Stufe 1 wird gebaut.

## Ziel

- 48 Stunden im Stundenraster: Sonne, Regen (l/m²), Temperatur in 2 m und in Bodennähe
  (5 cm), Taupunkt – je Feld bzw. nächstgelegener DWD-Vorhersagepunkt.
- Feldgenaue Frostwarnung, **nur** für
  - **Erdbeeren in der Blüte** (Schalter „in Blüte“ je Feld und Saison, von/bis),
  - **Grünspargel während der Ernte** (Erntefenster aus `feld_anbau`, sonst 1.4.–24.6.).
  - Weißer Spargel: nie.
- Wetterumschwünge der nächsten 10 Tage, die Ernte und Vertrieb betreffen.
- Startseite: nur Akutes (Frost in den nächsten 48 h, Starkregen, Umschwung in 3 Tagen).

## Quelle (Stufe 1)

**DWD MOSMIX_L** (Open Data, amtlich, kostenlos auch gewerblich, Quellenangabe Pflicht):
Punktvorhersage, stündlich, 10 Tage, 4× täglich neu, statistisch an Messungen korrigiert.
Genutzte Elemente: `TTT` (2 m), `T5cm` (5 cm über Boden), `Td` (Taupunkt), `RR1c`
(Regen l/m² je Stunde), `SunD1` (Sonne s je Stunde), `N` (Bewölkung %), `FF` (Wind m/s),
`R101` (Regenwahrscheinlichkeit > 0,1 mm/h).

Jedes Feld bekommt den **nächstgelegenen MOSMIX-Punkt**. Bewusst nicht ICON-D2 im
Rohformat (GRIB2): MOSMIX liefert die Bodentemperatur direkt und ist an Messungen
korrigiert. ICON-D2 je Feldkoordinate wäre später über einen Dienst wie Open-Meteo
(gewerblich kostenpflichtig) nachrüstbar.

## Frostregel (Schwellen je Kultur einstellbar)

| Kultur | Vorwarnung | Kritisch |
|---|---|---|
| Erdbeeren (Blüte) | T5cm ≤ +1 °C | T5cm ≤ −1 °C |
| Grünspargel (Ernte) | T5cm ≤ +1 °C | T5cm ≤ −2 °C |

Zusätzlich **Vorwarnung bei Strahlungsfrost-Wetter**: Taupunkt ≤ 0 °C, Himmel weitgehend
klar (≤ 40 % Bewölkung) und T5cm höchstens 2 K über der Vorwarnschwelle – in klaren,
trockenen Nächten wird es am Boden oft kälter als vorhergesagt.

## Umschwung-Hinweise (Tag 1–10, je Ort)

Temperatursturz bzw. Wärmeschub (Tageshöchstwert ±7 K zum Vortag), Starkregen
(≥ 10 l/m² am Tag), Hitze (≥ 30 °C), Regen am Samstag (Vertrieb, ≥ 2 l/m²).

## Technik

- `tools/wetter-poller/`: Node-Skript auf dem Hetzner-Server, systemd-Timer stündlich
  (lädt nur, wenn der DWD eine neue Ausgabe hat). Liest Feld-Mittelpunkte, wählt je Feld
  den nächsten MOSMIX-Punkt (DWD-Stationskatalog), schreibt per Service-Key.
- Tabellen: `wetter_station`, `wetter_stunde`, `wetter_frost_regel`, `feld_bluete`.
- Sichten: `feld_wetter` (Feld → Station), `wetter_frost` (Warnstunden 48 h).
- Recht `wetter` (lesen: alle Rollen; schreiben = Schwellen/Blüte: Admin,
  Geschäftsführer, Erntewirtschaft).
- Seite `/wetter`, Startseiten-Kachel „Wetter“, roter Hinweis bei kritischem Frost.

## Stufe 2 (später)

Eigene Sensoren (Temperatur 5 cm + Feuchte) an den tiefsten Erdbeer-/Grünspargelfeldern;
die App lernt je Feld den Versatz zwischen Vorhersage und Messung.
