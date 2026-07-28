"""Historical metrics API: time-series charts, service latency percentiles, incident timeline.

Backed by core.db (Postgres). All endpoints degrade to an empty/",""-ish result when the
Postgres pool isn't available (e.g. credentials unset) rather than erroring — history is a
nice-to-have layered on top of the always-available live snapshot endpoints.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from starlette.requests import Request
from starlette.responses import JSONResponse

import core.db as _db
from core.config import SERVICES

# Every metric_key ever written by stats/__init__.py's flatteners — surfaced via
# /api/bootstrap so the frontend doesn't have to hardcode this list.
KNOWN_METRIC_KEYS = {
    "cpu_usage_pct",
    "cpu_core_usage_pct",
    "ram_used_pct",
    "ram_used_gb",
    "ram_available_gb",
    "swap_active_gb",
    "mem_pressure_avg10",
    "gpu_usage_pct",
    "gpu_mem_busy_pct",
    "gpu_vram_used_mb",
    "gpu_temp_c",
    "gpu_power_w",
    "disk_read_bytes_s",
    "disk_write_bytes_s",
    "disk_used_pct",
    "net_recv_bytes_s",
    "net_sent_bytes_s",
    "nic_recv_bytes_s",
    "nic_sent_bytes_s",
    "nic_errors_in",
    "nic_errors_out",
    "nic_drops_in",
    "nic_drops_out",
    "tcp_connections_total",
    "tcp_connections_by_state",
    "tcp_retrans_rate_pct",
    "tcp_curr_established",
    "wan_ping_rtt_ms",
    "wan_ping_loss_pct",
    "dns_resolve_ms",
    "cert_days_remaining",
}

_RANGE_TO_TIMEDELTA = {
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def _since_from_range(range_param: str | None) -> datetime:
    delta = _RANGE_TO_TIMEDELTA.get(range_param or "1h", _RANGE_TO_TIMEDELTA["1h"])
    return datetime.now(UTC) - delta


async def api_metric_series(request: Request) -> JSONResponse:
    metric_key = request.path_params["metric_key"]
    if metric_key not in KNOWN_METRIC_KEYS:
        return JSONResponse({"error": "unknown metric_key"}, status_code=404)

    since = _since_from_range(request.query_params.get("range"))
    tags: dict[str, str] = {}
    for k, v in request.query_params.items():
        if k not in ("range",):
            tags[k] = v

    points = await _db.query_metric_series(metric_key, since, tags or None)
    return JSONResponse({"metric_key": metric_key, "since": since.isoformat(), "points": points})


async def api_service_latency(request: Request) -> JSONResponse:
    sid = request.path_params["service_id"]
    if sid not in SERVICES:
        return JSONResponse({"error": "unknown service"}, status_code=404)

    since = _since_from_range(request.query_params.get("range"))
    stats = await _db.query_service_latency_stats(sid, since)
    return JSONResponse({"service_id": sid, "since": since.isoformat(), **stats})


async def api_incidents(request: Request) -> JSONResponse:
    sid = request.query_params.get("service_id")
    if sid and sid not in SERVICES:
        return JSONResponse({"error": "unknown service"}, status_code=404)

    since = _since_from_range(request.query_params.get("range"))
    events = await _db.query_incident_timeline(sid, since)
    return JSONResponse({"since": since.isoformat(), "events": events})


async def api_alerts(request: Request) -> JSONResponse:
    since = _since_from_range(request.query_params.get("range") or "24h")
    events = await _db.query_alert_events(since)
    return JSONResponse({"since": since.isoformat(), "events": events})
