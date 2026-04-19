"""Jellyfin sessions and activity log."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse

import core.config as cfg


def _diag(message: str, *, status_code: int | None = None, body: str | None = None) -> dict:
    data: dict = {"message": message}
    if status_code is not None:
        data["status_code"] = status_code
    if body:
        data["body"] = body[:300]
    return data


async def _jellyfin_get(client: httpx.AsyncClient, path: str, headers: dict, **params) -> tuple[object | None, dict | None]:
    url = f"{cfg.JELLYFIN_URL.rstrip('/')}{path}"
    try:
        response = await client.get(url, headers=headers, params=params or None)
    except httpx.TimeoutException:
        return None, _diag("Jellyfin request timed out")
    except httpx.HTTPError as exc:
        return None, _diag(str(exc))

    if response.status_code != 200:
        return None, _diag(
            f"Jellyfin returned HTTP {response.status_code}",
            status_code=response.status_code,
            body=response.text,
        )

    try:
        return response.json(), None
    except ValueError:
        return None, _diag("Jellyfin returned invalid JSON", body=response.text)


async def api_jellyfin(request: Request):
    """Fetch active sessions and recent activity from Jellyfin."""
    configured = bool(cfg.JELLYFIN_URL and cfg.JELLYFIN_KEY)
    errors: dict[str, dict] = {}
    sessions = []
    activity = []

    if not cfg.JELLYFIN_URL:
        errors["config"] = _diag("JELLYFIN_URL is not configured")
    if not cfg.JELLYFIN_KEY:
        errors["config"] = _diag("JELLYFIN_API_KEY is not configured")

    if configured:
        headers = {"X-Emby-Token": cfg.JELLYFIN_KEY}
        async with httpx.AsyncClient(timeout=10, follow_redirects=True, verify=False) as client:
            session_data, error = await _jellyfin_get(client, "/Sessions", headers)
            if error:
                errors["sessions"] = error
            elif isinstance(session_data, list):
                sessions = session_data
            else:
                errors["sessions"] = _diag("Jellyfin sessions response was not a list")

            since = (datetime.now(UTC) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S.0000000Z")
            activity_data, error = await _jellyfin_get(
                client,
                "/System/ActivityLog/Entries",
                headers,
                minDate=since,
                limit="50",
            )
            if error:
                errors["activity"] = error
            elif isinstance(activity_data, dict):
                items = activity_data.get("Items", [])
                activity = items if isinstance(items, list) else []
            elif isinstance(activity_data, list):
                activity = activity_data
            else:
                errors["activity"] = _diag("Jellyfin activity response was not a list or object")

    return JSONResponse(
        {
            "ok": configured and not errors,
            "configured": configured,
            "updated_at": datetime.now(UTC).isoformat(),
            "url": cfg.JELLYFIN_URL,
            "sessions": sessions,
            "activity": activity,
            "errors": errors,
        }
    )
