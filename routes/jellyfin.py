"""Jellyfin sessions and activity log."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse

import config as cfg


async def api_jellyfin(request: Request):
    """Fetch active sessions and recent activity from Jellyfin."""
    headers = {"X-Emby-Token": cfg.JELLYFIN_KEY}
    sessions = []
    activity = []

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(f"{cfg.JELLYFIN_URL}/Sessions", headers=headers)
            if r.status_code == 200:
                sessions = r.json()
        except Exception:
            pass

        try:
            since = (datetime.now(UTC) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S.0000000Z")
            r = await client.get(
                f"{cfg.JELLYFIN_URL}/System/ActivityLog/Entries",
                params={"minDate": since, "limit": "50"},
                headers=headers,
            )
            if r.status_code == 200:
                data = r.json()
                activity = data.get("Items", data) if isinstance(data, dict) else data
        except Exception:
            pass

    return JSONResponse({"sessions": sessions, "activity": activity})
