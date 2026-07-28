import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type ColumnDef<T> = {
  key: string
  label: string
  align?: 'left' | 'right'
  sortAccessor?: (row: T) => number | string
  render?: (row: T) => ReactNode
  className?: string
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Click-to-sort, filterable data table — used for the process explorer and
 * per-IP bandwidth list. Sorting/filtering happen client-side since these
 * datasets are small (hundreds of rows at most). */
export function SortableTable<T>({
  rows,
  columns,
  defaultSortKey,
  defaultSortDir = 'desc',
  searchPlaceholder,
  searchAccessor,
  rowKey,
  maxHeight,
  emptyMessage = 'No data.',
  resizable,
  toolbar,
}: {
  rows: T[]
  columns: ColumnDef<T>[]
  defaultSortKey: string
  defaultSortDir?: 'asc' | 'desc'
  searchPlaceholder?: string
  searchAccessor?: (row: T) => string
  rowKey: (row: T) => string | number
  maxHeight?: string
  emptyMessage?: string
  /** Lets the user drag-resize the table's vertical height (native CSS resize). */
  resizable?: boolean
  /** Extra controls rendered in the header row, right of the row count. */
  toolbar?: ReactNode
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query || !searchAccessor) return rows
    const q = query.toLowerCase()
    return rows.filter((r) => searchAccessor(r).toLowerCase().includes(q))
  }, [rows, query, searchAccessor])

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return filtered
    const accessor = col.sortAccessor || ((r: T) => (r as Record<string, unknown>)[col.key] as number | string)
    const copy = [...filtered]
    copy.sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av)
      const bs = String(bv)
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
    return copy
  }, [filtered, sortKey, sortDir, columns])

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {searchAccessor ? (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder || 'Filter...'}
            className="min-h-8 w-full max-w-xs rounded-md border border-line bg-canvas px-2 text-xs text-text placeholder:text-dim focus:border-accent focus:outline-none sm:w-64"
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {toolbar}
          <span className="shrink-0 text-[10px] text-dim">
            {sorted.length} of {rows.length}
          </span>
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-muted">{emptyMessage}</div>
      ) : (
        <div
          className={cx('overflow-auto rounded-lg border border-line', resizable && 'resize-y')}
          style={{ maxHeight, minHeight: resizable ? '200px' : undefined }}
        >
          <table className="min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-panel2 text-[10px] uppercase text-muted">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={cx(
                      'cursor-pointer select-none whitespace-nowrap p-2 text-left hover:text-text',
                      col.align === 'right' && 'text-right',
                    )}
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      <span className="ml-1 text-accent">{sortDir === 'asc' ? '▲' : '▼'}</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={rowKey(row)} className="border-t border-line/60 hover:bg-panel2/50">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cx('whitespace-nowrap p-2', col.align === 'right' && 'text-right', col.className)}
                    >
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

