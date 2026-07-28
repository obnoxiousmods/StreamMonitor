import { useQuery } from '@tanstack/react-query'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useEffect, useMemo, useRef, useState } from 'react'

type MetricPoint = { ts: string; value: number }
type MetricSeriesResponse = { metric_key: string; since: string; points: MetricPoint[] }

export type ChartRange = '1h' | '6h' | '24h' | '7d' | '30d'

const RANGE_REFRESH_MS: Record<ChartRange, number> = {
  '1h': 15000,
  '6h': 30000,
  '24h': 60000,
  '7d': 120000,
  '30d': 120000,
}

async function fetchSeries(metricKey: string, range: ChartRange, tags?: Record<string, string>): Promise<MetricSeriesResponse> {
  const params = new URLSearchParams({ range, ...(tags || {}) })
  const res = await fetch(`/api/metrics/${encodeURIComponent(metricKey)}?${params.toString()}`, {
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(`metric fetch failed: ${res.status}`)
  return res.json()
}

function cssColorTriplet(varName: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw || '153 162 176'
}

function rgba(triplet: string, alpha: number): string {
  return `rgba(${triplet.split(/\s+/).join(', ')}, ${alpha})`
}

export type ChartSeries = {
  metricKey: string
  label: string
  colorVar?: string // CSS custom property name, e.g. '--color-accent'
  tags?: Record<string, string>
}

/** A themed, real-time uPlot line chart backed by /api/metrics/{key}. Polls on an
 * interval scaled to the selected range — short ranges refresh fast, long ranges don't
 * need to (the underlying data barely changes minute to minute at a 7d/30d zoom).
 *
 * All series on one chart MUST share the same unit/scale (dataviz rule: one axis,
 * never dual-axis) — callers combining e.g. a percent and a temperature belong in
 * two separate <MetricChart>s, not one with two scales. */
export function MetricChart({
  series,
  range,
  height = 120,
  unit = '',
  title,
  formatValue,
}: {
  series: ChartSeries[]
  range: ChartRange
  height?: number
  unit?: string
  title?: string
  formatValue?: (v: number) => string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const seriesKey = series.map((s) => `${s.metricKey}:${JSON.stringify(s.tags || {})}`).join(',')
  const fmt = formatValue || ((v: number) => `${v.toFixed(1)}${unit}`)

  const query = useQuery({
    queryKey: ['metric-series', seriesKey, range],
    queryFn: () => Promise.all(series.map((s) => fetchSeries(s.metricKey, range, s.tags))),
    refetchInterval: RANGE_REFRESH_MS[range],
    staleTime: 1000,
  })

  const data = useMemo<uPlot.AlignedData>(() => {
    const responses = query.data ?? []
    const allTs = new Set<number>()
    const perSeries = responses.map((resp) => {
      const map = new Map<number, number>()
      for (const p of resp.points) {
        const t = Math.floor(new Date(p.ts).getTime() / 1000)
        map.set(t, p.value)
        allTs.add(t)
      }
      return map
    })
    const xs = Array.from(allTs).sort((a, b) => a - b)
    const ys = perSeries.map((map) => xs.map((t) => map.get(t) ?? null))
    return [xs, ...ys] as unknown as uPlot.AlignedData
  }, [query.data])

  const defaultColorVars = ['--color-accent', '--color-info', '--color-warn', '--color-err']
  const colors = series.map((s, i) => rgba(cssColorTriplet(s.colorVar || defaultColorVars[i % defaultColorVars.length]), 1))

  useEffect(() => {
    if (!containerRef.current) return
    const textColor = rgba(cssColorTriplet('--color-muted'), 1)
    const gridColor = rgba(cssColorTriplet('--color-line'), 0.6)

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth || 320,
      height,
      padding: [8, 8, 0, 0],
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        points: { size: 6 },
      },
      hooks: {
        setCursor: [
          (u) => {
            setHoverIdx(u.cursor.idx ?? null)
          },
        ],
      },
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor },
          font: '10px Inter, sans-serif',
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor },
          font: '10px Inter, sans-serif',
          values: (_u, vals) => vals.map((v) => (formatValue ? formatValue(v) : `${v}${unit}`)),
        },
      ],
      scales: { x: { time: true } },
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.label,
          stroke: colors[i],
          width: 1.5,
          fill: colors[i].replace(', 1)', ', 0.12)'),
          points: { show: false },
        })),
      ],
    }

    const plot = new uPlot(opts, data, containerRef.current)
    plotRef.current = plot

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        plot.setSize({ width: containerRef.current.clientWidth || 320, height })
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      plot.destroy()
      plotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, seriesKey, unit])

  useEffect(() => {
    plotRef.current?.setData(data)
  }, [data])

  const hasAnyData = (data[0] as number[] | undefined)?.length
  const xs = (data[0] as number[] | undefined) || []
  const idx = hoverIdx !== null && hoverIdx < xs.length ? hoverIdx : xs.length - 1

  return (
    <div>
      {(title || series.length > 0) && (
        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px]">
          {title && <span className="font-bold uppercase text-dim">{title}</span>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {series.map((s, i) => {
              const val = idx >= 0 ? (data[i + 1] as (number | null)[] | undefined)?.[idx] : null
              return (
                <span key={s.metricKey + i} className="flex items-center gap-1 text-muted">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colors[i] }} />
                  {s.label}
                  {val != null && <span className="font-mono font-semibold text-text">{fmt(val)}</span>}
                </span>
              )
            })}
          </div>
        </div>
      )}
      <div className="relative" style={{ height }}>
        <div ref={containerRef} className="w-full" />
        {!hasAnyData && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-dim">
            collecting history…
          </div>
        )}
      </div>
    </div>
  )
}
