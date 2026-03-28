# Architecture

## Overview

StreamMonitor is a Starlette-based ASGI web application that monitors infrastructure services. It uses a background task architecture for non-blocking health checks and stats collection.

## Components

### Core

| Module | Purpose |
|--------|---------|
| `app.py` | Application factory, middleware, route registration, lifespan management |
| `auth.py` | Authentication helpers (Argon2 password hashing, session management, require_auth decorator) |
| `config.py` | Service definitions, API key management, category mappings |
| `health.py` | Dual health check loop (systemd + HTTP) running every 30 seconds |
| `errors.py` | Log error scanner with 20 service-specific classifiers, deduplication |
| `perms.py` | Directory permission scanner and bulk fixer (94 paths) |

### Routes

| Module | Auth | Purpose |
|--------|------|---------|
| `routes/dashboard.py` | Yes | Main dashboard page (Jinja2 template) |
| `routes/login.py` | No | Login/logout with styled template |
| `routes/api.py` | Yes | All REST API endpoints (status, stats, versions, logs, errors, settings, service control) |
| `routes/benchmark.py` | Yes | Benchmark API comparing self-hosted vs public instances |
| `routes/jellyfin.py` | Yes | Jellyfin session and activity API |
| `routes/speedtest.py` | Mixed | Speed test page (auth) + download endpoint (no auth, rate-limited) |
| `routes/public.py` | No | Unauthenticated health summary |
| `routes/dmesg.py` | Yes | Kernel log endpoint |

### Stats Collection

| Module | Purpose |
|--------|---------|
| `stats/__init__.py` | Orchestrator running collection every 60s, GitHub versions every 6h |
| `stats/collectors.py` | 19 per-service API collectors with enhanced metrics |
| `stats/base.py` | Shared httpx helpers (_get, _get_raw) |
| `stats/github.py` | GitHub release version fetcher |
| `stats/system.py` | System stats (CPU, RAM, disk I/O, network, GPU, sensors) |

## Data Flow

```
┌─────────────────────────────────────────────────────┐
│                  Background Tasks                    │
│                                                     │
│  health.poll_loop()     → every 30s → health.cur    │
│  stats.stats_loop()     → every 60s → stats.data    │
│  stats.github_refresh() → every 6h  → versions      │
│  errors.scan_loop()     → every 120s → error_history │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                   API Endpoints                      │
│                                                     │
│  /api/status  → health data                         │
│  /api/stats   → collected metrics                   │
│  /api/versions → installed vs latest                │
│  /api/errors  → scanned error history               │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                   Frontend (JS)                      │
│                                                     │
│  Auto-refresh every 30s via fetch()                 │
│  Renders service cards with color-coded stats       │
│  Tab-based UI with modals for service details       │
└─────────────────────────────────────────────────────┘
```

## Authentication

- **Method**: Session-based with Argon2id password hashing
- **Storage**: Hash in `data/monitor_pw_hash.txt`, session secret in `data/config.json`
- **Session**: 24-hour max age via Starlette SessionMiddleware
- **Decorator**: `@require_auth` on protected routes returns 401 for API, 303 redirect for pages

## Health Checks

Each service has two independent health indicators:
1. **systemd**: `systemctl is-active {unit}`
2. **HTTP**: GET request to configured health endpoint with expected status codes

Both are checked every 30 seconds. A service is "UP" when both pass, "DOWN" when either fails.

## Stats Collectors

Each collector is an async function that queries a service's API and returns a dict of metrics. Collectors run concurrently with staggered starts to avoid thundering herd. Results are stored in a shared dict and served via `/api/stats`.
