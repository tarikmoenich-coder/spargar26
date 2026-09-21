#!/usr/bin/env bash
# Richtet den Reader-Testempfänger auf dem Hetzner-Server ein (einmalig, mit
# sudo ausführen):  sudo bash tools/reader-test/setup-server.sh
#
# Voraussetzung: Der DNS-Eintrag reader-test.spargelhof-moenich.de (A-Record)
# zeigt auf die IP dieses Servers. Das Skript ist wiederholbar (idempotent).
#
# Danach erreichbar unter https://reader-test.spargelhof-moenich.de/view/<TOKEN>.
# HTTP (Port 80) bleibt bewusst ohne Weiterleitung auf HTTPS bestehen, falls der
# Reader unverschlüsselt senden kann.

set -euo pipefail

DOMAIN="reader-test.spargelhof-moenich.de"
SERVER_IP="2.28.48.222"
BENUTZER="tarik"
APP="/home/tarik/projekte/spargar26/tools/reader-test"
ENV_DATEI="/etc/reader-test.env"
DATEN_ORDNER="/var/lib/reader-test"
PORT="8090"
CERTBOT_EMAIL="tarikmoenich@googlemail.com"

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo ausführen: sudo bash $0"
  exit 1
fi
if [ ! -f "${APP}/server.mjs" ]; then
  echo "server.mjs nicht gefunden unter ${APP}"
  exit 1
fi

echo "==> DNS prüfen"
AUFGELOEST=$(getent hosts "${DOMAIN}" | awk 'NR==1{print $1}' || true)
if [ "${AUFGELOEST}" != "${SERVER_IP}" ]; then
  echo "Der Name ${DOMAIN} zeigt auf '${AUFGELOEST:-nichts}', erwartet wird ${SERVER_IP}."
  echo "Bitte zuerst beim DNS-Anbieter einen A-Record ${DOMAIN} -> ${SERVER_IP} anlegen"
  echo "(kann ein paar Minuten dauern) und das Skript dann erneut starten."
  exit 1
fi

echo "==> Zugangs-Token und Konfiguration"
if [ ! -f "${ENV_DATEI}" ]; then
  TOKEN=$(openssl rand -hex 16)
  printf 'READER_TOKEN=%s\nPORT=%s\nLOG_DATEI=%s/reader-log.jsonl\n' \
    "${TOKEN}" "${PORT}" "${DATEN_ORDNER}" > "${ENV_DATEI}"
fi
chown "root:${BENUTZER}" "${ENV_DATEI}"
chmod 640 "${ENV_DATEI}"
TOKEN=$(grep '^READER_TOKEN=' "${ENV_DATEI}" | cut -d= -f2)

mkdir -p "${DATEN_ORDNER}"
chown "${BENUTZER}:${BENUTZER}" "${DATEN_ORDNER}"

echo "==> systemd-Dienst"
cat > /etc/systemd/system/reader-test.service <<UNIT
[Unit]
Description=TECTUS MAGNUM Reader-Testempfaenger
After=network.target

[Service]
User=${BENUTZER}
WorkingDirectory=${APP}
EnvironmentFile=${ENV_DATEI}
ExecStart=/usr/bin/node ${APP}/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable reader-test.service >/dev/null
systemctl restart reader-test.service

echo "==> nginx"
cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 200k;
    # Der Reader sendet mehrmals pro Sekunde - kein Access-Log, sonst wächst die Platte.
    access_log off;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 30s;
    }
}
NGINX
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t
systemctl reload nginx

echo "==> Zertifikat (RSA, damit ältere Reader-Firmware es sicher versteht)"
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${CERTBOT_EMAIL}" \
  --key-type rsa
nginx -t
systemctl reload nginx

echo
echo "=================================================================="
echo " Fertig. Einstellungen im Reader (Web-Oberfläche, IP des Readers):"
echo "   Target Host : ${DOMAIN}"
echo "   Target Port : 443   (zum Ausprobieren ohne Zertifikat: 80)"
echo "   Target URL  : /in/${TOKEN}"
echo "   Root-Zertifikat hochladen: ${APP}/ISRG-Root-X1.crt"
echo "   (dieselbe Datei: https://letsencrypt.org/certs/isrgrootx1.pem)"
echo "   Betriebsart : Permanent Scan (dev_opmode = 1), Ausgabe: Web"
echo
echo " Ergebnisse ansehen:"
echo "   https://${DOMAIN}/view/${TOKEN}"
echo "=================================================================="
