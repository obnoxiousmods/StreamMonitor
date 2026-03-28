"""Stats package: orchestrates collectors and exports shared state."""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime

from stats.base import github_versions, service_stats, stats_updated_at  # re-export
from stats.collectors import (
    collect_aiostreams,
    collect_bazarr,
    collect_byparr,
    collect_comet,
    collect_dispatcharr,
    collect_flaresolverr,
    collect_jackett,
    collect_jellyfin,
    collect_jellyseerr,
    collect_lidarr,
    collect_mediaflow,
    collect_mediafusion,
    collect_plex,
    collect_prowlarr,
    collect_qbittorrent,
    collect_radarr,
    collect_sonarr,
    collect_stremthru,
    collect_zilean,
)
from stats.github import GITHUB_INTERVAL, refresh_github_versions
from stats.system import collect_system

STATS_INTERVAL = 60  # seconds

_background_tasks: set[asyncio.Task] = set()

_COLLECTORS: dict[str, object] = {
    "comet": collect_comet,
    "mediafusion": collect_mediafusion,
    "stremthru": collect_stremthru,
    "zilean": collect_zilean,
    "aiostreams": collect_aiostreams,
    "flaresolverr": collect_flaresolverr,
    "byparr": collect_byparr,
    "jackett": collect_jackett,
    "prowlarr": collect_prowlarr,
    "radarr": collect_radarr,
    "sonarr": collect_sonarr,
    "lidarr": collect_lidarr,
    "bazarr": collect_bazarr,
    "jellyfin": collect_jellyfin,
    "plex": collect_plex,
    "jellyseerr": collect_jellyseerr,
    "dispatcharr": collect_dispatcharr,
    "mediaflow": collect_mediaflow,
    "qbittorrent": collect_qbittorrent,
    "system": collect_system,
}


async def _collect_one(sid: str) -> None:
    fn = _COLLECTORS.get(sid)
    if not fn:
        return
    try:
        data = await fn()
        service_stats[sid] = data or {}
        stats_updated_at[sid] = datetime.now(UTC).isoformat()
    except Exception:
        service_stats.setdefault(sid, {})


async def stats_loop() -> None:
    """Stagger startup then refresh every STATS_INTERVAL seconds."""
    for sid in _COLLECTORS:
        task = asyncio.create_task(_collect_one(sid))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
        await asyncio.sleep(0.25)
    task = asyncio.create_task(refresh_github_versions())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    last_github = time.monotonic()
    while True:
        await asyncio.sleep(STATS_INTERVAL)
        await asyncio.gather(
            *[_collect_one(sid) for sid in _COLLECTORS],
            return_exceptions=True,
        )
        if time.monotonic() - last_github > GITHUB_INTERVAL:
            task = asyncio.create_task(refresh_github_versions())
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
            last_github = time.monotonic()


__all__ = [
    "_COLLECTORS",
    "github_versions",
    "service_stats",
    "stats_loop",
    "stats_updated_at",
]
