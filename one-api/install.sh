#!/usr/bin/env bash
# install.sh — Set up one-api as a systemd user service on claude.csdyn.com
# Run once: bash /opt/collective/one-api/install.sh

set -euo pipefail

SERVICE_NAME="one-api"
SERVICE_DIR="$HOME/.config/systemd/user"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$SERVICE_DIR"

cat > "$SERVICE_DIR/${SERVICE_NAME}.service" << EOF
[Unit]
Description=One API — Claude Code HTTP gateway
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node ${SCRIPT_DIR}/server.js
WorkingDirectory=${SCRIPT_DIR}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}"
systemctl --user restart "${SERVICE_NAME}"

echo "[one-api] service installed and started"
systemctl --user status "${SERVICE_NAME}" --no-pager
