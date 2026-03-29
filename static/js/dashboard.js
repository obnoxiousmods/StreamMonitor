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

  const runButton = document.getElementById('bench-run-btn')
  const statusLabel = document.getElementById('bench-status')
  runButton.disabled = true
  statusLabel.textContent = 'Running benchmark for ' + BENCH_TITLES[imdbId] + '...'

  const data = await safeJson('/api/benchmark?imdb=' + encodeURIComponent(imdbId))
  runButton.disabled = false

  if (!data) {
    statusLabel.textContent = 'Benchmark failed'
    return
  }
  statusLabel.textContent = 'Done — ' + new Date().toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })
  renderBenchTable(data)
}

async function runAllBenchmarks() {
  const statusLabel = document.getElementById('bench-status')
  const container = document.getElementById('bench-results')
  const titles = Object.entries(BENCH_TITLES)
  statusLabel.textContent = 'Running all ' + titles.length + ' benchmarks (this takes a while)...'
  container.innerHTML = ''

  let progress = 0
  for (const [imdbId, name] of titles) {
    progress++
    statusLabel.textContent = `[${progress}/${titles.length}] ${name}...`
    const data = await safeJson('/api/benchmark?imdb=' + encodeURIComponent(imdbId))
    if (data) renderBenchTable(data, true)
  }
  statusLabel.textContent = 'All ' + titles.length + ' benchmarks complete'
}

function renderBenchTable(data, append) {
  const container = document.getElementById('bench-results')
  const summary = data.summary || {}
  const selfHosted = summary.self_hosted || {}
  const publicStats = summary.public || {}

  const thStyle = 'text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase'
  const thStyleRight =
    'text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase'

  let html = `<div style="margin-bottom:1.2rem;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:.85rem;overflow-x:auto">`

  // Title row
  html += `<div style="display:flex;gap:.8rem;align-items:center;margin-bottom:.6rem;flex-wrap:wrap">`
  html += `<strong style="color:var(--accent2);font-size:.88rem">${escapeHtml(data.title)}</strong>`
  html += `<code style="font-size:.68rem">${escapeHtml(data.imdb)}</code>`
  html += `<span style="font-size:.68rem;color:var(--muted);margin-left:auto">${new Date(data.timestamp).toLocaleTimeString('en-CA', { timeZone: TZ, hour12: false })}</span>`
  html += `</div>`

  // Summary row
  html += `<div style="display:flex;gap:1rem;margin-bottom:.6rem;flex-wrap:wrap">`
  html += `<div style="font-size:.72rem;padding:.3rem .6rem;background:var(--ok-bg);border-radius:6px;border:1px solid #065f46">Self-hosted: <strong style="color:var(--ok)">${selfHosted.total_streams || 0}</strong> streams, avg <strong style="color:var(--ok)">${selfHosted.avg_latency_ms || '—'}</strong>ms</div>`
  html += `<div style="font-size:.72rem;padding:.3rem .6rem;background:#12232a;border-radius:6px;border:1px solid #164e63">Public: <strong style="color:#67e8f9">${publicStats.total_streams || 0}</strong> streams, avg <strong style="color:#67e8f9">${publicStats.avg_latency_ms || '—'}</strong>ms</div>`
  html += `</div>`

  // Table
  html += `<table style="width:100%;border-collapse:collapse;font-size:.72rem"><thead><tr style="border-bottom:1px solid var(--border)">`
  html += `<th style="${thStyle}">Name</th>`
  html += `<th style="${thStyle}">Group</th>`
  html += `<th style="${thStyleRight}">Latency</th>`
  html += `<th style="${thStyleRight}">Streams</th>`
  html += `<th style="${thStyleRight}">4K</th>`
  html += `<th style="${thStyleRight}">1080p</th>`
  html += `<th style="${thStyleRight}">720p</th>`
  html += `<th style="${thStyle}">Codec</th>`
  html += `<th style="${thStyle}">Status</th>`
  html += `</tr></thead><tbody>`

  for (const result of data.results || []) {
    const groupColor = result.group === 'self-hosted' ? 'ok' : ''
    const latencyColor =
      result.latency_ms != null
        ? result.latency_ms < 2000
          ? 'ok'
          : result.latency_ms < 5000
            ? 'warn'
            : 'err'
        : 'muted'
    const resolutions = result.resolutions || {}
    const cellStyle = 'padding:.25rem .4rem'

    html += `<tr style="border-bottom:1px solid #13172a">`
    html += `<td style="${cellStyle};color:#e2e8f0;font-weight:600">${escapeHtml(result.name)}</td>`
    html += `<td style="${cellStyle};color:var(--${groupColor || 'accent2'})">${escapeHtml(result.group)}</td>`
    html += `<td style="${cellStyle};text-align:right;color:var(--${latencyColor})">${result.latency_ms != null ? result.latency_ms + 'ms' : '—'}</td>`
    html += `<td style="${cellStyle};text-align:right;color:var(--accent2);font-weight:700">${result.streams || 0}</td>`
    html += `<td style="${cellStyle};text-align:right">${resolutions['4k'] || 0}</td>`
    html += `<td style="${cellStyle};text-align:right">${resolutions['1080p'] || 0}</td>`
    html += `<td style="${cellStyle};text-align:right">${resolutions['720p'] || 0}</td>`
    html += `<td style="${cellStyle}">${escapeHtml(result.top_codec || '—')}</td>`
    html += `<td style="${cellStyle};color:var(--${result.error ? 'err' : 'ok'})">${result.error ? escapeHtml(result.error) : 'OK'}</td>`
    html += `</tr>`
  }

  html += `</tbody></table></div>`
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

// ── Init ──
refresh()
setInterval(refresh, 30000)
