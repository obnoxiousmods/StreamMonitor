/* --- Stars with parallax --- */
;(() => {
  const starsContainer = document.getElementById('stars')
  const stars = []
  for (let i = 0; i < 80; i++) {
    const starElement = document.createElement('div')
    starElement.className = 'star'
    const posX = Math.random() * 100,
      posY = Math.random() * 100
    starElement.style.left = posX + '%'
    starElement.style.top = posY + '%'
    starElement.style.setProperty('--d', 2 + Math.random() * 4 + 's')
    starElement.style.setProperty('--delay', Math.random() * 3 + 's')
    const size = 1 + Math.random() * 1.5
    starElement.style.width = starElement.style.height = size + 'px'
    starsContainer.appendChild(starElement)
    stars.push({
      element: starElement,
      originX: posX,
      originY: posY,
      depth: 0.2 + Math.random() * 0.8,
    })
  }
  /* Parallax on mouse move */
  let mouseNormalizedX = 0.5,
    mouseNormalizedY = 0.5
  document.addEventListener('mousemove', (e) => {
    mouseNormalizedX = e.clientX / window.innerWidth
    mouseNormalizedY = e.clientY / window.innerHeight
  })
  function updateParallax() {
    const offsetX = (mouseNormalizedX - 0.5) * 20,
      offsetY = (mouseNormalizedY - 0.5) * 20
    for (const star of stars) {
      const parallaxX = star.originX + offsetX * star.depth,
        parallaxY = star.originY + offsetY * star.depth
      star.element.style.left = parallaxX + '%'
      star.element.style.top = parallaxY + '%'
    }
    requestAnimationFrame(updateParallax)
  }
  updateParallax()
})()

/* --- Animated gradient border angle (JS fallback for browsers without @property) --- */
;(() => {
  const card = document.querySelector('.card-border')
  if (!card) return
  /* Test if CSS @property works natively */
  if (CSS && CSS.registerProperty) {
    try {
      CSS.registerProperty({
        name: '--angle',
        syntax: '<angle>',
        initialValue: '0deg',
        inherits: false,
      })
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
  const directEndpointLabel = document.getElementById('ep-d')
  const cfEndpointLabel = document.getElementById('ep-c')
  if (directEndpointLabel && typeof SPEEDTEST_DIRECT_URL !== 'undefined')
    directEndpointLabel.textContent = extractDomain(SPEEDTEST_DIRECT_URL)
  if (cfEndpointLabel && typeof SPEEDTEST_CF_URL !== 'undefined')
    cfEndpointLabel.textContent = extractDomain(SPEEDTEST_CF_URL)
})()

/* --- Footer year --- */
;(() => {
  const el = document.querySelector('.footer-year')
  if (el) el.textContent = '\u00A9 ' + new Date().getFullYear()
})()

/* --- Speed Test --- */
let speedTestRunning = false
async function runSpeedTest() {
  if (speedTestRunning) return
  speedTestRunning = true
  const runButton = document.getElementById('sbtn')
  runButton.disabled = true
  runButton.textContent = 'Testing...'
  const payloadSizeMb = parseInt(document.getElementById('smb').value) || 25
  const statusElement = document.getElementById('sst')
  const endpoints = [
    {
      id: 'd',
      url: SPEEDTEST_DIRECT_URL,
      name: SPEEDTEST_DIRECT_NAME,
    },
    {
      id: 'c',
      url: SPEEDTEST_CF_URL,
      name: SPEEDTEST_CF_NAME,
    },
  ]
  const results = []
  for (const endpoint of endpoints) {
    statusElement.textContent = 'Testing ' + endpoint.name + '...'
    const progressBar = document.getElementById('bf-' + endpoint.id),
      valueLabel = document.getElementById('sv-' + endpoint.id)
    progressBar.style.width = '0%'
    progressBar.className = 'fill'
    valueLabel.className = 'sval'
    valueLabel.textContent = 'Testing...'
    try {
      let receivedBytes = 0
      const totalExpected = payloadSizeMb * 1048576
      const startTime = performance.now()
      await axios.get(endpoint.url + '?mb=' + payloadSizeMb + '&_t=' + Date.now(), {
        responseType: 'arraybuffer',
        onDownloadProgress: (e) => {
          receivedBytes = e.loaded
          progressBar.style.width = Math.min((e.loaded / (e.total || totalExpected)) * 100, 100) + '%'
        },
      })
      const elapsedSeconds = (performance.now() - startTime) / 1000,
        mbps = ((receivedBytes * 8) / elapsedSeconds / 1e6).toFixed(1)
      progressBar.style.width = '100%'
      progressBar.classList.add('ok')
      valueLabel.className = 'sval done'
      valueLabel.textContent = mbps + ' Mbps'
      results.push({ n: endpoint.name, mbps: parseFloat(mbps) })
    } catch (e) {
      progressBar.style.width = '100%'
      progressBar.classList.add('err')
      if (e.response) {
        valueLabel.className = 'sval'
        valueLabel.textContent = e.response.status === 429 ? 'Rate limited' : 'Error ' + e.response.status
      } else {
        valueLabel.textContent = 'Failed'
      }
      results.push({ n: endpoint.name, mbps: null })
    }
  }
  const validResults = results.filter((r) => r.mbps != null)
  if (validResults.length > 1) {
    const best = validResults.reduce((a, b) => (a.mbps > b.mbps ? a : b))
    const worst = Math.min(...validResults.map((x) => x.mbps))
    const diff = (best.mbps / worst - 1) * 100
    const summaryElement = document.getElementById('ssum')
    summaryElement.style.display = 'block'
    let html = validResults.map((r) => r.n + ': <strong>' + r.mbps + ' Mbps</strong>').join(' &nbsp;\u2022&nbsp; ')
    if (diff > 1) {
      html += '<span class="speed-delta">\u2014 ' + best.n + ' is ' + diff.toFixed(0) + '% faster</span>'
    }
    summaryElement.innerHTML = html
  }
  runButton.disabled = false
  runButton.textContent = 'Run Tests'
  statusElement.textContent = 'Done'
  speedTestRunning = false
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
    const { data } = await axios.get('/api/public')
    const gridElement = document.getElementById('svc-grid')
    const summaryElement = document.getElementById('svc-summary')
    if (!data.services) {
      gridElement.textContent = 'Unavailable'
      return
    }

    /* Group by category */
    const categories = {}
    for (const [serviceId, service] of Object.entries(data.services)) {
      const cat = service.category || 'other'
      if (!categories[cat]) categories[cat] = { label: CATEGORY_LABELS[cat] || cat, services: [] }
      categories[cat].services.push(service)
    }

    /* Sort categories by predefined order */
    const sortedCategories = CATEGORY_ORDER.filter((c) => categories[c]).map((c) => ({ key: c, ...categories[c] }))
    /* Append any categories not in the order list */
    for (const k of Object.keys(categories)) {
      if (!CATEGORY_ORDER.includes(k)) sortedCategories.push({ key: k, ...categories[k] })
    }

    let html = ''
    for (const cat of sortedCategories) {
      const up = cat.services.filter((service) => service.ok === true).length
      const total = cat.services.length
      html += '<div class="svc-cat-group">'
      html += '<div class="svc-cat-header"><span class="svc-cat-label">' + cat.label + '</span>'
      html += '<span class="svc-cat-count"><span class="cnt-up">' + up + '</span>/' + total + ' online</span></div>'
      html += '<div class="svc-cat-chips">'
      for (const service of cat.services) {
        const status = service.ok === true ? 'up' : service.ok === false ? 'down' : 'unknown'
        html += '<span class="svc-chip"><span class="dot ' + status + '"></span>' + service.name + '</span>'
      }
      html += '</div></div>'
    }
    gridElement.innerHTML = html

    const totalAll = Object.keys(data.services).length
    const upAll = Object.values(data.services).filter((service) => service.ok === true).length
    const uptimePercent = Math.round((upAll / totalAll) * 100)
    const statusColor = uptimePercent === 100 ? '#34d399' : uptimePercent >= 90 ? '#fbbf24' : '#f87171'
    summaryElement.innerHTML =
      '<span style="color:' +
      statusColor +
      ';font-weight:700">' +
      upAll +
      '/' +
      totalAll +
      '</span> services up (' +
      uptimePercent +
      '%)'
  } catch (e) {
    document.getElementById('svc-grid').textContent = 'Could not load status'
  }
})()
