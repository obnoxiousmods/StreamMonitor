<div align="center">

# StreamMonitor

**Production-grade infrastructure monitoring dashboard for self-hosted media streaming stacks**

[![Release](https://img.shields.io/github/v/release/obnoxiousmods/StreamMonitor?style=flat-square&color=7c5cff)](https://github.com/obnoxiousmods/StreamMonitor/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.14+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)

Monitor, benchmark, and manage your entire debrid media stack from one beautiful dark-themed dashboard.

</div>

---

## Features

### Service Health Monitoring
- **Dual health checks** - systemd unit status + HTTP endpoint probing every 30 seconds
- **23+ services** monitored across 8 categories: Streaming, Indexers, Arr Suite, Media, Downloads, Infrastructure
- **Rolling history** - 120-entry health history per service with latency tracking
- **Service controls** - Start/stop/restart services directly from the dashboard

### Enhanced Service Stats
Deep API integration with per-service collectors running every 60 seconds:

| Service | Stats Collected |
|---------|----------------|
| **MediaFusion** | Streams, content (movies/series), scrapers (27 active), top torrent sources, debrid cache, Redis memory, DB size |
| **Zilean** | 1.1M+ torrents indexed, IMDB match rate, quality distribution (1080p/4K/720p), DMM scraper status, DB size |
| **StremThru** | Magnet cache (18K+ RD, 1K+ TB), torrent info count, DMM hashes, DB size |
| **AIOStreams** | Users, catalogs, presets (73), forced debrid services, cache entries, TMDB availability, build info |
| **Comet** | Version, scraper status, 24h found count, fail rate |
| **Jellyfin** | Library counts, active sessions, playback info |
| **Prowlarr** | Indexers, queries, grabs, failed queries, health warnings |
| **Radarr/Sonarr/Lidarr** | Library sizes, queue, disk space, health checks |

### Benchmark Tab
Compare your self-hosted stack against public instances:

- **8 endpoints tested**: Comet, Zilean, MediaFusion, StremThru Torz, AIOStreams (self-hosted) vs Torrentio, Torrentio P2P, TorBox (public)
- **39 test titles** across 8 categories:
  - Popular Movies (Dark Knight, Inception, Oppenheimer...)
  - Niche Movies (Parasite, Spirited Away, Your Name...)
  - Popular TV (Breaking Bad, Game of Thrones, Chernobyl...)
  - Niche TV (The Wire, Black Mirror, Severance...)
  - Popular Anime (Death Note, Demon Slayer, My Hero Academia...)
  - Niche Anime (Steins;Gate, Hunter x Hunter, Made in Abyss...)
  - TV Episodes (specific season/episode for series testing)
- **Metrics**: Latency, stream count, resolution breakdown (4K/1080p/720p), codec detection
- **Run All Titles** - aggregate comparison with expandable per-title details

### Speed Test
Built into the login page and available as a standalone tab:
- **Direct** (origin server) vs **Cloudflare** (CDN) download comparison
- Animated progress bars with real-time Mbps calculation
- Configurable test sizes: 10 MB to 500 MB
- Rate limiting: 6 tests per 10 minutes per IP
- 1 Gbps throttle cap

### Additional Features
- **Live Logs** - streaming journalctl viewer with unit selection and text filtering
- **Error Scanner** - automated log scanning every 2 minutes with service-specific classifiers and dedup
- **Permission Scanner** - scan and bulk-fix ownership/permissions across 94 critical paths
- **Jellyfin Tab** - active sessions (who's watching what) and recent activity log
- **Kernel Logs** - dmesg endpoint for system-level debugging
- **GitHub Version Tracking** - compares installed vs latest release for 20+ services
- **GPU Monitoring** - AMD Radeon stats via sysfs (usage, VRAM, temp, power, fan)
- **System Stats** - CPU, RAM, disk I/O, network I/O, sensors, temperatures

### UI
- Modern dark theme (#060818 background, #7c5cff accent)
- Glassmorphism login card with animated starfield background
- Service cards with color-coded KV pairs and responsive grid layout
- Collapsible service modals with live logs and controls
- Real-time 30-second auto-refresh

---

## Architecture

```
streammonitor/
├── app.py                  # Routes, auth, Jinja2 template rendering (Starlette)
├── main.py                 # Entry point (uvicorn)
├── config.py               # Service definitions, API keys
├── health.py               # Dual health check loop (systemd + HTTP)
├── errors.py               # Log error scanner with 20 classifiers
├── perms.py                # Permission scanner (94 paths)
├── templates/              # Jinja2 HTML templates
│   ├── dashboard.html      # Main dashboard UI
│   ├── login.html          # Login page with speed test + service status
│   └── speedtest.html      # Standalone speed test page
├── static/                 # Static assets (CSS, JS)
│   ├── css/
│   │   ├── main.css        # Dashboard styles
│   │   ├── login.css       # Login page styles
│   │   └── speedtest.css   # Speed test styles
│   └── js/
│       ├── dashboard.js    # Dashboard logic (~1000 lines)
│       ├── login.js        # Login page speed test + service status
│       └── speedtest.js    # Standalone speed test logic
├── routes/                 # Modular API routes
│   ├── benchmark.py        # Benchmark system (39 titles, 8 endpoints)
│   ├── jellyfin.py         # Jellyfin sessions and activity
│   ├── speedtest.py        # Speed test download endpoint + page route
│   ├── public.py           # Unauthenticated health API
│   └── dmesg.py            # Kernel log endpoint
├── stats/                  # Stats collection system
│   ├── __init__.py         # Collection orchestrator (60s interval)
│   ├── collectors.py       # 19 per-service API collectors
│   ├── base.py             # Shared HTTP helpers (httpx)
│   ├── github.py           # GitHub release version fetcher
│   └── system.py           # System stats (CPU, RAM, disk, GPU, sensors)
├── data/                   # Runtime data (gitignored)
│   ├── apikeys.json        # API keys (editable via Settings tab)
│   └── monitor_pw_hash.txt # Argon2 password hash
├── pyproject.toml          # Python project manifest + ruff config
└── streammonitor.spec      # PyInstaller build config
```

---

## Installation

### Option 1: Pre-built Binary (Linux x86_64)

```bash
wget https://github.com/obnoxiousmods/StreamMonitor/releases/latest/download/streammonitor
chmod +x streammonitor
./streammonitor
# Runs on http://127.0.0.1:9090
# Default login: admin / admin
```

### Option 2: From Source

```bash
git clone https://github.com/obnoxiousmods/StreamMonitor.git
cd StreamMonitor
uv sync
uv run uvicorn app:app --host 127.0.0.1 --port 9090
```

### Option 3: systemd Service

```ini
[Unit]
Description=StreamMonitor
After=network.target

[Service]
Type=simple
User=your-user
Group=media
WorkingDirectory=/path/to/StreamMonitor
ExecStart=uv run uvicorn app:app --host 127.0.0.1 --port 9090 --log-level info
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### First Login

Default credentials: `admin` / `admin`

Change the password immediately via the **Settings** tab.

---

## Configuration

### API Keys

Configure via the **Settings** tab in the UI, or edit `data/apikeys.json` directly:

```json
{
  "jellyfin_api_key": "your-key",
  "prowlarr_api_key": "your-key",
  "radarr_api_key": "your-key",
  "sonarr_api_key": "your-key",
  "mediafusion_email": "admin@example.com",
  "mediafusion_password": "your-password"
}
```

### Service Definitions

Edit `config.py` to add/remove monitored services:

```python
SERVICES = {
    "myservice": {
        "name": "My Service",
        "unit": "myservice",           # systemd unit name
        "url": "http://127.0.0.1:PORT/health",  # health endpoint
        "ok": [200],                    # acceptable HTTP status codes
        "category": "streaming",        # UI category
    },
}
```

### Environment Variables

See `.env.example` for all configurable variables.

---

## API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/ping` | No | Liveness check |
| `GET /api/public` | No | Service health summary |
| `GET /api/status` | Yes | Full service health + history |
| `GET /api/stats` | Yes | All service stats |
| `GET /api/versions` | Yes | Installed vs latest versions |
| `GET /api/logs/{unit}` | Yes | Journal log lines |
| `GET /api/dmesg` | Yes | Kernel logs |
| `GET /api/benchmark?imdb=tt0468569` | Yes | Run benchmark for a title |
| `GET /api/jellyfin` | Yes | Jellyfin sessions + activity |
| `GET /api/errors` | Yes | Scanned error history |
| `POST /api/service/{unit}/{action}` | Yes | Start/stop/restart service |
| `POST /api/perms/scan` | Yes | Scan directory permissions |
| `POST /api/perms/fix` | Yes | Fix permissions |
| `GET /speedtest` | Yes | Speed test page |
| `GET /speedtest/download?mb=25` | No | Speed test download (rate-limited) |

---

## Building

### PyInstaller Binary

```bash
uv pip install pyinstaller
uv run pyinstaller streammonitor.spec --noconfirm --clean
# Output: dist/streammonitor (14MB standalone binary)
```

### Linting

The project uses [Ruff](https://docs.astral.sh/ruff/) for linting and formatting with zero ignored rules:

```bash
ruff check .        # Lint
ruff format .       # Format
ruff check --fix .  # Auto-fix
```

---

## Stack Compatibility

StreamMonitor is designed for self-hosted debrid media stacks. Out of the box it monitors:

| Category | Services |
|----------|----------|
| **Streaming** | Comet, MediaFusion, StremThru, Zilean, AIOStreams, MediaFlow Proxy |
| **Indexers** | Jackett, Prowlarr, FlareSolverr, Byparr |
| **Arr Suite** | Radarr, Sonarr, Lidarr, Bazarr |
| **Media** | Jellyfin, Plex, JellySeerr |
| **Downloads** | qBittorrent |
| **Infrastructure** | PostgreSQL, Redis/Valkey, PgBouncer |

Add your own services by editing `config.py`.

---

## License

MIT
