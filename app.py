#!/usr/bin/env python3
"""StreamMonitor — main application: routes, auth, Jinja2 dashboard."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates

import core.config as cfg
import core.errors as _errors
import core.health as _health
import core.logging_config  # noqa: F401 — side-effect import
import core.perms as _perms
import stats as _stats
from routes.aiostreams import api_aiostreams_analyze, api_aiostreams_test
from routes.benchmark import TITLES as BENCH_TITLES
from routes.benchmark import api_benchmark
from routes.dmesg import api_dmesg
from routes.jellyfin import api_jellyfin
from routes.public import api_public
from routes.speedtest import speedtest_download, speedtest_page

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).parent
templates = Jinja2Templates(directory=str(_BASE_DIR / "templates"))
_background_tasks: set[asyncio.Task] = set()

# ── Auth config ────────────────────────────────────────────────────────────────
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


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    task_poll = asyncio.create_task(_health.poll_loop())
    task_stats = asyncio.create_task(_stats.stats_loop())
    task_errors = asyncio.create_task(_errors.error_scan_loop())
    yield
    task_poll.cancel()
    task_stats.cancel()
    task_errors.cancel()
    with contextlib.suppress(Exception):
        await asyncio.gather(task_poll, task_stats, task_errors, return_exceptions=True)


# ── Auth helpers ──────────────────────────────────────────────────────────────
def logged_in(req: Request) -> bool:
    return req.session.get("user") == "admin"


def check_pw(username: str, password: str) -> bool:
    if username != "admin":
        return False
    try:
        return ph.verify(ADMIN_HASH[0], password)
    except (VerifyMismatchError, Exception):
        return False


def require_auth(fn):
    async def wrapped(request: Request):
        if not logged_in(request):
            if request.url.path.startswith("/api/"):
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
            return RedirectResponse("/login", status_code=303)
        return await fn(request)

    return wrapped


# ── Template context helpers ──────────────────────────────────────────────────
_UNIT_OPTS = "\n".join(
    f'<option value="{c["unit"]}">{c["name"]}</option>' for c in cfg.SERVICES.values() if c.get("unit")
)

_SPEEDTEST_CTX = {
    "speedtest_direct_url": cfg.SPEEDTEST_DIRECT_URL,
    "speedtest_direct_name": cfg.SPEEDTEST_DIRECT_NAME,
    "speedtest_cf_url": cfg.SPEEDTEST_CF_URL,
    "speedtest_cf_name": cfg.SPEEDTEST_CF_NAME,
}


# ── Routes ────────────────────────────────────────────────────────────────────


async def login(request: Request):
    err = ""
    if request.method == "POST":
        try:
            f = await request.form()
            username = str(f.get("username", ""))
            if check_pw(username, str(f.get("password", ""))):
                request.session["user"] = "admin"
                logger.info(f"Login succeeded for user {username!r} from {request.client.host}")
                return RedirectResponse("/", status_code=303)
            logger.info(f"Login failed for user {username!r} from {request.client.host}")
            err = "Invalid credentials"
        except Exception:
            err = "Login error — try again"
    error_html = f'<p class="err">{err}</p>' if err else ""
    return templates.TemplateResponse(
        request,
        "login.html",
        {"error_html": error_html} | _SPEEDTEST_CTX,
    )


async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@require_auth
async def dashboard(request: Request):
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "units_html": _UNIT_OPTS,
            "web_urls_json": json.dumps(cfg.WEB_URLS),
            "bench_titles_json": json.dumps(BENCH_TITLES),
        }
        | _SPEEDTEST_CTX,
    )


async def ping(request: Request):
    return JSONResponse({"ok": True, "ts": datetime.now(UTC).isoformat()})


@require_auth
async def api_status(request: Request):
    sid = request.path_params.get("service_id")

    def _default(s):
        return {
            "id": s,
            "name": cfg.SERVICES[s]["name"],
            "ok": None,
            "systemd": "unknown",
            "message": "pending",
            "latency_ms": None,
            "timestamp": None,
            "category": cfg.SERVICES[s].get("category", "other"),
        }

    if sid:
        if sid not in cfg.SERVICES:
            return JSONResponse({"error": "unknown"}, status_code=404)
        return JSONResponse(
            {
                "current": _health.cur.get(sid, _default(sid)),
                "history": list(_health.hist[sid]),
            }
        )
    return JSONResponse(
        {s: {"current": _health.cur.get(s, _default(s)), "history": list(_health.hist[s])} for s in cfg.SERVICES}
    )


@require_auth
async def api_stats(request: Request):
    sid = request.path_params.get("service_id")
    if sid:
        return JSONResponse(
            {
                "stats": _stats.service_stats.get(sid, {}),
                "updated_at": _stats.stats_updated_at.get(sid),
            }
        )
    return JSONResponse(_stats.service_stats)


@require_auth
async def api_versions(request: Request):
    result: dict[str, dict] = {}
    for sid in cfg.SERVICES:
        s = _stats.service_stats.get(sid, {})
        gh = _stats.github_versions.get(sid, {})
        installed = s.get("version") or s.get("addon_version") or s.get("bazarr_version") or ""
        result[sid] = {
            "installed": installed,
            "latest": gh.get("latest", ""),
            "published_at": gh.get("published_at", ""),
            "prerelease": gh.get("prerelease", False),
        }
    return JSONResponse(result)


_UNITS = {c["unit"] for c in cfg.SERVICES.values() if c.get("unit")}


@require_auth
async def api_logs(request: Request):
    unit = request.path_params["unit"]
    if unit not in _UNITS:
        return JSONResponse({"error": "not allowed"}, status_code=403)
    try:
        n = str(min(int(request.query_params.get("n", "200")), 1000))
    except (ValueError, TypeError):
        n = "200"
    try:
        p = await asyncio.create_subprocess_exec(
            "sudo",
            "journalctl",
            "-u",
            unit,
            "-n",
            n,
            "--no-pager",
            "--output=short-iso",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(p.communicate(), timeout=15)
        lines = out.decode(errors="replace").splitlines()
        if not lines and err:
            lines = [f"[journalctl] {err.decode(errors='replace').strip()}"]
        return JSONResponse({"unit": unit, "lines": lines})
    except TimeoutError:
        return JSONResponse({"error": "timeout"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@require_auth
async def api_settings_keys_get(request: Request):
    cfg.reload_keys()
    result = {}
    for k, meta in cfg.KEY_REGISTRY.items():
        attr = meta["attr"]
        val = getattr(cfg, attr, "") or ""
        result[k] = {"label": meta["label"], "value": val, "group": meta.get("group", "Other")}
    return JSONResponse(result)


@require_auth
async def api_settings_keys_post(request: Request):
    try:
        updates = await request.json()
        if not isinstance(updates, dict):
            return JSONResponse({"error": "invalid body"}, status_code=400)
        # Only allow known keys
        safe = {k: str(v) for k, v in updates.items() if k in cfg.KEY_REGISTRY}
        cfg.save_keys(safe)
        # Update live module attributes
        for k, v in safe.items():
            attr = cfg.KEY_REGISTRY[k]["attr"]
            if hasattr(cfg, attr):
                setattr(cfg, attr, v)
        logger.info(f"API keys saved: {', '.join(safe.keys())}")
        return JSONResponse({"ok": True, "updated": len(safe)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@require_auth
async def api_settings_password(request: Request):
    try:
        body = await request.json()
        cur_pw = body.get("current", "")
        new_pw = body.get("new_password", "")
        if not new_pw:
            return JSONResponse({"error": "New password required"}, status_code=400)
        if not check_pw("admin", cur_pw):
            return JSONResponse({"error": "Current password incorrect"}, status_code=403)
        new_hash = ph.hash(new_pw)
        _save_hash(new_hash)
        logger.info("Admin password changed successfully")
        return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@require_auth
async def api_perms_scan(request: Request):
    results = await asyncio.get_running_loop().run_in_executor(None, _perms.scan_perms)
    return JSONResponse({"results": results, "ts": time.time()})


@require_auth
async def api_perms_fix(request: Request):
    try:
        fixes = await request.json()
        if not isinstance(fixes, list):
            return JSONResponse({"error": "expected list"}, status_code=400)
        tasks = [
            _perms.apply_fix(f["path"], f["user"], f["group"], f["mode"], bool(f.get("recursive", False)))
            for f in fixes
            if isinstance(f, dict) and "path" in f
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        out = []
        for r in results:
            if isinstance(r, dict):
                out.append(r)
            else:
                out.append({"ok": False, "error": str(r)})
        return JSONResponse({"results": out})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@require_auth
async def api_errors(request: Request):
    if request.method == "DELETE":
        _errors.clear_errors()
        return JSONResponse({"ok": True})
    errs = list(_errors.error_history)
    return JSONResponse(
        {
            "errors": errs,
            "last_scan": _errors.last_scan_ts or None,
            "scan_count": _errors.scan_count,
            "total_errors": sum(1 for e in errs if e.get("severity") == "error"),
            "total_warnings": sum(1 for e in errs if e.get("severity") == "warning"),
        }
    )


@require_auth
async def api_errors_scan(request: Request):
    task = asyncio.create_task(_errors.scan_all())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return JSONResponse({"ok": True})


async def api_settings_keys(request: Request):
    if request.method == "GET":
        return await api_settings_keys_get(request)
    return await api_settings_keys_post(request)


@require_auth
async def api_settings_urls_get(request: Request):
    result = {}
    for k, meta in cfg.URL_REGISTRY.items():
        attr = meta["attr"]
        val = getattr(cfg, attr, "") or ""
        result[k] = {"label": meta["label"], "value": val, "group": meta.get("group", "Other")}
    return JSONResponse(result)


@require_auth
async def api_settings_urls_post(request: Request):
    try:
        updates = await request.json()
        if not isinstance(updates, dict):
            return JSONResponse({"error": "invalid body"}, status_code=400)
        # Only allow known URL keys
        safe: dict[str, str] = {}
        invalid: list[str] = []
        for k, v in updates.items():
            if k not in cfg.URL_REGISTRY:
                continue
            v = str(v).strip().rstrip("/")
            if not v:
                safe[k] = v
                continue
            if not cfg.is_valid_url(v):
                invalid.append(k)
                continue
            safe[k] = v
        if invalid:
            labels = [cfg.URL_REGISTRY[k]["label"] for k in invalid]
            return JSONResponse({"error": f"Invalid URL(s): {', '.join(labels)}"}, status_code=400)
        cfg.save_urls(safe)
        return JSONResponse({"ok": True, "updated": len(safe)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def api_settings_urls(request: Request):
    if request.method == "GET":
        return await api_settings_urls_get(request)
    return await api_settings_urls_post(request)


# ── Service control ────────────────────────────────────────────────────────────
_ALLOWED_UNITS = {c["unit"] for c in cfg.SERVICES.values() if c.get("unit")}


@require_auth
async def api_service_action(request: Request):
    unit = request.path_params["unit"]
    action = request.path_params["action"]
    if unit not in _ALLOWED_UNITS:
        return JSONResponse({"error": "unit not allowed"}, status_code=403)
    if action not in ("start", "stop", "restart"):
        return JSONResponse({"error": "invalid action"}, status_code=400)
    try:
        p = await asyncio.create_subprocess_exec(
            "sudo",
            "systemctl",
            action,
            unit,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _out, err = await asyncio.wait_for(p.communicate(), timeout=30)
        if p.returncode == 0:
            logger.info(f"Service action {action} on unit {unit} succeeded")
            return JSONResponse({"ok": True})
        err_msg = err.decode().strip()[:200]
        logger.warning(f"Service action {action} on unit {unit} failed: {err_msg}")
        return JSONResponse({"error": err.decode().strip()[:300]}, status_code=500)
    except TimeoutError:
        return JSONResponse({"error": "systemctl timed out"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── App ───────────────────────────────────────────────────────────────────────
app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/login", login, methods=["GET", "POST"]),
        Route("/logout", logout),
        Route("/", dashboard),
        Route("/api/ping", ping),
        Route("/api/status", api_status),
        Route("/api/status/{service_id}", api_status),
        Route("/api/stats", api_stats),
        Route("/api/stats/{service_id}", api_stats),
        Route("/api/versions", api_versions),
        Route("/api/logs/{unit}", api_logs),
        Route("/api/service/{unit}/{action}", api_service_action, methods=["POST"]),
        Route("/api/perms/scan", api_perms_scan, methods=["POST"]),
        Route("/api/perms/fix", api_perms_fix, methods=["POST"]),
        Route("/api/errors", api_errors, methods=["GET", "DELETE"]),
        Route("/api/errors/scan", api_errors_scan, methods=["POST"]),
        Route("/api/settings/keys", api_settings_keys, methods=["GET", "POST"]),
        Route("/api/settings/urls", api_settings_urls, methods=["GET", "POST"]),
        Route("/api/settings/password", api_settings_password, methods=["POST"]),
        Route("/api/benchmark", require_auth(api_benchmark)),
        Route("/api/jellyfin", require_auth(api_jellyfin)),
        Route("/api/dmesg", require_auth(api_dmesg)),
        Route("/api/aiostreams/analyze", require_auth(api_aiostreams_analyze)),
        Route("/api/aiostreams/test", require_auth(api_aiostreams_test), methods=["POST"]),
        Route("/api/public", api_public),
        Route("/speedtest", require_auth(speedtest_page)),
        Route("/speedtest/download", speedtest_download),
        Mount("/static", StaticFiles(directory=str(_BASE_DIR / "static")), name="static"),
    ],
    middleware=[Middleware(SessionMiddleware, secret_key=SECRET_KEY, max_age=86400)],
)
