"use client"

// import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "@/components/ui/chart"
import { Pie, PieChart, Cell, Tooltip } from "recharts"
import { useSharedContext } from "@/lib/shared-context"
import { useEffect, useState } from "react"
import { PRData, chartData } from "@/app/Interfaces/interface"
import { CustomPieTooltip } from "./pr-pie-all-data"

interface DataChartProps {
  data: PRData[]
}

export function DataChart({ data }: DataChartProps) {
  // Extract keys excluding 'name'
  // const dataKeys = Object.keys(data[0]).filter((key) => key !== "name")
  const [chartData, setChartData] = useState<chartData[]>([])
  // const {prData} = useSharedContext()
  const status = [{
    name: "approved",
    color: "bg-green-300",
    value: "rgb(134 239 172)"
  }, {
    name: "needs_revision",
    color: "bg-yellow-300",
    value: "rgb(253 224 71)"
  }, {
    name: "merged",
    color: "bg-purple-300",
    value: "rgb(216 180 254)"
  }, {
    name: "in_review",
    color: "bg-blue-300",
    value: "rgb(147 197 253)"
  }]
  useEffect(() => {
    let buffer = status.map((status) => {
      return {
        name: status.name,
        value: data.filter((pr : PRData)  => pr.status === status.name).length
      }
    })
    setChartData(buffer)
  }, [data])

  // Generate colors for each data key
  const colors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ]

  return (
    <>
      {/* <div className="flex-1 p-4 rounded-2xl shadow-lg flex flex-col items-center min-w-[250px] max-w-[350px]"> */}
        {/* <h2 className="text-2xl font-semibold mb-2 text-gray-700 text-center">PR Status Distribution</h2> */}
        <div className="h-[250px] flex flex-col items-center justify-center align-center">
          <PieChart width={260} height={200}>
            <Pie
              data={chartData}
              cx={130}
              cy={90}
              innerRadius={50}
              outerRadius={90}
              fill="#94a3b8"
              paddingAngle={0}
              dataKey="value"
              label
              labelLine={false}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={status.find((status) => status.name === entry.name)?.value} />
              ))}
            </Pie>
            {/* bg-white p-2 rounded shadow text-black */}
            <Tooltip content={<CustomPieTooltip />} />
          </PieChart>
          {/* Custom Legend */}
          <div className="flex flex-row justify-center gap-6 mt-2">
            {chartData.map((entry, idx) => (
              <div key={entry.name} className="flex items-center gap-1">
                <span
                  className={`inline-block w-4 h-4 rounded-full ${status.find((status) => status.name === entry.name)?.color}`}
                />
                <span className="text-sm text-black">{entry.name.split("_").join(" ")}</span>
              </div>
            ))}
          </div>
        </div>
      {/* </div> */}
    </>
  )
}
