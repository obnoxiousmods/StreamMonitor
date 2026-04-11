"""Package update checker — native (pacman) and AUR (yay) packages."""

from __future__ import annotations

import asyncio
import logging
import time

from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# ── Cache ─────────────────────────────────────────────────────────────────────
_CACHE_TTL = 600  # 10 minutes
_cache: dict = {}
_cache_ts: float = 0.0
_lock = asyncio.Lock()


def _parse_update_line(line: str) -> dict | None:
    """Parse one line from `checkupdates` or `yay -Qu --aur`.
    Format: <name> <current> -> <available>
    """
    parts = line.split()
    if len(parts) >= 4 and parts[2] == "->":
        return {"name": parts[0], "installed": parts[1], "available": parts[3]}
    return None


async def _run(cmd: list[str], timeout: float = 60) -> str:
    try:
        p = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await asyncio.wait_for(p.communicate(), timeout=timeout)
        return out.decode(errors="replace")
    except TimeoutError:
        logger.warning("packages: command timed out: %s", cmd)
        return ""
    except Exception as e:
        logger.warning("packages: command failed %s: %s", cmd, e)
        return ""


async def _fetch() -> dict:
    """Run all package queries concurrently and return structured result."""
    native_updates_raw, aur_updates_raw, native_list_raw, aur_list_raw = await asyncio.gather(
        _run(["checkupdates"]),
        _run(["yay", "-Qu", "--aur"]),
        _run(["pacman", "-Qn"], timeout=15),
        _run(["pacman", "-Qm"], timeout=15),
    )

    native_updates = [
        r for line in native_updates_raw.strip().splitlines()
        if (r := _parse_update_line(line.strip()))
    ]
    aur_updates = [
        r for line in aur_updates_raw.strip().splitlines()
        if (r := _parse_update_line(line.strip()))
    ]

    native_total = len([l for l in native_list_raw.strip().splitlines() if l.strip()])
    aur_total = len([l for l in aur_list_raw.strip().splitlines() if l.strip()])

    return {
        "native": {
            "updates": native_updates,
            "outdated": len(native_updates),
            "total": native_total,
        },
        "aur": {
            "updates": aur_updates,
            "outdated": len(aur_updates),
            "total": aur_total,
        },
        "ts": time.time(),
    }


async def api_packages(request: Request) -> JSONResponse:
    """Return native and AUR package update status (cached for 10 minutes)."""
    global _cache, _cache_ts

    force = request.query_params.get("refresh") == "1"

    async with _lock:
        if force or time.time() - _cache_ts > _CACHE_TTL or not _cache:
            try:
                _cache = await _fetch()
                _cache_ts = _cache["ts"]
            except Exception as e:
                logger.exception("packages: fetch failed")
                return JSONResponse({"error": str(e)}, status_code=500)

    return JSONResponse(_cache)
