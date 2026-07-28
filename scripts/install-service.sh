#!/usr/bin/env bash
# Install StreamMonitor as a hardened systemd service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

USER="${STREAMMONITOR_USER:-$(whoami)}"
GROUP="${STREAMMONITOR_GROUP:-media}"
PORT="${STREAMMONITOR_PORT:-9090}"

SERVICE_FILE="/etc/systemd/system/streammonitor.service"
HEALTH_SERVICE_FILE="/etc/systemd/system/streammonitor-health.service"
HEALTH_TIMER_FILE="/etc/systemd/system/streammonitor-health.timer"

echo "==> Installing StreamMonitor service"
echo "    User:    $USER"
echo "    Group:   $GROUP"
echo "    Port:    $PORT"
echo "    WorkDir: $PROJECT_DIR"
echo ""

# Ensure project files are owned by the service user so permission regressions
# (e.g., files owned by root or another user) do not silently break startup.
echo "==> Fixing project ownership..."
sudo chown -R "$USER:$GROUP" "$PROJECT_DIR"
sudo find "$PROJECT_DIR" -type d -exec chmod 755 {} +
sudo find "$PROJECT_DIR" -type f -exec chmod 644 {} +
sudo find "$PROJECT_DIR" -type f \( -name '*.py' -o -name '*.sh' \) -exec chmod 755 {} +
# Keep venv entry-point scripts executable.
sudo chmod -R 755 "$PROJECT_DIR/.venv/bin"/*

sudo tee "$SERVICE_FILE" > /dev/null << INEOF
[Unit]
Description=StreamMonitor - Streaming Stack Health Monitor
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=$USER
Group=$GROUP
WorkingDirectory=$PROJECT_DIR
Environment=PYTHONUNBUFFERED=1

ExecStartPre=/bin/sh -c 'cd $PROJECT_DIR && uv sync --frozen --no-dev'
ExecStartPre=/bin/sh -c 'for i in 1 2 3 4 5; do ! ss -H -tln "sport = :$PORT" | grep -q LISTEN && exit 0; sleep 1; done; exit 0'

ExecStart=uv run --no-dev uvicorn app:app --host 127.0.0.1 --port $PORT --log-level info

Restart=always
RestartSec=5

TimeoutStartSec=30

UMask=0002

PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectSystem=full
ReadWritePaths=$PROJECT_DIR/data $PROJECT_DIR/logs $PROJECT_DIR/.cache /tmp
ProtectClock=true
ProtectHostname=true
ProtectProc=invisible
RemoveIPC=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=streammonitor

[Install]
WantedBy=multi-user.target
INEOF

sudo tee "$HEALTH_SERVICE_FILE" > /dev/null << 'INEOF'
[Unit]
Description=StreamMonitor health check / recovery
After=streammonitor.service
StartLimitIntervalSec=5min
StartLimitBurst=3

[Service]
Type=oneshot
TimeoutStartSec=25
ExecStart=/bin/sh -c '\
  URL="http://127.0.0.1:9090/api/ping"; \
  for i in 1 2; do \
    curl -fsS --max-time 5 "$URL" >/dev/null 2>&1 && exit 0; \
    sleep 5; \
  done; \
  echo "StreamMonitor health check failed; restarting service"; \
  systemctl restart streammonitor.service'
INEOF

sudo tee "$HEALTH_TIMER_FILE" > /dev/null << 'INEOF'
[Unit]
Description=Run StreamMonitor health check every minute

[Timer]
Unit=streammonitor-health.service
OnBootSec=1min
OnUnitInactiveSec=1min
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
INEOF

echo "==> Reloading systemd..."
sudo systemctl daemon-reload

echo "==> Enabling and starting service..."
sudo systemctl enable --now streammonitor.service
sudo systemctl enable --now streammonitor-health.timer

echo ""
echo "==> StreamMonitor installed!"
echo "    Status:  sudo systemctl status streammonitor"
echo "    Health:  sudo systemctl status streammonitor-health.timer"
echo "    Logs:    sudo journalctl -u streammonitor -f"
echo "    URL:     http://127.0.0.1:$PORT"
echo "    Login:   admin / admin (change immediately)"
