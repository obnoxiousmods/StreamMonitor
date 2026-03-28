"""StreamMonitor — authentication helpers."""

from __future__ import annotations

import os
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse

import core.config as cfg

# ── Auth config ───────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("MONITOR_SECRET", secrets.token_hex(32))
ph = PasswordHasher()

_HASH_FILE = cfg._KEY_FILE.parent / "monitor_pw_hash.txt"


def _load_hash() -> str:
    try:
        if _HASH_FILE.exists():
            return _HASH_FILE.read_text().strip()
    except Exception:
        pass
    return ph.hash("admin")


ADMIN_HASH: list[str] = [_load_hash()]  # mutable via list


def _save_hash(new_hash: str) -> None:
    _HASH_FILE.parent.mkdir(exist_ok=True)
    _HASH_FILE.write_text(new_hash)
    ADMIN_HASH[0] = new_hash


def logged_in(req: Request) -> bool:
    return req.session.get("user") == "admin"


def check_pw(username: str, password: str) -> bool:
    if username != "admin":
        return False
    try:
        return ph.verify(ADMIN_HASH[0], password)
    except VerifyMismatchError, Exception:
        return False


def require_auth(fn):
    async def wrapped(request: Request):
        if not logged_in(request):
            if request.url.path.startswith("/api/"):
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
            return RedirectResponse("/login", status_code=303)
        return await fn(request)

    return wrapped
