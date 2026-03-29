"""AIOStreams log analyzer — parse journalctl output into structured analysis."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import defaultdict

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse

import core.config as cfg

logger = logging.getLogger(__name__)

# ── Regex patterns for log parsing ───────────────────────────────────────────

# Timestamp at the start of every log line (short-iso format from journalctl)
_RE_TIMESTAMP = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+\-]\d{4})\s")

# Inline timestamp inside the AIOStreams log message (UTC)
_RE_INLINE_TS = re.compile(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s*UTC")

# Stream request: CORE | Handling stream request type=series id=tt11198220:2:2
_RE_STREAM_REQ = re.compile(
    r"CORE\s*\|\s*Handling stream request\s+type=(\w+)\s+id=(tt\d+(?::\d+:\d+)?)"
)

# Addon scrape summary header (success or failure)
_RE_SCRAPE_HEADER = re.compile(
    r"SCRAPER\s*\|.*?\[(.*?)\]\s*Scrape Summary"
)

# Scrape status line
_RE_SCRAPE_STATUS = re.compile(
    r"SCRAPER\s*\|.*?Status\s*:\s*(SUCCESS|FAILED)"
)

# Scrape streams count
_RE_SCRAPE_STREAMS = re.compile(
    r"SCRAPER\s*\|.*?Streams\s*:\s*(\d+)"
)

# Scrape time (seconds or ms)
_RE_SCRAPE_TIME = re.compile(
    r"SCRAPER\s*\|.*?Time\s*:\s*([\d.]+)(ms|s)"
)

# Scrape error
_RE_SCRAPE_ERROR = re.compile(
    r"SCRAPER\s*\|.*?Error\s*:\s*(.+)"
)

# Wrapper errors: WRAPPERS | Failed to fetch stream resource for X: reason
_RE_WRAPPER_ERROR = re.compile(
    r"WRAPPERS\s*\|\s*Failed to fetch stream resource for\s+(.*?):\s*(.*)"
)

# Final result: CORE | Returning X streams and Y errors
_RE_RETURNING = re.compile(
    r"CORE\s*\|\s*Returning\s+(\d+)\s+streams?\s+and\s+(\d+)\s+errors?"
)

# HTTP request line with response code and latency
_RE_HTTP = re.compile(
    r"HTTP\s*\|.*?(GET|POST|PUT|DELETE|PATCH)\s+(/\S+).*?Response:\s*(\d+)\s*-\s*([\d.]+)ms"
)

# Content ID from stremio stream path
_RE_CONTENT_PATH = re.compile(
    r"/stream/(\w+)/(tt\d+(?::\d+:\d+)?)(?:\.json)?"
)

# Pipeline lines: FILTERER, DEDUPLICATOR, SORTER with timing/counts
_RE_PIPELINE = re.compile(
    r"(FILTERER|DEDUPLICATOR|SORTER)\s*\|.*?(\d+).*?([\d.]+)(ms|s)"
)


def _parse_journalctl_ts(ts_str: str) -> str | None:
    """Normalize a journalctl short-iso timestamp to ISO format."""
    if not ts_str:
        return None
    # journalctl short-iso: 2026-03-28T22:47:08+0000
    return ts_str.replace("+0000", "+00:00").replace("-0000", "+00:00")


def _parse_inline_ts(ts_str: str) -> str | None:
    """Normalize an inline UTC timestamp to ISO format."""
    if not ts_str:
        return None
    # "2026-03-28 22:47:08.943" -> "2026-03-28T22:47:08Z"
    parts = ts_str.strip().split(".")
    return f"{parts[0].replace(' ', 'T')}Z"


def _time_to_seconds(value: str, unit: str) -> float:
    """Convert a time value+unit to seconds."""
    v = float(value)
    return v / 1000.0 if unit == "ms" else v


def _parse_logs(lines: list[str]) -> dict:
    """Parse AIOStreams log lines into structured analysis data."""
    # Tracking state
    requests: list[dict] = []
    current_request: dict | None = None
    current_addon: dict | None = None
    addon_stats: dict[str, dict] = defaultdict(
        lambda: {
            "calls": 0,
            "successes": 0,
            "failures": 0,
            "times": [],
            "streams": [],
        }
    )
    error_counts: dict[str, int] = defaultdict(int)
    http_requests: list[dict] = []
    pipeline_steps: list[dict] = []
    all_timestamps: list[str] = []

    for line in lines:
        # Extract timestamp
        ts_match = _RE_INLINE_TS.search(line)
        ts = _parse_inline_ts(ts_match.group(1)) if ts_match else None
        if not ts:
            jctl_ts = _RE_TIMESTAMP.match(line)
            ts = _parse_journalctl_ts(jctl_ts.group(1)) if jctl_ts else None
        if ts:
            all_timestamps.append(ts)

        # Stream request start
        m = _RE_STREAM_REQ.search(line)
        if m:
            # Save previous request if it exists
            if current_request is not None:
                requests.append(current_request)
            current_request = {
                "timestamp": ts,
                "type": m.group(1),
                "content_id": m.group(2),
                "addons": [],
                "total_streams": 0,
                "total_errors": 0,
                "duration_s": None,
            }
            current_addon = None
            continue

        # Addon scrape header
        m = _RE_SCRAPE_HEADER.search(line)
        if m:
            addon_name = m.group(1).strip()
            current_addon = {
                "name": addon_name,
                "status": None,
                "streams": 0,
                "time_s": None,
                "error": None,
            }
            addon_stats[addon_name]["calls"] += 1
            continue

        # Scrape status
        m = _RE_SCRAPE_STATUS.search(line)
        if m and current_addon:
            status = m.group(1)
            current_addon["status"] = status.lower()
            addon_name = current_addon["name"]
            if status == "SUCCESS":
                addon_stats[addon_name]["successes"] += 1
            else:
                addon_stats[addon_name]["failures"] += 1
            continue

        # Scrape streams count
        m = _RE_SCRAPE_STREAMS.search(line)
        if m and current_addon:
            count = int(m.group(1))
            current_addon["streams"] = count
            addon_stats[current_addon["name"]]["streams"].append(count)
            continue

        # Scrape time
        m = _RE_SCRAPE_TIME.search(line)
        if m and current_addon:
            time_s = _time_to_seconds(m.group(1), m.group(2))
            current_addon["time_s"] = round(time_s, 3)
            addon_stats[current_addon["name"]]["times"].append(time_s)
            # When we have time, the addon block is complete — attach to request
            if current_request is not None:
                current_request["addons"].append(current_addon)
            current_addon = None
            continue

        # Scrape error
        m = _RE_SCRAPE_ERROR.search(line)
        if m and current_addon:
            error_msg = m.group(1).strip()
            current_addon["error"] = error_msg
            error_counts[error_msg] += 1
            continue

        # Wrapper errors
        m = _RE_WRAPPER_ERROR.search(line)
        if m:
            addon_name = m.group(1).strip()
            error_msg = m.group(2).strip()
            error_counts[error_msg] += 1
            continue

        # Final returning line
        m = _RE_RETURNING.search(line)
        if m and current_request is not None:
            current_request["total_streams"] = int(m.group(1))
            current_request["total_errors"] = int(m.group(2))
            continue

        # HTTP request/response
        m = _RE_HTTP.search(line)
        if m:
            path = m.group(2)
            content_match = _RE_CONTENT_PATH.search(path)
            latency_ms = float(m.group(4))
            http_entry = {
                "timestamp": ts,
                "method": m.group(1),
                "path": path,
                "status_code": int(m.group(3)),
                "latency_ms": round(latency_ms, 1),
                "content_id": content_match.group(2) if content_match else None,
            }
            http_requests.append(http_entry)
            # Use HTTP latency as request duration if we have a matching request
            if current_request is not None and content_match:
                current_request["duration_s"] = round(latency_ms / 1000.0, 3)
            continue

        # Pipeline steps
        m = _RE_PIPELINE.search(line)
        if m:
            pipeline_steps.append({
                "stage": m.group(1),
                "count": int(m.group(2)),
                "time_s": round(_time_to_seconds(m.group(3), m.group(4)), 4),
            })
            continue

    # Finalize last request
    if current_request is not None:
        requests.append(current_request)

    # Build time range
    time_range = {
        "start": all_timestamps[0] if all_timestamps else None,
        "end": all_timestamps[-1] if all_timestamps else None,
    }

    # Build addon summary
    addons_summary: dict[str, dict] = {}
    for name, stats in addon_stats.items():
        calls = stats["calls"]
        times = stats["times"]
        streams = stats["streams"]
        addons_summary[name] = {
            "calls": calls,
            "successes": stats["successes"],
            "failures": stats["failures"],
            "success_rate": round(stats["successes"] / calls, 3) if calls else 0.0,
            "avg_time_s": round(sum(times) / len(times), 3) if times else None,
            "min_time_s": round(min(times), 3) if times else None,
            "max_time_s": round(max(times), 3) if times else None,
            "avg_streams": round(sum(streams) / len(streams), 1) if streams else 0,
            "total_streams": sum(streams),
        }

    # Build overall summary
    total_requests = len(requests)
    all_durations = [
        r["duration_s"] for r in requests if r["duration_s"] is not None
    ]
    all_stream_counts = [r["total_streams"] for r in requests]
    total_addon_errors = sum(error_counts.values())

    summary = {
        "total_requests": total_requests,
        "avg_response_time_s": (
            round(sum(all_durations) / len(all_durations), 2)
            if all_durations
            else None
        ),
        "avg_streams": (
            round(sum(all_stream_counts) / len(all_stream_counts), 1)
            if all_stream_counts
            else 0,
        ),
        "fastest_s": round(min(all_durations), 2) if all_durations else None,
        "slowest_s": round(max(all_durations), 2) if all_durations else None,
        "total_addon_errors": total_addon_errors,
    }

    return {
        "log_lines": len(lines),
        "time_range": time_range,
        "summary": summary,
        "addons": addons_summary,
        "errors": dict(error_counts),
        "recent_requests": requests[-50:],  # last 50 requests
        "pipeline": pipeline_steps[-100:],  # last 100 pipeline entries
        "http_requests": http_requests[-100:],  # last 100 HTTP entries
    }


# ── API: Analyze logs ────────────────────────────────────────────────────────


async def api_aiostreams_analyze(request: Request) -> JSONResponse:
    """Fetch and parse AIOStreams journalctl logs into structured analysis."""
    try:
        n = str(min(int(request.query_params.get("n", "5000")), 50000))
    except (ValueError, TypeError):
        n = "5000"

    try:
        p = await asyncio.create_subprocess_exec(
            "sudo",
            "journalctl",
            "-u",
            "aiostreams",
            "-n",
            n,
            "--no-pager",
            "--output=short-iso",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(p.communicate(), timeout=30)
        raw = out.decode(errors="replace")
        lines = raw.splitlines()

        if not lines and err:
            return JSONResponse(
                {"error": f"journalctl: {err.decode(errors='replace').strip()[:300]}"},
                status_code=500,
            )

        result = _parse_logs(lines)
        return JSONResponse(result)

    except TimeoutError:
        return JSONResponse({"error": "timeout reading logs"}, status_code=504)
    except Exception as e:
        logger.exception("AIOStreams analyze failed")
        return JSONResponse({"error": str(e)}, status_code=500)


# ── API: Test stream lookup ──────────────────────────────────────────────────

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


async def api_aiostreams_test(request: Request) -> JSONResponse:
    """Trigger a stream lookup on AIOStreams and return results."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON body"}, status_code=400)

    imdb = body.get("imdb", "").strip()
    media_type = body.get("type", "movie").strip()

    if not imdb or not imdb.startswith("tt"):
        return JSONResponse(
            {"error": "imdb parameter required (e.g. tt0468569)"}, status_code=400,
        )
    if media_type not in ("movie", "series"):
        return JSONResponse(
            {"error": "type must be 'movie' or 'series'"}, status_code=400,
        )

    config = cfg.BENCH_AIOSTREAMS_CONFIG or cfg.AIOSTREAMS_SECRET
    if not config:
        return JSONResponse(
            {"error": "No AIOStreams config token set (BENCH_AIOSTREAMS_CONFIG or AIOSTREAMS_SECRET)"},
            status_code=500,
        )

    url = f"{cfg.AIOSTREAMS_URL}/stremio/{config}/stream/{media_type}/{imdb}.json"

    try:
        t0 = time.monotonic()
        async with httpx.AsyncClient(
            verify=False,
            follow_redirects=True,
            timeout=45,
            http2=True,
        ) as client:
            resp = await client.get(url, headers={"User-Agent": _UA})
        latency_ms = int((time.monotonic() - t0) * 1000)

        if resp.status_code != 200:
            return JSONResponse(
                {
                    "error": f"AIOStreams returned HTTP {resp.status_code}",
                    "body": resp.text[:500],
                    "latency_ms": latency_ms,
                },
                status_code=502,
            )

        data = resp.json()
        streams = data.get("streams", []) if isinstance(data, dict) else []
        return JSONResponse({
            "ok": True,
            "imdb": imdb,
            "type": media_type,
            "stream_count": len(streams),
            "streams": streams,
            "latency_ms": latency_ms,
        })

    except httpx.TimeoutException:
        return JSONResponse({"error": "AIOStreams request timed out (45s)"}, status_code=504)
    except Exception as e:
        logger.exception("AIOStreams test request failed")
        return JSONResponse({"error": str(e)}, status_code=500)
