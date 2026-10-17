#!/bin/sh
# Ernte-Scan-Agent - laeuft AUF dem TRB246 selbst (RutOS/BusyBox-Shell, kein
# Node/Python verfuegbar), liest QR-Codes vom seriellen Scan-Modul und
# schickt sie an die Ingest-Edge-Function - siehe docs/erntewirtschaft-plan.md
# Teil B/C.
#
# Bewusst NICHT per "Data to Server": dessen Codec/HTTP-Sender ist auf
# strukturierte Sensor-/GPS-Daten ausgelegt, nicht auf "lies rohe Zeilen von
# einem seriellen Geraet". Laut Teltonika-Forum braucht genau das ein eigenes
# Skript - siehe Quellen in der README.
#
# Architektur zweigeteilt (gleiches Prinzip wie queue.mjs im
# ernte-waage-agent): ein Lese-Prozess haengt JEDEN Scan SOFORT an eine
# lokale Datei an (darf nie auf das Netz warten), ein zweiter, unabhaengiger
# Sende-Prozess versucht in Abstaenden, die Datei leerzuraeumen. Ein
# fehlgeschlagener Versand blockiert nie das Einlesen weiterer Scans.

set -eu

KONFIG="${1:-/etc/ernte-scan-agent/agent.conf}"
if [ ! -f "$KONFIG" ]; then
  echo "Konfiguration fehlt: $KONFIG (siehe agent.conf.example)" >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$KONFIG"

: "${SERIAL_DEV:?SERIAL_DEV fehlt in der Konfiguration (z.B. /dev/ttyS0 - per SSH mit 'ls /dev/tty*' ermitteln)}"
: "${SERIAL_BAUD:=9600}"
: "${BOX_ID:?BOX_ID fehlt in der Konfiguration (z.B. die IMEI des Geraets)}"
: "${INGEST_URL:=http://PLATZHALTER.invalid/ernte-ingest}"
: "${INGEST_TOKEN:=}"
: "${QUEUE_DATEI:=/etc/ernte-scan-agent/queue.jsonl}"
: "${RETRY_INTERVALL_S:=30}"

mkdir -p "$(dirname "$QUEUE_DATEI")"
touch "$QUEUE_DATEI"

if [ "$INGEST_URL" = "http://PLATZHALTER.invalid/ernte-ingest" ]; then
  echo "WARNUNG: INGEST_URL ist noch der Platzhalter - die Edge Function ernte-ingest" \
       "existiert laut Plan noch nicht. Scans werden trotzdem gelesen und in" \
       "$QUEUE_DATEI gesammelt, aber bis zur echten URL nie verschickt." >&2
fi

jetzt_iso() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# Sehr simples JSON-String-Escaping - QR-Codes sind laut Plan auf
# alphanumerisch+Bindestrich mit Praefix (K-/P-) festgelegt, trotzdem defensiv
# gegen Anfuehrungszeichen/Backslash aus einer verunreinigten Lesung.
json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Ein einzelner Scan wird sofort als Zeile angehaengt - das ist die einzige
# Stelle, die wirklich passieren MUSS, bevor der naechste Scan verarbeitet
# wird. Kein Netzwerk-Aufruf hier drin.
scan_einreihen() {
  code_roh="$1"
  code="$(json_escape "$code_roh")"
  box="$(json_escape "$BOX_ID")"
  ts="$(jetzt_iso)"
  printf '{"box":"%s","events":[{"typ":"scan","code":"%s","ts":"%s"}]}\n' \
    "$box" "$code" "$ts" >> "$QUEUE_DATEI"
}

# Leseschleife: oeffnet die serielle Schnittstelle und haengt jede nicht-leere
# Zeile (= ein gescannter Code) an die Warteschlange an. Haeufig schicken
# Scanner ein abschliessendes CR/LF mit - wird abgeschnitten, bevor der Code
# gespeichert wird.
lese_schleife() {
  while true; do
    stty -F "$SERIAL_DEV" "$SERIAL_BAUD" raw -echo
    # Deskriptor EINMAL offen halten, nicht pro Zeile neu oeffnen - sonst geht
    # zwischen zwei Zeilen gepuffertes Rohdaten verloren und die Schnittstelle
    # wird staendig neu initialisiert.
    exec 3< "$SERIAL_DEV"
    while IFS= read -r zeile <&3; do
      code="$(printf '%s' "$zeile" | tr -d '\r\n')"
      [ -n "$code" ] || continue
      echo "Scan: $code"
      scan_einreihen "$code"
    done
    exec 3<&-
    echo "Serielle Schnittstelle $SERIAL_DEV getrennt/Fehler - versuche in 5s erneut" >&2
    sleep 5
  done
}

# Sendeschleife: holt sich in Abstaenden den AKTUELLEN Inhalt der
# Warteschlange (per mv "weggedreht", damit waehrenddessen eintreffende neue
# Scans nicht angefasst werden), versucht jede Zeile zu verschicken -
# fehlgeschlagene Zeilen wandern zurueck ans Ende der (inzwischen wieder
# gewachsenen) Warteschlange, erfolgreiche werden verworfen. Gleiches Prinzip
# wie wartendeHolen()/schreibeZurueck() im ernte-waage-agent.
sende_schleife() {
  while true; do
    sleep "$RETRY_INTERVALL_S"
    [ -s "$QUEUE_DATEI" ] || continue

    abholung="${QUEUE_DATEI}.senden.$$"
    mv "$QUEUE_DATEI" "$abholung"
    touch "$QUEUE_DATEI"

    while IFS= read -r zeile; do
      [ -n "$zeile" ] || continue
      if curl -fsS -m 10 -X POST "$INGEST_URL" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $INGEST_TOKEN" \
          -d "$zeile" >/dev/null 2>&1; then
        echo "Versendet: $zeile"
      else
        echo "Versand fehlgeschlagen, bleibt in der Warteschlange: $zeile" >&2
        printf '%s\n' "$zeile" >> "$QUEUE_DATEI"
      fi
    done < "$abholung"
    rm -f "$abholung"
  done
}

sende_schleife &
SENDE_PID=$!
trap 'kill "$SENDE_PID" 2>/dev/null' EXIT INT TERM

lese_schleife
