"""Process monitor: returns top processes by CPU on demand."""

from __future__ import annotations

import asyncio
import contextlib
import time

from starlette.requests import Request
from starlette.responses import JSONResponse

try:
    import psutil

    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False


def _collect_processes() -> list[dict]:
    if not _HAS_PSUTIL:
        return []

    cpu_count = psutil.cpu_count(logical=True) or 1

    # Seed cpu_percent for all processes, then sample again after brief interval
    # so we get real deltas rather than 0.0 on first call.
    pids_first: dict[int, psutil.Process] = {}
    for p in psutil.process_iter():
        with contextlib.suppress(psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            p.cpu_percent(interval=None)  # seed baseline
            pids_first[p.pid] = p

    time.sleep(0.5)

    raw: list[dict] = []
    for p in psutil.process_iter(
        ["pid", "name", "cpu_percent", "memory_percent", "memory_info", "status", "username", "cmdline"]
    ):
        with contextlib.suppress(psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            raw.append(p.info)

    raw.sort(key=lambda x: x.get("cpu_percent") or 0.0, reverse=True)

    seen_names: set[str] = set()
    result: list[dict] = []
    for info in raw:
        name = info.get("name") or "unknown"
        if name in seen_names:
            continue
        seen_names.add(name)
        mem_info = info.get("memory_info")
        cmdline = info.get("cmdline") or []
        result.append({
            "pid": info.get("pid"),
            "name": name,
            "cpu_pct": round((info.get("cpu_percent") or 0.0) / cpu_count, 1),
            "mem_pct": round(info.get("memory_percent") or 0.0, 1),
            "mem_mb": round(mem_info.rss / 1024**2, 1) if mem_info else 0,
            "status": info.get("status", ""),
            "user": ((info.get("username") or "").split("\\")[-1])[:16],
            "cmd": " ".join(cmdline[:4])[:80] if cmdline else name,
        })
        if len(result) >= 30:
            break

    return result


async def api_processes(request: Request) -> JSONResponse:
    try:
        procs = await asyncio.get_running_loop().run_in_executor(None, _collect_processes)
        return JSONResponse({"processes": procs})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
