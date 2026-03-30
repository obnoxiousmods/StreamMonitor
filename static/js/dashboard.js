// ── Constants ──
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

// ── State ──
let statusData = {}
let statsData = {}
let versionsData = {}
let logRefreshTimer = null
let logsInitialized = false
let currentLogUnit = ''

// ── Tabs ──
function switchTab(tabName, tabElement) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'))
  tabElement.classList.add('active')
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'))
  document.getElementById('p-' + tabName).classList.add('active')
  if (tabName !== 'l' && logRefreshTimer) {
    clearInterval(logRefreshTimer)
    logRefreshTimer = null
  }
}

// ── Utility Functions ──
function escapeHtml(str) {
  return String(str == null ? '—' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatNumber(num) {
  if (num == null || num === undefined) return '—'
  if (typeof num !== 'number') return escapeHtml(String(num))
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B'
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toLocaleString()
}

function formatGigabytes(num) {
  if (num == null) return '—'
  return num >= 1000 ? (num / 1000).toFixed(1) + ' TB' : num.toFixed(1) + ' GB'
}

function statCard(label, value, colorClass = '') {
  const displayValue =
    value === '—' || value == null ? '<span style="color:var(--muted)">—</span>' : escapeHtml(String(value))
  return `<div class="kv ${colorClass}"><div class="vv">${displayValue}</div><div class="kk">${escapeHtml(label)}</div></div>`
}

function statsRow(...items) {
  return `<div class="srow">${items.filter(Boolean).join('')}</div>`
}

function systemRow(label, value, colorClass = '') {
  return `<div class="sys-r"><span class="sk">${escapeHtml(label)}</span><span class="sv ${colorClass}">${escapeHtml(String(value))}</span></div>`
}

function systemBar(percent, colorClass = '') {
  const clampedPercent = Math.min(Math.max(percent, 0), 100).toFixed(1)
  return `<div class="sys-bar"><div class="sys-bar-fill ${colorClass}" style="width:${clampedPercent}%"></div></div>`
}

function formatDataRate(bytesPerSec) {
  if (!bytesPerSec) return '0 B/s'
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s'
  if (bytesPerSec < 1048576) return (bytesPerSec / 1024).toFixed(1) + ' KB/s'
  if (bytesPerSec < 1073741824) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s'
  return (bytesPerSec / 1073741824).toFixed(2) + ' GB/s'
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'
  return (bytes / 1073741824).toFixed(2) + ' GB'
}

// ── Version Helpers ──
function normalizeVersion(version) {
  return version ? version.replace(/^[vV]/, '').trim() : ''
}

// Split a version string into numeric parts (e.g. "1.43.0.10492-abc" → [1,43,0,10492])
function parseVersionParts(version) {
  return normalizeVersion(version)
    .split(/[.\-+]/)
    .map((part) => parseInt(part, 10))
    .filter((num) => !isNaN(num))
}

// Returns -1 if a<b, 0 if a==b, 1 if a>b
function compareVersions(versionA, versionB) {
  const partsA = parseVersionParts(versionA)
  const partsB = parseVersionParts(versionB)
  const maxLength = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < maxLength; i++) {
    const numA = partsA[i] || 0
    const numB = partsB[i] || 0
    if (numA < numB) return -1
    if (numA > numB) return 1
  }
  return 0
}

function renderVersion(serviceId, installed) {
  const githubVersion = versionsData[serviceId]
  if (!installed && !githubVersion) return ''

  const normalizedInstalled = normalizeVersion(installed)
  const tags = []

  if (normalizedInstalled) {
    tags.push(`<span class="ver-tag inst" title="Installed">v${escapeHtml(normalizedInstalled)}</span>`)
  }

  if (githubVersion?.latest) {
    const normalizedGithub = normalizeVersion(githubVersion.latest)
    const comparison =
      normalizedInstalled && normalizedGithub ? compareVersions(normalizedInstalled, normalizedGithub) : null

    let cssClass, arrow, title
    if (comparison === null) {
      cssClass = 'latest'
      arrow = ''
      title = 'Latest on GitHub'
    } else if (comparison === 0) {
      cssClass = 'uptodate'
      arrow = ''
      title = 'Up to date'
    } else if (comparison < 0) {
      cssClass = 'outdated'
      arrow = '↑ '
      title = 'Update available'
    } else {
      cssClass = 'uptodate'
      arrow = ''
      title = 'Installed is newer than latest release'
    }

    tags.push(`<span class="ver-tag ${cssClass}" title="${title}">${arrow}${escapeHtml(githubVersion.latest)}</span>`)
  }

  return tags.length ? `<div class="ver-row">${tags.join('')}</div>` : ''
}

// ── System Card ──
function renderSystem(systemStats) {
  if (!systemStats || !Object.keys(systemStats).length) {
    return '<div style="color:var(--muted);font-size:.78rem;padding:.3rem">Collecting system stats…</div>'
  }

  let html = '<div class="sys-panels">'

  // OS + uptime
  html += '<div class="sys-sec"><div class="sys-ttl">System</div>'
  if (systemStats.os_distro) html += systemRow('OS', systemStats.os_distro)
  if (systemStats.uptime) html += systemRow('Uptime', systemStats.uptime, 'ok')
  if (systemStats.process_count != null) html += systemRow('Processes', systemStats.process_count)
  html += '</div>'

  // CPU
  const cpu = systemStats.cpu || {}
  if (Object.keys(cpu).length) {
    html += '<div class="sys-sec"><div class="sys-ttl">CPU</div>'
    if (cpu.model) {
      html += `<div style="font-size:.62rem;color:var(--muted2);margin-bottom:.25rem;line-height:1.3">${escapeHtml(cpu.model)}</div>`
    }
    if (cpu.physical_cores != null) {
      html += systemRow('Cores / Threads', `${cpu.physical_cores} / ${cpu.logical_cores}`)
    }
    if (cpu.freq_mhz) html += systemRow('Clock', `${cpu.freq_mhz} MHz`)
    if (cpu.usage_pct != null) {
      const cpuColor = cpu.usage_pct > 80 ? 'err' : cpu.usage_pct > 50 ? 'warn' : 'ok'
      html += systemRow('Usage', `${cpu.usage_pct.toFixed(1)}%`, cpuColor)
      html += systemBar(cpu.usage_pct, cpuColor)
    }
    if (cpu.load_1m != null) {
      html += systemRow('Load (1/5/15m)', `${cpu.load_1m} / ${cpu.load_5m} / ${cpu.load_15m}`)
    }

    // CPU temps from hwmon
    const temps = systemStats.temps || {}
    if (temps.cpu != null) {
      const tempColor = temps.cpu > 80 ? 'err' : temps.cpu > 60 ? 'warn' : 'ok'
      html += systemRow('Temp', `${temps.cpu}°C`, tempColor)
      if (temps.cores && temps.cores.length > 1) {
        const coreTempsHtml = temps.cores
          .map((temp) => {
            const color = temp > 80 ? 'var(--err)' : temp > 60 ? 'var(--warn)' : 'var(--ok)'
            return `<span style="color:${color}">${temp}°</span>`
          })
          .join(' ')
        html += `<div style="font-size:.58rem;color:var(--muted2);margin:-.1rem 0 .15rem;line-height:1.4">Cores: ${coreTempsHtml}</div>`
      }
    }

    // CPU fan RPM from psutil sensors
    const fans = (systemStats.sensors && systemStats.sensors.fans) || []
    if (fans.length) {
      const cpuFan =
        fans.find((fan) => fan.source === 'nct6793' || fan.source === 'thinkpad' || fan.source === 'dell_smm') ||
        fans[0]
      if (cpuFan) html += systemRow('Fan', `${cpuFan.rpm} RPM`)
    }
    html += '</div>'
  }

  // RAM
  const ram = systemStats.ram || {}
  if (Object.keys(ram).length) {
    html += '<div class="sys-sec"><div class="sys-ttl">Memory</div>'
    const ramColor = ram.percent > 90 ? 'err' : ram.percent > 70 ? 'warn' : 'ok'
    html += systemRow('Used / Total', `${ram.used_gb} / ${ram.total_gb} GB`)
    html += systemBar(ram.percent, ramColor)
    html += systemRow('Available', `${ram.available_gb} GB`, 'ok')
    if (systemStats.swap?.total_gb > 0) {
      const swapColor = systemStats.swap.percent > 80 ? 'warn' : ''
      html += systemRow('Swap', `${systemStats.swap.used_gb} / ${systemStats.swap.total_gb} GB`)
      if (systemStats.swap.percent > 0) html += systemBar(systemStats.swap.percent, swapColor)
    }
    html += '</div>'
  }

  // GPU
  const gpu = systemStats.gpu || {}
  if (Object.keys(gpu).length) {
    html += '<div class="sys-sec"><div class="sys-ttl">GPU</div>'
    if (gpu.name) {
      html += `<div style="font-size:.62rem;color:var(--muted2);margin-bottom:.25rem">${escapeHtml(gpu.name)}</div>`
    }
    if (gpu.usage_pct != null) {
      const gpuColor = gpu.usage_pct > 80 ? 'warn' : gpu.usage_pct > 0 ? 'ok' : ''
      html += systemRow('Usage', `${gpu.usage_pct}%`, gpuColor)
      html += systemBar(gpu.usage_pct, gpuColor)
    }
    if (gpu.engines) {
      const engineNames = { compute: 'Compute', enc: 'Encode', dec: 'Decode', gfx: '3D', dma: 'DMA' }
      for (const [eng, pct] of Object.entries(gpu.engines)) {
        const label = engineNames[eng] || eng
        const ec = pct > 80 ? 'err' : pct > 40 ? 'warn' : 'ok'
        html += systemRow(label, `${pct}%`, ec)
      }
    }
    if (gpu.vram_used_mb != null && gpu.vram_total_mb) {
      const vramPercent = (gpu.vram_used_mb / gpu.vram_total_mb) * 100
      const vramColor = vramPercent > 90 ? 'err' : vramPercent > 70 ? 'warn' : 'ok'
      html += systemRow('VRAM', `${gpu.vram_used_mb} / ${gpu.vram_total_mb} MB`, vramColor)
      html += systemBar(vramPercent, vramColor)
    }
    if (gpu.temp_c != null) {
      const gpuTempColor = gpu.temp_c > 85 ? 'err' : gpu.temp_c > 70 ? 'warn' : 'ok'
      html += systemRow('Temp', `${gpu.temp_c}°C`, gpuTempColor)
    }
    if (gpu.power_w != null) html += systemRow('Power', `${gpu.power_w} W`)
    if (gpu.core_mhz != null) html += systemRow('Core / Mem MHz', `${gpu.core_mhz} / ${gpu.mem_mhz || '?'}`)
    if (gpu.fan_rpm != null) html += systemRow('Fan', `${gpu.fan_rpm} RPM`)
    if (gpu.mem_busy_pct != null) html += systemRow('Mem busy', `${gpu.mem_busy_pct}%`)
    html += '</div>'
  }

  // Disks
  const disks = systemStats.disks || []
  if (disks.length) {
    html += '<div class="sys-sec"><div class="sys-ttl">Storage</div>'
    for (const disk of disks) {
      const diskColor = disk.percent > 90 ? 'err' : disk.percent > 75 ? 'warn' : 'ok'
      const freeColor = disk.percent > 90 ? 'err' : disk.percent > 75 ? 'warn' : 'muted'
      html += `<div class="disk-item">`
      html += `<div class="disk-lbl"><span>${escapeHtml(disk.mount)}</span><span style="color:var(--${freeColor})">${disk.free} / ${disk.total} ${disk.unit}</span></div>`
      html += `<div class="dbar"><div class="dbar-f ${diskColor}" style="width:${disk.percent}%"></div></div></div>`
    }
    html += '</div>'
  }

  // Disk I/O
  const diskIo = systemStats.disk_io || {}
  if (diskIo.read_rate || diskIo.write_rate) {
    html += '<div class="sys-sec"><div class="sys-ttl">Disk I/O</div>'
    html += systemRow('Read', diskIo.read_rate || '—', 'ok')
    html += systemRow('Write', diskIo.write_rate || '—', 'warn')
    html += systemRow('Session ↑↓', `${diskIo.read_total_gb || 0} / ${diskIo.write_total_gb || 0} GB`)
    html += '</div>'
  }

  // Network I/O
  const netIo = systemStats.net_io || {}
  if (netIo.recv_rate || netIo.sent_rate) {
    const linkCapacity = netIo.link_rate || ''
    html += '<div class="sys-sec"><div class="sys-ttl">Network</div>'
    const recvPercent = netIo.recv_pct || 0
    const sentPercent = netIo.sent_pct || 0
    const recvColor = recvPercent > 80 ? 'err' : recvPercent > 50 ? 'warn' : 'ok'
    const sentColor = sentPercent > 80 ? 'err' : sentPercent > 50 ? 'warn' : 'ok'
    html += systemRow(
      '↓ Recv',
      linkCapacity
        ? `${escapeHtml(netIo.recv_rate)} / ${escapeHtml(linkCapacity)}`
        : escapeHtml(netIo.recv_rate || '—'),
      recvColor,
    )
    if (recvPercent > 0) {
      html += `<div class="dbar" style="margin:.05rem 0 .2rem"><div class="dbar-f ${recvColor}" style="width:${Math.min(recvPercent, 100)}%"></div></div>`
    }
    html += systemRow(
      '↑ Sent',
      linkCapacity
        ? `${escapeHtml(netIo.sent_rate)} / ${escapeHtml(linkCapacity)}`
        : escapeHtml(netIo.sent_rate || '—'),
      sentColor,
    )
    if (sentPercent > 0) {
      html += `<div class="dbar" style="margin:.05rem 0 .2rem"><div class="dbar-f ${sentColor}" style="width:${Math.min(sentPercent, 100)}%"></div></div>`
    }
    html += systemRow('Total ↓', `${netIo.recv_total_gb || 0} GB`)
    html += systemRow('Total ↑', `${netIo.sent_total_gb || 0} GB`)
    html += '</div>'
  }

  html += '</div>'
  return html
}

// ── Stats Renderers ──
function renderStats(serviceId, stats) {
  if (!stats || !Object.keys(stats).length) return ''
  if (serviceId === 'system') return `<div class="sbox">${renderSystem(stats)}</div>`

  const renderers = {
    comet: () => {
      let html = statsRow(
        statCard('version', stats.version, 'blue'),
        statCard('types', stats.types?.length),
        stats.active_connections ? statCard('conns', stats.active_connections, 'ok') : '',
      )
      if (stats.torrents_total) {
        html += statsRow(
          statCard('torrents', formatNumber(stats.torrents_total), 'blue'),
          statCard('queue🎬', stats.queue_movies),
          statCard('queue📺', stats.queue_series),
        )
      }
      if (stats.scraper_running != null) {
        html += statsRow(
          statCard(
            'scraper',
            stats.scraper_running ? (stats.scraper_paused ? 'paused' : 'running') : 'stopped',
            stats.scraper_running ? 'ok' : 'warn',
          ),
          statCard('24h found', formatNumber(stats.slo_torrents_found), 'blue'),
          statCard(
            'fail rate',
            stats.slo_fail_rate != null ? `${(stats.slo_fail_rate * 100).toFixed(0)}%` : '—',
            stats.slo_fail_rate > 0.1 ? 'warn' : '',
          ),
        )
      }
      if (stats.top_trackers?.length) {
        html += `<div style="font-size:.62rem;color:var(--muted);margin-top:.2rem">${stats.top_trackers
          .slice(0, 3)
          .map((tracker) => escapeHtml(tracker.name) + ': ' + formatNumber(tracker.count))
          .join(' · ')}</div>`
      }
      return html
    },

    mediafusion: () => {
      let html = statsRow(
        statCard('version', stats.version || stats.addon_version, 'blue'),
        statCard('access', stats.is_public ? 'public' : 'private', stats.is_public ? 'ok' : ''),
      )
      if (stats.streams_total != null) {
        html += statsRow(
          statCard('streams', formatNumber(stats.streams_total), 'blue'),
          stats.movies ? statCard('movies', formatNumber(stats.movies)) : '',
          stats.series ? statCard('series', formatNumber(stats.series)) : '',
        )
      }
      if (stats.sched_total != null) {
        html += statsRow(
          statCard('schedulers', stats.sched_active + '/' + stats.sched_total),
          stats.scrapers_active ? statCard('scrapers', stats.scrapers_active + '/' + stats.scrapers_total, 'ok') : '',
          stats.sched_running > 0 ? statCard('running', stats.sched_running, 'ok') : statCard('idle', '0'),
        )
      }
      if (stats.top_sources) {
        const sources = Object.entries(stats.top_sources)
        html += statsRow(...sources.slice(0, 3).map(([key, value]) => statCard(key, formatNumber(value))))
      }
      if (stats.debrid_cached) {
        const debridEntries = Object.entries(stats.debrid_cached)
        if (debridEntries.length) {
          html += statsRow(...debridEntries.map(([key, value]) => statCard(key + ' cache', formatNumber(value), 'ok')))
        }
      }
      if (stats.redis_mem) {
        html += `<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">Redis: ${escapeHtml(stats.redis_mem)} | DB: ${escapeHtml(stats.db_size || '?')}</div>`
      }
      return html
    },

    stremthru: () => {
      let html = statsRow(
        statCard('version', stats.version, 'blue'),
        statCard('status', stats.status, 'ok'),
        stats.store_name ? statCard('store', stats.store_name) : '',
      )
      if (stats.subscription) {
        html += statsRow(statCard('sub', stats.subscription, stats.subscription?.includes('premium') ? 'ok' : 'warn'))
      }
      if (stats.magnet_total != null) {
        html += statsRow(
          statCard('magnets', formatNumber(stats.magnet_total), 'blue'),
          stats.torrent_info_count ? statCard('torrents', formatNumber(stats.torrent_info_count)) : '',
          stats.dmm_hashes ? statCard('dmm', formatNumber(stats.dmm_hashes)) : '',
        )
      }
      if (stats.magnet_cache) {
        const magnetCache = stats.magnet_cache
        const stores = Object.keys(magnetCache)
        if (stores.length) {
          html += statsRow(
            ...stores.map((store) => statCard(store, formatNumber(magnetCache[store].cached) + ' cached', 'ok')),
          )
        }
      }
      if (stats.db_size) html += statsRow(statCard('db', stats.db_size))
      return html
    },

    zilean: () => {
      if (!stats.responding) return ''
      let html = statsRow(
        statCard('status', 'online', 'ok'),
        stats.sample_results != null ? statCard('sample hits', stats.sample_results, 'blue') : '',
        stats.quality_distribution
          ? statCard(
              'qualities',
              Object.entries(stats.quality_distribution)
                .map(([key, value]) => key + '(' + formatNumber(value) + ')')
                .join(' '),
            )
          : '',
      )
      if (stats.total_torrents != null) {
        html += statsRow(
          statCard('torrents', formatNumber(stats.total_torrents), 'blue'),
          statCard('w/ IMDB', formatNumber(stats.with_imdb), 'ok'),
          statCard('unmatched', formatNumber(stats.total_torrents - stats.with_imdb), 'warn'),
        )
      }
      if (stats.scraper_running != null) {
        html += statsRow(
          statCard('scraper', stats.scraper_running ? 'running' : 'idle', stats.scraper_running ? 'ok' : ''),
          stats.dmm_status != null
            ? statCard('dmm sync', stats.dmm_status, stats.dmm_status === 'ok' ? 'ok' : 'err')
            : '',
          stats.imdb_entries ? statCard('imdb titles', formatNumber(stats.imdb_entries)) : '',
        )
      }
      if (stats.dmm_last_run) {
        html += `<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">DMM sync: ${escapeHtml(stats.dmm_last_run)}</div>`
      }
      if (stats.db_size) {
        html += `<div style="font-size:.62rem;color:var(--muted)">DB: ${escapeHtml(stats.db_size)}</div>`
      }
      if (stats.latest_indexed) {
        html += `<div style="font-size:.62rem;color:var(--muted)">Last indexed: ${escapeHtml(stats.latest_indexed)}</div>`
      }
      return html
    },

    aiostreams: () => {
      let html = statsRow(
        statCard('status', 'online', 'ok'),
        statCard('version', stats.version, 'blue'),
        stats.channel ? statCard('channel', stats.channel, stats.channel === 'stable' ? 'ok' : 'warn') : '',
      )
      if (stats.user_count != null) {
        html += statsRow(
          statCard('users', stats.user_count),
          stats.catalogs ? statCard('catalogs', stats.catalogs) : '',
          stats.presets_available ? statCard('presets', stats.presets_available) : '',
        )
      }
      if (stats.forced_services?.length) {
        html += statsRow(statCard('services', stats.forced_services.join(', ')))
      }
      if (stats.cache_entries != null) {
        html += statsRow(
          statCard('cache', formatNumber(stats.cache_entries)),
          stats.max_addons ? statCard('max addons', stats.max_addons) : '',
          stats.tmdb_available ? statCard('tmdb', 'yes', 'ok') : statCard('tmdb', 'no', 'warn'),
        )
      }
      if (stats.commit) {
        html += `<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">Commit: ${escapeHtml(stats.commit)} | ${escapeHtml(stats.tag || '')}</div>`
      }
      return html
    },

    flaresolverr: () =>
      statsRow(
        statCard('status', stats.status, stats.status === 'ok' ? 'ok' : 'warn'),
        stats.version ? statCard('version', stats.version, 'blue') : '',
      ),

    byparr: () =>
      statsRow(
        statCard('status', stats.status, stats.status === 'ok' ? 'ok' : 'warn'),
        stats.browser ? statCard('browser', stats.browser) : '',
        stats.version ? statCard('version', stats.version, 'blue') : '',
      ),

    jackett: () => {
      const items = []
      if (stats.indexers_configured != null) items.push(statCard('indexers', stats.indexers_configured))
      if (stats.responding) items.push(statCard('torznab', 'ok', 'ok'))
      return items.length ? statsRow(...items) : ''
    },

    prowlarr: () =>
      [
        statsRow(
          statCard('indexers', stats.indexers_total),
          statCard('enabled', stats.indexers_enabled, 'ok'),
          statCard('queries', formatNumber(stats.total_queries), 'blue'),
          statCard('grabs', formatNumber(stats.total_grabs)),
        ),
        stats.total_failed_queries
          ? statsRow(statCard('failed q.', formatNumber(stats.total_failed_queries), 'warn'))
          : '',
        stats.health_errors || stats.health_warnings
          ? statsRow(
              stats.health_errors ? statCard('errors', stats.health_errors, 'err') : '',
              stats.health_warnings ? statCard('warnings', stats.health_warnings, 'warn') : '',
            )
          : '',
        stats.health_messages?.length
          ? `<div class="health-err">${stats.health_messages.map(escapeHtml).join(' · ')}</div>`
          : '',
      ].join(''),

    radarr: () =>
      [
        statsRow(
          statCard('total', formatNumber(stats.total)),
          statCard('downloaded', formatNumber(stats.downloaded), 'ok'),
          statCard('missing', formatNumber(stats.missing), stats.missing > 0 ? 'err' : ''),
          statCard('queue', formatNumber(stats.queue), stats.queue > 0 ? 'warn' : ''),
        ),
        stats.disk_free_gb != null
          ? statsRow(
              statCard('free disk', formatGigabytes(stats.disk_free_gb)),
              statCard('total', formatGigabytes(stats.disk_total_gb)),
            )
          : '',
        stats.health_errors || stats.health_warnings
          ? statsRow(
              stats.health_errors ? statCard('h.errors', stats.health_errors, 'err') : '',
              stats.health_warnings ? statCard('h.warnings', stats.health_warnings, 'warn') : '',
            )
          : '',
        stats.health_messages?.length
          ? `<div class="health-err">${stats.health_messages.map(escapeHtml).join('<br>')}</div>`
          : '',
      ].join(''),

    sonarr: () =>
      [
        statsRow(
          statCard('series', formatNumber(stats.total)),
          statCard('episodes', formatNumber(stats.episodes_downloaded), 'ok'),
          statCard('missing ep.', formatNumber(stats.missing_episodes), stats.missing_episodes > 0 ? 'warn' : ''),
          statCard('queue', formatNumber(stats.queue), stats.queue > 0 ? 'warn' : ''),
        ),
        stats.disk_free_gb != null
          ? statsRow(
              statCard('free disk', formatGigabytes(stats.disk_free_gb)),
              statCard('total', formatGigabytes(stats.disk_total_gb)),
            )
          : '',
        stats.health_errors || stats.health_warnings
          ? statsRow(
              stats.health_errors ? statCard('h.errors', stats.health_errors, 'err') : '',
              stats.health_warnings ? statCard('h.warnings', stats.health_warnings, 'warn') : '',
            )
          : '',
        stats.health_messages?.length
          ? `<div class="health-err">${stats.health_messages.map(escapeHtml).join('<br>')}</div>`
          : '',
      ].join(''),

    lidarr: () =>
      [
        statsRow(
          statCard('artists', formatNumber(stats.artists)),
          statCard('albums', formatNumber(stats.albums_total)),
          statCard('tracks', formatNumber(stats.track_count), 'ok'),
          statCard('queue', formatNumber(stats.queue), stats.queue > 0 ? 'warn' : ''),
        ),
        stats.disk_free_gb != null
          ? statsRow(
              statCard('free disk', formatGigabytes(stats.disk_free_gb)),
              statCard('total', formatGigabytes(stats.disk_total_gb)),
            )
          : '',
      ].join(''),

    bazarr: () => {
      const parts = []
      if (stats.version) parts.push(statsRow(statCard('version', stats.version, 'blue')))
      if (stats.movies_total != null || stats.episodes_total != null) {
        parts.push(
          statsRow(
            stats.movies_total != null ? statCard('movies', formatNumber(stats.movies_total)) : '',
            stats.movies_missing > 0 ? statCard('mov. miss.', formatNumber(stats.movies_missing), 'warn') : '',
            stats.episodes_total != null ? statCard('episodes', formatNumber(stats.episodes_total)) : '',
            stats.episodes_missing > 0 ? statCard('ep. miss.', formatNumber(stats.episodes_missing), 'warn') : '',
          ),
        )
      }
      return parts.join('')
    },

    jellyfin: () =>
      [
        statsRow(
          statCard('movies', formatNumber(stats.movies), 'blue'),
          statCard('series', formatNumber(stats.series)),
          statCard('episodes', formatNumber(stats.episodes)),
          statCard('songs', formatNumber(stats.songs)),
        ),
        statsRow(
          statCard('sessions', formatNumber(stats.sessions_total)),
          statCard('playing', formatNumber(stats.sessions_active), stats.sessions_active > 0 ? 'ok' : ''),
        ),
        stats.now_playing?.filter(Boolean).length
          ? `<div class="np">▶ ${stats.now_playing.filter(Boolean).slice(0, 2).map(escapeHtml).join(' · ')}</div>`
          : '',
      ].join(''),

    plex: () =>
      [
        stats.movies != null || stats.series != null
          ? statsRow(
              stats.movies != null ? statCard('movies', formatNumber(stats.movies), 'blue') : '',
              stats.series != null ? statCard('series', formatNumber(stats.series)) : '',
              statCard('playing', formatNumber(stats.sessions_active), stats.sessions_active > 0 ? 'ok' : ''),
            )
          : '',
        stats.libraries?.length
          ? `<div style="font-size:.63rem;color:var(--muted);margin-top:.2rem">${stats.libraries.map((lib) => `${escapeHtml(lib.title)}: ${lib.count}`).join(' · ')}</div>`
          : '',
      ].join(''),

    jellyseerr: () =>
      statsRow(
        statCard('total req.', formatNumber(stats.requests_total), 'blue'),
        statCard('pending', formatNumber(stats.requests_pending), stats.requests_pending > 0 ? 'warn' : ''),
        statCard('approved', formatNumber(stats.requests_approved)),
        statCard('available', formatNumber(stats.requests_available), 'ok'),
      ),

    dispatcharr: () =>
      [
        statsRow(
          statCard('streams', formatNumber(stats.total_streams), 'blue'),
          statCard('channels', formatNumber(stats.total_channels)),
          statCard('m3u accts', formatNumber(stats.m3u_accounts)),
        ),
        statsRow(
          statCard('epg src.', formatNumber(stats.epg_sources)),
          stats.epg_errors ? statCard('epg err.', stats.epg_errors, 'err') : '',
          stats.epg_ok ? statCard('epg ok', stats.epg_ok, 'ok') : '',
        ),
      ].join(''),

    mediaflow: () =>
      stats.status ? statsRow(statCard('status', stats.status, stats.status === 'healthy' ? 'ok' : 'warn')) : '',

    qbittorrent: () => {
      const rows = []
      if (stats.version) rows.push(statsRow(statCard('version', stats.version, 'blue')))
      if (stats.active_torrents != null) {
        rows.push(
          statsRow(
            statCard('active', stats.active_torrents, stats.active_torrents > 0 ? 'ok' : ''),
            statCard("dl'ing", stats.downloading != null ? stats.downloading : '—'),
            statCard('seeding', stats.seeding != null ? stats.seeding : '—'),
          ),
        )
      }
      if (stats.dl_speed != null) {
        rows.push(
          statsRow(
            statCard('↓ speed', formatDataRate(stats.dl_speed), 'ok'),
            statCard('↑ speed', formatDataRate(stats.up_speed || 0)),
          ),
        )
      }
      if (stats.dl_session != null && stats.dl_session + stats.up_session > 0) {
        rows.push(
          statsRow(
            statCard('sess ↓', formatBytes(stats.dl_session)),
            statCard('sess ↑', formatBytes(stats.up_session || 0)),
          ),
        )
      }
      return rows.join('')
    },
  }

  const renderer = renderers[serviceId]
  if (!renderer) return ''
  const renderedHtml = renderer()
  if (!renderedHtml?.trim()) return ''
  return `<div class="sbox">${renderedHtml}</div>`
}

// ── History Bar ──
function renderHistoryBar(history) {
  const maxBars = 40
  const padding = maxBars - Math.min(history.length, maxBars)
  return (
    '<span class="x"></span>'.repeat(padding) +
    history
      .slice(-maxBars)
      .map((record) => `<span class="${record.ok ? 'ok' : 'er'}" title="${escapeHtml(record.message)}"></span>`)
      .join('')
  )
}

// ── Header Overview ──
function buildOverview() {
  const allServices = Object.values(statusData)
  if (!allServices.length) return ''

  const upCount = allServices.filter((svc) => svc.current.ok).length
  const downCount = allServices.length - upCount
  const healthIssues = Object.values(statsData).reduce(
    (total, svcStats) => total + (svcStats?.health_errors || 0) + (svcStats?.health_warnings || 0),
    0,
  )

  const logErrorCount = errorsData.filter((entry) => entry.severity === 'error').length
  const logWarningCount = errorsData.filter((entry) => entry.severity === 'warning').length
  updateErrBadge(logErrorCount, logWarningCount)

  const errorStat =
    logErrorCount > 0
      ? `<div class="hdr-stat err"><div class="val">${logErrorCount}</div><div class="lbl">Log Errors</div></div>`
      : logWarningCount > 0
        ? `<div class="hdr-stat warn"><div class="val">${logWarningCount}</div><div class="lbl">Warnings</div></div>`
        : ''

  return `
    <div class="hdr-stat ${downCount === 0 ? 'ok' : downCount > 2 ? 'err' : 'warn'}"><div class="val">${upCount}/${allServices.length}</div><div class="lbl">Services</div></div>
    <div class="hdr-stat ${healthIssues > 0 ? 'err' : 'ok'}"><div class="val">${healthIssues || '&#10003;'}</div><div class="lbl">Issues</div></div>
    ${errorStat}`
}

// ── Service Card ──
function renderCard(serviceId, serviceData) {
  const current = serviceData.current
  const cssClass = current.ok === null ? 'pend' : current.ok ? 'up' : 'dn'
  const serviceStats = statsData[serviceId] || {}
  const installed = serviceStats.version || serviceStats.addon_version || serviceStats.bazarr_version || ''
  const webUrl = WEB_URLS[serviceId] || ''

  if (serviceId === 'system') {
    return `<div class="card up" id="card-${serviceId}" onclick="openServiceModal('${serviceId}')" title="Click for details">
    <div class="ct">&#x1F5A5; ${escapeHtml(current.name)}</div>${renderStats(serviceId, serviceStats)}</div>`
  }

  const actionButtons = `<div class="card-acts">
    ${webUrl ? `<button class="card-act" onclick="event.stopPropagation();window.open('${webUrl}','_blank')" title="Open web UI">&#x2197;</button>` : ''}
    <button class="card-act" onclick="event.stopPropagation();openServiceModal('${serviceId}','logs')" title="View logs">&#x2261;</button>
    <button class="card-act danger" onclick="event.stopPropagation();quickRestartService('${serviceId}')" title="Restart service">&#x27F3;</button>
  </div>`

  const httpBadge =
    current.http_ok === null || current.http_ok === undefined
      ? ''
      : `<span class="sbadge ${current.http_ok ? 'http-up' : 'http-dn'}" title="${escapeHtml(current.message || '')}">${'HTTP'}</span>`

  const latencyBadge = current.latency_ms != null ? `<span class="lat">${current.latency_ms}ms</span>` : ''

  return `<div class="card ${cssClass}" id="card-${serviceId}" onclick="openServiceModal('${serviceId}')" title="Click for details">
    ${actionButtons}
    <div class="ct">${escapeHtml(current.name)}<span class="sbadge ${current.systemd_ok ? 'sys-up' : 'sys-dn'}" title="systemd: ${escapeHtml(current.systemd || 'unknown')}">SYS</span>${httpBadge}${latencyBadge}</div>
    <div class="meta">${escapeHtml(current.message || '—')} · systemd: ${escapeHtml(current.systemd)}</div>
    ${renderStats(serviceId, serviceStats)}${renderVersion(serviceId, installed)}
    <div class="bar">${renderHistoryBar(serviceData.history)}</div></div>`
}

// ── Data Fetch ──
async function safeJson(url, opts = {}) {
  try {
    const response = await axios({
      url,
      method: opts.method || 'GET',
      headers: opts.headers,
      data: opts.body,
    })
    return response.data
  } catch {
    return null
  }
}

async function refresh() {
  const [status, stats, versions] = await Promise.all([
    safeJson('/api/status'),
    safeJson('/api/stats'),
    safeJson('/api/versions'),
  ])
  if (status) statusData = status
  if (stats) statsData = stats
  if (versions) versionsData = versions
  if (!Object.keys(statusData).length) return

  document.getElementById('overview').innerHTML = buildOverview()
  document.getElementById('ts-hdr').textContent =
    '⟳ ' + new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })
  document.getElementById('ts').textContent =
    'Last updated: ' + new Date().toLocaleString('en-CA', { timeZone: TZ, hour12: false })

  const categories = {}
  for (const [serviceId, serviceData] of Object.entries(statusData)) {
    const category = serviceData.current.category || 'other'
    ;(categories[category] = categories[category] || []).push([serviceId, serviceData])
  }

  let html = ''
  for (const categoryKey of [
    'system',
    'streaming',
    'indexers',
    'arr',
    'media',
    'dispatch',
    'downloads',
    'infra',
    'other',
  ]) {
    const items = categories[categoryKey]
    if (!items?.length) continue
    html += `<div class="cat-hdr">${CATEGORY_LABELS[categoryKey] || categoryKey}</div>`
    html += `<div class="grid${categoryKey === 'system' ? ' sys-grid' : ''}">`
    for (const [serviceId, serviceData] of items) html += renderCard(serviceId, serviceData)
    html += '</div>'
  }
  document.getElementById('cats').innerHTML = html
}

// ── Logs ──
let logLines = []

async function fetchLogs() {
  const unitName = document.getElementById('unit').value
  if (!unitName) return
  const lineCount = document.getElementById('log-lines')?.value || '200'
  const logBox = document.getElementById('logbox')
  const statusLabel = document.getElementById('log-status')

  if (currentLogUnit !== unitName) {
    logBox.innerHTML = '<span class="spin"></span> Loading…'
    currentLogUnit = unitName
  }

  const data = await safeJson('/api/logs/' + encodeURIComponent(unitName) + '?n=' + lineCount)
  if (!data) {
    logBox.innerHTML = '<span style="color:var(--err)">Error fetching logs.</span>'
    return
  }
  if (data.error) {
    logBox.innerHTML = '<span style="color:var(--err)">' + escapeHtml(data.error) + '</span>'
    return
  }

  logLines = data.lines || []
  filterLogs()
  statusLabel.textContent =
    `${logLines.length} lines · ` + new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })
}

function filterLogs() {
  const logBox = document.getElementById('logbox')
  if (!logLines.length) {
    logBox.innerHTML = '<span style="color:var(--muted)">No logs.</span>'
    return
  }

  const query = (document.getElementById('log-search')?.value || '').toLowerCase()
  const filteredLines = query ? logLines.filter((line) => line.toLowerCase().includes(query)) : logLines

  if (!filteredLines.length) {
    logBox.innerHTML = '<span style="color:var(--muted)">No lines match filter.</span>'
    return
  }

  const isNearBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 60
  const autoscrollEnabled = document.getElementById('log-autoscroll')?.checked !== false

  logBox.innerHTML = filteredLines
    .map(
      (line) =>
        `<span class="${/error|critical|fail|exception/i.test(line) ? 'le' : /warn/i.test(line) ? 'lw' : ''}">${escapeHtml(line)}</span>`,
    )
    .join('\n')

  if (autoscrollEnabled && isNearBottom) logBox.scrollTop = logBox.scrollHeight
}

function initLogs() {
  if (logsInitialized) return
  logsInitialized = true
  fetchLogs()
  logRefreshTimer = setInterval(() => {
    if (document.getElementById('p-l').classList.contains('active')) fetchLogs()
  }, 5000)
}

// ── Settings ──
let apiKeysData = {}
let apiKeysOriginal = {}
let serviceUrlsData = {}
let serviceUrlsOriginal = {}

function toggleKeyVisibility(key) {
  const input = document.getElementById('key_' + key)
  const button = document.getElementById('eye_' + key)
  if (!input) return
  if (input.type === 'password') {
    input.type = 'text'
    button.textContent = '🙈'
  } else {
    input.type = 'password'
    button.textContent = '👁'
  }
}

function copyApiKey(key) {
  const input = document.getElementById('key_' + key)
  if (!input) return
  navigator.clipboard.writeText(input.value).then(() => {
    const button = document.getElementById('copy_' + key)
    const previousText = button.textContent
    button.textContent = '✓'
    setTimeout(() => {
      button.textContent = previousText
    }, 1500)
  })
}

function markKeyChanged(key) {
  const input = document.getElementById('key_' + key)
  if (!input) return
  input.classList.toggle('changed', input.value !== apiKeysOriginal[key])
}

function markUrlChanged(key) {
  const input = document.getElementById('url_' + key)
  if (!input) return
  input.classList.toggle('changed', input.value !== serviceUrlsOriginal[key])
}

async function loadSettings() {
  const gridElement = document.getElementById('settings-grid')
  const keys = await safeJson('/api/settings/keys')
  const urls = await safeJson('/api/settings/urls')

  if (keys) {
    apiKeysData = keys
    apiKeysOriginal = Object.fromEntries(Object.entries(keys).map(([key, val]) => [key, val.value || '']))
  }
  if (urls) {
    serviceUrlsData = urls
    serviceUrlsOriginal = Object.fromEntries(Object.entries(urls).map(([key, val]) => [key, val.value || '']))
  }

  // Group keys
  const keyGroups = {}
  for (const [key, val] of Object.entries(keys || {})) {
    const groupName = val.group || 'Other'
    if (!keyGroups[groupName]) keyGroups[groupName] = []
    keyGroups[groupName].push([key, val])
  }

  const keyGroupOrder = ['Arr Suite', 'Indexers', 'Media Servers', 'Streaming', 'Dispatching', 'Downloads', 'Other']
  const sortedKeyGroups = keyGroupOrder
    .filter((name) => keyGroups[name])
    .concat(Object.keys(keyGroups).filter((name) => !keyGroupOrder.includes(name)))

  const keysHtml = sortedKeyGroups
    .map(
      (groupName) => `
    <div class="key-group">
      <div class="key-group-label">${escapeHtml(groupName)}</div>
      ${keyGroups[groupName]
        .map(
          ([key, val]) => `
      <div class="key-row">
        <label title="${escapeHtml(key)}">${escapeHtml(val.label)}</label>
        <div class="key-input-wrap">
          <input type="password" id="key_${escapeHtml(key)}" value="${escapeHtml(val.value || '')}" placeholder="(not set)" oninput="markKeyChanged('${escapeHtml(key)}')">
          <button class="key-btn" id="eye_${escapeHtml(key)}" onclick="toggleKeyVisibility('${escapeHtml(key)}')" title="Show/hide">👁</button>
          <button class="key-btn" id="copy_${escapeHtml(key)}" onclick="copyApiKey('${escapeHtml(key)}')" title="Copy">⎘</button>
        </div>
      </div>`,
        )
        .join('')}
    </div>`,
    )
    .join('')

  // Group URLs
  const urlGroups = {}
  for (const [key, val] of Object.entries(urls || {})) {
    const groupName = val.group || 'Other'
    if (!urlGroups[groupName]) urlGroups[groupName] = []
    urlGroups[groupName].push([key, val])
  }

  const urlGroupOrder = ['Streaming', 'Indexers', 'Arr Suite', 'Media Servers', 'Dispatching', 'Downloads', 'Other']
  const sortedUrlGroups = urlGroupOrder
    .filter((name) => urlGroups[name])
    .concat(Object.keys(urlGroups).filter((name) => !urlGroupOrder.includes(name)))

  const urlsHtml = sortedUrlGroups
    .map(
      (groupName) => `
    <div class="key-group">
      <div class="key-group-label">${escapeHtml(groupName)}</div>
      ${urlGroups[groupName]
        .map(
          ([key, val]) => `
      <div class="key-row">
        <label title="${escapeHtml(key)}">${escapeHtml(val.label)}</label>
        <div class="key-input-wrap">
          <input type="text" id="url_${escapeHtml(key)}" value="${escapeHtml(val.value || '')}" placeholder="http://127.0.0.1:..." oninput="markUrlChanged('${escapeHtml(key)}')">
        </div>
      </div>`,
        )
        .join('')}
    </div>`,
    )
    .join('')

  gridElement.innerHTML = `
  <div class="settings-sec">
    <h3>API Keys</h3>
    ${keysHtml}
    <button class="btn-save" onclick="saveApiKeys()">Save Keys</button>
    <div id="keys-msg"></div>
  </div>
  <div class="settings-sec">
    <h3>Service URLs</h3>
    ${urlsHtml}
    <button class="btn-save" onclick="saveServiceUrls()">Save URLs</button>
    <div id="urls-msg"></div>
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
  </div>`
}

async function saveApiKeys() {
  const updates = {}
  for (const key of Object.keys(apiKeysData)) {
    const element = document.getElementById('key_' + key)
    if (element) updates[key] = element.value.trim()
  }
  const messageElement = document.getElementById('keys-msg')
  const result = await safeJson('/api/settings/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (result?.ok) {
    messageElement.className = 'msg-ok'
    messageElement.textContent = 'Saved!'
  } else {
    messageElement.className = 'msg-err'
    messageElement.textContent = 'Error saving keys.'
  }
  setTimeout(() => {
    messageElement.textContent = ''
  }, 3000)
}

async function saveServiceUrls() {
  const updates = {}
  for (const key of Object.keys(serviceUrlsData)) {
    const element = document.getElementById('url_' + key)
    if (element) updates[key] = element.value.trim()
  }
  const messageElement = document.getElementById('urls-msg')
  const result = await safeJson('/api/settings/urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (result?.ok) {
    messageElement.className = 'msg-ok'
    messageElement.textContent = 'URLs saved!'
    serviceUrlsOriginal = Object.fromEntries(Object.entries(serviceUrlsData).map(([key]) => [key, updates[key] || '']))
    document.querySelectorAll('[id^="url_"]').forEach((element) => element.classList.remove('changed'))
  } else {
    messageElement.className = 'msg-err'
    messageElement.textContent = result?.error || 'Error saving URLs.'
  }
  setTimeout(() => {
    messageElement.textContent = ''
  }, 4000)
}

async function changePassword() {
  const currentPassword = document.getElementById('pw-cur').value
  const newPassword = document.getElementById('pw-new').value
  const confirmPassword = document.getElementById('pw-conf').value
  const messageElement = document.getElementById('pw-msg')

  if (!newPassword) {
    messageElement.className = 'msg-err'
    messageElement.textContent = 'New password required.'
    return
  }
  if (newPassword !== confirmPassword) {
    messageElement.className = 'msg-err'
    messageElement.textContent = 'Passwords do not match.'
    return
  }

  const result = await safeJson('/api/settings/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current: currentPassword, new_password: newPassword }),
  })

  if (result?.ok) {
    messageElement.className = 'msg-ok'
    messageElement.textContent = 'Password changed!'
    document.getElementById('pw-cur').value = ''
    document.getElementById('pw-new').value = ''
    document.getElementById('pw-conf').value = ''
  } else {
    messageElement.className = 'msg-err'
    messageElement.textContent = result?.error || 'Error changing password.'
  }
  setTimeout(() => {
    messageElement.textContent = ''
  }, 4000)
}

// ── Permissions Tab ──
const TZ = 'America/Vancouver'

function formatTimestamp(unixTs) {
  return unixTs ? new Date(unixTs * 1000).toLocaleString('en-CA', { timeZone: TZ, hour12: false }) : '—'
}

let permissionScanResults = []
let permissionsScanned = false

function initPermissions() {
  if (!permissionsScanned) runPermissionScan()
}

async function runPermissionScan() {
  const scanButton = document.getElementById('scan-btn')
  const metaLabel = document.getElementById('scan-meta')
  scanButton.disabled = true
  scanButton.textContent = 'Scanning…'
  metaLabel.textContent = ''

  const data = await safeJson('/api/perms/scan', { method: 'POST' })
  scanButton.disabled = false
  scanButton.textContent = '⟳ Scan directories'
  permissionsScanned = true

  if (!data) {
    metaLabel.textContent = 'Scan failed.'
    return
  }

  permissionScanResults = data.results || []
  const okCount = permissionScanResults.filter((result) => result.ok).length
  const mismatchCount = permissionScanResults.filter((result) => !result.ok && result.exists && !result.missing).length
  const missingCount = permissionScanResults.filter((result) => result.missing).length

  metaLabel.textContent =
    `${okCount} OK · ` +
    (mismatchCount ? `<span style="color:var(--err)">${mismatchCount} mismatch</span> · ` : `0 mismatch · `) +
    `${missingCount} missing · ${formatTimestamp(data.ts)}`
  metaLabel.innerHTML = metaLabel.textContent

  renderPermissionResults()
}

function renderPermissionResults() {
  const container = document.getElementById('perm-results')
  if (!permissionScanResults.length) {
    container.innerHTML = '<div style="color:var(--muted);padding:.5rem">No data. Click Scan.</div>'
    return
  }

  const mismatched = permissionScanResults.filter((result) => !result.ok && !result.missing)

  // Populate section filter dropdown (first scan only)
  const sectionSelect = document.getElementById('perm-section-filter')
  if (sectionSelect && sectionSelect.options.length === 1) {
    ;[...new Set(permissionScanResults.map((result) => result.section || 'Other'))].forEach((section) => {
      const option = document.createElement('option')
      option.value = section
      option.textContent = section
      sectionSelect.appendChild(option)
    })
  }

  const issuesOnly = document.getElementById('perm-issues-only')?.checked
  const sectionFilter = document.getElementById('perm-section-filter')?.value || ''

  // Group by section (applying filters)
  const sectionNames = []
  const sectionMap = {}
  permissionScanResults.forEach((result, index) => {
    if (issuesOnly && result.ok) return
    const section = result.section || 'Other'
    if (sectionFilter && section !== sectionFilter) return
    if (!sectionMap[section]) {
      sectionMap[section] = []
      sectionNames.push(section)
    }
    sectionMap[section].push({ result, index })
  })

  let tableBody = ''
  sectionNames.forEach((section) => {
    const entries = sectionMap[section]
    const sectionMismatchCount = entries.filter(({ result }) => !result.ok && !result.missing).length
    const sectionMissingCount = entries.filter(({ result }) => result.missing).length

    const badge = sectionMismatchCount
      ? `<span style="color:var(--err);margin-left:.4rem;font-size:.7rem">${sectionMismatchCount} issue${sectionMismatchCount > 1 ? 's' : ''}</span>`
      : sectionMissingCount
        ? `<span style="color:var(--muted);margin-left:.4rem;font-size:.7rem">${sectionMissingCount} missing</span>`
        : `<span style="color:var(--ok);margin-left:.4rem;font-size:.7rem">&#10003; OK</span>`

    tableBody += `<tr class="perm-section-hdr"><td colspan="9"><strong>${escapeHtml(section)}</strong>${badge}</td></tr>`

    entries.forEach(({ result, index }) => {
      const rowClass = result.missing ? 'missing-row' : result.ok ? 'ok-row' : 'bad-row'
      const statusIcon = result.missing
        ? '<span class="perm-miss">MISSING</span>'
        : result.ok
          ? '<span class="perm-ok">&#10003;</span>'
          : '<span class="perm-bad">&#10007;</span>'
      const userDiffClass = result.cur_user !== result.exp_user && !result.missing ? 'perm-diff' : ''
      const groupDiffClass = result.cur_group !== result.exp_group && !result.missing ? 'perm-diff' : ''
      const modeDiffClass = result.cur_mode !== result.exp_mode && !result.missing ? 'perm-diff' : ''
      const checkbox = result.missing
        ? ''
        : result.ok
          ? ''
          : `<input type="checkbox" class="perm-cb" data-i="${index}" checked onchange="updateSelectedCount()">`

      tableBody += `<tr class="${rowClass}" data-i="${index}">
        <td>${checkbox}</td>
        <td>${statusIcon}</td>
        <td style="color:var(--accent2);font-family:monospace">${escapeHtml(result.label)}</td>
        <td style="font-family:monospace;font-size:.68rem;color:var(--muted2)">${escapeHtml(result.path)}</td>
        <td><span class="${userDiffClass}">${escapeHtml(result.cur_user)}</span></td>
        <td><span class="${groupDiffClass}">${escapeHtml(result.cur_group)}</span></td>
        <td style="font-family:monospace"><span class="${modeDiffClass}">${escapeHtml(result.cur_mode)}</span></td>
        <td style="color:var(--muted);font-size:.65rem">${escapeHtml(result.exp_user)}:${escapeHtml(result.exp_group)} ${escapeHtml(result.exp_mode)}</td>
        <td id="perm-res-${index}"></td>
      </tr>`
    })
  })

  container.innerHTML = `
  <table class="perm-table">
    <thead><tr>
      <th><input type="checkbox" id="perm-all" onchange="toggleAllPermissions(this)"></th>
      <th>Status</th><th>Service</th><th>Path</th>
      <th>Owner</th><th>Group</th><th>Mode</th><th>Expected</th><th>Result</th>
    </tr></thead>
    <tbody>${tableBody}</tbody>
  </table>
  <div class="perm-fix-row">
    <span class="perm-sel-count" id="perm-sel-count">${mismatched.length} selected</span>
    <label>Owner<input type="text" id="fix-user" value="" placeholder="from expected"></label>
    <label>Group<input type="text" id="fix-group" value="media" placeholder="media"></label>
    <label>Mode<input type="text" id="fix-mode" value="774" placeholder="774"></label>
    <button class="btn-save" onclick="applyPermissions()">Apply to selected</button>
    <button class="sm" onclick="selectPermissionMismatches()">Select all mismatches</button>
    <div id="perm-apply-msg" style="font-size:.72rem"></div>
  </div>`
}

function toggleAllPermissions(checkbox) {
  document.querySelectorAll('.perm-cb').forEach((cb) => (cb.checked = checkbox.checked))
  updateSelectedCount()
}

function selectPermissionMismatches() {
  document.querySelectorAll('.perm-cb').forEach((cb) => (cb.checked = true))
  updateSelectedCount()
}

function updateSelectedCount() {
  const countElement = document.getElementById('perm-sel-count')
  if (countElement) countElement.textContent = document.querySelectorAll('.perm-cb:checked').length + ' selected'
}

async function applyPermissions() {
  const recursive = document.getElementById('perm-recursive').checked
  const defaultUser = document.getElementById('fix-user').value.trim()
  const defaultGroup = document.getElementById('fix-group').value.trim() || 'media'
  const defaultMode = document.getElementById('fix-mode').value.trim() || '774'
  const selectedIndices = [...document.querySelectorAll('.perm-cb:checked')].map((cb) => parseInt(cb.dataset.i))

  if (!selectedIndices.length) {
    document.getElementById('perm-apply-msg').textContent = 'Nothing selected.'
    return
  }

  const messageElement = document.getElementById('perm-apply-msg')
  messageElement.textContent = `Applying to ${selectedIndices.length} path(s)…`

  const fixes = selectedIndices.map((index) => {
    const result = permissionScanResults[index]
    return {
      path: result.path,
      user: defaultUser || result.exp_user,
      group: defaultGroup || result.exp_group,
      mode: defaultMode || result.exp_mode,
      recursive,
    }
  })

  const data = await safeJson('/api/perms/fix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fixes),
  })

  if (!data) {
    messageElement.textContent = 'Request failed.'
    return
  }

  let successCount = 0
  let failCount = 0
  for (const fixResult of data.results || []) {
    const index = permissionScanResults.findIndex((result) => result.path === fixResult.path)
    const cell = document.getElementById('perm-res-' + index)
    if (cell) {
      if (fixResult.ok) {
        cell.innerHTML = '<span class="perm-ok">✓</span>'
        successCount++
      } else {
        cell.innerHTML = `<span class="perm-bad" title="${escapeHtml(fixResult.error || '')}">✗</span>`
        failCount++
      }
    }
  }
  messageElement.textContent = `Done: ${successCount} OK, ${failCount} failed.`
  if (successCount > 0) setTimeout(runPermissionScan, 800)
}

// ── Errors Tab ──
let errorsData = []
let errorsLoaded = false

function updateErrBadge(errorCount, warningCount) {
  const tabElement = document.getElementById('err-tab')
  if (!tabElement) return
  let badge = tabElement.querySelector('.tab-badge')
  const total = errorCount + warningCount

  if (total > 0) {
    if (!badge) {
      badge = document.createElement('span')
      tabElement.appendChild(badge)
    }
    badge.className = 'tab-badge' + (errorCount === 0 ? ' warn' : '')
    badge.textContent = total > 99 ? '99+' : total
  } else {
    if (badge) badge.remove()
  }
}

async function loadErrors() {
  errorsLoaded = true
  const data = await safeJson('/api/errors')
  if (!data) return
  errorsData = data.errors || []

  // Populate service filter
  const services = [...new Set(errorsData.map((entry) => entry.sid))].sort()
  const serviceSelect = document.getElementById('err-svc')
  const currentSelection = serviceSelect.value
  serviceSelect.innerHTML =
    '<option value="">All services</option>' +
    services
      .map(
        (svc) =>
          `<option value="${escapeHtml(svc)}"${svc === currentSelection ? ' selected' : ''}>${escapeHtml(svc)}</option>`,
      )
      .join('')

  // Meta info
  const metaElement = document.getElementById('err-meta')
  const errorCount = errorsData.filter((entry) => entry.severity === 'error').length
  const warningCount = errorsData.filter((entry) => entry.severity === 'warning').length

  if (data.last_scan) {
    const minutesAgo = Math.round((Date.now() / 1000 - data.last_scan) / 60)
    metaElement.textContent = `${errorsData.length} entries · scan #${data.scan_count} · ${minutesAgo < 1 ? 'just now' : minutesAgo + 'm ago'}`
  }

  const summaryElement = document.getElementById('err-summary')
  summaryElement.innerHTML =
    errorCount || warningCount
      ? `<span style="color:var(--err)">${errorCount} error${errorCount !== 1 ? 's' : ''}</span> · ` +
        `<span style="color:var(--warn)">${warningCount} warning${warningCount !== 1 ? 's' : ''}</span>`
      : 'All clear'

  updateErrBadge(errorCount, warningCount)
  filterErrors()
}

function filterErrors() {
  const serviceFilter = document.getElementById('err-svc').value
  const severityFilter = document.getElementById('err-sev').value
  const sortOrder = document.getElementById('err-sort')?.value || 'newest'

  let items = [...errorsData]
  if (serviceFilter) items = items.filter((entry) => entry.sid === serviceFilter)
  if (severityFilter) items = items.filter((entry) => entry.severity === severityFilter)

  if (sortOrder === 'newest') items.reverse()
  else if (sortOrder === 'oldest') {
    /* already oldest-first */
  } else if (sortOrder === 'count') items.sort((a, b) => (b.count || 1) - (a.count || 1))
  else if (sortOrder === 'svc') items.sort((a, b) => a.sid.localeCompare(b.sid))

  const listElement = document.getElementById('err-list')
  if (!items.length) {
    listElement.innerHTML =
      '<div style="color:var(--muted);padding:.5rem;font-family:system-ui">No entries match the filter.</div>'
    return
  }

  listElement.innerHTML = items
    .map((entry) => {
      const timestamp = new Date(entry.ts * 1000).toLocaleString('en-CA', {
        timeZone: TZ,
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })

      const countBadge =
        entry.count && entry.count > 1
          ? `<span class="err-cnt${entry.count > 5 ? ' hot' : ''}" title="${entry.count} occurrences">×${entry.count}</span>`
          : ''

      const fullLine = entry.line.length > 180 ? entry.line : ''
      const shortLine = entry.line.length > 180 ? entry.line.slice(0, 180) + '…' : entry.line

      return (
        `<div class="err-row ${escapeHtml(entry.severity)}" onclick="this.classList.toggle('expanded')">` +
        `<span class="err-sev">${escapeHtml(entry.severity)}</span>` +
        `<span class="err-svc">${escapeHtml(entry.sid)}</span>` +
        `<span class="err-ts">${escapeHtml(timestamp)}</span>` +
        `<span class="err-line">${escapeHtml(shortLine)}</span>${countBadge}</div>` +
        (fullLine ? `<div class="err-expand">${escapeHtml(fullLine)}</div>` : '')
      )
    })
    .join('')
}

async function scanErrorsNow() {
  const buttons = document.querySelectorAll('#p-e button.sm')
  const scanButton = buttons[0]
  if (scanButton) {
    scanButton.disabled = true
    scanButton.textContent = 'Scanning…'
  }
  await safeJson('/api/errors/scan', { method: 'POST' })
  await loadErrors()
  if (scanButton) {
    scanButton.disabled = false
    scanButton.textContent = '⟳ Scan now'
  }
}

async function clearErrors() {
  await safeJson('/api/errors', { method: 'DELETE' })
  errorsData = []
  document.getElementById('err-list').innerHTML =
    '<div style="color:var(--muted);padding:.5rem;font-family:system-ui">History cleared.</div>'
  document.getElementById('err-summary').textContent = ''
  document.getElementById('err-meta').textContent = ''
  updateErrBadge(0, 0)
}

// ── Service Modal ──
let modalServiceId = null
let modalServiceUnit = null
let modalLogRefreshTimer = null
let modalLogLines = []

function openServiceModal(serviceId, tabName = 'overview') {
  const serviceData = statusData[serviceId]
  if (!serviceData) return
  const serviceStats = statsData[serviceId] || {}
  const current = serviceData.current
  modalServiceId = serviceId
  modalServiceUnit = current.unit || ''

  // Header
  document.getElementById('modal-name').textContent = current.name
  const sysBadge = document.getElementById('modal-badge-sys')
  sysBadge.className = `sbadge ${current.systemd_ok ? 'sys-up' : 'sys-dn'}`
  sysBadge.title = 'systemd: ' + (current.systemd || 'unknown')

  const httpBadge = document.getElementById('modal-badge-http')
  if (current.http_ok === null || current.http_ok === undefined) {
    httpBadge.style.display = 'none'
  } else {
    httpBadge.style.display = ''
    httpBadge.className = `sbadge ${current.http_ok ? 'http-up' : 'http-dn'}`
    httpBadge.title = current.message || ''
  }

  const latencyElement = document.getElementById('modal-lat')
  latencyElement.textContent = current.latency_ms != null ? current.latency_ms + 'ms' : ''

  // Web URL
  const webUrl = WEB_URLS[serviceId] || ''
  const urlLink = document.getElementById('modal-weburl')
  if (webUrl) {
    urlLink.href = webUrl
    urlLink.style.display = ''
  } else {
    urlLink.style.display = 'none'
  }

  // Meta
  document.getElementById('modal-msg').textContent = current.message || '—'
  document.getElementById('modal-unit').textContent = current.unit ? `unit: ${current.unit}` : ''
  const timestampElement = document.getElementById('modal-ts')
  if (current.timestamp) {
    timestampElement.textContent = new Date(current.timestamp).toLocaleTimeString('en-CA', {
      timeZone: TZ,
      hour12: false,
    })
  }

  // Overview
  const statsHtml = renderStats(serviceId, serviceStats)
  document.getElementById('modal-stats-body').innerHTML =
    statsHtml || '<div style="color:var(--muted);font-size:.78rem">No stats collected yet.</div>'

  const installed = serviceStats.version || serviceStats.addon_version || serviceStats.bazarr_version || ''
  document.getElementById('modal-version-body').innerHTML = renderVersion(serviceId, installed)
  document.getElementById('modal-history-body').innerHTML = serviceData.history?.length
    ? `<div style="font-size:.6rem;color:var(--muted);margin-bottom:.2rem">Uptime history (last ${serviceData.history.length} checks)</div><div class="bar" style="margin:0">${renderHistoryBar(serviceData.history)}</div>`
    : ''

  // Controls: web button
  const openWebButton = document.getElementById('ctrl-open-web')
  if (webUrl) {
    openWebButton.style.display = ''
    openWebButton.onclick = () => window.open(webUrl, '_blank')
  } else {
    openWebButton.style.display = 'none'
  }
  document.getElementById('ctrl-output').textContent = 'Action output will appear here.'
  document.getElementById('ctrl-output').style.color = 'var(--muted)'

  // System info panel in controls
  const sysinfoElement = document.getElementById('ctrl-sysinfo')
  sysinfoElement.innerHTML = current.unit
    ? [
        systemRow('Unit', current.unit),
        systemRow(
          'Systemd',
          current.systemd,
          current.systemd === 'active' ? 'ok' : current.systemd === 'inactive' ? 'err' : '',
        ),
        systemRow('Status', current.ok ? 'Healthy' : 'Unhealthy', current.ok ? 'ok' : 'err'),
        current.latency_ms != null ? systemRow('Latency', current.latency_ms + 'ms') : '',
      ].join('')
    : ''

  // Show/hide AIOStreams-specific tabs
  const isAio = serviceId === 'aiostreams'
  const azTab = document.getElementById('mtab-analyzer')
  const tsTab = document.getElementById('mtab-testsuite')
  if (azTab) azTab.style.display = isAio ? '' : 'none'
  if (tsTab) tsTab.style.display = isAio ? '' : 'none'

  // Show/hide MediaFusion-specific tabs
  const isMf = serviceId === 'mediafusion'
  const mfmTab = document.getElementById('mtab-mfmetrics')
  const mfaTab = document.getElementById('mtab-mfanalyzer')
  if (mfmTab) mfmTab.style.display = isMf ? '' : 'none'
  if (mfaTab) mfaTab.style.display = isMf ? '' : 'none'

  // Show modal, open correct tab
  document.getElementById('svc-modal').classList.add('open')
  document.body.style.overflow = 'hidden'
  openModalTab(tabName, document.querySelector(`.mtab[onclick*="'${tabName}'"]`) || document.querySelector('.mtab'))
}

function closeModal() {
  document.getElementById('svc-modal').classList.remove('open')
  document.body.style.overflow = ''
  if (modalLogRefreshTimer) {
    clearInterval(modalLogRefreshTimer)
    modalLogRefreshTimer = null
  }
  modalLogLines = []
  modalServiceId = null
  modalServiceUnit = null
}

function openModalTab(tabName, tabElement) {
  document.querySelectorAll('.mtab').forEach((tab) => tab.classList.remove('active'))
  if (tabElement) tabElement.classList.add('active')
  document.querySelectorAll('.mpanel').forEach((panel) => panel.classList.remove('active'))
  document.getElementById('mt-' + tabName).classList.add('active')

  if (tabName === 'logs') {
    if (modalLogRefreshTimer) {
      clearInterval(modalLogRefreshTimer)
      modalLogRefreshTimer = null
    }
    modalFetchLogs()
    modalLogRefreshTimer = setInterval(modalFetchLogs, 5000)
  } else {
    if (modalLogRefreshTimer) {
      clearInterval(modalLogRefreshTimer)
      modalLogRefreshTimer = null
    }
  }
}

async function modalFetchLogs() {
  if (!modalServiceUnit) return
  const lineCount = document.getElementById('modal-log-lines')?.value || '200'
  const logBox = document.getElementById('modal-logbox')
  const statusLabel = document.getElementById('modal-log-status')

  const data = await safeJson('/api/logs/' + encodeURIComponent(modalServiceUnit) + '?n=' + lineCount)
  if (!data) {
    logBox.innerHTML = '<span style="color:var(--err)">Error fetching logs.</span>'
    return
  }
  if (data.error) {
    logBox.innerHTML = `<span style="color:var(--err)">${escapeHtml(data.error)}</span>`
    return
  }

  modalLogLines = data.lines || []
  modalFilterLogs()
  statusLabel.textContent =
    `${modalLogLines.length} lines · ` + new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })
}

function modalFilterLogs() {
  const logBox = document.getElementById('modal-logbox')
  if (!modalLogLines.length) {
    logBox.innerHTML = '<span style="color:var(--muted)">No logs.</span>'
    return
  }

  const query = (document.getElementById('modal-log-search')?.value || '').toLowerCase()
  const filteredLines = query ? modalLogLines.filter((line) => line.toLowerCase().includes(query)) : modalLogLines

  if (!filteredLines.length) {
    logBox.innerHTML = '<span style="color:var(--muted)">No lines match filter.</span>'
    return
  }

  const isNearBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 60
  logBox.innerHTML = filteredLines
    .map(
      (line) =>
        `<span class="${/error|critical|fail|exception/i.test(line) ? 'le' : /warn/i.test(line) ? 'lw' : ''}">${escapeHtml(line)}</span>`,
    )
    .join('\n')
  if (isNearBottom) logBox.scrollTop = logBox.scrollHeight
}

async function serviceAction(action) {
  if (!modalServiceUnit) return
  const outputElement = document.getElementById('ctrl-output')
  const buttons = document.querySelectorAll('.ctrl-btn')
  buttons.forEach((button) => {
    button.disabled = true
  })
  outputElement.style.color = 'var(--muted)'
  outputElement.textContent = `${action}ing ${modalServiceUnit}…`

  const result = await safeJson(`/api/service/${encodeURIComponent(modalServiceUnit)}/${action}`, { method: 'POST' })

  buttons.forEach((button) => {
    button.disabled = false
  })
  if (result?.ok) {
    outputElement.style.color = 'var(--ok)'
    outputElement.textContent = `✓ ${action} succeeded`
    setTimeout(() => refresh(), 2000)
  } else {
    outputElement.style.color = 'var(--err)'
    outputElement.textContent = `✗ ${action} failed: ${result?.error || 'unknown error'}`
  }
}

async function quickRestartService(serviceId) {
  const serviceData = statusData[serviceId]
  if (!serviceData) return
  const unit = serviceData.current.unit
  if (!unit) return

  const card = document.getElementById('card-' + serviceId)
  if (card) {
    card.style.opacity = '.5'
    card.style.pointerEvents = 'none'
  }
  await safeJson(`/api/service/${encodeURIComponent(unit)}/restart`, { method: 'POST' })
  if (card) {
    card.style.opacity = ''
    card.style.pointerEvents = ''
  }
  setTimeout(() => refresh(), 2000)
}

function openServiceWebUI() {
  const url = WEB_URLS[modalServiceId]
  if (url) window.open(url, '_blank')
}

// ── Keyboard: Escape closes modal ──
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal()
})

// ── Jellyfin Tab ──
let jellyfinLoaded = false

async function loadJellyfin() {
  const data = await safeJson('/api/jellyfin')
  if (!data) return
  jellyfinLoaded = true

  const metaElement = document.getElementById('jf-meta')
  metaElement.textContent = 'Updated: ' + new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })

  // Sessions
  const sessionsContainer = document.getElementById('jf-sessions')
  const sessions = data.sessions || []
  const activeSessions = sessions.filter((session) => session.NowPlayingItem)

  let sessionsHtml = '<h3>Active Sessions (' + sessions.length + ')</h3>'
  if (!sessions.length) {
    sessionsHtml += '<div style="color:var(--muted);font-size:.78rem">No active sessions</div>'
  } else {
    for (const session of sessions) {
      const userName = session.UserName || 'Unknown'
      const clientName = session.Client || ''
      const deviceName = session.DeviceName || ''
      const nowPlaying = session.NowPlayingItem
      const playingHtml = nowPlaying
        ? `<span style="color:var(--ok)">&#x25B6; ${escapeHtml(nowPlaying.Name || '')}${nowPlaying.SeriesName ? ' (' + escapeHtml(nowPlaying.SeriesName) + ')' : ''}</span>`
        : '<span style="color:var(--muted)">Idle</span>'
      sessionsHtml += `<div style="padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.75rem">
        <div style="display:flex;gap:.5rem;align-items:center"><strong style="color:var(--accent2)">${escapeHtml(userName)}</strong><span style="color:var(--muted)">${escapeHtml(clientName)} / ${escapeHtml(deviceName)}</span></div>
        <div style="margin-top:.15rem">${playingHtml}</div></div>`
    }
  }
  sessionsContainer.innerHTML = sessionsHtml

  // Activity
  const activityContainer = document.getElementById('jf-activity')
  const activity = data.activity || []

  let activityHtml = '<h3>Recent Activity (' + activity.length + ')</h3>'
  if (!activity.length) {
    activityHtml += '<div style="color:var(--muted);font-size:.78rem">No recent activity</div>'
  } else {
    for (const entry of activity.slice(0, 30)) {
      const timestamp = entry.Date
        ? new Date(entry.Date).toLocaleString('en-CA', {
            timeZone: TZ,
            hour12: false,
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : ''
      const severityColor = entry.Severity === 'Error' ? 'err' : entry.Severity === 'Warning' ? 'warn' : 'muted'
      activityHtml += `<div style="padding:.25rem 0;border-bottom:1px solid var(--border);font-size:.7rem;display:flex;gap:.5rem">
        <span style="color:var(--muted);min-width:90px;flex-shrink:0">${escapeHtml(timestamp)}</span>
        <span style="color:var(--${severityColor})">${escapeHtml(entry.Name || entry.Type || '')}</span>
        <span style="color:var(--muted2);margin-left:auto">${escapeHtml(entry.ShortOverview || '').slice(0, 80)}</span></div>`
    }
  }
  activityContainer.innerHTML = activityHtml
}

// ── Benchmark Tab ──
let benchmarkInitialized = false

function initBenchmark() {
  if (benchmarkInitialized) return
  benchmarkInitialized = true

  const titleSelect = document.getElementById('bench-title')
  const groups = {
    'Popular Movies': [],
    'Niche Movies': [],
    'Popular TV': [],
    'Niche TV': [],
    'Popular Anime': [],
    'Niche Anime': [],
    'TV Episodes': [],
  }

  for (const [imdbId, name] of Object.entries(BENCH_TITLES)) {
    if (imdbId.includes(':')) {
      groups['TV Episodes'].push([imdbId, name])
    } else if (
      [
        'tt0468569',
        'tt1375666',
        'tt0111161',
        'tt0816692',
        'tt15398776',
        'tt6718170',
        'tt1517268',
        'tt9362722',
      ].includes(imdbId)
    ) {
      groups['Popular Movies'].push([imdbId, name])
    } else if (['tt0118799', 'tt0087843', 'tt0347149', 'tt6751668', 'tt5311514'].includes(imdbId)) {
      groups['Niche Movies'].push([imdbId, name])
    } else if (['tt0903747', 'tt0944947', 'tt2861424', 'tt7366338', 'tt11280740'].includes(imdbId)) {
      groups['Popular TV'].push([imdbId, name])
    } else if (['tt2085059', 'tt0306414', 'tt5491994'].includes(imdbId)) {
      groups['Niche TV'].push([imdbId, name])
    } else if (['tt0388629', 'tt0877057', 'tt0434706', 'tt10919420', 'tt5370118'].includes(imdbId)) {
      groups['Popular Anime'].push([imdbId, name])
    } else {
      groups['Niche Anime'].push([imdbId, name])
    }
  }

  for (const [groupLabel, items] of Object.entries(groups)) {
    if (!items.length) continue
    const optgroup = document.createElement('optgroup')
    optgroup.label = groupLabel
    for (const [imdbId, name] of items) {
      const option = document.createElement('option')
      option.value = imdbId
      option.textContent = name + ' (' + imdbId.split(':')[0] + ')'
      optgroup.appendChild(option)
    }
    titleSelect.appendChild(optgroup)
  }
}

async function runBenchmark() {
  const imdbId = document.getElementById('bench-title').value
  if (!imdbId) {
    document.getElementById('bench-status').textContent = 'Select a title first'
    return
  }
  const mode = document.getElementById('bench-mode')?.value || 'all'
  const runButton = document.getElementById('bench-run-btn')
  const statusLabel = document.getElementById('bench-status')
  runButton.disabled = true
  statusLabel.textContent = `Running ${mode} benchmark for ${BENCH_TITLES[imdbId]}...`

  const data = await safeJson(`/api/benchmark?imdb=${encodeURIComponent(imdbId)}&mode=${mode}`)
  runButton.disabled = false

  if (!data) {
    statusLabel.textContent = 'Benchmark failed'
    return
  }
  statusLabel.textContent = `Done — ${data.mode} — ${new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })}`
  renderBenchTable(data)
}

async function runAllBenchmarks() {
  const statusLabel = document.getElementById('bench-status')
  const container = document.getElementById('bench-results')
  const mode = document.getElementById('bench-mode')?.value || 'all'
  const titles = Object.entries(BENCH_TITLES)
  statusLabel.textContent = `Running all ${titles.length} ${mode} benchmarks...`
  container.innerHTML = ''

  let progress = 0
  for (const [imdbId, name] of titles) {
    progress++
    statusLabel.textContent = `[${progress}/${titles.length}] ${name} (${mode})...`
    const data = await safeJson(`/api/benchmark?imdb=${encodeURIComponent(imdbId)}&mode=${mode}`)
    if (data) renderBenchTable(data, true)
  }
  statusLabel.textContent = `All ${titles.length} ${mode} benchmarks complete`
}

function renderBenchTable(data, append) {
  const container = document.getElementById('bench-results')
  const summary = data.summary || {}
  const thL = 'text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase'
  const thR = 'text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase'
  const cs = 'padding:.25rem .4rem'

  let html = `<div style="margin-bottom:1.2rem;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:.85rem;overflow-x:auto">`

  // Title + mode badge
  html += `<div style="display:flex;gap:.8rem;align-items:center;margin-bottom:.6rem;flex-wrap:wrap">`
  html += `<strong style="color:var(--accent2);font-size:.88rem">${escapeHtml(data.title)}</strong>`
  html += `<code style="font-size:.68rem">${escapeHtml(data.imdb)}</code>`
  html += `<span style="font-size:.58rem;padding:.1rem .4rem;border-radius:4px;background:#1e2235;color:var(--muted)">${data.mode || 'all'}</span>`
  html += `<span style="font-size:.68rem;color:var(--muted);margin-left:auto">${new Date(data.timestamp).toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })}</span>`
  html += `</div>`

  // Overall self-hosted vs public summary (big pills like before)
  const ov = summary.overall || {}
  const ovSh = ov.self_hosted || {}
  const ovPub = ov.public || {}
  html += `<div style="display:flex;gap:1rem;margin-bottom:.4rem;flex-wrap:wrap">`
  html += `<div style="font-size:.72rem;padding:.3rem .6rem;background:var(--ok-bg);border-radius:6px;border:1px solid #065f46">Self-hosted: <strong style="color:var(--ok)">${ovSh.total_streams || 0}</strong> streams, avg <strong style="color:var(--ok)">${ovSh.avg_latency_ms || '\u2014'}</strong>ms</div>`
  html += `<div style="font-size:.72rem;padding:.3rem .6rem;background:#12232a;border-radius:6px;border:1px solid #164e63">Public: <strong style="color:#67e8f9">${ovPub.total_streams || 0}</strong> streams, avg <strong style="color:#67e8f9">${ovPub.avg_latency_ms || '\u2014'}</strong>ms</div>`
  html += `</div>`

  // Per-mode breakdown (smaller pills)
  html += `<div style="display:flex;gap:.4rem;margin-bottom:.6rem;flex-wrap:wrap">`
  for (const [mode, label, bg, border, color] of [['cached','Cached','var(--ok-bg)','#065f46','var(--ok)'],['uncached','Uncached','#12232a','#164e63','#67e8f9']]) {
    const s = summary[mode]
    if (!s) continue
    const sh = s.self_hosted || {}
    const pub = s.public || {}
    html += `<div style="font-size:.6rem;padding:.2rem .4rem;background:${bg};border-radius:4px;border:1px solid ${border}"><strong style="color:${color}">${label}</strong> Self: ${sh.total_streams||0}/${sh.avg_latency_ms||'\u2014'}ms \u00b7 Pub: ${pub.total_streams||0}/${pub.avg_latency_ms||'\u2014'}ms</div>`
  }
  html += `</div>`

  // Results grouped by cache_mode
  const results = data.results || []
  for (const [mode, label] of [['cached','CACHED (debrid cache only)'],['uncached','UNCACHED (all torrents)'],['all','']]) {
    const modeResults = results.filter(r => r.cache_mode === mode)
    if (!modeResults.length) continue
    if (label) html += `<div style="font-size:.58rem;color:var(--accent2);text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin:.6rem 0 .3rem;padding-bottom:.2rem;border-bottom:1px solid var(--border)">${label}</div>`
    html += `<table style="width:100%;border-collapse:collapse;font-size:.72rem"><thead><tr style="border-bottom:1px solid var(--border)"><th style="${thL}">Name</th><th style="${thL}">Host</th><th style="${thR}">Latency</th><th style="${thR}">Streams</th><th style="${thR}">4K</th><th style="${thR}">1080p</th><th style="${thR}">720p</th><th style="${thL}">Codec</th><th style="${thL}">Status</th></tr></thead><tbody>`
    for (const r of modeResults) {
      const gc = r.group === 'self-hosted' ? 'ok' : 'accent2'
      const lc = r.latency_ms != null ? (r.latency_ms < 2000 ? 'ok' : r.latency_ms < 5000 ? 'warn' : 'err') : 'muted'
      const res = r.resolutions || {}
      html += `<tr style="border-bottom:1px solid #13172a"><td style="${cs};color:#e2e8f0;font-weight:600;white-space:nowrap">${escapeHtml(r.name)}</td><td style="${cs};color:var(--${gc});font-size:.65rem">${escapeHtml(r.group)}</td><td style="${cs};text-align:right;color:var(--${lc})">${r.latency_ms != null ? r.latency_ms + 'ms' : '\u2014'}</td><td style="${cs};text-align:right;color:var(--accent2);font-weight:700">${r.streams || 0}</td><td style="${cs};text-align:right">${res['4k']||0}</td><td style="${cs};text-align:right">${res['1080p']||0}</td><td style="${cs};text-align:right">${res['720p']||0}</td><td style="${cs}">${escapeHtml(r.top_codec||'\u2014')}</td><td style="${cs};color:var(--${r.error?'err':'ok'})">${r.error ? escapeHtml(r.error) : 'OK'}</td></tr>`
    }
    html += `</tbody></table>`
  }

  html += `</div>`
  if (append) container.innerHTML += html
  else container.innerHTML = html
}

// ── API Explorer ──
function toggleApiEndpoint(element) {
  element.classList.toggle('open')
}

async function tryApiEndpoint(path, method = 'GET') {
  const responseElement = event.target.closest('.api-endpoint').querySelector('.api-response')
  responseElement.textContent = 'Loading...'
  try {
    const response = await axios({
      url: path,
      method,
      transformResponse: [(data) => data],
      validateStatus: () => true,
    })
    try {
      responseElement.textContent = JSON.stringify(JSON.parse(response.data), null, 2)
    } catch {
      responseElement.textContent = String(response.data).slice(0, 2000)
    }
  } catch (err) {
    responseElement.textContent = 'Error: ' + err.message
  }
}

// ── AIOStreams Analyzer ──
let analyzerData = null

async function loadAnalyzer() {
  const body = document.getElementById('analyzer-body')
  const status = document.getElementById('analyzer-status')
  const n = document.getElementById('analyzer-lines')?.value || '5000'
  body.innerHTML = '<div style="text-align:center;padding:1rem"><span class="spin"></span> Analyzing logs...</div>'
  status.textContent = ''
  let d
  try {
    const resp = await axios.get(`/api/aiostreams/analyze?n=${n}`)
    d = resp.data
  } catch (e) {
    const msg = e.response?.data?.error || e.message || 'Unknown error'
    const statusCode = e.response?.status || ''
    body.innerHTML = `<div style="color:var(--err);padding:.5rem">Analyzer failed${statusCode ? ' (' + statusCode + ')' : ''}: ${escapeHtml(msg)}</div>`
    return
  }
  if (!d || d.error) {
    body.innerHTML = `<div style="color:var(--err);padding:.5rem">${escapeHtml(d?.error || 'No data returned')}</div>`
    return
  }
  analyzerData = d
  status.textContent = `${d.log_lines} lines \u00b7 Updated: ${new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })}`
  renderAnalyzer(d)
}

async function loadAnalyzerRaw() {
  const body = document.getElementById('analyzer-body')
  const status = document.getElementById('analyzer-status')
  const n = document.getElementById('analyzer-lines')?.value || '500'
  body.innerHTML = '<div style="text-align:center;padding:1rem"><span class="spin"></span> Loading raw logs...</div>'
  status.textContent = ''
  const d = await safeJson('/api/logs/aiostreams?n=' + n)
  if (!d || d.error) {
    body.innerHTML = `<div style="color:var(--err);padding:.5rem">${escapeHtml(d?.error || 'Failed to fetch logs. Is the aiostreams service unit named "aiostreams"?')}</div>`
    return
  }
  const lines = d.lines || []
  status.textContent = `${lines.length} raw lines`
  if (!lines.length) {
    body.innerHTML = '<div style="color:var(--muted);padding:.5rem">No log lines returned.</div>'
    return
  }
  body.innerHTML = `<pre style="font-size:.6rem;font-family:monospace;color:#94a3b8;white-space:pre-wrap;word-break:break-all;margin:0;line-height:1.5">${lines.map(l => escapeHtml(l)).join('\n')}</pre>`
  body.scrollTop = body.scrollHeight
}

function azStat(val, label) {
  return `<div class="az-stat"><div class="az-val">${val}</div><div class="az-lbl">${label}</div></div>`
}

function renderAnalyzer(d) {
  const body = document.getElementById('analyzer-body')
  const s = d.summary || {}
  let h = ''
  h += '<div class="az-summary">'
  h += azStat(s.total_requests || 0, 'REQUESTS')
  h += azStat(s.avg_response_time_s != null ? s.avg_response_time_s.toFixed(2) + 's' : '\u2014', 'AVG RESPONSE')
  h += azStat(s.avg_streams != null ? Number(s.avg_streams).toFixed(1) : '\u2014', 'AVG STREAMS')
  h += azStat(s.fastest_s != null ? s.fastest_s.toFixed(2) + 's' : '\u2014', 'FASTEST')
  h += azStat(s.slowest_s != null ? s.slowest_s.toFixed(2) + 's' : '\u2014', 'SLOWEST')
  h += azStat(s.total_addon_errors || 0, 'ADDON ERRORS')
  h += '</div>'
  const addons = d.addons || {}
  const addonList = Object.entries(addons).sort((a, b) => b[1].total_streams - a[1].total_streams)
  if (addonList.length) {
    h += '<div class="az-section">ADDON PERFORMANCE</div>'
    h += '<table class="az-table"><thead><tr><th>ADDON</th><th>CALLS</th><th>SUCCESS</th><th style="width:120px">RATE</th><th>AVG</th><th>MIN</th><th>MAX</th><th>AVG STREAMS</th><th>TOTAL STREAMS</th></tr></thead><tbody>'
    for (const [name, a] of addonList) {
      const rate = a.calls > 0 ? a.successes / a.calls : 0
      const rateColor = rate >= 0.9 ? 'green' : rate >= 0.5 ? 'yellow' : 'red'
      const ratePct = (rate * 100).toFixed(0) + '%'
      const maxColor = a.max_time_s > 5 ? 'var(--err)' : a.max_time_s > 2 ? 'var(--warn)' : 'var(--ok)'
      h += `<tr><td style="color:#e2e8f0;font-weight:600;white-space:nowrap">${escapeHtml(name)}</td><td>${a.calls}</td><td style="color:var(--ok)">${a.successes}/${a.calls}</td><td><div style="display:flex;align-items:center;gap:.3rem"><div class="az-bar-wrap" style="width:60px"><div class="az-bar ${rateColor}" style="width:${rate * 100}%"></div></div><span style="font-size:.65rem;color:${rate >= 0.9 ? 'var(--ok)' : rate >= 0.5 ? 'var(--warn)' : 'var(--err)'}">${ratePct}</span></div></td><td>${a.avg_time_s != null ? a.avg_time_s.toFixed(2) + 's' : '\u2014'}</td><td style="color:var(--ok)">${a.min_time_s != null ? a.min_time_s.toFixed(2) + 's' : '\u2014'}</td><td style="color:${maxColor}">${a.max_time_s != null ? a.max_time_s.toFixed(2) + 's' : '\u2014'}</td><td>${a.avg_streams != null ? a.avg_streams.toFixed(1) : '\u2014'}</td><td style="color:var(--accent2);font-weight:700">${a.total_streams || 0}</td></tr>`
    }
    h += '</tbody></table>'
    h += '<div class="az-section">RESPONSE TIME BY ADDON (AVG)</div>'
    const maxTime = Math.max(...addonList.map(([, a]) => a.avg_time_s || 0), 0.1)
    for (const [name, a] of addonList) {
      const pct = ((a.avg_time_s || 0) / maxTime) * 100
      const color = (a.avg_time_s || 0) > 3 ? 'red' : (a.avg_time_s || 0) > 1.5 ? 'yellow' : 'green'
      const fails = a.calls - a.successes
      h += `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem;font-size:.72rem"><span style="min-width:180px;text-align:right;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</span><div class="az-bar-wrap" style="flex:1"><div class="az-bar ${color}" style="width:${pct}%"></div></div><span style="min-width:50px;font-weight:700;color:${color === 'red' ? 'var(--err)' : color === 'yellow' ? 'var(--warn)' : 'var(--ok)'}">${a.avg_time_s ? a.avg_time_s.toFixed(2) + 's' : '\u2014'}</span>${fails > 0 ? `<span style="font-size:.62rem;color:var(--err)">${fails} fail</span>` : ''}</div>`
    }
  }
  const errors = d.errors || {}
  const errList = Object.entries(errors).sort((a, b) => b[1] - a[1])
  if (errList.length) {
    h += '<div class="az-section">ERROR BREAKDOWN</div>'
    for (const [msg, count] of errList) {
      h += `<div style="display:flex;gap:.5rem;align-items:baseline;font-size:.72rem;padding:.2rem 0;border-bottom:1px solid #13172a"><span style="color:var(--err);font-weight:700;min-width:30px">${count}\u00d7</span><span style="color:#94a3b8">${escapeHtml(msg)}</span></div>`
    }
  }
  const reqs = d.recent_requests || []
  if (reqs.length) {
    h += '<div class="az-section">RECENT STREAM REQUESTS <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">(click row to expand)</span></div>'
    h += '<table class="az-table"><thead><tr><th>CONTENT ID</th><th>TYPE</th><th>STREAMS</th><th>TIME</th><th>ERRORS</th><th>ADDONS</th></tr></thead><tbody>'
    for (const r of reqs) {
      const addonsStr = (r.addons || []).map(a => `<span style="color:${a.status === 'success' ? 'var(--ok)' : 'var(--err)'};font-size:.6rem">${escapeHtml(a.name)}</span>`).join(' \u00b7 ')
      const timeColor = (r.duration_s || 0) > 5 ? 'var(--err)' : (r.duration_s || 0) > 2 ? 'var(--warn)' : 'var(--ok)'
      h += `<tr class="az-req" onclick="this.classList.toggle('expanded')"><td style="font-family:monospace;color:var(--accent2)">${escapeHtml(r.content_id || '\u2014')}</td><td>${escapeHtml(r.type || '\u2014')}</td><td style="color:var(--accent2);font-weight:700">${r.total_streams ?? '\u2014'}</td><td style="color:${timeColor}">${r.duration_s ? r.duration_s.toFixed(2) + 's' : '\u2014'}</td><td style="color:${r.total_errors > 0 ? 'var(--err)' : 'var(--muted)'}">${r.total_errors || 0}</td><td>${addonsStr}</td></tr>`
      if (r.addons?.length) {
        h += '<tr class="az-req-detail"><td colspan="6"><div style="display:flex;flex-wrap:wrap;gap:.4rem">'
        for (const a of r.addons) {
          const ok = a.status === 'success'
          h += `<div style="padding:.25rem .5rem;background:${ok ? 'var(--ok-bg)' : 'var(--err-bg)'};border:1px solid ${ok ? '#065f46' : '#7f1d1d'};border-radius:6px;font-size:.65rem"><strong style="color:${ok ? 'var(--ok)' : 'var(--err)'}">${escapeHtml(a.name)}</strong><span style="color:var(--muted);margin-left:.3rem">${a.streams ?? 0} streams</span><span style="color:var(--muted);margin-left:.2rem">${a.time_s ? a.time_s.toFixed(2) + 's' : ''}</span>${a.error ? `<div style="color:var(--err);font-size:.6rem;margin-top:.1rem">${escapeHtml(a.error)}</div>` : ''}</div>`
        }
        h += '</div></td></tr>'
      }
    }
    h += '</tbody></table>'
  }
  // HTTP requests
  const httpReqs = d.http_requests || []
  if (httpReqs.length) {
    h += '<div class="az-section">HTTP REQUESTS <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">(last ' + httpReqs.length + ')</span></div>'
    h += '<table class="az-table"><thead><tr><th>METHOD</th><th>PATH</th><th>STATUS</th><th>LATENCY</th></tr></thead><tbody>'
    for (const r of httpReqs.slice(-25).reverse()) {
      const statusColor = r.status_code < 300 ? 'var(--ok)' : r.status_code < 400 ? 'var(--warn)' : 'var(--err)'
      const latColor = r.latency_ms > 5000 ? 'var(--err)' : r.latency_ms > 2000 ? 'var(--warn)' : 'var(--ok)'
      h += `<tr><td style="color:var(--accent2)">${escapeHtml(r.method)}</td><td style="font-family:monospace;font-size:.6rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)">${escapeHtml(r.path)}</td><td style="color:${statusColor};font-weight:600">${r.status_code}</td><td style="color:${latColor}">${r.latency_ms}ms</td></tr>`
    }
    h += '</tbody></table>'
  }
  // Pipeline steps
  const pipeline = d.pipeline || []
  if (pipeline.length) {
    h += '<div class="az-section">PIPELINE STEPS <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">(last ' + pipeline.length + ')</span></div>'
    const stageStats = {}
    for (const p of pipeline) {
      if (!stageStats[p.stage]) stageStats[p.stage] = { times: [], counts: [] }
      stageStats[p.stage].times.push(p.time_s)
      stageStats[p.stage].counts.push(p.count)
    }
    h += '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.4rem">'
    for (const [stage, s] of Object.entries(stageStats)) {
      const avg = s.times.reduce((a, b) => a + b, 0) / s.times.length
      const avgCount = Math.round(s.counts.reduce((a, b) => a + b, 0) / s.counts.length)
      h += `<div style="padding:.3rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.65rem"><strong style="color:var(--accent2)">${escapeHtml(stage)}</strong> <span style="color:var(--muted)">avg ${(avg * 1000).toFixed(1)}ms \u00b7 ~${avgCount} items \u00b7 ${s.times.length} runs</span></div>`
    }
    h += '</div>'
  }
  if (!addonList.length && !reqs.length && !httpReqs.length) {
    h += '<div style="color:var(--muted);padding:1rem;text-align:center">No AIOStreams activity found in ' + (d.log_lines || 0) + ' log lines. The service may not be generating matching log entries, or try increasing the line count.</div>'
  }
  // Time range
  const tr = d.time_range || {}
  if (tr.start || tr.end) {
    h += `<div style="margin-top:.6rem;font-size:.58rem;color:var(--muted);text-align:right">Log range: ${escapeHtml(tr.start || '?')} \u2014 ${escapeHtml(tr.end || '?')}</div>`
  }
  body.innerHTML = h
}

// ── AIOStreams Test Suite ──
const AIO_TESTS = {
  popular: [
    { imdb: 'tt0468569', type: 'movie', name: 'The Dark Knight' },
    { imdb: 'tt1375666', type: 'movie', name: 'Inception' },
    { imdb: 'tt15398776', type: 'movie', name: 'Oppenheimer' },
    { imdb: 'tt0903747:3:7', type: 'series', name: 'Breaking Bad S03E07' },
    { imdb: 'tt0944947:1:1', type: 'series', name: 'Game of Thrones S01E01' },
  ],
  movies: [
    { imdb: 'tt0468569', type: 'movie', name: 'The Dark Knight' },
    { imdb: 'tt1375666', type: 'movie', name: 'Inception' },
    { imdb: 'tt15398776', type: 'movie', name: 'Oppenheimer' },
    { imdb: 'tt0111161', type: 'movie', name: 'Shawshank Redemption' },
    { imdb: 'tt0816692', type: 'movie', name: 'Interstellar' },
    { imdb: 'tt10676052', type: 'movie', name: 'Deadpool & Wolverine' },
    { imdb: 'tt6718170', type: 'movie', name: 'The Super Mario Bros. Movie' },
    { imdb: 'tt0118799', type: 'movie', name: 'Life Is Beautiful' },
  ],
  series: [
    { imdb: 'tt0903747:3:7', type: 'series', name: 'Breaking Bad S03E07' },
    { imdb: 'tt0944947:1:1', type: 'series', name: 'Game of Thrones S01E01' },
    { imdb: 'tt2861424:2:1', type: 'series', name: 'Rick and Morty S02E01' },
    { imdb: 'tt0388629:1:1', type: 'series', name: 'One Piece S01E01' },
    { imdb: 'tt11280740:1:1', type: 'series', name: 'Severance S01E01' },
    { imdb: 'tt7366338:1:1', type: 'series', name: 'Chernobyl S01E01' },
    { imdb: 'tt0877057:1:1', type: 'series', name: 'Death Note S01E01' },
  ],
}
AIO_TESTS.all = [...AIO_TESTS.movies, ...AIO_TESTS.series.filter(t => !AIO_TESTS.movies.find(m => m.imdb === t.imdb))]

let testQuickPicksInit = false
let suiteResults = []

function initTestSuite() {
  if (testQuickPicksInit) return
  testQuickPicksInit = true
  const picks = document.getElementById('test-quickpicks')
  if (!picks) return
  const cats = { 'Movies': AIO_TESTS.movies, 'Series': AIO_TESTS.series }
  for (const [cat, titles] of Object.entries(cats)) {
    const label = document.createElement('span')
    label.style.cssText = 'font-size:.55rem;color:var(--accent2);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-right:.1rem'
    label.textContent = cat
    picks.appendChild(label)
    for (const t of titles) {
      const chip = document.createElement('span')
      chip.className = 'az-chip'
      chip.textContent = t.name
      chip.title = `${t.type}: ${t.imdb}`
      chip.onclick = () => { document.getElementById('test-imdb').value = t.imdb; document.getElementById('test-type').value = t.type }
      picks.appendChild(chip)
    }
    picks.appendChild(document.createElement('br'))
  }
}

async function runAioTest(appendToTable) {
  const imdb = document.getElementById('test-imdb').value.trim()
  const type = document.getElementById('test-type').value
  if (!imdb) { document.getElementById('test-status').textContent = 'Enter an IMDB ID'; return null }
  const btn = document.getElementById('test-run-btn')
  const status = document.getElementById('test-status')
  btn.disabled = true
  if (!appendToTable) status.textContent = `Testing ${imdb}...`
  const t0 = performance.now()
  let d, error = null
  try {
    const resp = await axios.post('/api/aiostreams/test', { imdb, type })
    d = resp.data
  } catch (e) {
    error = e.response?.data?.error || e.message || 'Request failed'
    d = e.response?.data || null
  }
  btn.disabled = false
  const result = {
    imdb, type,
    streams: d?.stream_count || 0,
    latency_ms: d?.latency_ms || Math.round(performance.now() - t0),
    error: error || d?.error || null,
    streamList: d?.streams || [],
  }
  if (!appendToTable) {
    status.textContent = result.error
      ? `Error: ${result.error}`
      : `Done \u2014 ${result.streams} streams in ${result.latency_ms}ms`
    renderSingleResult(result)
  }
  return result
}

function parseStreamInfo(s) {
  const name = s.name || ''
  const title = s.title || s.description || ''
  const nameParts = name.split('\n').map(p => p.trim()).filter(Boolean)
  const titleParts = title.split('\n').map(p => p.trim()).filter(Boolean)
  const source = nameParts[0] || 'Unknown'
  const quality = nameParts.slice(1).join(' ') || ''
  const filename = titleParts[0] || ''
  const meta = titleParts.slice(1).join(' ') || ''
  // Extract resolution
  const resMatch = (name + ' ' + title).match(/\b(4[kK]|2160p|1080p|720p|480p)\b/)
  const resolution = resMatch ? resMatch[1].replace('4k', '4K').replace('4K', '4K') : ''
  // Extract size from emoji or text patterns
  const sizeMatch = (name + ' ' + title).match(/\u{1F4E6}\s*([\d.]+\s*[KMGT]?B)/u) || (name + ' ' + title).match(/\b([\d.]+\s*[KMGT]B)\b/)
  const size = sizeMatch ? sizeMatch[1] : ''
  return { source, quality, filename, meta, resolution, size }
}

function renderSingleResult(r) {
  const el = document.getElementById('test-results')
  const latColor = r.latency_ms > 10000 ? 'var(--err)' : r.latency_ms > 3000 ? 'var(--warn)' : 'var(--ok)'
  const streamColor = r.streams > 0 ? 'var(--ok)' : 'var(--err)'
  let h = `<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:.5rem;overflow:hidden">`
  // Header
  h += `<div style="display:flex;gap:.6rem;align-items:center;padding:.45rem .6rem;border-bottom:1px solid var(--border);font-size:.72rem">`
  h += `<code style="color:var(--accent2)">${escapeHtml(r.imdb)}</code>`
  h += `<span style="color:var(--muted);font-size:.6rem;text-transform:uppercase">${escapeHtml(r.type)}</span>`
  h += `<span style="color:${streamColor};font-weight:700">${r.streams} streams</span>`
  h += `<span style="color:${latColor}">${(r.latency_ms / 1000).toFixed(2)}s</span>`
  if (r.error) h += `<span style="color:var(--err);font-size:.62rem;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px">${escapeHtml(r.error)}</span>`
  h += '</div>'
  // Streams
  if (r.streamList.length) {
    h += '<table style="width:100%;border-collapse:collapse;font-size:.65rem"><thead><tr>'
    h += '<th style="text-align:left;padding:.2rem .4rem;color:var(--muted);font-size:.55rem;text-transform:uppercase;border-bottom:1px solid var(--border)">Source</th>'
    h += '<th style="text-align:left;padding:.2rem .4rem;color:var(--muted);font-size:.55rem;text-transform:uppercase;border-bottom:1px solid var(--border)">Quality</th>'
    h += '<th style="text-align:left;padding:.2rem .4rem;color:var(--muted);font-size:.55rem;text-transform:uppercase;border-bottom:1px solid var(--border)">File</th>'
    h += '<th style="text-align:right;padding:.2rem .4rem;color:var(--muted);font-size:.55rem;text-transform:uppercase;border-bottom:1px solid var(--border)">Size</th>'
    h += '</tr></thead><tbody>'
    const show = r.streamList.slice(0, 50)
    for (const s of show) {
      const info = parseStreamInfo(s)
      const resBadge = info.resolution
        ? `<span style="display:inline-block;padding:0 .25rem;border-radius:3px;font-size:.55rem;font-weight:700;background:${info.resolution.includes('4') || info.resolution.includes('2160') ? '#312e81' : info.resolution.includes('1080') ? '#1e3a5f' : '#2d3748'};color:${info.resolution.includes('4') || info.resolution.includes('2160') ? '#a5b4fc' : info.resolution.includes('1080') ? '#7dd3fc' : '#94a3b8'}">${escapeHtml(info.resolution)}</span> `
        : ''
      h += `<tr style="border-bottom:1px solid #0d1025">`
      h += `<td style="padding:.2rem .4rem;color:#e2e8f0;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(info.source)}</td>`
      h += `<td style="padding:.2rem .4rem;color:#94a3b8">${resBadge}${escapeHtml(info.quality)}</td>`
      h += `<td style="padding:.2rem .4rem;color:var(--muted);font-family:monospace;font-size:.58rem;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(info.filename)}">${escapeHtml(info.filename)}</td>`
      h += `<td style="padding:.2rem .4rem;text-align:right;color:var(--accent2);white-space:nowrap">${escapeHtml(info.size)}</td>`
      h += '</tr>'
    }
    h += '</tbody></table>'
    if (r.streamList.length > 50) h += `<div style="padding:.25rem .5rem;font-size:.6rem;color:var(--muted);text-align:center">...and ${r.streamList.length - 50} more streams</div>`
  } else if (r.error) {
    h += `<div style="padding:.4rem .6rem;font-size:.68rem;color:var(--err)">${escapeHtml(r.error)}</div>`
  } else {
    h += '<div style="padding:.4rem .6rem;font-size:.68rem;color:var(--muted)">No streams returned</div>'
  }
  h += '</div>'
  el.innerHTML = h + el.innerHTML
}

function renderSuiteSummary(results) {
  const summary = document.getElementById('test-summary')
  const total = results.length
  const withStreams = results.filter(r => r.streams > 0).length
  const totalStreams = results.reduce((a, r) => a + r.streams, 0)
  const avgStreams = total > 0 ? (totalStreams / total).toFixed(1) : 0
  const avgLatency = total > 0 ? (results.reduce((a, r) => a + r.latency_ms, 0) / total / 1000).toFixed(2) : 0
  const errors = results.filter(r => r.error).length
  const fastest = total > 0 ? Math.min(...results.map(r => r.latency_ms)) : 0
  const slowest = total > 0 ? Math.max(...results.map(r => r.latency_ms)) : 0

  summary.style.display = 'block'
  summary.innerHTML = `<div class="az-summary">
    ${azStat(total, 'TITLES TESTED')}
    ${azStat(withStreams + '/' + total, 'WITH STREAMS')}
    ${azStat(totalStreams, 'TOTAL STREAMS')}
    ${azStat(avgStreams, 'AVG STREAMS')}
    ${azStat(avgLatency + 's', 'AVG LATENCY')}
    ${azStat((fastest / 1000).toFixed(2) + 's', 'FASTEST')}
    ${azStat((slowest / 1000).toFixed(2) + 's', 'SLOWEST')}
    ${azStat(errors, 'ERRORS')}
  </div>`
}

async function runAioTestSuite(category) {
  const titles = AIO_TESTS[category || 'popular'] || AIO_TESTS.popular
  const status = document.getElementById('test-status')
  const results = document.getElementById('test-results')
  const progressWrap = document.getElementById('test-progress-wrap')
  const progressBar = document.getElementById('test-progress-bar')
  const progressLabel = document.getElementById('test-progress-label')
  const progressPct = document.getElementById('test-progress-pct')
  const summary = document.getElementById('test-summary')

  results.innerHTML = ''
  summary.style.display = 'none'
  progressWrap.style.display = 'block'
  suiteResults = []

  for (let i = 0; i < titles.length; i++) {
    const t = titles[i]
    const pct = ((i + 1) / titles.length * 100).toFixed(0)
    progressLabel.textContent = `[${i + 1}/${titles.length}] ${t.name}`
    progressPct.textContent = pct + '%'
    progressBar.style.width = pct + '%'
    status.textContent = `Testing ${t.name}...`
    document.getElementById('test-imdb').value = t.imdb
    document.getElementById('test-type').value = t.type
    const r = await runAioTest(true)
    if (r) {
      suiteResults.push(r)
      renderSingleResult(r)
    }
    if (i < titles.length - 1) await new Promise(resolve => setTimeout(resolve, 300))
  }

  progressWrap.style.display = 'none'
  status.textContent = `Suite complete \u2014 ${titles.length} titles tested`
  renderSuiteSummary(suiteResults)
  setTimeout(loadAnalyzer, 2000)
}

// ── MediaFusion Metrics ──
let mfMetricsData = null

async function loadMfMetrics() {
  const body = document.getElementById('mfmetrics-body')
  const status = document.getElementById('mfmetrics-status')
  body.innerHTML = '<div style="text-align:center;padding:1rem"><span class="spin"></span> Loading metrics...</div>'
  status.textContent = ''
  let d
  try {
    const resp = await axios.get('/api/mediafusion/metrics')
    d = resp.data
  } catch (e) {
    body.innerHTML = `<div style="color:var(--err);padding:.5rem">Failed: ${escapeHtml(e.response?.data?.error || e.message)}</div>`
    return
  }
  if (!d || d.error) {
    body.innerHTML = `<div style="color:var(--err);padding:.5rem">${escapeHtml(d?.error || 'No data')}</div>`
    return
  }
  mfMetricsData = d
  status.textContent = 'Updated: ' + new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })
  renderMfMetrics(d)
}

function mfStat(val, label, color) {
  const c = color ? ` style="color:${color}"` : ''
  return `<div class="az-stat"><div class="az-val"${c}>${val}</div><div class="az-lbl">${label}</div></div>`
}

function renderMfMetrics(d) {
  const body = document.getElementById('mfmetrics-body')
  let h = ''

  // ── System Overview ──
  const ov = d.overview || {}
  const streams = ov.streams || {}
  const content = ov.content || {}
  const users = ov.users || {}
  const mod = ov.moderation || {}
  h += '<div class="az-section">SYSTEM OVERVIEW</div>'
  h += '<div class="az-summary">'
  h += mfStat(formatNumber(streams.total || 0), 'TOTAL STREAMS', 'var(--accent2)')
  h += mfStat(formatNumber(content.total || 0), 'TOTAL CONTENT')
  h += mfStat(formatNumber(content.movies || 0), 'MOVIES')
  h += mfStat(formatNumber(content.series || 0), 'SERIES')
  h += mfStat(formatNumber(content.tv_channels || 0), 'TV CHANNELS')
  h += mfStat(mod.pending_contributions || 0, 'PENDING MOD')
  h += '</div>'

  // Streams by type
  const byType = streams.by_type || {}
  const typeEntries = Object.entries(byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  if (typeEntries.length) {
    h += '<div class="az-section">STREAMS BY TYPE</div>'
    const maxTypeVal = Math.max(...typeEntries.map(([, v]) => v), 1)
    for (const [type, count] of typeEntries) {
      const pct = (count / maxTypeVal) * 100
      h += `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;font-size:.72rem">`
      h += `<span style="min-width:110px;text-align:right;color:#94a3b8;text-transform:capitalize">${escapeHtml(type.replace(/_/g, ' '))}</span>`
      h += `<div class="az-bar-wrap" style="flex:1"><div class="az-bar green" style="width:${pct}%"></div></div>`
      h += `<span style="min-width:70px;font-weight:700;color:var(--accent2)">${formatNumber(count)}</span>`
      h += '</div>'
    }
  }

  // ── Users ──
  const uStats = d.users || {}
  if (uStats.total_users != null) {
    h += '<div class="az-section">USERS</div>'
    h += '<div class="az-summary">'
    h += mfStat(formatNumber(uStats.total_users || 0), 'TOTAL USERS', 'var(--accent2)')
    const active = uStats.active_users || {}
    h += mfStat(formatNumber(active.daily || 0), 'ACTIVE TODAY', 'var(--ok)')
    h += mfStat(formatNumber(active.weekly || 0), 'ACTIVE WEEK')
    h += mfStat(formatNumber(active.monthly || 0), 'ACTIVE MONTH')
    h += mfStat(formatNumber(uStats.new_users_this_week || 0), 'NEW THIS WEEK', '#818cf8')
    h += mfStat(formatNumber(uStats.total_profiles || 0), 'PROFILES')
    if (uStats.avg_profiles_per_user != null) h += mfStat(uStats.avg_profiles_per_user.toFixed(1), 'AVG PROFILES/USER')
    h += '</div>'
    // Users by role
    const byRole = uStats.users_by_role || {}
    const roleEntries = Object.entries(byRole).filter(([, v]) => v > 0)
    if (roleEntries.length) {
      h += '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.3rem">'
      for (const [role, count] of roleEntries) {
        h += `<div style="padding:.2rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.62rem"><span style="color:var(--accent2);font-weight:700">${escapeHtml(role)}</span> <span style="color:var(--muted)">${count}</span></div>`
      }
      h += '</div>'
    }
  }

  // ── Activity ──
  const act = d.activity || {}
  if (Object.keys(act).length) {
    h += '<div class="az-section">ACTIVITY</div>'
    h += '<div class="az-summary">'
    const wh = act.watch_history || {}
    h += mfStat(formatNumber(wh.total || 0), 'WATCH HISTORY')
    h += mfStat(formatNumber(wh.recent || 0), 'RECENT')
    h += mfStat(formatNumber(wh.unique_users || 0), 'UNIQUE WATCHERS')
    const dl = act.downloads || {}
    h += mfStat(formatNumber(dl.total || 0), 'DOWNLOADS')
    const lib = act.library || {}
    h += mfStat(formatNumber(lib.total_items || 0), 'LIBRARY ITEMS')
    const pb = act.playback || {}
    h += mfStat(formatNumber(pb.total_plays || 0), 'TOTAL PLAYS')
    const rss = act.rss_feeds || {}
    h += mfStat(formatNumber(rss.total || 0), 'RSS FEEDS')
    h += '</div>'
  }

  // ── Contributions ──
  const contrib = d.contributions || {}
  if (Object.keys(contrib).length) {
    h += '<div class="az-section">CONTRIBUTIONS</div>'
    h += '<div class="az-summary">'
    h += mfStat(formatNumber(contrib.total_contributions || 0), 'TOTAL', 'var(--accent2)')
    h += mfStat(formatNumber(contrib.pending_review || 0), 'PENDING REVIEW', contrib.pending_review > 0 ? 'var(--warn)' : '')
    h += mfStat(formatNumber(contrib.recent_contributions_week || 0), 'THIS WEEK')
    h += mfStat(formatNumber(contrib.unique_contributors || 0), 'CONTRIBUTORS')
    h += mfStat(formatNumber(contrib.total_stream_votes || 0), 'STREAM VOTES')
    h += mfStat(formatNumber(contrib.total_metadata_votes || 0), 'META VOTES')
    h += '</div>'
    const byStatus = contrib.contributions_by_status || {}
    const statusEntries = Object.entries(byStatus).filter(([, v]) => v > 0)
    if (statusEntries.length) {
      h += '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.3rem">'
      for (const [st, count] of statusEntries) {
        const c = st === 'approved' ? 'var(--ok)' : st === 'rejected' ? 'var(--err)' : 'var(--warn)'
        h += `<div style="padding:.2rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.62rem"><span style="color:${c};font-weight:700">${escapeHtml(st)}</span> <span style="color:var(--muted)">${count}</span></div>`
      }
      h += '</div>'
    }
  }

  // ── Torrent Sources ──
  const sources = d.torrent_sources || []
  if (sources.length) {
    h += '<div class="az-section">TOP TORRENT SOURCES</div>'
    const maxSrc = Math.max(...sources.map(s => s.count || 0), 1)
    h += '<table class="az-table"><thead><tr><th>SOURCE</th><th style="width:200px">DISTRIBUTION</th><th>COUNT</th></tr></thead><tbody>'
    for (const s of sources.slice(0, 15)) {
      const pct = ((s.count || 0) / maxSrc) * 100
      h += `<tr><td style="color:#e2e8f0;font-weight:600;white-space:nowrap">${escapeHtml(s.name || s.source || '?')}</td><td><div class="az-bar-wrap"><div class="az-bar green" style="width:${pct}%"></div></div></td><td style="color:var(--accent2);font-weight:700">${formatNumber(s.count || 0)}</td></tr>`
    }
    h += '</tbody></table>'
  }

  // ── Debrid Cache ──
  const debrid = d.debrid_cache || {}
  const debridSvcs = debrid.services || debrid
  const debridEntries = Object.entries(debridSvcs).filter(([, v]) => typeof v === 'object' || typeof v === 'number')
  if (debridEntries.length) {
    h += '<div class="az-section">DEBRID CACHE</div>'
    h += '<div class="az-summary">'
    for (const [name, val] of debridEntries) {
      const count = typeof val === 'object' ? (val.cached_torrents || 0) : val
      if (count > 0) h += mfStat(formatNumber(count), name.toUpperCase(), 'var(--ok)')
    }
    h += '</div>'
  }

  // ── Scheduler Stats ──
  const sched = d.scheduler_stats || {}
  if (sched.total_jobs != null) {
    h += '<div class="az-section">SCHEDULER</div>'
    h += '<div class="az-summary">'
    h += mfStat(sched.total_jobs || 0, 'TOTAL JOBS')
    h += mfStat(sched.active_jobs || 0, 'ACTIVE', 'var(--ok)')
    h += mfStat(sched.disabled_jobs || 0, 'DISABLED', sched.disabled_jobs > 0 ? 'var(--warn)' : '')
    h += mfStat(sched.running_jobs || 0, 'RUNNING', sched.running_jobs > 0 ? 'var(--ok)' : '')
    h += mfStat(sched.global_scheduler_disabled ? 'YES' : 'NO', 'GLOBAL PAUSE', sched.global_scheduler_disabled ? 'var(--err)' : 'var(--ok)')
    h += '</div>'
    const cats = sched.jobs_by_category || {}
    const catEntries = Object.entries(cats)
    if (catEntries.length) {
      h += '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.3rem">'
      for (const [cat, info] of catEntries) {
        const active = typeof info === 'object' ? info.active : info
        const total = typeof info === 'object' ? info.total : info
        h += `<div style="padding:.2rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.62rem"><span style="color:var(--accent2);font-weight:700">${escapeHtml(cat)}</span> <span style="color:var(--ok)">${active}</span><span style="color:var(--muted)">/${total}</span></div>`
      }
      h += '</div>'
    }
  }

  // ── Scheduler Jobs (detailed list) ──
  const jobs = d.scheduler_jobs || []
  if (jobs.length) {
    h += '<div class="az-section">SCHEDULER JOBS <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">(top ' + jobs.length + ')</span></div>'
    h += '<table class="az-table"><thead><tr><th>JOB</th><th>STATUS</th><th>SCHEDULE</th><th>LAST RUN</th><th>NEXT RUN</th></tr></thead><tbody>'
    for (const j of jobs) {
      const isActive = j.is_active !== false && j.status !== 'disabled'
      const isRunning = j.is_running || j.status === 'running'
      const statusColor = isRunning ? 'var(--ok)' : isActive ? '#94a3b8' : 'var(--muted)'
      const statusText = isRunning ? 'running' : isActive ? 'active' : 'disabled'
      const name = j.name || j.job_id || j.id || '?'
      const crontab = j.crontab || j.schedule || j.trigger || ''
      const lastRun = j.last_run ? new Date(j.last_run).toLocaleString('en-CA', { timeZone: TZ, hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014'
      const nextRun = j.next_run ? new Date(j.next_run).toLocaleString('en-CA', { timeZone: TZ, hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014'
      h += `<tr><td style="color:#e2e8f0;font-weight:600;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(name)}">${escapeHtml(name)}</td><td style="color:${statusColor};font-weight:600">${statusText}</td><td style="font-family:monospace;font-size:.6rem;color:var(--muted)">${escapeHtml(crontab)}</td><td style="font-size:.62rem;color:var(--muted)">${lastRun}</td><td style="font-size:.62rem;color:#818cf8">${nextRun}</td></tr>`
    }
    h += '</tbody></table>'
  }

  // ── Source Health ──
  const srcHealth = d.source_health || []
  if (srcHealth.length) {
    h += '<div class="az-section">INDEXER SOURCE HEALTH</div>'
    h += '<table class="az-table"><thead><tr><th>SOURCE</th><th>MOVIE</th><th>SERIES</th><th>ANIME</th><th style="width:80px">SUCCESS</th><th>GATE</th></tr></thead><tbody>'
    for (const s of srcHealth) {
      const rate = s.success_rate != null ? (s.success_rate * 100).toFixed(0) : null
      const rateColor = rate == null ? '' : rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)'
      const gateColor = s.gate_status === 'allowed' ? 'var(--ok)' : s.gate_status === 'blocked' ? 'var(--err)' : 'var(--warn)'
      h += `<tr>`
      h += `<td style="color:#e2e8f0;font-weight:600;white-space:nowrap">${escapeHtml(s.source_name || s.source_key || '?')}</td>`
      h += `<td style="color:${s.supports_movie ? 'var(--ok)' : 'var(--muted)'}">${s.supports_movie ? '\u2713' : '\u2014'}</td>`
      h += `<td style="color:${s.supports_series ? 'var(--ok)' : 'var(--muted)'}">${s.supports_series ? '\u2713' : '\u2014'}</td>`
      h += `<td style="color:${s.supports_anime ? 'var(--ok)' : 'var(--muted)'}">${s.supports_anime ? '\u2713' : '\u2014'}</td>`
      h += `<td><div style="display:flex;align-items:center;gap:.2rem"><div class="az-bar-wrap" style="width:50px"><div class="az-bar ${rate >= 80 ? 'green' : rate >= 50 ? 'yellow' : 'red'}" style="width:${rate || 0}%"></div></div><span style="font-size:.62rem;color:${rateColor}">${rate != null ? rate + '%' : '\u2014'}</span></div></td>`
      h += `<td style="color:${gateColor};font-weight:600;font-size:.62rem">${escapeHtml(s.gate_status || '?')}</td>`
      h += '</tr>'
    }
    h += '</tbody></table>'
  }

  // ── Redis ──
  const redis = d.redis || {}
  if (Object.keys(redis).length) {
    h += '<div class="az-section">REDIS</div>'
    const mem = redis.memory || {}
    const perf = redis.performance || {}
    const cache = redis.cache || {}
    const conn = redis.connections || {}
    h += '<div class="az-summary">'
    h += mfStat(mem.used_memory_human || mem.used_memory || '\u2014', 'MEMORY USED')
    h += mfStat(mem.peak_memory_human || mem.peak_memory || '\u2014', 'PEAK MEMORY')
    h += mfStat(perf.ops_per_sec || perf.instantaneous_ops_per_sec || '\u2014', 'OPS/SEC', 'var(--accent2)')
    h += mfStat(cache.hit_rate != null ? (cache.hit_rate * 100).toFixed(1) + '%' : '\u2014', 'HIT RATE', cache.hit_rate >= 0.9 ? 'var(--ok)' : 'var(--warn)')
    h += mfStat(formatNumber(cache.hits || 0), 'CACHE HITS')
    h += mfStat(formatNumber(cache.misses || 0), 'CACHE MISSES')
    h += mfStat(conn.connected_clients || conn.clients || '\u2014', 'CLIENTS')
    if (mem.fragmentation_ratio != null) h += mfStat(mem.fragmentation_ratio.toFixed(2), 'FRAG RATIO')
    h += '</div>'
  }

  // ── Request Metrics ──
  const reqM = d.request_metrics || {}
  if (reqM.total_requests != null) {
    h += '<div class="az-section">REQUEST METRICS</div>'
    h += '<div class="az-summary">'
    h += mfStat(formatNumber(reqM.total_requests || 0), 'TOTAL REQUESTS', 'var(--accent2)')
    h += mfStat(formatNumber(reqM.total_endpoints || 0), 'ENDPOINTS')
    h += mfStat(formatNumber(reqM.unique_visitors || 0), 'UNIQUE VISITORS')
    h += mfStat(reqM.enabled ? 'ON' : 'OFF', 'TRACKING', reqM.enabled ? 'var(--ok)' : 'var(--muted)')
    h += '</div>'
  }
  const reqEndpoints = d.request_endpoints || []
  if (reqEndpoints.length) {
    h += '<table class="az-table"><thead><tr><th>ENDPOINT</th><th>REQUESTS</th><th>AVG TIME</th><th>ERRORS</th></tr></thead><tbody>'
    for (const ep of reqEndpoints.slice(0, 20)) {
      const route = ep.route || ep.path || ep.endpoint || '?'
      const avgTime = ep.avg_time != null ? ep.avg_time.toFixed(0) + 'ms' : '\u2014'
      const errColor = (ep.error_count || 0) > 0 ? 'var(--err)' : 'var(--muted)'
      h += `<tr><td style="font-family:monospace;font-size:.6rem;color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(route)}</td><td style="color:var(--accent2);font-weight:700">${formatNumber(ep.total_requests || 0)}</td><td>${avgTime}</td><td style="color:${errColor}">${ep.error_count || 0}</td></tr>`
    }
    h += '</tbody></table>'
  }

  // ── Worker Memory ──
  const workers = d.workers || {}
  const wSummary = workers.summary || {}
  if (wSummary.total_events) {
    h += '<div class="az-section">WORKER MEMORY</div>'
    h += '<div class="az-summary">'
    h += mfStat(formatNumber(wSummary.total_events || 0), 'TOTAL EVENTS')
    h += mfStat(wSummary.peak_rss ? formatBytes(wSummary.peak_rss) : '\u2014', 'PEAK RSS')
    const statuses = wSummary.status_counts || {}
    for (const [st, cnt] of Object.entries(statuses)) {
      h += mfStat(cnt, st.toUpperCase(), st === 'success' ? 'var(--ok)' : st === 'error' ? 'var(--err)' : '')
    }
    h += '</div>'
  }

  // ── Scrapers ──
  const scrapers = d.scrapers || {}
  const scraperList = Array.isArray(scrapers) ? scrapers : (scrapers.scrapers || Object.values(scrapers))
  if (Array.isArray(scraperList) && scraperList.length) {
    h += '<div class="az-section">SCRAPER PERFORMANCE</div>'
    h += '<table class="az-table"><thead><tr><th>SCRAPER</th><th>RUNS</th><th>FOUND</th><th>PROCESSED</th><th style="width:80px">SUCCESS</th><th>DURATION</th></tr></thead><tbody>'
    for (const s of scraperList) {
      if (!s || typeof s !== 'object') continue
      const name = s.name || s.scraper_name || '?'
      const agg = s.aggregated || s
      const rate = agg.success_rate != null ? (agg.success_rate * 100).toFixed(0) : null
      const rateColor = rate == null ? '' : rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)'
      const dur = agg.avg_duration || agg.duration
      h += `<tr><td style="color:#e2e8f0;font-weight:600;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</td><td>${formatNumber(agg.total_runs || 0)}</td><td style="color:var(--accent2)">${formatNumber(agg.items_found || 0)}</td><td>${formatNumber(agg.items_processed || 0)}</td><td><div style="display:flex;align-items:center;gap:.2rem"><div class="az-bar-wrap" style="width:50px"><div class="az-bar ${rate >= 80 ? 'green' : rate >= 50 ? 'yellow' : 'red'}" style="width:${rate || 0}%"></div></div><span style="font-size:.62rem;color:${rateColor}">${rate != null ? rate + '%' : '\u2014'}</span></div></td><td style="font-size:.62rem;color:var(--muted)">${dur != null ? dur.toFixed(1) + 's' : '\u2014'}</td></tr>`
    }
    h += '</tbody></table>'
  }

  body.innerHTML = h
}

// ── MediaFusion Scraper Analyzer ──
let mfAnalyzerData = null

async function loadMfAnalyzer() {
  const body = document.getElementById('mfanalyzer-body')
  const status = document.getElementById('mfanalyzer-status')
  const n = document.getElementById('mfanalyzer-lines')?.value || '10000'
  body.innerHTML = '<div style="text-align:center;padding:1rem"><span class="spin"></span> Analyzing scraper logs...</div>'
  status.textContent = ''
  let d
  try {
    const resp = await axios.get(`/api/mediafusion/analyze?n=${n}`)
    d = resp.data
  } catch (e) {
    body.innerHTML = `<div style="color:var(--err);padding:.5rem">Analyzer failed: ${escapeHtml(e.response?.data?.error || e.message)}</div>`
    return
  }
  if (!d || d.error) {
    body.innerHTML = `<div style="color:var(--err);padding:.5rem">${escapeHtml(d?.error || 'No data')}</div>`
    return
  }
  mfAnalyzerData = d
  status.textContent = `${d.log_lines} lines (${d.lines_parsed} unique) \u00b7 Updated: ${new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })}`
  renderMfAnalyzer(d)
}

async function loadMfAnalyzerRaw() {
  const body = document.getElementById('mfanalyzer-body')
  const status = document.getElementById('mfanalyzer-status')
  const n = document.getElementById('mfanalyzer-lines')?.value || '500'
  body.innerHTML = '<div style="text-align:center;padding:1rem"><span class="spin"></span> Loading raw logs...</div>'
  const d = await safeJson('/api/logs/mediafusion-taskiq-scrapy?n=' + n)
  if (!d || d.error) {
    body.innerHTML = `<div style="color:var(--err);padding:.5rem">${escapeHtml(d?.error || 'Failed to fetch logs')}</div>`
    return
  }
  const lines = d.lines || []
  status.textContent = `${lines.length} raw lines`
  if (!lines.length) {
    body.innerHTML = '<div style="color:var(--muted);padding:.5rem">No log lines returned.</div>'
    return
  }
  body.innerHTML = `<pre style="font-size:.6rem;font-family:monospace;color:#94a3b8;white-space:pre-wrap;word-break:break-all;margin:0;line-height:1.5">${lines.map(l => escapeHtml(l)).join('\n')}</pre>`
  body.scrollTop = body.scrollHeight
}

function renderMfAnalyzer(d) {
  const body = document.getElementById('mfanalyzer-body')
  const s = d.summary || {}
  let h = ''

  // ── Summary Stats (row 1: stream counts) ──
  h += '<div class="az-summary">'
  h += mfStat(s.streams_added || 0, 'STREAMS ADDED', 'var(--accent2)')
  h += mfStat(s.streams_1h || 0, 'LAST 1H', s.streams_1h > 0 ? 'var(--ok)' : '')
  h += mfStat(s.streams_6h || 0, 'LAST 6H', s.streams_6h > 0 ? 'var(--ok)' : '')
  h += mfStat(s.streams_24h || 0, 'LAST 24H', s.streams_24h > 0 ? 'var(--ok)' : '')
  h += mfStat(s.streams_per_hour != null ? s.streams_per_hour : '\u2014', 'STREAMS/HR', 'var(--accent2)')
  h += mfStat(s.unique_titles || 0, 'UNIQUE TITLES')
  h += '</div>'

  // ── Summary Stats (row 2: operations) ──
  h += '<div class="az-summary">'
  h += mfStat(s.store_operations || 0, 'STORE OPS')
  h += mfStat(s.total_valid || 0, 'VALID')
  h += mfStat(s.total_existing || 0, 'DUPLICATES', s.total_existing > 0 ? 'var(--warn)' : '')
  h += mfStat(s.imdb_resolved || 0, 'IMDB RESOLVED', 'var(--ok)')
  h += mfStat(s.synthetic_resolved || 0, 'SYNTHETIC', s.synthetic_resolved > 0 ? '#818cf8' : '')
  h += mfStat(s.errors || 0, 'ERRORS', s.errors > 0 ? 'var(--err)' : 'var(--ok)')
  h += mfStat(s.tasks_executed || 0, 'TASKS')
  h += '</div>'

  // ── Summary Stats (row 3: content analysis) ──
  if (s.avg_size_mb || s.total_size_gb || s.dmm_no_matches) {
    h += '<div class="az-summary">'
    if (s.avg_size_mb) h += mfStat(s.avg_size_mb + ' MB', 'AVG FILE SIZE')
    if (s.total_size_gb) h += mfStat(s.total_size_gb + ' GB', 'TOTAL SIZE', 'var(--accent2)')
    h += mfStat(s.dmm_no_matches || 0, 'DMM NO MATCH', s.dmm_no_matches > 0 ? 'var(--warn)' : '')
    h += mfStat(s.tmdb_not_found || 0, 'TMDB MISSING')
    h += '</div>'
  }

  // ── Log Level + Duration ──
  const levels = d.log_levels || {}
  const levelEntries = Object.entries(levels)
  h += '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.5rem 0;align-items:center">'
  if (d.log_duration_hours != null) {
    h += `<div style="padding:.2rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.62rem"><span style="color:var(--accent2);font-weight:700">SPAN</span> <span style="color:var(--muted)">${d.log_duration_hours}h</span></div>`
  }
  if (d.dmm_auth) {
    h += `<div style="padding:.2rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.62rem"><span style="color:var(--ok);font-weight:700">DMM</span> <span style="color:var(--muted)">${escapeHtml(d.dmm_auth)}</span></div>`
  }
  const levelColors = { ERROR: 'var(--err)', WARNING: 'var(--warn)', INFO: 'var(--ok)', DEBUG: 'var(--muted)' }
  for (const [level, count] of levelEntries) {
    h += `<div style="padding:.2rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.62rem"><span style="color:${levelColors[level] || 'var(--muted)'};font-weight:700">${level}</span> <span style="color:var(--muted)">${formatNumber(count)}</span></div>`
  }
  h += '</div>'

  // ── Resolution & Quality Breakdown ──
  const resolutions = d.resolutions || {}
  const qualities = d.qualities || {}
  const codecs = d.codecs || {}
  const hasQuality = Object.keys(resolutions).length || Object.keys(qualities).length || Object.keys(codecs).length
  if (hasQuality) {
    h += '<div class="az-section">QUALITY ANALYSIS</div>'
    h += '<div style="display:flex;gap:1.5rem;flex-wrap:wrap">'
    // Resolutions
    if (Object.keys(resolutions).length) {
      h += '<div>'
      h += '<div style="font-size:.55rem;color:var(--muted);font-weight:700;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.06em">Resolution</div>'
      const maxRes = Math.max(...Object.values(resolutions), 1)
      for (const [res, count] of Object.entries(resolutions)) {
        const pct = (count / maxRes) * 100
        const resColor = res.includes('2160') ? '#a5b4fc' : res.includes('1080') ? '#7dd3fc' : res.includes('720') ? '#94a3b8' : 'var(--muted)'
        h += `<div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.15rem;font-size:.65rem"><span style="min-width:50px;text-align:right;color:${resColor};font-weight:700">${escapeHtml(res)}</span><div class="az-bar-wrap" style="width:80px"><div class="az-bar green" style="width:${pct}%"></div></div><span style="color:var(--muted)">${count}</span></div>`
      }
      h += '</div>'
    }
    // Qualities
    if (Object.keys(qualities).length) {
      h += '<div>'
      h += '<div style="font-size:.55rem;color:var(--muted);font-weight:700;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.06em">Quality</div>'
      for (const [q, count] of Object.entries(qualities)) {
        h += `<div style="display:flex;gap:.3rem;font-size:.65rem;margin-bottom:.1rem"><span style="color:#94a3b8">${escapeHtml(q)}</span><span style="color:var(--muted)">${count}</span></div>`
      }
      h += '</div>'
    }
    // Codecs
    if (Object.keys(codecs).length) {
      h += '<div>'
      h += '<div style="font-size:.55rem;color:var(--muted);font-weight:700;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.06em">Codec</div>'
      for (const [c, count] of Object.entries(codecs)) {
        h += `<div style="display:flex;gap:.3rem;font-size:.65rem;margin-bottom:.1rem"><span style="color:#94a3b8">${escapeHtml(c)}</span><span style="color:var(--muted)">${count}</span></div>`
      }
      h += '</div>'
    }
    h += '</div>'
  }

  // ── Streams Added Timeline ──
  const byHour = d.streams_by_hour || {}
  const hourEntries = Object.entries(byHour)
  if (hourEntries.length) {
    h += '<div class="az-section">STREAMS ADDED TIMELINE</div>'
    const maxHour = Math.max(...hourEntries.map(([, v]) => v), 1)
    for (const [hour, count] of hourEntries) {
      const pct = (count / maxHour) * 100
      const label = hour.replace('T', ' ') + ':00'
      h += `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem;font-size:.68rem"><span style="min-width:120px;text-align:right;color:var(--muted);font-family:monospace;font-size:.6rem">${escapeHtml(label)}</span><div class="az-bar-wrap" style="flex:1"><div class="az-bar green" style="width:${pct}%"></div></div><span style="min-width:40px;font-weight:700;color:var(--ok)">${count}</span></div>`
    }
  }

  // ── Sources ──
  const sourcesAdded = d.sources_added || {}
  const srcEntries = Object.entries(sourcesAdded).sort((a, b) => b[1] - a[1])
  if (srcEntries.length) {
    h += '<div class="az-section">STREAMS BY SOURCE</div>'
    const maxSrc = Math.max(...srcEntries.map(([, v]) => v), 1)
    for (const [src, count] of srcEntries.slice(0, 15)) {
      const pct = (count / maxSrc) * 100
      h += `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;font-size:.72rem"><span style="min-width:200px;text-align:right;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(src)}</span><div class="az-bar-wrap" style="flex:1"><div class="az-bar green" style="width:${pct}%"></div></div><span style="min-width:50px;font-weight:700;color:var(--accent2)">${count}</span></div>`
    }
  }

  // ── Media Types + Years ──
  const mediaTypes = d.media_types_added || {}
  const yearsAdded = d.years_added || {}
  const mtEntries = Object.entries(mediaTypes)
  const yearEntries = Object.entries(yearsAdded)
  if (mtEntries.length || yearEntries.length) {
    h += '<div class="az-section">CONTENT BREAKDOWN</div>'
    h += '<div style="display:flex;gap:1.5rem;flex-wrap:wrap">'
    if (mtEntries.length) {
      h += '<div><div style="font-size:.55rem;color:var(--muted);font-weight:700;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.06em">By Type</div><div style="display:flex;gap:.4rem;flex-wrap:wrap">'
      for (const [type, count] of mtEntries) {
        h += `<div style="padding:.25rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.65rem"><span style="color:var(--accent2);font-weight:700;text-transform:capitalize">${escapeHtml(type)}</span> <span style="color:var(--ok);font-weight:700">${count}</span></div>`
      }
      h += '</div></div>'
    }
    if (yearEntries.length) {
      h += '<div><div style="font-size:.55rem;color:var(--muted);font-weight:700;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.06em">By Year</div><div style="display:flex;gap:.3rem;flex-wrap:wrap">'
      for (const [year, count] of yearEntries.slice(0, 12)) {
        h += `<div style="padding:.2rem .4rem;background:#0a0c14;border:1px solid var(--border);border-radius:4px;font-size:.6rem"><span style="color:#818cf8">${year}</span> <span style="color:var(--muted)">${count}</span></div>`
      }
      h += '</div></div>'
    }
    h += '</div>'
  }

  // ── Top Titles ──
  const topTitles = d.top_titles || []
  if (topTitles.length && topTitles[0][1] > 1) {
    h += '<div class="az-section">TOP TITLES <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">(by stream count)</span></div>'
    h += '<table class="az-table"><thead><tr><th>TITLE</th><th>STREAMS</th></tr></thead><tbody>'
    for (const [title, count] of topTitles.filter(([, c]) => c > 1).slice(0, 15)) {
      h += `<tr><td style="color:#e2e8f0;font-weight:600;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(title)}</td><td style="color:var(--accent2);font-weight:700">${count}</td></tr>`
    }
    h += '</tbody></table>'
  }

  // ── Crawl Progress ──
  const crawls = d.crawl_snapshots || []
  if (crawls.length) {
    h += '<div class="az-section">CRAWL PROGRESS <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">(' + crawls.length + ' snapshots)</span></div>'
    const latest = d.latest_crawl || crawls[crawls.length - 1]
    if (latest && latest.pages > 0) {
      h += '<div class="az-summary">'
      h += mfStat(formatNumber(latest.pages), 'PAGES CRAWLED', 'var(--accent2)')
      h += mfStat(latest.pages_per_min + '/min', 'CRAWL RATE')
      h += mfStat(formatNumber(latest.items), 'ITEMS SCRAPED', 'var(--ok)')
      h += mfStat(latest.items_per_min + '/min', 'SCRAPE RATE')
      h += '</div>'
    }
    if (crawls.length > 2) {
      const maxItems = Math.max(...crawls.map(c => c.items), 1)
      h += '<div style="display:flex;align-items:flex-end;gap:2px;height:50px;margin-top:.3rem;padding:0 .2rem;background:#0a0c14;border-radius:4px">'
      for (const c of crawls) {
        const pct = (c.items / maxItems) * 100
        h += `<div style="flex:1;background:var(--ok);border-radius:1px 1px 0 0;min-width:3px;height:${Math.max(pct, 2)}%" title="${c.timestamp}: ${c.pages} pages, ${c.items} items @ ${c.items_per_min}/min"></div>`
      }
      h += '</div>'
      h += `<div style="display:flex;justify-content:space-between;font-size:.5rem;color:var(--muted);margin-top:.1rem"><span>${crawls[0].timestamp?.replace('T', ' ') || ''}</span><span>${crawls[crawls.length - 1].timestamp?.replace('T', ' ') || ''}</span></div>`
    }
  }

  // ── Crawled Domains ──
  const domains = d.crawled_domains || {}
  const domainEntries = Object.entries(domains)
  if (domainEntries.length) {
    h += '<div class="az-section">CRAWLED DOMAINS</div>'
    const maxDom = Math.max(...domainEntries.map(([, v]) => v), 1)
    for (const [dom, count] of domainEntries.slice(0, 10)) {
      const pct = (count / maxDom) * 100
      h += `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem;font-size:.68rem"><span style="min-width:200px;text-align:right;color:#94a3b8;font-family:monospace;font-size:.58rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(dom)}</span><div class="az-bar-wrap" style="flex:1"><div class="az-bar green" style="width:${pct}%"></div></div><span style="min-width:40px;font-weight:700;color:var(--accent2)">${formatNumber(count)}</span></div>`
    }
  }

  // ── HTTP Status Distribution ──
  const statuses = d.crawled_statuses || {}
  const statusEntries = Object.entries(statuses)
  if (statusEntries.length) {
    h += '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.3rem">'
    for (const [code, count] of statusEntries) {
      const c = code < 300 ? 'var(--ok)' : code < 400 ? 'var(--warn)' : 'var(--err)'
      h += `<div style="padding:.2rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.62rem"><span style="color:${c};font-weight:700">HTTP ${code}</span> <span style="color:var(--muted)">${formatNumber(count)}</span></div>`
    }
    h += '</div>'
  }

  // ── Error Categories ──
  const errCats = d.error_categories || {}
  const errCatEntries = Object.entries(errCats).sort((a, b) => b[1] - a[1])
  if (errCatEntries.length) {
    h += '<div class="az-section">ERROR BREAKDOWN</div>'
    const maxErr = Math.max(...errCatEntries.map(([, v]) => v), 1)
    for (const [cat, count] of errCatEntries) {
      const pct = (count / maxErr) * 100
      h += `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem;font-size:.72rem"><span style="min-width:130px;text-align:right;color:var(--err)">${escapeHtml(cat)}</span><div class="az-bar-wrap" style="flex:1"><div class="az-bar red" style="width:${pct}%"></div></div><span style="min-width:40px;font-weight:700;color:var(--err)">${count}</span></div>`
    }
  }

  // ── DMM No Match ──
  const dmmTypes = d.dmm_no_match_types || {}
  const dmmEntries = Object.entries(dmmTypes)
  if (dmmEntries.length) {
    h += '<div class="az-section">DMM NO MATCH BY TYPE</div>'
    h += '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.4rem">'
    for (const [type, count] of dmmEntries) {
      h += `<div style="padding:.25rem .5rem;background:#0a0c14;border:1px solid var(--border);border-radius:6px;font-size:.65rem"><span style="color:var(--warn);font-weight:700;text-transform:capitalize">${escapeHtml(type)}</span> <span style="color:var(--muted)">${formatNumber(count)}</span></div>`
    }
    h += '</div>'
    // Sample unmatched titles
    const dmmSamples = d.dmm_no_match_samples || []
    if (dmmSamples.length) {
      h += '<table class="az-table"><thead><tr><th>TITLE</th><th>YEAR</th><th>TYPE</th><th>CANDIDATES</th></tr></thead><tbody>'
      for (const s of dmmSamples.slice(0, 10)) {
        h += `<tr><td style="color:#94a3b8;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.title)}</td><td style="color:var(--muted)">${escapeHtml(s.year)}</td><td style="text-transform:capitalize;color:var(--muted)">${escapeHtml(s.type)}</td><td style="color:${s.candidates > 0 ? 'var(--warn)' : 'var(--muted)'}">${s.candidates}</td></tr>`
      }
      h += '</tbody></table>'
    }
  }

  // ── TMDB Errors ──
  const tmdbErrs = d.tmdb_errors || {}
  const tmdbErrEntries = Object.entries(tmdbErrs).sort((a, b) => b[1] - a[1])
  if (tmdbErrEntries.length) {
    h += '<div class="az-section">TMDB ERRORS</div>'
    for (const [msg, count] of tmdbErrEntries.slice(0, 10)) {
      h += `<div style="display:flex;gap:.5rem;align-items:baseline;font-size:.72rem;padding:.2rem 0;border-bottom:1px solid #13172a"><span style="color:var(--err);font-weight:700;min-width:30px">${count}\u00d7</span><span style="color:#94a3b8;word-break:break-all">${escapeHtml(msg)}</span></div>`
    }
  }

  // ── Synthetic Titles ──
  const synthTitles = d.synthetic_titles || []
  if (synthTitles.length) {
    h += '<div class="az-section">SYNTHETIC IDS (NO IMDB MATCH) <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">' + synthTitles.length + ' unique</span></div>'
    h += '<div style="display:flex;gap:.3rem;flex-wrap:wrap">'
    for (const title of synthTitles.slice(0, 30)) {
      h += `<span style="padding:.15rem .4rem;background:rgba(129,140,248,.08);border:1px solid rgba(129,140,248,.15);border-radius:4px;font-size:.6rem;color:#818cf8">${escapeHtml(title)}</span>`
    }
    h += '</div>'
  }

  // ── Tasks Executed ──
  const tasks = d.tasks || []
  if (tasks.length) {
    h += '<div class="az-section">TASKS EXECUTED <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">(last ' + tasks.length + ')</span></div>'
    h += '<table class="az-table"><thead><tr><th>TASK</th><th>ID</th><th>TIME</th></tr></thead><tbody>'
    for (const t of tasks) {
      h += `<tr><td style="color:#e2e8f0;font-weight:600">${escapeHtml(t.task)}</td><td style="font-family:monospace;font-size:.6rem;color:var(--muted)">${escapeHtml(t.id)}</td><td style="font-size:.62rem;color:var(--muted)">${escapeHtml(t.timestamp || '\u2014')}</td></tr>`
    }
    h += '</tbody></table>'
  }

  // ── Recent Streams Added ──
  const recent = d.recent_streams || []
  if (recent.length) {
    h += '<div class="az-section">RECENT STREAMS ADDED <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">(last ' + recent.length + ')</span></div>'
    h += '<table class="az-table"><thead><tr><th>TIME</th><th>TYPE</th><th>TITLE</th><th>RES</th><th>SOURCE</th><th>STREAM</th></tr></thead><tbody>'
    for (const r of [...recent].reverse().slice(0, 50)) {
      const timeStr = r.timestamp ? r.timestamp.replace('T', ' ').slice(11, 19) : '\u2014'
      const resBadge = r.resolution ? `<span style="display:inline-block;padding:0 .2rem;border-radius:3px;font-size:.5rem;font-weight:700;background:${r.resolution.includes('2160') || r.resolution.includes('4') ? '#312e81' : r.resolution.includes('1080') ? '#1e3a5f' : '#2d3748'};color:${r.resolution.includes('2160') || r.resolution.includes('4') ? '#a5b4fc' : r.resolution.includes('1080') ? '#7dd3fc' : '#94a3b8'}">${escapeHtml(r.resolution)}</span>` : '<span style="color:var(--muted);font-size:.5rem">\u2014</span>'
      h += `<tr><td style="font-family:monospace;font-size:.6rem;color:var(--muted);white-space:nowrap">${timeStr}</td><td style="text-transform:capitalize;font-size:.6rem;color:${r.type === 'movie' ? '#818cf8' : 'var(--ok)'}">${escapeHtml(r.type)}</td><td style="color:#e2e8f0;font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</td><td>${resBadge}</td><td style="color:var(--accent2);font-size:.6rem;white-space:nowrap">${escapeHtml(r.source)}</td><td style="font-size:.52rem;color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.stream)}">${escapeHtml(r.stream)}</td></tr>`
    }
    h += '</tbody></table>'
  }

  // ── Recent Errors ──
  const recentErrors = d.recent_errors || []
  if (recentErrors.length) {
    h += '<div class="az-section">RECENT ERRORS <span style="font-weight:400;text-transform:none;color:var(--muted);font-size:.58rem">(last ' + recentErrors.length + ')</span></div>'
    for (const e of recentErrors.slice(-15).reverse()) {
      h += `<div style="display:flex;gap:.5rem;align-items:baseline;font-size:.68rem;padding:.2rem 0;border-bottom:1px solid #13172a"><span style="font-family:monospace;font-size:.55rem;color:var(--muted);white-space:nowrap;min-width:65px">${(e.timestamp || '').slice(11, 19)}</span><span style="color:var(--err);word-break:break-all">${escapeHtml(e.message)}</span></div>`
    }
  }

  // ── Time Range ──
  const tr = d.time_range || {}
  if (tr.start || tr.end) {
    h += `<div style="margin-top:.6rem;font-size:.58rem;color:var(--muted);text-align:right">Log range: ${escapeHtml(tr.start || '?')} \u2014 ${escapeHtml(tr.end || '?')}${d.log_duration_hours ? ' (' + d.log_duration_hours + 'h)' : ''}</div>`
  }

  if (!h) {
    h = '<div style="color:var(--muted);padding:1rem;text-align:center">No scraper activity found in ' + (d.log_lines || 0) + ' log lines.</div>'
  }

  body.innerHTML = h
}

// ── Init ──
refresh()
setInterval(refresh, 30000)
