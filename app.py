#!/usr/bin/env python3
"""StreamMonitor main application: Starlette API and React dashboard."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import secrets
import subprocess
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from starlette.applications import Starlette
from starlette.datastructures import MutableHeaders
from starlette.middleware import Middleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

import core.config as cfg
import core.errors as _errors
import core.health as _health
import core.logging_config  # noqa: F401 — side-effect import
import core.perms as _perms
import stats as _stats
from core.process import CommandTimeoutError, run_command
from routes.aiostreams import api_aiostreams_analyze, api_aiostreams_test
from routes.benchmark import TITLES as BENCH_TITLES
from routes.benchmark import api_benchmark
from routes.dmesg import api_dmesg
from routes.jellyfin import api_jellyfin
from routes.mediafusion import api_mediafusion_analyze, api_mediafusion_metrics
from routes.packages import api_packages
from routes.processes import api_processes
from routes.public import api_public
from routes.speedtest import speedtest_download

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).parent
_SPA_INDEX = _BASE_DIR / "static" / "app" / "index.html"
_background_tasks: set[asyncio.Task] = set()


def _configured_public_origin() -> str:
    origin = os.environ.get("MONITOR_PUBLIC_ORIGIN", "https://monitor.obby.ca").strip().rstrip("/")
    if not origin:
        return "https://monitor.obby.ca"
    if "://" not in origin:
        return f"https://{origin}"
    return origin


PUBLIC_ORIGIN = _configured_public_origin()


def _public_url(path: str = "") -> str:
    if not path:
        return PUBLIC_ORIGIN
    suffix = path if path.startswith("/") else f"/{path}"
    return f"{PUBLIC_ORIGIN}{suffix}"


def _static_version() -> str:
    versioned = [
        *(_BASE_DIR / "static" / "app").glob("**/*"),
        *(_BASE_DIR / "static" / "js").glob("*.js"),
        *(_BASE_DIR / "static" / "css").glob("*.css"),
        *(_BASE_DIR / "templates").glob("*.html"),
    ]
    try:
        mtime_version = str(max(int(path.stat().st_mtime) for path in versioned))
    except Exception:
        mtime_version = str(int(time.time()))

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=_BASE_DIR,
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return f"{result.stdout.strip()}-{mtime_version}"
    except Exception:
        pass

    return mtime_version


STATIC_VERSION = _static_version()

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


def _spa_response() -> FileResponse | HTMLResponse:
    if _SPA_INDEX.exists():
        return FileResponse(_SPA_INDEX)
    return HTMLResponse(
        (
            "<!doctype html><title>StreamMonitor</title>"
            "<p>React frontend has not been built. Run <code>npm run build</code>.</p>"
        ),
        status_code=503,
    )


def _public_config() -> dict:
    return {
        "speedtest": {
            "direct_url": cfg.SPEEDTEST_DIRECT_URL,
            "direct_name": cfg.SPEEDTEST_DIRECT_NAME,
            "cf_url": cfg.SPEEDTEST_CF_URL,
            "cf_name": cfg.SPEEDTEST_CF_NAME,
        }
    }


def _bootstrap_config() -> dict:
    return {
        **_public_config(),
        "categories": cfg.CATEGORIES,
        "web_urls": cfg.WEB_URLS,
        "bench_titles": BENCH_TITLES,
        "services": {
            sid: {
                "id": sid,
                "name": svc.get("name", sid),
                "unit": svc.get("unit"),
                "category": svc.get("category", "other"),
                "has_http": bool(svc.get("url")),
                "web_url": cfg.WEB_URLS.get(sid, ""),
            }
            for sid, svc in cfg.SERVICES.items()
        },
        "log_units": [
            {"id": sid, "name": svc.get("name", sid), "unit": svc.get("unit")}
            for sid, svc in cfg.SERVICES.items()
            if svc.get("unit")
        ],
    }


# ── Cache policy ─────────────────────────────────────────────────────────────
class CacheHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        async def send_with_cache_headers(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if path in {"/robots.txt", "/sitemap.xml"}:
                    headers["Cache-Control"] = "public, max-age=3600"
                elif path.startswith("/api/") or path in {"/", "/login", "/logout", "/speedtest"}:
                    headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
                    headers["Pragma"] = "no-cache"
                    headers["Expires"] = "0"
                elif path.startswith("/static/"):
                    headers["Cache-Control"] = "public, max-age=31536000, immutable"
            await send(message)

        await self.app(scope, receive, send_with_cache_headers)


# ── Routes ────────────────────────────────────────────────────────────────────


async def robots_txt(request: Request):
    return PlainTextResponse(
        "\n".join(
            [
                "User-agent: *",
                "Allow: /",
                "Disallow: /api/",
                "Disallow: /logout",
                "Disallow: /speedtest/download",
                f"Sitemap: {_public_url('/sitemap.xml')}",
                "",
            ]
        )
    )


async def sitemap_xml(request: Request):
    lastmod = datetime.now(UTC).date().isoformat()
    urls = [
        ("/", "1.0"),
    ]
    entries = "\n".join(
        (
            "  <url>\n"
            f"    <loc>{xml_escape(_public_url(path))}</loc>\n"
            f"    <lastmod>{lastmod}</lastmod>\n"
            "    <changefreq>daily</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            "  </url>"
        )
        for path, priority in urls
    )
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{entries}\n"
        "</urlset>\n"
    )
    return Response(body, media_type="application/xml")


async def login(request: Request):
    if request.method == "POST":
        try:
            f = await request.form()
            username = str(f.get("username", ""))
            if check_pw(username, str(f.get("password", ""))):
                request.session["user"] = "admin"
                logger.info(f"Login succeeded for user {username!r} from {request.client.host}")
                return RedirectResponse("/", status_code=303)
            logger.info(f"Login failed for user {username!r} from {request.client.host}")
        except Exception:
            pass
    return _spa_response()


async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


async def dashboard(request: Request):
    return _spa_response()


@require_auth
async def speedtest_spa(request: Request):
    return _spa_response()


async def ping(request: Request):
    return JSONResponse({"ok": True, "ts": datetime.now(UTC).isoformat()})


async def api_public_config(request: Request):
    return JSONResponse(_public_config())


async def api_auth_session(request: Request):
    return JSONResponse({"authenticated": logged_in(request), "user": "admin" if logged_in(request) else None})


async def api_auth_login(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    username = str(body.get("username", ""))
    password = str(body.get("password", ""))
    if check_pw(username, password):
        request.session["user"] = "admin"
        logger.info("Login succeeded for user %r from %s", username, request.client.host if request.client else "?")
        return JSONResponse({"ok": True})
    logger.info("Login failed for user %r from %s", username, request.client.host if request.client else "?")
    return JSONResponse({"ok": False, "error": "Invalid credentials"}, status_code=401)


async def api_auth_logout(request: Request):
    request.session.clear()
    return JSONResponse({"ok": True})


@require_auth
async def api_bootstrap(request: Request):
    return JSONResponse(_bootstrap_config())


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
                "meta": _stats.stats_meta.get(sid, {}),
            }
        )
    return JSONResponse(_stats.service_stats)


@require_auth
async def api_stats_meta(request: Request):
    return JSONResponse(_stats.stats_meta)


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
    except ValueError, TypeError:
        n = "200"
    try:
        result = await run_command(
            ["sudo", "journalctl", "-u", unit, "-n", n, "--no-pager", "--output=short-iso"],
            timeout=15,
        )
        lines = result.stdout.splitlines()
        if not lines and result.stderr:
            lines = [f"[journalctl] {result.stderr.strip()}"]
        return JSONResponse({"unit": unit, "lines": lines})
    except CommandTimeoutError:
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
        result = await run_command(["sudo", "systemctl", action, unit], timeout=30)
        if result.returncode == 0:
            logger.info(f"Service action {action} on unit {unit} succeeded")
            return JSONResponse({"ok": True})
        err_msg = result.stderr.strip()[:200]
        logger.warning(f"Service action {action} on unit {unit} failed: {err_msg}")
        return JSONResponse({"error": result.stderr.strip()[:300]}, status_code=500)
    except CommandTimeoutError:
        return JSONResponse({"error": "systemctl timed out"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── App ───────────────────────────────────────────────────────────────────────
app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/robots.txt", robots_txt),
        Route("/sitemap.xml", sitemap_xml),
        Route("/login", login, methods=["GET", "POST"]),
        Route("/logout", logout),
        Route("/", dashboard),
        Route("/api/ping", ping),
        Route("/api/public-config", api_public_config),
        Route("/api/bootstrap", api_bootstrap),
        Route("/api/auth/session", api_auth_session),
        Route("/api/auth/login", api_auth_login, methods=["POST"]),
        Route("/api/auth/logout", api_auth_logout, methods=["POST"]),
        Route("/api/status", api_status),
        Route("/api/status/{service_id}", api_status),
        Route("/api/stats", api_stats),
        Route("/api/stats/meta", api_stats_meta),
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
        Route("/api/packages", require_auth(api_packages)),
        Route("/api/processes", require_auth(api_processes)),
        Route("/api/aiostreams/analyze", require_auth(api_aiostreams_analyze)),
        Route("/api/aiostreams/test", require_auth(api_aiostreams_test), methods=["POST"]),
        Route("/api/mediafusion/metrics", require_auth(api_mediafusion_metrics)),
        Route("/api/mediafusion/analyze", require_auth(api_mediafusion_analyze)),
        Route("/api/public", api_public),
        Route("/speedtest", speedtest_spa),
        Route("/speedtest/download", speedtest_download),
        Mount("/static", StaticFiles(directory=str(_BASE_DIR / "static")), name="static"),
    ],
    middleware=[
        Middleware(CacheHeadersMiddleware),
        Middleware(SessionMiddleware, secret_key=SECRET_KEY, max_age=86400),
    ],
)
