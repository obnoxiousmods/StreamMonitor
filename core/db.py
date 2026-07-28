"""Postgres persistence: connection pool, schema migration, metric writes, retention."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import datetime

import asyncpg

import core.config as cfg

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None
_pending_writes: set[asyncio.Task] = set()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS metric_samples (
    id bigserial PRIMARY KEY,
    ts timestamptz NOT NULL DEFAULT now(),
    metric_key text NOT NULL,
    value double precision NOT NULL,
    tags jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_metric_samples_key_ts ON metric_samples (metric_key, ts DESC);

CREATE TABLE IF NOT EXISTS metric_samples_5m (
    ts timestamptz NOT NULL,
    metric_key text NOT NULL,
    tags jsonb NOT NULL DEFAULT '{}'::jsonb,
    avg_value double precision NOT NULL,
    min_value double precision NOT NULL,
    max_value double precision NOT NULL,
    sample_count integer NOT NULL,
    PRIMARY KEY (ts, metric_key, tags)
);
CREATE INDEX IF NOT EXISTS idx_metric_samples_5m_key_ts ON metric_samples_5m (metric_key, ts DESC);

CREATE TABLE IF NOT EXISTS service_health_samples (
    id bigserial PRIMARY KEY,
    ts timestamptz NOT NULL DEFAULT now(),
    service_id text NOT NULL,
    ok boolean NOT NULL,
    latency_ms integer,
    http_status integer
);
CREATE INDEX IF NOT EXISTS idx_health_samples_service_ts ON service_health_samples (service_id, ts DESC);

CREATE TABLE IF NOT EXISTS alert_events (
    id bigserial PRIMARY KEY,
    ts timestamptz NOT NULL DEFAULT now(),
    rule_key text NOT NULL,
    severity text NOT NULL,
    message text NOT NULL,
    resolved_at timestamptz,
    tags jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_alert_events_ts ON alert_events (ts DESC);
"""

RAW_RETENTION_HOURS = 24
ROLLUP_RETENTION_DAYS = 90
RETENTION_INTERVAL = 3600  # seconds


def pool() -> asyncpg.Pool | None:
    return _pool


async def init_pool() -> asyncpg.Pool | None:
    """Create the connection pool and run schema migration. Returns None (history
    disabled) if credentials are unset or the DB is unreachable — callers must not
    depend on persistence being available."""
    global _pool
    if not cfg.PG_PASSWORD:
        logger.warning("Postgres credentials not configured — metrics history disabled")
        return None
    try:
        _pool = await asyncpg.create_pool(
            host=cfg.PG_HOST,
            port=cfg.PG_PORT,
            user=cfg.PG_USER,
            password=cfg.PG_PASSWORD,
            database=cfg.PG_DATABASE,
            min_size=1,
            max_size=5,
        )
        async with _pool.acquire() as conn:
            await conn.execute(_SCHEMA)
        logger.info("Postgres metrics store ready (%s@%s:%s/%s)", cfg.PG_USER, cfg.PG_HOST, cfg.PG_PORT, cfg.PG_DATABASE)
    except Exception:
        logger.warning("Failed to initialize Postgres metrics store — history disabled", exc_info=True)
        _pool = None
    return _pool


async def close_pool() -> None:
    global _pool
    if _pending_writes:
        with contextlib.suppress(Exception):
            await asyncio.gather(*_pending_writes, return_exceptions=True)
    if _pool is not None:
        await _pool.close()
        _pool = None


def _fire_and_forget(coro) -> None:
    """Schedule a write without blocking the caller (health polls / collector loops
    must not slow down waiting on Postgres round-trips)."""
    task = asyncio.create_task(coro)
    _pending_writes.add(task)
    task.add_done_callback(_pending_writes.discard)


# ── Writes ───────────────────────────────────────────────────────────────────


async def _write_metrics_batch(rows: list[tuple[str, float, dict]]) -> None:
    if _pool is None or not rows:
        return
    try:
        async with _pool.acquire() as conn:
            await conn.executemany(
                "INSERT INTO metric_samples (metric_key, value, tags) VALUES ($1, $2, $3::jsonb)",
                [(k, float(v), json.dumps(t or {})) for k, v, t in rows],
            )
    except Exception:
        logger.debug("write_metrics_batch failed", exc_info=True)


def write_metrics_batch(rows: list[tuple[str, float, dict]]) -> None:
    """Fire-and-forget batch insert of (metric_key, value, tags) rows."""
    if _pool is None or not rows:
        return
    _fire_and_forget(_write_metrics_batch(rows))


async def _write_health_sample(service_id: str, ok: bool, latency_ms: int | None, http_status: int | None) -> None:
    if _pool is None:
        return
    try:
        async with _pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO service_health_samples (service_id, ok, latency_ms, http_status) VALUES ($1, $2, $3, $4)",
                service_id, ok, latency_ms, http_status,
            )
    except Exception:
        logger.debug("write_health_sample failed for %s", service_id, exc_info=True)


def write_health_sample(service_id: str, ok: bool, latency_ms: int | None, http_status: int | None) -> None:
    if _pool is None:
        return
    _fire_and_forget(_write_health_sample(service_id, ok, latency_ms, http_status))


async def query_alert_events(since: datetime, limit: int = 200) -> list[dict]:
    if _pool is None:
        return []
    try:
        async with _pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT ts, rule_key, severity, message FROM alert_events WHERE ts >= $1 ORDER BY ts DESC LIMIT $2",
                since, limit,
            )
    except Exception:
        logger.debug("query_alert_events failed", exc_info=True)
        return []
    return [{"ts": r["ts"].isoformat(), "rule_key": r["rule_key"], "severity": r["severity"], "message": r["message"]} for r in rows]


async def record_alert_event(rule_key: str, severity: str, message: str, tags: dict | None = None) -> None:
    if _pool is None:
        return
    try:
        async with _pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO alert_events (rule_key, severity, message, tags) VALUES ($1, $2, $3, $4::jsonb)",
                rule_key, severity, message, json.dumps(tags or {}),
            )
    except Exception:
        logger.debug("record_alert_event failed for %s", rule_key, exc_info=True)


# ── Reads ────────────────────────────────────────────────────────────────────


async def query_metric_series(metric_key: str, since: datetime, tags: dict | None = None) -> list[dict]:
    """Return [{ts, value}] points from raw + 5m-rollup tables, since -> now."""
    if _pool is None:
        return []
    tags_json = json.dumps(tags) if tags is not None else None
    try:
        async with _pool.acquire() as conn:
            if tags_json is not None:
                raw = await conn.fetch(
                    "SELECT ts, value FROM metric_samples WHERE metric_key = $1 AND tags = $2::jsonb AND ts >= $3 ORDER BY ts",
                    metric_key, tags_json, since,
                )
                rollup = await conn.fetch(
                    "SELECT ts, avg_value AS value FROM metric_samples_5m "
                    "WHERE metric_key = $1 AND tags = $2::jsonb AND ts >= $3 ORDER BY ts",
                    metric_key, tags_json, since,
                )
            else:
                raw = await conn.fetch(
                    "SELECT ts, value FROM metric_samples WHERE metric_key = $1 AND ts >= $2 ORDER BY ts",
                    metric_key, since,
                )
                rollup = await conn.fetch(
                    "SELECT ts, avg_value AS value FROM metric_samples_5m WHERE metric_key = $1 AND ts >= $2 ORDER BY ts",
                    metric_key, since,
                )
    except Exception:
        logger.debug("query_metric_series failed for %s", metric_key, exc_info=True)
        return []
    points = [{"ts": r["ts"].isoformat(), "value": r["value"]} for r in (*rollup, *raw)]
    points.sort(key=lambda p: p["ts"])
    return points


async def query_service_latency_stats(service_id: str, since: datetime) -> dict:
    """p50/p95/p99/jitter + availability over the window, from persisted health samples."""
    if _pool is None:
        return {}
    try:
        async with _pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
                    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
                    percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99,
                    stddev(latency_ms) AS jitter,
                    count(*) FILTER (WHERE ok) AS ok_count,
                    count(*) AS total_count
                FROM service_health_samples
                WHERE service_id = $1 AND ts >= $2 AND latency_ms IS NOT NULL
                """,
                service_id, since,
            )
    except Exception:
        logger.debug("query_service_latency_stats failed for %s", service_id, exc_info=True)
        return {}
    if not row or not row["total_count"]:
        return {}
    return {
        "p50_ms": round(float(row["p50"] or 0), 1),
        "p95_ms": round(float(row["p95"] or 0), 1),
        "p99_ms": round(float(row["p99"] or 0), 1),
        "jitter_ms": round(float(row["jitter"] or 0), 1),
        "availability_pct": round(100 * row["ok_count"] / row["total_count"], 2),
        "sample_count": row["total_count"],
    }


async def query_incident_timeline(service_id: str | None, since: datetime) -> list[dict]:
    """Down/up transition events, derived from consecutive health samples."""
    if _pool is None:
        return []
    try:
        async with _pool.acquire() as conn:
            if service_id:
                rows = await conn.fetch(
                    "SELECT ts, service_id, ok FROM service_health_samples "
                    "WHERE service_id = $1 AND ts >= $2 ORDER BY service_id, ts",
                    service_id, since,
                )
            else:
                rows = await conn.fetch(
                    "SELECT ts, service_id, ok FROM service_health_samples WHERE ts >= $1 ORDER BY service_id, ts",
                    since,
                )
    except Exception:
        logger.debug("query_incident_timeline failed", exc_info=True)
        return []

    events: list[dict] = []
    last_ok: dict[str, bool] = {}
    for r in rows:
        sid = r["service_id"]
        prev = last_ok.get(sid)
        if prev is not None and prev != r["ok"]:
            events.append({"ts": r["ts"].isoformat(), "service_id": sid, "transition": "up" if r["ok"] else "down"})
        last_ok[sid] = r["ok"]
    return events


# ── Retention ────────────────────────────────────────────────────────────────


async def _run_retention() -> None:
    if _pool is None:
        return
    try:
        async with _pool.acquire() as conn, conn.transaction():
            await conn.execute(
                """
                INSERT INTO metric_samples_5m (ts, metric_key, tags, avg_value, min_value, max_value, sample_count)
                SELECT
                    to_timestamp(floor(extract(epoch FROM ts) / 300) * 300) AS bucket,
                    metric_key, tags, avg(value), min(value), max(value), count(*)
                FROM metric_samples
                WHERE ts < now() - make_interval(hours => $1)
                GROUP BY bucket, metric_key, tags
                ON CONFLICT (ts, metric_key, tags) DO NOTHING
                """,
                RAW_RETENTION_HOURS,
            )
            await conn.execute(
                "DELETE FROM metric_samples WHERE ts < now() - make_interval(hours => $1)", RAW_RETENTION_HOURS
            )
            await conn.execute(
                "DELETE FROM metric_samples_5m WHERE ts < now() - make_interval(days => $1)", ROLLUP_RETENTION_DAYS
            )
            await conn.execute(
                "DELETE FROM service_health_samples WHERE ts < now() - make_interval(days => $1)",
                ROLLUP_RETENTION_DAYS,
            )
        logger.info("Metrics retention pass completed")
    except Exception:
        logger.warning("Metrics retention pass failed", exc_info=True)


async def retention_loop() -> None:
    await asyncio.sleep(60)  # let the pool/schema settle before the first pass
    while True:
        await _run_retention()
        await asyncio.sleep(RETENTION_INTERVAL)
