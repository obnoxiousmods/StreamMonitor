/* --- Stars with parallax --- */
;(() => {
  const s = document.getElementById('stars')
  const stars = []
  for (let i = 0; i < 80; i++) {
    const d = document.createElement('div')
    d.className = 'star'
    const x = Math.random() * 100,
      y = Math.random() * 100
    d.style.left = x + '%'
    d.style.top = y + '%'
    d.style.setProperty('--d', 2 + Math.random() * 4 + 's')
    d.style.setProperty('--delay', Math.random() * 3 + 's')
    const sz = 1 + Math.random() * 1.5
    d.style.width = d.style.height = sz + 'px'
    s.appendChild(d)
    stars.push({ el: d, ox: x, oy: y, depth: 0.2 + Math.random() * 0.8 })
  }
  /* Parallax on mouse move */
  let mx = 0.5,
    my = 0.5
  document.addEventListener('mousemove', (e) => {
    mx = e.clientX / window.innerWidth
    my = e.clientY / window.innerHeight
  })
  let raf
  function updateParallax() {
    const dx = (mx - 0.5) * 20,
      dy = (my - 0.5) * 20
    for (const st of stars) {
      const px = st.ox + dx * st.depth,
        py = st.oy + dy * st.depth
      st.el.style.left = px + '%'
      st.el.style.top = py + '%'
    }
    raf = requestAnimationFrame(updateParallax)
  }
  updateParallax()
})()

/* --- Animated gradient border angle (JS fallback for browsers without @property) --- */
;(() => {
  const card = document.querySelector('.card-border')
  if (!card) return
  /* Test if CSS @property --angle works natively */
  if (CSS && CSS.registerProperty) {
    try {
      CSS.registerProperty({ name: '--angle', syntax: '<angle>', initialValue: '0deg', inherits: false })
    } catch (e) {}
  }
  /* JS fallback rotation */
  let angle = 0
  function rotateBorder() {
    angle = (angle + 1) % 360
    card.style.setProperty('--angle', angle + 'deg')
    requestAnimationFrame(rotateBorder)
  }
  rotateBorder()
})()

/* --- Show endpoint domain labels --- */
;(() => {
  function extractDomain(url) {
    try {
      return new URL(url).hostname
    } catch (e) {
      return ''
    }
  }
  const epD = document.getElementById('ep-d')
  const epC = document.getElementById('ep-c')
  if (epD && typeof SPEEDTEST_DIRECT_URL !== 'undefined') epD.textContent = extractDomain(SPEEDTEST_DIRECT_URL)
  if (epC && typeof SPEEDTEST_CF_URL !== 'undefined') epC.textContent = extractDomain(SPEEDTEST_CF_URL)
})()

/* --- Footer year --- */
;(() => {
  const el = document.querySelector('.footer-year')
  if (el) el.textContent = '\u00A9 ' + new Date().getFullYear()
})()

/* --- Speed Test --- */
let srun = false
async function runST() {
  if (srun) return
  srun = true
  const btn = document.getElementById('sbtn')
  btn.disabled = true
  btn.textContent = 'Testing...'
  const mb = parseInt(document.getElementById('smb').value) || 25
  const st = document.getElementById('sst')
  const eps = [
    { id: 'd', u: SPEEDTEST_DIRECT_URL, n: SPEEDTEST_DIRECT_NAME },
    { id: 'c', u: SPEEDTEST_CF_URL, n: SPEEDTEST_CF_NAME },
  ]
  const res = []
  for (const ep of eps) {
    st.textContent = 'Testing ' + ep.n + '...'
    const bar = document.getElementById('bf-' + ep.id),
      val = document.getElementById('sv-' + ep.id)
    bar.style.width = '0%'
    bar.className = 'fill'
    val.className = 'sval'
    val.textContent = 'Testing...'
    try {
      const r = await fetch(ep.u + '?mb=' + mb + '&_t=' + Date.now(), { cache: 'no-store' })
      if (!r.ok) {
        bar.style.width = '100%'
        bar.classList.add('err')
        val.className = 'sval'
        val.textContent = r.status === 429 ? 'Rate limited' : 'Error ' + r.status
        res.push({ n: ep.n, mbps: null })
        continue
      }
      const rd = r.body.getReader(),
        tot = parseInt(r.headers.get('content-length')) || mb * 1048576
      let got = 0
      const t0 = performance.now()
      while (true) {
        const { done, value } = await rd.read()
        if (done) break
        got += value.length
        bar.style.width = Math.min((got / tot) * 100, 100) + '%'
      }
      const el = (performance.now() - t0) / 1000,
        mbps = ((got * 8) / el / 1e6).toFixed(1)
      bar.style.width = '100%'
      bar.classList.add('ok')
      val.className = 'sval done'
      val.textContent = mbps + ' Mbps'
      res.push({ n: ep.n, mbps: parseFloat(mbps) })
    } catch (e) {
      bar.style.width = '100%'
      bar.classList.add('err')
      val.textContent = 'Failed'
      res.push({ n: ep.n, mbps: null })
    }
  }
  const v = res.filter((r) => r.mbps != null)
  if (v.length > 1) {
    const best = v.reduce((a, b) => (a.mbps > b.mbps ? a : b))
    const worst = Math.min(...v.map((x) => x.mbps))
    const diff = (best.mbps / worst - 1) * 100
    const sm = document.getElementById('ssum')
    sm.style.display = 'block'
    let html = v.map((r) => r.n + ': <strong>' + r.mbps + ' Mbps</strong>').join(' &nbsp;\u2022&nbsp; ')
    if (diff > 1) {
      html += '<span class="speed-delta">\u2014 ' + best.n + ' is ' + diff.toFixed(0) + '% faster</span>'
    }
    sm.innerHTML = html
  }
  btn.disabled = false
  btn.textContent = 'Run Tests'
  st.textContent = 'Done'
  srun = false
}

/* --- Service Status with category grouping --- */
const CATEGORY_ORDER = ['system', 'streaming', 'indexers', 'arr', 'media', 'dispatch', 'downloads', 'infra']
const CATEGORY_LABELS = {
  system: 'System',
  streaming: 'Streaming Stack',
  indexers: 'Indexers',
  arr: 'Arr Suite',
  media: 'Media Servers',
  dispatch: 'Dispatching',
  downloads: 'Downloads',
  infra: 'Infrastructure',
  other: 'Other',
}

;(async () => {
  try {
    const r = await fetch('/api/public')
    const d = await r.json()
    const g = document.getElementById('svc-grid')
    const s = document.getElementById('svc-summary')
    if (!d.services) {
      g.textContent = 'Unavailable'
      return
    }

    /* Group by category */
    const cats = {}
    for (const [sid, svc] of Object.entries(d.services)) {
      const cat = svc.category || 'other'
      if (!cats[cat]) cats[cat] = { label: CATEGORY_LABELS[cat] || cat, services: [] }
      cats[cat].services.push(svc)
    }

    /* Sort categories by predefined order */
    const sortedCats = CATEGORY_ORDER.filter((c) => cats[c]).map((c) => ({ key: c, ...cats[c] }))
    /* Append any categories not in the order list */
    for (const k of Object.keys(cats)) {
      if (!CATEGORY_ORDER.includes(k)) sortedCats.push({ key: k, ...cats[k] })
    }

    let html = ''
    for (const cat of sortedCats) {
      const up = cat.services.filter((sv) => sv.ok === true).length
      const total = cat.services.length
      html += '<div class="svc-cat-group">'
      html += '<div class="svc-cat-header"><span class="svc-cat-label">' + cat.label + '</span>'
      html += '<span class="svc-cat-count"><span class="cnt-up">' + up + '</span>/' + total + ' online</span></div>'
      html += '<div class="svc-cat-chips">'
      for (const sv of cat.services) {
        const st = sv.ok === true ? 'up' : sv.ok === false ? 'down' : 'unknown'
        html += '<span class="svc-chip"><span class="dot ' + st + '"></span>' + sv.name + '</span>'
      }
      html += '</div></div>'
    }
    g.innerHTML = html

    const totalAll = Object.keys(d.services).length
    const upAll = Object.values(d.services).filter((sv) => sv.ok === true).length
    const pct = Math.round((upAll / totalAll) * 100)
    const col = pct === 100 ? '#34d399' : pct >= 90 ? '#fbbf24' : '#f87171'
    s.innerHTML =
      '<span style="color:' + col + ';font-weight:700">' + upAll + '/' + totalAll + '</span> services up (' + pct + '%)'
  } catch (e) {
    document.getElementById('svc-grid').textContent = 'Could not load status'
  }
})()
