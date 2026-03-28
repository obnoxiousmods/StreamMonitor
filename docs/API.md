# API Reference

Base URL: `http://localhost:9090`

All authenticated endpoints require a valid session cookie (obtained via POST /login).

## Public Endpoints (No Auth)

### GET /api/ping
Liveness check.
```json
{"ok": true, "ts": "2026-03-28T20:00:00+00:00"}
```

### GET /api/public
Service health summary for external monitoring.
```json
{
  "services": {
    "comet": {"ok": true, "name": "Comet"},
    "mediafusion": {"ok": true, "name": "MediaFusion"}
  },
  "up": 23,
  "total": 23
}
```

### GET /speedtest/download
Download random bytes for speed testing.
- `?mb=25` — Size in megabytes (default: 25, max: 500)
- Rate limited: 6 tests per 10 minutes per IP
- Throttled to 1 Gbps
- Returns `application/octet-stream` with `Content-Length` header

---

## Authenticated Endpoints

### GET /api/status
Full service health with rolling history.
```json
{
  "comet": {
    "name": "Comet",
    "ok": true,
    "sys": true,
    "http": true,
    "latency_ms": 253,
    "history": [{"ok": true, "ts": "..."}, ...]
  }
}
```

### GET /api/status/{service_id}
Health for a single service.

### GET /api/stats
All service stats from collectors.
```json
{
  "mediafusion": {"version": "5.4.4", "streams_total": 9400, ...},
  "zilean": {"total_torrents": 1170000, "with_imdb": 960000, ...},
  "stremthru": {"magnet_total": 19700, "magnet_cache": {...}, ...}
}
```

### GET /api/stats/{service_id}
Stats for a single service.

### GET /api/versions
Installed vs latest GitHub release versions.
```json
{
  "comet": {"installed": "2.53.0", "latest": "2.53.0", "repo": "g0ldyy/comet"},
  "mediafusion": {"installed": "5.4.4", "latest": "5.4.5", "repo": "mhdzumair/MediaFusion"}
}
```

### GET /api/logs/{unit}
Journal log lines for a systemd unit.
- `?lines=200` — Number of lines (default: 200, max: 1000)
```json
{"lines": ["Mar 28 12:00:00 host service[pid]: log message", ...]}
```

### GET /api/dmesg
Kernel log via `journalctl -k`.
- `?lines=100` — Number of lines (default: 100, max: 500)

### GET /api/benchmark
Run stream resolution benchmark.
- `?imdb=tt0468569` — IMDB ID (supports movies, series, and episodes like `tt0903747:3:7`)
```json
{
  "imdb": "tt0468569",
  "title": "The Dark Knight",
  "results": [
    {
      "name": "Comet (self-hosted)",
      "type": "self-hosted",
      "latency_ms": 9,
      "raw_streams": 1,
      "res_4k": 0,
      "res_1080p": 0,
      "res_720p": 0,
      "top_codec": null
    }
  ],
  "summary": "Self-hosted: 410 streams, 1316ms avg | Public: 150 streams, 121ms avg",
  "timestamp": "2026-03-28T20:00:00+00:00"
}
```

### GET /api/jellyfin
Active Jellyfin sessions and recent activity.
```json
{
  "sessions": [...],
  "activity": [...]
}
```

### GET /api/errors
Scanned error/warning history with deduplication.

### DELETE /api/errors
Clear error history.

### POST /api/errors/scan
Trigger immediate error scan.

### POST /api/service/{unit}/{action}
Control a systemd service. Actions: `start`, `stop`, `restart`.

### POST /api/perms/scan
Scan directory permissions across 94 configured paths.

### POST /api/perms/fix
Apply permission fixes from a previous scan.

### GET /api/settings/keys
List configured API keys (values masked).

### POST /api/settings/keys
Update API keys.
```json
{"jellyfin_api_key": "new-key", "prowlarr_api_key": "new-key"}
```

### POST /api/settings/password
Change admin password.
```json
{"current": "old-password", "new": "new-password"}
```
