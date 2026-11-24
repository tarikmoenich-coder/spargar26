#!/bin/bash
# Rechte-Test komplett: Live-Struktur nachbauen -> Testdaten -> Matrix -> Bericht.
# Aufruf: rechte_test.sh "<psql-Verbindung lokal>" <db> <ausgabe-verzeichnis> [migration.sql ...]
# Optionale Migrationen werden nach dem Nachbau (als postgres) eingespielt,
# so lässt sich ein Vorher/Nachher-Vergleich erzeugen.
set -euo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
LOKAL="$1"; DB="$2"; AUS="$3"; shift 3
mkdir -p "$AUS"
STRUKTUR_JSON="$AUS/struktur.json" "$HIER/nachbau_laden.sh" "$LOKAL" "$DB"
python3 "$HIER/testdaten.py" "$AUS/struktur.json" > "$AUS/testdaten.sql"
psql $LOKAL -d "$DB" -q -f "$AUS/testdaten.sql" 2>&1 | grep ERROR && { echo "Testdaten fehlerhaft"; exit 1; } || true
for mig in "$@"; do
  echo "Migration: $mig"
  (echo "set role postgres;"; cat "$mig") | psql $LOKAL -d "$DB" -q 2>&1 | grep -E "ERROR|NOTICE" || true
done
psql $LOKAL -d "$DB" -q -f "$HIER/rechte_matrix.sql" > /dev/null
psql $LOKAL -d "$DB" -A -F'|' -t -c "select relation, art, subjekt, ergebnis from _matrix" > "$AUS/matrix.txt"
python3 "$HIER/matrix_bericht.py" "$AUS/matrix.txt" > "$AUS/bericht.md"
echo "Bericht: $AUS/bericht.md"
