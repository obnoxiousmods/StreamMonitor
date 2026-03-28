"""Jellyfin sessions and activity log."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse

_JF_URL = "http://127.0.0.1:8096"
import config as cfg
_JF_KEY = cfg.JELLYFIN_KEY


async def api_jellyfin(request: Request):
    """Fetch active sessions and recent activity from Jellyfin."""
    headers = {"X-Emby-Token": _JF_KEY}
    sessions = []
    activity = []

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(f"{_JF_URL}/Sessions", headers=headers)
            if r.status_code == 200:
                sessions = r.json()
        except Exception:
            pass

        try:
            since = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S.0000000Z")
            r = await client.get(
                f"{_JF_URL}/System/ActivityLog/Entries",
                params={"minDate": since, "limit": "50"},
                headers=headers,
            )
            if r.status_code == 200:
                data = r.json()
                activity = data.get("Items", data) if isinstance(data, dict) else data
        except Exception:
            pass

    return JSONResponse({"sessions": sessions, "activity": activity})
