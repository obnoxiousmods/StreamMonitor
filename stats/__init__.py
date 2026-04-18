"""Stats package: orchestrates collectors and exports shared state."""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import suppress
from datetime import UTC, datetime, timedelta

from stats.base import github_versions, service_stats, stats_meta, stats_updated_at  # re-export
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

logger = logging.getLogger(__name__)

STATS_INTERVAL = 15  # seconds
SYSTEM_STATS_INTERVAL = 5  # seconds
COLLECTOR_TIMEOUT = 25  # seconds
HEAVY_STATS_INTERVAL = 60  # seconds
HEAVY_COLLECTORS = {"jackett", "stremthru", "zilean"}

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
    started = time.monotonic()
    started_at = datetime.now(UTC)
    interval = _collector_interval(sid)
    stats_meta[sid] = {
        **stats_meta.get(sid, {}),
        "started_at": started_at.isoformat(),
        "running": True,
        "interval": interval,
    }
    try:
        logger.debug(f"Running collector for {sid}")
        data = await asyncio.wait_for(fn(), timeout=COLLECTOR_TIMEOUT)
        service_stats[sid] = data or {}
        updated_at = datetime.now(UTC)
        stats_updated_at[sid] = updated_at.isoformat()
        stats_meta[sid] = {
            "ok": True,
            "stale": False,
            "running": False,
            "updated_at": updated_at.isoformat(),
            "started_at": started_at.isoformat(),
            "duration_ms": round((time.monotonic() - started) * 1000),
            "error": "",
            "interval": interval,
            "next_due": (updated_at + timedelta(seconds=interval)).isoformat(),
        }
    except TimeoutError:
        logger.warning("Collector for %s timed out after %ss", sid, COLLECTOR_TIMEOUT)
        service_stats.setdefault(sid, {})
        _mark_failed(sid, started_at, started, f"timed out after {COLLECTOR_TIMEOUT}s", interval)
    except Exception as exc:
        logger.warning(f"Collector for {sid} failed", exc_info=True)
        service_stats.setdefault(sid, {})
        _mark_failed(sid, started_at, started, str(exc)[:180], interval)


def _collector_interval(sid: str) -> int:
    if sid in HEAVY_COLLECTORS:
        return HEAVY_STATS_INTERVAL
    return SYSTEM_STATS_INTERVAL if sid == "system" else STATS_INTERVAL


def _mark_failed(sid: str, started_at: datetime, started: float, error: str, interval: int) -> None:
    now = datetime.now(UTC)
    stats_meta[sid] = {
        **stats_meta.get(sid, {}),
        "ok": False,
        "stale": sid in stats_updated_at,
        "running": False,
        "started_at": started_at.isoformat(),
        "duration_ms": round((time.monotonic() - started) * 1000),
        "error": error,
        "interval": interval,
        "next_due": (now + timedelta(seconds=interval)).isoformat(),
    }


async def _collector_loop(sid: str, initial_delay: float) -> None:
    await asyncio.sleep(initial_delay)
    while True:
        started = time.monotonic()
        await _collect_one(sid)
        interval = _collector_interval(sid)
        await asyncio.sleep(max(0.0, interval - (time.monotonic() - started)))


async def _github_loop() -> None:
    await refresh_github_versions()
    while True:
        await asyncio.sleep(GITHUB_INTERVAL)
        await refresh_github_versions()


async def stats_loop() -> None:
    """Run each collector on its own cache interval."""
    tasks = [
        asyncio.create_task(_collector_loop(sid, initial_delay=i * 0.25), name=f"stats:{sid}")
        for i, sid in enumerate(_COLLECTORS)
    ]
    tasks.append(asyncio.create_task(_github_loop(), name="stats:github"))
    _background_tasks.update(tasks)
    for task in tasks:
        task.add_done_callback(_background_tasks.discard)
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        with suppress(Exception):
            await asyncio.gather(*tasks, return_exceptions=True)


__all__ = [
    "_COLLECTORS",
    "github_versions",
    "service_stats",
    "stats_loop",
    "stats_meta",
    "stats_updated_at",
]
