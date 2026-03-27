interface Slice {
  label: string
  value: number
  color?: string
}

interface PieChartProps {
  title?: string
  data: Slice[]
}

const DEFAULT_COLORS = [
  "#6366f1", "#22d3ee", "#f59e0b", "#10b981", "#f43f5e",
  "#8b5cf6", "#14b8a6", "#fb923c", "#84cc16", "#ec4899",
]

export function PieChart({ title, data }: PieChartProps) {
  const total = data.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return null

  let cumulative = 0
  const slices = data.map((slice, i) => {
    const pct = slice.value / total
    const start = cumulative
    cumulative += pct
    const color = slice.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]
    return { ...slice, pct, start, color }
  })

  const polarToXY = (pct: number, r: number) => {
    const angle = pct * 2 * Math.PI - Math.PI / 2
    return [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)]
  }

  return (
    <div className="my-3 p-4 rounded-xl border bg-white dark:bg-zinc-900 shadow-sm max-w-xs">
      {title && <p className="text-sm font-semibold mb-3 text-center">{title}</p>}
      <svg viewBox="0 0 100 100" className="w-32 h-32 mx-auto">
        {slices.map((s, i) => {
          if (s.pct === 1) {
            return <circle key={i} cx="50" cy="50" r="40" fill={s.color} />
          }
          const [x1, y1] = polarToXY(s.start, 40)
          const [x2, y2] = polarToXY(s.start + s.pct, 40)
          const large = s.pct > 0.5 ? 1 : 0
          return (
            <path
              key={i}
              d={`M50,50 L${x1},${y1} A40,40 0 ${large},1 ${x2},${y2} Z`}
              fill={s.color}
            />
          )
        })}
      </svg>
      <ul className="mt-3 space-y-1">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="truncate text-gray-700 dark:text-gray-300">{s.label}</span>
            <span className="ml-auto font-mono text-gray-500">{(s.pct * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
