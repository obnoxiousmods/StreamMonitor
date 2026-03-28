"""Per-service API stats collectors."""

from __future__ import annotations

import asyncio
import base64
import logging
import re
import time
from pathlib import Path
from xml.etree import ElementTree as ET

import httpx

import config as cfg
from stats.base import _get, _get_raw

# ── Comet admin session cache ─────────────────────────────────────────────────
_comet_session: str = ""
_comet_session_expiry: float = 0.0
_comet_version: str | None = None


async def _get_comet_session() -> str:
    global _comet_session, _comet_session_expiry
    if _comet_session and time.monotonic() < _comet_session_expiry:
        return _comet_session
    if not cfg.COMET_ADMIN_PASS:
        return ""
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False) as c:
            r = await c.post(
                f"{cfg.COMET_URL}/admin/login",
                content=f"password={cfg.COMET_ADMIN_PASS}",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            cookie = r.cookies.get("admin_session", "")
            if not cookie:
                # try Set-Cookie header
                sc = r.headers.get("set-cookie", "")
                cookie = m.group(1) if (m := re.search(r"admin_session=([^;]+)", sc)) else ""
            if cookie:
                _comet_session = cookie
                _comet_session_expiry = time.monotonic() + 82800  # 23h
                return cookie
    except Exception:
        pass
    return ""


# ── Dispatcharr JWT cache ─────────────────────────────────────────────────────
_dispatcharr_token: str = ""
_dispatcharr_token_expiry: float = 0.0


async def _get_dispatcharr_token() -> str:
    global _dispatcharr_token, _dispatcharr_token_expiry
    if _dispatcharr_token and time.monotonic() < _dispatcharr_token_expiry:
        return _dispatcharr_token
    if not cfg.DISPATCHARR_PASS:
        return ""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.post(
                f"{cfg.DISPATCHARR_API_URL}/api/accounts/token/",
                json={"username": cfg.DISPATCHARR_USER, "password": cfg.DISPATCHARR_PASS},
            )
            if r.status_code == 200:
                token = r.json().get("access", "")
                if token:
                    _dispatcharr_token = token
                    _dispatcharr_token_expiry = time.monotonic() + 3600
                    return token
    except Exception:
        pass
    return ""


# ── Collectors ────────────────────────────────────────────────────────────────


async def collect_comet() -> dict:
    session = await _get_comet_session()
    cookie_h = {"Cookie": f"admin_session={session}"} if session else {}

    async with httpx.AsyncClient(timeout=10) as c:
        manifest, metrics, connections, bg_status = await asyncio.gather(
            _get(c, f"{cfg.COMET_URL}/manifest.json"),
            _get(c, f"{cfg.COMET_URL}/admin/api/metrics", cookie_h),
            _get(c, f"{cfg.COMET_URL}/admin/api/connections", cookie_h),
            _get(c, f"{cfg.COMET_URL}/admin/api/background-scraper/status", cookie_h),
            return_exceptions=True,
        )
    result: dict = {}

    if isinstance(manifest, dict):
        # manifest.json always returns the Stremio addon API version ("2.0.0"),
        # not the actual Comet release version. Read CHANGELOG.md instead.
        global _comet_version
        if _comet_version is None:
            try:
                for line in Path(cfg.COMET_CHANGELOG).read_text().splitlines():
                    if m := re.search(r"\[(\d+\.\d+\.\d+)\]", line):
                        _comet_version = m.group(1)
                        break
            except Exception as e:
                logging.debug(f"Could not read Comet CHANGELOG: {e}")
                _comet_version = ""
        result["version"] = _comet_version or manifest.get("version", "")
        result["types"] = manifest.get("types", [])

    if isinstance(metrics, dict):
        t = metrics.get("torrents", {})
        result["torrents_total"] = t.get("total", 0)
        by_tracker = t.get("by_tracker", [])
        result["top_trackers"] = [{"name": tr["tracker"], "count": tr["count"]} for tr in by_tracker[:5]]

    if isinstance(connections, dict):
        gs = connections.get("global_stats", {})
        result["active_connections"] = gs.get("active_connections", 0)
        result["peak_concurrent"] = gs.get("peak_concurrent", 0)
        result["bytes_alltime"] = gs.get("total_bytes_alltime_formatted", "")

    if isinstance(bg_status, dict):
        result["scraper_running"] = bg_status.get("running", False)
        result["scraper_paused"] = bg_status.get("paused", False)
        q = bg_status.get("queue", {})
        result["queue_movies"] = q.get("movies", 0)
        result["queue_series"] = q.get("series", 0)
        slo = bg_status.get("slo", {})
        result["slo_torrents_found"] = slo.get("torrents_found", 0)
        result["slo_fail_rate"] = slo.get("fail_rate", 0)
        result["slo_processed"] = slo.get("processed", 0)

    return result


# ── MediaFusion JWT session cache ─────────────────────────────────────────────
_mf_token: str = ""
_mf_token_expiry: float = 0.0


async def _get_mf_token() -> str:
    global _mf_token, _mf_token_expiry
    if _mf_token and time.monotonic() < _mf_token_expiry:
        return _mf_token
    if not cfg.MEDIAFUSION_EMAIL or not cfg.MEDIAFUSION_USER_PASS:
        return ""
    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as c:
            r = await c.post(
                f"{cfg.MEDIAFUSION_URL}/api/v1/auth/login",
                json={"email": cfg.MEDIAFUSION_EMAIL, "password": cfg.MEDIAFUSION_USER_PASS},
                headers={"X-API-Key": cfg.MEDIAFUSION_PASS},
            )
            tok = r.json().get("access_token", "") if r.status_code == 200 else ""
            if tok:
                _mf_token = tok
                _mf_token_expiry = time.monotonic() + 25 * 60
    except Exception:
        pass
    return _mf_token


async def collect_mediafusion() -> dict:
    token = await _get_mf_token()
    admin_hdrs = {
        "X-API-Key": cfg.MEDIAFUSION_PASS,
        "Authorization": f"Bearer {token}",
    }
    base = cfg.MEDIAFUSION_URL
    async with httpx.AsyncClient(verify=False, timeout=10) as c:
        coros = [
            _get(c, f"{base}/api/v1/instance/info"),
            _get(c, f"{base}/manifest.json"),
        ]
        if token:
            coros += [
                _get(c, f"{base}/api/v1/admin/metrics/system/overview", admin_hdrs),
                _get(c, f"{base}/api/v1/admin/schedulers/stats", admin_hdrs),
                _get(c, f"{base}/api/v1/admin/metrics/torrents/sources", admin_hdrs),
                _get(c, f"{base}/api/v1/admin/metrics/debrid-cache", admin_hdrs),
                _get(c, f"{base}/api/v1/admin/metrics/redis", admin_hdrs),
            ]
        responses = await asyncio.gather(*coros, return_exceptions=True)

    info = responses[0]
    manifest = responses[1]
    overview = responses[2] if len(responses) > 2 else None
    sched = responses[3] if len(responses) > 3 else None
    sources = responses[4] if len(responses) > 4 else None
    debrid_c = responses[5] if len(responses) > 5 else None
    redis_m = responses[6] if len(responses) > 6 else None

    result: dict = {}
    if isinstance(info, dict):
        result.update(
            {
                "version": info.get("version", ""),
                "is_public": info.get("is_public", False),
                "setup_required": info.get("setup_required", False),
                "requires_api_key": info.get("requires_api_key", False),
            }
        )
    if isinstance(manifest, dict):
        result["addon_name"] = manifest.get("name", "")
        result["addon_version"] = manifest.get("version", "")
    if isinstance(overview, dict) and "streams" in overview:
        result["streams_total"] = overview["streams"]["total"]
        st = overview.get("streams", {}).get("by_type", {})
        result["stream_types"] = {k: v for k, v in st.items() if v > 0}
        c2 = overview.get("content", {})
        result["movies"] = c2.get("movies", 0)
        result["series"] = c2.get("series", 0)
        result["content_total"] = c2.get("total", 0)
        u = overview.get("users", {})
        result["users_total"] = u.get("total", 0)
        result["users_active"] = u.get("active_today", 0)
        result["pending_contributions"] = overview.get("moderation", {}).get("pending_contributions", 0)
    if isinstance(sched, dict) and "total_jobs" in sched:
        result["sched_active"] = sched.get("active_jobs", 0)
        result["sched_total"] = sched.get("total_jobs", 0)
        result["sched_running"] = sched.get("running_jobs", 0)
        result["sched_paused"] = sched.get("global_scheduler_disabled", False)
        cats = sched.get("jobs_by_category", {})
        result["scrapers_active"] = cats.get("scraper", {}).get("active", 0)
        result["scrapers_total"] = cats.get("scraper", {}).get("total", 0)
    if isinstance(sources, list):
        result["top_sources"] = {s["name"]: s["count"] for s in sources[:5]}
    if isinstance(debrid_c, dict):
        svcs = debrid_c.get("services", {})
        result["debrid_cached"] = {k: v.get("cached_torrents", 0) for k, v in svcs.items() if isinstance(v, dict)}
    if isinstance(redis_m, dict):
        mem = redis_m.get("memory", {})
        result["redis_mem"] = mem.get("used_memory_human", "")

    # Direct DB stats (always available via pgbouncer, doesn't need admin auth)
    if "streams_total" not in result:
        try:
            proc = await asyncio.create_subprocess_exec(
                "psql",
                "-h",
                "127.0.0.1",
                "-p",
                "6432",
                "-U",
                "mediafusion",
                "-d",
                "mediafusion",
                "-t",
                "-A",
                "-c",
                "SELECT "
                "(SELECT COUNT(*) FROM torrent_stream),"
                "(SELECT COUNT(*) FROM stream),"
                "(SELECT COUNT(*) FROM media),"
                "(SELECT COUNT(*) FROM media WHERE type='movie'),"
                "(SELECT COUNT(*) FROM media WHERE type='series'),"
                "(SELECT COUNT(*) FROM user_profiles);",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
            parts = out.decode().strip().split("|")
            if len(parts) >= 6:
                result["torrents_db"] = int(parts[0])
                result["streams_total"] = int(parts[1])
                result["media_total"] = int(parts[2])
                result["movies"] = int(parts[3])
                result["series"] = int(parts[4])
                result["profiles"] = int(parts[5])
        except Exception:
            pass

    # Scraper health from public indexer source count
    try:
        proc = await asyncio.create_subprocess_exec(
            "psql",
            "-h",
            "127.0.0.1",
            "-p",
            "6432",
            "-U",
            "mediafusion",
            "-d",
            "mediafusion",
            "-t",
            "-A",
            "-c",
            "SELECT pg_size_pretty(pg_database_size('mediafusion'));",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        result["db_size"] = out.decode().strip()
    except Exception:
        pass

    return result


async def collect_stremthru() -> dict:
    basic = base64.b64encode(f"{cfg.STREMTHRU_USER}:{cfg.STREMTHRU_PASS}".encode()).decode()
    auth_h = {"Authorization": f"Basic {basic}"}
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as c:
        health, mfest, store_user = await asyncio.gather(
            _get(c, f"{cfg.STREMTHRU_URL}/v0/health"),
            _get(c, f"{cfg.STREMTHRU_URL}/stremio/store/manifest.json"),
            _get(c, f"{cfg.STREMTHRU_URL}/v0/store/user", auth_h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(health, dict):
        result["status"] = health.get("data", {}).get("status", "")
    if isinstance(mfest, dict):
        result["version"] = mfest.get("version", "")
        result["name"] = mfest.get("name", "")
    if isinstance(store_user, dict):
        data = store_user.get("data", {})
        if isinstance(data, dict):
            result["store_name"] = data.get("name", "")
            result["subscription"] = data.get("subscription_status", "")

    # Magnet cache stats from SQLite
    try:
        proc = await asyncio.create_subprocess_exec(
            "sqlite3",
            cfg.STREMTHRU_DB,
            "SELECT store, is_cached, COUNT(*) FROM magnet_cache GROUP BY store, is_cached;",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        cache_stats: dict = {}
        for line in out.decode().strip().splitlines():
            parts = line.split("|")
            if len(parts) == 3:
                store, cached, count = parts[0], parts[1], int(parts[2])
                cache_stats.setdefault(store, {"cached": 0, "uncached": 0})
                cache_stats[store]["cached" if cached == "1" else "uncached"] = count
        result["magnet_cache"] = cache_stats
        result["magnet_total"] = sum(s["cached"] + s["uncached"] for s in cache_stats.values())
    except Exception:
        pass

    # Torrent info count
    try:
        proc = await asyncio.create_subprocess_exec(
            "sqlite3",
            cfg.STREMTHRU_DB,
            "SELECT COUNT(*) FROM torrent_info;",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        val = out.decode().strip()
        if val.isdigit():
            result["torrent_info_count"] = int(val)
    except Exception:
        pass

    # DMM hashlist count
    try:
        proc = await asyncio.create_subprocess_exec(
            "sqlite3",
            cfg.STREMTHRU_DB,
            "SELECT COUNT(*) FROM dmm_hashlist;",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        val = out.decode().strip()
        if val.isdigit():
            result["dmm_hashes"] = int(val)
    except Exception:
        pass

    # DB file size
    try:
        p = Path(cfg.STREMTHRU_DB)
        if p.exists():
            size_mb = p.stat().st_size / (1024 * 1024)
            result["db_size"] = f"{size_mb:.0f} MB" if size_mb < 1024 else f"{size_mb / 1024:.1f} GB"
    except Exception:
        pass

    return result


async def collect_zilean() -> dict:
    h = {"X-Api-Key": cfg.ZILEAN_KEY} if cfg.ZILEAN_KEY else {}
    async with httpx.AsyncClient(timeout=10) as c:
        ping, sample = await asyncio.gather(
            _get_raw(c, f"{cfg.ZILEAN_URL}/healthchecks/ping", h),
            _get(c, f"{cfg.ZILEAN_URL}/dmm/filtered?query=batman&limit=10", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(ping, str):
        result["responding"] = True
        result["status"] = "ok" if "Pong" in ping else ping[:30]

    if isinstance(sample, list):
        result["sample_results"] = len(sample)
        resolutions = [e.get("resolution") for e in sample if e.get("resolution")]
        if resolutions:
            from collections import Counter

            result["sample_qualities"] = dict(Counter(resolutions).most_common(3))
        dates = [
            e.get("ingested_at") or e.get("createdAt") for e in sample if e.get("ingested_at") or e.get("createdAt")
        ]
        if dates:
            result["latest_indexed"] = max(dates)[:19]

    # DB stats via psql (fast queries on indexed columns)
    try:
        proc = await asyncio.create_subprocess_exec(
            "psql",
            "-h",
            "127.0.0.1",
            "-p",
            "6432",
            "-U",
            "zilean",
            "-d",
            "zilean",
            "-t",
            "-A",
            "-c",
            'SELECT COUNT(*), COUNT(CASE WHEN "ImdbId" IS NOT NULL THEN 1 END) FROM "Torrents";',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        parts = out.decode().strip().split("|")
        if len(parts) == 2:
            result["total_torrents"] = int(parts[0])
            result["with_imdb"] = int(parts[1])
    except Exception:
        pass

    # Quality distribution from DB
    try:
        proc = await asyncio.create_subprocess_exec(
            "psql",
            "-h",
            "127.0.0.1",
            "-p",
            "6432",
            "-U",
            "zilean",
            "-d",
            "zilean",
            "-t",
            "-A",
            "-c",
            'SELECT "Resolution", COUNT(*) FROM "Torrents"'
            " WHERE \"Resolution\" IN ('1080p','2160p','720p','480p','unknown')"
            ' GROUP BY "Resolution" ORDER BY COUNT(*) DESC;',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        quality_dist = {}
        for line in out.decode().strip().splitlines():
            parts = line.split("|")
            if len(parts) == 2:
                quality_dist[parts[0]] = int(parts[1])
        if quality_dist:
            result["quality_distribution"] = quality_dist
    except Exception:
        pass

    # Import metadata (DMM scrape status)
    try:
        proc = await asyncio.create_subprocess_exec(
            "psql",
            "-h",
            "127.0.0.1",
            "-p",
            "6432",
            "-U",
            "zilean",
            "-d",
            "zilean",
            "-t",
            "-A",
            "-c",
            'SELECT "Key", "Value"::text FROM "ImportMetadata";',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        import json as _json

        for line in out.decode().strip().splitlines():
            if "|" not in line:
                continue
            key, val = line.split("|", 1)
            try:
                meta = _json.loads(val)
            except Exception:
                continue
            if key.strip() == "DmmLastImport":
                result["dmm_status"] = "ok" if meta.get("Status") == 0 else "error"
                result["dmm_last_run"] = (meta.get("OccuredAt") or "")[:19]
                result["dmm_entries"] = meta.get("EntryCount", 0)
            elif key.strip() == "ImdbLastImport":
                result["imdb_status"] = "ok" if meta.get("Status") in (0, 1) else "error"
                result["imdb_last_run"] = (meta.get("OccuredAt") or "")[:19]
                result["imdb_entries"] = meta.get("EntryCount", 0)
    except Exception:
        pass

    # Scraper child process check
    try:
        proc = await asyncio.create_subprocess_exec(
            "pgrep",
            "-f",
            "zilean.*scraper.*dmm",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=3)
        result["scraper_running"] = bool(out.decode().strip())
    except Exception:
        pass

    # DB size
    try:
        proc = await asyncio.create_subprocess_exec(
            "psql",
            "-h",
            "127.0.0.1",
            "-p",
            "6432",
            "-U",
            "zilean",
            "-d",
            "zilean",
            "-t",
            "-A",
            "-c",
            "SELECT pg_size_pretty(pg_database_size('zilean'));",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        result["db_size"] = out.decode().strip()
    except Exception:
        pass

    return result


async def collect_aiostreams() -> dict:
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as c:
        manifest, status, health = await asyncio.gather(
            _get(c, f"{cfg.AIOSTREAMS_URL}/stremio/manifest.json"),
            _get(c, f"{cfg.AIOSTREAMS_URL}/api/v1/status"),
            _get(c, f"{cfg.AIOSTREAMS_URL}/api/v1/health"),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(manifest, dict):
        result["responding"] = True
        result["version"] = manifest.get("version", "")
        result["name"] = manifest.get("name", "")
        result["catalogs"] = len(manifest.get("catalogs", []))
    elif isinstance(health, dict):
        result["responding"] = health.get("success", False)
    else:
        try:
            async with httpx.AsyncClient(timeout=5) as c2:
                r = await c2.get(f"{cfg.AIOSTREAMS_URL}/")
                result["responding"] = r.status_code < 500
        except Exception:
            pass
        return result

    if isinstance(status, dict):
        data = status.get("data", {})
        result["tag"] = data.get("tag", "")
        result["channel"] = data.get("channel", "")
        result["commit"] = data.get("commit", "")
        if data.get("users") is not None:
            result["users"] = data["users"]
        settings = data.get("settings", {})
        result["protected"] = settings.get("protected", False)
        result["tmdb_available"] = settings.get("tmdbApiAvailable", False)
        result["base_url"] = settings.get("baseUrl", "")
        result["presets_available"] = len(settings.get("presets", []))
        services = settings.get("services", {})
        forced = [k for k, v in services.items() if isinstance(v, dict) and v.get("hasForcedCredentials")]
        result["forced_services"] = forced if forced else list(services.keys())[:5]
        limits = settings.get("limits", {})
        result["max_addons"] = limits.get("maxAddons", 0)

    # User count from SQLite
    try:
        proc = await asyncio.create_subprocess_exec(
            "sqlite3",
            cfg.AIOSTREAMS_DB,
            "SELECT COUNT(*) FROM USERS;",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=3)
        val = out.decode().strip()
        if val.isdigit():
            result["user_count"] = int(val)
    except Exception:
        pass

    # DB cache size
    try:
        proc = await asyncio.create_subprocess_exec(
            "sqlite3",
            cfg.AIOSTREAMS_DB,
            "SELECT COUNT(*) FROM cache;",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=3)
        val = out.decode().strip()
        if val.isdigit():
            result["cache_entries"] = int(val)
    except Exception:
        pass

    return result


async def collect_flaresolverr() -> dict:
    async with httpx.AsyncClient(timeout=8) as c:
        h = await _get(c, f"{cfg.FLARESOLVERR_URL}/health")
    if isinstance(h, dict):
        return {"status": h.get("status", ""), "version": h.get("version", "")}
    return {}


async def collect_jackett() -> dict:
    result: dict = {}
    indexer_dir = Path(cfg.JACKETT_INDEXER_DIR)
    if indexer_dir.exists():
        result["indexers_configured"] = len(list(indexer_dir.glob("*.json")))
    try:
        proc = await asyncio.create_subprocess_exec(
            "pacman",
            "-Q",
            "jackett",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        out = stdout.decode().strip()
        if out:
            result["version"] = out.split()[-1] if " " in out else out
    except Exception:
        pass
    async with httpx.AsyncClient(timeout=10) as c:
        r = await _get(
            c, f"{cfg.JACKETT_URL}/api/v2.0/indexers/all/results?apikey={cfg.JACKETT_KEY}&Query=test&Limit=1"
        )
    if isinstance(r, dict):
        result["responding"] = True
    return result


async def collect_prowlarr() -> dict:
    base = cfg.PROWLARR_URL
    h = {"X-Api-Key": cfg.PROWLARR_KEY}
    async with httpx.AsyncClient(timeout=10) as c:
        status, indexers, health, istats = await asyncio.gather(
            _get(c, f"{base}/api/v1/system/status", h),
            _get(c, f"{base}/api/v1/indexer", h),
            _get(c, f"{base}/api/v1/health", h),
            _get(c, f"{base}/api/v1/indexerstats", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"] = status.get("version", "")
    if isinstance(indexers, list):
        result["indexers_total"] = len(indexers)
        result["indexers_enabled"] = sum(1 for i in indexers if i.get("enable"))
    if isinstance(health, list):
        result["health_errors"] = sum(1 for h in health if h.get("type") == "error")
        result["health_warnings"] = sum(1 for h in health if h.get("type") == "warning")
        result["health_messages"] = [h.get("message", "") for h in health if h.get("type") == "error"][:3]
    if isinstance(istats, dict):
        idxs = istats.get("indexers", [])
        result["total_queries"] = sum(i.get("numberOfQueries", 0) for i in idxs)
        result["total_grabs"] = sum(i.get("numberOfGrabs", 0) for i in idxs)
        result["total_failed_queries"] = sum(i.get("numberOfFailedQueries", 0) for i in idxs)
    return result


async def _arr(base: str, key: str, *, path: str = "v3") -> dict:
    h = {"X-Api-Key": key}
    async with httpx.AsyncClient(timeout=20) as c:
        status, items, queue, health, disk = await asyncio.gather(
            _get(c, f"{base}/api/{path}/system/status", h),
            _get(c, f"{base}/api/{path}/{'movie' if 'v3' in path else 'artist'}", h, timeout=15.0),
            _get(c, f"{base}/api/{path}/queue", h),
            _get(c, f"{base}/api/{path}/health", h),
            _get(c, f"{base}/api/{path}/diskspace", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"] = status.get("version", "")
    if isinstance(queue, dict):
        recs = queue.get("records", [])
        result["queue"] = queue.get("totalRecords", len(recs))
        result["queue_errors"] = sum(
            1 for r in recs if r.get("status") in ("warning", "error") or r.get("errorMessage")
        )
    if isinstance(health, list):
        result["health_errors"] = sum(1 for h in health if h.get("type") == "error")
        result["health_warnings"] = sum(1 for h in health if h.get("type") == "warning")
        result["health_messages"] = [h.get("message", "") for h in health if h.get("type") == "error"][:3]
    if isinstance(disk, list) and disk:
        result["disk_free_gb"] = round(sum(d.get("freeSpace", 0) for d in disk) / 1024**3, 1)
        result["disk_total_gb"] = round(sum(d.get("totalSpace", 0) for d in disk) / 1024**3, 1)
    return result, items


async def collect_radarr() -> dict:
    result, movies = await _arr(cfg.RADARR_URL, cfg.RADARR_KEY)
    if isinstance(movies, list):
        result["total"] = len(movies)
        result["downloaded"] = sum(1 for m in movies if m.get("hasFile"))
        result["missing"] = sum(1 for m in movies if m.get("monitored") and not m.get("hasFile"))
    return result


async def collect_sonarr() -> dict:
    base = cfg.SONARR_URL
    h = {"X-Api-Key": cfg.SONARR_KEY}
    async with httpx.AsyncClient(timeout=20) as c:
        status, series, queue, health, disk, wanted = await asyncio.gather(
            _get(c, f"{base}/api/v3/system/status", h),
            _get(c, f"{base}/api/v3/series", h, timeout=15.0),
            _get(c, f"{base}/api/v3/queue", h),
            _get(c, f"{base}/api/v3/health", h),
            _get(c, f"{base}/api/v3/diskspace", h),
            _get(c, f"{base}/api/v3/wanted/missing?pageSize=1", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"] = status.get("version", "")
    if isinstance(series, list):
        result["total"] = len(series)
        result["monitored"] = sum(1 for s in series if s.get("monitored"))
        stats_list = [s.get("statistics", {}) for s in series]
        result["episodes_total"] = sum(s.get("totalEpisodeCount", 0) for s in stats_list)
        result["episodes_downloaded"] = sum(s.get("episodeFileCount", 0) for s in stats_list)
    if isinstance(queue, dict):
        result["queue"] = queue.get("totalRecords", 0)
    if isinstance(health, list):
        result["health_errors"] = sum(1 for h in health if h.get("type") == "error")
        result["health_warnings"] = sum(1 for h in health if h.get("type") == "warning")
        result["health_messages"] = [h.get("message", "") for h in health if h.get("type") == "error"][:3]
    if isinstance(disk, list) and disk:
        result["disk_free_gb"] = round(sum(d.get("freeSpace", 0) for d in disk) / 1024**3, 1)
        result["disk_total_gb"] = round(sum(d.get("totalSpace", 0) for d in disk) / 1024**3, 1)
    if isinstance(wanted, dict):
        result["missing_episodes"] = wanted.get("totalRecords", 0)
    return result


async def collect_lidarr() -> dict:
    base = cfg.LIDARR_URL
    h = {"X-Api-Key": cfg.LIDARR_KEY}
    async with httpx.AsyncClient(timeout=20) as c:
        status, artists, queue, health, disk = await asyncio.gather(
            _get(c, f"{base}/api/v1/system/status", h),
            _get(c, f"{base}/api/v1/artist", h, timeout=15.0),
            _get(c, f"{base}/api/v1/queue", h),
            _get(c, f"{base}/api/v1/health", h),
            _get(c, f"{base}/api/v1/diskspace", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"] = status.get("version", "")
    if isinstance(artists, list):
        result["artists"] = len(artists)
        result["monitored"] = sum(1 for a in artists if a.get("monitored"))
        stats_list = [a.get("statistics", {}) for a in artists]
        result["albums_total"] = sum(s.get("albumCount", 0) for s in stats_list)
        result["track_count"] = sum(s.get("trackFileCount", 0) for s in stats_list)
    if isinstance(queue, dict):
        result["queue"] = queue.get("totalRecords", 0)
    if isinstance(health, list):
        result["health_errors"] = sum(1 for h in health if h.get("type") == "error")
        result["health_warnings"] = sum(1 for h in health if h.get("type") == "warning")
        result["health_messages"] = [h.get("message", "") for h in health if h.get("type") == "error"][:3]
    if isinstance(disk, list) and disk:
        result["disk_free_gb"] = round(sum(d.get("freeSpace", 0) for d in disk) / 1024**3, 1)
        result["disk_total_gb"] = round(sum(d.get("totalSpace", 0) for d in disk) / 1024**3, 1)
    return result


async def collect_bazarr() -> dict:
    base = cfg.BAZARR_URL
    h = {"X-Api-Key": cfg.BAZARR_KEY}
    async with httpx.AsyncClient(timeout=10) as c:
        status, movies, episodes = await asyncio.gather(
            _get(c, f"{base}/api/system/status", h),
            _get(c, f"{base}/api/movies", h),
            _get(c, f"{base}/api/episodes", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        d = status.get("data", status)
        result["version"] = d.get("bazarr_version", "")
        result["python_version"] = d.get("python_version", "")
    if isinstance(movies, dict):
        result["movies_total"] = movies.get("total", 0)
        result["movies_missing"] = movies.get("total_missing", 0)
    if isinstance(episodes, dict):
        result["episodes_total"] = episodes.get("total", 0)
        result["episodes_missing"] = episodes.get("total_missing", 0)
    return result


async def collect_jellyfin() -> dict:
    base = cfg.JELLYFIN_URL
    h = {"X-Emby-Token": cfg.JELLYFIN_KEY} if cfg.JELLYFIN_KEY else {}
    async with httpx.AsyncClient(timeout=10) as c:
        pub_info, info, sessions, counts = await asyncio.gather(
            _get(c, f"{base}/System/Info/Public"),
            _get(c, f"{base}/System/Info", h),
            _get(c, f"{base}/Sessions", h),
            _get(c, f"{base}/Items/Counts", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(pub_info, dict):
        result["version"] = pub_info.get("Version", "")
        result["server_name"] = pub_info.get("ServerName", "")
    if isinstance(info, dict):
        result["version"] = info.get("Version", result.get("version", ""))
        result["server_name"] = info.get("ServerName", result.get("server_name", ""))
    if isinstance(sessions, list):
        active = [s for s in sessions if s.get("NowPlayingItem")]
        result["sessions_total"] = len(sessions)
        result["sessions_active"] = len(active)
        result["now_playing"] = [
            f"{s['NowPlayingItem'].get('SeriesName', '') + ': ' if s['NowPlayingItem'].get('SeriesName') else ''}"
            f"{s['NowPlayingItem'].get('Name', '')}"
            for s in active[:3]
        ]
    if isinstance(counts, dict):
        result["movies"] = counts.get("MovieCount", 0)
        result["series"] = counts.get("SeriesCount", 0)
        result["episodes"] = counts.get("EpisodeCount", 0)
        result["songs"] = counts.get("SongCount", 0)
        result["albums"] = counts.get("AlbumCount", 0)
    return result


async def collect_plex() -> dict:
    base = cfg.PLEX_URL
    h: dict[str, str] = {}
    if cfg.PLEX_TOKEN:
        h["X-Plex-Token"] = cfg.PLEX_TOKEN
    result: dict = {}
    async with httpx.AsyncClient(timeout=10) as c:
        id_txt, sess_txt, sec_txt = await asyncio.gather(
            _get_raw(c, f"{base}/identity"),
            _get_raw(c, f"{base}/status/sessions", h),
            _get_raw(c, f"{base}/library/sections", h),
            return_exceptions=True,
        )
    if isinstance(id_txt, str) and (m := re.search(r'<MediaContainer[^>]+\sversion="([^"]+)"', id_txt)):
        result["version"] = m.group(1)
    if isinstance(sess_txt, str):
        result["sessions_active"] = int(m.group(1)) if (m := re.search(r'size="(\d+)"', sess_txt)) else 0
    if isinstance(sec_txt, str):
        try:
            tree = ET.fromstring(sec_txt)
            libs = [
                {"title": d.get("title", ""), "type": d.get("type", ""), "count": int(d.get("count", "0") or "0")}
                for d in tree.findall(".//Directory")
            ]
            result["libraries"] = libs
            result["movies"] = sum(lib["count"] for lib in libs if lib["type"] == "movie")
            result["series"] = sum(lib["count"] for lib in libs if lib["type"] == "show")
        except Exception:
            pass
    return result


async def collect_jellyseerr() -> dict:
    base = cfg.JELLYSEERR_URL
    h = {"X-Api-Key": cfg.JELLYSEERR_KEY} if cfg.JELLYSEERR_KEY else {}
    async with httpx.AsyncClient(timeout=10) as c:
        status, req_count = await asyncio.gather(
            _get(c, f"{base}/api/v1/status", h),
            _get(c, f"{base}/api/v1/request/count", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"] = status.get("version", "")
        result["update_available"] = status.get("updateAvailable", False)
        result["commits_behind"] = status.get("commitsBehind", 0)
    if isinstance(req_count, dict):
        result["requests_total"] = req_count.get("total", 0)
        result["requests_movie"] = req_count.get("movie", 0)
        result["requests_tv"] = req_count.get("tv", 0)
        result["requests_pending"] = req_count.get("pending", 0)
        result["requests_approved"] = req_count.get("approved", 0)
        result["requests_available"] = req_count.get("available", 0)
    return result


async def collect_dispatcharr() -> dict:
    tok = await _get_dispatcharr_token()
    h: dict[str, str] = {"Authorization": f"Bearer {tok}"} if tok else {}
    base = cfg.DISPATCHARR_API_URL
    async with httpx.AsyncClient(timeout=15) as c:
        ver, streams_pg, channels, epg_src, m3u_accs = await asyncio.gather(
            _get(c, f"{base}/api/core/version/", h),
            _get(c, f"{base}/api/channels/streams/?limit=1", h),
            _get(c, f"{base}/api/channels/channels/", h),
            _get(c, f"{base}/api/epg/sources/", h),
            _get(c, f"{base}/api/m3u/accounts/", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(ver, dict):
        result["version"] = ver.get("version", "")
    if isinstance(streams_pg, dict):
        result["total_streams"] = streams_pg.get("count", 0)
    if isinstance(channels, (list, dict)):
        result["total_channels"] = len(channels) if isinstance(channels, list) else channels.get("count", 0)
    if isinstance(epg_src, list):
        result["epg_sources"] = len(epg_src)
        result["epg_errors"] = sum(1 for s in epg_src if s.get("status") == "error")
        result["epg_ok"] = sum(1 for s in epg_src if s.get("status") == "success")
    if isinstance(m3u_accs, list):
        result["m3u_accounts"] = len(m3u_accs)
        result["m3u_accounts_active"] = sum(1 for a in m3u_accs if a.get("is_active", True))
    return result


# ── qBittorrent session cache ─────────────────────────────────────────────────
_qbt_sid: str = ""
_qbt_sid_expiry: float = 0.0


async def _get_qbt_sid() -> str:
    global _qbt_sid, _qbt_sid_expiry
    if _qbt_sid and time.monotonic() < _qbt_sid_expiry:
        return _qbt_sid
    if not cfg.QBT_PASS:
        return ""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.post(
                f"{cfg.QBITTORRENT_URL}/api/v2/auth/login",
                content=f"username={cfg.QBT_USER}&password={cfg.QBT_PASS}",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            # Response body is "Ok." on success; SID is in the cookie
            sid = r.cookies.get("SID", "")
            if not sid:
                sc = r.headers.get("set-cookie", "")
                sid = m.group(1) if (m := re.search(r"SID=([^;]+)", sc)) else ""
            if sid:
                _qbt_sid = sid
                _qbt_sid_expiry = time.monotonic() + 3600  # 1h
                return sid
    except Exception:
        pass
    return ""


async def collect_byparr() -> dict:
    async with httpx.AsyncClient(timeout=8) as c:
        health, root = await asyncio.gather(
            _get(c, f"{cfg.BYPARR_URL}/health"),
            _get(c, f"{cfg.BYPARR_URL}/"),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(health, dict):
        result["status"] = health.get("status", "")
    if isinstance(root, dict):
        ver = root.get("version", "")
        result["version"] = ver if ver and ver != "unknown" else ""
        ua = root.get("userAgent", "")
        # Extract browser name for display
        if "Firefox" in ua:
            result["browser"] = "Firefox"
        elif "Chrome" in ua:
            result["browser"] = "Chrome"
    return result


async def collect_mediaflow() -> dict:
    async with httpx.AsyncClient(timeout=8) as c:
        h = await _get(c, f"{cfg.MEDIAFLOW_URL}/health")
    return {"status": h.get("status", "")} if isinstance(h, dict) else {}


async def collect_qbittorrent() -> dict:
    base = cfg.QBITTORRENT_URL
    sid = await _get_qbt_sid()
    cookie_h = {"Cookie": f"SID={sid}"} if sid else {}
    result: dict = {}
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            ver_r = await c.get(f"{base}/api/v2/app/version", headers=cookie_h, timeout=5)
            if ver_r.status_code == 200:
                result["version"] = ver_r.text.strip()
                result["responding"] = True
            else:
                return result
        except Exception:
            return result
        # Transfer stats
        try:
            tr_r = await c.get(f"{base}/api/v2/transfer/info", headers=cookie_h, timeout=5)
            if tr_r.status_code == 200:
                td = tr_r.json()
                result["dl_speed"] = td.get("dl_info_speed", 0)  # bytes/s
                result["up_speed"] = td.get("up_info_speed", 0)
                result["dl_session"] = td.get("dl_info_data", 0)  # session total bytes
                result["up_session"] = td.get("up_info_data", 0)
        except Exception:
            pass
        # Active torrent counts
        try:
            tor_r = await c.get(f"{base}/api/v2/torrents/info?filter=active", headers=cookie_h, timeout=8)
            if tor_r.status_code == 200:
                active = tor_r.json()
                result["active_torrents"] = len(active)
                result["downloading"] = sum(
                    1 for t in active if t.get("state", "").startswith("downloading") or t.get("state") == "stalledDL"
                )
                result["seeding"] = sum(
                    1 for t in active if "upload" in t.get("state", "").lower() or t.get("state") == "stalledUP"
                )
        except Exception:
            pass
    return result
