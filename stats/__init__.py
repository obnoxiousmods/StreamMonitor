"""Stats package: orchestrates collectors and exports shared state."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

from stats.base import service_stats, stats_updated_at, github_versions  # re-export
from stats.github import refresh_github_versions, GITHUB_INTERVAL
from stats.system import collect_system
from stats.collectors import (
    collect_comet, collect_mediafusion, collect_stremthru, collect_zilean,
    collect_aiostreams, collect_flaresolverr, collect_byparr, collect_jackett,
    collect_prowlarr, collect_radarr, collect_sonarr, collect_lidarr,
    collect_bazarr, collect_jellyfin, collect_plex, collect_jellyseerr,
    collect_dispatcharr, collect_mediaflow, collect_qbittorrent,
)

STATS_INTERVAL = 60  # seconds

_COLLECTORS: dict[str, object] = {
    "comet":        collect_comet,
    "mediafusion":  collect_mediafusion,
    "stremthru":    collect_stremthru,
    "zilean":       collect_zilean,
    "aiostreams":   collect_aiostreams,
    "flaresolverr": collect_flaresolverr,
    "byparr":       collect_byparr,
    "jackett":      collect_jackett,
    "prowlarr":     collect_prowlarr,
    "radarr":       collect_radarr,
    "sonarr":       collect_sonarr,
    "lidarr":       collect_lidarr,
    "bazarr":       collect_bazarr,
    "jellyfin":     collect_jellyfin,
    "plex":         collect_plex,
    "jellyseerr":   collect_jellyseerr,
    "dispatcharr":  collect_dispatcharr,
    "mediaflow":    collect_mediaflow,
    "qbittorrent":  collect_qbittorrent,
    "system":       collect_system,
}


async def _collect_one(sid: str) -> None:
    fn = _COLLECTORS.get(sid)
    if not fn:
        return
    try:
        data = await fn()
        service_stats[sid]    = data or {}
        stats_updated_at[sid] = datetime.now(timezone.utc).isoformat()
    except Exception:
        service_stats.setdefault(sid, {})


async def stats_loop() -> None:
    """Stagger startup then refresh every STATS_INTERVAL seconds."""
    for sid in _COLLECTORS:
        asyncio.create_task(_collect_one(sid))
        await asyncio.sleep(0.25)
    asyncio.create_task(refresh_github_versions())

    last_github = time.monotonic()
    while True:
        await asyncio.sleep(STATS_INTERVAL)
        await asyncio.gather(
            *[_collect_one(sid) for sid in _COLLECTORS],
            return_exceptions=True,
        )
        if time.monotonic() - last_github > GITHUB_INTERVAL:
            asyncio.create_task(refresh_github_versions())
            last_github = time.monotonic()


__all__ = [
    "service_stats", "stats_updated_at", "github_versions",
    "stats_loop", "_COLLECTORS",
]
