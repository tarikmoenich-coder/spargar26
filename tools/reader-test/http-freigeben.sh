#!/usr/bin/env bash
# Optional: erlaubt dem Reader, seine Daten auch UNVERSCHLÜSSELT (HTTP, Port 80)
# an /in/<TOKEN> zu schicken - nur für den Fall, dass die HTTPS-Verbindung des
# Readers nicht klappt (z.B. Zertifikatsproblem) und man erst einmal nur
# Reichweite und RSSI testen will. Alle anderen Adressen auf Port 80 werden
# weiterhin auf HTTPS umgeleitet.
#
#   sudo bash tools/reader-test/http-freigeben.sh
#
# Rückgängig: das Setup-Skript ist davon unberührt; die Sicherung der alten
# Konfiguration liegt als <Datei>.vor-http-freigabe.

set -euo pipefail

DOMAIN="reader-test.spargelhof-moenich.de"
DATEI="/etc/nginx/sites-available/${DOMAIN}"
PORT="8090"

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo ausführen: sudo bash $0"
  exit 1
fi
if [ ! -f "${DATEI}" ]; then
  echo "${DATEI} nicht gefunden - zuerst setup-server.sh ausführen."
  exit 1
fi
if grep -q "location /in/" "${DATEI}" && grep -q "listen 80;" "${DATEI}" \
   && grep -A12 "listen 80;" "${DATEI}" | grep -q "location /in/"; then
  echo "HTTP-Freigabe ist schon eingerichtet."
  exit 0
fi

cp -n "${DATEI}" "${DATEI}.vor-http-freigabe"

DATEI="${DATEI}" DOMAIN="${DOMAIN}" PORT="${PORT}" python3 - <<'PY'
import os, re
datei, domain, port = os.environ["DATEI"], os.environ["DOMAIN"], os.environ["PORT"]
text = open(datei, encoding="utf-8").read()
# Den Server-Block finden, der auf Port 80 lauscht (von certbot angelegt).
teile = re.split(r"(?m)^(?=server \{)", text)
neu = []
ersetzt = False
for teil in teile:
    if teil.startswith("server {") and "listen 80;" in teil:
        neu.append(
            "server {\n"
            "    listen 80;\n"
            "    listen [::]:80;\n"
            f"    server_name {domain};\n"
            "    client_max_body_size 200k;\n"
            "    access_log off;\n"
            "\n"
            "    # Nur der Reader-Empfang darf unverschlüsselt ankommen.\n"
            "    location /in/ {\n"
            f"        proxy_pass http://127.0.0.1:{port};\n"
            "        proxy_set_header Host $host;\n"
            "        proxy_set_header X-Real-IP $remote_addr;\n"
            "        proxy_read_timeout 30s;\n"
            "    }\n"
            "    location / {\n"
            "        return 301 https://$host$request_uri;\n"
            "    }\n"
            "}\n"
        )
        ersetzt = True
    else:
        neu.append(teil)
if not ersetzt:
    raise SystemExit("Kein Server-Block auf Port 80 gefunden - nichts geändert.")
open(datei, "w", encoding="utf-8").write("".join(neu))
PY

nginx -t
systemctl reload nginx
echo "Fertig: http://${DOMAIN}/in/<TOKEN> nimmt jetzt auch unverschlüsselte Nachrichten an."
