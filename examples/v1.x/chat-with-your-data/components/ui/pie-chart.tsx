"use client"

import { Cell, Legend, Pie, PieChart as RechartsPieChart, ResponsiveContainer, Tooltip, Text } from "recharts"

// Define a generic type for chart data
interface ChartDataItem {
  [key: string]: string | number;
}

// Define tooltip props
interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  valueFormatter?: (value: number) => string;
}

// Custom tooltip component for the pie chart
const CustomTooltip = ({ active, payload, valueFormatter }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-2 border border-gray-200 rounded-md shadow-sm text-sm">
        <p className="font-medium text-gray-700">{payload[0].name}</p>
        <p style={{ color: payload[0].color }}>{valueFormatter ? valueFormatter(payload[0].value) : `${payload[0].value}%`}</p>
      </div>
    );
  }
  return null;
};

interface PieChartProps {
  data: ChartDataItem[]
  category: string
  index: string
  colors?: string[]
  valueFormatter?: (value: number) => string
  className?: string
  innerRadius?: number
  outerRadius?: string | number
  paddingAngle?: number
  showLabel?: boolean
  showLegend?: boolean
  centerText?: string
}

// Define label props
interface CustomizedLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  // Removing the unused 'name' parameter
}

const RADIAN = Math.PI / 180
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: CustomizedLabelProps) => {
  const radius = Number(innerRadius) + (Number(outerRadius) - Number(innerRadius)) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={12}
      fontWeight={500}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export function PieChart({
  data,
  category,
  index,
  colors = ["#3b82f6", "#64748b", "#10b981", "#f59e0b", "#94a3b8"],
  valueFormatter = (value: number) => `${value}`,
  className,
  innerRadius = 0,
  outerRadius = "80%",
  paddingAngle = 2,
  showLabel = true,
  showLegend = true,
  centerText,
}: PieChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%" className={className}>
      <RechartsPieChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
        <Pie
          data={data}
          dataKey={category}
          nameKey={index}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={paddingAngle}
          label={showLabel ? renderCustomizedLabel : undefined}
          labelLine={false}
        >
          {data.map((entry, index) => (
            <Cell 
              key={`cell-${index}`} 
              fill={colors[index % colors.length]} 
              fillOpacity={0.1}
              stroke={colors[index % colors.length]}
              strokeWidth={3}
            />
          ))}
          {centerText && (
            <Text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-lg font-medium"
              fill="#374151"
            >
              {centerText}
            </Text>
          )}
        </Pie>
        <Tooltip content={<CustomTooltip valueFormatter={valueFormatter} />} />
        {showLegend && (
          <Legend 
            layout="horizontal" 
            verticalAlign="bottom" 
            align="center"
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>{value}</span>
            )}
          />
        )}
      </RechartsPieChart>
    </ResponsiveContainer>
  )
}

export function DonutChart(props: PieChartProps) {
  return (
    <PieChart 
      {...props} 
      innerRadius={props.innerRadius || 40}
      outerRadius={props.outerRadius || "85%"}
      showLabel={props.showLabel !== undefined ? props.showLabel : false}
      showLegend={props.showLegend !== undefined ? props.showLegend : true}
    />
  )
} 