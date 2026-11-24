#!/bin/bash
# Lokale Kopie der Live-Struktur (ohne Daten) neu aufbauen.
# Aufruf: nachbau_laden.sh <psql-Verbindung zum lokalen Server> <db-name>
# Voraussetzung: .env.claude mit SPARGAR_STRUKTUR_URL (nur-Katalog-Zugang).
set -euo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
LOKAL="$1"; DB="$2"
TMP=$(mktemp -d)
U=$(sed -n 's/^SPARGAR_STRUKTUR_URL=//p' "$HIER/../../.env.claude")
psql "$U" -Atf "$HIER/struktur_export.sql" > "$TMP/struktur.json"
python3 "$HIER/struktur_nachbau.py" "$TMP/struktur.json" > "$TMP/schema.sql"
psql $LOKAL -d postgres -qc "drop database if exists $DB" -c "create database $DB"
psql $LOKAL -d "$DB" -q -f "$HIER/supabase_stub.sql" > "$TMP/stub.log" 2>&1
(echo "set role postgres;"; cat "$TMP/schema.sql") | psql $LOKAL -d "$DB" -q > "$TMP/load.log" 2>&1 || true
echo "Fehler beim Laden (erwartet: nur PostGIS-Views feld_geojson/feld_anbau_uebersicht + 1x season_summary-Vorlauf):"
grep ERROR "$TMP/load.log" | sed 's/^psql:[^:]*:[0-9]*: //' | sort | uniq -c || true
[ -n "${STRUKTUR_JSON:-}" ] && cp "$TMP/struktur.json" "$STRUKTUR_JSON"
rm -rf "$TMP"
