const endpoints = [
  { id: 'direct', label: SPEEDTEST_DIRECT_NAME, url: SPEEDTEST_DIRECT_URL },
  { id: 'cf', label: SPEEDTEST_CF_NAME, url: SPEEDTEST_CF_URL },
]

let testRunning = false

async function testEndpoint(endpoint, payloadSizeMb) {
  const progressBar = document.getElementById('bar-' + endpoint.id)
  const resultLabel = document.getElementById('res-' + endpoint.id)
  progressBar.style.width = '0%'
  progressBar.className = 'bar-fill'
  resultLabel.className = 'result'
  resultLabel.textContent = 'Testing...'

  const url = endpoint.url + '?mb=' + payloadSizeMb + '&_t=' + Date.now()
  try {
    let received = 0
    const totalExpected = payloadSizeMb * 1048576
    const startTime = performance.now()
    await axios.get(url, {
      responseType: 'arraybuffer',
      onDownloadProgress: (e) => {
        received = e.loaded
        const percent = Math.min((e.loaded / (e.total || totalExpected)) * 100, 100)
        progressBar.style.width = percent + '%'
      },
    })
    const elapsed = (performance.now() - startTime) / 1000
    const mbps = ((received * 8) / elapsed / 1e6).toFixed(1)

    progressBar.style.width = '100%'
    progressBar.classList.add('done')
    resultLabel.className = 'result speed'
    resultLabel.textContent = mbps + ' Mbps'
    return {
      id: endpoint.id,
      label: endpoint.label,
      mbps: parseFloat(mbps),
      error: false,
    }
  } catch (err) {
    progressBar.style.width = '100%'
    progressBar.classList.add('error')
    resultLabel.className = 'result error'
    if (err.response) {
      resultLabel.textContent = err.response.status === 429 ? 'Rate limited' : 'HTTP ' + err.response.status
    } else {
      resultLabel.textContent = 'Failed'
    }
    return {
      id: endpoint.id,
      label: endpoint.label,
      mbps: null,
      error: true,
    }
  }
}

async function runAllTests() {
  if (testRunning) return
  testRunning = true
  const runButton = document.getElementById('btn-run')
  const statusLabel = document.getElementById('status')
  runButton.disabled = true
  runButton.textContent = 'Testing...'
  statusLabel.textContent = ''

  const payloadSizeMb = parseInt(document.getElementById('sel-mb').value) || 25
  const results = []

  for (const endpoint of endpoints) {
    statusLabel.textContent = 'Testing ' + endpoint.label + '...'
    results.push(await testEndpoint(endpoint, payloadSizeMb))
  }

  const summaryElement = document.getElementById('summary')
  const summaryRowsElement = document.getElementById('summary-rows')
  summaryElement.style.display = 'block'

  const validResults = results.filter((result) => !result.error && result.mbps != null)
  const bestResult = validResults.length ? validResults.reduce((a, b) => (a.mbps > b.mbps ? a : b)) : null

  let summaryHtml = ''
  for (const result of results) {
    const winnerClass = bestResult && result.id === bestResult.id && validResults.length > 1 ? ' winner' : ''
    summaryHtml +=
      '<div class="summary-row"><span class="k">' +
      result.label +
      '</span><span class="v' +
      winnerClass +
      '">' +
      (result.error ? 'Error' : result.mbps + ' Mbps' + (winnerClass ? ' \u2605' : '')) +
      '</span></div>'
  }
  if (bestResult && validResults.length > 1) {
    const speedDifference = (bestResult.mbps / Math.min(...validResults.map((v) => v.mbps)) - 1) * 100
    summaryHtml +=
      '<div class="summary-row"><span class="k">Winner</span><span class="v winner">' +
      bestResult.label +
      (speedDifference > 1 ? ' (+' + speedDifference.toFixed(0) + '%)' : '') +
      '</span></div>'
  }
  summaryRowsElement.innerHTML = summaryHtml

  runButton.disabled = false
  runButton.textContent = 'Run Speed Test'
  statusLabel.textContent = 'Done'
  testRunning = false
}
