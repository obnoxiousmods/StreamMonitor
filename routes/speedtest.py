"""Speed test page and download endpoint."""
from __future__ import annotations

import os
import time
from collections import defaultdict

from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, StreamingResponse

import config as cfg

# ── Rate limiting: 2 tests per 10 minutes per IP ─────────────────────────────
_rate: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT = 6
_RATE_WINDOW = 600  # 10 minutes
_MAX_MB = 500
_THROTTLE_BYTES_PER_SEC = 125_000_000  # 1 Gbps


def _check_rate(ip: str) -> bool:
    now = time.monotonic()
    _rate[ip] = [t for t in _rate[ip] if now - t < _RATE_WINDOW]
    if len(_rate[ip]) >= _RATE_LIMIT:
        return False
    _rate[ip].append(now)
    return True


def _client_ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")


# ── Download endpoint ─────────────────────────────────────────────────────────

async def speedtest_download(request: Request):
    """Generate random bytes for speed testing with throttling."""
    ip = _client_ip(request)
    if not _check_rate(ip):
        return JSONResponse(
            {"error": "Rate limit exceeded. Max 2 tests per 10 minutes."},
            status_code=429,
        )

    try:
        mb = min(int(request.query_params.get("mb", "25")), _MAX_MB)
    except (ValueError, TypeError):
        mb = 25

    total_bytes = mb * 1024 * 1024
    chunk_size = 65536  # 64 KB chunks

    async def generate():
        sent = 0
        while sent < total_bytes:
            remaining = total_bytes - sent
            size = min(chunk_size, remaining)
            yield os.urandom(size)
            sent += size

    return StreamingResponse(
        generate(),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(total_bytes),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Length",
        },
    )


# ── Speed test HTML page ─────────────────────────────────────────────────────

_SPEEDTEST_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Speed Test - StreamMonitor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0c14;color:#e2e8f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
.container{width:100%;max-width:560px}
.card{background:#111422;border:1px solid #1e2235;border-radius:16px;padding:2rem;backdrop-filter:blur(12px)}
.header{text-align:center;margin-bottom:2rem}
.header .icon{font-size:3rem;margin-bottom:.5rem;display:block}
.header h1{font-size:1.3rem;color:#818cf8;font-weight:700;letter-spacing:.02em}
.header p{font-size:.75rem;color:#64748b;margin-top:.4rem}
.test-group{margin-bottom:1.5rem}
.test-group h3{font-size:.72rem;color:#7c5cff;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:.8rem;padding-bottom:.3rem;border-bottom:1px solid #1e2235}
.test-row{display:flex;align-items:center;gap:.8rem;margin-bottom:1rem;padding:.6rem .8rem;background:#0a0c14;border:1px solid #1e2235;border-radius:10px}
.test-label{font-size:.78rem;color:#94a3b8;min-width:85px}
.bar-wrap{flex:1;height:8px;background:#1a1f35;border-radius:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#7c5cff,#818cf8);width:0%;transition:width .3s ease}
.bar-fill.done{background:linear-gradient(90deg,#34d399,#6ee7b7)}
.bar-fill.error{background:linear-gradient(90deg,#f87171,#fca5a5)}
.result{font-size:.88rem;font-weight:700;color:#e2e8f0;min-width:100px;text-align:right;font-variant-numeric:tabular-nums}
.result.speed{color:#34d399}
.result.error{color:#f87171;font-size:.72rem}
.controls{display:flex;gap:.7rem;flex-wrap:wrap;align-items:center;margin-top:1.5rem}
.btn{padding:.55rem 1.3rem;border-radius:8px;border:none;font-size:.82rem;font-weight:600;cursor:pointer;transition:all .15s}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-primary{background:#7c5cff;color:#fff}.btn-primary:hover:not(:disabled){background:#6d4de6}
.btn-secondary{background:#1e2235;color:#818cf8;border:1px solid #2d334f}.btn-secondary:hover:not(:disabled){background:#252a42}
select{background:#0a0c14;border:1px solid #1e2235;color:#e2e8f0;padding:.4rem .6rem;border-radius:6px;font-size:.78rem}
select:focus{outline:none;border-color:#7c5cff}
.status{font-size:.68rem;color:#64748b;margin-left:auto}
.summary{margin-top:1.5rem;padding:1rem;background:#0a0c14;border:1px solid #1e2235;border-radius:10px;display:none}
.summary h3{font-size:.7rem;color:#7c5cff;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.6rem}
.summary-row{display:flex;justify-content:space-between;font-size:.78rem;padding:.2rem 0;border-bottom:1px solid #13172a}
.summary-row:last-child{border-bottom:none}
.summary-row .k{color:#64748b}.summary-row .v{color:#e2e8f0;font-weight:600}
.v.winner{color:#34d399}
</style>
</head>
<body>
<div class="container">
<div class="card">
  <div class="header">
    <span class="icon">&#x1F4E1;</span>
    <h1>Speed Test</h1>
    <p>Test download speed via direct and Cloudflare endpoints</p>
  </div>

  <div class="test-group">
    <h3>Direct (Origin)</h3>
    <div class="test-row" id="row-direct">
      <span class="test-label">Download</span>
      <div class="bar-wrap"><div class="bar-fill" id="bar-direct"></div></div>
      <span class="result" id="res-direct">&mdash;</span>
    </div>
  </div>

  <div class="test-group">
    <h3>Cloudflare (CDN)</h3>
    <div class="test-row" id="row-cf">
      <span class="test-label">Download</span>
      <div class="bar-wrap"><div class="bar-fill" id="bar-cf"></div></div>
      <span class="result" id="res-cf">&mdash;</span>
    </div>
  </div>

  <div class="controls">
    <button class="btn btn-primary" id="btn-run" onclick="runAll()">Run Speed Test</button>
    <select id="sel-mb">
      <option value="10">10 MB</option>
      <option value="25" selected>25 MB</option>
      <option value="50">50 MB</option>
      <option value="100">100 MB</option>
      <option value="250">250 MB</option>
      <option value="500">500 MB</option>
    </select>
    <span class="status" id="status"></span>
  </div>

  <div class="summary" id="summary">
    <h3>Results</h3>
    <div id="summary-rows"></div>
  </div>
</div>
</div>

<script>
const endpoints = [
  { id: 'direct', label: '{{SPEEDTEST_DIRECT_NAME}}', url: '{{SPEEDTEST_DIRECT_URL}}' },
  { id: 'cf',     label: '{{SPEEDTEST_CF_NAME}}', url: '{{SPEEDTEST_CF_URL}}' },
];

let running = false;

async function testEndpoint(ep, mb) {
  const bar = document.getElementById('bar-' + ep.id);
  const res = document.getElementById('res-' + ep.id);
  bar.style.width = '0%';
  bar.className = 'bar-fill';
  res.className = 'result';
  res.textContent = 'Testing...';

  const url = ep.url + '?mb=' + mb + '&_t=' + Date.now();
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      bar.style.width = '100%';
      bar.classList.add('error');
      res.className = 'result error';
      res.textContent = resp.status === 429 ? 'Rate limited' : 'HTTP ' + resp.status;
      return { id: ep.id, label: ep.label, mbps: null, error: true };
    }

    const reader = resp.body.getReader();
    const total = parseInt(resp.headers.get('content-length')) || (mb * 1048576);
    let received = 0;
    const t0 = performance.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      const pct = Math.min((received / total) * 100, 100);
      bar.style.width = pct + '%';
    }

    const elapsed = (performance.now() - t0) / 1000;
    const mbps = ((received * 8) / elapsed / 1e6).toFixed(1);

    bar.style.width = '100%';
    bar.classList.add('done');
    res.className = 'result speed';
    res.textContent = mbps + ' Mbps';
    return { id: ep.id, label: ep.label, mbps: parseFloat(mbps), error: false };
  } catch (e) {
    bar.style.width = '100%';
    bar.classList.add('error');
    res.className = 'result error';
    res.textContent = 'Failed';
    return { id: ep.id, label: ep.label, mbps: null, error: true };
  }
}

async function runAll() {
  if (running) return;
  running = true;
  const btn = document.getElementById('btn-run');
  const status = document.getElementById('status');
  btn.disabled = true;
  btn.textContent = 'Testing...';
  status.textContent = '';

  const mb = parseInt(document.getElementById('sel-mb').value) || 25;
  const results = [];

  for (const ep of endpoints) {
    status.textContent = 'Testing ' + ep.label + '...';
    results.push(await testEndpoint(ep, mb));
  }

  // Show summary
  const sumEl = document.getElementById('summary');
  const rowsEl = document.getElementById('summary-rows');
  sumEl.style.display = 'block';

  const valid = results.filter(r => !r.error && r.mbps != null);
  const best = valid.length ? valid.reduce((a, b) => a.mbps > b.mbps ? a : b) : null;

  let html = '';
  for (const r of results) {
    const win = best && r.id === best.id && valid.length > 1 ? ' winner' : '';
    html += '<div class="summary-row"><span class="k">' + r.label + '</span><span class="v' + win + '">' +
      (r.error ? 'Error' : r.mbps + ' Mbps' + (win ? ' ★' : '')) + '</span></div>';
  }
  if (best && valid.length > 1) {
    const diff = ((best.mbps / Math.min(...valid.map(v => v.mbps))) - 1) * 100;
    html += '<div class="summary-row"><span class="k">Winner</span><span class="v winner">' +
      best.label + (diff > 1 ? ' (+' + diff.toFixed(0) + '%)' : '') + '</span></div>';
  }
  rowsEl.innerHTML = html;

  btn.disabled = false;
  btn.textContent = 'Run Speed Test';
  status.textContent = 'Done';
  running = false;
}
</script>
</body>
</html>"""


async def speedtest_page(request: Request):
    """Serve the speed test HTML page."""
    html = _SPEEDTEST_HTML.replace("{{SPEEDTEST_DIRECT_URL}}", cfg.SPEEDTEST_DIRECT_URL)
    html = html.replace("{{SPEEDTEST_DIRECT_NAME}}", cfg.SPEEDTEST_DIRECT_NAME)
    html = html.replace("{{SPEEDTEST_CF_URL}}", cfg.SPEEDTEST_CF_URL)
    html = html.replace("{{SPEEDTEST_CF_NAME}}", cfg.SPEEDTEST_CF_NAME)
    return HTMLResponse(html)
