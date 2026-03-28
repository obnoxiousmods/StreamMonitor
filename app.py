#!/usr/bin/env python3
"""StreamMonitor — main application: routes, auth, HTML dashboard."""
from __future__ import annotations

import asyncio
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse
from starlette.routing import Route

import config as cfg
import health as _health
import stats as _stats
import errors as _errors
import perms as _perms

from routes.benchmark import api_benchmark, TITLES as BENCH_TITLES
from routes.jellyfin import api_jellyfin
from routes.speedtest import speedtest_page, speedtest_download
from routes.public import api_public
from routes.dmesg import api_dmesg

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
    task_poll   = asyncio.create_task(_health.poll_loop())
    task_stats  = asyncio.create_task(_stats.stats_loop())
    task_errors = asyncio.create_task(_errors.error_scan_loop())
    yield
    task_poll.cancel()
    task_stats.cancel()
    task_errors.cancel()
    try:
        await asyncio.gather(task_poll, task_stats, task_errors, return_exceptions=True)
    except Exception:
        pass


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


# ── Dashboard HTML ─────────────────────────────────────────────────────────────
_UNIT_OPTS = "\n".join(
    f'<option value="{c["unit"]}">{c["name"]}</option>'
    for c in cfg.SERVICES.values() if c.get("unit")
)

DASH = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>StreamMonitor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0c14;color:#e2e8f0;font-family:system-ui,sans-serif;font-size:14px}
:root{--border:#1e2235;--card:#111422;--card2:#0f1220;--accent:#6366f1;--accent2:#818cf8;--ok:#34d399;--ok-bg:#022c22;--warn:#fbbf24;--warn-bg:#2d1f00;--err:#f87171;--err-bg:#3b0404;--muted:#64748b;--muted2:#475569}
header{background:#0d1025;border-bottom:1px solid var(--border);padding:.7rem 1.4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;position:sticky;top:0;z-index:100}
header h1{font-size:1rem;color:var(--accent2);font-weight:700;letter-spacing:.02em;white-space:nowrap}
.hdr-mid{display:flex;gap:1.2rem;align-items:center;flex:1;justify-content:center}
.hdr-stat{text-align:center;line-height:1.2}
.hdr-stat .val{font-size:1.1rem;font-weight:700;color:var(--accent2)}
.hdr-stat .lbl{font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.hdr-stat.ok .val{color:var(--ok)}.hdr-stat.warn .val{color:var(--warn)}.hdr-stat.err .val{color:var(--err)}
.hdr-right{display:flex;gap:.6rem;align-items:center;white-space:nowrap}
a.so,button.so{color:var(--muted);font-size:.78rem;text-decoration:none;padding:.25rem .55rem;border-radius:5px;border:1px solid var(--border);background:none;cursor:pointer}
a.so:hover,button.so:hover{color:#e2e8f0;border-color:#4b5563}
.tabs{display:flex;gap:.3rem;padding:.5rem 1.4rem 0;border-bottom:1px solid var(--border);background:#0d1025}
.tab{padding:.3rem .7rem;border-radius:6px 6px 0 0;font-size:.78rem;cursor:pointer;color:var(--muted);background:none;border:1px solid transparent}
.tab.active{background:var(--card);color:#e2e8f0;border-color:var(--border);border-bottom-color:var(--card)}
.tab:hover:not(.active){color:#c4cde2}
.panel{display:none;padding:1rem 1.4rem}.panel.active{display:block}
.cat-hdr{font-size:.7rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin:.9rem 0 .4rem;border-bottom:1px solid var(--border);padding-bottom:.3rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:.7rem}
.grid.sys-grid{grid-template-columns:1fr}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:.85rem;transition:border-color .2s}
.card.up{border-left:3px solid var(--ok)}.card.dn{border-left:3px solid var(--err)}.card.pend{border-left:3px solid var(--muted)}
.card:hover{border-color:#2d334f}
.ct{font-weight:600;font-size:.88rem;display:flex;align-items:center;gap:.45rem;line-height:1.4}
.badge{font-size:.62rem;padding:.1rem .38rem;border-radius:999px;font-weight:700}
.badge.up{background:var(--ok-bg);color:var(--ok)}.badge.dn{background:var(--err-bg);color:var(--err)}.badge.pend{background:#1e2235;color:var(--muted)}
.lat{font-size:.68rem;color:var(--muted);margin-left:auto}
.meta{font-size:.72rem;color:var(--muted);margin-top:.25rem;line-height:1.5}
.sbox{margin:.5rem 0 .4rem;border-radius:6px;background:var(--card2);border:1px solid var(--border);padding:.45rem .55rem}
.srow{display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.2rem}.srow:last-child{margin-bottom:0}
.kv{display:flex;flex-direction:column;align-items:center;background:#0a0c14;border-radius:5px;padding:.25rem .45rem;min-width:52px;text-align:center;border:1px solid var(--border)}
.kv .vv{font-size:.82rem;font-weight:700;color:#c4d2f0;line-height:1.2}
.kv .kk{font-size:.6rem;color:var(--muted);margin-top:.1rem;white-space:nowrap}
.kv.ok .vv{color:var(--ok)}.kv.warn .vv{color:var(--warn)}.kv.err .vv{color:var(--err)}.kv.blue .vv{color:var(--accent2)}
.health-err{font-size:.68rem;color:var(--err);margin-top:.2rem;line-height:1.4}
.np{font-size:.68rem;color:var(--ok);margin-top:.2rem;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ── System card ── */
.sys-panels{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.5rem;margin-top:.3rem}
.sys-sec{background:#0a0c14;border:1px solid var(--border);border-radius:6px;padding:.5rem .65rem}
.sys-ttl{font-size:.62rem;color:var(--accent2);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem}
.sys-r{display:flex;justify-content:space-between;align-items:center;font-size:.72rem;padding:.1rem 0;border-bottom:1px solid #1a1f35}
.sys-r:last-child{border-bottom:none}
.sys-r .sk{color:var(--muted)}.sys-r .sv{color:#c4d2f0;font-weight:600}
.sv.ok{color:var(--ok)}.sv.warn{color:var(--warn)}.sv.err{color:var(--err)}
.disk-item{padding:.2rem 0;border-bottom:1px solid #1a1f35}.disk-item:last-child{border-bottom:none}
.disk-lbl{font-size:.68rem;color:var(--muted2);margin-bottom:.1rem;display:flex;justify-content:space-between}
.dbar{height:4px;background:#1a1f35;border-radius:2px;overflow:hidden}
.dbar-f{height:100%;border-radius:2px;background:var(--ok)}.dbar-f.warn{background:var(--warn)}.dbar-f.err{background:var(--err)}
/* ── Version ── */
.ver-row{display:flex;align-items:center;gap:.35rem;margin-top:.35rem;flex-wrap:wrap}
.ver-tag{font-size:.65rem;padding:.1rem .35rem;border-radius:4px;font-family:monospace}
.ver-tag.inst{background:#1a2035;color:#94a3b8;border:1px solid var(--border)}
.ver-tag.latest{background:#12232a;color:#67e8f9;border:1px solid #164e63}
.ver-tag.outdated{background:#2d1600;color:var(--warn);border:1px solid #78350f}
.ver-tag.uptodate{background:var(--ok-bg);color:var(--ok);border:1px solid #065f46}
/* ── History bar ── */
.bar{display:flex;gap:1.5px;margin-top:.45rem}
.bar span{flex:1;height:5px;border-radius:1px}
.bar .ok{background:var(--ok)}.bar .er{background:var(--err)}.bar .x{background:#1a1f35}
/* ── Logs ── */
#ts{font-size:.68rem;color:var(--muted2);padding:0 0 .5rem}
.toolbar{display:flex;gap:.5rem;align-items:center;margin-bottom:.7rem;flex-wrap:wrap}
select,input[type=text],input[type=password],button.sm,textarea{background:var(--card);border:1px solid var(--border);color:#e2e8f0;padding:.3rem .6rem;border-radius:6px;font-size:.78rem;cursor:pointer}
select{min-width:160px}textarea{width:100%;resize:vertical;font-family:monospace;cursor:auto}
select:focus,input:focus,button.sm:focus,textarea:focus{outline:none;border-color:var(--accent)}
button.sm:hover{background:#1a1f35}
.log-status{font-size:.72rem;color:var(--muted);margin-left:auto}
#logbox{background:#050710;font-family:monospace;font-size:.72rem;color:#94a3b8;padding:.85rem;border-radius:8px;height:500px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;border:1px solid var(--border)}
.le{color:var(--err)}.lw{color:var(--warn)}
/* ── Settings ── */
.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;align-items:start;margin-top:.5rem}
@media(max-width:900px){.settings-grid{grid-template-columns:1fr}}
.settings-sec{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1rem}
.settings-sec h3{font-size:.72rem;color:var(--accent2);margin-bottom:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.key-group{margin-bottom:.8rem}
.key-group-label{font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-weight:700;padding:.15rem 0 .35rem;border-bottom:1px solid var(--border);margin-bottom:.4rem}
.key-row{display:flex;align-items:center;gap:.4rem;margin-bottom:.28rem}
.key-row label{width:148px;flex-shrink:0;font-size:.7rem;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.key-input-wrap{flex:1;display:flex;gap:.22rem;align-items:center;min-width:0}
.key-input-wrap input{flex:1;min-width:0;font-size:.68rem;padding:.2rem .4rem;font-family:monospace}
.key-input-wrap input.changed{border-color:var(--warn)!important;box-shadow:0 0 0 2px #78350f44}
.key-btn{background:none;border:1px solid var(--border);color:var(--muted);padding:.16rem .34rem;border-radius:4px;font-size:.68rem;cursor:pointer;flex-shrink:0;line-height:1.2}
.key-btn:hover{color:#e2e8f0;border-color:#475569}
.pw-form{display:flex;flex-direction:column;gap:.6rem}
.pw-form>div label{display:block;font-size:.7rem;color:#94a3b8;margin-bottom:.2rem}
.pw-form>div input{width:100%;font-size:.78rem;padding:.3rem .55rem}
.btn-save{background:var(--accent);color:#fff;border:none;border-radius:6px;padding:.35rem .9rem;font-size:.78rem;cursor:pointer;font-weight:600;margin-top:.3rem}
.btn-save:hover{background:#4f46e5}
.msg-ok{color:var(--ok);font-size:.72rem;margin-top:.4rem}
.msg-err{color:var(--err);font-size:.72rem;margin-top:.4rem}
/* ── Perms ── */
.perm-table{width:100%;border-collapse:collapse;font-size:.72rem}
.perm-table th{font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;padding:.3rem .5rem;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
.perm-table td{padding:.28rem .5rem;border-bottom:1px solid #13172a;vertical-align:middle}
.perm-table tr.ok-row td{color:var(--muted2)}
.perm-table tr.bad-row td{color:#e2e8f0}
.perm-table tr.missing-row td{color:var(--muted);font-style:italic}
.perm-table tr:hover td{background:#0d1025}
.perm-table tr.perm-section-hdr td{background:#0a0e1f;color:var(--accent2);padding:.35rem .5rem;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;border-top:1px solid var(--border)}
.perm-ok{color:var(--ok);font-weight:700}
.perm-bad{color:var(--warn);font-weight:700}
.perm-miss{color:var(--muted)}
.perm-diff{color:var(--warn);text-decoration:underline dotted}
.perm-fix-row{display:flex;gap:.6rem;align-items:center;margin:.75rem 0;flex-wrap:wrap;padding:.6rem;background:var(--card);border:1px solid var(--border);border-radius:8px}
.perm-fix-row label{font-size:.68rem;color:var(--muted);display:flex;flex-direction:column;gap:.15rem}
.perm-fix-row input{width:90px;font-size:.72rem;padding:.2rem .4rem;font-family:monospace}
.perm-sel-count{font-size:.68rem;color:var(--accent2)}
/* ── Errors ── */
.err-row{display:flex;gap:.5rem;align-items:flex-start;padding:.3rem .4rem;border-bottom:1px solid #13172a;cursor:pointer}
.err-row:hover{background:#0d1025}
.err-row.error .err-sev{color:var(--err)}
.err-row.warning .err-sev{color:var(--warn)}
.err-row.info .err-sev{color:var(--muted)}
.err-sev{font-size:.62rem;font-weight:700;width:46px;flex-shrink:0;padding-top:.1rem;text-transform:uppercase}
.err-svc{font-size:.62rem;color:var(--accent2);width:76px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-top:.1rem}
.err-ts{font-size:.6rem;color:var(--muted);width:135px;flex-shrink:0;padding-top:.1rem}
.err-line{flex:1;color:#cbd5e1;word-break:break-all;white-space:pre-wrap;font-size:.7rem}
.err-expand{display:none;padding:.2rem .4rem .4rem 165px;font-size:.68rem;color:var(--muted);word-break:break-all;white-space:pre-wrap}
.err-row.expanded+.err-expand{display:block}
/* ── API docs ── */
code{background:var(--card2);padding:.1rem .35rem;border-radius:3px;font-size:.75rem;font-family:monospace;border:1px solid var(--border)}
.api-row{margin-bottom:.4rem;line-height:2}
.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--border);border-top-color:var(--accent2);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:600px){.hdr-mid{display:none}.grid{grid-template-columns:1fr}}
/* ── Card interactive ── */
.card{cursor:pointer;position:relative}
.card:hover{border-color:#3d4460}
.card-acts{position:absolute;top:.45rem;right:.45rem;display:none;gap:.2rem;z-index:2}
.card:hover .card-acts{display:flex}
.card-act{background:rgba(10,12,22,.9);border:1px solid var(--border);color:var(--muted);padding:.18rem .38rem;border-radius:4px;font-size:.68rem;cursor:pointer;line-height:1.3;backdrop-filter:blur(6px);white-space:nowrap}
.card-act:hover{color:#e2e8f0;border-color:var(--accent2)}
.card-act.danger:hover{color:var(--err);border-color:var(--err)}
/* ── Service modal ── */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .18s;padding:1rem}
.modal-overlay.open{opacity:1;pointer-events:all}
.modal{background:#0f1220;border:1px solid var(--border);border-radius:12px;width:min(820px,96vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.6);transform:translateY(10px);transition:transform .18s}
.modal-overlay.open .modal{transform:translateY(0)}
.modal-hdr{display:flex;align-items:center;gap:.6rem;padding:.75rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0;background:#0d1025}
.modal-title{font-size:.95rem;font-weight:700;color:#e2e8f0;flex:1;display:flex;align-items:center;gap:.5rem;min-width:0}
.modal-url{font-size:.65rem;color:var(--accent2);text-decoration:none;border:1px solid #1e2a50;border-radius:4px;padding:.1rem .4rem;margin-left:.3rem;white-space:nowrap}
.modal-url:hover{border-color:var(--accent2)}
.modal-close{background:none;border:1px solid var(--border);color:var(--muted);width:26px;height:26px;border-radius:5px;cursor:pointer;font-size:.85rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.modal-close:hover{color:#e2e8f0;border-color:#6b7280}
.modal-meta{font-size:.65rem;color:var(--muted);padding:.3rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:1rem;align-items:center}
.mtabs{display:flex;gap:.2rem;padding:.4rem .8rem 0;border-bottom:1px solid var(--border);flex-shrink:0;background:#0d1025}
.mtab{padding:.28rem .7rem;font-size:.75rem;border-radius:5px 5px 0 0;color:var(--muted);background:none;border:1px solid transparent;cursor:pointer}
.mtab.active{background:var(--card);color:#e2e8f0;border-color:var(--border);border-bottom-color:var(--card)}
.mtab:hover:not(.active){color:#c4cde2}
.mpanel{display:none;padding:.85rem 1rem;overflow-y:auto;flex:1;min-height:0}
.mpanel.active{display:flex;flex-direction:column}
/* Controls tab */
.ctrl-grid{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.85rem}
.ctrl-btn{padding:.48rem 1.1rem;border-radius:6px;border:none;font-size:.8rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:.35rem;transition:opacity .15s}
.ctrl-btn:hover{opacity:.82}.ctrl-btn:disabled{opacity:.4;cursor:not-allowed}
.ctrl-btn.start{background:#065f46;color:#34d399}.ctrl-btn.stop{background:#3b0404;color:#f87171}
.ctrl-btn.restart{background:#1e2235;color:var(--accent2);border:1px solid var(--border)}
.ctrl-btn.open-web{background:#12232a;color:#67e8f9;border:1px solid #164e63}
.ctrl-output{font-size:.7rem;font-family:monospace;color:var(--muted);padding:.4rem .6rem;background:#050710;border-radius:6px;min-height:40px;max-height:150px;overflow-y:auto;white-space:pre-wrap;border:1px solid var(--border);margin-top:.3rem}
.ctrl-sysinfo{display:grid;grid-template-columns:1fr 1fr;gap:.3rem;margin-top:.75rem}
/* Modal log box */
#modal-logbox{background:#050710;font-family:monospace;font-size:.7rem;color:#94a3b8;padding:.7rem;border-radius:6px;flex:1;min-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;border:1px solid var(--border);margin-top:.5rem}
/* ── Scrollbars ── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#080a12}
::-webkit-scrollbar-thumb{background:#2d334f;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#4b5563}
/* ── Sys-card progress bars ── */
.sys-bar{height:3px;background:var(--border);border-radius:2px;overflow:hidden;margin:.1rem 0 .25rem}
.sys-bar-fill{height:100%;border-radius:2px;background:var(--ok);transition:width .5s ease}
.sys-bar-fill.warn{background:var(--warn)}.sys-bar-fill.err{background:var(--err)}
/* ── Tab badges ── */
.tab-badge{display:inline-block;min-width:16px;height:14px;line-height:14px;border-radius:7px;font-size:.58rem;font-weight:700;text-align:center;padding:0 3px;margin-left:4px;background:var(--err-bg);color:var(--err);vertical-align:middle}
.tab-badge.warn{background:var(--warn-bg);color:var(--warn)}
/* ── Error count badge in rows ── */
.err-cnt{font-size:.6rem;color:var(--muted);background:#1a1f35;border-radius:9px;padding:.05rem .35rem;margin-left:auto;flex-shrink:0;white-space:nowrap}
.err-cnt.hot{color:var(--warn);background:var(--warn-bg)}
</style>
</head>
<body>
<header>
  <h1>📡 StreamMonitor</h1>
  <div class="hdr-mid" id="overview"></div>
  <div class="hdr-right">
    <span id="ts-hdr" style="font-size:.68rem;color:var(--muted)"></span>
    <a class="so" href="/logout">Sign out</a>
  </div>
</header>
<div class="tabs">
  <button class="tab active" onclick="tab('s',this)">Services</button>
  <button class="tab" onclick="tab('l',this);initLogs()">Logs</button>
  <button class="tab" onclick="tab('p',this);initPerms()">Perms</button>
  <button id="err-tab" class="tab" onclick="tab('e',this);loadErrors()">Errors</button>
  <button class="tab" onclick="tab('g',this);loadSettings()">Settings</button>
  <button class="tab" onclick="tab('j',this);loadJellyfin()">Jellyfin</button>
  <button class="tab" onclick="tab('sp',this)">Speed</button>
  <button class="tab" onclick="tab('b',this);initBench()">Benchmark</button>
  <button class="tab" onclick="tab('a',this)">API</button>
</div>

<div id="p-s" class="panel active">
  <div id="ts"></div>
  <div id="cats"></div>
</div>

<div id="p-l" class="panel">
  <div class="toolbar">
    <select id="unit" onchange="fetchLogs()">__UNITS__</select>
    <select id="log-lines" onchange="fetchLogs()" style="min-width:0;width:100px">
      <option value="100">100 lines</option>
      <option value="200" selected>200 lines</option>
      <option value="500">500 lines</option>
    </select>
    <input type="text" id="log-search" placeholder="Filter…" oninput="filterLogs()" style="width:130px">
    <button class="sm" onclick="fetchLogs()">Refresh</button>
    <label style="font-size:.68rem;color:var(--muted);display:flex;gap:.3rem;align-items:center;cursor:pointer">
      <input type="checkbox" id="log-autoscroll" checked> Auto-scroll
    </label>
    <span class="log-status" id="log-status"></span>
  </div>
  <div id="logbox" style="color:var(--muted)">Select a service to view logs.</div>
</div>

<div id="p-p" class="panel">
  <div style="display:flex;gap:.7rem;align-items:center;margin-bottom:.75rem;flex-wrap:wrap">
    <button class="sm" id="scan-btn" onclick="runScan()">⟳ Scan directories</button>
    <label style="font-size:.72rem;color:var(--muted);display:flex;align-items:center;gap:.3rem;cursor:pointer">
      <input type="checkbox" id="perm-recursive"> Recursive (-R)
    </label>
    <label style="font-size:.72rem;color:var(--muted);display:flex;align-items:center;gap:.3rem;cursor:pointer">
      <input type="checkbox" id="perm-issues-only" onchange="renderPermResults()"> Issues only
    </label>
    <select id="perm-section-filter" onchange="renderPermResults()" style="font-size:.72rem;min-width:0;width:150px">
      <option value="">All sections</option>
    </select>
    <span id="scan-meta" style="font-size:.68rem;color:var(--muted);margin-left:auto"></span>
  </div>
  <div id="perm-results"></div>
</div>

<div id="p-e" class="panel">
  <div style="display:flex;gap:.7rem;align-items:center;margin-bottom:.5rem;flex-wrap:wrap">
    <select id="err-svc" onchange="filterErrors()" style="width:140px">
      <option value="">All services</option>
    </select>
    <select id="err-sev" onchange="filterErrors()" style="min-width:0;width:110px">
      <option value="">All</option>
      <option value="error">Errors</option>
      <option value="warning">Warnings</option>
    </select>
    <select id="err-sort" onchange="filterErrors()" style="min-width:0;width:140px">
      <option value="newest">Newest first</option>
      <option value="oldest">Oldest first</option>
      <option value="count">Most recurring</option>
      <option value="svc">By service</option>
    </select>
    <button class="sm" onclick="scanNow()">⟳ Scan now</button>
    <button class="sm" onclick="clearErrors()" style="color:var(--muted)">&#10005; Clear</button>
    <span id="err-meta" style="font-size:.68rem;color:var(--muted);margin-left:auto"></span>
  </div>
  <div id="err-summary" style="font-size:.68rem;color:var(--muted);margin-bottom:.5rem;padding:.25rem 0;border-bottom:1px solid var(--border)"></div>
  <div id="err-list" style="font-family:monospace;font-size:.72rem;line-height:1.6"></div>
</div>

<div id="p-g" class="panel">
  <div class="settings-grid" id="settings-grid">
    <div style="color:var(--muted);font-size:.8rem;padding:.5rem">Loading settings…</div>
  </div>
</div>

<div id="p-j" class="panel">
  <div style="display:flex;gap:.7rem;align-items:center;margin-bottom:.75rem;flex-wrap:wrap">
    <button class="sm" onclick="loadJellyfin()">&#x27F3; Refresh</button>
    <span id="jf-meta" style="font-size:.68rem;color:var(--muted);margin-left:auto"></span>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;align-items:start" id="jf-grid">
    <div class="settings-sec" id="jf-sessions"><h3>Active Sessions</h3><div style="color:var(--muted);font-size:.78rem">Loading...</div></div>
    <div class="settings-sec" id="jf-activity"><h3>Recent Activity</h3><div style="color:var(--muted);font-size:.78rem">Loading...</div></div>
  </div>
</div>

<div id="p-sp" class="panel">
  <iframe src="/speedtest" style="width:100%;height:700px;border:none;border-radius:10px"></iframe>
</div>

<div id="p-b" class="panel">
  <div style="display:flex;gap:.7rem;align-items:center;margin-bottom:.75rem;flex-wrap:wrap">
    <select id="bench-title" style="min-width:260px">
      <option value="">Select a title...</option>
    </select>
    <button class="sm" id="bench-run-btn" onclick="runBench()">&#x25B6; Run Benchmark</button>
    <button class="sm" onclick="runAllBench()">&#x25B6;&#x25B6; Run All (slow)</button>
    <span id="bench-status" style="font-size:.68rem;color:var(--muted);margin-left:auto"></span>
  </div>
  <div id="bench-results"></div>
</div>

<div id="p-a" class="panel" style="font-size:.84rem;line-height:1.8">
  <b style="color:var(--accent2)">REST API</b>
  <div class="api-row"><code>GET /api/ping</code> — unauthenticated liveness check</div>
  <div class="api-row"><code>GET /api/status[/{id}]</code> — service health + history</div>
  <div class="api-row"><code>GET /api/stats[/{id}]</code> — API statistics per service</div>
  <div class="api-row"><code>GET /api/versions</code> — installed + latest GitHub versions</div>
  <div class="api-row"><code>GET /api/logs/{unit}</code> — last 200 journal lines</div>
  <div class="api-row"><code>GET /api/errors</code> — scanned error/warning history</div>
  <div class="api-row"><code>POST /api/errors/scan</code> — trigger immediate log scan</div>
  <div class="api-row"><code>GET /api/settings/keys</code> — list configured API keys (masked)</div>
  <div class="api-row"><code>POST /api/settings/keys</code> — update API keys</div>
  <div class="api-row"><code>POST /api/settings/password</code> — change admin password</div>
  <div class="api-row"><code>GET /api/benchmark?imdb=ttXXXXXXX</code> — run addon benchmark</div>
  <div class="api-row"><code>GET /api/jellyfin</code> — Jellyfin sessions &amp; activity</div>
  <div class="api-row"><code>GET /api/public</code> — unauthenticated health summary</div>
  <div class="api-row"><code>GET /api/dmesg</code> — kernel log (journalctl -k)</div>
  <div class="api-row"><code>GET /speedtest</code> — speed test page</div>
  <div class="api-row"><code>GET /speedtest/download?mb=25</code> — speed test download endpoint</div>
</div>

<!-- ── Service Modal ── -->
<div id="svc-modal" class="modal-overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-hdr">
      <div class="modal-title">
        <span id="modal-name">Service</span>
        <span id="modal-badge" class="badge up">UP</span>
        <span id="modal-lat" class="lat" style="font-size:.68rem"></span>
        <a id="modal-weburl" class="modal-url" target="_blank" rel="noopener" style="display:none">&#x2197; Open</a>
      </div>
      <button class="modal-close" onclick="closeModal()">&#x2715;</button>
    </div>
    <div class="modal-meta">
      <span id="modal-msg"></span>
      <span id="modal-unit" style="font-family:monospace;color:var(--border-active,#374162)"></span>
      <span id="modal-ts" style="margin-left:auto"></span>
    </div>
    <div class="mtabs">
      <button class="mtab active" onclick="openMTab('overview',this)">Overview</button>
      <button class="mtab" onclick="openMTab('logs',this)">Logs</button>
      <button class="mtab" onclick="openMTab('controls',this)">Controls</button>
    </div>
    <div id="mt-overview" class="mpanel active">
      <div id="modal-stats-body"></div>
      <div id="modal-version-body" style="margin-top:.4rem"></div>
      <div id="modal-history-body" style="margin-top:.5rem"></div>
    </div>
    <div id="mt-logs" class="mpanel">
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;flex-shrink:0">
        <select id="modal-log-lines" onchange="modalFetchLogs()" style="min-width:0;width:100px">
          <option value="100">100 lines</option>
          <option value="200" selected>200 lines</option>
          <option value="500">500 lines</option>
        </select>
        <input type="text" id="modal-log-search" placeholder="Filter…" oninput="modalFilterLogs()" style="width:130px">
        <button class="sm" onclick="modalFetchLogs()">Refresh</button>
        <span id="modal-log-status" style="font-size:.65rem;color:var(--muted);margin-left:auto"></span>
      </div>
      <div id="modal-logbox" style="color:var(--muted)">Select Logs tab to load.</div>
    </div>
    <div id="mt-controls" class="mpanel">
      <div class="ctrl-grid">
        <button class="ctrl-btn start" onclick="svcAction('start')">&#9654; Start</button>
        <button class="ctrl-btn stop"  onclick="svcAction('stop')">&#9632; Stop</button>
        <button class="ctrl-btn restart" onclick="svcAction('restart')">&#x27F3; Restart</button>
        <button class="ctrl-btn open-web" id="ctrl-open-web" style="display:none" onclick="openServiceWeb()">&#x2197; Open Web UI</button>
      </div>
      <div class="ctrl-output" id="ctrl-output" style="color:var(--muted)">Action output will appear here.</div>
      <div class="ctrl-sysinfo" id="ctrl-sysinfo"></div>
    </div>
  </div>
</div>

<script>
const CATS = {
  system:"System", streaming:"Streaming Stack", indexers:"Indexers", arr:"Arr Suite",
  media:"Media Servers", dispatch:"Dispatching", downloads:"Downloads",
  infra:"Infrastructure", other:"Other"
};
let statusData={}, statsData={}, versionsData={};
let logTimer=null, logsReady=false, curLogUnit='';

// ── Web panel URLs for each service (injected from config) ──
const WEB_URLS = {{WEB_URLS_JSON}};

// ── Tabs ──
function tab(n,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('p-'+n).classList.add('active');
  if(n!=='l'&&logTimer){clearInterval(logTimer);logTimer=null;}
}

// ── Utils ──
function esc(s){return String(s==null?'—':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function fmt(n){
  if(n==null||n===undefined)return'—';
  if(typeof n!=='number')return esc(String(n));
  if(n>=1e9)return(n/1e9).toFixed(2)+'B';
  if(n>=1e6)return(n/1e6).toFixed(2)+'M';
  if(n>=1000)return(n/1000).toFixed(1)+'K';
  return n.toLocaleString();
}
function fmtGB(n){if(n==null)return'—';return n>=1000?(n/1000).toFixed(1)+' TB':n.toFixed(1)+' GB'}
function kv(k,v,cls=''){
  return`<div class="kv ${cls}"><div class="vv">${v==='—'||v==null?'<span style="color:var(--muted)">—</span>':esc(String(v))}</div><div class="kk">${esc(k)}</div></div>`;
}
function row(...items){return`<div class="srow">${items.filter(Boolean).join('')}</div>`}
function sysR(k,v,cls=''){return`<div class="sys-r"><span class="sk">${esc(k)}</span><span class="sv ${cls}">${esc(String(v))}</span></div>`}
function sysBar(pct,cls=''){return`<div class="sys-bar"><div class="sys-bar-fill ${cls}" style="width:${Math.min(Math.max(pct,0),100).toFixed(1)}%"></div></div>`}
function fmtRate(bps){
  if(!bps)return'0 B/s';
  if(bps<1024)return bps.toFixed(0)+' B/s';
  if(bps<1048576)return(bps/1024).toFixed(1)+' KB/s';
  if(bps<1073741824)return(bps/1048576).toFixed(1)+' MB/s';
  return(bps/1073741824).toFixed(2)+' GB/s';
}
function fmtBytes(b){
  if(!b)return'0 B';
  if(b<1024)return b+' B';
  if(b<1048576)return(b/1024).toFixed(1)+' KB';
  if(b<1073741824)return(b/1048576).toFixed(1)+' MB';
  return(b/1073741824).toFixed(2)+' GB';
}

// ── Version tags ──
function normVer(v){return v?v.replace(/^[vV]/,'').trim():''}
// Split a version string into numeric parts only (e.g. "1.43.0.10492-abc" → [1,43,0,10492])
function verParts(v){return normVer(v).split(/[.\-+]/).map(p=>parseInt(p,10)).filter(n=>!isNaN(n))}
// Returns -1 if a<b, 0 if a==b, 1 if a>b
function cmpVer(a,b){
  const pa=verParts(a), pb=verParts(b);
  const len=Math.max(pa.length,pb.length);
  for(let i=0;i<len;i++){
    const x=pa[i]||0, y=pb[i]||0;
    if(x<y)return -1; if(x>y)return 1;
  }
  return 0;
}
function renderVersion(sid,installed){
  const gv=versionsData[sid]; if(!installed&&!gv)return'';
  const ni=normVer(installed), tags=[];
  if(ni)tags.push(`<span class="ver-tag inst" title="Installed">v${esc(ni)}</span>`);
  if(gv?.latest){
    const ng=normVer(gv.latest);
    const cmp=ni&&ng?cmpVer(ni,ng):null;
    let cls,arrow,title;
    if(cmp===null){cls='latest';arrow='';title='Latest on GitHub';}
    else if(cmp===0){cls='uptodate';arrow='';title='Up to date';}
    else if(cmp<0){cls='outdated';arrow='↑ ';title='Update available';}
    else{cls='uptodate';arrow='';title='Installed is newer than latest release';}
    tags.push(`<span class="ver-tag ${cls}" title="${title}">${arrow}${esc(gv.latest)}</span>`);
  }
  return tags.length?`<div class="ver-row">${tags.join('')}</div>`:'';
}

// ── System card ──
function renderSystem(s){
  if(!s||!Object.keys(s).length)return'<div style="color:var(--muted);font-size:.78rem;padding:.3rem">Collecting system stats…</div>';
  let h='<div class="sys-panels">';
  // OS + uptime
  h+='<div class="sys-sec"><div class="sys-ttl">System</div>';
  if(s.os_distro)h+=sysR('OS',s.os_distro);
  if(s.uptime)h+=sysR('Uptime',s.uptime,'ok');
  if(s.process_count!=null)h+=sysR('Processes',s.process_count);
  h+='</div>';
  // CPU
  const cpu=s.cpu||{};
  if(Object.keys(cpu).length){
    h+='<div class="sys-sec"><div class="sys-ttl">CPU</div>';
    if(cpu.model)h+=`<div style="font-size:.62rem;color:var(--muted2);margin-bottom:.25rem;line-height:1.3">${esc(cpu.model)}</div>`;
    if(cpu.physical_cores!=null)h+=sysR('Cores / Threads',`${cpu.physical_cores} / ${cpu.logical_cores}`);
    if(cpu.freq_mhz)h+=sysR('Clock',`${cpu.freq_mhz} MHz`);
    if(cpu.usage_pct!=null){
      const c=cpu.usage_pct>80?'err':cpu.usage_pct>50?'warn':'ok';
      h+=sysR('Usage',`${cpu.usage_pct.toFixed(1)}%`,c);
      h+=sysBar(cpu.usage_pct,c);
    }
    if(cpu.load_1m!=null)h+=sysR('Load (1/5/15m)',`${cpu.load_1m} / ${cpu.load_5m} / ${cpu.load_15m}`);
    h+='</div>';
  }
  // RAM
  const ram=s.ram||{};
  if(Object.keys(ram).length){
    h+='<div class="sys-sec"><div class="sys-ttl">Memory</div>';
    const rc=ram.percent>90?'err':ram.percent>70?'warn':'ok';
    h+=sysR('Used / Total',`${ram.used_gb} / ${ram.total_gb} GB`);
    h+=sysBar(ram.percent,rc);
    h+=sysR('Available',`${ram.available_gb} GB`,'ok');
    if(s.swap?.total_gb>0){
      const sc=s.swap.percent>80?'warn':'';
      h+=sysR('Swap',`${s.swap.used_gb} / ${s.swap.total_gb} GB`);
      if(s.swap.percent>0)h+=sysBar(s.swap.percent,sc);
    }
    h+='</div>';
  }
  // GPU
  const gpu=s.gpu||{};
  if(Object.keys(gpu).length){
    h+='<div class="sys-sec"><div class="sys-ttl">GPU</div>';
    if(gpu.name)h+=`<div style="font-size:.62rem;color:var(--muted2);margin-bottom:.25rem">${esc(gpu.name)}</div>`;
    if(gpu.usage_pct!=null){
      const gc=gpu.usage_pct>80?'warn':gpu.usage_pct>0?'ok':'';
      h+=sysR('Usage',`${gpu.usage_pct}%`,gc);
      h+=sysBar(gpu.usage_pct,gc);
    }
    if(gpu.vram_used_mb!=null&&gpu.vram_total_mb){
      const vp=gpu.vram_used_mb/gpu.vram_total_mb*100;
      const vc=vp>90?'err':vp>70?'warn':'ok';
      h+=sysR('VRAM',`${gpu.vram_used_mb} / ${gpu.vram_total_mb} MB`,vc);
      h+=sysBar(vp,vc);
    }
    if(gpu.temp_c!=null){const tc=gpu.temp_c>85?'err':gpu.temp_c>70?'warn':'ok';h+=sysR('Temp',`${gpu.temp_c}°C`,tc);}
    if(gpu.power_w!=null)h+=sysR('Power',`${gpu.power_w} W`);
    if(gpu.core_mhz!=null)h+=sysR('Core / Mem MHz',`${gpu.core_mhz} / ${gpu.mem_mhz||'?'}`);
    if(gpu.fan_rpm!=null)h+=sysR('Fan',`${gpu.fan_rpm} RPM`);
    if(gpu.mem_busy_pct!=null)h+=sysR('Mem busy',`${gpu.mem_busy_pct}%`);
    h+='</div>';
  }
  // Disks
  const disks=s.disks||[];
  if(disks.length){
    h+='<div class="sys-sec"><div class="sys-ttl">Storage</div>';
    for(const d of disks){
      const dc=d.percent>90?'err':d.percent>75?'warn':'ok';
      h+=`<div class="disk-item">`;
      h+=`<div class="disk-lbl"><span>${esc(d.mount)}</span><span style="color:var(--${d.percent>90?'err':d.percent>75?'warn':'muted'})">${d.free} / ${d.total} ${d.unit}</span></div>`;
      h+=`<div class="dbar"><div class="dbar-f ${dc}" style="width:${d.percent}%"></div></div></div>`;
    }
    h+='</div>';
  }
  // Disk I/O
  const dio=s.disk_io||{};
  if(dio.read_rate||dio.write_rate){
    h+='<div class="sys-sec"><div class="sys-ttl">Disk I/O</div>';
    h+=sysR('Read',dio.read_rate||'—','ok');
    h+=sysR('Write',dio.write_rate||'—','warn');
    h+=sysR('Session ↑↓',`${dio.read_total_gb||0} / ${dio.write_total_gb||0} GB`);
    h+='</div>';
  }
  // Network I/O
  const nio=s.net_io||{};
  if(nio.recv_rate||nio.sent_rate){
    const cap=nio.link_rate||'';
    h+='<div class="sys-sec"><div class="sys-ttl">Network</div>';
    const rp=nio.recv_pct||0, sp=nio.sent_pct||0;
    const rc=rp>80?'err':rp>50?'warn':'ok', sc=sp>80?'err':sp>50?'warn':'ok';
    h+=sysR('↓ Recv',cap?`${esc(nio.recv_rate)} / ${esc(cap)}`:esc(nio.recv_rate||'—'),rc);
    if(rp>0)h+=`<div class="dbar" style="margin:.05rem 0 .2rem"><div class="dbar-f ${rc}" style="width:${Math.min(rp,100)}%"></div></div>`;
    h+=sysR('↑ Sent',cap?`${esc(nio.sent_rate)} / ${esc(cap)}`:esc(nio.sent_rate||'—'),sc);
    if(sp>0)h+=`<div class="dbar" style="margin:.05rem 0 .2rem"><div class="dbar-f ${sc}" style="width:${Math.min(sp,100)}%"></div></div>`;
    h+=sysR('Total ↓',`${nio.recv_total_gb||0} GB`);
    h+=sysR('Total ↑',`${nio.sent_total_gb||0} GB`);
    h+='</div>';
  }
  h+='</div>';
  return h;
}

// ── Stats renderers ──
function renderStats(sid, s){
  if(!s||!Object.keys(s).length)return'';
  if(sid==='system')return`<div class="sbox">${renderSystem(s)}</div>`;
  const r={
    comet:()=>{
      let h=row(kv('version',s.version,'blue'),kv('types',s.types?.length),s.active_connections?kv('conns',s.active_connections,'ok'):'');
      if(s.torrents_total)h+=row(kv('torrents',fmt(s.torrents_total),'blue'),kv('queue🎬',s.queue_movies),kv('queue📺',s.queue_series));
      if(s.scraper_running!=null)h+=row(kv('scraper',s.scraper_running?(s.scraper_paused?'paused':'running'):'stopped',s.scraper_running?'ok':'warn'),kv('24h found',fmt(s.slo_torrents_found),'blue'),kv('fail rate',s.slo_fail_rate!=null?`${(s.slo_fail_rate*100).toFixed(0)}%`:'—',s.slo_fail_rate>0.1?'warn':''));
      if(s.top_trackers?.length)h+=`<div style="font-size:.62rem;color:var(--muted);margin-top:.2rem">${s.top_trackers.slice(0,3).map(t=>esc(t.name)+': '+fmt(t.count)).join(' · ')}</div>`;
      return h;
    },
    mediafusion:()=>{
      let h=row(kv('version',s.version||s.addon_version,'blue'),kv('access',s.is_public?'public':'private',s.is_public?'ok':''));
      if(s.streams_total!=null)h+=row(kv('streams',fmt(s.streams_total),'blue'),s.movies?kv('movies',fmt(s.movies)):'',s.series?kv('series',fmt(s.series)):'');
      if(s.sched_total!=null)h+=row(kv('schedulers',s.sched_active+'/'+s.sched_total),s.scrapers_active?kv('scrapers',s.scrapers_active+'/'+s.scrapers_total,'ok'):'',s.sched_running>0?kv('running',s.sched_running,'ok'):kv('idle','0'));
      if(s.top_sources){let src=Object.entries(s.top_sources);h+=row(...src.slice(0,3).map(([k,v])=>kv(k,fmt(v))));}
      if(s.debrid_cached){let dc=Object.entries(s.debrid_cached);if(dc.length)h+=row(...dc.map(([k,v])=>kv(k+' cache',fmt(v),'ok')));}
      if(s.redis_mem)h+=`<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">Redis: ${esc(s.redis_mem)} | DB: ${esc(s.db_size||'?')}</div>`;
      return h;
    },
    stremthru:()=>{
      let h=row(kv('version',s.version,'blue'),kv('status',s.status,'ok'),s.store_name?kv('store',s.store_name):'');
      if(s.subscription)h+=row(kv('sub',s.subscription,s.subscription?.includes('premium')?'ok':'warn'));
      if(s.magnet_total!=null)h+=row(kv('magnets',fmt(s.magnet_total),'blue'),s.torrent_info_count?kv('torrents',fmt(s.torrent_info_count)):'',s.dmm_hashes?kv('dmm',fmt(s.dmm_hashes)):'');
      if(s.magnet_cache){let mc=s.magnet_cache;let stores=Object.keys(mc);if(stores.length)h+=row(...stores.map(st=>kv(st,fmt(mc[st].cached)+' cached','ok')));}
      if(s.db_size)h+=row(kv('db',s.db_size));
      return h;
    },
    zilean:()=>{if(!s.responding)return '';
      let h=row(kv('status','online','ok'),s.sample_results!=null?kv('sample hits',s.sample_results,'blue'):'',s.quality_distribution?kv('qualities',Object.entries(s.quality_distribution).map(([k,v])=>k+'('+fmt(v)+')').join(' ')):'');
      if(s.total_torrents!=null)h+=row(kv('torrents',fmt(s.total_torrents),'blue'),kv('w/ IMDB',fmt(s.with_imdb),'ok'),kv('unmatched',fmt(s.total_torrents-s.with_imdb),'warn'));
      if(s.scraper_running!=null)h+=row(kv('scraper',s.scraper_running?'running':'idle',s.scraper_running?'ok':''),s.dmm_status!=null?kv('dmm sync',s.dmm_status,s.dmm_status==='ok'?'ok':'err'):'',s.imdb_entries?kv('imdb titles',fmt(s.imdb_entries)):'');
      if(s.dmm_last_run)h+=`<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">DMM sync: ${esc(s.dmm_last_run)}</div>`;
      if(s.db_size)h+=`<div style="font-size:.62rem;color:var(--muted)">DB: ${esc(s.db_size)}</div>`;
      if(s.latest_indexed)h+=`<div style="font-size:.62rem;color:var(--muted)">Last indexed: ${esc(s.latest_indexed)}</div>`;
      return h;},
    aiostreams:()=>{
      let h=row(kv('status','online','ok'),kv('version',s.version,'blue'),s.channel?kv('channel',s.channel,s.channel==='stable'?'ok':'warn'):'');
      if(s.user_count!=null)h+=row(kv('users',s.user_count),s.catalogs?kv('catalogs',s.catalogs):'',s.presets_available?kv('presets',s.presets_available):'');
      if(s.forced_services?.length)h+=row(kv('services',s.forced_services.join(', ')));
      if(s.cache_entries!=null)h+=row(kv('cache',fmt(s.cache_entries)),s.max_addons?kv('max addons',s.max_addons):'',s.tmdb_available?kv('tmdb','yes','ok'):kv('tmdb','no','warn'));
      if(s.commit)h+=`<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">Commit: ${esc(s.commit)} | ${esc(s.tag||'')}</div>`;
      return h;},
    flaresolverr:()=>row(kv('status',s.status,s.status==='ok'?'ok':'warn'),s.version?kv('version',s.version,'blue'):''),
    byparr:()=>row(kv('status',s.status,s.status==='ok'?'ok':'warn'),s.browser?kv('browser',s.browser):'',s.version?kv('version',s.version,'blue'):''),
    jackett:()=>{const p=[];if(s.indexers_configured!=null)p.push(kv('indexers',s.indexers_configured));if(s.responding)p.push(kv('torznab','ok','ok'));return p.length?row(...p):'';},
    prowlarr:()=>[
      row(kv('indexers',s.indexers_total),kv('enabled',s.indexers_enabled,'ok'),kv('queries',fmt(s.total_queries),'blue'),kv('grabs',fmt(s.total_grabs))),
      s.total_failed_queries?row(kv('failed q.',fmt(s.total_failed_queries),'warn')):'',
      (s.health_errors||s.health_warnings)?row(s.health_errors?kv('errors',s.health_errors,'err'):'',s.health_warnings?kv('warnings',s.health_warnings,'warn'):''):'',
      s.health_messages?.length?`<div class="health-err">${s.health_messages.map(esc).join(' · ')}</div>`:'',
    ].join(''),
    radarr:()=>[
      row(kv('total',fmt(s.total)),kv('downloaded',fmt(s.downloaded),'ok'),kv('missing',fmt(s.missing),s.missing>0?'err':''),kv('queue',fmt(s.queue),s.queue>0?'warn':'')),
      s.disk_free_gb!=null?row(kv('free disk',fmtGB(s.disk_free_gb)),kv('total',fmtGB(s.disk_total_gb))):'',
      (s.health_errors||s.health_warnings)?row(s.health_errors?kv('h.errors',s.health_errors,'err'):'',s.health_warnings?kv('h.warnings',s.health_warnings,'warn'):''):'',
      s.health_messages?.length?`<div class="health-err">${s.health_messages.map(esc).join('<br>')}</div>`:'',
    ].join(''),
    sonarr:()=>[
      row(kv('series',fmt(s.total)),kv('episodes',fmt(s.episodes_downloaded),'ok'),kv('missing ep.',fmt(s.missing_episodes),s.missing_episodes>0?'warn':''),kv('queue',fmt(s.queue),s.queue>0?'warn':'')),
      s.disk_free_gb!=null?row(kv('free disk',fmtGB(s.disk_free_gb)),kv('total',fmtGB(s.disk_total_gb))):'',
      (s.health_errors||s.health_warnings)?row(s.health_errors?kv('h.errors',s.health_errors,'err'):'',s.health_warnings?kv('h.warnings',s.health_warnings,'warn'):''):'',
      s.health_messages?.length?`<div class="health-err">${s.health_messages.map(esc).join('<br>')}</div>`:'',
    ].join(''),
    lidarr:()=>[
      row(kv('artists',fmt(s.artists)),kv('albums',fmt(s.albums_total)),kv('tracks',fmt(s.track_count),'ok'),kv('queue',fmt(s.queue),s.queue>0?'warn':'')),
      s.disk_free_gb!=null?row(kv('free disk',fmtGB(s.disk_free_gb)),kv('total',fmtGB(s.disk_total_gb))):'',
    ].join(''),
    bazarr:()=>{
      const p=[];
      if(s.version)p.push(row(kv('version',s.version,'blue')));
      if(s.movies_total!=null||s.episodes_total!=null)p.push(row(
        s.movies_total!=null?kv('movies',fmt(s.movies_total)):'',
        s.movies_missing>0?kv('mov. miss.',fmt(s.movies_missing),'warn'):'',
        s.episodes_total!=null?kv('episodes',fmt(s.episodes_total)):'',
        s.episodes_missing>0?kv('ep. miss.',fmt(s.episodes_missing),'warn'):'',
      ));
      return p.join('');
    },
    jellyfin:()=>[
      row(kv('movies',fmt(s.movies),'blue'),kv('series',fmt(s.series)),kv('episodes',fmt(s.episodes)),kv('songs',fmt(s.songs))),
      row(kv('sessions',fmt(s.sessions_total)),kv('playing',fmt(s.sessions_active),s.sessions_active>0?'ok':'')),
      s.now_playing?.filter(Boolean).length?`<div class="np">▶ ${s.now_playing.filter(Boolean).slice(0,2).map(esc).join(' · ')}</div>`:'',
    ].join(''),
    plex:()=>[
      s.movies!=null||s.series!=null?row(s.movies!=null?kv('movies',fmt(s.movies),'blue'):'',s.series!=null?kv('series',fmt(s.series)):'',kv('playing',fmt(s.sessions_active),s.sessions_active>0?'ok':'')):'',
      s.libraries?.length?`<div style="font-size:.63rem;color:var(--muted);margin-top:.2rem">${s.libraries.map(l=>`${esc(l.title)}: ${l.count}`).join(' · ')}</div>`:'',
    ].join(''),
    jellyseerr:()=>row(kv('total req.',fmt(s.requests_total),'blue'),kv('pending',fmt(s.requests_pending),s.requests_pending>0?'warn':''),kv('approved',fmt(s.requests_approved)),kv('available',fmt(s.requests_available),'ok')),
    dispatcharr:()=>[
      row(kv('streams',fmt(s.total_streams),'blue'),kv('channels',fmt(s.total_channels)),kv('m3u accts',fmt(s.m3u_accounts))),
      row(kv('epg src.',fmt(s.epg_sources)),s.epg_errors?kv('epg err.',s.epg_errors,'err'):'',s.epg_ok?kv('epg ok',s.epg_ok,'ok'):''),
    ].join(''),
    mediaflow:()=>s.status?row(kv('status',s.status,s.status==='healthy'?'ok':'warn')):'',
    qbittorrent:()=>{
      const rows=[];
      if(s.version)rows.push(row(kv('version',s.version,'blue')));
      if(s.active_torrents!=null)rows.push(row(
        kv('active',s.active_torrents,s.active_torrents>0?'ok':''),
        kv('dl\'ing',s.downloading!=null?s.downloading:'—'),
        kv('seeding',s.seeding!=null?s.seeding:'—'),
      ));
      if(s.dl_speed!=null)rows.push(row(
        kv('↓ speed',fmtRate(s.dl_speed),'ok'),
        kv('↑ speed',fmtRate(s.up_speed||0)),
      ));
      if(s.dl_session!=null&&(s.dl_session+s.up_session)>0)rows.push(row(
        kv('sess ↓',fmtBytes(s.dl_session)),
        kv('sess ↑',fmtBytes(s.up_session||0)),
      ));
      return rows.join('');
    },
  };
  const fn=r[sid]; if(!fn)return'';
  const html=fn(); if(!html?.trim())return'';
  return`<div class="sbox">${html}</div>`;
}

// ── History bar ──
function bar(h){
  const n=40,pad=n-Math.min(h.length,n);
  return'<span class="x"></span>'.repeat(pad)+
    h.slice(-n).map(r=>`<span class="${r.ok?'ok':'er'}" title="${esc(r.message)}"></span>`).join('');
}

// ── Header ──
function buildOverview(){
  const all=Object.values(statusData); if(!all.length)return'';
  const up=all.filter(s=>s.current.ok).length, dn=all.length-up;
  const issues=Object.values(statsData).reduce((a,s)=>a+(s?.health_errors||0)+(s?.health_warnings||0),0);
  const logErrs=errorsData.filter(e=>e.severity==='error').length;
  const logWarns=errorsData.filter(e=>e.severity==='warning').length;
  updateErrBadge(logErrs,logWarns);
  const errStat=logErrs>0?`<div class="hdr-stat err"><div class="val">${logErrs}</div><div class="lbl">Log Errors</div></div>`:
                logWarns>0?`<div class="hdr-stat warn"><div class="val">${logWarns}</div><div class="lbl">Warnings</div></div>`:'';
  return`
    <div class="hdr-stat ${dn===0?'ok':dn>2?'err':'warn'}"><div class="val">${up}/${all.length}</div><div class="lbl">Services</div></div>
    <div class="hdr-stat ${issues>0?'err':'ok'}"><div class="val">${issues||'&#10003;'}</div><div class="lbl">Issues</div></div>
    ${errStat}`;
}

// ── Card ──
function renderCard(sid, s){
  const cur=s.current, cls=cur.ok===null?'pend':cur.ok?'up':'dn';
  const st=statsData[sid]||{};
  const installed=st.version||st.addon_version||st.bazarr_version||'';
  const webUrl=WEB_URLS[sid]||'';
  if(sid==='system')return`<div class="card up" id="card-${sid}" onclick="openModal('${sid}')" title="Click for details">
    <div class="ct">&#x1F5A5; ${esc(cur.name)}</div>${renderStats(sid,st)}</div>`;
  const acts=`<div class="card-acts">
    ${webUrl?`<button class="card-act" onclick="event.stopPropagation();window.open('${webUrl}','_blank')" title="Open web UI">&#x2197;</button>`:''}
    <button class="card-act" onclick="event.stopPropagation();openModal('${sid}','logs')" title="View logs">&#x2261;</button>
    <button class="card-act danger" onclick="event.stopPropagation();quickRestart('${sid}')" title="Restart service">&#x27F3;</button>
  </div>`;
  return`<div class="card ${cls}" id="card-${sid}" onclick="openModal('${sid}')" title="Click for details">
    ${acts}
    <div class="ct">${esc(cur.name)}<span class="badge ${cls}">${cur.ok===null?'PENDING':cur.ok?'UP':'DOWN'}</span>${cur.latency_ms!=null?`<span class="lat">${cur.latency_ms}ms</span>`:''}</div>
    <div class="meta">${esc(cur.message||'—')} · systemd: ${esc(cur.systemd)}</div>
    ${renderStats(sid,st)}${renderVersion(sid,installed)}
    <div class="bar">${bar(s.history)}</div></div>`;
}

// ── Data fetch ──
async function safeJson(url,opts){
  try{const r=await fetch(url,opts);if(!r.ok)return null;return await r.json();}catch{return null;}
}

async function refresh(){
  const [status,stats,versions]=await Promise.all([
    safeJson('/api/status'),safeJson('/api/stats'),safeJson('/api/versions'),
  ]);
  if(status)statusData=status; if(stats)statsData=stats; if(versions)versionsData=versions;
  if(!Object.keys(statusData).length)return;
  document.getElementById('overview').innerHTML=buildOverview();
  document.getElementById('ts-hdr').textContent='⟳ '+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
  document.getElementById('ts').textContent='Last updated: '+new Date().toLocaleString('en-CA',{timeZone:TZ,hour12:false});
  const cats={};
  for(const[sid,s] of Object.entries(statusData)){const cat=s.current.category||'other';(cats[cat]=cats[cat]||[]).push([sid,s]);}
  let html='';
  for(const catKey of ['system','streaming','indexers','arr','media','dispatch','downloads','infra','other']){
    const items=cats[catKey]; if(!items?.length)continue;
    html+=`<div class="cat-hdr">${CATS[catKey]||catKey}</div>`;
    html+=`<div class="grid${catKey==='system'?' sys-grid':''}">`;
    for(const[sid,s] of items)html+=renderCard(sid,s);
    html+='</div>';
  }
  document.getElementById('cats').innerHTML=html;
}

// ── Logs ──
let _logLines=[];
async function fetchLogs(){
  const u=document.getElementById('unit').value; if(!u)return;
  const n=document.getElementById('log-lines')?.value||'200';
  const b=document.getElementById('logbox'), st=document.getElementById('log-status');
  if(curLogUnit!==u){b.innerHTML='<span class="spin"></span> Loading…';curLogUnit=u;}
  const d=await safeJson('/api/logs/'+encodeURIComponent(u)+'?n='+n);
  if(!d){b.innerHTML='<span style="color:var(--err)">Error fetching logs.</span>';return;}
  if(d.error){b.innerHTML='<span style="color:var(--err)">'+esc(d.error)+'</span>';return;}
  _logLines=d.lines||[];
  filterLogs();
  st.textContent=`${_logLines.length} lines · `+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
}
function filterLogs(){
  const b=document.getElementById('logbox');
  if(!_logLines.length){b.innerHTML='<span style="color:var(--muted)">No logs.</span>';return;}
  const q=(document.getElementById('log-search')?.value||'').toLowerCase();
  const lines=q?_logLines.filter(l=>l.toLowerCase().includes(q)):_logLines;
  if(!lines.length){b.innerHTML='<span style="color:var(--muted)">No lines match filter.</span>';return;}
  const atBot=b.scrollHeight-b.scrollTop-b.clientHeight<60;
  const autoscroll=document.getElementById('log-autoscroll')?.checked!==false;
  b.innerHTML=lines.map(l=>`<span class="${/error|critical|fail|exception/i.test(l)?'le':/warn/i.test(l)?'lw':''}">${esc(l)}</span>`).join('\n');
  if(autoscroll&&atBot)b.scrollTop=b.scrollHeight;
}
function initLogs(){
  if(logsReady)return; logsReady=true;
  fetchLogs();
  logTimer=setInterval(()=>{if(document.getElementById('p-l').classList.contains('active'))fetchLogs();},5000);
}

// ── Settings ──
let keysData={}, keysOriginal={};
function toggleKeyVis(k){
  const inp=document.getElementById('key_'+k);
  const btn=document.getElementById('eye_'+k);
  if(!inp)return;
  if(inp.type==='password'){inp.type='text';btn.textContent='🙈';}
  else{inp.type='password';btn.textContent='👁';}
}
function copyKey(k){
  const inp=document.getElementById('key_'+k);
  if(!inp)return;
  navigator.clipboard.writeText(inp.value).then(()=>{
    const btn=document.getElementById('copy_'+k);
    const prev=btn.textContent; btn.textContent='✓';
    setTimeout(()=>{btn.textContent=prev;},1500);
  });
}
function markChanged(k){
  const inp=document.getElementById('key_'+k);
  if(!inp)return;
  inp.classList.toggle('changed', inp.value!==keysOriginal[k]);
}
async function loadSettings(){
  const g=document.getElementById('settings-grid');
  const keys=await safeJson('/api/settings/keys');
  if(keys){keysData=keys; keysOriginal=Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,v.value||'']));}
  // Group keys
  const groups={};
  for(const [k,v] of Object.entries(keys||{})){
    const gr=v.group||'Other';
    if(!groups[gr])groups[gr]=[];
    groups[gr].push([k,v]);
  }
  const groupOrder=['Arr Suite','Indexers','Media Servers','Streaming','Dispatching','Other'];
  const sorted=groupOrder.filter(g=>groups[g]).concat(Object.keys(groups).filter(g=>!groupOrder.includes(g)));
  const keysHtml=sorted.map(gr=>`
    <div class="key-group">
      <div class="key-group-label">${esc(gr)}</div>
      ${groups[gr].map(([k,v])=>`
      <div class="key-row">
        <label title="${esc(k)}">${esc(v.label)}</label>
        <div class="key-input-wrap">
          <input type="password" id="key_${esc(k)}" value="${esc(v.value||'')}" placeholder="(not set)" oninput="markChanged('${esc(k)}')">
          <button class="key-btn" id="eye_${esc(k)}" onclick="toggleKeyVis('${esc(k)}')" title="Show/hide">👁</button>
          <button class="key-btn" id="copy_${esc(k)}" onclick="copyKey('${esc(k)}')" title="Copy">⎘</button>
        </div>
      </div>`).join('')}
    </div>`).join('');
  g.innerHTML=`
  <div class="settings-sec">
    <h3>API Keys</h3>
    ${keysHtml}
    <button class="btn-save" onclick="saveKeys()">Save Keys</button>
    <div id="keys-msg"></div>
  </div>
  <div class="settings-sec">
    <h3>Admin Password</h3>
    <div class="pw-form">
      <div><label>Current password</label><input type="password" id="pw-cur" autocomplete="current-password"></div>
      <div><label>New password</label><input type="password" id="pw-new" autocomplete="new-password"></div>
      <div><label>Confirm new</label><input type="password" id="pw-conf" autocomplete="new-password"></div>
      <button class="btn-save" onclick="changePassword()">Update Password</button>
      <div id="pw-msg"></div>
    </div>
  </div>`;
}

async function saveKeys(){
  const updates={};
  for(const k of Object.keys(keysData)){
    const el=document.getElementById('key_'+k);
    if(el)updates[k]=el.value.trim();
  }
  const msg=document.getElementById('keys-msg');
  const r=await safeJson('/api/settings/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(updates)});
  if(r?.ok){msg.className='msg-ok';msg.textContent='Saved!';}
  else{msg.className='msg-err';msg.textContent='Error saving keys.';}
  setTimeout(()=>{msg.textContent='';},3000);
}

async function changePassword(){
  const cur=document.getElementById('pw-cur').value;
  const nw=document.getElementById('pw-new').value;
  const cf=document.getElementById('pw-conf').value;
  const msg=document.getElementById('pw-msg');
  if(!nw){msg.className='msg-err';msg.textContent='New password required.';return;}
  if(nw!==cf){msg.className='msg-err';msg.textContent='Passwords do not match.';return;}
  const r=await safeJson('/api/settings/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current:cur,new_password:nw})});
  if(r?.ok){msg.className='msg-ok';msg.textContent='Password changed!';document.getElementById('pw-cur').value='';document.getElementById('pw-new').value='';document.getElementById('pw-conf').value='';}
  else{msg.className='msg-err';msg.textContent=r?.error||'Error changing password.';}
  setTimeout(()=>{msg.textContent='';},4000);
}

// ── Perms tab ──
const TZ = 'America/Vancouver';
function fmtTs(ts){ return ts ? new Date(ts*1000).toLocaleString('en-CA',{timeZone:TZ,hour12:false}) : '—'; }
let permScanData=[], permsScanned=false;
function initPerms(){ if(!permsScanned) runScan(); }

async function runScan(){
  const btn=document.getElementById('scan-btn');
  const meta=document.getElementById('scan-meta');
  btn.disabled=true; btn.textContent='Scanning…'; meta.textContent='';
  const d=await safeJson('/api/perms/scan',{method:'POST'});
  btn.disabled=false; btn.textContent='⟳ Scan directories'; permsScanned=true;
  if(!d){meta.textContent='Scan failed.';return;}
  permScanData=d.results||[];
  const ok=permScanData.filter(r=>r.ok).length;
  const bad=permScanData.filter(r=>!r.ok&&r.exists&&!r.missing).length;
  const miss=permScanData.filter(r=>r.missing).length;
  meta.textContent=`${ok} OK · `+(bad?`<span style="color:var(--err)">${bad} mismatch</span> · `:`0 mismatch · `)+`${miss} missing · ${fmtTs(d.ts)}`;
  meta.innerHTML=meta.textContent;
  renderPermResults();
}

function renderPermResults(){
  const el=document.getElementById('perm-results');
  if(!permScanData.length){el.innerHTML='<div style="color:var(--muted);padding:.5rem">No data. Click Scan.</div>';return;}
  const bad=permScanData.filter(r=>!r.ok&&!r.missing);

  // Populate section filter dropdown (first scan only)
  const secSel=document.getElementById('perm-section-filter');
  if(secSel&&secSel.options.length===1){
    [...new Set(permScanData.map(r=>r.section||'Other'))].forEach(s=>{
      const o=document.createElement('option');o.value=s;o.textContent=s;secSel.appendChild(o);
    });
  }
  const issuesOnly=document.getElementById('perm-issues-only')?.checked;
  const sectionFilter=document.getElementById('perm-section-filter')?.value||'';

  // Group by section (applying filters)
  const sections=[];
  const sectionMap={};
  permScanData.forEach((r,i)=>{
    if(issuesOnly&&r.ok)return;
    const sec=r.section||'Other';
    if(sectionFilter&&sec!==sectionFilter)return;
    if(!sectionMap[sec]){sectionMap[sec]=[];sections.push(sec);}
    sectionMap[sec].push({r,i});
  });

  let tbody='';
  sections.forEach(sec=>{
    const entries=sectionMap[sec];
    const secBad=entries.filter(({r})=>!r.ok&&!r.missing).length;
    const secMiss=entries.filter(({r})=>r.missing).length;
    const badge=secBad?`<span style="color:var(--err);margin-left:.4rem;font-size:.7rem">${secBad} issue${secBad>1?'s':''}</span>`:
                secMiss?`<span style="color:var(--muted);margin-left:.4rem;font-size:.7rem">${secMiss} missing</span>`:
                `<span style="color:var(--ok);margin-left:.4rem;font-size:.7rem">&#10003; OK</span>`;
    tbody+=`<tr class="perm-section-hdr"><td colspan="9"><strong>${esc(sec)}</strong>${badge}</td></tr>`;
    entries.forEach(({r,i})=>{
      const rowCls=r.missing?'missing-row':r.ok?'ok-row':'bad-row';
      const statusIcon=r.missing?'<span class="perm-miss">MISSING</span>':r.ok?'<span class="perm-ok">&#10003;</span>':'<span class="perm-bad">&#10007;</span>';
      const uCls=r.cur_user!==r.exp_user&&!r.missing?'perm-diff':'';
      const gCls=r.cur_group!==r.exp_group&&!r.missing?'perm-diff':'';
      const mCls=r.cur_mode!==r.exp_mode&&!r.missing?'perm-diff':'';
      const cb=r.missing?'':r.ok?'':`<input type="checkbox" class="perm-cb" data-i="${i}" checked onchange="updateSelCount()">`;
      tbody+=`<tr class="${rowCls}" data-i="${i}">
        <td>${cb}</td>
        <td>${statusIcon}</td>
        <td style="color:var(--accent2);font-family:monospace">${esc(r.label)}</td>
        <td style="font-family:monospace;font-size:.68rem;color:var(--muted2)">${esc(r.path)}</td>
        <td><span class="${uCls}">${esc(r.cur_user)}</span></td>
        <td><span class="${gCls}">${esc(r.cur_group)}</span></td>
        <td style="font-family:monospace"><span class="${mCls}">${esc(r.cur_mode)}</span></td>
        <td style="color:var(--muted);font-size:.65rem">${esc(r.exp_user)}:${esc(r.exp_group)} ${esc(r.exp_mode)}</td>
        <td id="perm-res-${i}"></td>
      </tr>`;
    });
  });

  el.innerHTML=`
  <table class="perm-table">
    <thead><tr>
      <th><input type="checkbox" id="perm-all" onchange="toggleAllPerms(this)"></th>
      <th>Status</th><th>Service</th><th>Path</th>
      <th>Owner</th><th>Group</th><th>Mode</th><th>Expected</th><th>Result</th>
    </tr></thead>
    <tbody>${tbody}</tbody>
  </table>
  <div class="perm-fix-row">
    <span class="perm-sel-count" id="perm-sel-count">${bad.length} selected</span>
    <label>Owner<input type="text" id="fix-user" value="" placeholder="from expected"></label>
    <label>Group<input type="text" id="fix-group" value="media" placeholder="media"></label>
    <label>Mode<input type="text" id="fix-mode" value="774" placeholder="774"></label>
    <button class="btn-save" onclick="applyPerms()">Apply to selected</button>
    <button class="sm" onclick="selectMismatches()">Select all mismatches</button>
    <div id="perm-apply-msg" style="font-size:.72rem"></div>
  </div>`;
}

function toggleAllPerms(cb){ document.querySelectorAll('.perm-cb').forEach(c=>c.checked=cb.checked); updateSelCount(); }
function selectMismatches(){ document.querySelectorAll('.perm-cb').forEach(c=>c.checked=true); updateSelCount(); }
function updateSelCount(){ const el=document.getElementById('perm-sel-count'); if(el)el.textContent=document.querySelectorAll('.perm-cb:checked').length+' selected'; }

async function applyPerms(){
  const recursive=document.getElementById('perm-recursive').checked;
  const defUser=document.getElementById('fix-user').value.trim();
  const defGroup=document.getElementById('fix-group').value.trim()||'media';
  const defMode=document.getElementById('fix-mode').value.trim()||'774';
  const selected=[...document.querySelectorAll('.perm-cb:checked')].map(c=>parseInt(c.dataset.i));
  if(!selected.length){document.getElementById('perm-apply-msg').textContent='Nothing selected.';return;}
  const msg=document.getElementById('perm-apply-msg');
  msg.textContent=`Applying to ${selected.length} path(s)…`;
  const fixes=selected.map(i=>{
    const r=permScanData[i];
    return{path:r.path, user:defUser||r.exp_user, group:defGroup||r.exp_group, mode:defMode||r.exp_mode, recursive};
  });
  const d=await safeJson('/api/perms/fix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fixes)});
  if(!d){msg.textContent='Request failed.';return;}
  let ok=0,fail=0;
  for(const res of (d.results||[])){
    const i=permScanData.findIndex(r=>r.path===res.path);
    const cell=document.getElementById('perm-res-'+i);
    if(cell){
      if(res.ok){cell.innerHTML='<span class="perm-ok">✓</span>';ok++;}
      else{cell.innerHTML=`<span class="perm-bad" title="${esc(res.error||'')}">✗</span>`;fail++;}
    }
  }
  msg.textContent=`Done: ${ok} OK, ${fail} failed.`;
  if(ok>0) setTimeout(runScan, 800);
}

// ── Errors tab ──
let errorsData=[], errorsLoaded=false;

function updateErrBadge(errors,warnings){
  const tab=document.getElementById('err-tab'); if(!tab)return;
  let badge=tab.querySelector('.tab-badge');
  const total=errors+warnings;
  if(total>0){
    if(!badge){badge=document.createElement('span');tab.appendChild(badge);}
    badge.className='tab-badge'+(errors===0?' warn':'');
    badge.textContent=total>99?'99+':total;
  } else {
    if(badge)badge.remove();
  }
}

async function loadErrors(){
  errorsLoaded=true;
  const d=await safeJson('/api/errors');
  if(!d)return;
  errorsData=d.errors||[];
  // Populate service filter
  const svcs=[...new Set(errorsData.map(e=>e.sid))].sort();
  const sel=document.getElementById('err-svc');
  const cur=sel.value;
  sel.innerHTML='<option value="">All services</option>'+svcs.map(s=>`<option value="${esc(s)}"${s===cur?' selected':''}>${esc(s)}</option>`).join('');
  // Meta info
  const meta=document.getElementById('err-meta');
  const errs=errorsData.filter(e=>e.severity==='error').length;
  const warns=errorsData.filter(e=>e.severity==='warning').length;
  if(d.last_scan){
    const ago=Math.round((Date.now()/1000-d.last_scan)/60);
    meta.textContent=`${errorsData.length} entries · scan #${d.scan_count} · ${ago<1?'just now':ago+'m ago'}`;
  }
  const summary=document.getElementById('err-summary');
  summary.innerHTML=errs||warns?
    `<span style="color:var(--err)">${errs} error${errs!==1?'s':''}</span> · `+
    `<span style="color:var(--warn)">${warns} warning${warns!==1?'s':''}</span>`:'All clear';
  updateErrBadge(errs,warns);
  filterErrors();
}

function filterErrors(){
  const svc=document.getElementById('err-svc').value;
  const sev=document.getElementById('err-sev').value;
  const sort=document.getElementById('err-sort')?.value||'newest';
  let items=[...errorsData];
  if(svc)items=items.filter(e=>e.sid===svc);
  if(sev)items=items.filter(e=>e.severity===sev);
  // Sort
  if(sort==='newest')items.reverse();
  else if(sort==='oldest'){/* already oldest-first */}
  else if(sort==='count')items.sort((a,b)=>(b.count||1)-(a.count||1));
  else if(sort==='svc')items.sort((a,b)=>a.sid.localeCompare(b.sid));
  const el=document.getElementById('err-list');
  if(!items.length){el.innerHTML='<div style="color:var(--muted);padding:.5rem;font-family:system-ui">No entries match the filter.</div>';return;}
  el.innerHTML=items.map(e=>{
    const ts=new Date(e.ts*1000).toLocaleString('en-CA',{timeZone:TZ,hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const cnt=e.count&&e.count>1?`<span class="err-cnt${e.count>5?' hot':''}" title="${e.count} occurrences">×${e.count}</span>`:'';
    const full=e.line.length>180?e.line:'';
    const short=e.line.length>180?e.line.slice(0,180)+'…':e.line;
    return`<div class="err-row ${esc(e.severity)}" onclick="this.classList.toggle('expanded')">`+
      `<span class="err-sev">${esc(e.severity)}</span>`+
      `<span class="err-svc">${esc(e.sid)}</span>`+
      `<span class="err-ts">${esc(ts)}</span>`+
      `<span class="err-line">${esc(short)}</span>${cnt}</div>`+
      (full?`<div class="err-expand">${esc(full)}</div>`:'');
  }).join('');
}

async function scanNow(){
  const btns=document.querySelectorAll('#p-e button.sm');
  const btn=btns[0];
  if(btn){btn.disabled=true;btn.textContent='Scanning…';}
  await safeJson('/api/errors/scan',{method:'POST'});
  await loadErrors();
  if(btn){btn.disabled=false;btn.textContent='⟳ Scan now';}
}

async function clearErrors(){
  await safeJson('/api/errors',{method:'DELETE'});
  errorsData=[];
  document.getElementById('err-list').innerHTML='<div style="color:var(--muted);padding:.5rem;font-family:system-ui">History cleared.</div>';
  document.getElementById('err-summary').textContent='';
  document.getElementById('err-meta').textContent='';
  updateErrBadge(0,0);
}

// ── Service Modal ──
let modalSid=null, modalUnit=null, modalLogTimer=null, _modalLogLines=[];

function openModal(sid, tab='overview'){
  const s=statusData[sid]; if(!s)return;
  const st=statsData[sid]||{};
  const cur=s.current;
  modalSid=sid;
  modalUnit=cur.unit||'';

  // Header
  document.getElementById('modal-name').textContent=cur.name;
  const cls=cur.ok===null?'pend':cur.ok?'up':'dn';
  const badge=document.getElementById('modal-badge');
  badge.className=`badge ${cls}`;
  badge.textContent=cur.ok===null?'PENDING':cur.ok?'UP':'DOWN';
  const latEl=document.getElementById('modal-lat');
  latEl.textContent=cur.latency_ms!=null?cur.latency_ms+'ms':'';

  // Web URL
  const webUrl=WEB_URLS[sid]||'';
  const urlEl=document.getElementById('modal-weburl');
  if(webUrl){urlEl.href=webUrl;urlEl.style.display='';}else{urlEl.style.display='none';}

  // Meta
  document.getElementById('modal-msg').textContent=cur.message||'—';
  document.getElementById('modal-unit').textContent=cur.unit?`unit: ${cur.unit}`:'';
  const tsEl=document.getElementById('modal-ts');
  if(cur.timestamp)tsEl.textContent=new Date(cur.timestamp).toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});

  // Overview
  const statsHtml=renderStats(sid,st);
  document.getElementById('modal-stats-body').innerHTML=statsHtml||'<div style="color:var(--muted);font-size:.78rem">No stats collected yet.</div>';
  const installed=st.version||st.addon_version||st.bazarr_version||'';
  document.getElementById('modal-version-body').innerHTML=renderVersion(sid,installed);
  document.getElementById('modal-history-body').innerHTML=s.history?.length?
    `<div style="font-size:.6rem;color:var(--muted);margin-bottom:.2rem">Uptime history (last ${s.history.length} checks)</div><div class="bar" style="margin:0">${bar(s.history)}</div>`:'';

  // Controls: web button
  const cwBtn=document.getElementById('ctrl-open-web');
  if(webUrl){cwBtn.style.display='';cwBtn.onclick=()=>window.open(webUrl,'_blank');}
  else{cwBtn.style.display='none';}
  document.getElementById('ctrl-output').textContent='Action output will appear here.';
  document.getElementById('ctrl-output').style.color='var(--muted)';

  // System info panel in controls
  const sysinfo=document.getElementById('ctrl-sysinfo');
  sysinfo.innerHTML=cur.unit?[
    sysR('Unit',cur.unit),sysR('Systemd',cur.systemd,cur.systemd==='active'?'ok':cur.systemd==='inactive'?'err':''),
    sysR('Status',cur.ok?'Healthy':'Unhealthy',cur.ok?'ok':'err'),
    cur.latency_ms!=null?sysR('Latency',cur.latency_ms+'ms'):'',
  ].join(''):'';

  // Show modal, open correct tab
  document.getElementById('svc-modal').classList.add('open');
  document.body.style.overflow='hidden';
  openMTab(tab, document.querySelector(`.mtab[onclick*="'${tab}'"]`)||document.querySelector('.mtab'));
}

function closeModal(){
  document.getElementById('svc-modal').classList.remove('open');
  document.body.style.overflow='';
  if(modalLogTimer){clearInterval(modalLogTimer);modalLogTimer=null;}
  _modalLogLines=[];
  modalSid=null; modalUnit=null;
}

function openMTab(name, el){
  document.querySelectorAll('.mtab').forEach(t=>t.classList.remove('active'));
  if(el)el.classList.add('active');
  document.querySelectorAll('.mpanel').forEach(p=>p.classList.remove('active'));
  document.getElementById('mt-'+name).classList.add('active');
  if(name==='logs'){
    if(modalLogTimer){clearInterval(modalLogTimer);modalLogTimer=null;}
    modalFetchLogs();
    modalLogTimer=setInterval(modalFetchLogs,5000);
  } else {
    if(modalLogTimer){clearInterval(modalLogTimer);modalLogTimer=null;}
  }
}

async function modalFetchLogs(){
  if(!modalUnit)return;
  const n=document.getElementById('modal-log-lines')?.value||'200';
  const box=document.getElementById('modal-logbox');
  const st=document.getElementById('modal-log-status');
  const d=await safeJson('/api/logs/'+encodeURIComponent(modalUnit)+'?n='+n);
  if(!d){box.innerHTML='<span style="color:var(--err)">Error fetching logs.</span>';return;}
  if(d.error){box.innerHTML=`<span style="color:var(--err)">${esc(d.error)}</span>`;return;}
  _modalLogLines=d.lines||[];
  modalFilterLogs();
  st.textContent=`${_modalLogLines.length} lines · `+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
}

function modalFilterLogs(){
  const box=document.getElementById('modal-logbox');
  if(!_modalLogLines.length){box.innerHTML='<span style="color:var(--muted)">No logs.</span>';return;}
  const q=(document.getElementById('modal-log-search')?.value||'').toLowerCase();
  const lines=q?_modalLogLines.filter(l=>l.toLowerCase().includes(q)):_modalLogLines;
  if(!lines.length){box.innerHTML='<span style="color:var(--muted)">No lines match filter.</span>';return;}
  const atBot=box.scrollHeight-box.scrollTop-box.clientHeight<60;
  box.innerHTML=lines.map(l=>`<span class="${/error|critical|fail|exception/i.test(l)?'le':/warn/i.test(l)?'lw':''}">${esc(l)}</span>`).join('\n');
  if(atBot)box.scrollTop=box.scrollHeight;
}

async function svcAction(action){
  if(!modalUnit)return;
  const out=document.getElementById('ctrl-output');
  const btns=document.querySelectorAll('.ctrl-btn');
  btns.forEach(b=>{b.disabled=true;});
  out.style.color='var(--muted)';
  out.textContent=`${action}ing ${modalUnit}…`;
  const r=await safeJson(`/api/service/${encodeURIComponent(modalUnit)}/${action}`,{method:'POST'});
  btns.forEach(b=>{b.disabled=false;});
  if(r?.ok){
    out.style.color='var(--ok)';
    out.textContent=`✓ ${action} succeeded`;
    setTimeout(()=>refresh(),2000);
  } else {
    out.style.color='var(--err)';
    out.textContent=`✗ ${action} failed: ${r?.error||'unknown error'}`;
  }
}

async function quickRestart(sid){
  const s=statusData[sid]; if(!s)return;
  const unit=s.current.unit; if(!unit)return;
  const card=document.getElementById('card-'+sid);
  if(card){card.style.opacity='.5';card.style.pointerEvents='none';}
  await safeJson(`/api/service/${encodeURIComponent(unit)}/restart`,{method:'POST'});
  if(card){card.style.opacity='';card.style.pointerEvents='';}
  setTimeout(()=>refresh(),2000);
}

function openServiceWeb(){
  const url=WEB_URLS[modalSid]; if(url)window.open(url,'_blank');
}

// ── Keyboard: Escape closes modal ──
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

// ── Jellyfin tab ──
let jfLoaded=false;
async function loadJellyfin(){
  const d=await safeJson('/api/jellyfin');
  if(!d)return;
  jfLoaded=true;
  const meta=document.getElementById('jf-meta');
  meta.textContent='Updated: '+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
  // Sessions
  const sesEl=document.getElementById('jf-sessions');
  const sessions=d.sessions||[];
  const active=sessions.filter(s=>s.NowPlayingItem);
  let sh='<h3>Active Sessions ('+sessions.length+')</h3>';
  if(!sessions.length)sh+='<div style="color:var(--muted);font-size:.78rem">No active sessions</div>';
  else{
    for(const s of sessions){
      const user=s.UserName||'Unknown';
      const client=s.Client||'';
      const device=s.DeviceName||'';
      const np=s.NowPlayingItem;
      const playing=np?`<span style="color:var(--ok)">&#x25B6; ${esc(np.Name||'')}${np.SeriesName?' ('+esc(np.SeriesName)+')':''}</span>`:'<span style="color:var(--muted)">Idle</span>';
      sh+=`<div style="padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.75rem">
        <div style="display:flex;gap:.5rem;align-items:center"><strong style="color:var(--accent2)">${esc(user)}</strong><span style="color:var(--muted)">${esc(client)} / ${esc(device)}</span></div>
        <div style="margin-top:.15rem">${playing}</div></div>`;
    }
  }
  sesEl.innerHTML=sh;
  // Activity
  const actEl=document.getElementById('jf-activity');
  const activity=d.activity||[];
  let ah='<h3>Recent Activity ('+activity.length+')</h3>';
  if(!activity.length)ah+='<div style="color:var(--muted);font-size:.78rem">No recent activity</div>';
  else{
    for(const a of activity.slice(0,30)){
      const ts=a.Date?new Date(a.Date).toLocaleString('en-CA',{timeZone:TZ,hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
      const sev=a.Severity==='Error'?'err':a.Severity==='Warning'?'warn':'muted';
      ah+=`<div style="padding:.25rem 0;border-bottom:1px solid var(--border);font-size:.7rem;display:flex;gap:.5rem">
        <span style="color:var(--muted);min-width:90px;flex-shrink:0">${esc(ts)}</span>
        <span style="color:var(--${sev})">${esc(a.Name||a.Type||'')}</span>
        <span style="color:var(--muted2);margin-left:auto">${esc(a.ShortOverview||'').slice(0,80)}</span></div>`;
    }
  }
  actEl.innerHTML=ah;
}

// ── Benchmark tab ──
const BENCH_TITLES=__BENCH_TITLES__;
let benchInited=false;
function initBench(){
  if(benchInited)return;benchInited=true;
  const sel=document.getElementById('bench-title');
  // Group titles
  const groups={'Popular Movies':[],'Niche Movies':[],'Popular TV':[],'Niche TV':[],'Popular Anime':[],'Niche Anime':[],'TV Episodes':[]};
  for(const [id,name] of Object.entries(BENCH_TITLES)){
    if(id.includes(':'))groups['TV Episodes'].push([id,name]);
    else if(['tt0468569','tt1375666','tt0111161','tt0816692','tt15398776','tt6718170','tt1517268','tt9362722'].includes(id))groups['Popular Movies'].push([id,name]);
    else if(['tt0118799','tt0087843','tt0347149','tt6751668','tt5311514'].includes(id))groups['Niche Movies'].push([id,name]);
    else if(['tt0903747','tt0944947','tt2861424','tt7366338','tt11280740'].includes(id))groups['Popular TV'].push([id,name]);
    else if(['tt2085059','tt0306414','tt5491994'].includes(id))groups['Niche TV'].push([id,name]);
    else if(['tt0388629','tt0877057','tt0434706','tt10919420','tt5370118'].includes(id))groups['Popular Anime'].push([id,name]);
    else groups['Niche Anime'].push([id,name]);
  }
  for(const [g,items] of Object.entries(groups)){
    if(!items.length)continue;
    const og=document.createElement('optgroup');og.label=g;
    for(const [id,name] of items){const o=document.createElement('option');o.value=id;o.textContent=name+' ('+id.split(':')[0]+')';og.appendChild(o);}
    sel.appendChild(og);
  }
}

async function runBench(){
  const imdb=document.getElementById('bench-title').value;
  if(!imdb){document.getElementById('bench-status').textContent='Select a title first';return;}
  const btn=document.getElementById('bench-run-btn');
  const status=document.getElementById('bench-status');
  btn.disabled=true;status.textContent='Running benchmark for '+BENCH_TITLES[imdb]+'...';
  const d=await safeJson('/api/benchmark?imdb='+encodeURIComponent(imdb));
  btn.disabled=false;
  if(!d){status.textContent='Benchmark failed';return;}
  status.textContent='Done — '+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
  renderBenchTable(d);
}

async function runAllBench(){
  const status=document.getElementById('bench-status');
  const el=document.getElementById('bench-results');
  const titles=Object.entries(BENCH_TITLES);
  status.textContent='Running all '+titles.length+' benchmarks (this takes a while)...';
  el.innerHTML='';
  let i=0;
  for(const [imdb,name] of titles){
    i++;status.textContent=`[${i}/${titles.length}] ${name}...`;
    const d=await safeJson('/api/benchmark?imdb='+encodeURIComponent(imdb));
    if(d)renderBenchTable(d,true);
  }
  status.textContent='All '+titles.length+' benchmarks complete';
}

function renderBenchTable(d,append){
  const el=document.getElementById('bench-results');
  const sum=d.summary||{};
  const sh=sum.self_hosted||{};
  const pub=sum.public||{};
  let h=`<div style="margin-bottom:1.2rem;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:.85rem;overflow-x:auto">`;
  h+=`<div style="display:flex;gap:.8rem;align-items:center;margin-bottom:.6rem;flex-wrap:wrap">`;
  h+=`<strong style="color:var(--accent2);font-size:.88rem">${esc(d.title)}</strong>`;
  h+=`<code style="font-size:.68rem">${esc(d.imdb)}</code>`;
  h+=`<span style="font-size:.68rem;color:var(--muted);margin-left:auto">${new Date(d.timestamp).toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false})}</span>`;
  h+=`</div>`;
  // Summary row
  h+=`<div style="display:flex;gap:1rem;margin-bottom:.6rem;flex-wrap:wrap">`;
  h+=`<div style="font-size:.72rem;padding:.3rem .6rem;background:var(--ok-bg);border-radius:6px;border:1px solid #065f46">Self-hosted: <strong style="color:var(--ok)">${sh.total_streams||0}</strong> streams, avg <strong style="color:var(--ok)">${sh.avg_latency_ms||'—'}</strong>ms</div>`;
  h+=`<div style="font-size:.72rem;padding:.3rem .6rem;background:#12232a;border-radius:6px;border:1px solid #164e63">Public: <strong style="color:#67e8f9">${pub.total_streams||0}</strong> streams, avg <strong style="color:#67e8f9">${pub.avg_latency_ms||'—'}</strong>ms</div>`;
  h+=`</div>`;
  // Table
  h+=`<table style="width:100%;border-collapse:collapse;font-size:.72rem"><thead><tr style="border-bottom:1px solid var(--border)">`;
  h+=`<th style="text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Name</th>`;
  h+=`<th style="text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Group</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Latency</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Streams</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">4K</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">1080p</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">720p</th>`;
  h+=`<th style="text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Codec</th>`;
  h+=`<th style="text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Status</th>`;
  h+=`</tr></thead><tbody>`;
  for(const r of (d.results||[])){
    const grpCls=r.group==='self-hosted'?'ok':'';
    const latCls=r.latency_ms!=null?(r.latency_ms<2000?'ok':r.latency_ms<5000?'warn':'err'):'muted';
    const res=r.resolutions||{};
    h+=`<tr style="border-bottom:1px solid #13172a">`;
    h+=`<td style="padding:.25rem .4rem;color:#e2e8f0;font-weight:600">${esc(r.name)}</td>`;
    h+=`<td style="padding:.25rem .4rem;color:var(--${grpCls||'accent2'})">${esc(r.group)}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right;color:var(--${latCls})">${r.latency_ms!=null?r.latency_ms+'ms':'—'}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right;color:var(--accent2);font-weight:700">${r.streams||0}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right">${res['4k']||0}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right">${res['1080p']||0}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right">${res['720p']||0}</td>`;
    h+=`<td style="padding:.25rem .4rem">${esc(r.top_codec||'—')}</td>`;
    h+=`<td style="padding:.25rem .4rem;color:var(--${r.error?'err':'ok'})">${r.error?esc(r.error):'OK'}</td>`;
    h+=`</tr>`;
  }
  h+=`</tbody></table></div>`;
  if(append)el.innerHTML+=h; else el.innerHTML=h;
}

// ── Init ──
refresh(); setInterval(refresh,30000);

// Fetch service status from public API
(async()=>{try{
  const r=await fetch('/api/public');const d=await r.json();
  const g=document.getElementById('svc-grid');
  const s=document.getElementById('svc-summary');
  if(!d.services){g.textContent='Unavailable';return}
  const svcs=Object.values(d.services);
  const up=svcs.filter(v=>v.ok===true).length;
  const total=svcs.length;
  g.innerHTML=svcs.map(v=>{
    const st=v.ok===true?'up':v.ok===false?'down':'unknown';
    return '<span class="svc-chip"><span class="dot '+st+'"></span>'+v.name+'</span>';
  }).join('');
  const pct=Math.round(up/total*100);
  const col=pct===100?'#34d399':pct>=90?'#fbbf24':'#f87171';
  s.innerHTML='<span style="color:'+col+';font-weight:700">'+up+'/'+total+'</span> services up ('+pct+'%)';
}catch(e){document.getElementById('svc-grid').textContent='Could not load status';}})();
</script>
</body></html>"""

DASH = DASH.replace("__UNITS__", _UNIT_OPTS)

# Inject benchmark titles into JS
import json as _json
DASH = DASH.replace("__BENCH_TITLES__", _json.dumps(BENCH_TITLES))

# Inject web panel URLs from config
DASH = DASH.replace("{{WEB_URLS_JSON}}", _json.dumps(cfg.WEB_URLS))

# Inject speedtest config into login page and dashboard
for _tpl_var, _tpl_val in [
    ("{{SPEEDTEST_DIRECT_URL}}", cfg.SPEEDTEST_DIRECT_URL),
    ("{{SPEEDTEST_DIRECT_NAME}}", cfg.SPEEDTEST_DIRECT_NAME),
    ("{{SPEEDTEST_CF_URL}}", cfg.SPEEDTEST_CF_URL),
    ("{{SPEEDTEST_CF_NAME}}", cfg.SPEEDTEST_CF_NAME),
]:
    DASH = DASH.replace(_tpl_var, _tpl_val)

LOGIN = """<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StreamMonitor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
@keyframes float{0%,100%{transform:translateY(0) rotate(0deg)}25%{transform:translateY(-8px) rotate(2deg)}75%{transform:translateY(4px) rotate(-1deg)}}
@keyframes pulse-glow{0%,100%{box-shadow:0 0 20px rgba(124,92,255,.15),0 0 60px rgba(124,92,255,.05)}50%{box-shadow:0 0 30px rgba(124,92,255,.25),0 0 80px rgba(124,92,255,.1)}}
@keyframes gradient-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes fade-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes signal{0%{transform:scale(1);opacity:.6}100%{transform:scale(2.5);opacity:0}}
@keyframes bar-glow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.3)}}
body{background:#060818;color:#e2e8f0;font-family:'Inter',system-ui,sans-serif;min-height:100vh;overflow-x:hidden;display:flex;align-items:center;justify-content:center}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(124,92,255,.07),transparent 50%),radial-gradient(ellipse at 70% 80%,rgba(99,102,241,.06),transparent 50%),radial-gradient(circle at 50% 50%,rgba(6,8,24,0),#060818 70%);pointer-events:none;z-index:0}
.stars{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.star{position:absolute;width:2px;height:2px;background:#fff;border-radius:50%;animation:twinkle var(--d,3s) ease-in-out infinite var(--delay,0s)}
@keyframes twinkle{0%,100%{opacity:.1}50%{opacity:.7}}
.wrapper{position:relative;z-index:1;width:420px;max-width:94vw;animation:fade-up .6s ease-out}
.card{background:rgba(12,15,28,.75);border:1px solid rgba(124,92,255,.12);border-radius:24px;padding:2.2rem 2rem 1.8rem;backdrop-filter:blur(24px);animation:pulse-glow 4s ease-in-out infinite}
.dish{text-align:center;margin-bottom:.4rem;position:relative}
.dish-icon{font-size:3.5rem;display:inline-block;animation:float 6s ease-in-out infinite;filter:drop-shadow(0 0 20px rgba(124,92,255,.4))}
.dish::after{content:'';position:absolute;top:50%;left:50%;width:16px;height:16px;background:rgba(124,92,255,.3);border-radius:50%;transform:translate(-50%,-50%);animation:signal 2s ease-out infinite}
.title{text-align:center;font-size:1.4rem;font-weight:800;background:linear-gradient(135deg,#818cf8,#a78bfa,#c4b5fd);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-size:200% 200%;animation:gradient-shift 4s ease infinite;letter-spacing:.02em}
.subtitle{text-align:center;font-size:.7rem;color:#475569;margin:.3rem 0 1.5rem;letter-spacing:.08em;text-transform:uppercase}
.field{margin-bottom:1rem}
.field label{display:block;font-size:.68rem;color:#64748b;margin-bottom:.35rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.field input{width:100%;background:rgba(6,8,24,.9);border:1px solid rgba(124,92,255,.1);color:#e2e8f0;border-radius:12px;padding:.7rem .9rem;font-size:.88rem;transition:all .25s ease;outline:none}
.field input:focus{border-color:rgba(124,92,255,.5);box-shadow:0 0 0 4px rgba(124,92,255,.08),0 0 20px rgba(124,92,255,.06)}
.field input::placeholder{color:#2a3050}
.btn{width:100%;background:linear-gradient(135deg,#7c5cff 0%,#6366f1 50%,#818cf8 100%);background-size:200% 200%;animation:gradient-shift 3s ease infinite;color:#fff;border:none;border-radius:12px;padding:.75rem;font-size:.9rem;cursor:pointer;font-weight:700;letter-spacing:.03em;transition:all .2s;margin-top:.6rem;position:relative;overflow:hidden}
.btn:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(124,92,255,.3)}
.btn:active{transform:translateY(0) scale(.99)}
.btn::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent);transform:translateX(-100%);transition:transform .5s}
.btn:hover::after{transform:translateX(100%)}
.err{color:#f87171;font-size:.78rem;margin-bottom:.75rem;text-align:center;padding:.45rem .6rem;background:rgba(248,113,113,.06);border:1px solid rgba(248,113,113,.12);border-radius:10px;animation:fade-up .3s ease}
.divider{height:1px;background:linear-gradient(90deg,transparent,rgba(124,92,255,.15),transparent);margin:1.6rem 0 1.2rem}
.speed-section h3{font-size:.65rem;color:#7c5cff;text-transform:uppercase;letter-spacing:.12em;font-weight:700;margin-bottom:.8rem;display:flex;align-items:center;gap:.4rem}
.speed-section h3::before{content:'';width:3px;height:12px;background:#7c5cff;border-radius:2px}
.stest{display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;background:rgba(6,8,24,.6);border:1px solid rgba(30,34,53,.5);border-radius:10px;margin-bottom:.6rem}
.stest .name{font-size:.72rem;color:#94a3b8;min-width:75px}
.stest .name small{display:block;font-size:.58rem;color:#374162}
.sbar{flex:1;height:6px;background:#111827;border-radius:3px;overflow:hidden}
.sbar .fill{height:100%;border-radius:3px;width:0%;transition:width .3s;background:linear-gradient(90deg,#7c5cff,#818cf8)}
.sbar .fill.ok{background:linear-gradient(90deg,#10b981,#34d399);animation:bar-glow 2s ease infinite}
.sbar .fill.err{background:#f87171}
.sval{font-size:.82rem;font-weight:700;min-width:80px;text-align:right;color:#475569;font-variant-numeric:tabular-nums}
.sval.done{color:#34d399}
.speed-controls{display:flex;gap:.5rem;align-items:center;margin-top:.6rem}
.speed-controls select{background:#0a0c14;border:1px solid #1e2235;color:#94a3b8;padding:.3rem .5rem;border-radius:6px;font-size:.7rem}
.speed-controls .sbtn{padding:.3rem .8rem;border-radius:6px;border:none;font-size:.7rem;font-weight:600;cursor:pointer;color:#818cf8;background:#1e2235;transition:all .15s}
.speed-controls .sbtn:hover{background:#252a42}
.speed-controls .sbtn:disabled{opacity:.4;cursor:not-allowed}
.speed-status{font-size:.6rem;color:#374162;margin-left:auto}
.speed-summary{font-size:.62rem;color:#64748b;margin-top:.6rem;padding:.5rem;background:rgba(6,8,24,.4);border-radius:8px;border:1px solid #111827;display:none}
.footer{text-align:center;margin-top:1rem;font-size:.58rem;color:#1e293b;letter-spacing:.05em}
.status-section{margin-top:.2rem}
.svc-title{font-size:.65rem;color:#7c5cff;text-transform:uppercase;letter-spacing:.12em;font-weight:700;margin-bottom:.6rem;display:flex;align-items:center;gap:.4rem}
.svc-title::before{content:'';width:3px;height:12px;background:#7c5cff;border-radius:2px}
.svc-grid{display:flex;flex-wrap:wrap;gap:.3rem}
.svc-chip{display:inline-flex;align-items:center;gap:.25rem;padding:.2rem .5rem;border-radius:6px;font-size:.58rem;font-weight:600;background:rgba(6,8,24,.6);border:1px solid rgba(30,34,53,.5)}
.svc-chip .dot{width:6px;height:6px;border-radius:50%}
.svc-chip .dot.up{background:#34d399;box-shadow:0 0 4px rgba(52,211,153,.4)}
.svc-chip .dot.down{background:#f87171;box-shadow:0 0 4px rgba(248,113,113,.4)}
.svc-chip .dot.unknown{background:#64748b}
.svc-summary{font-size:.6rem;color:#374162;margin-top:.5rem;text-align:center}
</style>
</head><body>
<div class="stars" id="stars"></div>
<div class="wrapper">
<div class="card">
  <div class="dish"><span class="dish-icon">&#x1F4E1;</span></div>
  <div class="title">StreamMonitor</div>
  <div class="subtitle">Infrastructure &amp; Streaming Stack</div>
  {ERR}
  <form method="post">
    <div class="field"><label>Username</label><input name="username" autocomplete="username" placeholder="admin" autofocus></div>
    <div class="field"><label>Password</label><input name="password" type="password" placeholder="Enter password" autocomplete="current-password"></div>
    <button class="btn" type="submit">Sign In</button>
  </form>
  <div class="divider"></div>
  <div class="speed-section">
    <h3>Speed Test</h3>
    <div class="stest"><span class="name">{{SPEEDTEST_DIRECT_NAME}}</span><div class="sbar"><div class="fill" id="bf-d"></div></div><span class="sval" id="sv-d">&mdash;</span></div>
    <div class="stest"><span class="name">{{SPEEDTEST_CF_NAME}}</span><div class="sbar"><div class="fill" id="bf-c"></div></div><span class="sval" id="sv-c">&mdash;</span></div>
    <div class="speed-controls">
      <select id="smb"><option value="10">10 MB</option><option value="25" selected>25 MB</option><option value="50">50 MB</option><option value="100">100 MB</option></select>
      <button class="sbtn" id="sbtn" onclick="runST()">Run Tests</button>
      <span class="speed-status" id="sst"></span>
    </div>
    <div class="speed-summary" id="ssum"></div>
  </div>
  <div class="divider"></div>
  <div class="status-section" id="svc-status">
    <h3 class="svc-title">SERVICE STATUS</h3>
    <div class="svc-grid" id="svc-grid"><div style="text-align:center;font-size:.65rem;color:#374162">Loading...</div></div>
    <div class="svc-summary" id="svc-summary"></div>
  </div>
  <div class="footer">Secure access only</div>
</div>
</div>
<script>
(()=>{const s=document.getElementById('stars');for(let i=0;i<60;i++){const d=document.createElement('div');d.className='star';d.style.left=Math.random()*100+'%';d.style.top=Math.random()*100+'%';d.style.setProperty('--d',(2+Math.random()*4)+'s');d.style.setProperty('--delay',Math.random()*3+'s');d.style.width=d.style.height=(1+Math.random()*1.5)+'px';s.appendChild(d)}})();
let srun=false;
async function runST(){
  if(srun)return;srun=true;
  const btn=document.getElementById('sbtn');btn.disabled=true;btn.textContent='Testing...';
  const mb=parseInt(document.getElementById('smb').value)||25;
  const st=document.getElementById('sst');
  const eps=[{id:'d',u:'{{SPEEDTEST_DIRECT_URL}}',n:'{{SPEEDTEST_DIRECT_NAME}}'},{id:'c',u:'{{SPEEDTEST_CF_URL}}',n:'{{SPEEDTEST_CF_NAME}}'}];
  const res=[];
  for(const ep of eps){
    st.textContent='Testing '+ep.n+'...';
    const bar=document.getElementById('bf-'+ep.id),val=document.getElementById('sv-'+ep.id);
    bar.style.width='0%';bar.className='fill';val.className='sval';val.textContent='Testing...';
    try{
      const r=await fetch(ep.u+'?mb='+mb+'&_t='+Date.now(),{cache:'no-store'});
      if(!r.ok){bar.style.width='100%';bar.classList.add('err');val.className='sval';val.textContent=r.status===429?'Rate limited':'Error '+r.status;res.push({n:ep.n,mbps:null});continue}
      const rd=r.body.getReader(),tot=parseInt(r.headers.get('content-length'))||mb*1048576;let got=0;const t0=performance.now();
      while(true){const{done,value}=await rd.read();if(done)break;got+=value.length;bar.style.width=Math.min(got/tot*100,100)+'%'}
      const el=(performance.now()-t0)/1000,mbps=(got*8/el/1e6).toFixed(1);
      bar.style.width='100%';bar.classList.add('ok');val.className='sval done';val.textContent=mbps+' Mbps';
      res.push({n:ep.n,mbps:parseFloat(mbps)});
    }catch(e){bar.style.width='100%';bar.classList.add('err');val.textContent='Failed';res.push({n:ep.n,mbps:null})}
  }
  const v=res.filter(r=>r.mbps!=null);
  if(v.length>1){
    const best=v.reduce((a,b)=>a.mbps>b.mbps?a:b);
    const diff=((best.mbps/Math.min(...v.map(x=>x.mbps)))-1)*100;
    const sm=document.getElementById('ssum');sm.style.display='block';
    sm.textContent=mb+' MB \u2014 '+best.n+' faster'+(diff>1?' by '+diff.toFixed(0)+'%':'')+' ('+v.map(r=>r.n+': '+r.mbps+' Mbps').join(', ')+')';
  }
  btn.disabled=false;btn.textContent='Run Tests';st.textContent='Done';srun=false;
}

// Fetch service status from public API
(async()=>{try{
  const r=await fetch('/api/public');const d=await r.json();
  const g=document.getElementById('svc-grid');
  const s=document.getElementById('svc-summary');
  if(!d.services){g.textContent='Unavailable';return}
  const svcs=Object.values(d.services);
  const up=svcs.filter(v=>v.ok===true).length;
  const total=svcs.length;
  g.innerHTML=svcs.map(v=>{
    const st=v.ok===true?'up':v.ok===false?'down':'unknown';
    return '<span class="svc-chip"><span class="dot '+st+'"></span>'+v.name+'</span>';
  }).join('');
  const pct=Math.round(up/total*100);
  const col=pct===100?'#34d399':pct>=90?'#fbbf24':'#f87171';
  s.innerHTML='<span style="color:'+col+';font-weight:700">'+up+'/'+total+'</span> services up ('+pct+'%)';
}catch(e){document.getElementById('svc-grid').textContent='Could not load status';}})();
</script>
</body></html>"""


# ── Routes ────────────────────────────────────────────────────────────────────

async def login(request: Request):
    err = ""
    if request.method == "POST":
        try:
            f = await request.form()
            if check_pw(str(f.get("username", "")), str(f.get("password", ""))):
                request.session["user"] = "admin"
                return RedirectResponse("/", status_code=303)
            err = "Invalid credentials"
        except Exception:
            err = "Login error — try again"
    _login_html = LOGIN.replace("{ERR}", f'<p class="err">{err}</p>' if err else "")
    for _tv, _vv in [("{{SPEEDTEST_DIRECT_URL}}", cfg.SPEEDTEST_DIRECT_URL),
                      ("{{SPEEDTEST_DIRECT_NAME}}", cfg.SPEEDTEST_DIRECT_NAME),
                      ("{{SPEEDTEST_CF_URL}}", cfg.SPEEDTEST_CF_URL),
                      ("{{SPEEDTEST_CF_NAME}}", cfg.SPEEDTEST_CF_NAME)]:
        _login_html = _login_html.replace(_tv, _vv)
    return HTMLResponse(_login_html)


async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@require_auth
async def dashboard(request: Request):
    return HTMLResponse(DASH)


async def ping(request: Request):
    return JSONResponse({"ok": True, "ts": datetime.now(timezone.utc).isoformat()})


@require_auth
async def api_status(request: Request):
    sid = request.path_params.get("service_id")
    def _default(s):
        return {"id": s, "name": cfg.SERVICES[s]["name"], "ok": None,
                "systemd": "unknown", "message": "pending", "latency_ms": None,
                "timestamp": None, "category": cfg.SERVICES[s].get("category", "other")}
    if sid:
        if sid not in cfg.SERVICES:
            return JSONResponse({"error": "unknown"}, status_code=404)
        return JSONResponse({
            "current": _health.cur.get(sid, _default(sid)),
            "history": list(_health.hist[sid]),
        })
    return JSONResponse({
        s: {"current": _health.cur.get(s, _default(s)), "history": list(_health.hist[s])}
        for s in cfg.SERVICES
    })


@require_auth
async def api_stats(request: Request):
    sid = request.path_params.get("service_id")
    if sid:
        return JSONResponse({
            "stats":      _stats.service_stats.get(sid, {}),
            "updated_at": _stats.stats_updated_at.get(sid),
        })
    return JSONResponse(_stats.service_stats)


@require_auth
async def api_versions(request: Request):
    result: dict[str, dict] = {}
    for sid in cfg.SERVICES:
        s  = _stats.service_stats.get(sid, {})
        gh = _stats.github_versions.get(sid, {})
        installed = (s.get("version") or s.get("addon_version") or
                     s.get("bazarr_version") or "")
        result[sid] = {
            "installed":    installed,
            "latest":       gh.get("latest", ""),
            "published_at": gh.get("published_at", ""),
            "prerelease":   gh.get("prerelease", False),
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
            "sudo", "journalctl", "-u", unit, "-n", n,
            "--no-pager", "--output=short-iso",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(p.communicate(), timeout=15)
        lines = out.decode(errors="replace").splitlines()
        if not lines and err:
            lines = ["[journalctl] " + err.decode(errors="replace").strip()]
        return JSONResponse({"unit": unit, "lines": lines})
    except asyncio.TimeoutError:
        return JSONResponse({"error": "timeout"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@require_auth
async def api_settings_keys_get(request: Request):
    import config as cfg2
    cfg2.reload_keys()
    result = {}
    for k, meta in cfg2.KEY_REGISTRY.items():
        attr = meta["attr"]
        val = getattr(cfg2, attr, "") or ""
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
        return JSONResponse({"ok": True, "updated": len(safe)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@require_auth
async def api_settings_password(request: Request):
    try:
        body = await request.json()
        cur_pw  = body.get("current", "")
        new_pw  = body.get("new_password", "")
        if not new_pw:
            return JSONResponse({"error": "New password required"}, status_code=400)
        if not check_pw("admin", cur_pw):
            return JSONResponse({"error": "Current password incorrect"}, status_code=403)
        new_hash = ph.hash(new_pw)
        _save_hash(new_hash)
        return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@require_auth
async def api_perms_scan(request: Request):
    import time as _time
    results = await asyncio.get_event_loop().run_in_executor(None, _perms.scan_perms)
    return JSONResponse({"results": results, "ts": _time.time()})


@require_auth
async def api_perms_fix(request: Request):
    try:
        fixes = await request.json()
        if not isinstance(fixes, list):
            return JSONResponse({"error": "expected list"}, status_code=400)
        tasks = [
            _perms.apply_fix(
                f["path"], f["user"], f["group"], f["mode"],
                bool(f.get("recursive", False))
            )
            for f in fixes if isinstance(f, dict) and "path" in f
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
    return JSONResponse({
        "errors":     errs,
        "last_scan":  _errors.last_scan_ts or None,
        "scan_count": _errors.scan_count,
        "total_errors":   sum(1 for e in errs if e.get("severity") == "error"),
        "total_warnings": sum(1 for e in errs if e.get("severity") == "warning"),
    })


@require_auth
async def api_errors_scan(request: Request):
    asyncio.create_task(_errors.scan_all())
    return JSONResponse({"ok": True})


async def api_settings_keys(request: Request):
    if request.method == "GET":
        return await api_settings_keys_get(request)
    return await api_settings_keys_post(request)


# ── Service control ────────────────────────────────────────────────────────────
_ALLOWED_UNITS = {c["unit"] for c in cfg.SERVICES.values() if c.get("unit")}

@require_auth
async def api_service_action(request: Request):
    unit   = request.path_params["unit"]
    action = request.path_params["action"]
    if unit not in _ALLOWED_UNITS:
        return JSONResponse({"error": "unit not allowed"}, status_code=403)
    if action not in ("start", "stop", "restart"):
        return JSONResponse({"error": "invalid action"}, status_code=400)
    try:
        p = await asyncio.create_subprocess_exec(
            "sudo", "systemctl", action, unit,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(p.communicate(), timeout=30)
        if p.returncode == 0:
            return JSONResponse({"ok": True})
        return JSONResponse({"error": err.decode().strip()[:300]}, status_code=500)
    except asyncio.TimeoutError:
        return JSONResponse({"error": "systemctl timed out"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── App ───────────────────────────────────────────────────────────────────────
app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/login",                   login,            methods=["GET", "POST"]),
        Route("/logout",                  logout),
        Route("/",                        dashboard),
        Route("/api/ping",                ping),
        Route("/api/status",              api_status),
        Route("/api/status/{service_id}", api_status),
        Route("/api/stats",               api_stats),
        Route("/api/stats/{service_id}",  api_stats),
        Route("/api/versions",            api_versions),
        Route("/api/logs/{unit}",         api_logs),
        Route("/api/service/{unit}/{action}", api_service_action, methods=["POST"]),
        Route("/api/perms/scan",           api_perms_scan,  methods=["POST"]),
        Route("/api/perms/fix",            api_perms_fix,   methods=["POST"]),
        Route("/api/errors",               api_errors,            methods=["GET", "DELETE"]),
        Route("/api/errors/scan",          api_errors_scan,       methods=["POST"]),
        Route("/api/settings/keys",       api_settings_keys,     methods=["GET", "POST"]),
        Route("/api/settings/password",   api_settings_password, methods=["POST"]),
        Route("/api/benchmark",           require_auth(api_benchmark)),
        Route("/api/jellyfin",            require_auth(api_jellyfin)),
        Route("/api/dmesg",               require_auth(api_dmesg)),
        Route("/api/public",              api_public),
        Route("/speedtest",               require_auth(speedtest_page)),
        Route("/speedtest/download",      speedtest_download),
    ],
    middleware=[Middleware(SessionMiddleware, secret_key=SECRET_KEY, max_age=86400)],
)
