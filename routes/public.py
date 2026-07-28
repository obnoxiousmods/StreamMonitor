"""Public API: no auth required. Exposes service health summary."""

from __future__ import annotations

import statistics
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse

import core.config as cfg
import core.health as _health
import stats as _stats


def _latency_percentiles(history: list[dict]) -> dict[str, float] | None:
    samples = [entry.get("latency_ms") for entry in history if isinstance(entry, dict)]
    samples = [s for s in samples if isinstance(s, int | float)]
    if len(samples) < 2:
        return None
    samples.sort()
    quantiles = statistics.quantiles(samples, n=100, method="inclusive")
    return {
        "p50_ms": round(quantiles[49], 1),
        "p95_ms": round(quantiles[94], 1),
        "p99_ms": round(quantiles[98], 1),
    }


def _cert_summary() -> dict:
    certs = (_stats.service_stats.get("network") or {}).get("certs") or {}
    entries = [
        {"host": host, "days_remaining": c["days_remaining"]}
        for host, c in certs.items()
        if isinstance(c, dict) and c.get("ok") and isinstance(c.get("days_remaining"), int)
    ]
    entries.sort(key=lambda e: e["days_remaining"])
    return {
        "checked": len(entries),
        "soonest_expiry_days": entries[0]["days_remaining"] if entries else None,
        "expiring_soon": [e for e in entries if e["days_remaining"] <= 30],
    }


def _coerce_history_entry(entry: Any) -> bool | None:
    if isinstance(entry, dict):
        value = entry.get("ok")
    else:
        value = entry
    if value is True:
        return True
    if value is False:
        return False
    return None


def _availability_pct(history: list[bool | None]) -> float | None:
    observed = [entry for entry in history if entry is not None]
    if not observed:
        return None
    return round((sum(1 for entry in observed if entry) / len(observed)) * 100, 1)


async def api_public(request: Request):
    """Return public health summary (no auth)."""

    services: dict[str, dict[str, Any]] = {}
    categories: dict[str, dict[str, Any]] = {}
    latest_update = None
    overall_history: list[bool | None] = []

    for sid, service_cfg in cfg.SERVICES.items():
        snap = _health.cur.get(sid, {})
        category_id = snap.get("category") or service_cfg.get("category", "other")
        raw_history = list(_health.hist.get(sid, []))
        history = [_coerce_history_entry(entry) for entry in raw_history]
        recent_history = history[-60:]
        service_entry = {
            "id": sid,
            "name": snap.get("name") or service_cfg.get("name", sid),
            "ok": snap.get("ok"),
            "latency_ms": snap.get("latency_ms"),
            "latency_percentiles": _latency_percentiles(raw_history),
            "category": category_id,
            "availability_pct": _availability_pct(history),
            "history": recent_history,
            "updated_at": snap.get("timestamp"),
        }
        services[sid] = service_entry

        category = categories.setdefault(
            category_id,
            {
                "id": category_id,
                "label": cfg.CATEGORIES.get(category_id, category_id.replace("_", " ").title()),
                "services": [],
                "total": 0,
                "up": 0,
                "down": 0,
                "_history": [],
            },
        )
        category["services"].append(sid)
        category["total"] += 1
        if service_entry["ok"] is True:
            category["up"] += 1
        elif service_entry["ok"] is False:
            category["down"] += 1
        category["_history"].extend(history)
        overall_history.extend(history)

        ts = snap.get("timestamp")
        if isinstance(ts, str) and (latest_update is None or ts > latest_update):
            latest_update = ts

    for category in categories.values():
        category["availability_pct"] = _availability_pct(category.pop("_history"))

    total = len(services)
    up = sum(1 for service in services.values() if service["ok"] is True)
    down = sum(1 for service in services.values() if service["ok"] is False)
    return JSONResponse(
        {
            "services": services,
            "categories": categories,
            "total": total,
            "up": up,
            "down": down,
            "availability_pct": _availability_pct(overall_history),
            "updated_at": latest_update,
            "window_minutes": round((_health.HISTORY_LEN * _health.CHECK_INTERVAL) / 60, 1),
            "cert_summary": _cert_summary(),
        }
    )
