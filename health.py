"""Health check logic: HTTP probes, systemd status, poll loop."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from datetime import UTC, datetime

import httpx

import config as _cfg
from config import SERVICES

logger = logging.getLogger(__name__)

HISTORY_LEN = 120
CHECK_INTERVAL = 30

hist: dict[str, deque] = {k: deque(maxlen=HISTORY_LEN) for k in SERVICES}
cur: dict[str, dict] = {}


async def systemd_active(unit: str) -> tuple[bool, str]:
    try:
        p = await asyncio.create_subprocess_exec(
            "systemctl",
            "is-active",
            "--quiet",
            unit,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await p.wait()
        active = p.returncode == 0
        return active, "active" if active else "inactive"
    except Exception as e:
        return False, f"error: {e}"


async def http_check(cfg: dict) -> tuple[bool, int | None, str]:
    ssl_verify = cfg.get("ssl", True)
    follow_redir = cfg.get("follow_redirects", False)
    headers = cfg.get("headers", {})
    ok_codes = cfg.get("ok", [200])
    timeout = cfg.get("timeout", 8)
    try:
        async with httpx.AsyncClient(
            verify=ssl_verify,
            follow_redirects=follow_redir,
            timeout=timeout,
            http2=True,
        ) as c:
            r = await c.get(cfg["url"], headers=headers)
        ok = r.status_code in ok_codes
        if ok:
            msg = f"HTTP {r.status_code}" if r.status_code < 300 else f"HTTP {r.status_code} Redirect"
        else:
            msg = f"HTTP {r.status_code} — unexpected"
        return ok, r.status_code, msg
    except httpx.ConnectError:
        return False, None, "Connection refused"
    except httpx.TimeoutException:
        return False, None, "Timeout"
    except Exception as e:
        return False, None, str(e)[:120]


async def poll(sid: str, cfg: dict) -> dict:
    ts = datetime.now(UTC).isoformat()

    # System pseudo-service: no unit, always "up"
    if cfg.get("unit") is None:
        result = {
            "id": sid,
            "name": cfg["name"],
            "ok": True,
            "systemd_ok": True,
            "http_ok": None,
            "systemd": "n/a",
            "latency_ms": None,
            "message": "local",
            "timestamp": ts,
            "category": cfg.get("category", "other"),
        }
        hist[sid].append(result)
        cur[sid] = result
        return result

    svc_ok, svc_state = await systemd_active(cfg["unit"])
    latency, http_ok, msg = None, None, svc_state

    if cfg.get("url"):
        # Resolve headers dynamically so runtime key updates take effect
        check_cfg = dict(cfg)
        check_cfg["headers"] = _cfg.get_live_headers(sid)
        t0 = time.monotonic()
        http_ok_bool, _, msg = await http_check(check_cfg)
        latency = int((time.monotonic() - t0) * 1000)
        http_ok = http_ok_bool
    else:
        # No URL: only systemd matters
        http_ok = None

    overall_ok = svc_ok and (http_ok if http_ok is not None else True)

    result = {
        "id": sid,
        "name": cfg["name"],
        "ok": overall_ok,
        "systemd_ok": svc_ok,
        "http_ok": http_ok,
        "unit": cfg.get("unit", ""),
        "systemd": svc_state,
        "latency_ms": latency,
        "message": msg,
        "timestamp": ts,
        "category": cfg.get("category", "other"),
    }
    # Detect state changes for logging
    prev = cur.get(sid)
    was_ok = prev["ok"] if prev else None
    if not overall_ok and was_ok is not False:
        logger.warning(f"Service {sid} ({cfg['name']}) is DOWN: {msg}")
    elif overall_ok and was_ok is False:
        logger.info(f"Service {sid} ({cfg['name']}) recovered (UP)")

    hist[sid].append(result)
    cur[sid] = result
    return result


async def poll_loop() -> None:
    while True:
        await asyncio.gather(
            *[poll(s, c) for s, c in SERVICES.items()],
            return_exceptions=True,
        )
        await asyncio.sleep(CHECK_INTERVAL)
