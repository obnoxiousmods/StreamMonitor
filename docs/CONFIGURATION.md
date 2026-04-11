# Configuration Guide

## Service Definitions

Services are defined in `config.py` in the `SERVICES` dictionary:

```python
SERVICES = {
    "myservice": {
        "name": "My Service",           # Display name
        "unit": "myservice",            # systemd unit name, or None for HTTP-only
        "url": "http://127.0.0.1:PORT/health",  # Health check URL
        "ok": [200],                    # Acceptable HTTP status codes
        "category": "streaming",        # UI category for grouping
        # Optional:
        "headers": {"X-Api-Key": KEY},  # Custom headers for health check
        "ssl": False,                   # Disable SSL verification
        "follow_redirects": True,       # Follow HTTP redirects
    },
}
```

### Categories

Services are grouped into these categories in the UI:
- `streaming` — Comet, MediaFusion, StremThru, Zilean, AIOStreams, MediaFlow
- `indexers` — Jackett, Prowlarr, FlareSolverr, Byparr
- `arr` — Radarr, Sonarr, Lidarr, Bazarr
- `media` — Jellyfin, Plex, JellySeerr
- `dispatch` — Dispatcharr, MediaFlow
- `downloads` — qBittorrent
- `infra` — PostgreSQL, Redis, PgBouncer, System

## API Keys

### Via Settings Tab (Recommended)
Navigate to Settings in the dashboard and update keys through the UI.

### Via apikeys.json
Edit `data/apikeys.json` directly:

```json
{
  "jellyfin_api_key": "your-jellyfin-api-key",
  "jackett_api_key": "your-jackett-api-key",
  "prowlarr_api_key": "your-prowlarr-api-key",
  "radarr_api_key": "your-radarr-api-key",
  "sonarr_api_key": "your-sonarr-api-key",
  "lidarr_api_key": "your-lidarr-api-key",
  "bazarr_api_key": "your-bazarr-api-key",
  "zilean_api_key": "your-zilean-api-key",
  "mediafusion_email": "admin@example.com",
  "mediafusion_password": "your-mf-password",
  "mediafusion_api_password": "your-mf-api-password",
  "stremthru_user": "admin",
  "stremthru_pass": "your-stremthru-password",
  "comet_user": "admin",
  "comet_pass": "your-comet-password",
  "qbt_user": "admin",
  "qbt_pass": "your-qbt-password"
}
```

### Via Environment Variables
Set variables matching the keys above in UPPER_SNAKE_CASE:
```bash
export JELLYFIN_API_KEY=your-key
export PROWLARR_API_KEY=your-key
```

Priority: Environment variable > apikeys.json > ~/.apikeys > default

### Custom systemd units and HTTP-only checks

Each built-in service supports a `<SERVICE>_UNIT` environment variable. Use it
when a service runs under a different systemd name:

```bash
export JELLYFIN_UNIT=jellyfin-test
```

Set the unit to `none` to skip systemd and rely on the HTTP health URL only,
which is useful for Docker, remote servers, and non-systemd hosts:

```bash
export JELLYFIN_UNIT=none
export JELLYFIN_URL=https://jellyfin.example.com
```

## Admin Password

### Default
Username: `admin`, Password: `admin`

### Changing
Use the Settings tab, or generate an Argon2 hash:
```bash
python3 -c "from argon2 import PasswordHasher; print(PasswordHasher().hash('your-new-password'))"
```
Write the hash to `data/monitor_pw_hash.txt`.

## Adding Custom Stats Collectors

Create a new async function in `stats/collectors.py`:

```python
async def collect_myservice() -> dict:
    async with httpx.AsyncClient(timeout=8) as c:
        data = await _get(c, "http://127.0.0.1:PORT/api/stats")
    if not isinstance(data, dict):
        return {}
    return {
        "metric1": data.get("field1"),
        "metric2": data.get("field2"),
    }
```

Register it in `stats/__init__.py`:
```python
from stats.collectors import collect_myservice
COLLECTORS["myservice"] = collect_myservice
```

Add a card renderer in the dashboard JS to display the stats.

## Benchmark Endpoints

Configure benchmark targets in `routes/benchmark.py`:

```python
ENDPOINTS = [
    {
        "name": "My Addon (self-hosted)",
        "type": "self-hosted",
        "url": "http://127.0.0.1:PORT/stream/{type}/{imdb}.json",
    },
]
```

## Nginx Reverse Proxy

Example nginx configuration for HTTPS access:

```nginx
server {
    server_name monitor.example.com;

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_pass http://127.0.0.1:9090;
    }

    listen 443 ssl;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
}
```
