"""Dmesg / kernel log endpoint."""

from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse

from core.process import CommandTimeoutError, run_command


async def api_dmesg(request: Request):
    """Return recent kernel log lines via journalctl -k."""
    try:
        lines = min(int(request.query_params.get("lines", "100")), 500)
    except (ValueError, TypeError):
        lines = 100

    try:
        result = await run_command(["sudo", "journalctl", "-k", "--no-pager", "-n", str(lines)], timeout=15)
        result_lines = result.stdout.splitlines()
        if not result_lines and result.stderr:
            result_lines = [f"[journalctl] {result.stderr.strip()}"]
        return JSONResponse({"lines": result_lines})
    except CommandTimeoutError:
        return JSONResponse({"error": "timeout"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
