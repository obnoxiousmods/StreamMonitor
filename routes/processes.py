"""Process monitor: returns top processes on demand."""

from __future__ import annotations

import asyncio

from starlette.requests import Request
from starlette.responses import JSONResponse

from stats.process_metrics import collect_process_lists


async def api_processes(request: Request) -> JSONResponse:
    try:
        proc_lists = await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: collect_process_lists(
                cpu_limit=15,
                memory_limit=15,
                process_limit=50,
                refresh_interval=0.35,
            ),
        )
        return JSONResponse(
            {
                "processes": proc_lists["processes"],
                "top_cpu": proc_lists["top_cpu"],
                "top_memory": proc_lists["top_memory"],
            }
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
