import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { PreviewResult } from '../types'
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

export default function TransformChart({ data, chart, onChange }: Props) {
  const colNames = data?.columns.map((c) => c.name) ?? []

  const option = useMemo(() => {
    if (!data || !chart.x) return null
    return buildOption(data, chart)
  }, [data, chart])

  return (
    <div className="transform-chart">
      <div className="transform-chart-toolbar">
        <label className="tf-field">
          <span className="tf-label">Type</span>
          <select
            className="select"
            value={chart.type}
            onChange={(e) =>
              onChange({ ...chart, type: e.target.value as ChartType })
            }
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
        <label className="tf-field">
          <span className="tf-label">Y</span>
          <select
            className="select"
            value={chart.y ?? ''}
            onChange={(e) =>
              onChange({ ...chart, y: e.target.value || null })
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
        {chart.type === 'heatmap' || chart.type === 'bar' || chart.type === 'line' ? (
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
  const yi = chart.y ? colIndex(data, chart.y) : -1
  const si = chart.series ? colIndex(data, chart.series) : -1

  const textColor = '#9d9d9d'
  const axisLine = { lineStyle: { color: '#3c3c3c' } }
  const base = {
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontSize: 11 },
    grid: { left: 48, right: 16, top: 24, bottom: 40 },
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
      xAxis: { type: 'value', axisLine, splitLine: { lineStyle: { color: '#2a2a2a' } } },
      yAxis: { type: 'value', axisLine, splitLine: { lineStyle: { color: '#2a2a2a' } } },
      series: [
        {
          type: 'scatter',
          data: points,
          itemStyle: { color: '#0e639c' },
        },
      ],
    }
  }

  // bar / line / area
  const categories = data.rows.map((row) =>
    row[xi] == null ? 'NULL' : String(row[xi]),
  )
  const values =
    yi >= 0
      ? data.rows.map((row) => toNum(row[yi]) ?? 0)
      : data.rows.map(() => 1)

  const seriesType =
    chart.type === 'area' ? 'line' : chart.type === 'line' ? 'line' : 'bar'

  return {
    ...base,
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
    series: [
      {
        type: seriesType,
        data: values,
        areaStyle: chart.type === 'area' ? { opacity: 0.25 } : undefined,
        itemStyle: { color: '#0e639c' },
        lineStyle: { color: '#4ec9b0' },
        smooth: chart.type !== 'bar',
      },
    ],
  }
}
