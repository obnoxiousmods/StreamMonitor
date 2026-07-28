"""Process explorer: full per-process CPU/RAM/IO/GPU/network table on demand."""

from __future__ import annotations

import asyncio

from starlette.requests import Request
from starlette.responses import JSONResponse

import stats as _stats
from stats.conntrack import get_pid_network_snapshot
from stats.diskbench import get_disk_throughput
from stats.process_metrics import collect_process_lists


def _gpu_by_pid() -> dict[int, dict]:
    gpu = (_stats.service_stats.get("system") or {}).get("gpu") or {}
    out: dict[int, dict] = {}
    for proc in gpu.get("processes") or []:
        pid = proc.get("pid")
        if isinstance(pid, int):
            out[pid] = {
                "gpu_memory_mb": proc.get("used_memory_mb"),
                "gpu_sm_pct": proc.get("sm_pct"),
                "gpu_mem_pct": proc.get("mem_pct"),
                "gpu_enc_pct": proc.get("enc_pct"),
                "gpu_dec_pct": proc.get("dec_pct"),
            }
    return out


def _pct_of(rate: float, max_rate: float) -> float | None:
    if not max_rate:
        return None
    return round(min(100.0, rate / max_rate * 100), 1)


async def api_processes(request: Request) -> JSONResponse:
    try:
        proc_lists, disk_bench = await asyncio.gather(
            asyncio.get_running_loop().run_in_executor(
                None,
                lambda: collect_process_lists(
                    cpu_limit=15,
                    memory_limit=15,
                    process_limit=2000,
                    refresh_interval=0.35,
                ),
            ),
            get_disk_throughput(),
        )
        gpu_by_pid = _gpu_by_pid()
        net_by_pid = get_pid_network_snapshot()
        max_read = disk_bench.get("read_bytes_s") or 0
        max_write = disk_bench.get("write_bytes_s") or 0

        for proc in proc_lists["processes"]:
            gpu = gpu_by_pid.get(proc["pid"])
            if gpu:
                proc.update(gpu)
            net = net_by_pid.get(proc["pid"])
            if net:
                proc["net_rate_bytes_s"] = net["rate_bytes_s"]
                proc["net_sent_bytes_s"] = net["sent_bytes"]
                proc["net_recv_bytes_s"] = net["recv_bytes"]
            proc["io_read_pct"] = _pct_of(proc["io_read_bytes_s"], max_read)
            proc["io_write_pct"] = _pct_of(proc["io_write_bytes_s"], max_write)

        return JSONResponse(
            {
                "processes": proc_lists["processes"],
                "top_cpu": proc_lists["top_cpu"],
                "top_memory": proc_lists["top_memory"],
                "gpu_process_count": len(gpu_by_pid),
                "net_mapped_process_count": len(net_by_pid),
                "disk_benchmark": disk_bench,
            }
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
