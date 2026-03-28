"""
Comprehensive log error scanner.
Each service has a custom classifier that understands its exact log format.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import time
from collections import deque
from datetime import UTC, datetime
from pathlib import Path

import config as cfg

logger = logging.getLogger(__name__)

SCAN_INTERVAL = 120  # seconds between scans
MAX_ERRORS = 2000  # rolling history cap

error_history: deque[dict] = deque(maxlen=MAX_ERRORS)
last_scan_ts: float = 0.0
scan_count: int = 0

# ── Noise suppression: lines we always skip ────────────────────────────────────
_GLOBAL_SKIP = re.compile(
    # Our own monitoring traffic
    r"python-httpx|/api/ping|/healthchecks/ping"
    r"|/manifest\.json.*python-httpx|/v0/health.*python-httpx"
    # StremThru: 400 from our unauthed /v0/store/user poll
    r"|\"message\":\"missing store\""
    # Dispatcharr: 401s from our monitoring polls (known, not real errors)
    r"|Unauthorized:.*/(api/channels|api/epg|api/m3u|api/accounts)"
    # Arr stack routine noise
    r"|\[Info\] (DownloadDecisionMaker|RssSyncService|TrackGroupingService|ImportApproved|ReleaseSearchService)"
    r"|RSS Sync (Starting|Completed)|Processing \d+ releases"
    r"|Grouping \d+ tracks|Importing \d+ tracks"
    # Comet scraper routine output (SCRAPER level = debug-equivalent)
    r"|👻 SCRAPER.*orchestration\.filter_manager - Scraper .* found \d+"
    r"|👻 SCRAPER.*manager\.get_aliases"
    r"|👻 SCRAPER.*manager\.scrape"
    # Benign SQLite WAL recovery
    r"|SQLite notice.*recovered.*frames from WAL"
    # Jellyfin transcoding command lines (huge, not errors)
    r"|\[INF\].*ffmpeg -analyzeduration"
    # Zilean routine search logs
    r"|\| INFO \|.*Performing filtered search|Filtered search for.*returned \d+ results"
    # MediaFusion HTTP 200 access log noise
    r"|INFO::.*\" 200 \d",
    re.IGNORECASE,
)

_SKIP_JOURNAL_NOISE = re.compile(r"^-- (Logs begin|No entries|Journal begins)|^Hint:|^No journal files")


# ── Timestamp extractor ────────────────────────────────────────────────────────


def _extract_ts(journal_line: str, fallback: float) -> float:
    """Extract Unix timestamp from journalctl --output=short-iso prefix.
    Format: 2026-03-27T20:15:20+0000 hostname service[pid]: message
    """
    if m := re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{4}|Z))", journal_line):
        try:
            s = m.group(1)
            # Normalize: +0700 → +07:00, Z → +00:00
            s = re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", s)
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            return datetime.fromisoformat(s).timestamp()
        except Exception:
            pass
    return fallback


# ── Per-service classifiers ────────────────────────────────────────────────────


def _classify_arrstack(line: str) -> tuple[str, str] | None:
    """Radarr / Sonarr / Lidarr / Prowlarr — NLog format: [Level] Component: msg"""
    if m := re.search(r"\[(Warn|Error|Fatal|Debug|Trace)\]", line, re.IGNORECASE):
        lvl = m.group(1).lower()
        if lvl in ("error", "fatal"):
            return "error", "arrstack"
        if lvl == "warn":
            return "warning", "arrstack"
    # NLog SQLite errors embedded in full timestamp lines
    if re.search(r"SQLite (error|Error)\s*\(\d+\)", line):
        return "error", "arrstack"
    # Stack traces (at Radarr./Sonarr./Lidarr./Prowlarr.)
    if re.search(r"^\s+at (Radarr|Sonarr|Lidarr|Prowlarr|NzbDrone)\.", line):
        return "error", "arrstack"
    # Exception lines
    if re.search(r"\b(Exception|NullReferenceException|UnhandledException)\b", line):
        return "error", "arrstack"
    return None


def _classify_comet(line: str) -> tuple[str, str] | None:
    """Comet: 2026-03-27 20:15:20 | ⚠️ WARNING | module - message"""
    if "⚠️ WARNING" in line or "| WARNING |" in line:
        return "warning", "comet"
    if re.search(r"\|\s*(❌|💀|CRITICAL|ERROR)\s*\|", line):
        return "error", "comet"
    if "Exception while" in line or "exception" in line.lower():
        return "error", "comet"
    # Ratelimit warnings are worth capturing
    if "ratelimited" in line.lower() or "rate limit" in line.lower():
        return "warning", "comet"
    if re.search(r"\b(failed|connection refused|timeout|ConnectionError)\b", line, re.IGNORECASE):
        return "warning", "comet"
    return None


def _classify_mediafusion(line: str) -> tuple[str, str] | None:
    """MediaFusion: LEVEL::date::path::line - message"""
    if m := re.match(r"^(ERROR|WARNING|CRITICAL|WARN|FATAL)::", line, re.IGNORECASE):
        lvl = m.group(1).upper()
        if lvl in ("ERROR", "CRITICAL", "FATAL"):
            return "error", "mediafusion"
        return "warning", "mediafusion"
    # Python tracebacks
    if re.search(r"^Traceback \(most recent call last\)|^\s+File \".*\.py\", line \d+", line):
        return "error", "mediafusion"
    if re.search(r"\b(Exception|Error):", line) and "200" not in line:
        return "error", "mediafusion"
    return None


def _classify_bazarr(line: str) -> tuple[str, str] | None:
    """Bazarr: 2026-03-27 19:08:34,364 - logger (threadid) : LEVEL (module:line) - msg"""
    if m := re.search(r":\s+(ERROR|WARNING|CRITICAL|WARN)\s+\(", line, re.IGNORECASE):
        lvl = m.group(1).upper()
        if lvl in ("ERROR", "CRITICAL"):
            return "error", "bazarr"
        return "warning", "bazarr"
    if re.search(r"Traceback|Exception:|Error:", line):
        return "error", "bazarr"
    return None


def _classify_jackett(line: str) -> tuple[str, str] | None:
    """Jackett: MM-DD HH:MM:SS Level Message  +  C# stack traces"""
    if m := re.match(r"\d{2}-\d{2} \d{2}:\d{2}:\d{2} (Error|Warn|Fatal|Debug|Info)", line, re.IGNORECASE):
        lvl = m.group(1).lower()
        if lvl in ("error", "fatal"):
            return "error", "jackett"
        if lvl == "warn":
            return "warning", "jackett"
    # C# stack traces
    if re.search(r"^\s+at Jackett\.", line):
        return "error", "jackett"
    if re.search(r"\b(Exception|HttpRequestException|TaskCanceledException)\b", line):
        return "error", "jackett"
    # Inner exception
    if "--- End of inner exception stack trace ---" in line:
        return "error", "jackett"
    return None


def _classify_jellyfin(line: str) -> tuple[str, str] | None:
    """Jellyfin: [HH:MM:SS] [INF/ERR/WRN/CRT] message"""
    if m := re.search(r"\[(ERR|WRN|CRT|FTL)\]", line, re.IGNORECASE):
        lvl = m.group(1).upper()
        if lvl in ("ERR", "CRT", "FTL"):
            return "error", "jellyfin"
        if lvl == "WRN":
            return "warning", "jellyfin"
    # .NET exception patterns
    if re.search(r"\b(Exception|StackOverflow|OutOfMemory|NullReference)\b", line):
        return "error", "jellyfin"
    return None


def _classify_zilean(line: str) -> tuple[str, str] | None:
    """Zilean: [HH:MM:SS] | LEVEL | "ClassName" | message"""
    if m := re.search(r"\|\s*(WARN|ERR|CRIT|ERROR|FATAL)\s*\|", line, re.IGNORECASE):
        lvl = m.group(1).upper()
        if lvl in ("ERR", "ERROR", "CRIT", "FATAL"):
            return "error", "zilean"
        if lvl == "WARN":
            return "warning", "zilean"
    if re.search(r"\b(Exception|Error):", line):
        return "error", "zilean"
    return None


def _classify_stremthru(line: str) -> tuple[str, str] | None:
    """StremThru: structured JSON logs {"level":"WARN","msg":"...",...}"""
    try:
        obj = json.loads(line)
        lvl = obj.get("level", "").upper()
        err = obj.get("error", {})
        # Skip our own monitoring noise
        if isinstance(err, dict) and err.get("message") == "missing store":
            return None
        if lvl == "ERROR":
            return "error", "stremthru"
        if lvl in ("WARN", "WARNING"):
            # Skip the expected 400 for our unauthed /v0/store/user poll
            if isinstance(err, dict) and err.get("status_code") == 400 and "missing store" in err.get("message", ""):
                return None
            return "warning", "stremthru"
        if lvl in ("FATAL", "PANIC"):
            return "error", "stremthru"
    except (json.JSONDecodeError, TypeError):
        pass
    # Fallback plain-text
    if re.search(r'"level"\s*:\s*"(ERROR|FATAL|PANIC)"', line):
        return "error", "stremthru"
    if re.search(r'"level"\s*:\s*"WARN"', line):
        return "warning", "stremthru"
    return None


def _classify_aiostreams(line: str) -> tuple[str, str] | None:
    """AIOStreams (pnpm): 🔴 | ERROR | ... or 🟡 | WARN | ..."""
    if re.search(r"🔴|🚨|\|\s*ERROR\s*\||\|\s*FATAL\s*\|", line):
        return "error", "aiostreams"
    if re.search(r"🟡|\|\s*WARN(ING)?\s*\|", line):
        return "warning", "aiostreams"
    # "errors" count in stream response (non-zero)
    if (m := re.search(r"(\d+) errors?", line, re.IGNORECASE)) and int(m.group(1)) > 0 and "Returning" in line:
        return "warning", "aiostreams"
    if re.search(r"\b(Error|Exception|Unhandled|crash)\b", line, re.IGNORECASE):
        return "error", "aiostreams"
    return None


def _classify_dispatcharr(line: str) -> tuple[str, str] | None:
    """Dispatcharr (Django): YYYY-MM-DD HH:MM:SS,ms LEVEL logger message"""
    if m := re.match(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+ (ERROR|WARNING|CRITICAL|WARN)\b", line, re.IGNORECASE):
        lvl = m.group(1).upper()
        if lvl in ("ERROR", "CRITICAL"):
            return "error", "dispatcharr"
        return "warning", "dispatcharr"
    if re.search(r"Traceback|Exception:|django\.db\.utils|IntegrityError", line):
        return "error", "dispatcharr"
    return None


def _classify_flaresolverr(line: str) -> tuple[str, str] | None:
    """FlareSolverr: YYYY-MM-DD HH:MM:SS LEVEL message"""
    if m := re.match(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (ERROR|WARNING|CRITICAL)\b", line, re.IGNORECASE):
        lvl = m.group(1).upper()
        if lvl in ("ERROR", "CRITICAL"):
            return "error", "flaresolverr"
        return "warning", "flaresolverr"
    if re.search(r"Traceback|Error solving|challenge failed|browser.*crash", line, re.IGNORECASE):
        return "error", "flaresolverr"
    return None


def _classify_streammonitor(line: str) -> tuple[str, str] | None:
    """StreamMonitor itself (uvicorn + starlette): Python logging"""
    if re.search(r"\bERROR\b|\bCRITICAL\b", line):
        return "error", "streammonitor"
    if re.search(r"\bWARNING\b|\bWARN\b", line):
        return "warning", "streammonitor"
    if re.search(r"Traceback|Exception:|raise |Error:", line):
        return "error", "streammonitor"
    return None


def _classify_generic(line: str, sid: str) -> tuple[str, str] | None:
    """Fallback for services without a custom classifier."""
    if re.search(r"\b(CRITICAL|FATAL|EMERG|ALERT)\b", line, re.IGNORECASE):
        return "error", sid
    if re.search(r"\bERROR\b", line, re.IGNORECASE):
        return "error", sid
    if re.search(r"\bWARN(ING)?\b", line, re.IGNORECASE):
        return "warning", sid
    if re.search(r"\bException\b|Traceback|raise ", line):
        return "error", sid
    return None


# Map service id → classifier function
_CLASSIFIERS: dict[str, object] = {
    "comet": _classify_comet,
    "mediafusion": _classify_mediafusion,
    "stremthru": _classify_stremthru,
    "zilean": _classify_zilean,
    "aiostreams": _classify_aiostreams,
    "radarr": _classify_arrstack,
    "sonarr": _classify_arrstack,
    "lidarr": _classify_arrstack,
    "prowlarr": _classify_arrstack,
    "bazarr": _classify_bazarr,
    "jackett": _classify_jackett,
    "jellyfin": _classify_jellyfin,
    "flaresolverr": _classify_flaresolverr,
    "byparr": _classify_flaresolverr,
    "dispatcharr": _classify_dispatcharr,
    "streammonitor": _classify_streammonitor,
}


def _classify_line(sid: str, line: str) -> tuple[str, str] | None:
    clf = _CLASSIFIERS.get(sid, _classify_generic)
    if clf is _classify_generic:
        return _classify_generic(line, sid)
    return clf(line)


# ── Plex file-based log scanning ──────────────────────────────────────────────
_PLEX_LOG_DIR = Path(cfg.PLEX_LOG_DIR)
_PLEX_ERR_PAT = re.compile(
    r"\b(ERROR|WARN(ING)?|CRITICAL|Exception|crash|failed|unable to)\b",
    re.IGNORECASE,
)


async def _scan_plex_files(since: float) -> list[dict]:
    """Scan Plex log files (not journald) since a given mtime threshold."""
    found: list[dict] = []
    if not _PLEX_LOG_DIR.exists():
        return found
    try:
        log_files = sorted(_PLEX_LOG_DIR.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)[:3]
        for lf in log_files:
            try:
                if lf.stat().st_mtime < since:
                    continue
                for line in lf.read_text(errors="replace").splitlines()[-500:]:
                    if _GLOBAL_SKIP.search(line):
                        continue
                    if _PLEX_ERR_PAT.search(line):
                        sev = (
                            "error"
                            if re.search(r"\b(ERROR|CRITICAL|Exception|crash)\b", line, re.IGNORECASE)
                            else "warning"
                        )
                        found.append(
                            {
                                "sid": "plex",
                                "unit": "plex-log",
                                "line": line.strip()[:400],
                                "severity": sev,
                                "ts": time.time(),
                            }
                        )
            except Exception:
                pass
    except Exception:
        pass
    return found


# ── Journal scan per unit ──────────────────────────────────────────────────────
async def _scan_unit(sid: str, unit: str, since: str) -> list[dict]:
    found: list[dict] = []
    try:
        proc = await asyncio.create_subprocess_exec(
            "sudo",
            "journalctl",
            "-u",
            unit,
            "--since",
            since,
            "--no-pager",
            "--output=short-iso",
            # No -p filter: many apps log everything at INFO journald priority
            # but embed their own level in the message (Comet, AIOStreams, etc.)
            # Limit lines to avoid overwhelming the scanner
            "-n",
            "2000",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
        lines = out.decode(errors="replace").splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            i += 1
            if not line or _SKIP_JOURNAL_NOISE.search(line):
                continue
            if _GLOBAL_SKIP.search(line):
                continue
            result = _classify_line(sid, line)
            if result is None:
                continue
            sev, _ = result
            # Capture up to 5 continuation lines (stack frames, etc.)
            context_parts = [line]
            while i < len(lines) and len(context_parts) < 6:
                nxt = lines[i].strip()
                if not nxt:
                    break
                # If next line looks like a continuation (stack frame, indented, JSON fragment)
                if (
                    nxt.startswith("   ")
                    or nxt.startswith("\t")
                    or nxt.startswith("at ")
                    or "at Jackett." in nxt
                    or "at Radarr." in nxt
                    or "at Sonarr." in nxt
                    or nxt.startswith("null,")
                    or nxt.startswith("}")
                ):
                    context_parts.append(nxt)
                    i += 1
                else:
                    break
            full_line = " ↵ ".join(context_parts)[:600]
            entry_ts = _extract_ts(line, time.time())
            found.append(
                {
                    "sid": sid,
                    "unit": unit,
                    "line": full_line,
                    "severity": sev,
                    "ts": entry_ts,
                }
            )
    except Exception:
        pass
    return found


# ── Dedup & history management ─────────────────────────────────────────────────
# dedup_key → (last_seen_ts, entry_ref) — allows in-place count update
_seen_keys: dict[str, tuple[float, dict]] = {}


def _dedup_key(sid: str, line: str) -> str:
    """Strip timestamps and normalize variable parts (IDs, numbers, hex) so
    recurring messages with different parameters deduplicate correctly."""
    # Drop journal timestamp prefix
    core = re.sub(r"^[\d\-T:\.Z\[\]\s|+]+", "", line)
    # Normalize hex IDs and UUIDs
    core = re.sub(r"\b[0-9a-fA-F]{8,}\b", "HEX", core)
    # Normalize plain numbers (keep structure, not values)
    core = re.sub(r"\b\d{4,}\b", "N", core)
    return f"{sid}|{core[:140]}"


async def scan_all() -> int:
    global last_scan_ts, scan_count

    if last_scan_ts:
        since_dt = datetime.fromtimestamp(last_scan_ts - 10, UTC)
        since_str = since_dt.strftime("%Y-%m-%d %H:%M:%S")
        since_ts = last_scan_ts - 10
    else:
        since_str = "30 minutes ago"
        since_ts = time.time() - 1800

    scan_time = time.time()

    tasks = []
    sids = []
    for sid, svc in cfg.SERVICES.items():
        unit = svc.get("unit")
        if unit and sid != "plex":
            tasks.append(_scan_unit(sid, unit, since_str))
            sids.append(sid)
    tasks.append(_scan_plex_files(since_ts))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    now = time.time()
    # Expire dedup window (10 minutes)
    expired = [k for k, (t, _) in _seen_keys.items() if now - t > 600]
    for k in expired:
        del _seen_keys[k]

    new_count = 0
    for res in results:
        if not isinstance(res, list):
            continue
        for entry in res:
            key = _dedup_key(entry["sid"], entry["line"])
            if key in _seen_keys:
                seen_ts, entry_ref = _seen_keys[key]
                if now - seen_ts < 600:
                    # Same error within window — increment count, update ts
                    entry_ref["count"] = entry_ref.get("count", 1) + 1
                    entry_ref["ts"] = entry.get("ts", now)
                    _seen_keys[key] = (now, entry_ref)
                    continue
                else:
                    del _seen_keys[key]
            entry["count"] = 1
            entry["id"] = f"{entry['sid']}_{int(entry['ts'] * 1000)}"
            error_history.append(entry)
            _seen_keys[key] = (now, entry)
            new_count += 1

    last_scan_ts = scan_time
    scan_count += 1
    logger.info(f"Error scan #{scan_count} completed: {new_count} new errors/warnings found")
    return new_count


def clear_errors() -> None:
    """Clear error history and dedup state."""
    error_history.clear()
    _seen_keys.clear()


async def error_scan_loop() -> None:
    await asyncio.sleep(45)
    while True:
        with contextlib.suppress(Exception):
            await scan_all()
        await asyncio.sleep(SCAN_INTERVAL)


__all__ = ["clear_errors", "error_history", "error_scan_loop", "last_scan_ts", "scan_all", "scan_count"]
