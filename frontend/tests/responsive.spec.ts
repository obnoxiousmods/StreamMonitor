import { expect, test, type Page, type Route } from '@playwright/test'

const services = {
  comet: { id: 'comet', name: 'Comet', unit: 'comet.service', category: 'streaming', web_url: 'https://comet.obby.ca' },
  mediafusion: {
    id: 'mediafusion',
    name: 'MediaFusion',
    unit: 'mediafusion.service',
    category: 'streaming',
    web_url: 'https://mediafusion.obby.ca',
  },
  aiostreams: {
    id: 'aiostreams',
    name: 'AIOStreams',
    unit: 'aiostreams.service',
    category: 'streaming',
    web_url: 'https://aiostreams.obby.ca',
  },
  jellyfin: {
    id: 'jellyfin',
    name: 'Jellyfin',
    unit: 'jellyfin.service',
    category: 'media',
    web_url: 'https://jellyfin.obby.ca',
  },
  prowlarr: {
    id: 'prowlarr',
    name: 'Prowlarr',
    unit: 'prowlarr.service',
    category: 'automation',
    web_url: 'https://prowlarr.obby.ca',
  },
}

const logUnits = Object.values(services).map((service) => ({
  id: service.id,
  name: service.name,
  unit: service.unit,
}))

const status = Object.fromEntries(
  Object.entries(services).map(([id, service], index) => [
    id,
    {
      current: {
        id,
        name: service.name,
        ok: index !== 2,
        systemd: index === 2 ? 'failed' : 'active',
        message: index === 2 ? 'Recent scraper timeout with a long diagnostic message' : 'Healthy',
        latency_ms: 30 + index * 11,
        category: service.category,
        unit: service.unit,
      },
      history: Array.from({ length: 60 }, (_, point) => (index === 2 && point % 9 === 0 ? false : true)),
    },
  ]),
)

const systemStats = {
  cpu: {
    model: 'AMD Ryzen Threadripper PRO 7975WX 32-Cores',
    physical_cores: 32,
    logical_cores: 64,
    usage_pct: 37.8,
    load_1m: 4.2,
    load_5m: 5.1,
    load_15m: 4.8,
  },
  ram: { used_gb: 52.4, total_gb: 128, available_gb: 75.6, percent: 41 },
  swap: { active_gb: 12.1, total_gb: 16, cached_gb: 1.8 },
  gpu: {
    name: 'NVIDIA GeForce RTX 4090',
    usage_pct: 62,
    engines: { enc: 18, dec: 44 },
    mem_busy_pct: 27,
    vram_used_mb: 12345,
    vram_total_mb: 24564,
    temp_c: 61,
    power_w: 233,
    process_count: 3,
    process_memory_mb: 8192,
    driver_version: '575.64',
    processes: [
      {
        pid: 1234,
        name: 'ffmpeg',
        type: 'C+G',
        used_memory_mb: 4096,
        gpu_memory_pct: 18.2,
        sm_pct: 11,
        mem_pct: 5,
        enc_pct: 42,
        dec_pct: 0,
        jpg_pct: 0,
        ofa_pct: 0,
        cpu_pct: 91,
        ram_mb: 512,
        user: 'http',
        cmd: 'ffmpeg -hide_banner -i very-long-input-url-that-should-not-break-mobile-layout',
      },
    ],
  },
  net_io: { recv_rate: '82 MB/s', sent_rate: '12 MB/s', recv_total_gb: 9821, sent_total_gb: 4321 },
  disks: [
    { mount: '/', free: '318', total: '930', unit: 'GB', percent: 65.8 },
    { mount: '/mnt/media/really-long-storage-label', free: '28', total: '72', unit: 'TB', percent: 61.1 },
  ],
  top_processes: Array.from({ length: 10 }, (_, index) => ({
    pid: 2000 + index,
    name: `worker-process-${index}-with-long-name`,
    cpu_pct: 130 - index * 7,
    mem_mb: 700 + index * 50,
    mem_pct: 3.5 + index,
  })),
  top_memory_processes: Array.from({ length: 10 }, (_, index) => ({
    pid: 3000 + index,
    name: `memory-hungry-service-${index}`,
    cpu_pct: 20 + index,
    mem_mb: 4096 - index * 180,
    mem_pct: 8 - index * 0.3,
  })),
}

const serviceStats = Object.fromEntries(
  Object.keys(services).map((id, index) => [
    id,
    {
      version: `1.${index}.0`,
      requests_total: 1200 + index * 50,
      cache_hit_rate: `${88 - index}%`,
      long_metric_name_that_wraps: 'value-with-enough-content-to-test-mobile-cards',
    },
  ]),
)

const versions = Object.fromEntries(
  Object.keys(services).map((id, index) => [id, { installed: `1.${index}.0`, latest: `1.${index}.1` }]),
)

const processRows = Array.from({ length: 12 }, (_, index) => ({
  name: `process-with-long-command-name-${index}`,
  pid: 4000 + index,
  cpu_pct: 80 - index * 3,
  cpu_total_pct: 180 - index * 4,
  mem_mb: 2048 - index * 60,
  mem_pct: 11 - index * 0.4,
  threads: 8 + index,
  user: index % 2 ? 'media' : 'http',
  status: 'running',
  cmd: `/usr/bin/process-${index} --with --many --long --arguments --that --must --wrap`,
}))

const jellyfinData = {
  ok: true,
  configured: true,
  updated_at: '2026-04-18T18:50:00Z',
  url: 'https://jellyfin.obby.ca',
  sessions: [
    {
      Id: 'session-1',
      UserName: 'joey',
      Client: 'LibreWolf',
      DeviceName: 'desktop-with-a-long-name',
      RemoteEndPoint: '10.0.0.42',
      NowPlayingItem: {
        Name: 'A Very Long Movie Title That Must Stay Inside Its Session Card',
        SeriesName: 'A Long Series Name',
        MediaType: 'Video',
        RunTimeTicks: 7_200_000_000,
      },
      PlayState: { PositionTicks: 2_400_000_000, IsPaused: false, PlayMethod: 'DirectPlay' },
    },
    {
      Id: 'session-2',
      UserName: 'media',
      Client: 'Android TV',
      DeviceName: 'Living Room',
      NowPlayingItem: { Name: 'Transcoded Episode', MediaType: 'Episode', RunTimeTicks: 3_600_000_000 },
      PlayState: { PositionTicks: 1_200_000_000, IsPaused: true },
      TranscodingInfo: { VideoCodec: 'h264' },
    },
  ],
  activity: [
    {
      Id: 'activity-1',
      Date: '2026-04-18T18:40:00Z',
      Severity: 'Information',
      Name: 'Playback started',
      ShortOverview: 'joey started watching a title with enough text to validate wrapping.',
    },
    {
      Id: 'activity-2',
      Date: '2026-04-18T18:35:00Z',
      Severity: 'Warning',
      Name: 'Transcode warning',
      ShortOverview: 'The transcode session switched bitrate.',
    },
  ],
  errors: {},
}

const aioAnalysis = {
  log_lines: 5000,
  time_range: { start: '2026-04-18T18:00:00Z', end: '2026-04-18T18:50:00Z' },
  summary: {
    total_requests: 42,
    avg_response_time_s: 1.24,
    avg_streams: 18.4,
    fastest_s: 0.31,
    slowest_s: 6.8,
    total_addon_errors: 3,
  },
  addons: {
    Torrentio: {
      calls: 42,
      successes: 41,
      failures: 1,
      success_rate: 0.976,
      avg_time_s: 0.42,
      min_time_s: 0.1,
      max_time_s: 2.1,
      avg_streams: 12.2,
      total_streams: 512,
    },
    MediaFusion: {
      calls: 38,
      successes: 30,
      failures: 8,
      success_rate: 0.789,
      avg_time_s: 2.8,
      min_time_s: 0.7,
      max_time_s: 6.9,
      avg_streams: 8.6,
      total_streams: 327,
    },
  },
  errors: { 'Upstream timeout while fetching stream resource': 3 },
  recent_requests: [
    {
      timestamp: '2026-04-18T18:48:00Z',
      type: 'movie',
      content_id: 'tt0468569',
      total_streams: 32,
      total_errors: 1,
      duration_s: 1.8,
      addons: [
        { name: 'Torrentio', status: 'success', streams: 18, time_s: 0.4 },
        { name: 'MediaFusion', status: 'failed', streams: 0, time_s: 2.4, error: 'timeout' },
      ],
    },
  ],
  http_requests: [
    { method: 'GET', path: '/stream/movie/tt0468569.json', status_code: 200, latency_ms: 1800 },
    { method: 'GET', path: '/stream/series/tt0903747:3:7.json', status_code: 504, latency_ms: 6200 },
  ],
  pipeline: [
    { stage: 'FILTERER', count: 80, time_s: 0.012 },
    { stage: 'SORTER', count: 32, time_s: 0.004 },
  ],
}

const aioTestResponse = {
  ok: true,
  imdb: 'tt0468569',
  type: 'movie',
  stream_count: 2,
  latency_ms: 1234,
  streams: [
    {
      name: 'Torrentio\n1080p WEB-DL x265',
      title: 'The.Dark.Knight.2008.1080p.WEB-DL.x265.mkv\n2.4 GB',
    },
    {
      name: 'MediaFusion\n4K BluRay HEVC',
      title: 'The.Dark.Knight.2008.2160p.BluRay.HEVC.mkv\n18.5 GB',
    },
  ],
}

const mediaFusionMetrics = {
  ok: true,
  overview: {
    streams: { total: 125000, by_type: { cached: 90000, uncached: 35000 } },
    content: { total: 54210, movies: 39200, series: 14800, tv_channels: 210 },
    moderation: { pending_contributions: 4 },
  },
  users: {
    total_users: 1200,
    active_users: { daily: 210, weekly: 630, monthly: 900 },
    new_users_this_week: 44,
    total_profiles: 1500,
    users_by_role: { user: 1180, admin: 4 },
  },
  activity: {
    watch_history: { total: 80200, recent: 820, unique_users: 311 },
    downloads: { total: 4000 },
    library: { total_items: 54210 },
    playback: { total_plays: 123000 },
  },
  contributions: {
    total_contributions: 500,
    pending_review: 4,
    recent_contributions_week: 30,
    unique_contributors: 80,
    total_stream_votes: 1000,
    total_metadata_votes: 220,
    contributions_by_status: { approved: 450, pending: 4, rejected: 46 },
  },
  torrent_sources: [
    { name: 'TorrentGalaxy', count: 20000 },
    { name: '1337x', count: 15000 },
  ],
  debrid_cache: { services: { realdebrid: { cached_torrents: 82000 }, alldebrid: { cached_torrents: 24000 } } },
  scheduler_stats: {
    total_jobs: 22,
    active_jobs: 18,
    disabled_jobs: 4,
    running_jobs: 1,
    global_scheduler_disabled: false,
    jobs_by_category: { scraper: { active: 10, total: 12 }, maintenance: { active: 8, total: 10 } },
  },
  scheduler_jobs: [
    {
      name: 'scrape-popular',
      status: 'running',
      crontab: '*/15 * * * *',
      last_run: '2026-04-18T18:30:00Z',
      next_run: '2026-04-18T18:45:00Z',
    },
  ],
  source_health: [
    {
      source_name: 'TorrentGalaxy',
      supports_movie: true,
      supports_series: true,
      supports_anime: false,
      success_rate: 0.94,
      gate_status: 'allowed',
    },
  ],
  redis: {
    memory: { used_memory_human: '128 MB', peak_memory_human: '256 MB' },
    performance: { ops_per_sec: 1200 },
    cache: { hit_rate: 0.96, hits: 42000 },
    connections: { connected_clients: 12 },
  },
  request_metrics: { total_requests: 700000, total_endpoints: 44, unique_visitors: 2100, enabled: true },
  request_endpoints: [{ route: '/stream/{type}/{id}.json', total_requests: 20000, avg_time: 120, error_count: 4 }],
  workers: { summary: { total_events: 120, peak_rss: 536870912, status_counts: { success: 110, error: 10 } } },
  scrapers: [
    {
      name: 'TorrentGalaxy',
      aggregated: { total_runs: 42, items_found: 1000, items_processed: 980, success_rate: 0.93, avg_duration: 24.2 },
    },
  ],
}

const mediaFusionAnalysis = {
  log_lines: 10000,
  lines_parsed: 8123,
  log_duration_hours: 6.5,
  dmm_auth: 'authenticated',
  summary: {
    streams_added: 320,
    streams_1h: 55,
    streams_6h: 320,
    streams_24h: 900,
    streams_per_hour: 49.2,
    errors: 3,
    store_operations: 42,
    total_valid: 480,
    total_existing: 160,
    imdb_resolved: 290,
    synthetic_resolved: 30,
    tasks_executed: 22,
  },
  log_levels: { INFO: 9000, WARNING: 20, ERROR: 3 },
  resolutions: { '2160p': 40, '1080p': 210, '720p': 70 },
  qualities: { 'WEB-DL': 160, BluRay: 120 },
  codecs: { HEVC: 100, H264: 180 },
  streams_by_hour: { '2026-04-18T17': 120, '2026-04-18T18': 200 },
  sources_added: { TorrentGalaxy: 200, '1337x': 120 },
  media_types_added: { movie: 240, series: 80 },
  years_added: { '2024': 88, '2025': 120, '2026': 40 },
  top_titles: [['The Dark Knight', 12]],
  crawl_snapshots: [
    { timestamp: '2026-04-18T17:00:00Z', pages: 100, pages_per_min: 20, items: 800, items_per_min: 160 },
    { timestamp: '2026-04-18T18:00:00Z', pages: 140, pages_per_min: 23, items: 1200, items_per_min: 200 },
  ],
  latest_crawl: { pages: 140, pages_per_min: 23, items: 1200, items_per_min: 200 },
  crawled_domains: { 'torrentgalaxy.to': 120, '1337x.to': 80 },
  crawled_statuses: { '200': 180, '404': 3 },
  error_categories: { tmdb: 2, dmm: 1 },
  dmm_no_match_types: { movie: 2 },
  dmm_no_match_samples: [{ title: 'Unknown Title', year: '2026', type: 'movie', candidates: 0 }],
  tmdb_errors: { 'TMDB ID not found': 2 },
  synthetic_titles: ['Unknown Title'],
  tasks: [{ task: 'scrape', id: 'task-1', timestamp: '2026-04-18T18:40:00Z' }],
  recent_streams: [
    {
      timestamp: '2026-04-18T18:40:00Z',
      type: 'movie',
      title: 'The Dark Knight',
      resolution: '1080p',
      source: 'TorrentGalaxy',
      stream: 'The.Dark.Knight.1080p.mkv',
    },
  ],
  recent_errors: [
    { timestamp: '2026-04-18T18:39:00Z', message: 'TMDB lookup failed with a long message that wraps safely' },
  ],
  time_range: { start: '2026-04-18T12:00:00Z', end: '2026-04-18T18:50:00Z' },
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('dashboard fits every responsive viewport across tabs', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByText('StreamMonitor').first()).toBeVisible()
  await assertResponsive(page, `initial:${testInfo.project.name}`)

  await page.getByRole('combobox', { name: 'Theme' }).click()
  await expect(page.getByRole('option', { name: 'Pastel Purple' })).toBeVisible()
  await assertResponsive(page, `theme-dropdown:${testInfo.project.name}`)
  await page.keyboard.press('Escape')

  for (const tab of [
    'Services',
    'Logs',
    'Perms',
    'Errors',
    'Settings',
    'Jellyfin',
    'Speed',
    'Benchmark',
    'API',
    'Packages',
  ]) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible()
    await assertResponsive(page, `${tab}:${testInfo.project.name}`)
  }
})

test('service diagnostic panels render structured views responsively', async ({ page }, testInfo) => {
  await page.goto('/')

  await page
    .getByRole('button', { name: /AIOStreams/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Analyzer', exact: true }).click()
  await expect(page.getByText('Addon performance')).toBeVisible()
  await expect(page.getByText('Recent stream requests')).toBeVisible()
  await assertResponsive(page, `aiostreams-analyzer:${testInfo.project.name}`)

  await page.getByRole('button', { name: 'Test Suite', exact: true }).click()
  await page.getByRole('button', { name: 'Run test', exact: true }).click()
  await expect(page.getByText('The Dark Knight').first()).toBeVisible()
  await expect(page.getByText('Raw test payload')).toBeVisible()
  await assertResponsive(page, `aiostreams-tests:${testInfo.project.name}`)
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page
    .getByRole('button', { name: /MediaFusion/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Metrics', exact: true }).click()
  await expect(page.getByText('System overview')).toBeVisible()
  await expect(page.getByText('Request metrics')).toBeVisible()
  await assertResponsive(page, `mediafusion-metrics:${testInfo.project.name}`)

  await page.getByRole('button', { name: 'Scraper Analyzer', exact: true }).click()
  await expect(page.getByText('Quality analysis')).toBeVisible()
  await expect(page.getByText('Recent streams added')).toBeVisible()
  await assertResponsive(page, `mediafusion-scraper:${testInfo.project.name}`)
})

async function mockApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path === '/api/auth/session') return json(route, { authenticated: true, user: 'admin' })
    if (path === '/api/bootstrap') {
      return json(route, {
        categories: {
          system: 'System',
          streaming: 'Streaming',
          media: 'Media',
          automation: 'Automation',
        },
        web_urls: Object.fromEntries(Object.entries(services).map(([id, service]) => [id, service.web_url])),
        bench_titles: {
          tt0468569: 'The Dark Knight',
          'tt0903747:3:7': 'Breaking Bad S03E07',
          tt1375666: 'Inception',
        },
        services,
        log_units: logUnits,
        speedtest: {
          direct_url: 'https://speedtest.obby.ca/speedtest/download',
          direct_name: 'Direct',
          cf_url: 'https://speedtest.obnoxious.lol/speedtest/download',
          cf_name: 'Cloudflare',
        },
      })
    }
    if (path === '/api/status') return json(route, status)
    if (path === '/api/stats/system') return json(route, { stats: systemStats, meta: { stale: false } })
    if (path === '/api/stats/meta')
      return json(route, Object.fromEntries(Object.keys(services).map((id) => [id, { stale: false }])))
    if (path === '/api/stats') return json(route, serviceStats)
    if (path === '/api/versions') return json(route, versions)
    if (path.startsWith('/api/logs/')) {
      return json(route, {
        lines: Array.from(
          { length: 12 },
          (_, index) =>
            `2026-04-18T16:${String(index).padStart(2, '0')}:00Z log line ${index} with long content that should scroll inside the log pane only`,
        ),
      })
    }
    if (path === '/api/errors') {
      return json(route, {
        errors: [
          {
            sid: 'aiostreams',
            severity: 'error',
            timestamp: '2026-04-18T16:40:00Z',
            count: 7,
            line: 'Long recurring scraper timeout message with enough words to validate wrapping on narrow phone layouts without forcing horizontal scroll',
          },
        ],
      })
    }
    if (path === '/api/settings/keys') {
      return json(route, {
        JELLYFIN_API_KEY: { label: 'Jellyfin API key', group: 'Media', value: 'configured' },
        MEDIAFUSION_PASS: { label: 'MediaFusion password', group: 'Streaming', value: '' },
      })
    }
    if (path === '/api/settings/urls') {
      return json(route, {
        COMET_URL: { label: 'Comet URL', group: 'Streaming', value: 'http://127.0.0.1:8070' },
        JELLYFIN_URL: { label: 'Jellyfin URL', group: 'Media', value: 'http://127.0.0.1:8096' },
      })
    }
    if (path === '/api/jellyfin') return json(route, jellyfinData)
    if (path === '/api/aiostreams/analyze') return json(route, aioAnalysis)
    if (path === '/api/aiostreams/test') return json(route, aioTestResponse)
    if (path === '/api/mediafusion/metrics') return json(route, mediaFusionMetrics)
    if (path === '/api/mediafusion/analyze') return json(route, mediaFusionAnalysis)
    if (path === '/api/packages') {
      return json(route, {
        native: { total: 1521, outdated: 3, updates: processRows.slice(0, 3) },
        aur: { total: 41, outdated: 1, updates: processRows.slice(3, 4) },
      })
    }
    if (path === '/api/processes')
      return json(route, { processes: processRows, top_memory: [...processRows].reverse() })
    if (path === '/api/dmesg') return json(route, { lines: [] })
    if (path === '/api/auth/logout') return json(route, { ok: true })

    return json(route, { ok: true })
  })
}

async function assertResponsive(page: Page, label: string) {
  await page.waitForLoadState('networkidle')
  const metrics = await page.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    const controls = Array.from(document.querySelectorAll('button, input:not([type="checkbox"]), [role="combobox"]'))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      })
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          width: rect.width,
          height: rect.height,
          label: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
        }
      })

    return {
      viewportWidth: window.innerWidth,
      rootScrollWidth: root.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      minControlHeight: Math.min(...controls.map((control) => control.height)),
    }
  })

  expect(metrics.rootScrollWidth, `${label} root overflow`).toBeLessThanOrEqual(metrics.viewportWidth + 2)
  expect(metrics.bodyScrollWidth, `${label} body overflow`).toBeLessThanOrEqual(metrics.viewportWidth + 2)
  if (metrics.viewportWidth < 640) {
    expect(metrics.minControlHeight, `${label} mobile tap target`).toBeGreaterThanOrEqual(32)
  }
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
