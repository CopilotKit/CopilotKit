"use client"

import { Bar, BarChart as RechartsBarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

// Define a generic type for chart data
interface ChartDataItem {
  [key: string]: string | number;
}

interface BarChartProps {
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
  layout?: "horizontal" | "vertical"
}

export function BarChart({
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
  layout = "horizontal",
}: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%" className={className}>
      <RechartsBarChart 
        data={data} 
        layout={layout}
        margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
      >
        {showGrid && <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />}
        
        {showXAxis && (
          <XAxis 
            dataKey={index} 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: "#6b7280", fontSize: 12 }}
            dy={10}
            type={layout === "horizontal" ? "category" : "number"}
          />
        )}
        
        {showYAxis && (
          <YAxis 
            tickFormatter={valueFormatter} 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: "#6b7280", fontSize: 12 }}
            width={yAxisWidth}
            type={layout === "horizontal" ? "number" : "category"}
          />
        )}
        
        <Tooltip 
          formatter={(value: number) => [valueFormatter(value), ""]}
          labelFormatter={(value) => `${value}`}
          separator=""
          itemStyle={{ padding: "2px 0" }}
          cursor={{ fill: "rgba(236, 236, 236, 0.4)" }}
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
          <Bar 
            key={category} 
            dataKey={category} 
            fill={colors[i % colors.length]}
            fillOpacity={0.1}
            stroke={colors[i % colors.length]}
            strokeWidth={2}
            radius={[4, 4, 0, 0]} 
            barSize={layout === "horizontal" ? 30 : 20}
            animationDuration={500}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  )
} 