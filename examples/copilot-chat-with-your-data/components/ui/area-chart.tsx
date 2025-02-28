"use client"

import { Area, AreaChart as RechartsAreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

// Define a generic type for chart data
interface ChartDataItem {
  [key: string]: string | number;
}

interface AreaChartProps {
  data: ChartDataItem[]
  index: string
  categories: string[]
  colors?: string[]
  valueFormatter?: (value: number) => string
  className?: string
  showLegend?: boolean
  showXAxis?: boolean
  showYAxis?: boolean
  showGrid?: boolean
  yAxisWidth?: number
}

export function AreaChart({
  data,
  index,
  categories,
  colors = ["#3b82f6", "#10b981", "#6366f1", "#f59e0b", "#ef4444"],
  valueFormatter = (value: number) => `${value}`,
  className,
  showLegend = true,
  showXAxis = true,
  showYAxis = true,
  showGrid = true,
  yAxisWidth = 55,
}: AreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%" className={className}>
      <RechartsAreaChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />}
        
        {showXAxis && (
          <XAxis 
            dataKey={index} 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: "#6b7280", fontSize: 12 }}
            dy={10}
          />
        )}
        
        {showYAxis && (
          <YAxis 
            tickFormatter={valueFormatter} 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: "#6b7280", fontSize: 12 }}
            width={yAxisWidth}
          />
        )}
        
        <Tooltip 
          formatter={(value: number) => [valueFormatter(value), ""]}
          labelFormatter={(value) => `${value}`}
          separator=""
          itemStyle={{ padding: "2px 0" }}
          contentStyle={{ 
            backgroundColor: "white", 
            borderRadius: "0.375rem",
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
            padding: "0.5rem 0.75rem",
          }}
        />
        
        {showLegend && (
          <Legend 
            verticalAlign="top" 
            height={36}
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>{value}</span>
            )}
          />
        )}
        
        {categories.map((category, i) => (
          <Area
            key={category}
            type="monotone"
            dataKey={category}
            stroke={colors[i % colors.length]}
            fill={colors[i % colors.length]}
            fillOpacity={0.1}
            strokeWidth={2}
            activeDot={{ r: 6, strokeWidth: 0 }}
          />
        ))}
      </RechartsAreaChart>
    </ResponsiveContainer>
  )
} 