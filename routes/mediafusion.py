"""MediaFusion analyzer — API metrics + taskiq-scrapy log parsing."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import defaultdict
from datetime import UTC, datetime

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse

import core.config as cfg

logger = logging.getLogger(__name__)

# ── JWT auth (reuse collector's pattern) ───────────────────────────────────────
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
                json={
                    "email": cfg.MEDIAFUSION_EMAIL,
                    "password": cfg.MEDIAFUSION_USER_PASS,
                },
                headers={"X-API-Key": cfg.MEDIAFUSION_PASS},
            )
            tok = r.json().get("access_token", "") if r.status_code == 200 else ""
            if tok:
                _mf_token = tok
                _mf_token_expiry = time.monotonic() + 25 * 60
    except Exception:
        pass
    return _mf_token


async def _admin_get(
    client: httpx.AsyncClient, path: str, token: str,
) -> dict | list | None:
    """GET an admin endpoint, return parsed JSON or None."""
    try:
        r = await client.get(
            f"{cfg.MEDIAFUSION_URL}{path}",
            headers={
                "X-API-Key": cfg.MEDIAFUSION_PASS,
                "Authorization": f"Bearer {token}",
            },
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


# ── API: Comprehensive metrics ─────────────────────────────────────────────────


async def api_mediafusion_metrics(request: Request) -> JSONResponse:
    """Fetch comprehensive metrics from MediaFusion admin API."""
    token = await _get_mf_token()
    if not token:
        return JSONResponse(
            {"error": "Could not authenticate with MediaFusion admin API"},
            status_code=502,
        )

    async with httpx.AsyncClient(verify=False, timeout=15) as c:
        results = await asyncio.gather(
            _admin_get(c, "/api/v1/admin/metrics/system/overview", token),
            _admin_get(c, "/api/v1/admin/metrics/users/stats", token),
            _admin_get(c, "/api/v1/admin/metrics/contributions/stats", token),
            _admin_get(c, "/api/v1/admin/metrics/activity/stats", token),
            _admin_get(c, "/api/v1/admin/metrics/scrapers", token),
            _admin_get(c, "/api/v1/admin/schedulers/stats", token),
            _admin_get(c, "/api/v1/admin/metrics/torrents/sources", token),
            _admin_get(c, "/api/v1/admin/metrics/debrid-cache", token),
            _admin_get(c, "/api/v1/admin/metrics/redis", token),
            _admin_get(c, "/api/v1/admin/metrics/metadata", token),
            _admin_get(c, "/api/v1/admin/public-indexers/source-health", token),
            _admin_get(c, "/api/v1/admin/request-metrics/status", token),
            _admin_get(c, "/api/v1/admin/request-metrics/endpoints", token),
            _admin_get(c, "/api/v1/admin/metrics/workers/memory", token),
            _admin_get(c, "/api/v1/admin/schedulers", token),
            return_exceptions=True,
        )

    (
        overview, users, contributions, activity, scrapers,
        sched_stats, sources, debrid, redis_m, metadata,
        source_health, req_status, req_endpoints, workers, schedulers,
    ) = results

    data: dict = {"ok": True}

    # System overview
    if isinstance(overview, dict):
        data["overview"] = overview

    # Users
    if isinstance(users, dict):
        data["users"] = users

    # Contributions
    if isinstance(contributions, dict):
        data["contributions"] = contributions

    # Activity
    if isinstance(activity, dict):
        data["activity"] = activity

    # Scrapers
    if isinstance(scrapers, (dict, list)):
        data["scrapers"] = scrapers

    # Scheduler stats
    if isinstance(sched_stats, dict):
        data["scheduler_stats"] = sched_stats

    # Torrent sources
    if isinstance(sources, list):
        data["torrent_sources"] = sources[:20]

    # Debrid cache
    if isinstance(debrid, dict):
        data["debrid_cache"] = debrid

    # Redis
    if isinstance(redis_m, dict):
        data["redis"] = redis_m

    # Metadata
    if isinstance(metadata, dict):
        data["metadata"] = metadata

    # Source health
    if isinstance(source_health, list):
        data["source_health"] = source_health

    # Request metrics
    if isinstance(req_status, dict):
        data["request_metrics"] = req_status
    if isinstance(req_endpoints, (dict, list)):
        data["request_endpoints"] = (
            req_endpoints.get("endpoints", [])[:30]
            if isinstance(req_endpoints, dict)
            else req_endpoints[:30]
        )

    # Workers
    if isinstance(workers, dict):
        data["workers"] = workers

    # Schedulers (full job list)
    if isinstance(schedulers, (dict, list)):
        jobs = schedulers if isinstance(schedulers, list) else schedulers.get("jobs", schedulers.get("data", []))
        if isinstance(jobs, list):
            data["scheduler_jobs"] = jobs[:50]

    return JSONResponse(data)


# ── Regex patterns for taskiq-scrapy log parsing ───────────────────────────────

_RE_JCTL_TS = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})[+-]\d{2}:\d{2}")
_RE_INLINE_TS = re.compile(r"\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})")

# Added torrent stream ... for (movie|series) Title
_RE_ADDED_STREAM = re.compile(
    r"Added torrent stream\s+(.*?)\s+for\s+(movie|series)\s+(.*)"
)

# store_new_torrent_streams: input=N valid=N existing=N media_resolved=N/N
_RE_STORE_STREAMS = re.compile(
    r"store_new_torrent_streams:\s*input=(\d+)\s+valid=(\d+)\s+existing=(\d+)\s+media_resolved=(\d+)/(\d+)"
)

# Crawled N pages (at N pages/min), scraped N items (at N items/min)
_RE_CRAWL_STATS = re.compile(
    r"Crawled\s+(\d+)\s+pages\s+\(at\s+(\d+)\s+pages/min\),\s+scraped\s+(\d+)\s+items\s+\(at\s+(\d+)\s+items/min\)"
)

# DMM entry NO MATCH
_RE_DMM_NO_MATCH = re.compile(
    r"DMM entry NO MATCH:\s+title='(.*?)'\s+year=(\S+)\s+type=(\w+)\s+api_candidates=(\d+)"
)

# Executing task X with ID: Y
_RE_TASK_EXEC = re.compile(
    r"Executing task\s+(\S+)\s+with ID:\s+(\S+)"
)

# Using (movie|series) X with id Y
_RE_USING_MEDIA = re.compile(
    r"Using\s+(movie|series)\s+(.*?)\s+with id\s+(\S+)"
)

# No metadata found for 'X' (Y), will use synthetic ID
_RE_NO_METADATA = re.compile(
    r"No metadata found for '(.*?)'\s+\((\d+)\)"
)

# TMDB ID N not found
_RE_TMDB_NOT_FOUND = re.compile(r"TMDB ID\s+(\d+)\s+not found")

# Error fetching TMDB
_RE_TMDB_ERROR = re.compile(r"Error fetching TMDB.*?:\s*(.*)")

# DMM hashlist scraper info
_RE_DMM_SCRAPER = re.compile(r"DMM hashlist scraper\s+(.*)")

# Log level detection
_RE_LOG_LEVEL = re.compile(r"\b(ERROR|WARNING|INFO|DEBUG)\b")

# Crawled (status_code) <METHOD url>
_RE_CRAWLED_URL = re.compile(r"Crawled\s+\((\d+)\)\s+<(\w+)\s+(https?://[^>]+)>")

# Resolution/quality extraction from stream names
_RE_RESOLUTION = re.compile(
    r"\b(4[Kk]|2160p|1080p|720p|480p|360p)\b"
)
_RE_QUALITY = re.compile(
    r"\b(WEB-DL|WEBRip|BluRay|BDRip|HDRip|DVDRip|HDTV|CAM|TS|TRUE WEB-DL|HQ HDRip)\b",
    re.IGNORECASE,
)
_RE_CODEC = re.compile(
    r"\b(x264|x265|HEVC|AVC|H\.?264|H\.?265|VP9|AV1|XviD)\b", re.IGNORECASE,
)

# Year extraction from title/stream
_RE_YEAR = re.compile(r"\((\d{4})\)")

# File size from stream names
_RE_SIZE = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(GB|MB|TB)\b", re.IGNORECASE,
)

# Using media with ID (tracks IMDb vs synthetic)
_RE_MEDIA_ID = re.compile(r"with id\s+(tt\d+|mf:\d+)")

# DMM hashlist authenticated
_RE_DMM_AUTH = re.compile(r"DMM hashlist scraper using (.*)")


def _parse_ts(line: str) -> str | None:
    """Extract a timestamp from a log line."""
    m = _RE_JCTL_TS.match(line)
    if m:
        return m.group(1)
    m2 = _RE_INLINE_TS.search(line)
    return m2.group(1).replace(" ", "T") if m2 else None


def _ts_to_epoch(ts_str: str) -> float | None:
    """Convert timestamp string to epoch seconds."""
    if not ts_str:
        return None
    try:
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(ts_str, fmt).replace(
                    tzinfo=UTC,
                ).timestamp()
            except ValueError:
                continue
    except Exception:
        pass
    return None


def _extract_domain(url: str) -> str:
    """Extract domain from a URL."""
    try:
        from urllib.parse import urlparse as _urlparse
        return _urlparse(url).netloc or url[:50]
    except Exception:
        return url[:50]


def _parse_scrapy_logs(lines: list[str]) -> dict:
    """Parse mediafusion-taskiq-scrapy log lines into structured analysis."""
    # Counters
    streams_added: list[dict] = []
    store_stats: list[dict] = []
    crawl_snapshots: list[dict] = []
    dmm_no_matches = 0
    dmm_no_match_types: dict[str, int] = defaultdict(int)
    dmm_no_match_titles: list[dict] = []
    tasks_executed: list[dict] = []
    synthetic_ids: list[dict] = []
    tmdb_not_found = 0
    tmdb_errors: dict[str, int] = defaultdict(int)
    errors: list[dict] = []
    error_categories: dict[str, int] = defaultdict(int)
    warnings = 0
    media_types_added: dict[str, int] = defaultdict(int)
    sources_added: dict[str, int] = defaultdict(int)
    all_timestamps: list[str] = []
    log_level_counts: dict[str, int] = defaultdict(int)
    streams_by_hour: dict[str, int] = defaultdict(int)
    resolutions: dict[str, int] = defaultdict(int)
    qualities: dict[str, int] = defaultdict(int)
    codecs: dict[str, int] = defaultdict(int)
    years_added: dict[str, int] = defaultdict(int)
    titles_added: dict[str, int] = defaultdict(int)
    crawled_domains: dict[str, int] = defaultdict(int)
    crawled_statuses: dict[int, int] = defaultdict(int)
    media_ids_imdb = 0
    media_ids_synthetic = 0
    dmm_auth_info: str | None = None
    total_size_mb: float = 0.0
    size_count = 0
    lines_parsed = 0

    # De-duplicate: the structured logger + root logger produce identical lines
    seen_messages: set[str] = set()

    for line in lines:
        # De-dup: extract the actual message after the logger prefix
        # Structured: "INFO::date::path::lineno - message"
        # Root:       "date [logger] LEVEL: message"
        # We key on everything after the last known prefix marker
        dedup_key = None
        if "- Added torrent" in line or "- store_new_torrent" in line:
            idx = line.find("- Added torrent") if "- Added torrent" in line else line.find("- store_new_torrent")
            dedup_key = line[idx:]
        elif "INFO: Added torrent" in line or "INFO: store_new_torrent" in line:
            idx = (
                line.find("INFO: Added torrent")
                if "INFO: Added torrent" in line
                else line.find("INFO: store_new_torrent")
            )
            dedup_key = line[idx:].replace("INFO: ", "- ", 1)
        elif "] INFO: " in line:
            dedup_key = line[line.find("] INFO: "):]
        elif "] WARNING: " in line:
            dedup_key = line[line.find("] WARNING: "):]
        elif "] ERROR: " in line:
            dedup_key = line[line.find("] ERROR: "):]

        if dedup_key and dedup_key in seen_messages:
            continue
        if dedup_key:
            seen_messages.add(dedup_key)

        lines_parsed += 1
        ts = _parse_ts(line)
        if ts:
            all_timestamps.append(ts)

        # Log level counting
        lm = _RE_LOG_LEVEL.search(line)
        if lm:
            log_level_counts[lm.group(1)] += 1

        # Added torrent stream
        m = _RE_ADDED_STREAM.search(line)
        if m:
            stream_name = m.group(1).strip()
            media_type = m.group(2)
            title = m.group(3).strip()
            media_types_added[media_type] += 1
            titles_added[title[:60]] = titles_added.get(title[:60], 0) + 1

            # Extract source
            parts = stream_name.split(" - ", 1)
            source = parts[0].strip() if parts else "unknown"
            sources_added[source] += 1

            # Resolution/quality/codec
            full_text = stream_name
            rm = _RE_RESOLUTION.search(full_text)
            if rm:
                res = rm.group(1).upper().replace("4K", "2160p")
                resolutions[res] += 1
            qm = _RE_QUALITY.search(full_text)
            if qm:
                qualities[qm.group(1).upper()] += 1
            cm = _RE_CODEC.search(full_text)
            if cm:
                codecs[cm.group(1).upper().replace(".", "")] += 1

            # Year from stream name
            ym = _RE_YEAR.search(full_text)
            if ym:
                years_added[ym.group(1)] += 1

            # File size
            sm = _RE_SIZE.search(full_text)
            if sm:
                size_val = float(sm.group(1))
                unit = sm.group(2).upper()
                if unit == "GB":
                    total_size_mb += size_val * 1024
                elif unit == "TB":
                    total_size_mb += size_val * 1024 * 1024
                else:
                    total_size_mb += size_val
                size_count += 1

            entry = {
                "timestamp": ts,
                "stream": stream_name[:150],
                "type": media_type,
                "title": title[:80],
                "source": source,
                "resolution": rm.group(1) if rm else None,
            }
            streams_added.append(entry)

            if ts:
                hour_key = ts[:13]
                streams_by_hour[hour_key] += 1
            continue

        # store_new_torrent_streams
        m = _RE_STORE_STREAMS.search(line)
        if m:
            store_stats.append({
                "timestamp": ts,
                "input": int(m.group(1)),
                "valid": int(m.group(2)),
                "existing": int(m.group(3)),
                "resolved": int(m.group(4)),
                "total_media": int(m.group(5)),
            })
            continue

        # Crawl stats (scrapy logstats)
        m = _RE_CRAWL_STATS.search(line)
        if m:
            crawl_snapshots.append({
                "timestamp": ts,
                "pages": int(m.group(1)),
                "pages_per_min": int(m.group(2)),
                "items": int(m.group(3)),
                "items_per_min": int(m.group(4)),
            })
            continue

        # Crawled URL (track domains and HTTP statuses)
        m = _RE_CRAWLED_URL.search(line)
        if m:
            status_code = int(m.group(1))
            url = m.group(3)
            crawled_statuses[status_code] += 1
            crawled_domains[_extract_domain(url)] += 1
            continue

        # DMM no match
        m = _RE_DMM_NO_MATCH.search(line)
        if m:
            dmm_no_matches += 1
            dmm_no_match_types[m.group(3)] += 1
            if len(dmm_no_match_titles) < 50:
                dmm_no_match_titles.append({
                    "title": m.group(1)[:60],
                    "year": m.group(2),
                    "type": m.group(3),
                    "candidates": int(m.group(4)),
                })
            continue

        # Task execution
        m = _RE_TASK_EXEC.search(line)
        if m:
            tasks_executed.append({
                "timestamp": ts,
                "task": m.group(1),
                "id": m.group(2)[:16],
            })
            continue

        # Media ID tracking (IMDb vs synthetic)
        m = _RE_MEDIA_ID.search(line)
        if m:
            mid = m.group(1)
            if mid.startswith("tt"):
                media_ids_imdb += 1
            elif mid.startswith("mf:"):
                media_ids_synthetic += 1
            continue

        # DMM auth info
        m = _RE_DMM_AUTH.search(line)
        if m:
            dmm_auth_info = m.group(1).strip()
            continue

        # Synthetic ID (no metadata found)
        m = _RE_NO_METADATA.search(line)
        if m:
            synthetic_ids.append({
                "title": m.group(1)[:60],
                "year": m.group(2),
            })
            continue

        # TMDB not found
        if _RE_TMDB_NOT_FOUND.search(line):
            tmdb_not_found += 1
            continue

        # TMDB errors
        m = _RE_TMDB_ERROR.search(line)
        if m:
            err_msg = m.group(1).strip()[:120]
            tmdb_errors[err_msg] += 1
            continue

        # General errors with categorization
        if "ERROR" in line:
            msg = line.split("ERROR", 1)[-1].strip()[:200]
            errors.append({"timestamp": ts, "message": msg})
            # Categorize
            if "TMDB" in line:
                error_categories["TMDB API"] += 1
            elif "timeout" in line.lower() or "timed out" in line.lower():
                error_categories["Timeout"] += 1
            elif "connection" in line.lower():
                error_categories["Connection"] += 1
            elif "404" in line or "Not Found" in line:
                error_categories["Not Found (404)"] += 1
            elif "403" in line or "Forbidden" in line:
                error_categories["Forbidden (403)"] += 1
            else:
                error_categories["Other"] += 1
            continue

        if "WARNING" in line:
            warnings += 1

    # ── Computed analytics ──
    now_epoch = time.time()
    streams_1h = streams_6h = streams_24h = 0
    for s in streams_added:
        ep = _ts_to_epoch(s["timestamp"]) if s.get("timestamp") else None
        if ep:
            age = now_epoch - ep
            if age <= 3600:
                streams_1h += 1
            if age <= 21600:
                streams_6h += 1
            if age <= 86400:
                streams_24h += 1

    # Store aggregates
    total_input = sum(s["input"] for s in store_stats)
    total_valid = sum(s["valid"] for s in store_stats)
    total_existing = sum(s["existing"] for s in store_stats)

    # Time range and duration
    time_range = {
        "start": all_timestamps[0] if all_timestamps else None,
        "end": all_timestamps[-1] if all_timestamps else None,
    }
    log_duration_hours: float | None = None
    if len(all_timestamps) >= 2:
        start_ep = _ts_to_epoch(all_timestamps[0])
        end_ep = _ts_to_epoch(all_timestamps[-1])
        if start_ep and end_ep:
            log_duration_hours = round((end_ep - start_ep) / 3600, 2)

    # Rates
    streams_per_hour: float | None = None
    if log_duration_hours and log_duration_hours > 0:
        streams_per_hour = round(len(streams_added) / log_duration_hours, 1)

    # Latest crawl snapshot
    latest_crawl = crawl_snapshots[-1] if crawl_snapshots else None

    # Unique titles and synthetic
    unique_synthetic = {s["title"] for s in synthetic_ids}
    unique_titles = len(titles_added)

    # Top titles
    top_titles = sorted(titles_added.items(), key=lambda x: -x[1])[:20]

    # Avg file size
    avg_size_mb = round(total_size_mb / size_count, 1) if size_count else None

    return {
        "log_lines": len(lines),
        "lines_parsed": lines_parsed,
        "time_range": time_range,
        "log_duration_hours": log_duration_hours,
        "summary": {
            "streams_added": len(streams_added),
            "streams_1h": streams_1h,
            "streams_6h": streams_6h,
            "streams_24h": streams_24h,
            "streams_per_hour": streams_per_hour,
            "store_operations": len(store_stats),
            "total_input": total_input,
            "total_valid": total_valid,
            "total_existing": total_existing,
            "unique_titles": unique_titles,
            "dmm_no_matches": dmm_no_matches,
            "tmdb_not_found": tmdb_not_found,
            "errors": len(errors),
            "warnings": warnings,
            "tasks_executed": len(tasks_executed),
            "synthetic_ids": len(unique_synthetic),
            "imdb_resolved": media_ids_imdb,
            "synthetic_resolved": media_ids_synthetic,
            "avg_size_mb": avg_size_mb,
            "total_size_gb": round(total_size_mb / 1024, 2) if total_size_mb else None,
        },
        "log_levels": dict(log_level_counts),
        "streams_by_hour": dict(sorted(streams_by_hour.items())),
        "media_types_added": dict(media_types_added),
        "sources_added": dict(
            sorted(sources_added.items(), key=lambda x: -x[1])
        ),
        "resolutions": dict(
            sorted(resolutions.items(), key=lambda x: -x[1])
        ),
        "qualities": dict(
            sorted(qualities.items(), key=lambda x: -x[1])
        ),
        "codecs": dict(sorted(codecs.items(), key=lambda x: -x[1])),
        "years_added": dict(sorted(years_added.items(), reverse=True)),
        "top_titles": top_titles,
        "dmm_no_match_types": dict(dmm_no_match_types),
        "dmm_no_match_samples": dmm_no_match_titles[-20:],
        "dmm_auth": dmm_auth_info,
        "tmdb_errors": dict(
            sorted(tmdb_errors.items(), key=lambda x: -x[1])
        ),
        "error_categories": dict(
            sorted(error_categories.items(), key=lambda x: -x[1])
        ),
        "crawl_snapshots": crawl_snapshots[-30:],
        "latest_crawl": latest_crawl,
        "crawled_domains": dict(
            sorted(crawled_domains.items(), key=lambda x: -x[1])[:15]
        ),
        "crawled_statuses": dict(crawled_statuses),
        "recent_streams": streams_added[-60:],
        "recent_errors": errors[-30:],
        "tasks": tasks_executed[-20:],
        "synthetic_titles": sorted(unique_synthetic)[:30],
    }


# ── API: Analyze taskiq-scrapy logs ────────────────────────────────────────────


async def api_mediafusion_analyze(request: Request) -> JSONResponse:
    """Fetch and parse mediafusion-taskiq-scrapy journalctl logs."""
    raw_n = request.query_params.get("n", "10000")
    use_all = raw_n == "all"
    if not use_all:
        try:
            n = str(min(int(raw_n), 500000))
        except (ValueError, TypeError):
            n = "10000"

    cmd = [
        "sudo", "journalctl", "-u", "mediafusion-taskiq-scrapy",
        "--no-pager", "--output=short-iso",
    ]
    if not use_all:
        cmd += ["-n", n]

    try:
        p = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(p.communicate(), timeout=120 if use_all else 45)
        raw = out.decode(errors="replace")
        lines = raw.splitlines()

        if not lines and err:
            return JSONResponse(
                {"error": f"journalctl: {err.decode(errors='replace').strip()[:300]}"},
                status_code=500,
            )

        result = _parse_scrapy_logs(lines)
        return JSONResponse(result)

    except TimeoutError:
        return JSONResponse({"error": "timeout reading logs"}, status_code=504)
    except Exception as e:
        logger.exception("MediaFusion analyze failed")
        return JSONResponse({"error": str(e)}, status_code=500)
