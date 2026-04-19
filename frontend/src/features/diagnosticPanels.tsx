import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

type AnyRecord = Record<string, unknown>
type Tone = 'ok' | 'warn' | 'err' | 'muted' | 'cyan' | 'accent'

type DropdownOption = {
  value: string
  label: ReactNode
  disabled?: boolean
}

type TableColumn<T> = {
  label: string
  cell: (row: T, index: number) => ReactNode
  className?: string
}

type JellyfinResponse = {
  ok?: boolean
  configured?: boolean
  updated_at?: string
  url?: string
  sessions?: AnyRecord[]
  activity?: AnyRecord[]
  errors?: Record<string, unknown>
}

type AioAnalysis = {
  log_lines?: number
  time_range?: AnyRecord
  summary?: AnyRecord
  addons?: Record<string, AnyRecord>
  errors?: Record<string, number>
  recent_requests?: AnyRecord[]
  pipeline?: AnyRecord[]
  http_requests?: AnyRecord[]
}

type AioTestCase = {
  imdb: string
  type: 'movie' | 'series'
  name: string
}

type AioTestResult = {
  ok?: boolean
  name?: string
  imdb: string
  type: 'movie' | 'series'
  stream_count: number
  streams: AnyRecord[]
  latency_ms: number
  error?: string | null
  raw?: unknown
}

type StreamInfo = {
  source: string
  quality: string
  filename: string
  meta: string
  resolution: string
  size: string
  codec: string
}

const EMPTY_DROPDOWN_VALUE = '__streammonitor_empty__'
const LINE_OPTIONS = ['1000', '2000', '5000', '10000', '25000', '50000']
const MF_LINE_OPTIONS = ['5000', '10000', '25000', '50000', '100000', 'all']

const AIO_MOVIES: AioTestCase[] = [
  { imdb: 'tt0468569', type: 'movie', name: 'The Dark Knight' },
  { imdb: 'tt1375666', type: 'movie', name: 'Inception' },
  { imdb: 'tt15398776', type: 'movie', name: 'Oppenheimer' },
  { imdb: 'tt0111161', type: 'movie', name: 'Shawshank Redemption' },
  { imdb: 'tt0816692', type: 'movie', name: 'Interstellar' },
  { imdb: 'tt10676052', type: 'movie', name: 'Deadpool and Wolverine' },
  { imdb: 'tt6718170', type: 'movie', name: 'The Super Mario Bros. Movie' },
  { imdb: 'tt0118799', type: 'movie', name: 'Life Is Beautiful' },
]

const AIO_SERIES: AioTestCase[] = [
  { imdb: 'tt0903747:3:7', type: 'series', name: 'Breaking Bad S03E07' },
  { imdb: 'tt0944947:1:1', type: 'series', name: 'Game of Thrones S01E01' },
  { imdb: 'tt2861424:2:1', type: 'series', name: 'Rick and Morty S02E01' },
  { imdb: 'tt0388629:1:1', type: 'series', name: 'One Piece S01E01' },
  { imdb: 'tt11280740:1:1', type: 'series', name: 'Severance S01E01' },
  { imdb: 'tt7366338:1:1', type: 'series', name: 'Chernobyl S01E01' },
  { imdb: 'tt0877057:1:1', type: 'series', name: 'Death Note S01E01' },
]

const AIO_TESTS: Record<string, AioTestCase[]> = {
  popular: [AIO_MOVIES[0], AIO_MOVIES[1], AIO_MOVIES[2], AIO_SERIES[0], AIO_SERIES[1]],
  movies: AIO_MOVIES,
  series: AIO_SERIES,
  all: [...AIO_MOVIES, ...AIO_SERIES],
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

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, fallback: unknown = ''): string {
  return value == null || value === '' ? String(fallback) : String(value)
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function pct(value: unknown): string {
  const n = num(value)
  return `${n.toFixed(n % 1 ? 1 : 0)}%`
}

function formatNumber(value: unknown): string {
  return Math.round(num(value)).toLocaleString('en-CA')
}

function seconds(value: unknown): string {
  const n = num(value, Number.NaN)
  return Number.isFinite(n) ? `${n.toFixed(n >= 10 ? 1 : 2)}s` : '-'
}

function milliseconds(value: unknown): string {
  const n = num(value, Number.NaN)
  return Number.isFinite(n) ? `${Math.round(n).toLocaleString('en-CA')}ms` : '-'
}

function mb(value: unknown): string {
  const n = num(value, Number.NaN)
  return Number.isFinite(n) ? `${n.toLocaleString('en-CA')} MB` : '-'
}

function formatDate(value: unknown): string {
  if (!value) return '-'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-CA', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function toneForLatency(ms: number): Tone {
  if (ms > 10_000) return 'err'
  if (ms > 3_000) return 'warn'
  if (ms > 0) return 'ok'
  return 'muted'
}

function toneForSeconds(value: unknown): Tone {
  const n = num(value)
  if (n > 5) return 'err'
  if (n > 2) return 'warn'
  if (n > 0) return 'ok'
  return 'muted'
}

function sortedEntries(record: unknown): Array<[string, AnyRecord]> {
  return Object.entries(asRecord(record)).map(([key, value]) => [key, asRecord(value)])
}

function sortedCountEntries(record: unknown): Array<[string, number]> {
  return Object.entries(asRecord(record))
    .map(([key, value]) => [key, num(value)] as [string, number])
    .sort((a, b) => b[1] - a[1])
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

function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center truncate rounded px-2 py-0.5 text-xs font-bold',
        tone === 'ok' && 'bg-mint/15 text-mint',
        tone === 'warn' && 'bg-amber/15 text-amber',
        tone === 'err' && 'bg-rose/15 text-rose',
        tone === 'cyan' && 'bg-cyan/15 text-cyan',
        tone === 'accent' && 'bg-accent/15 text-accent',
        tone === 'muted' && 'bg-panel3 text-muted',
      )}
    >
      {children}
    </span>
  )
}

function Progress({ value, tone = 'ok' }: { value: number; tone?: Tone }) {
  return (
    <div className="h-1.5 overflow-hidden rounded bg-panel3">
      <div
        className={cx(
          'h-full rounded transition-[width]',
          tone === 'ok' && 'bg-mint',
          tone === 'warn' && 'bg-amber',
          tone === 'err' && 'bg-rose',
          tone === 'cyan' && 'bg-cyan',
          tone === 'accent' && 'bg-accent',
          tone === 'muted' && 'bg-dim',
        )}
        style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
      />
    </div>
  )
}

function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{children}</div>
}

function StatCard({ label, value, tone = 'accent' }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-canvas p-2.5 text-center">
      <div
        className={cx(
          'truncate text-base font-black',
          tone === 'accent' && 'text-accent',
          tone === 'ok' && 'text-mint',
          tone === 'warn' && 'text-amber',
          tone === 'err' && 'text-rose',
          tone === 'cyan' && 'text-cyan',
          tone === 'muted' && 'text-muted',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] font-bold uppercase text-dim">{label}</div>
    </div>
  )
}

function Section({
  title,
  meta,
  children,
  className,
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cx('space-y-2', className)}>
      <div className="flex min-w-0 items-center gap-2 border-b border-line pb-1">
        <h3 className="min-w-0 truncate text-xs font-black uppercase tracking-wide text-rose">{title}</h3>
        {meta && <div className="min-w-0 text-xs text-muted">{meta}</div>}
      </div>
      {children}
    </section>
  )
}

function Toolbar({ children, status }: { children: ReactNode; status?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
      {children}
      {status && <div className="min-w-0 text-xs text-muted sm:ml-auto">{status}</div>}
    </div>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-line bg-canvas p-4 text-center text-xs text-muted">{children}</div>
}

function LoadingState({ children = 'Loading...' }: { children?: ReactNode }) {
  return <EmptyState>{children}</EmptyState>
}

function ErrorState({ title, error }: { title: string; error: ReactNode }) {
  return (
    <div className="rounded-lg border border-rose/35 bg-rose/10 p-3 text-xs text-rose">
      <div className="mb-1 font-black uppercase">{title}</div>
      <div className="break-words">{error}</div>
    </div>
  )
}

function RawTextPanel({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Card className="p-3">
      <div className="mb-2 text-xs font-black uppercase text-muted">{title}</div>
      <pre className="max-h-[56dvh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-5 text-muted">
        {lines.length ? lines.join('\n') : 'No log lines returned.'}
      </pre>
    </Card>
  )
}

function JsonPanel({ title, data }: { title: string; data: unknown }) {
  return (
    <details className="rounded-lg border border-line bg-canvas p-3 text-xs text-muted">
      <summary className="cursor-pointer font-black uppercase text-muted">{title}</summary>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  )
}

function ResponsiveTable<T>({
  rows,
  columns,
  empty,
}: {
  rows: T[]
  columns: Array<TableColumn<T>>
  empty?: ReactNode
}) {
  if (!rows.length) return <EmptyState>{empty || 'No data.'}</EmptyState>
  return (
    <div className="max-w-full">
      <div className="grid gap-2 md:hidden">
        {rows.map((row, index) => (
          <div key={index} className="min-w-0 rounded-lg border border-line bg-canvas p-2.5 text-xs">
            <div className="grid gap-1.5">
              {columns.map((column) => (
                <div key={column.label} className="grid min-w-0 grid-cols-[6.5rem_1fr] gap-2">
                  <span className="truncate font-semibold uppercase text-dim">{column.label}</span>
                  <span className="min-w-0 break-words text-muted">{column.cell(row, index)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-auto rounded-lg border border-line md:block">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-panel2 uppercase text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.label} className={cx('p-1.5 text-left', column.className)}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-line bg-canvas/60">
                {columns.map((column) => (
                  <td key={column.label} className={cx('max-w-[28rem] p-1.5 align-top text-muted', column.className)}>
                    {column.cell(row, index)}
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

function BarRow({
  label,
  value,
  max,
  tone = 'ok',
  detail,
}: {
  label: string
  value: number
  max: number
  tone?: Tone
  detail?: ReactNode
}) {
  const width = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="grid min-w-0 grid-cols-[minmax(5.5rem,10rem)_1fr_auto] items-center gap-2 text-xs">
      <div className="min-w-0 truncate text-right font-semibold text-muted" title={label}>
        {label}
      </div>
      <Progress value={width} tone={tone} />
      <div className="min-w-12 text-right font-mono text-muted">{detail || value}</div>
    </div>
  )
}

function rawLineOptions(values: string[]) {
  return values.map((value) => ({
    value,
    label: value === 'all' ? 'All logs' : `${Number(value).toLocaleString('en-CA')} lines`,
  }))
}

export function JellyfinPage() {
  const jellyfin = useQuery({
    queryKey: ['jellyfin'],
    queryFn: () => api<JellyfinResponse>('/api/jellyfin'),
    refetchInterval: 30000,
  })

  if (jellyfin.isLoading) return <LoadingState>Loading Jellyfin...</LoadingState>
  if (jellyfin.error) return <ErrorState title="Jellyfin failed" error={jellyfin.error.message} />

  const data = jellyfin.data || {}
  const sessions = asArray(data.sessions).map(asRecord)
  const activity = asArray(data.activity).map(asRecord)
  const playing = sessions.filter((session) => asRecord(session.NowPlayingItem).Name)
  const transcoding = sessions.filter((session) => playbackMode(session) === 'Transcoding')
  const direct = playing.length - transcoding.length
  const errors = asRecord(data.errors)

  return (
    <div className="space-y-3">
      <Toolbar status={data.updated_at ? `Updated ${formatDate(data.updated_at)}` : undefined}>
        <Button onClick={() => void jellyfin.refetch()} disabled={jellyfin.isFetching}>
          {jellyfin.isFetching ? 'Refreshing...' : 'Refresh'}
        </Button>
        <Badge tone={data.ok ? 'ok' : data.configured === false ? 'warn' : 'err'}>
          {data.ok ? 'Connected' : 'Needs attention'}
        </Badge>
      </Toolbar>

      {!data.ok && (
        <ErrorState
          title="Jellyfin status"
          error={
            <div className="space-y-1">
              {Object.entries(errors).length ? (
                Object.entries(errors).map(([key, value]) => (
                  <div key={key}>
                    <span className="font-bold">{key}: </span>
                    {text(asRecord(value).message || value)}
                  </div>
                ))
              ) : (
                <div>Jellyfin did not return a healthy status.</div>
              )}
            </div>
          }
        />
      )}

      <StatGrid>
        <StatCard label="Sessions" value={sessions.length} tone={sessions.length ? 'ok' : 'muted'} />
        <StatCard label="Playing" value={playing.length} tone={playing.length ? 'ok' : 'muted'} />
        <StatCard label="Direct" value={Math.max(direct, 0)} tone={direct ? 'cyan' : 'muted'} />
        <StatCard label="Transcodes" value={transcoding.length} tone={transcoding.length ? 'warn' : 'muted'} />
        <StatCard label="Activity" value={activity.length} tone={activity.length ? 'accent' : 'muted'} />
        <StatCard
          label="Configured"
          value={data.configured === false ? 'No' : 'Yes'}
          tone={data.configured === false ? 'warn' : 'ok'}
        />
      </StatGrid>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
        <Card className="p-3">
          <Section title={`Active sessions (${sessions.length})`}>
            {sessions.length ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {sessions.map((session, index) => (
                  <JellyfinSessionCard key={`${text(session.Id, index)}-${index}`} session={session} />
                ))}
              </div>
            ) : (
              <EmptyState>No active Jellyfin sessions.</EmptyState>
            )}
          </Section>
        </Card>
        <Card className="p-3">
          <Section title={`Recent activity (${activity.length})`}>
            {activity.length ? (
              <JellyfinActivityList activity={activity.slice(0, 40)} />
            ) : (
              <EmptyState>No recent activity.</EmptyState>
            )}
          </Section>
        </Card>
      </div>
    </div>
  )
}

function JellyfinSessionCard({ session }: { session: AnyRecord }) {
  const item = asRecord(session.NowPlayingItem)
  const playState = asRecord(session.PlayState)
  const title = text(item.Name, 'Idle')
  const series = text(item.SeriesName || item.Album || item.ProductionYear, '')
  const progress = progressPercent(session)
  const mode = playbackMode(session)
  const paused = playState.IsPaused === true
  return (
    <div className="min-w-0 rounded-lg border border-line bg-canvas p-3 text-xs">
      <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-black text-text">{text(session.UserName, 'Unknown user')}</div>
          <div className="truncate text-muted">
            {text(session.Client, 'Unknown client')} / {text(session.DeviceName, 'Unknown device')}
          </div>
        </div>
        <Badge tone={item.Name ? (paused ? 'warn' : 'ok') : 'muted'}>
          {item.Name ? (paused ? 'Paused' : 'Playing') : 'Idle'}
        </Badge>
      </div>
      <div className="min-w-0">
        <div className={cx('truncate font-semibold', item.Name ? 'text-mint' : 'text-muted')}>{title}</div>
        {series && <div className="truncate text-muted">{series}</div>}
      </div>
      {Boolean(item.Name) && (
        <div className="mt-2 space-y-1">
          <Progress value={progress} tone={mode === 'Transcoding' ? 'warn' : 'ok'} />
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <Badge tone={mode === 'Transcoding' ? 'warn' : 'cyan'}>{mode}</Badge>
            {Boolean(session.RemoteEndPoint) && <Badge>{text(session.RemoteEndPoint)}</Badge>}
            {Boolean(item.MediaType) && <Badge tone="accent">{text(item.MediaType)}</Badge>}
          </div>
        </div>
      )}
    </div>
  )
}

function JellyfinActivityList({ activity }: { activity: AnyRecord[] }) {
  return (
    <div className="grid gap-1.5">
      {activity.map((entry, index) => {
        const severity = text(entry.Severity, 'Info')
        const tone: Tone = severity === 'Error' ? 'err' : severity === 'Warning' ? 'warn' : 'muted'
        return (
          <div
            key={`${text(entry.Id, index)}-${index}`}
            className="grid min-w-0 gap-1 rounded-md border border-line bg-canvas p-2 text-xs sm:grid-cols-[6rem_1fr]"
          >
            <div className="font-mono text-[11px] text-dim">{formatDate(entry.Date)}</div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone={tone}>{severity}</Badge>
                <span className="min-w-0 truncate font-semibold text-text">
                  {text(entry.Name || entry.Type, 'Activity')}
                </span>
              </div>
              {Boolean(entry.ShortOverview) && (
                <div className="mt-1 break-words text-muted">{text(entry.ShortOverview)}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function playbackMode(session: AnyRecord): string {
  const transcoding = asRecord(session.TranscodingInfo)
  const playState = asRecord(session.PlayState)
  if (Object.keys(transcoding).length || text(playState.PlayMethod).toLowerCase().includes('transcode'))
    return 'Transcoding'
  if (text(playState.PlayMethod)) return text(playState.PlayMethod)
  return asRecord(session.NowPlayingItem).Name ? 'Direct' : 'Idle'
}

function progressPercent(session: AnyRecord): number {
  const item = asRecord(session.NowPlayingItem)
  const playState = asRecord(session.PlayState)
  const runtime = num(item.RunTimeTicks)
  const position = num(playState.PositionTicks)
  return runtime > 0 ? (position / runtime) * 100 : 0
}

export function AioStreamsAnalyzer() {
  const [lines, setLines] = useState('5000')
  const [mode, setMode] = useState<'analysis' | 'raw'>('analysis')
  const analysis = useQuery({
    queryKey: ['aiostreams-analysis', lines],
    queryFn: () => api<AioAnalysis>(`/api/aiostreams/analyze?n=${encodeURIComponent(lines)}`),
    enabled: mode === 'analysis',
    refetchInterval: mode === 'analysis' ? 30000 : false,
  })
  const raw = useQuery({
    queryKey: ['aiostreams-raw', lines],
    queryFn: () => api<{ lines: string[] }>(`/api/logs/aiostreams?n=${encodeURIComponent(lines)}`),
    enabled: mode === 'raw',
  })
  const status =
    mode === 'analysis' && analysis.data
      ? `${formatNumber(analysis.data.log_lines)} lines - updated ${new Date().toLocaleTimeString('en-CA', { hour12: false })}`
      : mode === 'raw' && raw.data
        ? `${raw.data.lines.length} raw lines`
        : undefined

  return (
    <div className="space-y-3">
      <Toolbar status={status}>
        <Dropdown
          className="w-full sm:w-44"
          value={lines}
          onChange={setLines}
          options={rawLineOptions(LINE_OPTIONS)}
          ariaLabel="AIOStreams analyzer line count"
        />
        <Button
          onClick={() => {
            setMode('analysis')
            void analysis.refetch()
          }}
          disabled={analysis.isFetching}
        >
          {analysis.isFetching ? 'Analyzing...' : 'Analyze'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setMode('raw')
            void raw.refetch()
          }}
          disabled={raw.isFetching}
        >
          Raw logs
        </Button>
      </Toolbar>
      {mode === 'raw' ? (
        raw.error ? (
          <ErrorState title="Raw logs failed" error={raw.error.message} />
        ) : raw.isLoading || raw.isFetching ? (
          <LoadingState>Loading raw logs...</LoadingState>
        ) : (
          <RawTextPanel title="AIOStreams raw logs" lines={raw.data?.lines || []} />
        )
      ) : analysis.error ? (
        <ErrorState title="Analyzer failed" error={analysis.error.message} />
      ) : analysis.isLoading ? (
        <LoadingState>Analyzing logs...</LoadingState>
      ) : analysis.data ? (
        <AioAnalysisView data={analysis.data} />
      ) : (
        <EmptyState>No analyzer data loaded.</EmptyState>
      )}
    </div>
  )
}

function AioAnalysisView({ data }: { data: AioAnalysis }) {
  const summary = asRecord(data.summary)
  const addons = sortedEntries(data.addons).sort((a, b) => num(b[1].total_streams) - num(a[1].total_streams))
  const errors = sortedCountEntries(data.errors)
  const requests = asArray(data.recent_requests).map(asRecord).reverse()
  const httpRequests = asArray(data.http_requests).map(asRecord).reverse()
  const pipeline = asArray(data.pipeline).map(asRecord)
  const maxAddonTime = Math.max(...addons.map(([, addon]) => num(addon.avg_time_s)), 0.1)
  const pipelineRows = summarizePipeline(pipeline)

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Requests" value={formatNumber(summary.total_requests)} />
        <StatCard
          label="Avg response"
          value={seconds(summary.avg_response_time_s)}
          tone={toneForSeconds(summary.avg_response_time_s)}
        />
        <StatCard label="Avg streams" value={num(summary.avg_streams).toFixed(1)} tone="cyan" />
        <StatCard label="Fastest" value={seconds(summary.fastest_s)} tone="ok" />
        <StatCard label="Slowest" value={seconds(summary.slowest_s)} tone={toneForSeconds(summary.slowest_s)} />
        <StatCard
          label="Addon errors"
          value={formatNumber(summary.total_addon_errors)}
          tone={num(summary.total_addon_errors) ? 'err' : 'ok'}
        />
      </StatGrid>

      {addons.length ? (
        <Section title="Addon performance">
          <ResponsiveTable
            rows={addons}
            columns={[
              { label: 'Addon', cell: ([name]) => <span className="font-semibold text-text">{name}</span> },
              { label: 'Calls', cell: ([, addon]) => formatNumber(addon.calls) },
              {
                label: 'Success',
                cell: ([, addon]) => `${formatNumber(addon.successes)} / ${formatNumber(addon.calls)}`,
              },
              {
                label: 'Rate',
                cell: ([, addon]) => {
                  const rate = num(addon.success_rate, num(addon.calls) ? num(addon.successes) / num(addon.calls) : 0)
                  return (
                    <div className="min-w-28">
                      <Progress value={rate * 100} tone={rate >= 0.9 ? 'ok' : rate >= 0.5 ? 'warn' : 'err'} />
                      <div className="mt-1 font-mono text-[11px]">{pct(rate * 100)}</div>
                    </div>
                  )
                },
              },
              { label: 'Avg', cell: ([, addon]) => seconds(addon.avg_time_s) },
              { label: 'Min', cell: ([, addon]) => seconds(addon.min_time_s) },
              {
                label: 'Max',
                cell: ([, addon]) => (
                  <span className={cx(toneClass(toneForSeconds(addon.max_time_s)))}>{seconds(addon.max_time_s)}</span>
                ),
              },
              { label: 'Avg streams', cell: ([, addon]) => num(addon.avg_streams).toFixed(1) },
              {
                label: 'Total streams',
                cell: ([, addon]) => <span className="font-bold text-accent">{formatNumber(addon.total_streams)}</span>,
              },
            ]}
          />
        </Section>
      ) : null}

      {addons.length ? (
        <Section title="Response time by addon">
          <div className="grid gap-2">
            {addons.map(([name, addon]) => (
              <BarRow
                key={name}
                label={name}
                value={num(addon.avg_time_s)}
                max={maxAddonTime}
                tone={toneForSeconds(addon.avg_time_s)}
                detail={
                  <span>
                    {seconds(addon.avg_time_s)}
                    {num(addon.failures) > 0 && (
                      <span className="ml-2 text-rose">{formatNumber(addon.failures)} fail</span>
                    )}
                  </span>
                }
              />
            ))}
          </div>
        </Section>
      ) : null}

      {errors.length ? (
        <Section title="Error breakdown">
          <div className="grid gap-1.5">
            {errors.slice(0, 30).map(([message, count]) => (
              <div
                key={message}
                className="grid min-w-0 grid-cols-[3rem_1fr] gap-2 rounded-md border border-line bg-canvas p-2 text-xs"
              >
                <span className="font-black text-rose">{count}x</span>
                <span className="break-words text-muted">{message}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {requests.length ? (
        <Section title="Recent stream requests" meta="newest first">
          <div className="grid gap-2">
            {requests.slice(0, 50).map((request, index) => (
              <AioRequestCard key={`${text(request.content_id)}-${index}`} request={request} />
            ))}
          </div>
        </Section>
      ) : null}

      {httpRequests.length ? (
        <Section title="HTTP requests" meta={`last ${httpRequests.length}`}>
          <ResponsiveTable
            rows={httpRequests.slice(0, 50)}
            columns={[
              { label: 'Method', cell: (row) => <span className="font-bold text-accent">{text(row.method)}</span> },
              { label: 'Path', cell: (row) => <span className="font-mono text-[11px]">{text(row.path)}</span> },
              {
                label: 'Status',
                cell: (row) => (
                  <Badge tone={num(row.status_code) < 300 ? 'ok' : num(row.status_code) < 400 ? 'warn' : 'err'}>
                    {text(row.status_code)}
                  </Badge>
                ),
              },
              {
                label: 'Latency',
                cell: (row) => (
                  <span className={toneClass(toneForLatency(num(row.latency_ms)))}>{milliseconds(row.latency_ms)}</span>
                ),
              },
            ]}
          />
        </Section>
      ) : null}

      {pipelineRows.length ? (
        <Section title="Pipeline steps">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {pipelineRows.map((row) => (
              <div key={row.stage} className="rounded-lg border border-line bg-canvas p-2.5 text-xs">
                <div className="font-black text-accent">{row.stage}</div>
                <div className="mt-1 text-muted">
                  avg {(row.avgTime * 1000).toFixed(1)}ms - {formatNumber(row.avgCount)} items - {row.runs} runs
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {!addons.length && !requests.length && !httpRequests.length && (
        <EmptyState>
          No AIOStreams activity found in {formatNumber(data.log_lines)} log lines. Increase the line count or verify
          the service is logging stream requests.
        </EmptyState>
      )}
      <LogRange range={data.time_range} />
      <JsonPanel title="Raw analyzer payload" data={data} />
    </div>
  )
}

function AioRequestCard({ request }: { request: AnyRecord }) {
  const addons = asArray(request.addons).map(asRecord)
  return (
    <details className="rounded-lg border border-line bg-canvas p-2.5 text-xs">
      <summary className="cursor-pointer list-none">
        <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(9rem,1fr)_5rem_5rem_5rem_minmax(9rem,1fr)] md:items-center">
          <span className="min-w-0 break-all font-mono text-accent">{text(request.content_id, '-')}</span>
          <Badge tone="accent">{text(request.type, '-')}</Badge>
          <span className="font-black text-accent">{formatNumber(request.total_streams)}</span>
          <span className={toneClass(toneForSeconds(request.duration_s))}>{seconds(request.duration_s)}</span>
          <span className={cx('min-w-0 truncate', num(request.total_errors) ? 'text-rose' : 'text-muted')}>
            {formatNumber(request.total_errors)} errors - {addons.length} addons
          </span>
        </div>
      </summary>
      {addons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
          {addons.map((addon, index) => {
            const ok = text(addon.status) === 'success'
            return (
              <div
                key={`${text(addon.name)}-${index}`}
                className={cx(
                  'rounded-md border px-2 py-1',
                  ok ? 'border-mint/35 bg-mint/10' : 'border-rose/35 bg-rose/10',
                )}
              >
                <span className={cx('font-bold', ok ? 'text-mint' : 'text-rose')}>{text(addon.name)}</span>
                <span className="ml-2 text-muted">{formatNumber(addon.streams)} streams</span>
                <span className="ml-2 text-muted">{seconds(addon.time_s)}</span>
                {Boolean(addon.error) && <div className="mt-1 break-words text-rose">{text(addon.error)}</div>}
              </div>
            )
          })}
        </div>
      )}
    </details>
  )
}

function summarizePipeline(pipeline: AnyRecord[]) {
  const grouped = new Map<string, { stage: string; times: number[]; counts: number[] }>()
  for (const step of pipeline) {
    const stage = text(step.stage, 'unknown')
    const current = grouped.get(stage) || { stage, times: [], counts: [] }
    current.times.push(num(step.time_s))
    current.counts.push(num(step.count))
    grouped.set(stage, current)
  }
  return Array.from(grouped.values()).map((item) => ({
    stage: item.stage,
    runs: item.times.length,
    avgTime: item.times.reduce((sum, value) => sum + value, 0) / Math.max(item.times.length, 1),
    avgCount: item.counts.reduce((sum, value) => sum + value, 0) / Math.max(item.counts.length, 1),
  }))
}

export function AioTestSuite() {
  const [imdb, setImdb] = useState('tt0468569')
  const [type, setType] = useState<'movie' | 'series'>('movie')
  const [results, setResults] = useState<AioTestResult[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')

  async function runOne(test?: AioTestCase, append = true): Promise<AioTestResult> {
    const target = test || { imdb, type, name: imdb }
    const result = await runAioLookup(target)
    if (append) setResults((current) => [result, ...current])
    return result
  }

  async function runSuite(name: string) {
    const tests = AIO_TESTS[name] || AIO_TESTS.popular
    setRunning(true)
    setResults([])
    const next: AioTestResult[] = []
    for (let index = 0; index < tests.length; index += 1) {
      const test = tests[index]
      setProgress(`[${index + 1}/${tests.length}] ${test.name}`)
      const result = await runOne(test, false)
      next.unshift(result)
      setResults([...next])
      if (index < tests.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 250))
    }
    setProgress(`Suite complete - ${tests.length} titles tested`)
    setRunning(false)
  }

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Dropdown
              className="w-full sm:w-36"
              value={type}
              onChange={(value) => setType(value === 'series' ? 'series' : 'movie')}
              options={[
                { value: 'movie', label: 'Movie' },
                { value: 'series', label: 'Series' },
              ]}
              ariaLabel="AIOStreams test type"
            />
            <Input
              className="w-full sm:w-80"
              value={imdb}
              onChange={(event) => setImdb(event.target.value)}
              placeholder="tt0468569 or tt0903747:3:7"
            />
            <Button
              onClick={() => {
                setRunning(true)
                setProgress(`Testing ${imdb}`)
                void runOne().finally(() => {
                  setRunning(false)
                  setProgress('')
                })
              }}
              disabled={running || !imdb.trim()}
            >
              {running ? 'Running...' : 'Run test'}
            </Button>
          </div>

          <div className="grid gap-2">
            <div className="flex flex-wrap gap-1.5">
              {AIO_MOVIES.map((item) => (
                <button
                  key={item.imdb}
                  className="min-h-8 rounded border border-line bg-canvas px-2 py-1 text-xs font-semibold text-muted hover:border-accent/45 hover:text-text"
                  onClick={() => {
                    setImdb(item.imdb)
                    setType(item.type)
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {AIO_SERIES.map((item) => (
                <button
                  key={item.imdb}
                  className="min-h-8 rounded border border-line bg-canvas px-2 py-1 text-xs font-semibold text-muted hover:border-accent/45 hover:text-text"
                  onClick={() => {
                    setImdb(item.imdb)
                    setType(item.type)
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {Object.keys(AIO_TESTS).map((name) => (
              <Button key={name} variant="ghost" onClick={() => void runSuite(name)} disabled={running}>
                Run {name}
              </Button>
            ))}
          </div>
          {progress && <div className="text-xs text-muted">{progress}</div>}
        </div>
      </Card>

      {results.length > 0 && <AioTestSummary results={results} />}
      <div className="grid gap-3">
        {results.map((result, index) => (
          <AioTestResultCard key={`${result.imdb}-${index}`} result={result} />
        ))}
      </div>
    </div>
  )
}

async function runAioLookup(target: AioTestCase): Promise<AioTestResult> {
  const started = performance.now()
  try {
    const data = await api<AnyRecord>('/api/aiostreams/test', {
      method: 'POST',
      body: JSON.stringify({ imdb: target.imdb, type: target.type }),
    })
    const streams = asArray(data.streams).map(asRecord)
    return {
      ok: data.ok !== false,
      name: target.name,
      imdb: target.imdb,
      type: target.type,
      stream_count: num(data.stream_count, streams.length),
      streams,
      latency_ms: num(data.latency_ms, performance.now() - started),
      error: text(data.error, '') || null,
      raw: data,
    }
  } catch (error) {
    return {
      ok: false,
      name: target.name,
      imdb: target.imdb,
      type: target.type,
      stream_count: 0,
      streams: [],
      latency_ms: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function AioTestSummary({ results }: { results: AioTestResult[] }) {
  const total = results.length
  const withStreams = results.filter((result) => result.stream_count > 0).length
  const totalStreams = results.reduce((sum, result) => sum + result.stream_count, 0)
  const errors = results.filter((result) => result.error).length
  const latencies = results.map((result) => result.latency_ms)
  return (
    <StatGrid>
      <StatCard label="Titles tested" value={total} />
      <StatCard label="With streams" value={`${withStreams} / ${total}`} tone={withStreams === total ? 'ok' : 'warn'} />
      <StatCard label="Total streams" value={totalStreams} tone="cyan" />
      <StatCard label="Avg streams" value={(totalStreams / Math.max(total, 1)).toFixed(1)} />
      <StatCard
        label="Avg latency"
        value={milliseconds(latencies.reduce((sum, value) => sum + value, 0) / Math.max(total, 1))}
        tone={toneForLatency(latencies.reduce((sum, value) => sum + value, 0) / Math.max(total, 1))}
      />
      <StatCard label="Errors" value={errors} tone={errors ? 'err' : 'ok'} />
    </StatGrid>
  )
}

function AioTestResultCard({ result }: { result: AioTestResult }) {
  const streamInfos = result.streams.map(parseStreamInfo)
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-2 border-b border-line bg-panel2 p-3 text-xs md:grid-cols-[1fr_auto_auto_auto] md:items-center">
        <div className="min-w-0">
          <div className="truncate font-black text-text">{result.name || result.imdb}</div>
          <div className="font-mono text-[11px] text-accent">{result.imdb}</div>
        </div>
        <Badge tone="accent">{result.type}</Badge>
        <Badge tone={result.stream_count > 0 ? 'ok' : 'err'}>{result.stream_count} streams</Badge>
        <Badge tone={toneForLatency(result.latency_ms)}>{milliseconds(result.latency_ms)}</Badge>
      </div>
      {result.error && <div className="border-b border-line bg-rose/10 p-3 text-xs text-rose">{result.error}</div>}
      {streamInfos.length ? (
        <div className="p-3">
          <ResponsiveTable
            rows={streamInfos.slice(0, 50)}
            columns={[
              { label: 'Source', cell: (row) => <span className="font-semibold text-text">{row.source}</span> },
              {
                label: 'Quality',
                cell: (row) => (
                  <span className="flex flex-wrap gap-1">
                    {row.resolution && (
                      <Badge tone={row.resolution.includes('4') || row.resolution.includes('2160') ? 'accent' : 'cyan'}>
                        {row.resolution}
                      </Badge>
                    )}
                    {row.codec && <Badge>{row.codec}</Badge>}
                    <span>{row.quality || '-'}</span>
                  </span>
                ),
              },
              {
                label: 'File',
                cell: (row) => <span className="font-mono text-[11px]">{row.filename || row.meta || '-'}</span>,
              },
              { label: 'Size', cell: (row) => <span className="font-bold text-accent">{row.size || '-'}</span> },
            ]}
          />
          {result.streams.length > 50 && (
            <div className="mt-2 text-center text-xs text-muted">and {result.streams.length - 50} more streams</div>
          )}
          <div className="mt-3">
            <JsonPanel title="Raw test payload" data={result.raw || result} />
          </div>
        </div>
      ) : (
        <div className="p-3 text-xs text-muted">
          {result.error ? 'No streams returned because the test failed.' : 'No streams returned.'}
        </div>
      )}
    </Card>
  )
}

function parseStreamInfo(stream: AnyRecord): StreamInfo {
  const name = text(stream.name)
  const title = text(stream.title || stream.description)
  const nameParts = name
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
  const titleParts = title
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
  const combined = `${name} ${title}`
  const resMatch = combined.match(/\b(4[kK]|2160p|1080p|720p|480p|360p)\b/)
  const sizeMatch = combined.match(/\b([\d.]+\s*[KMGT]B)\b/i)
  const codecMatch = combined.match(/\b(x264|x265|HEVC|AVC|H\.?264|H\.?265|VP9|AV1|XviD)\b/i)
  return {
    source: nameParts[0] || 'Unknown',
    quality: nameParts.slice(1).join(' '),
    filename: titleParts[0] || '',
    meta: titleParts.slice(1).join(' '),
    resolution: resMatch ? resMatch[1].replace('4k', '4K') : '',
    size: sizeMatch ? sizeMatch[1] : '',
    codec: codecMatch ? codecMatch[1].toUpperCase() : '',
  }
}

export function MediaFusionMetrics() {
  const metrics = useQuery({
    queryKey: ['mediafusion-metrics'],
    queryFn: () => api<AnyRecord>('/api/mediafusion/metrics'),
    refetchInterval: 60000,
  })
  return (
    <div className="space-y-3">
      <Toolbar
        status={metrics.data ? `Updated ${new Date().toLocaleTimeString('en-CA', { hour12: false })}` : undefined}
      >
        <Button onClick={() => void metrics.refetch()} disabled={metrics.isFetching}>
          {metrics.isFetching ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Toolbar>
      {metrics.error ? (
        <ErrorState title="MediaFusion metrics failed" error={metrics.error.message} />
      ) : metrics.isLoading ? (
        <LoadingState>Loading MediaFusion metrics...</LoadingState>
      ) : metrics.data ? (
        <MediaFusionMetricsView data={metrics.data} />
      ) : (
        <EmptyState>No MediaFusion metrics loaded.</EmptyState>
      )}
    </div>
  )
}

function MediaFusionMetricsView({ data }: { data: AnyRecord }) {
  const overview = asRecord(data.overview)
  const streams = asRecord(overview.streams)
  const content = asRecord(overview.content)
  const moderation = asRecord(overview.moderation)
  const users = asRecord(data.users)
  const activity = asRecord(data.activity)
  const contributions = asRecord(data.contributions)
  const sourceHealth = asArray(data.source_health).map(asRecord)
  const requestEndpoints = asArray(data.request_endpoints).map(asRecord)
  const jobs = asArray(data.scheduler_jobs).map(asRecord)

  return (
    <div className="space-y-4">
      <Section title="System overview">
        <StatGrid>
          <StatCard label="Total streams" value={formatNumber(streams.total)} />
          <StatCard label="Total content" value={formatNumber(content.total)} />
          <StatCard label="Movies" value={formatNumber(content.movies)} tone="cyan" />
          <StatCard label="Series" value={formatNumber(content.series)} tone="ok" />
          <StatCard label="TV channels" value={formatNumber(content.tv_channels)} tone="accent" />
          <StatCard
            label="Pending mod"
            value={formatNumber(moderation.pending_contributions)}
            tone={num(moderation.pending_contributions) ? 'warn' : 'ok'}
          />
        </StatGrid>
      </Section>

      <CountBars title="Streams by type" data={streams.by_type} />

      {Object.keys(users).length > 0 && (
        <Section title="Users">
          <StatGrid>
            <StatCard label="Total users" value={formatNumber(users.total_users)} />
            <StatCard label="Active today" value={formatNumber(asRecord(users.active_users).daily)} tone="ok" />
            <StatCard label="Active week" value={formatNumber(asRecord(users.active_users).weekly)} tone="cyan" />
            <StatCard label="Active month" value={formatNumber(asRecord(users.active_users).monthly)} />
            <StatCard label="New this week" value={formatNumber(users.new_users_this_week)} tone="accent" />
            <StatCard label="Profiles" value={formatNumber(users.total_profiles)} />
          </StatGrid>
          <ChipCounts data={users.users_by_role} />
        </Section>
      )}

      {Object.keys(activity).length > 0 && (
        <Section title="Activity">
          <StatGrid>
            <StatCard label="Watch history" value={formatNumber(asRecord(activity.watch_history).total)} />
            <StatCard label="Recent watches" value={formatNumber(asRecord(activity.watch_history).recent)} tone="ok" />
            <StatCard label="Watchers" value={formatNumber(asRecord(activity.watch_history).unique_users)} />
            <StatCard label="Downloads" value={formatNumber(asRecord(activity.downloads).total)} tone="cyan" />
            <StatCard label="Library items" value={formatNumber(asRecord(activity.library).total_items)} />
            <StatCard label="Total plays" value={formatNumber(asRecord(activity.playback).total_plays)} tone="accent" />
          </StatGrid>
        </Section>
      )}

      {Object.keys(contributions).length > 0 && (
        <Section title="Contributions">
          <StatGrid>
            <StatCard label="Total" value={formatNumber(contributions.total_contributions)} />
            <StatCard
              label="Pending"
              value={formatNumber(contributions.pending_review)}
              tone={num(contributions.pending_review) ? 'warn' : 'ok'}
            />
            <StatCard label="This week" value={formatNumber(contributions.recent_contributions_week)} />
            <StatCard label="Contributors" value={formatNumber(contributions.unique_contributors)} />
            <StatCard label="Stream votes" value={formatNumber(contributions.total_stream_votes)} />
            <StatCard label="Metadata votes" value={formatNumber(contributions.total_metadata_votes)} />
          </StatGrid>
          <ChipCounts data={contributions.contributions_by_status} />
        </Section>
      )}

      <CountBars title="Torrent sources" data={arrayToCounts(data.torrent_sources, 'name', 'count')} limit={20} />
      <DebridCache data={data.debrid_cache} />
      <SchedulerStats data={data.scheduler_stats} />
      {jobs.length > 0 && (
        <Section title="Scheduler jobs">
          <ResponsiveTable
            rows={jobs.slice(0, 50)}
            columns={[
              {
                label: 'Job',
                cell: (row) => (
                  <span className="font-semibold text-text">{text(row.name || row.job_id || row.id)}</span>
                ),
              },
              {
                label: 'Status',
                cell: (row) => (
                  <Badge
                    tone={
                      row.is_running || row.status === 'running'
                        ? 'ok'
                        : row.is_active === false || row.status === 'disabled'
                          ? 'muted'
                          : 'cyan'
                    }
                  >
                    {row.is_running || row.status === 'running'
                      ? 'running'
                      : row.is_active === false || row.status === 'disabled'
                        ? 'disabled'
                        : 'active'}
                  </Badge>
                ),
              },
              {
                label: 'Schedule',
                cell: (row) => (
                  <span className="font-mono text-[11px]">{text(row.crontab || row.schedule || row.trigger, '-')}</span>
                ),
              },
              { label: 'Last run', cell: (row) => formatDate(row.last_run) },
              { label: 'Next run', cell: (row) => <span className="text-accent">{formatDate(row.next_run)}</span> },
            ]}
          />
        </Section>
      )}

      {sourceHealth.length > 0 && (
        <Section title="Indexer source health">
          <ResponsiveTable
            rows={sourceHealth}
            columns={[
              {
                label: 'Source',
                cell: (row) => (
                  <span className="font-semibold text-text">{text(row.source_name || row.source_key)}</span>
                ),
              },
              {
                label: 'Movie',
                cell: (row) => (
                  <Badge tone={row.supports_movie ? 'ok' : 'muted'}>{row.supports_movie ? 'yes' : '-'}</Badge>
                ),
              },
              {
                label: 'Series',
                cell: (row) => (
                  <Badge tone={row.supports_series ? 'ok' : 'muted'}>{row.supports_series ? 'yes' : '-'}</Badge>
                ),
              },
              {
                label: 'Anime',
                cell: (row) => (
                  <Badge tone={row.supports_anime ? 'ok' : 'muted'}>{row.supports_anime ? 'yes' : '-'}</Badge>
                ),
              },
              { label: 'Success', cell: (row) => <Rate value={num(row.success_rate) * 100} /> },
              {
                label: 'Gate',
                cell: (row) => (
                  <Badge
                    tone={
                      text(row.gate_status) === 'allowed' ? 'ok' : text(row.gate_status) === 'blocked' ? 'err' : 'warn'
                    }
                  >
                    {text(row.gate_status, '-')}
                  </Badge>
                ),
              },
            ]}
          />
        </Section>
      )}

      <RedisStats data={data.redis} />
      <RequestMetrics data={data.request_metrics} endpoints={requestEndpoints} />
      <WorkerStats data={data.workers} />
      <ScraperStats data={data.scrapers} />
      <JsonPanel title="Raw MediaFusion metrics" data={data} />
    </div>
  )
}

export function MediaFusionScraperAnalyzer() {
  const [lines, setLines] = useState('10000')
  const [mode, setMode] = useState<'analysis' | 'raw'>('analysis')
  const analysis = useQuery({
    queryKey: ['mediafusion-scraper-analysis', lines],
    queryFn: () => api<AnyRecord>(`/api/mediafusion/analyze?n=${encodeURIComponent(lines)}`),
    enabled: mode === 'analysis',
    refetchInterval: mode === 'analysis' ? 60000 : false,
  })
  const raw = useQuery({
    queryKey: ['mediafusion-scraper-raw', lines],
    queryFn: () =>
      api<{ lines: string[] }>(
        `/api/logs/mediafusion-taskiq-scrapy?n=${encodeURIComponent(lines === 'all' ? '1000' : lines)}`,
      ),
    enabled: mode === 'raw',
  })

  return (
    <div className="space-y-3">
      <Toolbar
        status={
          mode === 'analysis' && analysis.data
            ? `${formatNumber(analysis.data.log_lines)} lines (${formatNumber(analysis.data.lines_parsed)} parsed)`
            : mode === 'raw' && raw.data
              ? `${raw.data.lines.length} raw lines`
              : undefined
        }
      >
        <Dropdown
          className="w-full sm:w-44"
          value={lines}
          onChange={setLines}
          options={rawLineOptions(MF_LINE_OPTIONS)}
          ariaLabel="MediaFusion analyzer line count"
        />
        <Button
          onClick={() => {
            setMode('analysis')
            void analysis.refetch()
          }}
          disabled={analysis.isFetching}
        >
          {analysis.isFetching ? 'Analyzing...' : 'Analyze'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setMode('raw')
            void raw.refetch()
          }}
          disabled={raw.isFetching}
        >
          Raw logs
        </Button>
      </Toolbar>
      {mode === 'raw' ? (
        raw.error ? (
          <ErrorState title="Raw logs failed" error={raw.error.message} />
        ) : raw.isLoading || raw.isFetching ? (
          <LoadingState>Loading raw logs...</LoadingState>
        ) : (
          <RawTextPanel title="MediaFusion scraper raw logs" lines={raw.data?.lines || []} />
        )
      ) : analysis.error ? (
        <ErrorState title="MediaFusion scraper analyzer failed" error={analysis.error.message} />
      ) : analysis.isLoading ? (
        <LoadingState>Analyzing scraper logs...</LoadingState>
      ) : analysis.data ? (
        <MediaFusionScraperView data={analysis.data} />
      ) : (
        <EmptyState>No scraper analyzer data loaded.</EmptyState>
      )}
    </div>
  )
}

function MediaFusionScraperView({ data }: { data: AnyRecord }) {
  const summary = asRecord(data.summary)
  const topTitles = asArray(data.top_titles)
  const crawlSnapshots = asArray(data.crawl_snapshots).map(asRecord)
  const recentStreams = asArray(data.recent_streams).map(asRecord).reverse()
  const recentErrors = asArray(data.recent_errors).map(asRecord).reverse()
  const tasks = asArray(data.tasks).map(asRecord)
  const dmmSamples = asArray(data.dmm_no_match_samples).map(asRecord)
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Streams added" value={formatNumber(summary.streams_added)} />
        <StatCard
          label="Last 1h"
          value={formatNumber(summary.streams_1h)}
          tone={num(summary.streams_1h) ? 'ok' : 'muted'}
        />
        <StatCard
          label="Last 6h"
          value={formatNumber(summary.streams_6h)}
          tone={num(summary.streams_6h) ? 'ok' : 'muted'}
        />
        <StatCard
          label="Last 24h"
          value={formatNumber(summary.streams_24h)}
          tone={num(summary.streams_24h) ? 'ok' : 'muted'}
        />
        <StatCard label="Streams/hr" value={text(summary.streams_per_hour, '-')} />
        <StatCard label="Errors" value={formatNumber(summary.errors)} tone={num(summary.errors) ? 'err' : 'ok'} />
      </StatGrid>
      <StatGrid>
        <StatCard label="Store ops" value={formatNumber(summary.store_operations)} />
        <StatCard label="Valid" value={formatNumber(summary.total_valid)} tone="ok" />
        <StatCard
          label="Duplicates"
          value={formatNumber(summary.total_existing)}
          tone={num(summary.total_existing) ? 'warn' : 'muted'}
        />
        <StatCard label="IMDB resolved" value={formatNumber(summary.imdb_resolved)} tone="ok" />
        <StatCard
          label="Synthetic"
          value={formatNumber(summary.synthetic_resolved)}
          tone={num(summary.synthetic_resolved) ? 'accent' : 'muted'}
        />
        <StatCard label="Tasks" value={formatNumber(summary.tasks_executed)} />
      </StatGrid>

      <Section title="Log status">
        <div className="flex flex-wrap gap-1.5">
          {data.log_duration_hours != null && <Badge tone="accent">Span {text(data.log_duration_hours)}h</Badge>}
          {Boolean(data.dmm_auth) && <Badge tone="ok">DMM {text(data.dmm_auth)}</Badge>}
          {sortedCountEntries(data.log_levels).map(([level, count]) => (
            <Badge
              key={level}
              tone={level === 'ERROR' ? 'err' : level === 'WARNING' ? 'warn' : level === 'INFO' ? 'ok' : 'muted'}
            >
              {level} {formatNumber(count)}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Quality analysis">
        <div className="grid gap-3 lg:grid-cols-3">
          <CountBars title="Resolutions" data={data.resolutions} compact />
          <CountBars title="Qualities" data={data.qualities} compact />
          <CountBars title="Codecs" data={data.codecs} compact />
        </div>
      </Section>

      <CountBars title="Streams added timeline" data={data.streams_by_hour} />
      <CountBars title="Streams by source" data={data.sources_added} limit={20} />

      <Section title="Content breakdown">
        <div className="grid gap-3 md:grid-cols-2">
          <ChipCounts data={data.media_types_added} />
          <ChipCounts data={data.years_added} limit={20} />
        </div>
      </Section>

      {topTitles.length > 0 && (
        <Section title="Top titles">
          <ResponsiveTable
            rows={topTitles.filter((row) => Array.isArray(row)).slice(0, 20)}
            columns={[
              {
                label: 'Title',
                cell: (row) => <span className="font-semibold text-text">{text(asArray(row)[0])}</span>,
              },
              {
                label: 'Streams',
                cell: (row) => <span className="font-bold text-accent">{formatNumber(asArray(row)[1])}</span>,
              },
            ]}
          />
        </Section>
      )}

      {crawlSnapshots.length > 0 && (
        <Section title="Crawl progress">
          <StatGrid>
            <StatCard label="Pages" value={formatNumber(asRecord(data.latest_crawl).pages)} />
            <StatCard label="Pages/min" value={text(asRecord(data.latest_crawl).pages_per_min, '-')} />
            <StatCard label="Items" value={formatNumber(asRecord(data.latest_crawl).items)} tone="ok" />
            <StatCard label="Items/min" value={text(asRecord(data.latest_crawl).items_per_min, '-')} tone="cyan" />
          </StatGrid>
          <div className="mt-2 flex h-14 items-end gap-0.5 rounded-md border border-line bg-canvas p-2">
            {crawlSnapshots.map((snapshot, index) => {
              const maxItems = Math.max(...crawlSnapshots.map((item) => num(item.items)), 1)
              return (
                <div
                  key={`${text(snapshot.timestamp)}-${index}`}
                  className="min-w-1 flex-1 rounded-t bg-mint"
                  title={`${text(snapshot.timestamp)}: ${formatNumber(snapshot.items)} items`}
                  style={{ height: `${Math.max((num(snapshot.items) / maxItems) * 100, 3)}%` }}
                />
              )
            })}
          </div>
        </Section>
      )}

      <CountBars title="Crawled domains" data={data.crawled_domains} limit={15} />
      <ChipCounts title="HTTP status distribution" data={data.crawled_statuses} />
      <CountBars title="Error breakdown" data={data.error_categories} tone="err" />

      {dmmSamples.length > 0 && (
        <Section title="DMM no match">
          <ChipCounts data={data.dmm_no_match_types} />
          <ResponsiveTable
            rows={dmmSamples.slice(0, 12)}
            columns={[
              { label: 'Title', cell: (row) => <span className="font-semibold text-text">{text(row.title)}</span> },
              { label: 'Year', cell: (row) => text(row.year, '-') },
              { label: 'Type', cell: (row) => <Badge>{text(row.type, '-')}</Badge> },
              {
                label: 'Candidates',
                cell: (row) => (
                  <span className={num(row.candidates) ? 'text-amber' : 'text-muted'}>
                    {formatNumber(row.candidates)}
                  </span>
                ),
              },
            ]}
          />
        </Section>
      )}

      <CountList title="TMDB errors" data={data.tmdb_errors} tone="err" />
      <SyntheticTitles data={data.synthetic_titles} />

      {tasks.length > 0 && (
        <Section title="Tasks executed">
          <ResponsiveTable
            rows={tasks}
            columns={[
              { label: 'Task', cell: (row) => <span className="font-semibold text-text">{text(row.task)}</span> },
              { label: 'ID', cell: (row) => <span className="font-mono text-[11px]">{text(row.id)}</span> },
              { label: 'Time', cell: (row) => formatDate(row.timestamp) },
            ]}
          />
        </Section>
      )}

      {recentStreams.length > 0 && (
        <Section title="Recent streams added">
          <ResponsiveTable
            rows={recentStreams.slice(0, 60)}
            columns={[
              { label: 'Time', cell: (row) => formatDate(row.timestamp) },
              {
                label: 'Type',
                cell: (row) => <Badge tone={text(row.type) === 'movie' ? 'accent' : 'ok'}>{text(row.type)}</Badge>,
              },
              { label: 'Title', cell: (row) => <span className="font-semibold text-text">{text(row.title)}</span> },
              {
                label: 'Res',
                cell: (row) => (
                  <Badge
                    tone={
                      text(row.resolution).includes('2160') || text(row.resolution).includes('4') ? 'accent' : 'cyan'
                    }
                  >
                    {text(row.resolution, '-')}
                  </Badge>
                ),
              },
              { label: 'Source', cell: (row) => <span className="font-semibold text-accent">{text(row.source)}</span> },
              { label: 'Stream', cell: (row) => <span className="font-mono text-[11px]">{text(row.stream)}</span> },
            ]}
          />
        </Section>
      )}

      {recentErrors.length > 0 && (
        <Section title="Recent errors">
          <div className="grid gap-1.5">
            {recentErrors.slice(0, 20).map((error, index) => (
              <div
                key={`${text(error.timestamp)}-${index}`}
                className="grid gap-2 rounded-md border border-line bg-canvas p-2 text-xs sm:grid-cols-[6rem_1fr]"
              >
                <span className="font-mono text-dim">{formatDate(error.timestamp)}</span>
                <span className="break-words text-rose">{text(error.message)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <LogRange range={data.time_range} duration={data.log_duration_hours} />
      {!Object.keys(summary).length && (
        <EmptyState>No scraper activity found in {formatNumber(data.log_lines)} log lines.</EmptyState>
      )}
      <JsonPanel title="Raw scraper analyzer payload" data={data} />
    </div>
  )
}

function CountBars({
  title,
  data,
  limit = 30,
  tone = 'ok',
  compact,
}: {
  title: string
  data: unknown
  limit?: number
  tone?: Tone
  compact?: boolean
}) {
  const rows = sortedCountEntries(data).slice(0, limit)
  if (!rows.length) return compact ? <EmptyState>No {title.toLowerCase()} data.</EmptyState> : null
  const max = Math.max(...rows.map(([, value]) => value), 1)
  const body = (
    <div className="grid gap-2">
      {rows.map(([label, value]) => (
        <BarRow
          key={label}
          label={label.replace(/_/g, ' ')}
          value={value}
          max={max}
          tone={tone}
          detail={formatNumber(value)}
        />
      ))}
    </div>
  )
  if (compact) {
    return (
      <div className="min-w-0 rounded-lg border border-line bg-canvas p-3">
        <div className="mb-2 text-xs font-black uppercase text-muted">{title}</div>
        {body}
      </div>
    )
  }
  return <Section title={title}>{body}</Section>
}

function CountList({ title, data, tone = 'muted' }: { title: string; data: unknown; tone?: Tone }) {
  const rows = sortedCountEntries(data).slice(0, 20)
  if (!rows.length) return null
  return (
    <Section title={title}>
      <div className="grid gap-1.5">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid min-w-0 grid-cols-[3rem_1fr] gap-2 rounded-md border border-line bg-canvas p-2 text-xs"
          >
            <span className={cx('font-black', toneClass(tone))}>{formatNumber(value)}x</span>
            <span className="break-words text-muted">{label}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

function ChipCounts({ title, data, limit = 40 }: { title?: string; data: unknown; limit?: number }) {
  const chips = sortedCountEntries(data).slice(0, limit)
  if (!chips.length) return title ? null : <EmptyState>No data.</EmptyState>
  const body = (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(([label, count]) => (
        <Badge
          key={label}
          tone={label.toLowerCase().includes('error') || label.toLowerCase().includes('blocked') ? 'err' : 'accent'}
        >
          {label.replace(/_/g, ' ')} {formatNumber(count)}
        </Badge>
      ))}
    </div>
  )
  return title ? <Section title={title}>{body}</Section> : body
}

function arrayToCounts(value: unknown, labelKey: string, valueKey: string): Record<string, number> {
  const output: Record<string, number> = {}
  for (const item of asArray(value).map(asRecord)) {
    const label = text(item[labelKey] || item.source || item.name, 'unknown')
    output[label] = num(item[valueKey] || item.count)
  }
  return output
}

function DebridCache({ data }: { data: unknown }) {
  const record = asRecord(data)
  const services = asRecord(record.services || record)
  const counts: Record<string, number> = {}
  for (const [name, value] of Object.entries(services)) {
    const count = typeof value === 'number' ? value : num(asRecord(value).cached_torrents)
    if (count > 0) counts[name] = count
  }
  return <ChipCounts title="Debrid cache" data={counts} />
}

function SchedulerStats({ data }: { data: unknown }) {
  const stats = asRecord(data)
  if (!Object.keys(stats).length) return null
  return (
    <Section title="Scheduler">
      <StatGrid>
        <StatCard label="Total jobs" value={formatNumber(stats.total_jobs)} />
        <StatCard label="Active" value={formatNumber(stats.active_jobs)} tone="ok" />
        <StatCard
          label="Disabled"
          value={formatNumber(stats.disabled_jobs)}
          tone={num(stats.disabled_jobs) ? 'warn' : 'muted'}
        />
        <StatCard
          label="Running"
          value={formatNumber(stats.running_jobs)}
          tone={num(stats.running_jobs) ? 'ok' : 'muted'}
        />
        <StatCard
          label="Global pause"
          value={stats.global_scheduler_disabled ? 'Yes' : 'No'}
          tone={stats.global_scheduler_disabled ? 'err' : 'ok'}
        />
      </StatGrid>
      <ChipCounts data={flattenSchedulerCategories(stats.jobs_by_category)} />
    </Section>
  )
}

function flattenSchedulerCategories(data: unknown): Record<string, number> {
  const output: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRecord(data))) {
    output[key] = typeof value === 'number' ? value : num(asRecord(value).active)
  }
  return output
}

function RedisStats({ data }: { data: unknown }) {
  const redis = asRecord(data)
  if (!Object.keys(redis).length) return null
  const memory = asRecord(redis.memory)
  const performance = asRecord(redis.performance)
  const cache = asRecord(redis.cache)
  const connections = asRecord(redis.connections)
  return (
    <Section title="Redis">
      <StatGrid>
        <StatCard label="Memory used" value={text(memory.used_memory_human || memory.used_memory, '-')} />
        <StatCard label="Peak memory" value={text(memory.peak_memory_human || memory.peak_memory, '-')} />
        <StatCard
          label="Ops/sec"
          value={text(performance.ops_per_sec || performance.instantaneous_ops_per_sec, '-')}
          tone="accent"
        />
        <StatCard
          label="Hit rate"
          value={cache.hit_rate != null ? pct(num(cache.hit_rate) * 100) : '-'}
          tone={num(cache.hit_rate) >= 0.9 ? 'ok' : 'warn'}
        />
        <StatCard label="Hits" value={formatNumber(cache.hits)} />
        <StatCard label="Clients" value={formatNumber(connections.connected_clients || connections.clients)} />
      </StatGrid>
    </Section>
  )
}

function RequestMetrics({ data, endpoints }: { data: unknown; endpoints: AnyRecord[] }) {
  const metrics = asRecord(data)
  if (!Object.keys(metrics).length && !endpoints.length) return null
  return (
    <Section title="Request metrics">
      <StatGrid>
        <StatCard label="Requests" value={formatNumber(metrics.total_requests)} />
        <StatCard label="Endpoints" value={formatNumber(metrics.total_endpoints)} />
        <StatCard label="Visitors" value={formatNumber(metrics.unique_visitors)} />
        <StatCard label="Tracking" value={metrics.enabled ? 'On' : 'Off'} tone={metrics.enabled ? 'ok' : 'muted'} />
      </StatGrid>
      {endpoints.length > 0 && (
        <div className="mt-2">
          <ResponsiveTable
            rows={endpoints.slice(0, 30)}
            columns={[
              {
                label: 'Endpoint',
                cell: (row) => (
                  <span className="font-mono text-[11px]">{text(row.route || row.path || row.endpoint)}</span>
                ),
              },
              {
                label: 'Requests',
                cell: (row) => <span className="font-bold text-accent">{formatNumber(row.total_requests)}</span>,
              },
              { label: 'Avg time', cell: (row) => milliseconds(row.avg_time) },
              {
                label: 'Errors',
                cell: (row) => (
                  <span className={num(row.error_count) ? 'text-rose' : 'text-muted'}>
                    {formatNumber(row.error_count)}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}
    </Section>
  )
}

function WorkerStats({ data }: { data: unknown }) {
  const summary = asRecord(asRecord(data).summary)
  if (!Object.keys(summary).length) return null
  return (
    <Section title="Worker memory">
      <StatGrid>
        <StatCard label="Events" value={formatNumber(summary.total_events)} />
        <StatCard label="Peak RSS" value={summary.peak_rss ? mb(num(summary.peak_rss) / 1024 / 1024) : '-'} />
        {sortedCountEntries(summary.status_counts).map(([status, count]) => (
          <StatCard
            key={status}
            label={status}
            value={formatNumber(count)}
            tone={status === 'success' ? 'ok' : status === 'error' ? 'err' : 'muted'}
          />
        ))}
      </StatGrid>
    </Section>
  )
}

function ScraperStats({ data }: { data: unknown }) {
  const scraperList = Array.isArray(data)
    ? data.map(asRecord)
    : asArray(asRecord(data).scrapers || Object.values(asRecord(data))).map(asRecord)
  if (!scraperList.length) return null
  return (
    <Section title="Scraper performance">
      <ResponsiveTable
        rows={scraperList}
        columns={[
          {
            label: 'Scraper',
            cell: (row) => <span className="font-semibold text-text">{text(row.name || row.scraper_name)}</span>,
          },
          { label: 'Runs', cell: (row) => formatNumber(asRecord(row.aggregated || row).total_runs) },
          {
            label: 'Found',
            cell: (row) => (
              <span className="font-bold text-accent">{formatNumber(asRecord(row.aggregated || row).items_found)}</span>
            ),
          },
          { label: 'Processed', cell: (row) => formatNumber(asRecord(row.aggregated || row).items_processed) },
          { label: 'Success', cell: (row) => <Rate value={num(asRecord(row.aggregated || row).success_rate) * 100} /> },
          {
            label: 'Duration',
            cell: (row) =>
              seconds(asRecord(row.aggregated || row).avg_duration || asRecord(row.aggregated || row).duration),
          },
        ]}
      />
    </Section>
  )
}

function SyntheticTitles({ data }: { data: unknown }) {
  const titles = asArray(data).map(String)
  if (!titles.length) return null
  return (
    <Section title="Synthetic IDs">
      <div className="flex flex-wrap gap-1.5">
        {titles.slice(0, 40).map((title) => (
          <Badge key={title} tone="accent">
            {title}
          </Badge>
        ))}
      </div>
    </Section>
  )
}

function Rate({ value }: { value: number }) {
  const tone: Tone = value >= 80 ? 'ok' : value >= 50 ? 'warn' : 'err'
  return (
    <div className="min-w-24">
      <Progress value={value} tone={tone} />
      <div className={cx('mt-1 font-mono text-[11px]', toneClass(tone))}>{pct(value)}</div>
    </div>
  )
}

function LogRange({ range, duration }: { range: unknown; duration?: unknown }) {
  const record = asRecord(range)
  if (!record.start && !record.end) return null
  return (
    <div className="text-right text-[11px] text-muted">
      Log range: {text(record.start, '?')} - {text(record.end, '?')}
      {duration ? ` (${text(duration)}h)` : ''}
    </div>
  )
}

function toneClass(tone: Tone): string {
  if (tone === 'ok') return 'text-mint'
  if (tone === 'warn') return 'text-amber'
  if (tone === 'err') return 'text-rose'
  if (tone === 'cyan') return 'text-cyan'
  if (tone === 'accent') return 'text-accent'
  return 'text-muted'
}
