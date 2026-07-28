"""Alerting: threshold/event rule evaluation + Discord/ntfy webhook dispatch.

Debounced in-memory: a threshold rule must breach N consecutive collector runs
before it fires (avoids single noisy sample spam), and fires again only on
recovery — same shape as the existing UP/DOWN service-state logging in
core/health.py.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

import core.config as cfg
import core.db as _db

logger = logging.getLogger(__name__)

CONSECUTIVE_BREACHES_REQUIRED = 3
CERT_WARN_DAYS = 14

# rule_key -> consecutive breach count (system/network thresholds)
_breach_counts: dict[str, int] = {}
# rule_key -> currently firing (so we only notify once per breach, and once on recovery)
_active: set[str] = set()
# host -> already warned about upcoming cert expiry (cleared once renewed past the window)
_cert_warned: set[str] = set()

THRESHOLDS = {
    "cpu_usage_pct": ("CPU usage", 90, "%"),
    "ram_used_pct": ("RAM usage", 90, "%"),
    "gpu_temp_c": ("GPU temperature", 85, "C"),
    "disk_used_pct": ("Disk usage", 90, "%"),
}


async def _send_discord(message: str) -> None:
    if not cfg.ALERT_DISCORD_WEBHOOK:
        return
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await client.post(cfg.ALERT_DISCORD_WEBHOOK, json={"content": message[:1900]})
    except Exception:
        logger.debug("Discord alert dispatch failed", exc_info=True)


async def _send_ntfy(message: str, title: str, priority: str = "default") -> None:
    if not cfg.ALERT_NTFY_URL or not cfg.ALERT_NTFY_TOPIC:
        return
    url = f"{cfg.ALERT_NTFY_URL.rstrip('/')}/{cfg.ALERT_NTFY_TOPIC}"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await client.post(
                url,
                content=message.encode(),
                headers={"Title": title[:200], "Priority": priority},
            )
    except Exception:
        logger.debug("ntfy alert dispatch failed", exc_info=True)


def notify(rule_key: str, severity: str, message: str, tags: dict | None = None) -> None:
    """Fire-and-forget: dispatch to configured webhooks + persist to alert_events."""
    title = f"StreamMonitor [{severity.upper()}]"
    priority = "urgent" if severity == "critical" else "high" if severity == "warning" else "default"
    asyncio.create_task(_send_discord(f"**{title}** {message}"))
    asyncio.create_task(_send_ntfy(message, title, priority))
    asyncio.create_task(_db.record_alert_event(rule_key, severity, message, tags))
    logger.info("ALERT [%s/%s] %s", severity, rule_key, message)


def notify_service_transition(service_id: str, name: str, is_up: bool, message: str) -> None:
    if is_up:
        notify(f"service:{service_id}", "info", f"{name} recovered (UP): {message}", {"service_id": service_id})
    else:
        notify(f"service:{service_id}", "critical", f"{name} is DOWN: {message}", {"service_id": service_id})


def _check_threshold(rule_key: str, label: str, value: float, limit: float, unit: str, tags: dict) -> None:
    breached = value > limit
    if breached:
        _breach_counts[rule_key] = _breach_counts.get(rule_key, 0) + 1
        if _breach_counts[rule_key] >= CONSECUTIVE_BREACHES_REQUIRED and rule_key not in _active:
            _active.add(rule_key)
            notify(rule_key, "warning", f"{label} at {value:.1f}{unit} (threshold {limit}{unit})", tags)
    else:
        _breach_counts[rule_key] = 0
        if rule_key in _active:
            _active.discard(rule_key)
            notify(rule_key, "info", f"{label} back to normal ({value:.1f}{unit})", tags)


def check_system_thresholds(data: dict) -> None:
    cpu = data.get("cpu") or {}
    if "usage_pct" in cpu:
        label, limit, unit = THRESHOLDS["cpu_usage_pct"]
        _check_threshold("cpu_usage_pct", label, cpu["usage_pct"], limit, unit, {})

    ram = data.get("ram") or {}
    if "percent" in ram:
        label, limit, unit = THRESHOLDS["ram_used_pct"]
        _check_threshold("ram_used_pct", label, ram["percent"], limit, unit, {})

    gpu = data.get("gpu") or {}
    if "temp_c" in gpu:
        label, limit, unit = THRESHOLDS["gpu_temp_c"]
        _check_threshold("gpu_temp_c", label, gpu["temp_c"], limit, unit, {})

    for disk in data.get("disks") or []:
        mount = disk.get("mount")
        if mount and "percent" in disk:
            label, limit, unit = THRESHOLDS["disk_used_pct"]
            _check_threshold(f"disk_used_pct:{mount}", f"{label} ({mount})", disk["percent"], limit, unit, {"mount": mount})


def check_cert_thresholds(data: dict) -> None:
    certs = data.get("certs") or {}
    for host, cert in certs.items():
        if not isinstance(cert, dict):
            continue
        days = cert.get("days_remaining")
        if not cert.get("ok") or days is None:
            continue
        if days <= CERT_WARN_DAYS:
            if host not in _cert_warned:
                _cert_warned.add(host)
                notify(f"cert:{host}", "warning", f"TLS cert for {host} expires in {days} days", {"host": host})
        else:
            _cert_warned.discard(host)
