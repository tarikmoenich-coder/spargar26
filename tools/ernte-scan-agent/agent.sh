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

# LED-Statusanzeige (SpidertrackBox-Erweiterung) - siehe README, Abschnitt
# "LED-Statusanzeige". LED_MODUS=simuliert loggt nur, statt echte ubus-Aufrufe
# zu machen - solange die LED nicht verkabelt ist, Standard.
: "${LED_MODUS:=simuliert}"
: "${LED_PIN_ROT:=dio0}"
: "${LED_PIN_GRUEN:=dio1}"
: "${LED_PIN_BLAU:=dio2}"
: "${LED_BLINK_AN_S:=0.15}"
: "${LED_BLINK_AUS_S:=0.15}"
: "${LED_BLINK_ANZAHL:=2}"
: "${LED_ZUSTAND_DATEI:=/etc/ernte-scan-agent/led_zustand}"
: "${LED_BLINK_ZAEHLER_DATEI:=/etc/ernte-scan-agent/led_blink_zaehler}"

mkdir -p "$(dirname "$QUEUE_DATEI")"
touch "$QUEUE_DATEI"
mkdir -p "$(dirname "$LED_ZUSTAND_DATEI")"
[ -f "$LED_ZUSTAND_DATEI" ] || echo "ROT" > "$LED_ZUSTAND_DATEI"
[ -f "$LED_BLINK_ZAEHLER_DATEI" ] || echo "0" > "$LED_BLINK_ZAEHLER_DATEI"

if [ "$INGEST_URL" = "http://PLATZHALTER.invalid/ernte-ingest" ]; then
  echo "WARNUNG: INGEST_URL ist noch der Platzhalter - die Edge Function ernte-ingest" \
       "existiert laut Plan noch nicht. Scans werden trotzdem gelesen und in" \
       "$QUEUE_DATEI gesammelt, aber bis zur echten URL nie verschickt." >&2
fi

jetzt_iso() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# Einzige Stelle im Skript, die jemals eine GPIO anfasst - nur led_schleife
# ruft das auf, nie lese_schleife/sende_schleife direkt (vermeidet, dass zwei
# Prozesse unabhaengig an denselben Pins schalten).
led_dio_setzen() {
  pin="$1"; wert="$2"
  if [ "$LED_MODUS" = "echt" ]; then
    ubus call "ioman.gpio.$pin" update "{\"direction\":\"out\",\"value\":\"$wert\"}" >/dev/null 2>&1
  else
    echo "LED-SIM: $pin=$wert"
  fi
}

led_farbe() {
  led_dio_setzen "$LED_PIN_ROT" "$1"
  led_dio_setzen "$LED_PIN_GRUEN" "$2"
  led_dio_setzen "$LED_PIN_BLAU" "$3"
}

led_rot() { led_farbe 1 0 0; }
led_gelb() { led_farbe 1 1 0; }
led_aus() { led_farbe 0 0 0; }

# Von sende_schleife aufgerufen: schreibt nur den GEWUENSCHTEN Dauerzustand
# (ROT/GELB/GELB_BLINKT) in eine Datei - fasst selbst keine GPIO an, das
# macht ausschliesslich led_schleife weiter unten.
led_zustand_setzen() {
  echo "$1" > "$LED_ZUSTAND_DATEI"
}

# Von sende_schleife aufgerufen, einmal pro erfolgreich zugestelltem Scan:
# erhoeht nur einen Zaehler. led_schleife beobachtet den und blinkt dann
# selbst - so blinkt nie mehr als ein Prozess gleichzeitig.
led_bestaetigung_blinken() {
  aktuell="$(cat "$LED_BLINK_ZAEHLER_DATEI" 2>/dev/null || echo 0)"
  echo "$((aktuell + 1))" > "$LED_BLINK_ZAEHLER_DATEI"
}

# Dritter Hintergrundprozess, einziger GPIO-Schreiber. Eigenes, kurzes
# Tick-Intervall fuer fluessiges Blinken - unabhaengig vom viel laengeren
# RETRY_INTERVALL_S der Sendeschleife.
led_schleife() {
  letzter_blink_zaehler="$(cat "$LED_BLINK_ZAEHLER_DATEI" 2>/dev/null || echo 0)"
  blink_phase_an=1
  zuletzt_angezeigt=""
  while true; do
    aktueller_blink_zaehler="$(cat "$LED_BLINK_ZAEHLER_DATEI" 2>/dev/null || echo 0)"
    if [ "$aktueller_blink_zaehler" != "$letzter_blink_zaehler" ]; then
      letzter_blink_zaehler="$aktueller_blink_zaehler"
      i=0
      while [ "$i" -lt "$LED_BLINK_ANZAHL" ]; do
        led_farbe 0 1 0
        sleep "$LED_BLINK_AN_S"
        led_aus
        sleep "$LED_BLINK_AUS_S"
        i=$((i + 1))
      done
      # Danach steht wieder der letzte Dauerzustand an - neu anwenden
      # erzwingen, da led_gelb/led_rot gerade erst ueberschrieben wurden.
      zuletzt_angezeigt=""
    fi

    zustand="$(cat "$LED_ZUSTAND_DATEI" 2>/dev/null || echo ROT)"
    case "$zustand" in
      GELB_BLINKT)
        # Blinkt selbst jeden Tick - hier bewusst KEIN "nur bei Aenderung
        # schreiben", das Umschalten IST die Anzeige.
        if [ "$blink_phase_an" = "1" ]; then
          led_gelb
          blink_phase_an=0
        else
          led_aus
          blink_phase_an=1
        fi
        zuletzt_angezeigt=""
        sleep 0.5
        ;;
      GELB)
        if [ "$zuletzt_angezeigt" != "GELB" ]; then
          led_gelb
          zuletzt_angezeigt="GELB"
        fi
        sleep 0.3
        ;;
      *)
        if [ "$zuletzt_angezeigt" != "ROT" ]; then
          led_rot
          zuletzt_angezeigt="ROT"
        fi
        sleep 0.3
        ;;
    esac
  done
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
    # cs8 -parenb -cstopb explizit erzwingen (8 Datenbits, keine Paritaet, 1
    # Stopbit) - "raw" allein garantiert das NICHT zuverlaessig, haengt vom
    # vorherigen Zustand der Schnittstelle ab. Ohne das kamen beim
    # Datalogic-Scanner einzelne Zeichen verstuemmelt an (Praxistest
    # 2026-10-20, siehe README).
    #
    # icrnl AM ENDE (nach raw!) erzwingen: unser Datalogic-Scanner schliesst
    # jeden Code nur mit CR (\r) ab, nicht mit LF (\n) - per Hex-Dump
    # bestaetigt (2026-10-20). "read" erkennt aber ausschliesslich \n als
    # Zeilenende, sonst wartet es ewig und kein Scan wird je erfasst. icrnl
    # laesst den KERNEL jedes eingehende CR sofort in LF umwandeln, bevor
    # read es sieht - "raw" schaltet das eigentlich ab, deshalb hier danach
    # explizit wieder an. Erst eine fehlgeschlagene Variante mit einer
    # tr-Pipe probiert, verworfen: tr puffert seine Ausgabe beim Schreiben in
    # eine Pipe und gibt einzelne kurze Scans nie zeitnah weiter (lokal
    # nachgestellt und bestaetigt) - icrnl passiert dagegen synchron im
    # Kernel, ohne Pufferungsrisiko.
    stty -F "$SERIAL_DEV" "$SERIAL_BAUD" cs8 -parenb -cstopb raw -echo icrnl
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
  jemals_verbunden=0
  led_zustand_setzen ROT
  while true; do
    sleep "$RETRY_INTERVALL_S"

    # Reiner Erreichbarkeits-Check, unabhaengig davon ob gerade etwas in der
    # Warteschlange liegt - sonst wuerde die LED bei leerer Warteschlange nie
    # von ROT auf GELB wechseln (z.B. solange noch kein Scanner angeschlossen
    # ist). -f bewusst NICHT gesetzt: ein 401/405 zaehlt hier schon als
    # "Server erreicht", nur ein echter Verbindungsfehler ist "nicht erreicht".
    if curl -s -o /dev/null -m 5 --head "$INGEST_URL"; then
      jemals_verbunden=1
      led_zustand_setzen GELB
    elif [ "$jemals_verbunden" = "1" ]; then
      led_zustand_setzen GELB_BLINKT
    else
      led_zustand_setzen ROT
    fi

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
        jemals_verbunden=1
        led_zustand_setzen GELB
        led_bestaetigung_blinken
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
led_schleife &
LED_PID=$!
trap 'kill "$SENDE_PID" "$LED_PID" 2>/dev/null' EXIT INT TERM

lese_schleife
