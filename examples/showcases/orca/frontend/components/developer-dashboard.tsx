"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/data-table"
import { DataChart } from "@/components/data-chart"
import { Button } from "@/components/ui/button"
import { BarChart3, Table2, Filter } from "lucide-react"
import { getPRDataService } from "@/app/Services/service"
import { PRData } from "@/app/Interfaces/interface"
import { useSharedContext } from "@/lib/shared-context"
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core"
import { PieChart, Pie, Cell, Tooltip } from "recharts"
import { PRPieData } from "./pr-pie-all-data"
import { PRReviewBarData } from "./pr-review-bar-data"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { PRPieFilterData } from "./pr-pie-filter-data"
import { PRLineChartData } from "./pr-line-chart-data"
import { Loader } from "./ui/loader"
// Sample data for the developer dashboard
const tableColumns = [
  {
    accessorKey: "id",
    header: "ID",
  },
  {
    accessorKey: "title",
    header: "TITLE",
  },
  {
    accessorKey: "author",
    header: "AUTHOR",
  },
  {
    accessorKey: "repository",
    header: "REPOSITORY",
  },
  {
    accessorKey: "status",
    header: "STATUS",
  },
]
const chartData = [
  {
    name: "Mon",
    "Build Time": 45,
    "Test Coverage": 78,
  },
  {
    name: "Tue",
    "Build Time": 52,
    "Test Coverage": 82,
  },
  {
    name: "Wed",
    "Build Time": 48,
    "Test Coverage": 85,
  },
  {
    name: "Thu",
    "Build Time": 61,
    "Test Coverage": 79,
  },
  {
    name: "Fri",
    "Build Time": 55,
    "Test Coverage": 83,
  },
  {
    name: "Sat",
    "Build Time": 42,
    "Test Coverage": 86,
  },
  {
    name: "Sun",
    "Build Time": 38,
    "Test Coverage": 90,
  },
]

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

export function DeveloperDashboard() {
  const { prData, setPrData } = useSharedContext()
  const [filteredData, setFilteredData] = useState<PRData[]>([])
  const [filterParams, setFilterParams] = useState<{ status: string, author: string }>({ status: "a", author: "b" })
  const [viewMode, setViewMode] = useState<"table" | "chart">("table")
  const [isLoading, setIsLoading] = useState(true)
  const ref1 = useRef(null)
  const ref2 = useRef(null)
  useEffect(() => {
    getPRData()
  }, [])

  useCopilotReadable({
    description: "A list of all the PR Data",
    value: JSON.stringify(prData)
  })

  useCopilotAction({
    name: "GenerateChartBasedOnUserPRData",
    description: `Generate a pie-chart based on the PR data for a user`,
    parameters: [
      {
        name: "userId",
        type: "number",
        description: "The id of the user for whom the PR data is to be fetched",
      }
    ],
    render: ({ args }: any) => {
      return <PRPieData args={args} />
    }
  })

  useCopilotAction({
    name: "GenerateChartBasedOnPRReviewStatus",
    description: `Generate a bar-chart based on the PR data which are only in needs_revision or in_review status for specific user`,
    parameters: [
      {
        name: "userId",
        type: "number",
        description: "The id of the user for whom the PR data is to be fetched",
      }
    ],
    render: ({ args }: any) => {
      return <PRReviewBarData args={args} />
    }
  })

  useCopilotAction({
    name: "GenerateChartBasedOnFilteredDateAndTime",
    description: `Generate a Pie-chart based on the PR data which lies between the given date and time`,
    parameters: [
      {
        name: "userId",
        type: "number",
        description: "The id of the user for whom the PR data is to be fetched",
      },
      {
        name: "dayCount",
        type: "number",
        description: "The number of days to be considered for the PR data"
      }
    ],
    render: ({ args }: any) => {
      return <PRPieFilterData args={args} />
    }
  })

  useCopilotAction({
    name: "GenerateLineChartToShowPRCreationTrend",
    description: `Generate a Line-chart based on the PR data which shows the trend of PR creation over time`,
    parameters: [
      {
        name: "userId",
        type: "number",
        description: "The id of the user for whom the PR data is to be fetched",
      }
    ],
    render: ({ args }: any) => {
      return <PRLineChartData args={args} />
    }
  })


  async function getPRData() {
    try {
      const res = await getPRDataService()
      setPrData(res)
      setFilteredData(res)
      setIsLoading(false)
    } catch (error) {
      console.log(error)
    }
  }


  return (
    <div className="space-y-6">
      {isLoading && <Loader />}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Developer Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant={viewMode === "table" ? "default" : "outline"} size="sm" onClick={() => setViewMode("table")}>
            <Table2 className="mr-2 h-4 w-4" />
            Table
          </Button>
          <Button variant={viewMode === "chart" ? "default" : "outline"} size="sm" onClick={() => setViewMode("chart")}>
            <BarChart3 className="mr-2 h-4 w-4" />
            Chart
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Repositories</CardTitle>
            <CardDescription>Total active repositories</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">12</div>
            <p className="text-xs text-muted-foreground">+2 from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Build Success Rate</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">94.3%</div>
            <p className="text-xs text-muted-foreground">+1.2% from last week</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Code Quality</CardTitle>
            <CardDescription>Average score</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">A+</div>
            <p className="text-xs text-muted-foreground">Improved from A</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Repository Performance</CardTitle>
          <CardDescription>Monitor build times and test coverage across repositories</CardDescription>
          <div className="flex flex-wrap gap-4 mt-4 items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Filters:</span>
            </div>
            <Select>
              {/* <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Repository" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">All Repositories</SelectItem>
                <SelectItem value="frontend">frontend</SelectItem>
                <SelectItem value="backend">backend</SelectItem>
                <SelectItem value="docs">docs</SelectItem>
              </SelectContent> */}
            </Select>
            {viewMode === "table" && <Select value={filterParams.status} onValueChange={(e) => {

              debugger
              console.log(ref2.current);
              
              setFilterParams({ ...filterParams, status: e })
              if (filterParams.author === "b") {
                setFilteredData(prData.filter((pr: PRData) => pr.status.split("_").join(" ").toLowerCase() === e?.toLowerCase()))
              } else {
                setFilteredData(prData.filter((pr: PRData) => pr.status.split("_").join(" ").toLowerCase() === e?.toLowerCase() && pr.author.toLowerCase() === filterParams.author?.toLowerCase()))
              }
            }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent ref={ref1}>
                <SelectItem value="a">All Statuses</SelectItem>
                <SelectItem value="approved">approved</SelectItem>
                <SelectItem value="needs revision">needs revision</SelectItem>
                <SelectItem value="merged">merged</SelectItem>
                <SelectItem value="in review">in review</SelectItem>
              </SelectContent>
            </Select>}
            <Select value={filterParams.author} onValueChange={(e) => {
              debugger
              setFilterParams({ ...filterParams, author: e })
              if (filterParams.status === "a") {
                setFilteredData(prData.filter((pr: PRData) => pr.author.toLowerCase() === e?.toLowerCase()))
              } else {
                setFilteredData(prData.filter((pr: PRData) => pr.status.split("_").join(" ").toLowerCase() === filterParams.status?.toLowerCase() && pr.author.toLowerCase() === e?.toLowerCase()))
              }
              // setFilteredData(prData.filter((pr: PRData) => pr.author.toLowerCase() === e?.toLowerCase()))
            }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Author" />
              </SelectTrigger>
              <SelectContent ref={ref2}>
                <SelectItem value="b">All Authors</SelectItem>
                <SelectItem value="Jon.snow@got.com">Jon.snow@got.com</SelectItem>
                <SelectItem value="robert.baratheon@got.com">robert.baratheon@got.com</SelectItem>
                <SelectItem value="ned.stark@got.com">ned.stark@got.com</SelectItem>
                <SelectItem value="cersei.lannister@got.com">cersei.lannister@got.com</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => { setFilteredData(prData); setFilterParams({ status: "a", author: "b" }) }} variant="ghost" size="sm">Clear Filters</Button>
          </div>
        </CardHeader>
        <CardContent>
          {viewMode === "table" ? (
            <DataTable columns={tableColumns} data={filteredData} />
          ) : (
            <DataChart data={filteredData} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}


