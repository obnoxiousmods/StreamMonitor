"""Stats package: orchestrates collectors and exports shared state."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import suppress
from datetime import UTC, datetime, timedelta

import core.alerts as _alerts
import core.broadcast as _broadcast
import core.db as _db
from stats.base import github_versions, service_stats, stats_meta, stats_updated_at  # re-export
from stats.collectors import (
    collect_aiostreams,
    collect_bazarr,
    collect_byparr,
    collect_comet,
    collect_dispatcharr,
    collect_jackett,
    collect_jellyfin,
    collect_lidarr,
    collect_mediaflow,
    collect_mediafusion,
    collect_prowlarr,
    collect_qbittorrent,
    collect_radarr,
    collect_sonarr,
    collect_stremthru,
    collect_zilean,
)
from stats.conntrack import collect_per_ip_bandwidth
from stats.github import GITHUB_INTERVAL, refresh_github_versions
from stats.network import collect_network
from stats.system import collect_system

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


STATS_INTERVAL = _env_int("STREAMMONITOR_STATS_INTERVAL", 30)  # seconds
SYSTEM_STATS_INTERVAL = _env_int("STREAMMONITOR_SYSTEM_STATS_INTERVAL", 5)  # seconds
COLLECTOR_TIMEOUT = _env_int("STREAMMONITOR_COLLECTOR_TIMEOUT", 25)  # seconds
HEAVY_STATS_INTERVAL = _env_int("STREAMMONITOR_HEAVY_STATS_INTERVAL", 300)  # seconds
HEAVY_COLLECTORS = {"jackett", "prowlarr", "stremthru", "zilean", "network"}

_background_tasks: set[asyncio.Task] = set()

_COLLECTORS: dict[str, object] = {
    "comet": collect_comet,
    "mediafusion": collect_mediafusion,
    "stremthru": collect_stremthru,
    "zilean": collect_zilean,
    "aiostreams": collect_aiostreams,
    "byparr": collect_byparr,
    "jackett": collect_jackett,
    "prowlarr": collect_prowlarr,
    "radarr": collect_radarr,
    "sonarr": collect_sonarr,
    "lidarr": collect_lidarr,
    "bazarr": collect_bazarr,
    "jellyfin": collect_jellyfin,
    "dispatcharr": collect_dispatcharr,
    "mediaflow": collect_mediaflow,
    "qbittorrent": collect_qbittorrent,
    "system": collect_system,
    "network": collect_network,
    "netips": collect_per_ip_bandwidth,
}


def _flatten_system_metrics(data: dict) -> list[tuple[str, float, dict]]:
    """Turn collect_system()'s nested dict into (metric_key, value, tags) rows for history."""
    rows: list[tuple[str, float, dict]] = []

    cpu = data.get("cpu") or {}
    if "usage_pct" in cpu:
        rows.append(("cpu_usage_pct", cpu["usage_pct"], {}))
    for i, pct in enumerate(cpu.get("per_core_pct") or []):
        rows.append(("cpu_core_usage_pct", pct, {"core": i}))

    ram = data.get("ram") or {}
    if "percent" in ram:
        rows.append(("ram_used_pct", ram["percent"], {}))
    if "used_gb" in ram:
        rows.append(("ram_used_gb", ram["used_gb"], {}))
    if "available_gb" in ram:
        rows.append(("ram_available_gb", ram["available_gb"], {}))

    swap = data.get("swap") or {}
    if "active_gb" in swap:
        rows.append(("swap_active_gb", swap["active_gb"], {}))

    psi = (data.get("memory_pressure") or {}).get("some") or {}
    if "avg10" in psi:
        rows.append(("mem_pressure_avg10", psi["avg10"], {}))

    gpu = data.get("gpu") or {}
    for key in ("usage_pct", "mem_busy_pct", "vram_used_mb", "temp_c", "power_w"):
        if key in gpu and isinstance(gpu[key], int | float):
            rows.append((f"gpu_{key}", gpu[key], {}))

    disk_io = data.get("disk_io") or {}
    if "read_bytes_s" in disk_io:
        rows.append(("disk_read_bytes_s", disk_io["read_bytes_s"], {}))
    if "write_bytes_s" in disk_io:
        rows.append(("disk_write_bytes_s", disk_io["write_bytes_s"], {}))

    net_io = data.get("net_io") or {}
    if "recv_bytes_s" in net_io:
        rows.append(("net_recv_bytes_s", net_io["recv_bytes_s"], {}))
    if "sent_bytes_s" in net_io:
        rows.append(("net_sent_bytes_s", net_io["sent_bytes_s"], {}))

    for disk in data.get("disks") or []:
        if "percent" in disk and disk.get("mount"):
            rows.append(("disk_used_pct", disk["percent"], {"mount": disk["mount"]}))

    return rows


def _flatten_network_metrics(data: dict) -> list[tuple[str, float, dict]]:
    """Turn collect_network()'s nested dict into (metric_key, value, tags) rows for history."""
    rows: list[tuple[str, float, dict]] = []

    for nic in data.get("nics") or []:
        name = nic.get("name")
        if not name:
            continue
        if "recv_bytes_s" in nic:
            rows.append(("nic_recv_bytes_s", nic["recv_bytes_s"], {"nic": name}))
        if "sent_bytes_s" in nic:
            rows.append(("nic_sent_bytes_s", nic["sent_bytes_s"], {"nic": name}))
        rows.append(("nic_errors_in", nic.get("errors_in", 0), {"nic": name}))
        rows.append(("nic_errors_out", nic.get("errors_out", 0), {"nic": name}))
        rows.append(("nic_drops_in", nic.get("drops_in", 0), {"nic": name}))
        rows.append(("nic_drops_out", nic.get("drops_out", 0), {"nic": name}))

    connections = data.get("connections") or {}
    if "total" in connections:
        rows.append(("tcp_connections_total", connections["total"], {}))
    for state, count in (connections.get("by_state") or {}).items():
        rows.append(("tcp_connections_by_state", count, {"state": state}))

    tcp = data.get("tcp") or {}
    if "retrans_rate_pct" in tcp:
        rows.append(("tcp_retrans_rate_pct", tcp["retrans_rate_pct"], {}))
    if "curr_established" in tcp and tcp["curr_established"] is not None:
        rows.append(("tcp_curr_established", tcp["curr_established"], {}))

    for host, ping in (data.get("wan") or {}).items():
        if isinstance(ping, dict) and ping.get("avg_rtt_ms") is not None:
            rows.append(("wan_ping_rtt_ms", ping["avg_rtt_ms"], {"target": host}))
        if isinstance(ping, dict) and ping.get("loss_pct") is not None:
            rows.append(("wan_ping_loss_pct", ping["loss_pct"], {"target": host}))

    for host, dns in ((data.get("dns") or {}).get("hosts") or {}).items():
        if isinstance(dns, dict) and dns.get("ms") is not None:
            rows.append(("dns_resolve_ms", dns["ms"], {"host": host}))

    for host, cert in (data.get("certs") or {}).items():
        if isinstance(cert, dict) and cert.get("days_remaining") is not None:
            rows.append(("cert_days_remaining", cert["days_remaining"], {"host": host}))

    return rows


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
        if sid == "system" and data:
            _db.write_metrics_batch(_flatten_system_metrics(data))
            _alerts.check_system_thresholds(data)
        elif sid == "network" and data:
            _db.write_metrics_batch(_flatten_network_metrics(data))
            _alerts.check_cert_thresholds(data)
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
        # Lightweight signal only — clients refetch the (possibly large) stats payload
        # over REST rather than duplicating its shape on the SSE channel.
        _broadcast.publish("stats", {"service_id": sid, "updated_at": updated_at.isoformat()})
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
