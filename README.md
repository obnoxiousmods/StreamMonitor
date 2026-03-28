# StreamMonitor

Production-grade infrastructure monitoring dashboard for self-hosted media streaming stacks.

## Features

- **Service Health** — Real-time monitoring of 23+ services with systemd + HTTP health checks
- **Enhanced Stats** — Deep metrics for MediaFusion, Zilean, StremThru, AIOStreams, Comet, and more
- **Benchmark** — Compare self-hosted vs public addon instances (Torrentio, ElfHosted, etc.)
- **Speed Test** — Direct vs Cloudflare download speed comparison with progress bars
- **Jellyfin** — Active sessions and activity log viewer
- **Error Scanner** — Automated log scanning with dedup and service-specific classifiers
- **Permissions** — Directory permission scanner and bulk fixer
- **Live Logs** — Streaming journalctl viewer with filtering

## Architecture

```
app.py                 — Main dashboard, auth, frontend (Starlette)
routes/
  benchmark.py         — Benchmark API (39 titles, 8 endpoints)
  jellyfin.py          — Jellyfin sessions & activity
  speedtest.py         — Speed test page & download endpoint
  public.py            — Unauthenticated health API
  dmesg.py             — Kernel log endpoint
stats/
  __init__.py           — Stats collection orchestrator
  collectors.py         — Per-service API collectors (enhanced)
  base.py               — Shared HTTP helpers
  github.py             — GitHub release version fetcher
  system.py             — System stats (CPU, RAM, disk, GPU, sensors)
config.py              — Service definitions & API keys
health.py              — Health check loop
errors.py              — Log error scanner & classifier
perms.py               — Permission scanner
```

## Setup

```bash
# Install dependencies
uv sync

# Run
uv run uvicorn app:app --host 127.0.0.1 --port 9090

# Default login: admin / admin
# Change password via Settings tab
```

## Requirements

- Python 3.14+
- Starlette, httpx, psutil, argon2-cffi, uvicorn
