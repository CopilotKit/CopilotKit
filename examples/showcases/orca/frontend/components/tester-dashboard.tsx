"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/data-table"
import { DataChart } from "@/components/data-chart"
import { Button } from "@/components/ui/button"
import { BarChart3, Table2 } from "lucide-react"

// Sample data for the tester dashboard
const tableColumns = [
  {
    accessorKey: "id",
    header: "Test ID",
  },
  {
    accessorKey: "name",
    header: "Test Name",
  },
  {
    accessorKey: "status",
    header: "Status",
  },
  {
    accessorKey: "duration",
    header: "Duration",
  },
  {
    accessorKey: "lastRun",
    header: "Last Run",
  },
]

const tableData = [
  {
    id: "TEST-1001",
    name: "API Authentication Tests",
    status: "Passed",
    duration: "12s",
    lastRun: "1 hour ago",
  },
  {
    id: "TEST-1002",
    name: "User Registration Flow",
    status: "Failed",
    duration: "45s",
    lastRun: "3 hours ago",
  },
  {
    id: "TEST-1003",
    name: "Payment Processing Tests",
    status: "Passed",
    duration: "28s",
    lastRun: "2 hours ago",
  },
  {
    id: "TEST-1004",
    name: "Notification Delivery Tests",
    status: "Passed",
    duration: "18s",
    lastRun: "4 hours ago",
  },
  {
    id: "TEST-1005",
    name: "Data Export Functionality",
    status: "Warning",
    duration: "56s",
    lastRun: "5 hours ago",
  },
]

const chartData = [
  {
    name: "Mon",
    Passed: 42,
    Failed: 8,
    Skipped: 5,
  },
  {
    name: "Tue",
    Passed: 45,
    Failed: 5,
    Skipped: 3,
  },
  {
    name: "Wed",
    Passed: 48,
    Failed: 7,
    Skipped: 4,
  },
  {
    name: "Thu",
    Passed: 51,
    Failed: 4,
    Skipped: 2,
  },
  {
    name: "Fri",
    Passed: 47,
    Failed: 6,
    Skipped: 3,
  },
  {
    name: "Sat",
    Passed: 44,
    Failed: 3,
    Skipped: 2,
  },
  {
    name: "Sun",
    Passed: 50,
    Failed: 2,
    Skipped: 1,
  },
]

export function TesterDashboard() {
  const [viewMode, setViewMode] = useState<"table" | "chart">("table")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Tester Dashboard</h1>
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
            <CardTitle>Test Coverage</CardTitle>
            <CardDescription>Overall code coverage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">87.2%</div>
            <p className="text-xs text-muted-foreground">+2.5% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Test Success Rate</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">92.8%</div>
            <p className="text-xs text-muted-foreground">-0.7% from last week</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Avg. Test Duration</CardTitle>
            <CardDescription>Per test case</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">24s</div>
            <p className="text-xs text-muted-foreground">-3s from last month</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Test Results</CardTitle>
          <CardDescription>Monitor test results and performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          {viewMode === "table" ? (
            <DataTable columns={tableColumns} data={tableData} />
          ) : (
            <DataChart data={chartData} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
