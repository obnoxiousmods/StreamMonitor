"""One-shot disk throughput benchmark, cached with a long TTL.

Used to express a process's IO read/write rate as a percent of what this disk
can actually do — a plain byte/s number doesn't tell you if a process is
saturating the disk or barely touching it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_BENCH_FILE = Path(__file__).parent.parent / "data" / ".diskbench.tmp"
_BENCH_SIZE = 64 * 1024 * 1024  # 64MB — big enough to smooth out page-cache effects
_TTL_SECONDS = 6 * 3600  # disk throughput doesn't change hour to hour; re-check occasionally

_cache: dict = {"read_bytes_s": None, "write_bytes_s": None, "ts": 0.0}
_lock = asyncio.Lock()


def _run_benchmark_sync() -> tuple[float, float]:
    _BENCH_FILE.parent.mkdir(exist_ok=True)
    chunk = os.urandom(1024 * 1024)  # random data defeats trivial compression/dedup on the fs

    t0 = time.monotonic()
    with open(_BENCH_FILE, "wb") as f:
        for _ in range(_BENCH_SIZE // len(chunk)):
            f.write(chunk)
        f.flush()
        os.fsync(f.fileno())
    write_elapsed = time.monotonic() - t0
    write_bps = _BENCH_SIZE / write_elapsed if write_elapsed > 0 else 0.0

    # Drop-caches isn't available without root; read-back will be page-cache-assisted on
    # some filesystems, which biases high — acceptable for an "estimate", not a lab result.
    t0 = time.monotonic()
    with open(_BENCH_FILE, "rb") as f:
        while f.read(4 * 1024 * 1024):
            pass
    read_elapsed = time.monotonic() - t0
    read_bps = _BENCH_SIZE / read_elapsed if read_elapsed > 0 else 0.0

    _BENCH_FILE.unlink(missing_ok=True)
    return read_bps, write_bps


async def get_disk_throughput() -> dict:
    """Returns {read_bytes_s, write_bytes_s} — cached, benchmarks lazily on first call
    and every _TTL_SECONDS after. Never blocks the caller past the first cold call."""
    now = time.time()
    if _cache["read_bytes_s"] is not None and now - _cache["ts"] < _TTL_SECONDS:
        return {"read_bytes_s": _cache["read_bytes_s"], "write_bytes_s": _cache["write_bytes_s"]}

    if _lock.locked():
        # A benchmark is already running — return the stale value rather than stack up runs.
        return {"read_bytes_s": _cache["read_bytes_s"] or 0, "write_bytes_s": _cache["write_bytes_s"] or 0}

    async with _lock:
        try:
            read_bps, write_bps = await asyncio.get_running_loop().run_in_executor(None, _run_benchmark_sync)
            _cache.update({"read_bytes_s": read_bps, "write_bytes_s": write_bps, "ts": now})
        except Exception:
            logger.warning("Disk benchmark failed", exc_info=True)
            _cache.setdefault("read_bytes_s", 0)
            _cache.setdefault("write_bytes_s", 0)
    return {"read_bytes_s": _cache["read_bytes_s"] or 0, "write_bytes_s": _cache["write_bytes_s"] or 0}
