import { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { ColumnInfo, PreviewResult } from '../types'
import type { ChartConfig, ChartType } from '../transformations'

type Props = {
  data: PreviewResult | null
  chart: ChartConfig
  onChange: (chart: ChartConfig) => void
}

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'bar', label: 'Bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'pie', label: 'Pie' },
  { id: 'heatmap', label: 'Heatmap' },
]

const SERIES_COLORS = [
  '#0e639c',
  '#4ec9b0',
  '#ce9178',
  '#c586c0',
  '#dcdcaa',
  '#9cdcfe',
  '#f44747',
]

const MULTI_Y_TYPES: ChartType[] = ['bar', 'line', 'area']

function supportsMultiY(type: ChartType): boolean {
  return MULTI_Y_TYPES.includes(type)
}

export default function TransformChart({ data, chart, onChange }: Props) {
  const columns = data?.columns ?? []
  const colNames = columns.map((c) => c.name)
  const yCols = chart.y ?? []
  const multiY = supportsMultiY(chart.type)
  const showSeries =
    (chart.type === 'heatmap' || chart.type === 'bar' || chart.type === 'line') &&
    !(multiY && yCols.length > 1)

  const option = useMemo(() => {
    if (!data || !chart.x) return null
    return buildOption(data, chart)
  }, [data, chart])

  const setSingleY = (name: string) => {
    onChange({ ...chart, y: name ? [name] : [] })
  }

  const toggleY = (name: string) => {
    const set = new Set(yCols)
    if (set.has(name)) set.delete(name)
    else set.add(name)
    // Keep selection order stable: selected in column order.
    const next = colNames.filter((n) => set.has(n))
    onChange({
      ...chart,
      y: next,
      series: next.length > 1 ? null : chart.series,
    })
  }

  return (
    <div className="transform-chart">
      <div className="transform-chart-toolbar">
        <label className="tf-field">
          <span className="tf-label">Type</span>
          <select
            className="select"
            value={chart.type}
            onChange={(e) => {
              const type = e.target.value as ChartType
              const nextY =
                supportsMultiY(type) || yCols.length <= 1
                  ? yCols
                  : yCols.slice(0, 1)
              onChange({
                ...chart,
                type,
                y: nextY,
                series:
                  supportsMultiY(type) && nextY.length > 1
                    ? null
                    : chart.series,
              })
            }}
          >
            {CHART_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="tf-field">
          <span className="tf-label">X</span>
          <select
            className="select"
            value={chart.x ?? ''}
            onChange={(e) =>
              onChange({ ...chart, x: e.target.value || null })
            }
          >
            <option value="">—</option>
            {colNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {multiY ? (
          <YMultiSelect
            columns={columns}
            selected={yCols}
            exclude={chart.x}
            onToggle={toggleY}
          />
        ) : (
          <label className="tf-field">
            <span className="tf-label">Y</span>
            <select
              className="select"
              value={yCols[0] ?? ''}
              onChange={(e) => setSingleY(e.target.value)}
            >
              <option value="">—</option>
              {colNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {showSeries ? (
          <label className="tf-field">
            <span className="tf-label">Series</span>
            <select
              className="select"
              value={chart.series ?? ''}
              onChange={(e) =>
                onChange({ ...chart, series: e.target.value || null })
              }
            >
              <option value="">—</option>
              {colNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="transform-chart-body">
        {!data ? (
          <div className="empty-hint">Run a transform to chart results</div>
        ) : !chart.x ? (
          <div className="empty-hint">Pick an X column</div>
        ) : (chart.type === 'scatter' || chart.type === 'heatmap') &&
          yCols.length === 0 ? (
          <div className="empty-hint">Pick a Y column</div>
        ) : !option ? (
          <div className="empty-hint">Not enough data for this chart</div>
        ) : (
          <ReactECharts
            option={option}
            style={{ height: '100%', width: '100%', minHeight: 220 }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        )}
      </div>
    </div>
  )
}

function YMultiSelect({
  columns,
  selected,
  exclude,
  onToggle,
}: {
  columns: ColumnInfo[]
  selected: string[]
  exclude: string | null
  onToggle: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedSet = new Set(selected)

  const ordered = useMemo(() => {
    const list = columns.filter((c) => c.name !== exclude)
    return [
      ...list.filter((c) => c.type === 'number'),
      ...list.filter((c) => c.type !== 'number'),
    ]
  }, [columns, exclude])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label =
    selected.length === 0
      ? '—'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`

  return (
    <div className="tf-field tf-y-multi" ref={rootRef}>
      <span className="tf-label">
        Y{selected.length > 0 ? ` (${selected.length})` : ''}
      </span>
      <button
        type="button"
        className={`select tf-y-multi-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="tf-y-multi-value">{label}</span>
      </button>
      {open ? (
        <div className="tf-y-multi-popover" role="listbox" aria-multiselectable>
          {ordered.length === 0 ? (
            <div className="tf-y-multi-empty">No columns</div>
          ) : (
            ordered.map((col) => {
              const checked = selectedSet.has(col.name)
              return (
                <label
                  key={col.name}
                  className={`tf-y-multi-item${checked ? ' checked' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(col.name)}
                  />
                  <span className="tf-y-multi-name">{col.name}</span>
                  <span className={`th-type type-${col.type}`}>{col.type}</span>
                </label>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}

function colIndex(data: PreviewResult, name: string): number {
  return data.columns.findIndex((c) => c.name === name)
}

function toNum(v: string | number | boolean | null): number | null {
  if (v == null || typeof v === 'boolean') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function buildOption(data: PreviewResult, chart: ChartConfig) {
  const xi = chart.x ? colIndex(data, chart.x) : -1
  if (xi < 0) return null
  const yNames = (chart.y ?? []).filter((n) => colIndex(data, n) >= 0)
  const yi = yNames[0] != null ? colIndex(data, yNames[0]) : -1
  const si = chart.series ? colIndex(data, chart.series) : -1

  const textColor = '#9d9d9d'
  const axisLine = { lineStyle: { color: '#3c3c3c' } }
  const base = {
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontSize: 11 },
    grid: { left: 48, right: 16, top: 28, bottom: 40 },
    tooltip: { trigger: 'axis' as const },
  }

  if (chart.type === 'pie') {
    const counts = new Map<string, number>()
    for (const row of data.rows) {
      const key = row[xi] == null ? 'NULL' : String(row[xi])
      const add = yi >= 0 ? (toNum(row[yi]) ?? 1) : 1
      counts.set(key, (counts.get(key) ?? 0) + add)
    }
    const pieData = [...counts.entries()].map(([name, value]) => ({
      name,
      value,
    }))
    return {
      ...base,
      tooltip: { trigger: 'item' as const },
      series: [
        {
          type: 'pie',
          radius: ['35%', '70%'],
          data: pieData,
          label: { color: textColor, fontSize: 10 },
        },
      ],
    }
  }

  if (chart.type === 'heatmap') {
    if (yi < 0 || si < 0) return null
    const xs: string[] = []
    const ys: string[] = []
    const xSet = new Set<string>()
    const ySet = new Set<string>()
    const cells: [number, number, number][] = []
    for (const row of data.rows) {
      const x = row[xi] == null ? 'NULL' : String(row[xi])
      const y = row[si] == null ? 'NULL' : String(row[si])
      if (!xSet.has(x)) {
        xSet.add(x)
        xs.push(x)
      }
      if (!ySet.has(y)) {
        ySet.add(y)
        ys.push(y)
      }
    }
    const xiMap = new Map(xs.map((v, i) => [v, i]))
    const yiMap = new Map(ys.map((v, i) => [v, i]))
    for (const row of data.rows) {
      const x = row[xi] == null ? 'NULL' : String(row[xi])
      const y = row[si] == null ? 'NULL' : String(row[si])
      const v = toNum(row[yi]) ?? 0
      cells.push([xiMap.get(x)!, yiMap.get(y)!, v])
    }
    return {
      ...base,
      tooltip: { position: 'top' as const },
      xAxis: { type: 'category', data: xs, splitArea: { show: true }, axisLine },
      yAxis: { type: 'category', data: ys, splitArea: { show: true }, axisLine },
      visualMap: {
        min: Math.min(0, ...cells.map((c) => c[2])),
        max: Math.max(1, ...cells.map((c) => c[2])),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        textStyle: { color: textColor },
        inRange: { color: ['#1e3a4c', '#0e639c', '#4ec9b0'] },
      },
      series: [
        {
          type: 'heatmap',
          data: cells,
          label: { show: false },
        },
      ],
    }
  }

  if (chart.type === 'scatter') {
    if (yi < 0) return null
    const points = data.rows
      .map((row) => {
        const x = toNum(row[xi])
        const y = toNum(row[yi])
        if (x == null || y == null) return null
        return [x, y]
      })
      .filter((p): p is number[] => p != null)
    return {
      ...base,
      xAxis: {
        type: 'value',
        axisLine,
        splitLine: { lineStyle: { color: '#2a2a2a' } },
      },
      yAxis: {
        type: 'value',
        axisLine,
        splitLine: { lineStyle: { color: '#2a2a2a' } },
      },
      series: [
        {
          type: 'scatter',
          data: points,
          itemStyle: { color: SERIES_COLORS[0] },
        },
      ],
    }
  }

  // bar / line / area — one series per Y (or count of 1 when none)
  const categories = data.rows.map((row) =>
    row[xi] == null ? 'NULL' : String(row[xi]),
  )
  const seriesType =
    chart.type === 'area' ? 'line' : chart.type === 'line' ? 'line' : 'bar'

  const seriesNames = yNames.length > 0 ? yNames : ['count']
  const series = seriesNames.map((name, i) => {
    const color = SERIES_COLORS[i % SERIES_COLORS.length]
    const values =
      yNames.length === 0
        ? data.rows.map(() => 1)
        : data.rows.map((row) => {
            const idx = colIndex(data, name)
            return idx >= 0 ? (toNum(row[idx]) ?? 0) : 0
          })
    return {
      name,
      type: seriesType,
      data: values,
      areaStyle: chart.type === 'area' ? { opacity: 0.25, color } : undefined,
      itemStyle: { color },
      lineStyle: { color },
      smooth: chart.type !== 'bar',
    }
  })

  return {
    ...base,
    legend:
      series.length > 1
        ? {
            data: seriesNames,
            top: 0,
            textStyle: { color: textColor, fontSize: 10 },
            itemWidth: 10,
            itemHeight: 8,
          }
        : undefined,
    grid: {
      ...base.grid,
      top: series.length > 1 ? 36 : 24,
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine,
      axisLabel: { color: textColor, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine,
      splitLine: { lineStyle: { color: '#2a2a2a' } },
      axisLabel: { color: textColor, fontSize: 10 },
    },
    series,
  }
}
