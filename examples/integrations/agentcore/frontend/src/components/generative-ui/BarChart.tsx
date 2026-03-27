interface Bar {
  label: string
  value: number
  color?: string
}

interface BarChartProps {
  title?: string
  data: Bar[]
  unit?: string
}

export function BarChart({ title, data, unit = "" }: BarChartProps) {
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1)

  return (
    <div className="my-3 p-4 rounded-xl border bg-white dark:bg-zinc-900 shadow-sm max-w-sm">
      {title && <p className="text-sm font-semibold mb-3">{title}</p>}
      <div className="space-y-2">
        {data.map((bar, i) => {
          const pct = (Math.abs(bar.value) / max) * 100
          const color = bar.color ?? "#6366f1"
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-right truncate text-gray-600 dark:text-gray-400 shrink-0">
                {bar.label}
              </span>
              <div className="flex-1 bg-gray-100 dark:bg-zinc-800 rounded-full h-4 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
              <span className="w-16 text-right font-mono text-gray-500 shrink-0">
                {bar.value.toLocaleString()}{unit}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
