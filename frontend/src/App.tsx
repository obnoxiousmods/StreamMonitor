import {
  Activity,
  AlertTriangle,
  Boxes,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  KeyRound,
  LogOut,
  Network,
  Play,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Terminal,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

type AnyRecord = Record<string, unknown>

type ServiceCurrent = {
  id?: string
  name: string
  ok: boolean | null
  systemd?: string
  http_ok?: boolean | null
  message?: string
  latency_ms?: number | null
  timestamp?: string | null
  category?: string
  unit?: string | null
}

type ServiceStatus = {
  current: ServiceCurrent
  history: Array<boolean | number | null>
}

type Bootstrap = {
  categories: Record<string, string>
  web_urls: Record<string, string>
  bench_titles: Record<string, string>
  services: Record<string, { id: string; name: string; unit?: string | null; category: string; web_url?: string }>
  log_units: Array<{ id: string; name: string; unit: string }>
  speedtest: SpeedConfig
}

type SpeedConfig = {
  direct_url: string
  direct_name: string
  cf_url: string
  cf_name: string
}

type ToastState = { message: string; kind: 'ok' | 'warn' | 'err' } | null

const STATUS_REFRESH_MS = 5000
const STATS_REFRESH_MS = 15000
const VERSION_REFRESH_MS = 300000

const TAB_ITEMS = [
  ['services', 'Services', Server],
  ['logs', 'Logs', Terminal],
  ['perms', 'Perms', Shield],
  ['errors', 'Errors', AlertTriangle],
  ['settings', 'Settings', Settings],
  ['jellyfin', 'Jellyfin', Play],
  ['speed', 'Speed', Zap],
  ['benchmark', 'Benchmark', Gauge],
  ['api', 'API', Boxes],
  ['packages', 'Packages', Database],
] as const

const ACCENT_THEME_STORAGE_KEY = 'streammonitor.accentTheme'

const ACCENT_THEMES = [
  { id: 'purple', label: 'Pastel Purple' },
  { id: 'lilac', label: 'Lilac' },
  { id: 'rose', label: 'Rose' },
  { id: 'peach', label: 'Peach' },
  { id: 'mint', label: 'Mint' },
  { id: 'aqua', label: 'Aqua' },
  { id: 'sky', label: 'Sky' },
  { id: 'lemon', label: 'Lemon' },
  { id: 'coral', label: 'Coral' },
  { id: 'periwinkle', label: 'Periwinkle' },
] as const

type AccentThemeId = (typeof ACCENT_THEMES)[number]['id']

function isAccentThemeId(value: string | null): value is AccentThemeId {
  return ACCENT_THEMES.some((theme) => theme.id === value)
}

function readAccentTheme(): AccentThemeId {
  if (typeof window === 'undefined') return 'purple'
  try {
    const stored = window.localStorage.getItem(ACCENT_THEME_STORAGE_KEY)
    return isAccentThemeId(stored) ? stored : 'purple'
  } catch {
    return 'purple'
  }
}

function applyAccentTheme(theme: AccentThemeId) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.accentTheme = theme
}

function saveAccentTheme(theme: AccentThemeId) {
  try {
    window.localStorage.setItem(ACCENT_THEME_STORAGE_KEY, theme)
  } catch {
    // localStorage can be disabled in hardened browser profiles; theme still applies for this session.
  }
}

applyAccentTheme(readAccentTheme())

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, fallback: unknown = ''): string {
  return value == null ? String(fallback) : String(value)
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function pct(value: unknown): string {
  return `${num(value).toFixed(num(value) % 1 ? 1 : 0)}%`
}

function gb(value: unknown): string {
  return `${num(value).toFixed(1)} GB`
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers || {}) } : init?.headers,
    ...init,
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('json') ? await response.json() : await response.text()
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body ? String((body as AnyRecord).error) : response.statusText
    throw new Error(message)
  }
  return body as T
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-lg border border-line bg-panel shadow-glow', className)}>{children}</section>
}

function Button({
  children,
  variant = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'danger' }) {
  return (
    <button
      className={cx(
        'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'default' && 'border-accent/45 bg-accent/15 text-text hover:bg-accent/25',
        variant === 'ghost' && 'border-line bg-panel2 text-muted hover:border-accent/35 hover:text-text',
        variant === 'danger' && 'border-rose/40 bg-rose/15 text-rose hover:bg-rose/25',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'err' | 'muted' | 'cyan' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-bold',
        tone === 'ok' && 'bg-mint/15 text-mint',
        tone === 'warn' && 'bg-amber/15 text-amber',
        tone === 'err' && 'bg-rose/15 text-rose',
        tone === 'cyan' && 'bg-cyan/15 text-cyan',
        tone === 'muted' && 'bg-panel3 text-muted',
      )}
    >
      {children}
    </span>
  )
}

function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'min-h-8 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs text-text outline-none transition placeholder:text-dim focus:border-accent/60',
        className,
      )}
      {...props}
    />
  )
}

function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'min-h-8 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs text-text outline-none transition focus:border-accent/60',
        className,
      )}
      {...props}
    />
  )
}

function Progress({ value, tone = 'ok' }: { value: number; tone?: 'ok' | 'warn' | 'err' | 'cyan' }) {
  return (
    <div className="h-1 overflow-hidden rounded bg-panel3">
      <div
        className={cx(
          'h-full rounded',
          tone === 'ok' && 'bg-mint',
          tone === 'warn' && 'bg-amber',
          tone === 'err' && 'bg-rose',
          tone === 'cyan' && 'bg-cyan',
        )}
        style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
      />
    </div>
  )
}

function Field({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'err' | 'muted' | 'cyan' }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line/60 py-1 text-xs last:border-b-0">
      <span className="text-muted">{label}</span>
      <span
        className={cx(
          'min-w-0 truncate text-right font-semibold text-text',
          tone === 'ok' && 'text-mint',
          tone === 'warn' && 'text-amber',
          tone === 'err' && 'text-rose',
          tone === 'muted' && 'text-muted',
          tone === 'cyan' && 'text-cyan',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onMouseDown={onClose}>
      <div
        className={cx('flex max-h-[94vh] w-full flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-glow', wide ? 'max-w-6xl' : 'max-w-3xl')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line bg-panel2 px-3 py-2">
          <h2 className="text-sm font-bold text-text">{title}</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      </div>
    </div>
  )
}

function App() {
  const queryClient = useQueryClient()
  const [toast, setToast] = useState<ToastState>(null)
  const [accentTheme, setAccentTheme] = useState<AccentThemeId>(() => readAccentTheme())
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<{ authenticated: boolean }>('/api/auth/session'),
    retry: false,
  })

  function notify(message: string, kind: 'ok' | 'warn' | 'err' = 'ok') {
    setToast({ message, kind })
    window.setTimeout(() => setToast(null), 4200)
  }

  function changeAccentTheme(theme: AccentThemeId) {
    applyAccentTheme(theme)
    saveAccentTheme(theme)
    setAccentTheme(theme)
  }

  if (session.isLoading) {
    return <ShellLoader />
  }

  const authenticated = Boolean(session.data?.authenticated)
  const path = window.location.pathname
  if (!authenticated || path === '/login') {
    return (
      <>
        <LoginPage
          onLogin={() => {
            void queryClient.invalidateQueries({ queryKey: ['session'] })
            window.history.replaceState(null, '', '/')
          }}
        />
        {toast && <Toast toast={toast} />}
      </>
    )
  }

  return (
    <>
      <DashboardApp accentTheme={accentTheme} onAccentThemeChange={changeAccentTheme} notify={notify} />
      {toast && <Toast toast={toast} />}
    </>
  )
}

function ShellLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas text-text">
      <div className="rounded-lg border border-line bg-panel p-4 text-xs text-muted">Loading StreamMonitor...</div>
    </div>
  )
}

function Toast({ toast }: { toast: NonNullable<ToastState> }) {
  return (
    <div
      className={cx(
        'fixed bottom-4 right-4 z-[60] max-w-md rounded-lg border px-3 py-2 text-xs shadow-glow',
        toast.kind === 'ok' && 'border-accent/40 bg-accent/15 text-text',
        toast.kind === 'warn' && 'border-amber/40 bg-amber/15 text-text',
        toast.kind === 'err' && 'border-rose/40 bg-rose/15 text-text',
      )}
    >
      {toast.message}
    </div>
  )
}

function ThemePicker({
  value,
  onChange,
}: {
  value: AccentThemeId
  onChange: (theme: AccentThemeId) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold uppercase text-dim">
      Theme
      <Select
        className="min-h-8 w-36 px-2 py-1 text-xs"
        value={value}
        onChange={(event) => {
          const next = event.target.value
          if (isAccentThemeId(next)) onChange(next)
        }}
      >
        {ACCENT_THEMES.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.label}
          </option>
        ))}
      </Select>
    </label>
  )
}

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const publicConfig = useQuery({
    queryKey: ['public-config'],
    queryFn: () => api<{ speedtest: SpeedConfig }>('/api/public-config'),
  })
  const publicStatus = useQuery({
    queryKey: ['public-status'],
    queryFn: () => api<AnyRecord>('/api/public'),
    refetchInterval: 15000,
  })
  const login = useMutation({
    mutationFn: () =>
      api<{ ok: boolean }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    onSuccess: onLogin,
    onError: (err) => setError(err instanceof Error ? err.message : 'Login failed'),
  })

  return (
    <main className="min-h-screen bg-canvas text-text">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-3 px-3 py-4 lg:grid-cols-[390px_1fr] lg:px-6">
        <Card className="self-center p-5">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Activity />
            </div>
            <div>
              <h1 className="text-xl font-black">StreamMonitor</h1>
              <p className="text-xs text-muted">Infrastructure and streaming stack</p>
            </div>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setError('')
              login.mutate()
            }}
          >
            <label className="block text-xs font-semibold text-muted">
              Username
              <Input className="mt-2 w-full" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Password
              <Input
                className="mt-2 w-full"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </label>
            {error && <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 text-xs text-rose">{error}</div>}
            <Button className="w-full" disabled={login.isPending}>
              <KeyRound size={16} />
              {login.isPending ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </Card>
        <div className="grid content-center gap-3">
          <Card className="p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">Public health</h2>
                <p className="text-xs text-muted">Unauthenticated service summary</p>
              </div>
              <Badge tone={num(publicStatus.data?.down) > 0 ? 'warn' : 'ok'}>
                {num(publicStatus.data?.up)}/{num(publicStatus.data?.total)} up
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric label="Services" value={num(publicStatus.data?.total)} />
              <Metric label="Online" value={num(publicStatus.data?.up)} tone="ok" />
              <Metric label="Issues" value={num(publicStatus.data?.down)} tone={num(publicStatus.data?.down) ? 'warn' : 'ok'} />
              <Metric label="Uptime" value={pct(publicStatus.data?.uptime_pct)} tone="cyan" />
            </div>
          </Card>
          {publicConfig.data?.speedtest && <SpeedTestCard config={publicConfig.data.speedtest} compact />}
        </div>
      </div>
    </main>
  )
}

function DashboardApp({
  accentTheme,
  onAccentThemeChange,
  notify,
}: {
  accentTheme: AccentThemeId
  onAccentThemeChange: (theme: AccentThemeId) => void
  notify: (message: string, kind?: 'ok' | 'warn' | 'err') => void
}) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState(window.location.pathname === '/speedtest' ? 'speed' : 'services')
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [processModal, setProcessModal] = useState(false)
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: () => api<Bootstrap>('/api/bootstrap') })
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api<Record<string, ServiceStatus>>('/api/status'),
    refetchInterval: STATUS_REFRESH_MS,
  })
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Record<string, AnyRecord>>('/api/stats'),
    refetchInterval: STATS_REFRESH_MS,
  })
  const systemStats = useQuery({
    queryKey: ['stats', 'system'],
    queryFn: () => api<{ stats: AnyRecord; meta: AnyRecord }>('/api/stats/system'),
    refetchInterval: STATUS_REFRESH_MS,
  })
  const meta = useQuery({
    queryKey: ['stats-meta'],
    queryFn: () => api<Record<string, AnyRecord>>('/api/stats/meta'),
    refetchInterval: STATS_REFRESH_MS,
  })
  const versions = useQuery({
    queryKey: ['versions'],
    queryFn: () => api<Record<string, AnyRecord>>('/api/versions'),
    refetchInterval: VERSION_REFRESH_MS,
  })

  const allStats = useMemo(() => {
    const merged = { ...(stats.data || {}) }
    if (systemStats.data?.stats) merged.system = systemStats.data.stats
    return merged
  }, [stats.data, systemStats.data])

  const selected = selectedService && status.data ? status.data[selectedService] : null

  function switchTab(tab: string) {
    setActiveTab(tab)
    if (tab === 'speed') window.history.replaceState(null, '', '/speedtest')
    else if (window.location.pathname !== '/') window.history.replaceState(null, '', '/')
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    await queryClient.invalidateQueries({ queryKey: ['session'] })
    window.history.replaceState(null, '', '/login')
  }

  if (!bootstrap.data || !status.data) {
    return <ShellLoader />
  }

  const total = Object.keys(status.data).length
  const up = Object.values(status.data).filter((item) => item.current.ok === true).length
  const down = Object.values(status.data).filter((item) => item.current.ok === false).length

  return (
    <main className="min-h-screen bg-canvas text-text">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1840px] items-center gap-3 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Activity size={17} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black">StreamMonitor</div>
              <div className="text-xs text-muted">Infrastructure dashboard</div>
            </div>
          </div>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Metric label="Services" value={`${up}/${total}`} tone={down ? 'warn' : 'ok'} compact />
            <Metric label="Issues" value={down} tone={down ? 'err' : 'ok'} compact />
            <Metric label="Updated" value={new Date().toLocaleTimeString()} compact />
          </div>
          <ThemePicker value={accentTheme} onChange={onAccentThemeChange} />
          <Button variant="ghost" onClick={() => void logout()}>
            <LogOut size={16} />
            Sign out
          </Button>
        </div>
        <nav className="mx-auto flex max-w-[1840px] gap-1.5 overflow-x-auto px-3 pb-2">
          {TAB_ITEMS.map(([id, label, Icon]) => (
            <button
              key={id}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition',
                activeTab === id ? 'border-accent/50 bg-accent/15 text-text' : 'border-line bg-panel text-muted hover:border-accent/35 hover:text-text',
              )}
              onClick={() => switchTab(id)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-[1840px] px-3 py-3">
        {activeTab === 'services' && (
          <ServicesPage
            bootstrap={bootstrap.data}
            status={status.data}
            stats={allStats}
            meta={meta.data || {}}
            versions={versions.data || {}}
            onOpenService={setSelectedService}
            onOpenProcesses={() => setProcessModal(true)}
          />
        )}
        {activeTab === 'logs' && <LogsPage units={bootstrap.data.log_units} />}
        {activeTab === 'perms' && <PermissionsPage notify={notify} />}
        {activeTab === 'errors' && <ErrorsPage notify={notify} />}
        {activeTab === 'settings' && <SettingsPage notify={notify} />}
        {activeTab === 'jellyfin' && <JellyfinPage />}
        {activeTab === 'speed' && <SpeedTestCard config={bootstrap.data.speedtest} />}
        {activeTab === 'benchmark' && <BenchmarkPage titles={bootstrap.data.bench_titles} />}
        {activeTab === 'api' && <ApiExplorer />}
        {activeTab === 'packages' && <PackagesPage />}
      </div>
      {selected && selectedService && (
        <ServiceModal
          serviceId={selectedService}
          status={selected}
          stats={allStats[selectedService] || {}}
          version={versions.data?.[selectedService] || {}}
          webUrl={bootstrap.data.web_urls[selectedService] || ''}
          onClose={() => setSelectedService(null)}
          notify={notify}
        />
      )}
      {processModal && <ProcessModal onClose={() => setProcessModal(false)} />}
    </main>
  )
}

function Metric({
  label,
  value,
  tone,
  compact,
}: {
  label: string
  value: ReactNode
  tone?: 'ok' | 'warn' | 'err' | 'cyan'
  compact?: boolean
}) {
  return (
    <div className={cx('rounded-md border border-line bg-panel2 px-2.5 py-1.5', compact ? 'min-w-20' : '')}>
      <div className={cx('text-sm font-black', tone === 'ok' && 'text-mint', tone === 'warn' && 'text-amber', tone === 'err' && 'text-rose', tone === 'cyan' && 'text-cyan')}>
        {value}
      </div>
      <div className="text-[11px] font-semibold uppercase text-dim">{label}</div>
    </div>
  )
}

function ServicesPage({
  bootstrap,
  status,
  stats,
  meta,
  versions,
  onOpenService,
  onOpenProcesses,
}: {
  bootstrap: Bootstrap
  status: Record<string, ServiceStatus>
  stats: Record<string, AnyRecord>
  meta: Record<string, AnyRecord>
  versions: Record<string, AnyRecord>
  onOpenService: (id: string) => void
  onOpenProcesses: () => void
}) {
  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const id of Object.keys(status)) {
      const category = status[id]?.current.category || bootstrap.services[id]?.category || 'other'
      groups[category] = [...(groups[category] || []), id]
    }
    return groups
  }, [bootstrap.services, status])

  return (
    <div className="space-y-4">
      <SystemPanel stats={stats.system || {}} onOpenProcesses={onOpenProcesses} />
      {Object.entries(bootstrap.categories).map(([categoryId, label]) => {
        const ids = grouped[categoryId] || []
        if (!ids.length || categoryId === 'system') return null
        return (
          <section key={categoryId}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-xs font-black uppercase text-muted">{label}</h2>
              <div className="h-px flex-1 bg-line" />
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {ids.map((id) => (
                <ServiceCard
                  key={id}
                  id={id}
                  status={status[id]}
                  stats={stats[id] || {}}
                  meta={meta[id] || {}}
                  version={versions[id] || {}}
                  webUrl={bootstrap.web_urls[id] || ''}
                  onOpen={() => onOpenService(id)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function SystemPanel({ stats, onOpenProcesses }: { stats: AnyRecord; onOpenProcesses: () => void }) {
  const cpu = asRecord(stats.cpu)
  const ram = asRecord(stats.ram)
  const swap = asRecord(stats.swap)
  const gpu = asRecord(stats.gpu)
  const disks = asArray(stats.disks).map(asRecord)
  const topCpu = asArray(stats.top_processes).map(asRecord)
  const topRam = asArray(stats.top_memory_processes).map(asRecord)
  const engines = asRecord(gpu.engines)
  const gpuProcesses = asArray(gpu.processes).map(asRecord)
  const encoderPct = num(engines.enc ?? gpu.query_encoder_util_pct)
  const decoderPct = num(engines.dec ?? gpu.query_decoder_util_pct)
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-black uppercase text-muted">System</h2>
        <div className="h-px flex-1 bg-line" />
      </div>
      <div className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
        <InfoCard title="CPU" icon={<Cpu size={16} />}>
          <Field label="Model" value={text(cpu.model, 'Unknown')} />
          <Field label="Cores / Threads" value={`${text(cpu.physical_cores, '?')} / ${text(cpu.logical_cores, '?')}`} />
          <Field label="Usage" value={pct(cpu.usage_pct)} tone={num(cpu.usage_pct) > 80 ? 'err' : num(cpu.usage_pct) > 50 ? 'warn' : 'ok'} />
          <Progress value={num(cpu.usage_pct)} tone={num(cpu.usage_pct) > 80 ? 'err' : num(cpu.usage_pct) > 50 ? 'warn' : 'ok'} />
          <Field label="Load" value={`${text(cpu.load_1m, '0')} / ${text(cpu.load_5m, '0')} / ${text(cpu.load_15m, '0')}`} />
        </InfoCard>
        <InfoCard title="Memory" icon={<Database size={16} />}>
          <Field label="Used / Total" value={`${gb(ram.used_gb)} / ${gb(ram.total_gb)}`} />
          <Progress value={num(ram.percent)} tone={num(ram.percent) > 90 ? 'err' : num(ram.percent) > 70 ? 'warn' : 'ok'} />
          <Field label="Available" value={gb(ram.available_gb)} tone="ok" />
          {num(swap.total_gb) > 0 && <Field label="Swap active / total" value={`${gb(swap.active_gb)} / ${gb(swap.total_gb)}`} />}
          {num(swap.cached_gb) > 0 && <Field label="Swap cached" value={gb(swap.cached_gb)} tone="ok" />}
        </InfoCard>
        <InfoCard title="GPU" icon={<Gauge size={16} />}>
          <div className="mb-1.5 text-xs text-muted">{text(gpu.name, 'No GPU detected')}</div>
          <Field label="Usage" value={pct(gpu.usage_pct)} tone={num(gpu.usage_pct) > 80 ? 'err' : num(gpu.usage_pct) > 0 ? 'ok' : 'muted'} />
          <Progress value={num(gpu.usage_pct)} tone="ok" />
          <Field label="Encode / Decode" value={`${encoderPct}% / ${decoderPct}%`} tone={encoderPct || decoderPct ? 'cyan' : 'muted'} />
          <Field label="Memory busy" value={pct(gpu.mem_busy_pct)} />
          <Field label="VRAM" value={`${text(gpu.vram_used_mb, 0)} / ${text(gpu.vram_total_mb, 0)} MB`} />
          <Field label="Temp" value={`${text(gpu.temp_c, '?')}C`} tone={num(gpu.temp_c) > 80 ? 'warn' : 'ok'} />
          <Field label="Power" value={`${text(gpu.power_w, '?')} W`} />
          <Field label="Processes" value={`${text(gpu.process_count, 0)} - ${text(gpu.process_memory_mb, 0)} MB`} />
          <Field label="Driver" value={text(gpu.driver_version, '-')} />
        </InfoCard>
        <InfoCard title="Network" icon={<Network size={16} />}>
          <Field label="Down" value={text(asRecord(stats.net_io).recv_rate, '0 B/s')} tone="ok" />
          <Field label="Up" value={text(asRecord(stats.net_io).sent_rate, '0 B/s')} tone="cyan" />
          <Field label="Total down" value={`${text(asRecord(stats.net_io).recv_total_gb, 0)} GB`} />
          <Field label="Total up" value={`${text(asRecord(stats.net_io).sent_total_gb, 0)} GB`} />
        </InfoCard>
        <InfoCard title="Storage" icon={<HardDrive size={16} />} className="xl:col-span-2">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {disks.map((disk) => (
              <div key={text(disk.mount)} className="rounded-md border border-line bg-canvas p-1.5">
                <div className="mb-1 flex justify-between gap-2 text-xs">
                  <span className="font-semibold">{text(disk.mount)}</span>
                  <span className="text-muted">
                    {text(disk.free)} / {text(disk.total)} {text(disk.unit)}
                  </span>
                </div>
                <Progress value={num(disk.percent)} tone={num(disk.percent) > 90 ? 'err' : num(disk.percent) > 75 ? 'warn' : 'ok'} />
              </div>
            ))}
          </div>
        </InfoCard>
        <ProcessList title="Top CPU" processes={topCpu} mode="cpu" onClick={onOpenProcesses} />
        <ProcessList title="Top RAM" processes={topRam} mode="ram" onClick={onOpenProcesses} />
        {gpuProcesses.length > 0 && (
          <InfoCard title="GPU Processes" icon={<Gauge size={16} />} className="lg:col-span-2 xl:col-span-4">
            <DataTable
              rows={gpuProcesses.slice(0, 15)}
              columns={[
                'pid',
                'name',
                'type',
                'used_memory_mb',
                'gpu_memory_pct',
                'sm_pct',
                'mem_pct',
                'enc_pct',
                'dec_pct',
                'jpg_pct',
                'ofa_pct',
                'cpu_pct',
                'ram_mb',
                'user',
                'cmd',
              ]}
            />
          </InfoCard>
        )}
      </div>
    </section>
  )
}

function InfoCard({
  title,
  icon,
  children,
  className,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cx('p-3', className)}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase text-muted">
        {icon}
        {title}
      </div>
      {children}
    </Card>
  )
}

function ProcessList({ title, processes, mode, onClick }: { title: string; processes: AnyRecord[]; mode: 'cpu' | 'ram'; onClick: () => void }) {
  return (
    <InfoCard title={title} icon={<Activity size={16} />}>
      <button className="w-full text-left" onClick={onClick}>
        {processes.slice(0, 10).map((proc) => {
          const value = mode === 'cpu' ? num(proc.cpu_pct) : num(proc.mem_mb)
          const max = Math.max(...processes.slice(0, 10).map((item) => (mode === 'cpu' ? num(item.cpu_pct) : num(item.mem_mb))), 0.1)
          return (
            <div key={`${text(proc.pid)}-${text(proc.name)}`} className="mb-1.5">
              <div className="mb-1 flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-bold text-text">{text(proc.name, 'unknown')}</span>
                <span className="font-mono text-accent">{mode === 'cpu' ? `${value.toFixed(1)}%` : `${value.toFixed(1)}M`}</span>
                <span className="font-mono text-dim">{mode === 'cpu' ? `${num(proc.mem_mb).toFixed(0)}M` : `${num(proc.mem_pct).toFixed(1)}%`}</span>
              </div>
              <Progress value={(value / max) * 100} tone={mode === 'cpu' && value > 100 ? 'warn' : 'ok'} />
            </div>
          )
        })}
      </button>
    </InfoCard>
  )
}

function ServiceCard({
  id,
  status,
  stats,
  meta,
  version,
  webUrl,
  onOpen,
}: {
  id: string
  status: ServiceStatus
  stats: AnyRecord
  meta: AnyRecord
  version: AnyRecord
  webUrl: string
  onOpen: () => void
}) {
  const current = status.current
  const tone = current.ok === true ? 'ok' : current.ok === false ? 'err' : 'muted'
  const highlights = pickHighlights(stats)
  return (
    <Card className="group p-3 transition hover:border-accent/40">
      <div className="mb-2 flex items-start gap-2">
        <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-black">{current.name}</h3>
            <Badge tone={tone}>{current.ok === true ? 'UP' : current.ok === false ? 'DOWN' : 'PENDING'}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted">{current.message || 'No status message'}</p>
        </button>
        {webUrl && (
          <Button variant="ghost" className="min-h-7 px-2 py-1" onClick={() => window.open(webUrl, '_blank', 'noopener')}>
            Open
          </Button>
        )}
      </div>
      <HistoryBar history={status.history} />
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Metric label="Latency" value={current.latency_ms != null ? `${current.latency_ms}ms` : '-'} tone={tone === 'err' ? 'err' : 'cyan'} />
        <Metric label="Version" value={text(version.installed || version.latest, '-')} />
      </div>
      <div className="mt-2 grid gap-0.5">
        {highlights.map(([key, value]) => (
          <Field key={key} label={key} value={String(value)} />
        ))}
      </div>
      {meta.stale === true && <div className="mt-2 text-xs text-amber">Stats stale: {text(meta.error, 'waiting for collector')}</div>}
      <button className="mt-2 text-xs font-bold text-accent opacity-0 transition group-hover:opacity-100" onClick={onOpen}>
        Details
      </button>
      <span className="sr-only">{id}</span>
    </Card>
  )
}

function HistoryBar({ history }: { history: Array<boolean | number | null> }) {
  const recent = history.slice(-60)
  return (
    <div className="flex h-3 gap-0.5">
      {recent.map((item, index) => {
        const ok = item === true || item === 1
        const bad = item === false || item === 0
        return <span key={index} className={cx('h-full flex-1 rounded-sm', ok && 'bg-mint', bad && 'bg-rose', !ok && !bad && 'bg-panel3')} />
      })}
    </div>
  )
}

function pickHighlights(stats: AnyRecord): Array<[string, unknown]> {
  const ignored = new Set(['health_messages', 'now_playing', 'libraries', 'disks', 'gpu', 'cpu', 'ram', 'swap'])
  return Object.entries(stats)
    .filter(([key, value]) => !ignored.has(key) && value != null && ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 4)
    .map(([key, value]) => [key.replace(/_/g, ' '), value])
}

function ServiceModal({
  serviceId,
  status,
  stats,
  version,
  webUrl,
  onClose,
  notify,
}: {
  serviceId: string
  status: ServiceStatus
  stats: AnyRecord
  version: AnyRecord
  webUrl: string
  onClose: () => void
  notify: (message: string, kind?: 'ok' | 'warn' | 'err') => void
}) {
  const [tab, setTab] = useState('overview')
  const current = status.current
  const unit = current.unit || ''
  return (
    <Modal title={current.name} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap gap-2">
        {['overview', 'logs', 'controls'].map((item) => (
          <Button key={item} variant={tab === item ? 'default' : 'ghost'} onClick={() => setTab(item)}>
            {item}
          </Button>
        ))}
        {serviceId === 'aiostreams' && (
          <>
            <Button variant={tab === 'analyzer' ? 'default' : 'ghost'} onClick={() => setTab('analyzer')}>
              Analyzer
            </Button>
            <Button variant={tab === 'tests' ? 'default' : 'ghost'} onClick={() => setTab('tests')}>
              Test Suite
            </Button>
          </>
        )}
        {serviceId === 'mediafusion' && (
          <>
            <Button variant={tab === 'metrics' ? 'default' : 'ghost'} onClick={() => setTab('metrics')}>
              Metrics
            </Button>
            <Button variant={tab === 'scraper' ? 'default' : 'ghost'} onClick={() => setTab('scraper')}>
              Scraper Analyzer
            </Button>
          </>
        )}
      </div>
      {tab === 'overview' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="p-3">
            <Field label="Status" value={current.ok === true ? 'Healthy' : current.ok === false ? 'Unhealthy' : 'Pending'} />
            <Field label="Systemd" value={current.systemd || '-'} />
            <Field label="Latency" value={current.latency_ms != null ? `${current.latency_ms}ms` : '-'} />
            <Field label="Unit" value={unit || '-'} />
            <Field label="Installed" value={text(version.installed, '-')} />
            <Field label="Latest" value={text(version.latest, '-')} />
            {webUrl && (
              <Button className="mt-3" onClick={() => window.open(webUrl, '_blank', 'noopener')}>
                Open web UI
              </Button>
            )}
          </Card>
          <JsonPanel title="Stats" data={stats} />
        </div>
      )}
      {tab === 'logs' && <LogViewer unit={unit} />}
      {tab === 'controls' && <ServiceControls unit={unit} notify={notify} />}
      {tab === 'analyzer' && <Analyzer endpoint="/api/aiostreams/analyze" logUnit="aiostreams" title="AIOStreams analyzer" />}
      {tab === 'tests' && <AioTestSuite />}
      {tab === 'metrics' && <Analyzer endpoint="/api/mediafusion/metrics" title="MediaFusion metrics" />}
      {tab === 'scraper' && <Analyzer endpoint="/api/mediafusion/analyze" logUnit="mediafusion-taskiq-scrapy" title="MediaFusion scraper analyzer" />}
    </Modal>
  )
}

function LogViewer({ unit }: { unit: string }) {
  const [lines, setLines] = useState('200')
  const [filter, setFilter] = useState('')
  const logs = useQuery({
    queryKey: ['logs', unit, lines],
    queryFn: () => api<{ lines: string[] }>(`/api/logs/${encodeURIComponent(unit)}?n=${lines}`),
    enabled: Boolean(unit),
    refetchInterval: 5000,
  })
  const filtered = (logs.data?.lines || []).filter((line) => line.toLowerCase().includes(filter.toLowerCase()))
  if (!unit) return <div className="text-muted">No systemd unit configured.</div>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={lines} onChange={(event) => setLines(event.target.value)}>
          <option value="100">100 lines</option>
          <option value="200">200 lines</option>
          <option value="500">500 lines</option>
          <option value="1000">1000 lines</option>
        </Select>
        <Input placeholder="Filter logs" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <Button variant="ghost" onClick={() => void logs.refetch()}>
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>
      <pre className="max-h-[58vh] overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-relaxed text-muted">
        {logs.isLoading ? 'Loading logs...' : filtered.join('\n') || 'No log lines.'}
      </pre>
    </div>
  )
}

function ServiceControls({ unit, notify }: { unit: string; notify: (message: string, kind?: 'ok' | 'warn' | 'err') => void }) {
  const [output, setOutput] = useState('Action output will appear here.')
  async function action(name: string) {
    if (!unit) return
    try {
      await api(`/api/service/${encodeURIComponent(unit)}/${name}`, { method: 'POST' })
      setOutput(`${name} sent to ${unit}`)
      notify(`${unit}: ${name} succeeded`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setOutput(message)
      notify(message, 'err')
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void action('start')}>Start</Button>
        <Button variant="danger" onClick={() => void action('stop')}>
          Stop
        </Button>
        <Button variant="ghost" onClick={() => void action('restart')}>
          Restart
        </Button>
      </div>
      <pre className="rounded-lg border border-line bg-canvas p-3 text-xs text-muted">{output}</pre>
    </div>
  )
}

function JsonPanel({ title, data }: { title: string; data: unknown }) {
  return (
    <Card className="p-3">
      <h3 className="mb-2 text-xs font-black uppercase text-muted">{title}</h3>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-canvas p-3 font-mono text-xs text-muted">
        {JSON.stringify(data, null, 2)}
      </pre>
    </Card>
  )
}

function LogsPage({ units }: { units: Bootstrap['log_units'] }) {
  const [unit, setUnit] = useState(units[0]?.unit || '')
  return (
    <Card className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <Terminal className="text-accent" size={16} />
        <h2 className="text-base font-black">Live logs</h2>
      </div>
      <Select className="mb-3" value={unit} onChange={(event) => setUnit(event.target.value)}>
        {units.map((item) => (
          <option key={item.unit} value={item.unit}>
            {item.name} - {item.unit}
          </option>
        ))}
      </Select>
      <LogViewer unit={unit} />
    </Card>
  )
}

function PermissionsPage({ notify }: { notify: (message: string, kind?: 'ok' | 'warn' | 'err') => void }) {
  const [results, setResults] = useState<AnyRecord[]>([])
  const [issuesOnly, setIssuesOnly] = useState(false)
  const [recursive, setRecursive] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const scan = useMutation({
    mutationFn: () => api<{ results: AnyRecord[] }>('/api/perms/scan', { method: 'POST' }),
    onSuccess: (data) => {
      setResults(data.results || [])
      setSelected(new Set())
      notify('Permission scan complete')
    },
    onError: (err) => notify(err instanceof Error ? err.message : 'Permission scan failed', 'err'),
  })
  const visibleEntries = results.map((item, index) => ({ item, index })).filter(({ item }) => !issuesOnly || item.ok === false)
  const visible = visibleEntries.map(({ item }) => item)
  async function applySelected() {
    const fixes = [...selected].map((index) => ({ ...results[index], recursive }))
    try {
      await api('/api/perms/fix', { method: 'POST', body: JSON.stringify(fixes) })
      notify('Permission fixes submitted')
      scan.mutate()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Permission fix failed', 'err')
    }
  }
  return (
    <Card className="p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          <RefreshCw size={16} />
          Scan directories
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />
          Recursive
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={issuesOnly} onChange={(event) => setIssuesOnly(event.target.checked)} />
          Issues only
        </label>
        <Button variant="ghost" onClick={() => setSelected(new Set(results.map((_, index) => index).filter((index) => results[index].ok === false)))}>
          Select mismatches
        </Button>
        <Button disabled={!selected.size} onClick={() => void applySelected()}>
          Apply selected
        </Button>
      </div>
      <DataTable
        rows={visible}
        columns={['label', 'path', 'cur_user', 'cur_group', 'cur_mode', 'exp_user', 'exp_group', 'exp_mode']}
        selectable={{
          selected: new Set(visibleEntries.flatMap((entry, index) => (selected.has(entry.index) ? [index] : []))),
          onToggle: (index) => {
            const actualIndex = visibleEntries[index]?.index
            if (actualIndex == null) return
            const next = new Set(selected)
            if (next.has(actualIndex)) next.delete(actualIndex)
            else next.add(actualIndex)
            setSelected(next)
          },
        }}
      />
    </Card>
  )
}

function ErrorsPage({ notify }: { notify: (message: string, kind?: 'ok' | 'warn' | 'err') => void }) {
  const [service, setService] = useState('')
  const [severity, setSeverity] = useState('')
  const [sort, setSort] = useState('newest')
  const errors = useQuery({ queryKey: ['errors'], queryFn: () => api<AnyRecord>('/api/errors') })
  const rows = asArray(errors.data?.errors).map(asRecord)
  const services = [...new Set(rows.map((row) => text(row.sid || row.service)).filter(Boolean))]
  const filtered = rows
    .filter((row) => !service || text(row.sid || row.service) === service)
    .filter((row) => !severity || text(row.severity) === severity)
    .sort((a, b) => {
      if (sort === 'count') return num(b.count) - num(a.count)
      if (sort === 'oldest') return text(a.timestamp || a.ts).localeCompare(text(b.timestamp || b.ts))
      return text(b.timestamp || b.ts).localeCompare(text(a.timestamp || a.ts))
    })
  async function scanNow() {
    await api('/api/errors/scan', { method: 'POST' })
    notify('Error scan started')
  }
  async function clear() {
    await api('/api/errors', { method: 'DELETE' })
    await errors.refetch()
    notify('Error history cleared')
  }
  return (
    <Card className="p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={service} onChange={(event) => setService(event.target.value)}>
          <option value="">All services</option>
          {services.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <Select value={severity} onChange={(event) => setSeverity(event.target.value)}>
          <option value="">All severities</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
        </Select>
        <Select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="count">Count</option>
        </Select>
        <Button onClick={() => void scanNow()}>Scan now</Button>
        <Button variant="danger" onClick={() => void clear()}>
          Clear
        </Button>
      </div>
      <div className="space-y-2">
        {filtered.map((row, index) => (
          <details key={index} className="rounded-md border border-line bg-canvas p-2.5">
            <summary className="cursor-pointer text-xs">
              <Badge tone={text(row.severity) === 'error' ? 'err' : 'warn'}>{text(row.severity, 'event')}</Badge>
              <span className="ml-2 font-bold">{text(row.sid || row.service, 'unknown')}</span>
              <span className="ml-2 text-muted">{text(row.timestamp || row.ts)}</span>
              <span className="ml-2 text-muted">{text(row.line || row.message).slice(0, 140)}</span>
            </summary>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-muted">{JSON.stringify(row, null, 2)}</pre>
          </details>
        ))}
      </div>
    </Card>
  )
}

function SettingsPage({ notify }: { notify: (message: string, kind?: 'ok' | 'warn' | 'err') => void }) {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const [keyData, urlData] = await Promise.all([api<Record<string, AnyRecord>>('/api/settings/keys'), api<Record<string, AnyRecord>>('/api/settings/urls')])
      setKeys(Object.fromEntries(Object.entries(keyData).map(([key, value]) => [key, text(value.value)])))
      setUrls(Object.fromEntries(Object.entries(urlData).map(([key, value]) => [key, text(value.value)])))
      return { keyData, urlData }
    },
  })
  async function saveKeys() {
    await api('/api/settings/keys', { method: 'POST', body: JSON.stringify(keys) })
    notify('API keys saved')
  }
  async function saveUrls() {
    await api('/api/settings/urls', { method: 'POST', body: JSON.stringify(urls) })
    notify('Service URLs saved')
  }
  async function changePassword() {
    if (passwords.next !== passwords.confirm) {
      notify('Password confirmation does not match', 'warn')
      return
    }
    await api('/api/settings/password', { method: 'POST', body: JSON.stringify({ current: passwords.current, new_password: passwords.next }) })
    notify('Password changed')
    setPasswords({ current: '', next: '', confirm: '' })
  }
  if (settings.isLoading) return <Card className="p-3 text-xs text-muted">Loading settings...</Card>
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <EditableRegistry title="API keys" data={settings.data?.keyData || {}} values={keys} setValues={setKeys} onSave={() => void saveKeys()} secret />
      <EditableRegistry title="Service URLs" data={settings.data?.urlData || {}} values={urls} setValues={setUrls} onSave={() => void saveUrls()} />
      <Card className="p-3 xl:col-span-2">
        <h2 className="mb-3 text-base font-black">Password</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <Input type="password" placeholder="Current" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} />
          <Input type="password" placeholder="New" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} />
          <Input type="password" placeholder="Confirm" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} />
        </div>
        <Button className="mt-3" onClick={() => void changePassword()}>
          Update password
        </Button>
      </Card>
    </div>
  )
}

function EditableRegistry({
  title,
  data,
  values,
  setValues,
  onSave,
  secret,
}: {
  title: string
  data: Record<string, AnyRecord>
  values: Record<string, string>
  setValues: (values: Record<string, string>) => void
  onSave: () => void
  secret?: boolean
}) {
  const groups = Object.entries(data).reduce<Record<string, Array<[string, AnyRecord]>>>((acc, entry) => {
    const group = text(entry[1].group, 'Other')
    acc[group] = [...(acc[group] || []), entry]
    return acc
  }, {})
  return (
    <Card className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-black">{title}</h2>
        <Button onClick={onSave}>Save</Button>
      </div>
      <div className="space-y-4">
        {Object.entries(groups).map(([group, entries]) => (
          <div key={group}>
            <h3 className="mb-2 text-xs font-black uppercase text-muted">{group}</h3>
            <div className="space-y-2">
              {(entries || []).map(([key, value]) => (
                <label key={key} className="grid gap-1 text-xs text-muted">
                  {text(value.label, key)}
                  <Input type={secret ? 'password' : 'text'} value={values[key] || ''} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function JellyfinPage() {
  const jellyfin = useQuery({ queryKey: ['jellyfin'], queryFn: () => api<AnyRecord>('/api/jellyfin'), refetchInterval: 30000 })
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <JsonPanel title="Active sessions" data={jellyfin.data?.sessions || []} />
      <JsonPanel title="Recent activity" data={jellyfin.data?.activity || []} />
    </div>
  )
}

function SpeedTestCard({ config, compact }: { config: SpeedConfig; compact?: boolean }) {
  const [size, setSize] = useState('25')
  const [results, setResults] = useState<Array<{ name: string; mbps: number; seconds: number }>>([])
  const [running, setRunning] = useState(false)
  const endpoints = [
    { name: config.direct_name, url: config.direct_url },
    { name: config.cf_name, url: config.cf_url },
  ].filter((endpoint) => endpoint.url)
  async function run() {
    setRunning(true)
    setResults([])
    const next: Array<{ name: string; mbps: number; seconds: number }> = []
    for (const endpoint of endpoints) {
      const start = performance.now()
      const response = await fetch(`${endpoint.url}?mb=${size}&_t=${Date.now()}`, { cache: 'no-store' })
      const blob = await response.blob()
      const seconds = (performance.now() - start) / 1000
      next.push({ name: endpoint.name, seconds, mbps: (blob.size * 8) / seconds / 1_000_000 })
      setResults([...next])
    }
    setRunning(false)
  }
  return (
    <Card className="p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-black">Speed test</h2>
          <p className="text-xs text-muted">Direct and proxied download checks</p>
        </div>
        <div className="flex gap-2">
          <Select value={size} onChange={(event) => setSize(event.target.value)}>
            {['10', '25', '50', '100', '250', '500'].map((value) => (
              <option key={value} value={value}>
                {value} MB
              </option>
            ))}
          </Select>
          <Button onClick={() => void run()} disabled={running}>
            {running ? 'Running...' : 'Run'}
          </Button>
        </div>
      </div>
      <div className={cx('grid gap-2', compact ? 'md:grid-cols-2' : 'lg:grid-cols-2')}>
        {endpoints.map((endpoint) => {
          const result = results.find((item) => item.name === endpoint.name)
          return (
            <div key={endpoint.name} className="rounded-lg border border-line bg-canvas p-3">
              <div className="mb-2 flex justify-between gap-2">
                <span className="font-bold">{endpoint.name}</span>
                <span className="font-mono text-accent">{result ? `${result.mbps.toFixed(1)} Mbps` : '-'}</span>
              </div>
              <Progress value={result ? Math.min(result.mbps / 10, 100) : 0} tone="cyan" />
              <div className="mt-2 text-xs text-muted">{result ? `${result.seconds.toFixed(2)}s` : endpoint.url}</div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function BenchmarkPage({ titles }: { titles: Record<string, string> }) {
  const [imdb, setImdb] = useState(Object.keys(titles)[0] || '')
  const [mode, setMode] = useState('all')
  const [results, setResults] = useState<unknown[]>([])
  async function runOne() {
    const data = await api<AnyRecord>(`/api/benchmark?imdb=${encodeURIComponent(imdb)}&mode=${encodeURIComponent(mode)}`)
    setResults([data])
  }
  async function runAll() {
    const next: unknown[] = []
    for (const id of Object.keys(titles).slice(0, 40)) {
      next.push(await api<AnyRecord>(`/api/benchmark?imdb=${encodeURIComponent(id)}&mode=${encodeURIComponent(mode)}`))
      setResults([...next])
    }
  }
  return (
    <Card className="p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={imdb} onChange={(event) => setImdb(event.target.value)}>
          {Object.entries(titles).map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </Select>
        <Select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="all">All</option>
          <option value="cached">Cached</option>
          <option value="uncached">Uncached</option>
        </Select>
        <Button onClick={() => void runOne()}>Run benchmark</Button>
        <Button variant="ghost" onClick={() => void runAll()}>
          Run all
        </Button>
      </div>
      <JsonPanel title="Benchmark results" data={results} />
    </Card>
  )
}

function ApiExplorer() {
  const endpoints = [
    ['GET', '/api/ping'],
    ['GET', '/api/public'],
    ['GET', '/api/status'],
    ['GET', '/api/stats'],
    ['GET', '/api/stats/system'],
    ['GET', '/api/versions'],
    ['GET', '/api/errors'],
    ['POST', '/api/errors/scan'],
    ['GET', '/api/settings/keys'],
    ['GET', '/api/settings/urls'],
    ['GET', '/api/jellyfin'],
    ['GET', '/api/packages'],
    ['GET', '/api/processes'],
    ['GET', '/api/dmesg'],
  ]
  const [output, setOutput] = useState<unknown>(null)
  async function tryEndpoint(method: string, path: string) {
    setOutput(await api(path, { method }))
  }
  return (
    <div className="grid gap-3 xl:grid-cols-[390px_1fr]">
      <Card className="p-3">
        <h2 className="mb-3 text-base font-black">REST API Explorer</h2>
        <div className="space-y-2">
          {endpoints.map(([method, path]) => (
            <button key={`${method}-${path}`} className="flex w-full items-center gap-2 rounded-md border border-line bg-canvas p-2.5 text-left hover:border-accent/40" onClick={() => void tryEndpoint(method, path)}>
              <Badge tone={method === 'GET' ? 'cyan' : 'warn'}>{method}</Badge>
              <span className="font-mono text-xs text-text">{path}</span>
            </button>
          ))}
        </div>
      </Card>
      <JsonPanel title="Response" data={output || { status: 'Select an endpoint' }} />
    </div>
  )
}

function PackagesPage() {
  const [showAll, setShowAll] = useState(false)
  const packages = useQuery({ queryKey: ['packages'], queryFn: () => api<AnyRecord>('/api/packages') })
  const nativeData = asRecord(packages.data?.native)
  const aurData = asRecord(packages.data?.aur)
  const nativeUpdates = asArray(nativeData.updates).map(asRecord).map((row) => ({ ...row, repo: 'native', outdated: true }))
  const aurUpdates = asArray(aurData.updates).map(asRecord).map((row) => ({ ...row, repo: 'aur', outdated: true }))
  const summary = [
    { repo: 'native', total: nativeData.total, outdated: nativeData.outdated },
    { repo: 'aur', total: aurData.total, outdated: aurData.outdated },
  ]
  const rows = showAll ? [...summary, ...nativeUpdates, ...aurUpdates] : [...nativeUpdates, ...aurUpdates]
  return (
    <Card className="p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void packages.refetch()}>Check now</Button>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          Show all native packages
        </label>
      </div>
      <DataTable rows={rows} columns={showAll ? ['repo', 'total', 'outdated', 'name', 'installed', 'available'] : ['name', 'installed', 'available', 'repo', 'outdated']} />
    </Card>
  )
}

function Analyzer({ endpoint, logUnit, title }: { endpoint: string; logUnit?: string; title: string }) {
  const [lines, setLines] = useState('5000')
  const [data, setData] = useState<unknown>(null)
  async function load() {
    setData(await api(`${endpoint}${endpoint.includes('?') ? '&' : '?'}n=${lines}`))
  }
  async function raw() {
    if (!logUnit) return
    setData(await api(`/api/logs/${encodeURIComponent(logUnit)}?n=${lines}`))
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={lines} onChange={(event) => setLines(event.target.value)}>
          {['1000', '2000', '5000', '10000', '25000', '50000'].map((value) => (
            <option key={value} value={value}>
              {value} lines
            </option>
          ))}
        </Select>
        <Button onClick={() => void load()}>Analyze</Button>
        {logUnit && (
          <Button variant="ghost" onClick={() => void raw()}>
            Raw logs
          </Button>
        )}
      </div>
      <JsonPanel title={title} data={data || { status: 'Click Analyze' }} />
    </div>
  )
}

function AioTestSuite() {
  const [imdb, setImdb] = useState('tt0468569')
  const [type, setType] = useState('movie')
  const [results, setResults] = useState<unknown[]>([])
  async function run() {
    const data = await api('/api/aiostreams/test', { method: 'POST', body: JSON.stringify({ imdb, type }) })
    setResults([data, ...results])
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="movie">Movie</option>
          <option value="series">Series</option>
        </Select>
        <Input value={imdb} onChange={(event) => setImdb(event.target.value)} placeholder="tt0468569 or tt0903747:3:7" />
        <Button onClick={() => void run()}>Run test</Button>
      </div>
      <JsonPanel title="Test results" data={results} />
    </div>
  )
}

function ProcessModal({ onClose }: { onClose: () => void }) {
  const processes = useQuery({ queryKey: ['processes'], queryFn: () => api<{ processes: AnyRecord[]; top_memory: AnyRecord[] }>('/api/processes') })
  return (
    <Modal title="Process Monitor" onClose={onClose} wide>
      <div className="space-y-4">
        <Card className="p-3">
          <h3 className="mb-2 text-xs font-black uppercase text-muted">Top CPU processes</h3>
          <DataTable rows={processes.data?.processes || []} columns={['name', 'pid', 'cpu_pct', 'cpu_total_pct', 'mem_mb', 'mem_pct', 'threads', 'user', 'status', 'cmd']} />
        </Card>
        <Card className="p-3">
          <h3 className="mb-2 text-xs font-black uppercase text-muted">Top RAM processes</h3>
          <DataTable rows={processes.data?.top_memory || []} columns={['name', 'pid', 'mem_mb', 'mem_pct', 'cpu_pct', 'cpu_total_pct', 'user', 'status', 'cmd']} />
        </Card>
      </div>
    </Modal>
  )
}

function DataTable({
  rows,
  columns,
  selectable,
}: {
  rows: AnyRecord[]
  columns: string[]
  selectable?: { selected: Set<number>; onToggle: (index: number) => void }
}) {
  if (!rows.length) return <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-muted">No data.</div>
  return (
    <div className="overflow-auto rounded-lg border border-line">
      <table className="min-w-full border-collapse text-xs">
        <thead className="bg-panel2 text-xs uppercase text-muted">
          <tr>
            {selectable && <th className="p-1.5 text-left">Select</th>}
            {columns.map((column) => (
              <th key={column} className="p-1.5 text-left">
                {column.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line bg-canvas/60">
              {selectable && (
                <td className="p-1.5">
                  <input type="checkbox" checked={selectable.selected.has(index)} onChange={() => selectable.onToggle(index)} />
                </td>
              )}
              {columns.map((column) => (
                <td key={column} className="max-w-[26rem] truncate p-1.5 text-muted" title={text(row[column])}>
                  {typeof row[column] === 'boolean' ? (row[column] ? 'yes' : 'no') : text(row[column], '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default App
