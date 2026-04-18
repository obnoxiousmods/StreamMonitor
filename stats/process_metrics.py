"""Shared process metrics for the system card and process modal."""

from __future__ import annotations

import contextlib
import threading
import time

try:
    import psutil

    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False

_SAMPLE_LOCK = threading.Lock()
_PREV_SAMPLE_AT = 0.0
_PREV_CPU_TIMES: dict[int, tuple[float, float | None]] = {}


def _cpu_seconds(cpu_times: object) -> float:
    return float(getattr(cpu_times, "user", 0.0) or 0.0) + float(getattr(cpu_times, "system", 0.0) or 0.0)


def _format_user(username: object, length: int = 16) -> str:
    return str(username or "").split("\\")[-1][:length]


def _format_cmd(cmdline: object, name: str, length: int = 180) -> str:
    if isinstance(cmdline, list) and cmdline:
        return " ".join(str(part) for part in cmdline)[:length]
    return name


def _read_process_rows() -> list[dict]:
    if not _HAS_PSUTIL:
        return []

    now = time.monotonic()
    cpu_count = psutil.cpu_count(logical=True) or 1
    rows: list[dict] = []
    next_cpu_times: dict[int, tuple[float, float | None]] = {}

    attrs = [
        "pid",
        "name",
        "cpu_times",
        "memory_percent",
        "memory_info",
        "status",
        "username",
        "cmdline",
        "create_time",
        "num_threads",
    ]
    for proc in psutil.process_iter(attrs):
        with contextlib.suppress(psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            info = proc.info
            pid = info.get("pid")
            if not isinstance(pid, int):
                continue

            name = info.get("name") or "unknown"
            cpu_time = _cpu_seconds(info.get("cpu_times"))
            create_time = info.get("create_time")
            memory_info = info.get("memory_info")
            rss_mb = round(memory_info.rss / 1024**2, 1) if memory_info else 0.0
            next_cpu_times[pid] = (cpu_time, create_time)
            rows.append(
                {
                    "pid": pid,
                    "name": name,
                    "cpu_time": cpu_time,
                    "create_time": create_time,
                    "cpu_pct": 0.0,
                    "cpu_total_pct": 0.0,
                    "mem_pct": round(info.get("memory_percent") or 0.0, 1),
                    "mem_mb": rss_mb,
                    "status": info.get("status", ""),
                    "user": _format_user(info.get("username")),
                    "threads": info.get("num_threads") or 0,
                    "cmd": _format_cmd(info.get("cmdline"), name),
                }
            )

    global _PREV_SAMPLE_AT, _PREV_CPU_TIMES
    with _SAMPLE_LOCK:
        elapsed = now - _PREV_SAMPLE_AT if _PREV_SAMPLE_AT > 0 else 0.0
        prev_cpu_times = _PREV_CPU_TIMES
        _PREV_SAMPLE_AT = now
        _PREV_CPU_TIMES = next_cpu_times

    if elapsed <= 0:
        return rows

    for row in rows:
        prev = prev_cpu_times.get(row["pid"])
        if not prev:
            continue
        prev_cpu_time, prev_create_time = prev
        if row["create_time"] and prev_create_time and row["create_time"] != prev_create_time:
            continue
        cpu_delta = max(0.0, row["cpu_time"] - prev_cpu_time)
        core_pct = (cpu_delta / elapsed) * 100
        row["cpu_pct"] = round(core_pct, 1)
        row["cpu_total_pct"] = round(core_pct / cpu_count, 1)

    return rows


def collect_process_lists(
    *,
    cpu_limit: int = 10,
    memory_limit: int = 10,
    process_limit: int = 50,
    refresh_interval: float = 0.0,
) -> dict[str, list[dict]]:
    """Return per-PID process lists sorted by CPU and resident RAM."""
    if refresh_interval > 0:
        _read_process_rows()
        time.sleep(refresh_interval)

    rows = _read_process_rows()
    top_cpu = sorted(rows, key=lambda row: (row.get("cpu_pct") or 0.0, row.get("mem_mb") or 0.0), reverse=True)
    top_memory = sorted(rows, key=lambda row: (row.get("mem_mb") or 0.0, row.get("cpu_pct") or 0.0), reverse=True)
    return {
        "top_cpu": top_cpu[:cpu_limit],
        "top_memory": top_memory[:memory_limit],
        "processes": top_cpu[:process_limit],
    }
