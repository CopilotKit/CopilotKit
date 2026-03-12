import {
  PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area,
} from 'recharts'
import type { Incident } from '../../types/incident'
import './IncidentCharts.css'

const CHART_WIDTH = 268
const CHART_HEIGHT = 200

const SEVERITY_COLORS: Record<string, string> = {
  P0: '#ef4444',
  P1: '#f97316',
  P2: '#eab308',
  P3: '#3b82f6',
  P4: '#94a3b8',
}

const STATUS_COLORS: Record<string, string> = {
  Open: '#ef4444',
  Investigating: '#f97316',
  Mitigated: '#eab308',
  Resolved: '#22c55e',
}

interface ChartProps {
  incidents: Incident[]
}

export function SeverityDistributionChart({ incidents }: ChartProps) {
  const data = Object.entries(
    incidents.reduce<Record<string, number>>((acc, i) => {
      acc[i.severity] = (acc[i.severity] || 0) + 1
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value }))

  return (
    <div className="chart-container">
      <div className="chart-title">Incidents by Severity</div>
      <PieChart width={CHART_WIDTH} height={CHART_HEIGHT}>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={70}
          dataKey="value"
          label={({ name, value }) => `${name}: ${value}`}
          labelLine={false}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] || '#94a3b8'} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </div>
  )
}

export function StatusBreakdownChart({ incidents }: ChartProps) {
  const data = Object.entries(
    incidents.reduce<Record<string, number>>((acc, i) => {
      acc[i.status] = (acc[i.status] || 0) + 1
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value }))

  return (
    <div className="chart-container">
      <div className="chart-title">Incidents by Status</div>
      <BarChart width={CHART_WIDTH} height={CHART_HEIGHT} data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#6366f1'} />
          ))}
        </Bar>
      </BarChart>
    </div>
  )
}

export function IncidentTimelineChart({ incidents }: ChartProps) {
  const buckets: Record<string, number> = {}
  incidents.forEach(i => {
    const d = new Date(i.timestamps.created)
    const key = `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:00`
    buckets[key] = (buckets[key] || 0) + 1
  })

  const data = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, count]) => ({ time, count }))

  return (
    <div className="chart-container">
      <div className="chart-title">Incident Timeline</div>
      <AreaChart width={CHART_WIDTH} height={CHART_HEIGHT} data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="time" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Area type="monotone" dataKey="count" stroke="#6366f1" fill="#818cf8" fillOpacity={0.3} />
      </AreaChart>
    </div>
  )
}

export function ServiceImpactChart({ incidents }: ChartProps) {
  const serviceCounts: Record<string, number> = {}
  incidents.forEach(i => {
    i.affectedServices.forEach(s => {
      serviceCounts[s] = (serviceCounts[s] || 0) + 1
    })
  })

  const data = Object.entries(serviceCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([service, count]) => ({ service, count }))

  if (data.length === 0) {
    return (
      <div className="chart-container">
        <div className="chart-title">Most Affected Services</div>
        <div className="chart-loading">No service data available</div>
      </div>
    )
  }

  const chartHeight = Math.max(150, data.length * 32 + 40)

  return (
    <div className="chart-container">
      <div className="chart-title">Most Affected Services</div>
      <BarChart width={CHART_WIDTH} height={chartHeight} data={data} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="service" tick={{ fontSize: 10 }} width={80} />
        <Tooltip />
        <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
      </BarChart>
    </div>
  )
}
