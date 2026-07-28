# Deployment Guide

## Prerequisites

- Linux system with systemd
- Python 3.14+ (for source installs)
- Services must be accessible on localhost
- sudo access for service control and log reading

## Quick Start

### Binary Install

```bash
# Download latest release
wget https://github.com/obnoxiousmods/StreamMonitor/releases/latest/download/streammonitor
chmod +x streammonitor

# Create data directory
mkdir -p data

# Run
./streammonitor
# Open http://localhost:9090
# Login: admin / admin
```

### Source Install

```bash
git clone https://github.com/obnoxiousmods/StreamMonitor.git
cd StreamMonitor
uv sync
uv run uvicorn app:app --host 127.0.0.1 --port 9090
```

## systemd Service

Run the provided installer (sets ownership, installs the hardened service, and
enables a health-check timer):

```bash
sudo ./scripts/install-service.sh
```

Or create `/etc/systemd/system/streammonitor.service` manually:

```ini
[Unit]
Description=StreamMonitor - Streaming Stack Health Monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=your-user
Group=media
WorkingDirectory=/path/to/StreamMonitor
Environment=PYTHONUNBUFFERED=1

# Sync the venv on every start so a dependency mismatch cannot take the service down.
ExecStartPre=/bin/sh -c 'cd /path/to/StreamMonitor && uv sync --frozen --no-dev'

ExecStart=uv run --no-dev uvicorn app:app --host 127.0.0.1 --port 9090 --log-level info

Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=3
TimeoutStartSec=30

UMask=0002

# Hardening (compatible with sudo-based service control/journal reading).
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectSystem=full
ReadWritePaths=/path/to/StreamMonitor/data /path/to/StreamMonitor/logs /path/to/StreamMonitor/.cache /tmp
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
```

Then reload and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now streammonitor.service
```

### Health-check timer

A monotonic one-minute timer restarts the service if `/api/ping` fails twice. It uses `OnUnitInactiveSec=1min`, so checks do not pile up or burst after a slow run:

```bash
sudo systemctl enable --now streammonitor-health.timer
```

## sudo Configuration

StreamMonitor needs sudo access for:
- `systemctl start/stop/restart` (service control)
- `journalctl` (log viewing)
- `chown/chmod` (permission fixing)

Add to `/etc/sudoers.d/streammonitor`:
```
your-user ALL=(ALL) NOPASSWD: /usr/bin/systemctl start *, /usr/bin/systemctl stop *, /usr/bin/systemctl restart *, /usr/bin/systemctl is-active *, /usr/bin/journalctl *, /usr/bin/chown *, /usr/bin/chmod *
```

## Nginx Reverse Proxy

For HTTPS access, configure nginx:

```nginx
server {
    server_name monitor.yourdomain.com;

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://127.0.0.1:9090;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
}
```

## Speed Test Endpoints

For the built-in speed test, create dedicated nginx vhosts for direct and CDN comparison:

### Direct (origin)
```nginx
server {
    server_name speedtest.yourdomain.com;
    location /speedtest/download {
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Expose-Headers "Content-Length" always;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_pass http://127.0.0.1:9090;
    }
    location / { return 204; }
}
```

### Cloudflare (CDN)
Same config on a Cloudflare-proxied domain to measure CDN vs direct speed.

## Building from Source

### PyInstaller Binary

```bash
uv pip install pyinstaller
uv run pyinstaller streammonitor.spec --noconfirm --clean
# Output: dist/streammonitor (~14MB)
```

## Updating

### Binary
Download new release and replace the binary. Data in `data/` persists.

### Source
```bash
git pull
uv sync
sudo systemctl restart streammonitor.service
```

## Troubleshooting

### Service won't start
```bash
sudo journalctl -u streammonitor.service -n 50 --no-pager
```

### Health checks failing
Check that services are running and accessible on localhost:
```bash
curl -s http://127.0.0.1:PORT/health
systemctl is-active service-name
```

### Stats not populating
Stats collectors run every 60 seconds. Wait for at least one cycle after startup.
Check for collector errors:
```bash
sudo journalctl -u streammonitor.service --since "5 min ago" | grep -i error
```
