#!/usr/bin/env bash
# Install StreamMonitor as a systemd service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

USER="${STREAMMONITOR_USER:-$(whoami)}"
GROUP="${STREAMMONITOR_GROUP:-media}"
PORT="${STREAMMONITOR_PORT:-9090}"

SERVICE_FILE="/etc/systemd/system/streammonitor.service"

echo "==> Installing StreamMonitor service"
echo "    User:    $USER"
echo "    Group:   $GROUP"
echo "    Port:    $PORT"
echo "    WorkDir: $PROJECT_DIR"
echo ""

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=StreamMonitor - Infrastructure Monitoring Dashboard
After=network.target

[Service]
Type=simple
User=$USER
Group=$GROUP
WorkingDirectory=$PROJECT_DIR
ExecStart=uv run uvicorn app:app --host 127.0.0.1 --port $PORT --log-level info
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=streammonitor

[Install]
WantedBy=multi-user.target
EOF

echo "==> Reloading systemd..."
sudo systemctl daemon-reload

echo "==> Enabling and starting service..."
sudo systemctl enable --now streammonitor.service

echo ""
echo "==> StreamMonitor installed!"
echo "    Status:  sudo systemctl status streammonitor"
echo "    Logs:    sudo journalctl -u streammonitor -f"
echo "    URL:     http://127.0.0.1:$PORT"
echo "    Login:   admin / admin (change immediately)"
