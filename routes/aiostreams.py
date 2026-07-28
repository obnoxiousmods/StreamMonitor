"""AIOStreams log analyzer — parse journalctl output into structured analysis.

AIOStreams switched its logging to pino's pretty-printed format:

    [HH:MM:SS.mmm] LEVEL: message
        key: value
        key2: value2

Under `journalctl --output=short-iso` every physical line is additionally
prefixed with `2026-07-18T11:24:43-07:00 lucy corepack[1712]: `, so the parser
strips that prefix first, then reads pino header lines and their indented
continuation fields. The full date comes from the journalctl prefix; the
millisecond time comes from the pino header.
"""

from __future__ import annotations

import logging
import re
import time
from collections import defaultdict

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse

import core.config as cfg
from core.process import CommandTimeoutError, run_command

logger = logging.getLogger(__name__)

# ── Regex patterns for log parsing ───────────────────────────────────────────

# journalctl short-iso prefix: "<iso-ts> <host> <ident[pid]>: <rest>".
# Captures the full-date timestamp and the remaining payload (pino line or
# indented continuation field). The identifier segment has no colon, so
# "[^:]*:" reliably consumes up to the single colon after "corepack[1712]".
_RE_PREFIX = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}"
    r"(?P<off>[+\-]\d{2}:?\d{2})\s+\S+\s+[^:]*:\s?(?P<rest>.*)$"
)

# pino header line: "[HH:MM:SS.mmm] LEVEL: message"
_RE_PINO = re.compile(
    r"^\[(?P<t>\d{2}:\d{2}:\d{2}\.\d+)\]\s+(?P<level>[A-Z]+):\s?(?P<msg>.*)$"
)

# Indented pino continuation field: "    key: value"
_RE_CONT = re.compile(r"^\s+(?P<key>[A-Za-z_][\w]*):\s?(?P<val>.*)$")

# "Handling stream request for <Source>"
_HANDLING_PREFIX = "Handling stream request for "

# "Completed search for <Name> in <n>ms"
_RE_COMPLETED = re.compile(
    r"^Completed search for\s+(?P<name>.+?)\s+in\s+(?P<v>[\d.]+)(?P<u>ms|s)\b"
)

# "Applied basic filters in <n>ms, removed <k> streams"
_RE_FILTER = re.compile(
    r"^Applied basic filters in\s+(?P<v>[\d.]+)(?P<u>ms|s)"
    r"(?:,\s*removed\s+(?P<removed>\d+)\s+streams)?"
)

# "<Something> search for <query> took <n>ms" (e.g. Knaben)
_RE_SEARCH_TOOK = re.compile(
    r"search for\s+.+\s+took\s+(?P<v>[\d.]+)(?P<u>ms|s)\b"
)


def _time_to_seconds(value: str, unit: str) -> float:
    """Convert a time value+unit to seconds."""
    v = float(value)
    return v / 1000.0 if unit == "ms" else v


def _unquote(val: str | None) -> str | None:
    """Strip surrounding double-quotes from a pino field value."""
    if val is None:
        return None
    val = val.strip()
    if len(val) >= 2 and val[0] == '"' and val[-1] == '"':
        return val[1:-1]
    return val


def _to_int(val: str | None) -> int:
    try:
        return int(str(val).strip())
    except (ValueError, TypeError):
        return 0


def _norm_error(msg: str) -> str:
    """Normalize an error message into a stable-ish aggregation key."""
    key = msg.split("\n", 1)[0].strip().rstrip(":")
    return key[:160]


class _Record:
    """A single pino log event: header + its continuation fields."""

    __slots__ = ("level", "msg", "ts", "fields")

    def __init__(self, level: str, msg: str, ts: str | None) -> None:
        self.level = level
        self.msg = msg
        self.ts = ts
        self.fields: dict[str, str] = {}


def _iter_records(lines: list[str]):
    """Yield _Record objects from raw journalctl+pino lines."""
    cur: _Record | None = None
    for line in lines:
        pm = _RE_PREFIX.match(line)
        if pm:
            rest = pm.group("rest")
            date = pm.group("date")
            off = pm.group("off")
        else:
            # No journalctl prefix (e.g. running against a plain log file).
            rest = line
            date = None
            off = ""

        hm = _RE_PINO.match(rest)
        if hm:
            if cur is not None:
                yield cur
            ts = None
            if date is not None:
                ts = f"{date}T{hm.group('t')}{off}"
            cur = _Record(hm.group("level"), hm.group("msg").rstrip(), ts)
            continue

        if cur is not None:
            cm = _RE_CONT.match(rest)
            if cm:
                cur.fields.setdefault(cm.group("key"), cm.group("val").rstrip())

    if cur is not None:
        yield cur


def _parse_logs(lines: list[str]) -> dict:
    """Parse AIOStreams (pino) log lines into structured analysis data."""
    # requests keyed by requestId (falls back to a per-timestamp key)
    requests: dict[str, dict] = {}
    request_order: list[str] = []

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
    pipeline_steps: list[dict] = []
    all_timestamps: list[str] = []

    # (ts, streams, is_error, time_s) events attributed to the active request
    timeline: list[tuple[str, int, bool, float | None]] = []

    for rec in _iter_records(lines):
        msg = rec.msg
        fields = rec.fields
        ts = rec.ts
        if ts:
            all_timestamps.append(ts)

        # 1. Stream request fan-out (one line per queried source)
        if msg.startswith(_HANDLING_PREFIX):
            src = msg[len(_HANDLING_PREFIX):].strip()
            rid = _unquote(fields.get("requestId"))
            rtype = _unquote(fields.get("requestType")) or "unknown"
            key = rid or f"noid@{ts or len(request_order)}"
            req = requests.get(key)
            if req is None:
                req = {
                    "content_id": rid or "-",
                    "type": rtype,
                    "timestamp": ts,
                    "addons": [],
                    "total_streams": 0,
                    "total_errors": 0,
                    "duration_s": None,
                    "_start": ts or "",
                }
                requests[key] = req
                request_order.append(key)
            elif req["type"] == "unknown" and rtype != "unknown":
                req["type"] = rtype
            req["addons"].append(
                {"name": src, "status": "success", "streams": 0, "time_s": None, "error": None}
            )
            addon_stats[src]["calls"] += 1
            continue

        # 2. Completed search for <Name> in <n>ms (+ results field)
        m = _RE_COMPLETED.match(msg)
        if m:
            name = m.group("name").strip()
            t = _time_to_seconds(m.group("v"), m.group("u"))
            results = _to_int(fields.get("results"))
            a = addon_stats[name]
            a["calls"] += 1
            a["successes"] += 1
            a["times"].append(t)
            a["streams"].append(results)
            if ts:
                timeline.append((ts, results, False, t))
            continue

        # 3. addon fetch failed (fields: addon, took ms)
        if msg == "addon fetch failed":
            name = _unquote(fields.get("addon")) or "unknown"
            a = addon_stats[name]
            a["calls"] += 1
            a["failures"] += 1
            tsec: float | None = None
            took = fields.get("took")
            if took is not None:
                try:
                    tsec = float(took) / 1000.0
                    a["times"].append(tsec)
                except ValueError:
                    tsec = None
            error_counts[f"addon fetch failed: {name}"] += 1
            if ts:
                timeline.append((ts, 0, True, tsec))
            continue

        # 4. addon returned error streams (fields: addon)
        if msg == "addon returned error streams":
            name = _unquote(fields.get("addon")) or "unknown"
            a = addon_stats[name]
            a["calls"] += 1
            a["failures"] += 1
            error_counts[f"addon returned error streams: {name}"] += 1
            if ts:
                timeline.append((ts, 0, True, None))
            continue

        # 5. Applied basic filters in <n>ms, removed <k> streams -> pipeline
        m = _RE_FILTER.match(msg)
        if m:
            t = _time_to_seconds(m.group("v"), m.group("u"))
            pipeline_steps.append(
                {"stage": "FILTERER", "count": _to_int(m.group("removed")), "time_s": round(t, 4)}
            )
            continue

        # 6. "<engine> search for <query> took <n>ms" -> pipeline SEARCH
        m = _RE_SEARCH_TOOK.search(msg)
        if m:
            t = _time_to_seconds(m.group("v"), m.group("u"))
            pipeline_steps.append({"stage": "SEARCH", "count": 0, "time_s": round(t, 4)})
            continue

        # 7. Everything else at ERROR/FATAL (and error-ish WARN) -> error tally
        if rec.level in ("ERROR", "FATAL"):
            error_counts[_norm_error(msg)] += 1
            if ts:
                timeline.append((ts, 0, True, None))
            continue

    # ── Second pass: attribute timeline events to the active request ─────────
    ordered = [
        (requests[k]["_start"], k) for k in request_order if requests[k]["_start"]
    ]
    ordered.sort()
    starts = [s for s, _ in ordered]
    keys = [k for _, k in ordered]
    if starts:
        import bisect

        for ev_ts, streams, is_err, t_s in timeline:
            idx = bisect.bisect_right(starts, ev_ts) - 1
            if idx < 0:
                continue
            req = requests[keys[idx]]
            if streams:
                req["total_streams"] += streams
            if is_err:
                req["total_errors"] += 1
            if t_s is not None:
                req["duration_s"] = round(max(req["duration_s"] or 0.0, t_s), 3)

    # ── Build request list (chronological), drop internal fields ─────────────
    req_list = sorted(requests.values(), key=lambda r: r["_start"])
    for r in req_list:
        r.pop("_start", None)

    # ── Addon summary ────────────────────────────────────────────────────────
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

    # ── Overall summary ──────────────────────────────────────────────────────
    all_durations = [r["duration_s"] for r in req_list if r["duration_s"] is not None]
    all_stream_counts = [r["total_streams"] for r in req_list]
    summary = {
        "total_requests": len(req_list),
        "avg_response_time_s": (
            round(sum(all_durations) / len(all_durations), 2) if all_durations else None
        ),
        "avg_streams": (
            round(sum(all_stream_counts) / len(all_stream_counts), 1)
            if all_stream_counts
            else 0
        ),
        "fastest_s": round(min(all_durations), 2) if all_durations else None,
        "slowest_s": round(max(all_durations), 2) if all_durations else None,
        "total_addon_errors": sum(error_counts.values()),
    }

    time_range = {
        "start": all_timestamps[0] if all_timestamps else None,
        "end": all_timestamps[-1] if all_timestamps else None,
    }

    return {
        "log_lines": len(lines),
        "time_range": time_range,
        "summary": summary,
        "addons": addons_summary,
        "errors": dict(error_counts),
        "recent_requests": req_list[-50:],
        "pipeline": pipeline_steps[-100:],
        "http_requests": [],  # new pino logs carry no HTTP status/latency
    }


# ── API: Analyze logs ────────────────────────────────────────────────────────


async def api_aiostreams_analyze(request: Request) -> JSONResponse:
    """Fetch and parse AIOStreams journalctl logs into structured analysis."""
    try:
        n = str(max(1, min(int(request.query_params.get("n", "5000")), 50000)))
    except (ValueError, TypeError):
        n = "5000"

    unit = cfg.SERVICES.get("aiostreams", {}).get("unit", "aiostreams")

    try:
        result = await run_command(
            [
                "sudo",
                "journalctl",
                "-u",
                unit,
                "-n",
                n,
                "--no-pager",
                "--output=short-iso",
            ],
            timeout=30,
        )
    except CommandTimeoutError:
        return JSONResponse({"error": "timeout reading logs"}, status_code=504)
    except Exception as e:
        logger.exception("AIOStreams analyze failed")
        return JSONResponse({"error": str(e)}, status_code=500)

    lines = result.stdout.splitlines()
    if not lines and result.stderr:
        return JSONResponse(
            {"error": f"journalctl: {result.stderr.strip()[:300]}"}, status_code=500
        )

    return JSONResponse(_parse_logs(lines))


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
