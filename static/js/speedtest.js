const endpoints = [
  { id: 'direct', label: SPEEDTEST_DIRECT_NAME, url: SPEEDTEST_DIRECT_URL },
  { id: 'cf', label: SPEEDTEST_CF_NAME, url: SPEEDTEST_CF_URL },
]

let running = false

async function testEndpoint(ep, mb) {
  const bar = document.getElementById('bar-' + ep.id)
  const res = document.getElementById('res-' + ep.id)
  bar.style.width = '0%'
  bar.className = 'bar-fill'
  res.className = 'result'
  res.textContent = 'Testing...'

  const url = ep.url + '?mb=' + mb + '&_t=' + Date.now()
  try {
    const resp = await fetch(url, { cache: 'no-store' })
    if (!resp.ok) {
      bar.style.width = '100%'
      bar.classList.add('error')
      res.className = 'result error'
      res.textContent = resp.status === 429 ? 'Rate limited' : 'HTTP ' + resp.status
      return { id: ep.id, label: ep.label, mbps: null, error: true }
    }

    const reader = resp.body.getReader()
    const total = parseInt(resp.headers.get('content-length')) || mb * 1048576
    let received = 0
    const t0 = performance.now()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      const pct = Math.min((received / total) * 100, 100)
      bar.style.width = pct + '%'
    }

    const elapsed = (performance.now() - t0) / 1000
    const mbps = ((received * 8) / elapsed / 1e6).toFixed(1)

    bar.style.width = '100%'
    bar.classList.add('done')
    res.className = 'result speed'
    res.textContent = mbps + ' Mbps'
    return { id: ep.id, label: ep.label, mbps: parseFloat(mbps), error: false }
  } catch (e) {
    bar.style.width = '100%'
    bar.classList.add('error')
    res.className = 'result error'
    res.textContent = 'Failed'
    return { id: ep.id, label: ep.label, mbps: null, error: true }
  }
}

async function runAll() {
  if (running) return
  running = true
  const btn = document.getElementById('btn-run')
  const status = document.getElementById('status')
  btn.disabled = true
  btn.textContent = 'Testing...'
  status.textContent = ''

  const mb = parseInt(document.getElementById('sel-mb').value) || 25
  const results = []

  for (const ep of endpoints) {
    status.textContent = 'Testing ' + ep.label + '...'
    results.push(await testEndpoint(ep, mb))
  }

  const sumEl = document.getElementById('summary')
  const rowsEl = document.getElementById('summary-rows')
  sumEl.style.display = 'block'

  const valid = results.filter((r) => !r.error && r.mbps != null)
  const best = valid.length ? valid.reduce((a, b) => (a.mbps > b.mbps ? a : b)) : null

  let html = ''
  for (const r of results) {
    const win = best && r.id === best.id && valid.length > 1 ? ' winner' : ''
    html +=
      '<div class="summary-row"><span class="k">' +
      r.label +
      '</span><span class="v' +
      win +
      '">' +
      (r.error ? 'Error' : r.mbps + ' Mbps' + (win ? ' \u2605' : '')) +
      '</span></div>'
  }
  if (best && valid.length > 1) {
    const diff = (best.mbps / Math.min(...valid.map((v) => v.mbps)) - 1) * 100
    html +=
      '<div class="summary-row"><span class="k">Winner</span><span class="v winner">' +
      best.label +
      (diff > 1 ? ' (+' + diff.toFixed(0) + '%)' : '') +
      '</span></div>'
  }
  rowsEl.innerHTML = html

  btn.disabled = false
  btn.textContent = 'Run Speed Test'
  status.textContent = 'Done'
  running = false
}
