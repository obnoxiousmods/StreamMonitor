"""Shared state and HTTP helpers for stats collectors."""

from __future__ import annotations

import httpx

# ── Shared state (imported by all collector modules) ──────────────────────────
service_stats: dict[str, dict] = {}
stats_updated_at: dict[str, str] = {}
stats_meta: dict[str, dict] = {}
github_versions: dict[str, dict] = {}


async def _get(
    client: httpx.AsyncClient,
    url: str,
    headers: dict | None = None,
    *,
    timeout: float = 8.0,
) -> dict | list | None:
    """GET JSON; return None on any failure or non-200."""
    try:
        r = await client.get(url, headers=headers or {}, timeout=timeout)
        if r.status_code == 200:
            ct = r.headers.get("content-type", "")
            if "json" in ct or r.text.strip().startswith(("{", "[")):
                return r.json()
    except Exception:
        pass
    return None


async def _get_raw(
    client: httpx.AsyncClient,
    url: str,
    headers: dict | None = None,
    *,
    timeout: float = 8.0,
) -> str | None:
    """GET raw text/XML; return None on failure."""
    try:
        r = await client.get(url, headers=headers or {}, timeout=timeout)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return None
