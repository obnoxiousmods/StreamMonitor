"""Speed test page and download endpoint."""

from __future__ import annotations

import os
import time
from collections import defaultdict
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.templating import Jinja2Templates

import config as cfg

_templates = Jinja2Templates(directory=str(Path(__file__).parent.parent / "templates"))

# ── Rate limiting: 2 tests per 10 minutes per IP ─────────────────────────────
_rate: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT = 6
_RATE_WINDOW = 600  # 10 minutes
_MAX_MB = 500
_THROTTLE_BYTES_PER_SEC = 125_000_000  # 1 Gbps


def _check_rate(ip: str) -> bool:
    now = time.monotonic()
    _rate[ip] = [t for t in _rate[ip] if now - t < _RATE_WINDOW]
    if len(_rate[ip]) >= _RATE_LIMIT:
        return False
    _rate[ip].append(now)
    return True


def _client_ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
        request.client.host if request.client else "unknown"
    )


# ── Download endpoint ─────────────────────────────────────────────────────────


async def speedtest_download(request: Request):
    """Generate random bytes for speed testing with throttling."""
    ip = _client_ip(request)
    if not _check_rate(ip):
        return JSONResponse(
            {"error": "Rate limit exceeded. Max 2 tests per 10 minutes."},
            status_code=429,
        )

    try:
        mb = min(int(request.query_params.get("mb", "25")), _MAX_MB)
    except (ValueError, TypeError):
        mb = 25

    total_bytes = mb * 1024 * 1024
    chunk_size = 65536  # 64 KB chunks

    async def generate():
        sent = 0
        while sent < total_bytes:
            remaining = total_bytes - sent
            size = min(chunk_size, remaining)
            yield os.urandom(size)
            sent += size

    return StreamingResponse(
        generate(),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(total_bytes),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Length",
        },
    )


# ── Speed test page (served via Jinja2 template) ────────────────────────────


async def speedtest_page(request: Request):
    """Serve the speed test HTML page."""
    return _templates.TemplateResponse(
        request,
        "speedtest.html",
        {
            "speedtest_direct_url": cfg.SPEEDTEST_DIRECT_URL,
            "speedtest_direct_name": cfg.SPEEDTEST_DIRECT_NAME,
            "speedtest_cf_url": cfg.SPEEDTEST_CF_URL,
            "speedtest_cf_name": cfg.SPEEDTEST_CF_NAME,
        },
    )
