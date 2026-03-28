"""Dmesg / kernel log endpoint."""

from __future__ import annotations

import asyncio

from starlette.requests import Request
from starlette.responses import JSONResponse


async def api_dmesg(request: Request):
    """Return recent kernel log lines via journalctl -k."""
    try:
        lines = min(int(request.query_params.get("lines", "100")), 500)
    except (ValueError, TypeError):
        lines = 100

    try:
        p = await asyncio.create_subprocess_exec(
            "sudo",
            "journalctl",
            "-k",
            "--no-pager",
            "-n",
            str(lines),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(p.communicate(), timeout=15)
        result_lines = out.decode(errors="replace").splitlines()
        if not result_lines and err:
            result_lines = [f"[journalctl] {err.decode(errors='replace').strip()}"]
        return JSONResponse({"lines": result_lines})
    except TimeoutError:
        return JSONResponse({"error": "timeout"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
