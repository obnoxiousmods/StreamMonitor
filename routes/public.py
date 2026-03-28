"""Public API: no auth required. Exposes service health summary."""

from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse

import core.health as _health


async def api_public(request: Request):
    """Return public health summary (no auth)."""
    services = {}
    for sid, snap in _health.cur.items():
        services[sid] = {
            "name": snap.get("name", sid),
            "ok": snap.get("ok"),
            "latency_ms": snap.get("latency_ms"),
            "category": snap.get("category", "other"),
        }

    total = len(services)
    up = sum(1 for s in services.values() if s["ok"])

    return JSONResponse(
        {
            "services": services,
            "total": total,
            "up": up,
            "down": total - up,
        }
    )
