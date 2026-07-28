export function heatText(value: number, thresholds: { warn: number; err: number } = { warn: 50, err: 80 }): string {
  if (value >= thresholds.err) return 'text-rose font-bold'
  if (value >= thresholds.warn) return 'text-amber font-semibold'
  return 'text-text'
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.abs(value)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${value < 0 ? '-' : ''}${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatRate(value: number): string {
  return `${formatBytes(value)}/s`
}
