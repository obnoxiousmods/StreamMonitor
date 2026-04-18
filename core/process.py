"""Async subprocess helpers with timeout cleanup."""

from __future__ import annotations

import asyncio
import os
import signal
from collections.abc import Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass


@dataclass(frozen=True)
class CommandResult:
    """Completed subprocess output."""

    stdout: str
    stderr: str
    returncode: int


class CommandTimeoutError(TimeoutError):
    """Raised when a subprocess exceeds its timeout and has been stopped."""

    def __init__(self, cmd: Sequence[str], timeout: float) -> None:
        super().__init__(f"command timed out after {timeout:g}s: {' '.join(cmd)}")
        self.cmd = tuple(cmd)
        self.timeout = timeout


async def _stop_process(proc: asyncio.subprocess.Process, *, grace: float) -> None:
    """Terminate a timed-out subprocess and reap it."""
    if proc.returncode is not None:
        return

    with suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGTERM)
    with suppress(ProcessLookupError, PermissionError):
        proc.terminate()

    try:
        await asyncio.wait_for(proc.wait(), timeout=grace)
        return
    except TimeoutError:
        pass

    with suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGKILL)
    with suppress(ProcessLookupError, PermissionError):
        proc.kill()
    with suppress(Exception):
        await proc.wait()


async def run_command(
    cmd: Sequence[str],
    *,
    timeout: float,
    env: Mapping[str, str] | None = None,
    cwd: str | None = None,
    kill_grace: float = 2.0,
) -> CommandResult:
    """Run a command, returning decoded output and cleaning up on timeout."""
    full_env = os.environ.copy()
    if env:
        full_env.update(env)

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=full_env,
        cwd=cwd,
        start_new_session=True,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError as exc:
        await _stop_process(proc, grace=kill_grace)
        raise CommandTimeoutError(cmd, timeout) from exc
    except asyncio.CancelledError:
        await _stop_process(proc, grace=kill_grace)
        raise

    return CommandResult(
        stdout=stdout.decode(errors="replace"),
        stderr=stderr.decode(errors="replace"),
        returncode=proc.returncode or 0,
    )
