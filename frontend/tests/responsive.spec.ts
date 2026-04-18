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
    if (path === '/api/jellyfin')
      return json(route, { sessions: [{ user: 'demo', item: 'Long movie title' }], activity: [] })
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
