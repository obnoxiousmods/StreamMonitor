import {
  Activity,
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  KeyRound,
  ListTree,
  LogOut,
  Maximize2,
  Minimize2,
  Network,
  Pause,
  Play,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Terminal,
  WrapText,
  X,
  Zap,
} from 'lucide-react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AioStreamsAnalyzer,
  AioTestSuite,
  JellyfinPage,
  MediaFusionMetrics,
  MediaFusionScraperAnalyzer,
} from './features/diagnosticPanels'
import { MetricChart } from './lib/chart'
import type { ChartRange } from './lib/chart'
import { formatBytes, formatRate, heatText } from './lib/format'
import { SortableTable } from './lib/table'
import type { ColumnDef } from './lib/table'

const CHART_RANGES: Array<{ id: ChartRange; label: string }> = [
  { id: '1h', label: '1h' },
  { id: '6h', label: '6h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
]

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
  history: Array<boolean | number | null | AnyRecord>
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

type PublicConfig = {
  speedtest: SpeedConfig
  categories: Record<string, string>
}

type PublicServiceSummary = {
  id?: string
  name: string
  ok: boolean | null
  latency_ms?: number | null
  category: string
  history?: Array<boolean | number | null>
  availability_pct?: number | null
  updated_at?: string | null
}

type PublicCategorySummary = {
  id: string
  label: string
  total: number
  up: number
  down: number
  availability_pct?: number | null
  services: string[]
}

type PublicStatus = {
  services: Record<string, PublicServiceSummary>
  categories: Record<string, PublicCategorySummary>
  total: number
  up: number
  down: number
  availability_pct?: number | null
  updated_at?: string | null
  window_minutes?: number | null
}

type ToastState = { message: string; kind: 'ok' | 'warn' | 'err' } | null
type MetricTone = 'ok' | 'warn' | 'err' | 'cyan' | 'muted'

const STATUS_REFRESH_MS = 5000
const STATS_REFRESH_MS = 15000
const VERSION_REFRESH_MS = 300000
const EMPTY_DROPDOWN_VALUE = '__streammonitor_empty__'

const TAB_ITEMS = [
  ['services', 'Services', Server],
  ['processes', 'Processes', ListTree],
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

const TAB_PATHS: Record<string, string> = {
  services: '/',
  processes: '/processes',
  logs: '/logs',
  perms: '/perms',
  errors: '/errors',
  settings: '/settings',
  jellyfin: '/jellyfin',
  speed: '/speedtest',
  benchmark: '/benchmark',
  api: '/api-explorer',
  packages: '/packages',
}
const PATH_TABS: Record<string, string> = Object.fromEntries(Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]))

function tabFromPath(pathname: string): string {
  return PATH_TABS[pathname] || 'services'
}

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

function pctOrDash(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? pct(value) : '-'
}

function clockTime(value: unknown): string {
  if (!value) return '-'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleTimeString('en-CA', { hour12: false })
}

function toneForAvailability(value: unknown): MetricTone {
  const availability = typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
  if (!Number.isFinite(availability)) return 'muted'
  if (availability >= 99) return 'ok'
  if (availability >= 95) return 'cyan'
  if (availability >= 85) return 'warn'
  return 'err'
}

function toneForService(ok: boolean | null | undefined): 'ok' | 'warn' | 'err' | 'muted' {
  if (ok === true) return 'ok'
  if (ok === false) return 'err'
  return 'muted'
}

function hasSpeedtestConfig(config: SpeedConfig | undefined | null): boolean {
  if (!config) return false
  return Boolean(config.direct_url || config.cf_url)
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
    const message =
      typeof body === 'object' && body && 'error' in body ? String((body as AnyRecord).error) : response.statusText
    throw new Error(message)
  }
  return body as T
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx('min-w-0 rounded-lg border border-line bg-panel shadow-glow', className)}>
      {children}
    </section>
  )
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
        'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8 sm:px-2.5 sm:py-1.5',
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
        'min-h-10 min-w-0 rounded-md border border-line bg-canvas px-3 py-2 text-xs text-text outline-none transition placeholder:text-dim focus:border-accent/60 sm:min-h-8 sm:px-2.5 sm:py-1.5',
        className,
      )}
      {...props}
    />
  )
}

type DropdownOption = {
  value: string
  label: ReactNode
  disabled?: boolean
}

function Dropdown({
  value,
  onChange,
  options,
  placeholder = 'Select',
  className,
  disabled,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: DropdownOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const hasEmptyOption = options.some((option) => option.value === '')
  const radixValue = value === '' ? (hasEmptyOption ? EMPTY_DROPDOWN_VALUE : undefined) : value
  return (
    <SelectPrimitive.Root
      value={radixValue}
      onValueChange={(next) => onChange(next === EMPTY_DROPDOWN_VALUE ? '' : next)}
      disabled={disabled || options.length === 0}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cx(
          'group inline-flex min-h-10 min-w-0 max-w-full items-center justify-between gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-left text-xs font-semibold text-text outline-none transition hover:border-accent/40 focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-accent/55 data-[state=open]:bg-panel2 sm:min-h-8 sm:min-w-32 sm:px-2.5 sm:py-1.5',
          className,
        )}
      >
        <SelectPrimitive.Value className="min-w-0 flex-1 truncate" placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            size={14}
            className="shrink-0 text-dim transition group-data-[state=open]:rotate-180 group-data-[state=open]:text-accent"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className="z-[80] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-line bg-panel shadow-glow"
        >
          <SelectPrimitive.Viewport className="max-h-[min(var(--radix-select-content-available-height),22rem)] p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value || EMPTY_DROPDOWN_VALUE}
                value={option.value === '' ? EMPTY_DROPDOWN_VALUE : option.value}
                disabled={option.disabled}
                className="relative flex min-h-10 cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-2 text-xs text-muted outline-none transition data-[disabled]:pointer-events-none data-[highlighted]:bg-accent/15 data-[highlighted]:text-text data-[state=checked]:text-text data-[disabled]:opacity-40 sm:min-h-8 sm:py-1.5 sm:pl-7"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center text-accent">
                  <Check size={13} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
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

function Field({
  label,
  value,
  tone,
}: {
  label: string
  value: ReactNode
  tone?: 'ok' | 'warn' | 'err' | 'muted' | 'cyan'
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 border-b border-line/60 py-1 text-xs last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-muted">{label}</span>
      <span
        className={cx(
          'min-w-0 flex-1 truncate text-right font-semibold text-text',
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
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-3"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'animate-modal-in flex h-[92dvh] max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg border border-line bg-panel shadow-glow sm:h-auto sm:max-h-[94vh] sm:rounded-lg',
          wide ? 'sm:max-w-6xl' : 'sm:max-w-3xl',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line bg-panel2 px-3 py-2">
          <h2 className="min-w-0 truncate text-sm font-bold text-text">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-line/60 hover:text-text"
          >
            <X size={18} />
          </button>
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
  if (!authenticated) {
    return (
      <>
        <PublicLandingPage
          accentTheme={accentTheme}
          onAccentThemeChange={changeAccentTheme}
          onLogin={() => {
            void queryClient.invalidateQueries({ queryKey: ['session'] })
            window.history.replaceState(null, '', '/')
          }}
        />
        {toast && <Toast toast={toast} />}
      </>
    )
  }

  if (path === '/login') {
    window.history.replaceState(null, '', '/')
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
        'fixed inset-x-2 bottom-2 z-[60] rounded-lg border px-3 py-2 text-xs shadow-glow sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-w-md',
        toast.kind === 'ok' && 'border-accent/40 bg-accent/15 text-text',
        toast.kind === 'warn' && 'border-amber/40 bg-amber/15 text-text',
        toast.kind === 'err' && 'border-rose/40 bg-rose/15 text-text',
      )}
    >
      {toast.message}
    </div>
  )
}

function ThemePicker({ value, onChange }: { value: AccentThemeId; onChange: (theme: AccentThemeId) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase text-dim">
      <span className="hidden sm:inline">Theme</span>
      <Dropdown
        className="w-32 px-2 py-1 text-xs sm:min-h-8 sm:w-36"
        value={value}
        onChange={(next) => {
          if (isAccentThemeId(next)) onChange(next)
        }}
        options={ACCENT_THEMES.map((theme) => ({ value: theme.id, label: theme.label }))}
        ariaLabel="Theme"
      />
    </div>
  )
}

function PublicLandingPage({
  accentTheme,
  onAccentThemeChange,
  onLogin,
}: {
  accentTheme: AccentThemeId
  onAccentThemeChange: (theme: AccentThemeId) => void
  onLogin: () => void
}) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const publicConfig = useQuery({
    queryKey: ['public-config'],
    queryFn: () => api<PublicConfig>('/api/public-config'),
  })
  const publicStatus = useQuery({
    queryKey: ['public-status'],
    queryFn: () => api<PublicStatus>('/api/public'),
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
  const services = publicStatus.data?.services || {}
  const categoryLabels = publicConfig.data?.categories || {}
  const groupedServices = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const [id, service] of Object.entries(services)) {
      const category = service.category || 'other'
      groups[category] = [...(groups[category] || []), id]
    }
    for (const ids of Object.values(groups)) {
      ids.sort((left, right) => {
        const leftService = services[left]
        const rightService = services[right]
        const leftRank = leftService?.ok === false ? 0 : leftService?.ok == null ? 1 : 2
        const rightRank = rightService?.ok === false ? 0 : rightService?.ok == null ? 1 : 2
        if (leftRank !== rightRank) return leftRank - rightRank
        return text(leftService?.name, left).localeCompare(text(rightService?.name, right))
      })
    }
    return groups
  }, [services])
  const categories = useMemo(() => {
    const source = publicStatus.data?.categories || {}
    const orderedIds = [...Object.keys(categoryLabels), ...Object.keys(source).filter((id) => !(id in categoryLabels))]
    return orderedIds
      .map((id) => {
        const record = source[id]
        const serviceIds = record?.services?.length ? record.services : groupedServices[id] || []
        if (!serviceIds.length && num(record?.total) === 0) return null
        return {
          id,
          label: text(record?.label, categoryLabels[id] || id.replace(/_/g, ' ')),
          total: num(record?.total, serviceIds.length),
          up: num(record?.up, serviceIds.filter((serviceId) => services[serviceId]?.ok === true).length),
          down: num(record?.down, serviceIds.filter((serviceId) => services[serviceId]?.ok === false).length),
          availability_pct:
            typeof record?.availability_pct === 'number' && Number.isFinite(record.availability_pct)
              ? record.availability_pct
              : null,
          services: serviceIds,
        }
      })
      .filter((category): category is NonNullable<typeof category> => Boolean(category))
  }, [categoryLabels, groupedServices, publicStatus.data?.categories, services])
  const incidents = useMemo(
    () =>
      Object.entries(services)
        .filter(([, service]) => service.ok === false)
        .sort((left, right) => (num(right[1].latency_ms) || 0) - (num(left[1].latency_ms) || 0))
        .slice(0, 4),
    [services],
  )
  const previewModules = [
    {
      title: 'Logs and errors',
      detail: 'Live journalctl streams, error scans, and service actions after sign-in.',
      icon: Terminal,
    },
    {
      title: 'Diagnostics',
      detail: 'Benchmarks, Jellyfin activity, and service-specific analyzers in one shell.',
      icon: Gauge,
    },
    {
      title: 'Stack admin',
      detail: 'Package updates, API keys, URLs, and permission repair stay behind auth.',
      icon: Settings,
    },
    {
      title: 'API explorer',
      detail: 'Hit protected endpoints directly once the admin session is active.',
      icon: Boxes,
    },
  ]
  const onLoginRoute = window.location.pathname === '/login'

  function openPublicEndpoint(path: string) {
    window.open(path, '_blank', 'noopener')
  }

  function focusLogin() {
    if (window.location.pathname !== '/login') window.history.replaceState(null, '', '/login')
    document.getElementById('sign-in-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function focusSpeedTest() {
    document.getElementById('speed-test-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="min-h-dvh bg-canvas text-text">
      <div className="mx-auto max-w-[1840px] px-2 py-2 sm:px-3 sm:py-3">
        <header className="mb-3 rounded-[1.35rem] border border-line/80 bg-panel/90 p-3 shadow-glow backdrop-blur sm:p-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/30 bg-accent/12 text-accent">
                <Activity size={20} />
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="cyan">Public ops surface</Badge>
                  <Badge tone={num(publicStatus.data?.down) > 0 ? 'warn' : 'ok'}>
                    {num(publicStatus.data?.up)}/{num(publicStatus.data?.total)} healthy
                  </Badge>
                  {onLoginRoute && <Badge tone="muted">Admin sign-in</Badge>}
                </div>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">StreamMonitor</h1>
                <p className="mt-2 max-w-4xl text-sm text-muted sm:text-[15px]">
                  Real-time visibility into the infrastructure, streaming, and automation stack before you sign in.
                  Public health, rolling availability, live speed checks, and the authenticated toolchain now live in
                  one surface.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <Metric label="Updated" value={clockTime(publicStatus.data?.updated_at)} compact />
              <ThemePicker value={accentTheme} onChange={onAccentThemeChange} />
              <Button variant="ghost" onClick={focusSpeedTest}>
                <Zap size={16} />
                Speed test
              </Button>
              <Button onClick={focusLogin}>
                <KeyRound size={16} />
                Sign in
              </Button>
            </div>
          </div>
        </header>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_390px]">
          <div className="space-y-3">
            <Card className="overflow-hidden border-accent/25 bg-panel/95 p-4 sm:p-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={focusLogin}>
                      <KeyRound size={16} />
                      Open admin tools
                    </Button>
                    <Button variant="ghost" onClick={() => openPublicEndpoint('/api/public')}>
                      <Boxes size={16} />
                      Public JSON
                    </Button>
                    <Button variant="ghost" onClick={() => openPublicEndpoint('/api/ping')}>
                      <RefreshCw size={16} />
                      Ping API
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric label="Services" value={num(publicStatus.data?.total)} />
                    <Metric label="Online" value={num(publicStatus.data?.up)} tone="ok" />
                    <Metric
                      label="Issues"
                      value={num(publicStatus.data?.down)}
                      tone={num(publicStatus.data?.down) ? 'warn' : 'ok'}
                    />
                    <Metric
                      label="Availability"
                      value={pctOrDash(publicStatus.data?.availability_pct)}
                      tone={toneForAvailability(publicStatus.data?.availability_pct)}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-line bg-canvas/70 p-3">
                      <div className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] text-dim">
                        Public window
                      </div>
                      <div className="text-lg font-black text-text">
                        {num(publicStatus.data?.window_minutes)} minute visibility
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        Rolling health is derived from the live in-memory monitor window, not a long-term status page.
                      </p>
                    </div>
                    <div className="rounded-xl border border-line bg-canvas/70 p-3">
                      <div className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] text-dim">
                        Public endpoints
                      </div>
                      <div className="space-y-2">
                        {['/api/public', '/api/ping'].map((path) => (
                          <button
                            key={path}
                            className="flex w-full items-center justify-between rounded-lg border border-line bg-panel2/70 px-3 py-2 text-left text-xs font-semibold text-text transition hover:border-accent/40"
                            onClick={() => openPublicEndpoint(path)}
                          >
                            <span className="font-mono text-[11px] text-accent">{path}</span>
                            <span className="text-muted">open</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-[1.1rem] border border-line bg-canvas/75 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-black">Incident view</h2>
                      <p className="text-xs text-muted">Immediate issues promoted to the surface before login.</p>
                    </div>
                    <Badge tone={incidents.length ? 'warn' : 'ok'}>
                      {incidents.length ? `${incidents.length} active` : 'Clear'}
                    </Badge>
                  </div>
                  {publicStatus.error ? (
                    <div className="rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-xs text-rose">
                      {publicStatus.error instanceof Error
                        ? publicStatus.error.message
                        : 'Unable to load public health.'}
                    </div>
                  ) : incidents.length ? (
                    <div className="space-y-2">
                      {incidents.map(([id, service]) => (
                        <div key={id} className="rounded-lg border border-line bg-panel2/80 p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-text">{service.name}</div>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-dim">
                                {text(categoryLabels[service.category], service.category)}
                              </div>
                            </div>
                            <Badge tone="err">Down</Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Metric
                              label="Latency"
                              value={service.latency_ms != null ? `${service.latency_ms}ms` : '-'}
                            />
                            <Metric
                              label="Availability"
                              value={pctOrDash(service.availability_pct)}
                              tone={toneForAvailability(service.availability_pct)}
                            />
                          </div>
                          <div className="mt-3">
                            <HistoryBar history={service.history || []} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-line bg-panel2/70 p-3 text-xs text-muted">
                      No active outages in the current public window.
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card className="p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-black">Category overview</h2>
                  <p className="text-xs text-muted">
                    Aggregate health by stack area using the same category map as the dashboard.
                  </p>
                </div>
                <Badge tone={num(publicStatus.data?.down) > 0 ? 'warn' : 'ok'}>{categories.length} groups</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                {categories.map((category) => (
                  <div key={category.id} className="rounded-xl border border-line bg-canvas/75 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-black text-text">{category.label}</div>
                      <Badge tone={category.down ? 'warn' : 'ok'}>
                        {category.up}/{category.total}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <Metric label="Up" value={category.up} tone="ok" compact />
                      <Metric label="Down" value={category.down} tone={category.down ? 'err' : 'ok'} compact />
                      <Metric
                        label="Avail"
                        value={pctOrDash(category.availability_pct)}
                        tone={toneForAvailability(category.availability_pct)}
                        compact
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="space-y-4">
              {categories.map((category) => {
                if (!category.services.length) return null
                return (
                  <section key={category.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <h2 className="text-xs font-black uppercase tracking-[0.2em] text-muted">{category.label}</h2>
                      <div className="h-px flex-1 bg-line" />
                      <Badge tone={category.down ? 'warn' : 'ok'}>
                        {category.up}/{category.total}
                      </Badge>
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                      {category.services.map((serviceId) => (
                        <PublicServiceCard key={serviceId} serviceId={serviceId} service={services[serviceId]} />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>

            {hasSpeedtestConfig(publicConfig.data?.speedtest) && (
              <div id="speed-test-panel">
                <SpeedTestCard config={publicConfig.data!.speedtest} />
              </div>
            )}
          </div>

          <div className="grid content-start gap-3 xl:sticky xl:top-3">
            <div id="sign-in-panel">
              <Card className="p-4 sm:p-5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/30 bg-accent/15 text-accent">
                    <KeyRound size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black">Admin sign-in</h2>
                    <p className="text-xs text-muted">
                      Use the same shell for public status and privileged diagnostics.
                    </p>
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
                    <Input
                      className="mt-2 w-full"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-muted">
                    Password
                    <Input
                      className="mt-2 w-full"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      autoFocus={onLoginRoute}
                    />
                  </label>
                  {error && (
                    <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 text-xs text-rose">
                      {error}
                    </div>
                  )}
                  <Button className="w-full" disabled={login.isPending}>
                    <KeyRound size={16} />
                    {login.isPending ? 'Signing in...' : 'Sign in'}
                  </Button>
                </form>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-lg border border-line bg-canvas/70 p-3">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-dim">After login</div>
                    <p className="mt-2 text-xs text-muted">
                      Service controls, logs, benchmark runs, packages, settings, and private service URLs.
                    </p>
                  </div>
                  <div className="rounded-lg border border-line bg-canvas/70 p-3">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-dim">Theme state</div>
                    <p className="mt-2 text-xs text-muted">
                      Theme selection is shared across the public landing page and the dashboard shell.
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            <Card className="p-3">
              <div className="mb-3">
                <h2 className="text-base font-black">Authenticated modules</h2>
                <p className="text-xs text-muted">
                  The homepage now previews the full toolchain instead of hiding it behind a blank login card.
                </p>
              </div>
              <div className="space-y-2">
                {previewModules.map((module) => {
                  const Icon = module.icon
                  return (
                    <div key={module.title} className="rounded-xl border border-line bg-canvas/75 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/12 text-accent">
                          <Icon size={16} />
                        </div>
                        <div className="text-sm font-black text-text">{module.title}</div>
                      </div>
                      <p className="text-xs text-muted">{module.detail}</p>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </main>
  )
}

function PublicServiceCard({ serviceId, service }: { serviceId: string; service: PublicServiceSummary | undefined }) {
  const statusTone = toneForService(service?.ok)
  return (
    <Card className="p-3 transition hover:border-accent/35">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-text">{text(service?.name, serviceId)}</div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-dim">{text(service?.category, 'other')}</div>
        </div>
        <Badge tone={statusTone}>{service?.ok === true ? 'Up' : service?.ok === false ? 'Down' : 'Pending'}</Badge>
      </div>
      <HistoryBar history={service?.history || []} />
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <Metric label="Latency" value={service?.latency_ms != null ? `${service.latency_ms}ms` : '-'} compact />
        <Metric
          label="Avail"
          value={pctOrDash(service?.availability_pct)}
          tone={toneForAvailability(service?.availability_pct)}
          compact
        />
      </div>
      <div className="mt-3 text-[11px] text-muted">Updated {clockTime(service?.updated_at)}</div>
    </Card>
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
  const [activeTab, setActiveTab] = useState(() => tabFromPath(window.location.pathname))
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

  // Server-Sent Events: instant status patches + debounced stats refetch, on top of
  // (not instead of) the polling above — SSE is the fast path, polling is the safety
  // net if the connection drops or a proxy in between doesn't like long-lived streams.
  useEffect(() => {
    const source = new EventSource('/api/stream')
    let statsInvalidateTimer: ReturnType<typeof setTimeout> | null = null

    source.onmessage = (event) => {
      let msg: { type: string; data: AnyRecord }
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (msg.type === 'status') {
        const sid = text(msg.data.service_id)
        queryClient.setQueryData<Record<string, ServiceStatus>>(['status'], (old) => {
          if (!old) return old
          const prev = old[sid]
          if (!prev) return old
          return {
            ...old,
            [sid]: { current: msg.data as unknown as ServiceCurrent, history: [...prev.history.slice(-119), msg.data] },
          }
        })
      } else if (msg.type === 'stats') {
        if (statsInvalidateTimer) clearTimeout(statsInvalidateTimer)
        statsInvalidateTimer = setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ['stats'] })
        }, 600)
      }
    }
    source.onerror = () => {
      // EventSource auto-reconnects; polling covers the gap in the meantime.
    }
    return () => {
      if (statsInvalidateTimer) clearTimeout(statsInvalidateTimer)
      source.close()
    }
  }, [queryClient])

  const selected = selectedService && status.data ? status.data[selectedService] : null

  function switchTab(tab: string) {
    setActiveTab(tab)
    const path = TAB_PATHS[tab] || '/'
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
  }

  useEffect(() => {
    function onPopState() {
      setActiveTab(tabFromPath(window.location.pathname))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

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
    <main className="min-h-dvh bg-canvas text-text">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1840px] flex-wrap items-center gap-2 px-2 py-2 sm:px-3 md:flex-nowrap md:gap-3">
          <div className="flex min-w-0 flex-1 basis-[12rem] items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Activity size={17} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black">StreamMonitor</div>
              <div className="truncate text-xs text-muted">Infrastructure dashboard</div>
            </div>
          </div>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Metric label="Services" value={`${up}/${total}`} tone={down ? 'warn' : 'ok'} compact />
            <Metric label="Issues" value={down} tone={down ? 'err' : 'ok'} compact />
            <Metric label="Updated" value={new Date().toLocaleTimeString()} compact />
          </div>
          <ThemePicker value={accentTheme} onChange={onAccentThemeChange} />
          <Button variant="ghost" className="px-2 sm:px-2.5" onClick={() => void logout()}>
            <LogOut size={16} />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
        <nav className="mx-auto flex max-w-[1840px] snap-x gap-1.5 overflow-x-auto px-2 pb-2 sm:px-3">
          {TAB_ITEMS.map(([id, label, Icon]) => (
            <button
              key={id}
              className={cx(
                'inline-flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-semibold transition sm:min-h-8 sm:py-1.5',
                activeTab === id
                  ? 'border-accent/50 bg-accent/15 text-text'
                  : 'border-line bg-panel text-muted hover:border-accent/35 hover:text-text',
              )}
              onClick={() => switchTab(id)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-[1840px] px-2 py-2 sm:px-3 sm:py-3">
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
        {activeTab === 'processes' && <ProcessExplorerPage />}
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
  tone?: MetricTone
  compact?: boolean
}) {
  return (
    <div className={cx('rounded-md border border-line bg-panel2 px-2.5 py-1.5', compact ? 'min-w-20' : '')}>
      <div
        className={cx(
          'text-sm font-black',
          tone === 'ok' && 'text-mint',
          tone === 'warn' && 'text-amber',
          tone === 'err' && 'text-rose',
          tone === 'cyan' && 'text-cyan',
          tone === 'muted' && 'text-muted',
        )}
      >
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
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'up' | 'down'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'latency'>('name')

  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const id of Object.keys(status)) {
      const category = status[id]?.current.category || bootstrap.services[id]?.category || 'other'
      groups[category] = [...(groups[category] || []), id]
    }
    return groups
  }, [bootstrap.services, status])

  function visibleSortedIds(categoryId: string): string[] {
    const ids = (grouped[categoryId] || []).filter((id) => {
      const cur = status[id]?.current
      const name = (cur?.name || id).toLowerCase()
      if (search && !name.includes(search.toLowerCase()) && !id.toLowerCase().includes(search.toLowerCase())) {
        return false
      }
      if (statusFilter === 'up' && cur?.ok !== true) return false
      if (statusFilter === 'down' && cur?.ok !== false) return false
      return true
    })
    return ids.sort((a, b) => {
      if (sortBy === 'latency') {
        const la = status[a]?.current.latency_ms ?? -1
        const lb = status[b]?.current.latency_ms ?? -1
        return lb - la
      }
      return (status[a]?.current.name || a).localeCompare(status[b]?.current.name || b)
    })
  }

  const downCount = Object.values(status).filter((s) => s.current.ok === false).length

  return (
    <div className="space-y-4">
      <SystemPanel
        stats={stats.system || {}}
        networkStats={stats.network || {}}
        netIpStats={stats.netips || {}}
        onOpenProcesses={onOpenProcesses}
      />
      <Card className="flex flex-wrap items-center gap-2 p-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter services by name..."
          className="min-h-8 w-full max-w-xs rounded-md border border-line bg-canvas px-2 text-xs text-text placeholder:text-dim focus:border-accent focus:outline-none sm:w-56"
        />
        <div className="flex items-center gap-1 rounded-md border border-line bg-canvas p-0.5">
          {(['all', 'up', 'down'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={cx(
                'rounded px-2 py-1 text-[10px] font-bold uppercase',
                statusFilter === v ? 'bg-accent text-canvas' : 'text-muted hover:text-text',
              )}
            >
              {v}
              {v === 'down' && downCount > 0 ? ` (${downCount})` : ''}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-line bg-canvas p-0.5">
          {(['name', 'latency'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setSortBy(v)}
              className={cx(
                'rounded px-2 py-1 text-[10px] font-bold uppercase',
                sortBy === v ? 'bg-accent text-canvas' : 'text-muted hover:text-text',
              )}
            >
              sort: {v}
            </button>
          ))}
        </div>
      </Card>
      {Object.entries(bootstrap.categories).map(([categoryId, label]) => {
        const ids = visibleSortedIds(categoryId)
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

function RangePicker({ value, onChange }: { value: ChartRange; onChange: (r: ChartRange) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-line bg-canvas p-0.5">
      {CHART_RANGES.map((r) => (
        <button
          key={r.id}
          onClick={() => onChange(r.id)}
          className={cx(
            'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
            r.id === value ? 'bg-accent text-canvas' : 'text-muted hover:text-text',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

function CoreHeatmap({ cores }: { cores: number[] }) {
  if (!cores.length) return null
  const toneClass = (v: number) => (v > 85 ? 'bg-rose' : v > 60 ? 'bg-amber' : 'bg-mint')
  return (
    <div className="mt-1.5">
      <div className="mb-1 flex items-center justify-between text-[9px] uppercase text-dim">
        <span>Per-core</span>
        <span className="flex items-center gap-2 normal-case">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-mint" />
            &lt;60%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-amber" />
            60-85%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-rose" />
            &gt;85%
          </span>
        </span>
      </div>
      <div className="grid grid-cols-8 gap-1">
        {cores.map((v, i) => (
          <div
            key={i}
            title={`Core ${i}: ${v.toFixed(0)}%`}
            className={cx(
              'flex h-5 items-center justify-center rounded-sm text-[8px] font-bold text-canvas opacity-90',
              toneClass(v),
            )}
            style={{ opacity: 0.35 + (Math.min(v, 100) / 100) * 0.65 }}
          >
            {i}
          </div>
        ))}
      </div>
    </div>
  )
}

function SystemPanel({
  stats,
  networkStats,
  netIpStats,
  onOpenProcesses,
}: {
  stats: AnyRecord
  networkStats: AnyRecord
  netIpStats: AnyRecord
  onOpenProcesses: () => void
}) {
  const [range, setRange] = useState<ChartRange>('1h')
  const cpu = asRecord(stats.cpu)
  const ram = asRecord(stats.ram)
  const swap = asRecord(stats.swap)
  const memoryPressure = asRecord(asRecord(stats.memory_pressure).some)
  const gpu = asRecord(stats.gpu)
  const gpuClocks = asRecord(gpu.clocks)
  const disks = asArray(stats.disks).map(asRecord)
  const topCpu = asArray(stats.top_processes).map(asRecord)
  const topRam = asArray(stats.top_memory_processes).map(asRecord)
  const engines = asRecord(gpu.engines)
  const gpuProcesses = asArray(gpu.processes).map(asRecord)
  const encoderPct = num(engines.enc ?? gpu.query_encoder_util_pct)
  const decoderPct = num(engines.dec ?? gpu.query_decoder_util_pct)
  const perCore = asArray(cpu.per_core_pct).map((v) => num(v))
  const nics = asArray(networkStats.nics).map(asRecord)
  const connections = asRecord(networkStats.connections)
  const byState = asRecord(connections.by_state)
  const tcp = asRecord(networkStats.tcp)
  const wan = asRecord(networkStats.wan)
  const dns = asRecord(networkStats.dns)
  const certs = asRecord(networkStats.certs)
  const publicIp = asRecord(networkStats.public_ip)

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-black uppercase text-muted">System</h2>
        <div className="h-px flex-1 bg-line" />
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
        <InfoCard title="CPU" icon={<Cpu size={16} />}>
          <Field label="Model" value={text(cpu.model, 'Unknown')} />
          <Field label="Cores / Threads" value={`${text(cpu.physical_cores, '?')} / ${text(cpu.logical_cores, '?')}`} />
          <Field
            label="Usage"
            value={pct(cpu.usage_pct)}
            tone={num(cpu.usage_pct) > 80 ? 'err' : num(cpu.usage_pct) > 50 ? 'warn' : 'ok'}
          />
          <Progress
            value={num(cpu.usage_pct)}
            tone={num(cpu.usage_pct) > 80 ? 'err' : num(cpu.usage_pct) > 50 ? 'warn' : 'ok'}
          />
          <Field
            label="Load"
            value={`${text(cpu.load_1m, '0')} / ${text(cpu.load_5m, '0')} / ${text(cpu.load_15m, '0')}`}
          />
          <MetricChart series={[{ metricKey: 'cpu_usage_pct', label: 'CPU %' }]} range={range} height={80} unit="%" />
          <CoreHeatmap cores={perCore} />
        </InfoCard>
        <InfoCard title="Memory" icon={<Database size={16} />}>
          <Field label="Used / Total" value={`${gb(ram.used_gb)} / ${gb(ram.total_gb)}`} />
          <Progress
            value={num(ram.percent)}
            tone={num(ram.percent) > 90 ? 'err' : num(ram.percent) > 70 ? 'warn' : 'ok'}
          />
          <Field label="Available" value={gb(ram.available_gb)} tone="ok" />
          {num(swap.total_gb) > 0 && (
            <Field label="Swap active / total" value={`${gb(swap.active_gb)} / ${gb(swap.total_gb)}`} />
          )}
          {num(swap.cached_gb) > 0 && <Field label="Swap cached" value={gb(swap.cached_gb)} tone="ok" />}
          {memoryPressure.avg10 !== undefined && (
            <Field
              label="Pressure (PSI avg10)"
              value={`${num(memoryPressure.avg10).toFixed(2)}%`}
              tone={num(memoryPressure.avg10) > 5 ? 'warn' : 'muted'}
            />
          )}
          <MetricChart series={[{ metricKey: 'ram_used_pct', label: 'RAM %' }]} range={range} height={80} unit="%" />
        </InfoCard>
        <InfoCard title="GPU" icon={<Gauge size={16} />}>
          <div className="mb-1.5 text-xs text-muted">{text(gpu.name, 'No GPU detected')}</div>
          <Field
            label="Usage"
            value={pct(gpu.usage_pct)}
            tone={num(gpu.usage_pct) > 80 ? 'err' : num(gpu.usage_pct) > 0 ? 'ok' : 'muted'}
          />
          <Progress value={num(gpu.usage_pct)} tone="ok" />
          <Field
            label="Encode / Decode"
            value={`${encoderPct}% / ${decoderPct}%`}
            tone={encoderPct || decoderPct ? 'cyan' : 'muted'}
          />
          <Field label="Memory busy" value={pct(gpu.mem_busy_pct)} />
          <Field label="VRAM" value={`${text(gpu.vram_used_mb, 0)} / ${text(gpu.vram_total_mb, 0)} MB`} />
          <Field label="Temp" value={`${text(gpu.temp_c, '?')}C`} tone={num(gpu.temp_c) > 80 ? 'warn' : 'ok'} />
          <Field label="Power" value={`${text(gpu.power_w, '?')} W`} />
          <Field
            label="Clocks (core/mem)"
            value={`${text(gpuClocks.graphics_mhz, '?')} / ${text(gpuClocks.memory_mhz, '?')} MHz`}
          />
          {gpu.fan_pct !== undefined && <Field label="Fan" value={pct(gpu.fan_pct)} />}
          <Field label="Processes" value={`${text(gpu.process_count, 0)} - ${text(gpu.process_memory_mb, 0)} MB`} />
          <Field label="Driver" value={text(gpu.driver_version, '-')} />
          <div className="mt-1 grid grid-cols-2 gap-2">
            <MetricChart
              series={[{ metricKey: 'gpu_usage_pct', label: 'Usage', colorVar: '--color-accent' }]}
              range={range}
              height={70}
              unit="%"
            />
            <MetricChart
              series={[{ metricKey: 'gpu_temp_c', label: 'Temp', colorVar: '--color-warn' }]}
              range={range}
              height={70}
              unit="C"
            />
          </div>
        </InfoCard>
        <InfoCard title="Network" icon={<Network size={16} />}>
          <Field label="Down" value={text(asRecord(stats.net_io).recv_rate, '0 B/s')} tone="ok" />
          <Field label="Up" value={text(asRecord(stats.net_io).sent_rate, '0 B/s')} tone="cyan" />
          <Field label="Total down" value={`${text(asRecord(stats.net_io).recv_total_gb, 0)} GB`} />
          <Field label="Total up" value={`${text(asRecord(stats.net_io).sent_total_gb, 0)} GB`} />
          <Field label="Public IP" value={text(publicIp.ip, '-')} />
          <MetricChart
            series={[
              { metricKey: 'net_recv_bytes_s', label: 'Down', colorVar: '--color-ok' },
              { metricKey: 'net_sent_bytes_s', label: 'Up', colorVar: '--color-info' },
            ]}
            range={range}
            height={80}
            formatValue={(v) => text(bytesRate(v))}
          />
        </InfoCard>
        <InfoCard title="Storage" icon={<HardDrive size={16} />} className="xl:col-span-2">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {disks.map((disk) => {
              const pct = num(disk.percent)
              const used = Math.max(0, num(disk.total) - num(disk.free))
              const tone = pct > 90 ? 'err' : pct > 75 ? 'warn' : 'ok'
              return (
                <div key={text(disk.mount)} className="rounded-md border border-line bg-canvas p-1.5">
                  <div className="mb-1 flex min-w-0 items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-semibold">{text(disk.mount)}</span>
                    <span
                      className={cx(
                        'shrink-0 font-mono font-bold',
                        tone === 'err' ? 'text-rose' : tone === 'warn' ? 'text-amber' : 'text-mint',
                      )}
                    >
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={pct} tone={tone} />
                  <div className="mt-1 flex justify-between text-[10px] text-dim">
                    <span>
                      {used.toFixed(2)} used of {text(disk.total)} {text(disk.unit)}
                    </span>
                    <span>{text(disk.free)} free</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-2">
            <MetricChart
              series={[
                { metricKey: 'disk_read_bytes_s', label: 'Read', colorVar: '--color-info' },
                { metricKey: 'disk_write_bytes_s', label: 'Write', colorVar: '--color-warn' },
              ]}
              range={range}
              height={70}
              formatValue={(v) => text(bytesRate(v))}
            />
          </div>
        </InfoCard>
        <NetworkingCard
          nics={nics}
          byState={byState}
          tcp={tcp}
          wan={wan}
          dns={dns}
          certs={certs}
          range={range}
          perIpRows={asArray(netIpStats.ips).map(asRecord)}
        />
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

function bytesRate(value: number): string {
  if (!Number.isFinite(value)) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let v = value
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

type NetIpRow = {
  ip: string
  active_bytes: number
  active_sent: number
  active_recv: number
  connections: number
  cumulative_bytes: number
  rate_bytes_s: number
}

function NetworkingCard({
  nics,
  byState,
  tcp,
  wan,
  dns,
  certs,
  range,
  perIpRows,
}: {
  nics: AnyRecord[]
  byState: AnyRecord
  tcp: AnyRecord
  wan: AnyRecord
  dns: AnyRecord
  certs: AnyRecord
  range: ChartRange
  perIpRows: AnyRecord[]
}) {
  const certEntries = Object.entries(certs).map(([host, c]) => [host, asRecord(c)] as const)
  const dnsResolver = asRecord(dns.resolver)
  const dnsNameservers = asArray(dnsResolver.nameservers).map((v) => text(v))
  const dnsEntries = Object.entries(asRecord(dns.hosts)).map(([host, d]) => [host, asRecord(d)] as const)
  const wanEntries = Object.entries(wan).map(([label, w]) => [label, asRecord(w)] as const)
  const stateEntries = Object.entries(byState).map(([k, v]) => [k, num(v)] as const)
  const maxState = Math.max(...stateEntries.map(([, v]) => v), 1)
  const totalConns = stateEntries.reduce((a, [, v]) => a + v, 0)

  const ipRows: NetIpRow[] = perIpRows.map((r) => ({
    ip: text(r.ip),
    active_bytes: num(r.active_bytes),
    active_sent: num(r.active_sent),
    active_recv: num(r.active_recv),
    connections: num(r.connections),
    cumulative_bytes: num(r.cumulative_bytes),
    rate_bytes_s: num(r.rate_bytes_s),
  }))
  const ipColumns: ColumnDef<NetIpRow>[] = [
    { key: 'ip', label: 'Remote IP', render: (r) => <span className="font-mono text-text">{r.ip}</span> },
    {
      key: 'rate_bytes_s',
      label: 'Rate',
      align: 'right',
      sortAccessor: (r) => r.rate_bytes_s,
      render: (r) => <span className={r.rate_bytes_s > 0 ? 'text-cyan' : 'text-dim'}>{formatRate(r.rate_bytes_s)}</span>,
    },
    {
      key: 'cumulative_bytes',
      label: 'Total (session)',
      align: 'right',
      sortAccessor: (r) => r.cumulative_bytes,
      render: (r) => <span className="font-semibold text-text">{formatBytes(r.cumulative_bytes)}</span>,
    },
    {
      key: 'active_sent',
      label: 'Sent',
      align: 'right',
      sortAccessor: (r) => r.active_sent,
      render: (r) => <span className="text-amber">{formatBytes(r.active_sent)}</span>,
    },
    {
      key: 'active_recv',
      label: 'Received',
      align: 'right',
      sortAccessor: (r) => r.active_recv,
      render: (r) => <span className="text-mint">{formatBytes(r.active_recv)}</span>,
    },
    { key: 'connections', label: 'Conns', align: 'right', sortAccessor: (r) => r.connections },
  ]

  return (
    <InfoCard title="Networking" icon={<Network size={16} />} className="lg:col-span-2 xl:col-span-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase text-dim">Interfaces</div>
          {nics.length === 0 && <div className="text-xs text-dim">none</div>}
          {nics.map((nic) => (
            <div key={text(nic.name)} className="mb-1.5 rounded-md border border-line bg-canvas p-1.5 text-xs">
              <div className="mb-0.5 flex justify-between font-semibold">
                <span>{text(nic.name)}</span>
                <Badge tone={nic.is_up ? 'ok' : 'muted'}>{nic.is_up ? 'up' : 'down'}</Badge>
              </div>
              <div className="text-muted">
                {num(nic.speed_mbps)} Mbps · {text(nic.duplex)} · MTU {text(nic.mtu)}
              </div>
              <div className="text-dim">
                errs {text(nic.errors_in, 0)}/{text(nic.errors_out, 0)} · drops {text(nic.drops_in, 0)}/
                {text(nic.drops_out, 0)}
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase text-dim">
            <span>TCP Connections</span>
            <span className="text-text">{totalConns}</span>
          </div>
          {stateEntries
            .sort((a, b) => b[1] - a[1])
            .map(([state, count]) => (
              <div key={state} className="mb-1">
                <div className="mb-0.5 flex justify-between text-[10px]">
                  <span className="text-muted">{state}</span>
                  <span className="font-mono text-text">{count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className={cx(
                      'h-full rounded-full',
                      state === 'ESTABLISHED'
                        ? 'bg-mint'
                        : state === 'TIME_WAIT' || state === 'CLOSE_WAIT'
                          ? 'bg-amber'
                          : 'bg-accent',
                    )}
                    style={{ width: `${(count / maxState) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          {tcp.retrans_rate_pct !== undefined && (
            <Field
              label="Retransmit rate"
              value={`${num(tcp.retrans_rate_pct).toFixed(2)}%`}
              tone={num(tcp.retrans_rate_pct) > 1 ? 'warn' : 'ok'}
            />
          )}
        </div>
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase text-dim">WAN Health</div>
          {wanEntries.length === 0 && <div className="text-xs text-dim">no data</div>}
          {wanEntries.map(([label, w]) => (
            <Field
              key={label}
              label={label.replace('_', ' ')}
              value={`${text(w.avg_rtt_ms, '?')}ms / ${text(w.loss_pct, '?')}% loss`}
              tone={num(w.loss_pct) > 0 ? 'warn' : 'ok'}
            />
          ))}
        </div>
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase text-dim">DNS</div>
          {dnsNameservers.length > 0 ? (
            <div className="mb-1.5 text-[10px] text-muted">
              <span className="text-dim">Nameservers: </span>
              {dnsNameservers.join(', ')}
              {dnsResolver.systemd_resolved_stub ? <span className="text-dim"> (systemd-resolved stub)</span> : null}
            </div>
          ) : (
            <div className="mb-1.5 text-[10px] text-dim">No resolv.conf data</div>
          )}
          {dnsEntries.length === 0 && <div className="text-xs text-dim">no data</div>}
          {dnsEntries.map(([host, d]) => {
            const addrs = asArray(d.addresses).map((a) => text(a))
            return (
              <div key={host} className="mb-1 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-muted">{host}</span>
                  <span className={cx('shrink-0 font-mono font-semibold', d.ok ? 'text-mint' : 'text-rose')}>
                    {d.ok ? `${text(d.ms)}ms` : 'fail'}
                  </span>
                </div>
                {addrs.length > 0 && <div className="truncate text-[10px] text-dim">{addrs.join(', ')}</div>}
              </div>
            )
          })}
        </div>
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase text-dim">TLS Certificates</div>
          {certEntries.length === 0 && <div className="text-xs text-dim">no data</div>}
          {certEntries.map(([host, c]) => (
            <Field
              key={host}
              label={host}
              value={c.ok ? `${text(c.days_remaining)}d left` : 'error'}
              tone={!c.ok ? 'err' : num(c.days_remaining) < 14 ? 'err' : num(c.days_remaining) < 30 ? 'warn' : 'ok'}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase text-dim">Total connections over time</div>
          <MetricChart
            series={[{ metricKey: 'tcp_connections_total', label: 'Connections' }]}
            range={range}
            height={70}
          />
        </div>
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase text-dim">DNS resolution latency</div>
          <MetricChart
            series={[
              { metricKey: 'dns_resolve_ms', label: 'monitor.obby.ca', colorVar: '--color-accent', tags: { host: 'monitor.obby.ca' } },
              { metricKey: 'dns_resolve_ms', label: 'cloudflare.com', colorVar: '--color-info', tags: { host: 'cloudflare.com' } },
            ]}
            range={range}
            height={70}
            unit="ms"
          />
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase text-dim">
          <span>Per-IP bandwidth</span>
          <span className="normal-case text-dim">session totals since last restart</span>
        </div>
        <SortableTable
          rows={ipRows}
          columns={ipColumns}
          defaultSortKey="cumulative_bytes"
          searchAccessor={(r) => r.ip}
          searchPlaceholder="Filter by IP..."
          rowKey={(r) => r.ip}
          maxHeight="360px"
          emptyMessage="No per-IP data (needs conntrack accounting + sudo grant)."
        />
      </div>
    </InfoCard>
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
      <div className="mb-2 flex min-w-0 items-center gap-1.5 text-xs font-black uppercase text-muted">
        {icon}
        <span className="min-w-0 truncate">{title}</span>
      </div>
      {children}
    </Card>
  )
}

function ProcessList({
  title,
  processes,
  mode,
  onClick,
}: {
  title: string
  processes: AnyRecord[]
  mode: 'cpu' | 'ram'
  onClick: () => void
}) {
  return (
    <InfoCard title={title} icon={<Activity size={16} />}>
      <button className="w-full text-left" onClick={onClick}>
        {processes.slice(0, 10).map((proc) => {
          const value = mode === 'cpu' ? num(proc.cpu_pct) : num(proc.mem_mb)
          const max = Math.max(
            ...processes.slice(0, 10).map((item) => (mode === 'cpu' ? num(item.cpu_pct) : num(item.mem_mb))),
            0.1,
          )
          return (
            <div key={`${text(proc.pid)}-${text(proc.name)}`} className="mb-1.5">
              <div className="mb-1 flex min-w-0 items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-bold text-text">{text(proc.name, 'unknown')}</span>
                <span className="shrink-0 font-mono text-accent">
                  {mode === 'cpu' ? `${value.toFixed(1)}%` : `${value.toFixed(1)}M`}
                </span>
                <span className="shrink-0 font-mono text-dim">
                  {mode === 'cpu' ? `${num(proc.mem_mb).toFixed(0)}M` : `${num(proc.mem_pct).toFixed(1)}%`}
                </span>
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
  const { data: latencyStats } = useQuery({
    queryKey: ['service-latency', id],
    queryFn: () => api<AnyRecord>(`/api/metrics/service/${id}?range=1h`),
    refetchInterval: 60000,
    staleTime: 30000,
  })
  return (
    <Card className="group p-3 transition hover:border-accent/40">
      <div className="mb-2 flex min-w-0 items-start gap-2">
        <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-black">{current.name}</h3>
            <Badge tone={tone}>{current.ok === true ? 'UP' : current.ok === false ? 'DOWN' : 'PENDING'}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted">{current.message || 'No status message'}</p>
        </button>
        {webUrl && (
          <Button
            variant="ghost"
            className="min-h-7 px-2 py-1"
            onClick={() => window.open(webUrl, '_blank', 'noopener')}
          >
            Open
          </Button>
        )}
      </div>
      <HistoryBar history={status.history} />
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Metric
          label="Latency"
          value={current.latency_ms != null ? `${current.latency_ms}ms` : '-'}
          tone={tone === 'err' ? 'err' : 'cyan'}
        />
        <Metric label="Version" value={text(version.installed || version.latest, '-')} />
      </div>
      {latencyStats?.p95_ms !== undefined && (
        <div className="mt-1 flex justify-between text-[10px] text-dim">
          <span>
            p50 {num(latencyStats.p50_ms)}ms · p95 {num(latencyStats.p95_ms)}ms · p99 {num(latencyStats.p99_ms)}ms
          </span>
          <span>jitter ±{num(latencyStats.jitter_ms)}ms</span>
        </div>
      )}
      <div className="mt-2 grid gap-0.5">
        {highlights.map(([key, value]) => (
          <Field key={key} label={key} value={String(value)} />
        ))}
      </div>
      {meta.stale === true && (
        <div className="mt-2 text-xs text-amber">Stats stale: {text(meta.error, 'waiting for collector')}</div>
      )}
      <button
        className="mt-2 inline-flex min-h-8 items-center text-xs font-bold text-accent opacity-100 transition sm:min-h-0 sm:opacity-0 sm:group-hover:opacity-100"
        onClick={onOpen}
      >
        Details
      </button>
      <span className="sr-only">{id}</span>
    </Card>
  )
}

function HistoryBar({ history }: { history: Array<boolean | number | null | AnyRecord> }) {
  const recent = history.slice(-60)
  return (
    <div className="flex h-3 gap-0.5">
      {recent.map((item, index) => {
        // /api/status (authenticated) returns full poll-result objects per entry;
        // /api/public (unauth) pre-coerces to plain booleans — accept both shapes.
        const raw = item && typeof item === 'object' ? (item as AnyRecord).ok : item
        const ok = raw === true || raw === 1
        const bad = raw === false || raw === 0
        const ts = item && typeof item === 'object' ? text((item as AnyRecord).timestamp) : undefined
        return (
          <span
            key={index}
            title={ts}
            className={cx('h-full flex-1 rounded-sm', ok && 'bg-mint', bad && 'bg-rose', !ok && !bad && 'bg-panel3')}
          />
        )
      })}
    </div>
  )
}

function pickHighlights(stats: AnyRecord): Array<[string, unknown]> {
  const ignored = new Set(['health_messages', 'now_playing', 'libraries', 'disks', 'gpu', 'cpu', 'ram', 'swap'])
  return Object.entries(stats)
    .filter(
      ([key, value]) => !ignored.has(key) && value != null && ['string', 'number', 'boolean'].includes(typeof value),
    )
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
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        {['overview', 'logs', 'controls'].map((item) => (
          <Button
            key={item}
            className="shrink-0"
            variant={tab === item ? 'default' : 'ghost'}
            onClick={() => setTab(item)}
          >
            {item}
          </Button>
        ))}
        {serviceId === 'aiostreams' && (
          <>
            <Button
              className="shrink-0"
              variant={tab === 'analyzer' ? 'default' : 'ghost'}
              onClick={() => setTab('analyzer')}
            >
              Analyzer
            </Button>
            <Button
              className="shrink-0"
              variant={tab === 'tests' ? 'default' : 'ghost'}
              onClick={() => setTab('tests')}
            >
              Test Suite
            </Button>
          </>
        )}
        {serviceId === 'mediafusion' && (
          <>
            <Button
              className="shrink-0"
              variant={tab === 'metrics' ? 'default' : 'ghost'}
              onClick={() => setTab('metrics')}
            >
              Metrics
            </Button>
            <Button
              className="shrink-0"
              variant={tab === 'scraper' ? 'default' : 'ghost'}
              onClick={() => setTab('scraper')}
            >
              Scraper Analyzer
            </Button>
          </>
        )}
      </div>
      {tab === 'overview' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="p-3">
            <Field
              label="Status"
              value={current.ok === true ? 'Healthy' : current.ok === false ? 'Unhealthy' : 'Pending'}
            />
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
      {tab === 'analyzer' && <AioStreamsAnalyzer />}
      {tab === 'tests' && <AioTestSuite />}
      {tab === 'metrics' && <MediaFusionMetrics />}
      {tab === 'scraper' && <MediaFusionScraperAnalyzer />}
    </Modal>
  )
}

const LOG_TS_RE = /^(\d{4}-\d{2}-\d{2}T[\d:+-]+)\s+(.*)$/
const LOG_CRITICAL_RE = /\b(SIGKILL|FATAL|CRITICAL|ERROR|Failed|Killing process|panic|traceback)\b/i
const LOG_WARNING_RE = /\b(WARN|WARNING|Stopping|timed? ?out|Deactivat|retry|retrying|degraded)\b/i
const LOG_SUCCESS_RE = /\b(Started|Starting|Running|Consumed|successfully|recovered|Listening)\b/i

type ParsedLog = { ts: string | null; message: string; severity: 'critical' | 'warning' | 'success' | 'default' }

function parseLogLine(line: string): ParsedLog {
  const m = LOG_TS_RE.exec(line)
  const ts = m ? m[1] : null
  const message = m ? m[2] : line
  let severity: ParsedLog['severity'] = 'default'
  if (LOG_CRITICAL_RE.test(message)) severity = 'critical'
  else if (LOG_WARNING_RE.test(message)) severity = 'warning'
  else if (LOG_SUCCESS_RE.test(message)) severity = 'success'
  return { ts, message, severity }
}

function highlightMatches(text: string, query: string): ReactNode {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-accent/40 text-text">{text.slice(idx, idx + query.length)}</mark>
      {highlightMatches(text.slice(idx + query.length), query)}
    </>
  )
}

function LogViewer({ unit }: { unit: string }) {
  const [lines, setLines] = useState('200')
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const logs = useQuery({
    queryKey: ['logs', unit, lines],
    queryFn: () => api<{ lines: string[] }>(`/api/logs/${encodeURIComponent(unit)}?n=${lines}`),
    enabled: Boolean(unit),
    refetchInterval: paused ? false : 5000,
  })
  const parsed = (logs.data?.lines || []).map(parseLogLine)
  const filtered = filter ? parsed.filter((l) => l.message.toLowerCase().includes(filter.toLowerCase())) : parsed
  const counts = parsed.reduce(
    (acc, l) => ({ ...acc, [l.severity]: acc[l.severity] + 1 }),
    { critical: 0, warning: 0, success: 0, default: 0 },
  )

  useEffect(() => {
    if (autoScroll && !paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered.length, autoScroll, paused])

  if (!unit) return <div className="text-muted">No systemd unit configured.</div>

  const severityClass: Record<ParsedLog['severity'], string> = {
    critical: 'text-rose',
    warning: 'text-amber',
    success: 'text-mint',
    default: 'text-muted',
  }

  return (
    <div className={cx('space-y-2', fullscreen && 'fixed inset-0 z-50 flex flex-col bg-canvas p-4')}>
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          className="w-full sm:w-auto"
          value={lines}
          onChange={setLines}
          options={[
            { value: '100', label: '100 lines' },
            { value: '200', label: '200 lines' },
            { value: '500', label: '500 lines' },
            { value: '1000', label: '1000 lines' },
          ]}
          ariaLabel="Log line count"
        />
        <Input
          className="w-full sm:w-64"
          placeholder="Filter logs (highlights matches)"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <Button variant="ghost" onClick={() => void logs.refetch()} title="Refresh now">
          <RefreshCw size={16} />
        </Button>
        <Button variant="ghost" onClick={() => setPaused((p) => !p)} title={paused ? 'Resume tailing' : 'Pause tailing'}>
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setAutoScroll((a) => !a)}
          title="Toggle auto-scroll"
          className={autoScroll ? 'text-accent' : undefined}
        >
          Auto-scroll
        </Button>
        <Button
          variant="ghost"
          onClick={() => setWrap((w) => !w)}
          title="Toggle line wrap"
          className={wrap ? 'text-accent' : undefined}
        >
          <WrapText size={16} />
        </Button>
        <Button
          variant="ghost"
          onClick={() => void navigator.clipboard.writeText(filtered.map((l) => l.message).join('\n'))}
          title="Copy visible lines"
        >
          <Copy size={16} />
        </Button>
        <Button variant="ghost" onClick={() => setFullscreen((f) => !f)} title="Toggle fullscreen">
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase text-dim">
        {counts.critical > 0 && <span className="text-rose">{counts.critical} critical</span>}
        {counts.warning > 0 && <span className="text-amber">{counts.warning} warnings</span>}
        {counts.success > 0 && <span className="text-mint">{counts.success} ok</span>}
        <span>{filtered.length} shown</span>
        {paused && <span className="text-amber">paused</span>}
      </div>
      <div
        ref={scrollRef}
        className={cx(
          'max-h-[58dvh] max-w-full flex-1 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-relaxed sm:max-h-[58vh]',
          fullscreen && 'max-h-none',
        )}
      >
        {logs.isLoading ? (
          <span className="text-muted">Loading logs...</span>
        ) : filtered.length === 0 ? (
          <span className="text-muted">No log lines.</span>
        ) : (
          filtered.map((l, i) => (
            <div
              key={i}
              className={cx(
                'flex gap-2 rounded px-1 hover:bg-panel2/60',
                wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
              )}
            >
              {l.ts && <span className="shrink-0 select-none text-dim">{l.ts}</span>}
              <span className={severityClass[l.severity]}>{highlightMatches(l.message, filter)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ServiceControls({
  unit,
  notify,
}: {
  unit: string
  notify: (message: string, kind?: 'ok' | 'warn' | 'err') => void
}) {
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
      <pre className="max-w-full overflow-auto rounded-lg border border-line bg-canvas p-3 text-xs text-muted">
        {output}
      </pre>
    </div>
  )
}

function JsonPanel({ title, data }: { title: string; data: unknown }) {
  return (
    <Card className="p-3">
      <h3 className="mb-2 text-xs font-black uppercase text-muted">{title}</h3>
      <pre className="max-h-[60dvh] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-3 font-mono text-xs text-muted sm:max-h-[60vh]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </Card>
  )
}

function LogsPage({ units }: { units: Bootstrap['log_units'] }) {
  const [unit, setUnit] = useState(units[0]?.unit || '')
  return (
    <Card className="p-3">
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <Terminal className="text-accent" size={16} />
        <h2 className="text-base font-black">Live logs</h2>
      </div>
      <Dropdown
        className="mb-3 w-full md:w-[32rem]"
        value={unit}
        onChange={setUnit}
        options={units.map((item) => ({ value: item.unit, label: `${item.name} - ${item.unit}` }))}
        placeholder="No log units"
        ariaLabel="Log unit"
      />
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
  const visibleEntries = results
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !issuesOnly || item.ok === false)
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
      <div className="mb-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
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
        <Button
          variant="ghost"
          onClick={() =>
            setSelected(new Set(results.map((_, index) => index).filter((index) => results[index].ok === false)))
          }
        >
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
  const scan = asRecord(errors.data?.scan)
  const scanRunning = Boolean(scan.running)
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
    const result = asRecord(await api('/api/errors/scan', { method: 'POST' }))
    await errors.refetch()
    if (result.skipped) {
      notify('Error scan already running', 'warn')
      return
    }
    notify('Error scan started')
  }
  async function clear() {
    await api('/api/errors', { method: 'DELETE' })
    await errors.refetch()
    notify('Error history cleared')
  }
  return (
    <Card className="p-3">
      <div className="mb-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <Dropdown
          className="w-full sm:w-auto"
          value={service}
          onChange={setService}
          options={[{ value: '', label: 'All services' }, ...services.map((item) => ({ value: item, label: item }))]}
          ariaLabel="Error service filter"
        />
        <Dropdown
          className="w-full sm:w-auto"
          value={severity}
          onChange={setSeverity}
          options={[
            { value: '', label: 'All severities' },
            { value: 'error', label: 'Errors' },
            { value: 'warning', label: 'Warnings' },
          ]}
          ariaLabel="Error severity filter"
        />
        <Dropdown
          className="w-full sm:w-auto"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
            { value: 'count', label: 'Count' },
          ]}
          ariaLabel="Error sort"
        />
        <Button onClick={() => void scanNow()} disabled={scanRunning}>
          {scanRunning ? 'Scanning' : 'Scan now'}
        </Button>
        <Button variant="danger" onClick={() => void clear()}>
          Clear
        </Button>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Metric label="Scans" value={text(errors.data?.scan_count, '0')} compact />
        <Metric label="Last new" value={text(scan.last_new, '0')} compact />
        <Metric label="Duration" value={scan.last_duration_ms != null ? `${num(scan.last_duration_ms)}ms` : '-'} compact />
        <Metric label="Targets" value={`${num(scan.checked_units)} checked / ${num(scan.failed_units)} failed`} compact />
        <Metric label="Skipped" value={text(scan.skipped_scan_count, '0')} compact />
      </div>
      {scan.last_error ? <div className="mb-3 rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{text(scan.last_error)}</div> : null}
      <div className="space-y-2">
        {filtered.map((row, index) => (
          <details key={index} className="rounded-md border border-line bg-canvas p-2.5">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <Badge tone={text(row.severity) === 'error' ? 'err' : 'warn'}>{text(row.severity, 'event')}</Badge>
              <span className="font-bold">{text(row.sid || row.service, 'unknown')}</span>
              <span className="text-muted">{text(row.timestamp || row.ts)}</span>
              <span className="min-w-full break-words text-muted sm:min-w-0 sm:flex-1">
                {text(row.line || row.message).slice(0, 140)}
              </span>
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
      const [keyData, urlData] = await Promise.all([
        api<Record<string, AnyRecord>>('/api/settings/keys'),
        api<Record<string, AnyRecord>>('/api/settings/urls'),
      ])
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
    await api('/api/settings/password', {
      method: 'POST',
      body: JSON.stringify({ current: passwords.current, new_password: passwords.next }),
    })
    notify('Password changed')
    setPasswords({ current: '', next: '', confirm: '' })
  }
  if (settings.isLoading) return <Card className="p-3 text-xs text-muted">Loading settings...</Card>
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <EditableRegistry
        title="API keys"
        data={settings.data?.keyData || {}}
        values={keys}
        setValues={setKeys}
        onSave={() => void saveKeys()}
        secret
      />
      <EditableRegistry
        title="Service URLs"
        data={settings.data?.urlData || {}}
        values={urls}
        setValues={setUrls}
        onSave={() => void saveUrls()}
      />
      <Card className="p-3 xl:col-span-2">
        <h2 className="mb-3 text-base font-black">Password</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <Input
            className="w-full"
            type="password"
            placeholder="Current"
            value={passwords.current}
            onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
          />
          <Input
            className="w-full"
            type="password"
            placeholder="New"
            value={passwords.next}
            onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
          />
          <Input
            className="w-full"
            type="password"
            placeholder="Confirm"
            value={passwords.confirm}
            onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
          />
        </div>
        <Button className="mt-3" onClick={() => void changePassword()}>
          Update password
        </Button>
      </Card>
      <AlertHistoryCard />
    </div>
  )
}

function AlertHistoryCard() {
  const { data } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api<{ events: AnyRecord[] }>('/api/alerts?range=24h'),
    refetchInterval: 30000,
  })
  const events = data?.events ?? []
  return (
    <Card className="p-3 xl:col-span-2">
      <h2 className="mb-3 text-base font-black">Alert history (24h)</h2>
      {events.length === 0 && <div className="text-xs text-dim">No alerts fired in the last 24 hours.</div>}
      <div className="space-y-1">
        {events.map((event, i) => (
          <div key={i} className="flex items-center gap-2 border-b border-line/60 py-1 text-xs last:border-b-0">
            <Badge
              tone={event.severity === 'critical' ? 'err' : event.severity === 'warning' ? 'warn' : 'muted'}
            >
              {text(event.severity)}
            </Badge>
            <span className="min-w-0 flex-1 truncate">{text(event.message)}</span>
            <span className="shrink-0 text-dim">{clockTime(event.ts)}</span>
          </div>
        ))}
      </div>
    </Card>
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
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
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
                  <Input
                    className="w-full"
                    type={secret ? 'password' : 'text'}
                    value={values[key] || ''}
                    onChange={(event) => setValues({ ...values, [key]: event.target.value })}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
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
      <div className="mb-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-black">Speed test</h2>
          <p className="text-xs text-muted">Direct and proxied download checks</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex">
          <Dropdown
            className="w-full sm:w-auto"
            value={size}
            onChange={setSize}
            options={['10', '25', '50', '100', '250', '500'].map((value) => ({ value, label: `${value} MB` }))}
            ariaLabel="Speed test size"
          />
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
              <div className="mt-2 break-all text-xs text-muted">
                {result ? `${result.seconds.toFixed(2)}s` : endpoint.url}
              </div>
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
    const data = await api<AnyRecord>(
      `/api/benchmark?imdb=${encodeURIComponent(imdb)}&mode=${encodeURIComponent(mode)}`,
    )
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
      <div className="mb-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <Dropdown
          className="w-full sm:w-80"
          value={imdb}
          onChange={setImdb}
          options={Object.entries(titles).map(([id, title]) => ({ value: id, label: title }))}
          placeholder="Select a title"
          ariaLabel="Benchmark title"
        />
        <Dropdown
          className="w-full sm:w-auto"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'all', label: 'All' },
            { value: 'cached', label: 'Cached' },
            { value: 'uncached', label: 'Uncached' },
          ]}
          ariaLabel="Benchmark mode"
        />
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
            <button
              key={`${method}-${path}`}
              className="flex w-full items-center gap-2 rounded-md border border-line bg-canvas p-2.5 text-left hover:border-accent/40"
              onClick={() => void tryEndpoint(method, path)}
            >
              <Badge tone={method === 'GET' ? 'cyan' : 'warn'}>{method}</Badge>
              <span className="min-w-0 break-all font-mono text-xs text-text">{path}</span>
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
  const nativeUpdates = asArray(nativeData.updates)
    .map(asRecord)
    .map((row) => ({ ...row, repo: 'native', outdated: true }))
  const aurUpdates = asArray(aurData.updates)
    .map(asRecord)
    .map((row) => ({ ...row, repo: 'aur', outdated: true }))
  const summary = [
    { repo: 'native', total: nativeData.total, outdated: nativeData.outdated },
    { repo: 'aur', total: aurData.total, outdated: aurData.outdated },
  ]
  const rows = showAll ? [...summary, ...nativeUpdates, ...aurUpdates] : [...nativeUpdates, ...aurUpdates]
  return (
    <Card className="p-3">
      <div className="mb-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Button onClick={() => void packages.refetch()}>Check now</Button>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          Show all native packages
        </label>
      </div>
      <DataTable
        rows={rows}
        columns={
          showAll
            ? ['repo', 'total', 'outdated', 'name', 'installed', 'available']
            : ['name', 'installed', 'available', 'repo', 'outdated']
        }
      />
    </Card>
  )
}

function ProcessModal({ onClose }: { onClose: () => void }) {
  const processes = useQuery({
    queryKey: ['processes'],
    queryFn: () => api<{ processes: AnyRecord[]; top_memory: AnyRecord[] }>('/api/processes'),
  })
  return (
    <Modal title="Process Monitor" onClose={onClose} wide>
      <div className="space-y-4">
        <Card className="p-3">
          <h3 className="mb-2 text-xs font-black uppercase text-muted">Top CPU processes</h3>
          <DataTable
            rows={processes.data?.processes || []}
            columns={[
              'name',
              'pid',
              'cpu_pct',
              'cpu_total_pct',
              'mem_mb',
              'mem_pct',
              'threads',
              'user',
              'status',
              'cmd',
            ]}
          />
        </Card>
        <Card className="p-3">
          <h3 className="mb-2 text-xs font-black uppercase text-muted">Top RAM processes</h3>
          <DataTable
            rows={processes.data?.top_memory || []}
            columns={['name', 'pid', 'mem_mb', 'mem_pct', 'cpu_pct', 'cpu_total_pct', 'user', 'status', 'cmd']}
          />
        </Card>
      </div>
    </Modal>
  )
}

type ProcessRow = {
  pid: number
  ppid: number | null
  name: string
  bin_name: string
  cmd: string
  user: string
  status: string
  threads: number
  nice: number | null
  open_files: number | null
  uptime_sec: number
  cpu_pct: number
  cpu_total_pct: number
  mem_mb: number
  mem_pct: number
  io_read_bytes_s: number
  io_write_bytes_s: number
  io_read_pct: number | null
  io_write_pct: number | null
  net_rate_bytes_s: number | null
  net_sent_bytes_s: number | null
  net_recv_bytes_s: number | null
  gpu_memory_mb?: number
  gpu_sm_pct?: number
}

const OPTIONAL_PROCESS_COLUMNS = ['ppid', 'nice', 'open_files', 'uptime', 'cpu_total_pct', 'status', 'cmd'] as const
type OptionalProcessColumn = (typeof OPTIONAL_PROCESS_COLUMNS)[number]

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function ProcessExplorerPage() {
  const [refreshMs, setRefreshMs] = useState(5000)
  const [groupByUser, setGroupByUser] = useState(false)
  const [visibleOptional, setVisibleOptional] = useState<Set<OptionalProcessColumn>>(
    () => new Set(['cmd', 'uptime']),
  )
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const query = useQuery({
    queryKey: ['process-explorer'],
    queryFn: () =>
      api<{ processes: ProcessRow[]; gpu_process_count: number; disk_benchmark: AnyRecord }>('/api/processes'),
    refetchInterval: refreshMs,
  })
  const rows = query.data?.processes ?? []
  const hasGpu = rows.some((r) => r.gpu_memory_mb !== undefined)
  const diskBench = asRecord(query.data?.disk_benchmark)

  function toggleOptional(col: OptionalProcessColumn) {
    setVisibleOptional((prev) => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })
  }

  const allColumns: Array<ColumnDef<ProcessRow> & { optional?: OptionalProcessColumn }> = [
    { key: 'pid', label: 'PID', align: 'right', sortAccessor: (r) => r.pid },
    { key: 'ppid', label: 'PPID', align: 'right', sortAccessor: (r) => r.ppid ?? 0, optional: 'ppid' },
    {
      key: 'bin_name',
      label: 'Process',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5" title={r.cmd}>
          <span className="rounded bg-panel3 px-1.5 py-0.5 font-mono text-[11px] font-bold text-accent">
            {r.bin_name}
          </span>
          {r.bin_name !== r.name && <span className="text-dim">({r.name})</span>}
        </span>
      ),
    },
    { key: 'user', label: 'User' },
    { key: 'status', label: 'Status', optional: 'status' },
    {
      key: 'uptime_sec',
      label: 'Uptime',
      align: 'right',
      sortAccessor: (r) => r.uptime_sec,
      render: (r) => <span className="text-muted">{formatUptime(r.uptime_sec)}</span>,
      optional: 'uptime',
    },
    {
      key: 'nice',
      label: 'Nice',
      align: 'right',
      sortAccessor: (r) => r.nice ?? 0,
      render: (r) => text(r.nice, '-'),
      optional: 'nice',
    },
    {
      key: 'open_files',
      label: 'Open files',
      align: 'right',
      sortAccessor: (r) => r.open_files ?? 0,
      render: (r) => text(r.open_files, '-'),
      optional: 'open_files',
    },
    {
      key: 'cpu_pct',
      label: 'CPU %',
      align: 'right',
      sortAccessor: (r) => r.cpu_pct,
      render: (r) => <span className={heatText(r.cpu_pct, { warn: 40, err: 80 })}>{r.cpu_pct.toFixed(1)}%</span>,
    },
    {
      key: 'cpu_total_pct',
      label: 'CPU (sys) %',
      align: 'right',
      sortAccessor: (r) => r.cpu_total_pct,
      render: (r) => <span className="text-muted">{r.cpu_total_pct.toFixed(1)}%</span>,
      optional: 'cpu_total_pct',
    },
    {
      key: 'mem_mb',
      label: 'RAM',
      align: 'right',
      sortAccessor: (r) => r.mem_mb,
      render: (r) => (
        <span className={heatText(r.mem_pct, { warn: 5, err: 15 })}>
          {r.mem_mb.toFixed(0)}M <span className="text-dim">({r.mem_pct.toFixed(1)}%)</span>
        </span>
      ),
    },
    {
      key: 'io_read_bytes_s',
      label: 'IO Read',
      align: 'right',
      sortAccessor: (r) => r.io_read_bytes_s,
      render: (r) => (
        <span className={r.io_read_pct ? heatText(r.io_read_pct, { warn: 30, err: 70 }) : 'text-cyan'}>
          {formatRate(r.io_read_bytes_s)}
          {r.io_read_pct !== null && r.io_read_pct !== undefined && (
            <span className="text-dim"> ({r.io_read_pct.toFixed(0)}%)</span>
          )}
        </span>
      ),
    },
    {
      key: 'io_write_bytes_s',
      label: 'IO Write',
      align: 'right',
      sortAccessor: (r) => r.io_write_bytes_s,
      render: (r) => (
        <span className={r.io_write_pct ? heatText(r.io_write_pct, { warn: 30, err: 70 }) : 'text-amber'}>
          {formatRate(r.io_write_bytes_s)}
          {r.io_write_pct !== null && r.io_write_pct !== undefined && (
            <span className="text-dim"> ({r.io_write_pct.toFixed(0)}%)</span>
          )}
        </span>
      ),
    },
    {
      key: 'net_rate_bytes_s',
      label: 'Network',
      align: 'right',
      sortAccessor: (r) => r.net_rate_bytes_s ?? -1,
      render: (r) =>
        r.net_sent_bytes_s === null || r.net_sent_bytes_s === undefined ? (
          <span className="text-dim">n/a</span>
        ) : (
          <span className="text-mint" title={`sent ${formatBytes(r.net_sent_bytes_s)} · recv ${formatBytes(r.net_recv_bytes_s ?? 0)}`}>
            {formatRate(r.net_rate_bytes_s ?? 0)}
          </span>
        ),
    },
    { key: 'threads', label: 'Threads', align: 'right', sortAccessor: (r) => r.threads },
    {
      key: 'cmd',
      label: 'Command',
      render: (r) => (
        <span className="block max-w-[28rem] truncate text-dim" title={r.cmd}>
          {r.cmd}
        </span>
      ),
      optional: 'cmd',
    },
  ]

  if (hasGpu) {
    const gpuIdx = allColumns.findIndex((c) => c.key === 'threads')
    allColumns.splice(
      gpuIdx,
      0,
      {
        key: 'gpu_memory_mb',
        label: 'GPU Mem',
        align: 'right',
        sortAccessor: (r) => r.gpu_memory_mb ?? 0,
        render: (r) => (r.gpu_memory_mb !== undefined ? <span className="text-accent">{r.gpu_memory_mb}M</span> : '-'),
      },
      {
        key: 'gpu_sm_pct',
        label: 'GPU %',
        align: 'right',
        sortAccessor: (r) => r.gpu_sm_pct ?? 0,
        render: (r) => (r.gpu_sm_pct !== undefined ? <span className="text-accent">{r.gpu_sm_pct}%</span> : '-'),
      },
    )
  }

  const columns = allColumns.filter((c) => !c.optional || visibleOptional.has(c.optional))

  const totalCpu = rows.reduce((sum, r) => sum + r.cpu_total_pct, 0)
  const totalMem = rows.reduce((sum, r) => sum + r.mem_mb, 0)

  const userGroups = useMemo(() => {
    const groups = new Map<string, { count: number; cpu: number; mem: number; net: number }>()
    for (const r of rows) {
      const g = groups.get(r.user) || { count: 0, cpu: 0, mem: 0, net: 0 }
      g.count += 1
      g.cpu += r.cpu_total_pct
      g.mem += r.mem_mb
      g.net += r.net_rate_bytes_s ?? 0
      groups.set(r.user, g)
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].cpu - a[1].cpu)
  }, [rows])

  const [userFilter, setUserFilter] = useState<string | null>(null)
  const visibleRows = userFilter ? rows.filter((r) => r.user === userFilter) : rows

  return (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-4">
        <Metric label="Processes" value={String(rows.length)} />
        <Metric label="Aggregate CPU" value={`${totalCpu.toFixed(0)}%`} />
        <Metric label="Aggregate RAM" value={`${(totalMem / 1024).toFixed(1)} GB`} />
        <Metric
          label="Disk bench (r/w)"
          value={`${formatRate(num(diskBench.read_bytes_s))} / ${formatRate(num(diskBench.write_bytes_s))}`}
        />
      </div>
      <Card className="p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-black uppercase text-muted">Process explorer</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={groupByUser ? 'default' : 'ghost'}
              onClick={() => setGroupByUser((g) => !g)}
              title="Show per-user summary"
            >
              Group by user
            </Button>
            <div className="relative">
              <Button variant="ghost" onClick={() => setShowColumnPicker((s) => !s)}>
                Columns
              </Button>
              {showColumnPicker && (
                <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-line bg-panel2 p-2 shadow-glow">
                  {OPTIONAL_PROCESS_COLUMNS.map((col) => (
                    <label key={col} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-line/40">
                      <input
                        type="checkbox"
                        checked={visibleOptional.has(col)}
                        onChange={() => toggleOptional(col)}
                      />
                      {col.replace(/_/g, ' ')}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <span className="text-[10px] uppercase text-dim">Refresh</span>
            <Dropdown
              value={String(refreshMs)}
              onChange={(v) => setRefreshMs(Number(v))}
              options={[
                { value: '2000', label: '2s' },
                { value: '5000', label: '5s' },
                { value: '10000', label: '10s' },
                { value: '30000', label: '30s' },
              ]}
              ariaLabel="Refresh interval"
            />
            <Button variant="ghost" onClick={() => void query.refetch()}>
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>
        </div>
        {groupByUser && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {userFilter && (
              <button
                onClick={() => setUserFilter(null)}
                className="rounded-full border border-accent bg-accent/15 px-2.5 py-1 text-[10px] font-bold uppercase text-accent"
              >
                Clear filter ✕
              </button>
            )}
            {userGroups.map(([user, g]) => (
              <button
                key={user}
                onClick={() => setUserFilter(user === userFilter ? null : user)}
                className={cx(
                  'rounded-full border px-2.5 py-1 text-[10px] font-semibold',
                  userFilter === user
                    ? 'border-accent bg-accent/20 text-accent'
                    : 'border-line bg-canvas text-muted hover:border-accent/40 hover:text-text',
                )}
              >
                {user} <span className="text-dim">·</span> {g.count}p <span className="text-dim">·</span>{' '}
                {g.cpu.toFixed(0)}% <span className="text-dim">·</span> {(g.mem / 1024).toFixed(1)}G
              </button>
            ))}
          </div>
        )}
        <SortableTable
          rows={visibleRows}
          columns={columns}
          defaultSortKey="cpu_pct"
          searchAccessor={(r) => `${r.name} ${r.cmd} ${r.user} ${r.pid}`}
          searchPlaceholder="Filter by name, command, user, pid..."
          rowKey={(r) => r.pid}
          maxHeight="70vh"
          resizable
          emptyMessage={query.isLoading ? 'Loading processes...' : 'No processes.'}
        />
      </Card>
    </div>
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
  if (!rows.length)
    return <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-muted">No data.</div>
  return (
    <div className="max-w-full">
      <div className="grid gap-2 sm:hidden">
        {rows.map((row, index) => (
          <div key={index} className="rounded-lg border border-line bg-canvas p-2.5 text-xs">
            {selectable && (
              <label className="mb-2 flex items-center gap-2 text-muted">
                <input
                  type="checkbox"
                  checked={selectable.selected.has(index)}
                  onChange={() => selectable.onToggle(index)}
                />
                Select
              </label>
            )}
            <div className="grid gap-1.5">
              {columns.map((column) => (
                <div key={column} className="grid min-w-0 grid-cols-[6.5rem_1fr] gap-2">
                  <span className="truncate font-semibold uppercase text-dim">{column.replace(/_/g, ' ')}</span>
                  <span className="min-w-0 break-words text-muted">{formatCell(row[column])}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-auto rounded-lg border border-line sm:block">
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
                    <input
                      type="checkbox"
                      checked={selectable.selected.has(index)}
                      onChange={() => selectable.onToggle(index)}
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column} className="max-w-[26rem] truncate p-1.5 text-muted" title={text(row[column])}>
                    {formatCell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatCell(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return text(value, '-')
}

export default App
