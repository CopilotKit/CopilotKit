"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/data-table-results"
import { DataTable as DataTableTests } from "@/components/data-table-tests"
import { DataChart } from "@/components/data-chart"
import { Button } from "@/components/ui/button"
import { BarChart3, Table2,Code2 } from "lucide-react"
import { getTestsService } from "@/app/Services/service"
import Loader from "./ui/loader"
import { testData } from "@/lib/testData"
import { DataCode } from "./data-code"
import { useCoAgentStateRender } from "@copilotkit/react-core"
import { ChatGrid } from "./data-chat-grid"
import { useCopilotChatSuggestions } from "@copilotkit/react-ui"
import { testerPersonaSuggestions } from "@/lib/prompts"
// Sample data for the tester dashboard
const tableColumns = [
  {
    accessorKey: "testId",
    header: "Test ID",
  },
  {
    accessorKey: "title",
    header: "Test Name",
  },
  {
    accessorKey: "prId",
    header: "PR Ref",
  },
  {
    accessorKey: "executedBy",
    header: "Run By",
  },
  {
    accessorKey: "status",
    header: "Status",
  },
]

const tableColumnsTests = [
  {
    accessorKey: "testId",
    header: "Test ID",
  },
  {
    accessorKey: "title",
    header: "Test Name",
  },
  {
    accessorKey: "prId",
    header: "PR Ref",
  },
  {
    accessorKey: "executedBy",
    header: "Assigned To",
  },
  {
    accessorKey: "status",
    header: "Action",
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
  const [viewMode, setViewMode] = useState<"results" | "tests" | "code">("results")
  const [testsData, setTestsData] = useState<any>([])
  const [testSuites, setTestSuites] = useState<any>([])
  const [loading, setLoading] = useState(true)
  const [testCaseStatus, setTestCaseStatus] = useState<{ [rowIndex: number]: string[] }>({})

  useCopilotChatSuggestions({
    available: "enabled",
    instructions: testerPersonaSuggestions,
    minSuggestions: 2,
    maxSuggestions: 4,
  })

  useCoAgentStateRender({
    name: "testing_agent",
    render: (props) => {
      return <ChatGrid 
        status={props.status} 
        state={props.state} 
        testSuite={testSuites} 
        setTestSuite={setTestSuites} 
        testCaseStatus={testCaseStatus} 
        setTestCaseStatus={setTestCaseStatus} 
      />
    }
  })

  useEffect(() => {
    getTests()
  }, [])

  async function getTests() {
    // const tests = await getTestsService()
    const tests = testData
    console.log(tests)
    setTestsData(tests)
    setLoading(false)
  }
  return (
    <div className="space-y-6">
      {loading && <Loader />}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Tester Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant={viewMode === "code" ? "default" : "outline"} size="sm" onClick={() => setViewMode("code")}>
            <Code2 className=" h-4 w-4" />
            Code
          </Button>
          <Button variant={viewMode === "results" ? "default" : "outline"} size="sm" onClick={() => setViewMode("results")}>
            <Table2 className="mr-2 h-4 w-4" />
            Results
          </Button>
          <Button variant={viewMode === "tests" ? "default" : "outline"} size="sm" onClick={() => setViewMode("tests")}>
            <Table2 className="mr-2 h-4 w-4" />
            Tests
          </Button>
          {/* <Button variant={viewMode === "chart" ? "default" : "outline"} size="sm" onClick={() => setViewMode("chart")}>
            <BarChart3 className="mr-2 h-4 w-4" />
            Chart
          </Button> */}
        </div>
      </div>

      <Card>
        <CardHeader>
          {viewMode != "code" && <><CardTitle>{viewMode === "results" ? "Test Results" : "Testing Grounds"}</CardTitle>
          <CardDescription>{viewMode === "results" ? "Monitor test results and performance metrics" : "Perform testing on the latest PRs"}</CardDescription></>}
        </CardHeader>
        <CardContent>
          {viewMode === "results" ? (
            <DataTable columns={tableColumns} data={testsData} />
          ) : viewMode === "tests" ? (
            <DataTableTests columns={tableColumnsTests} data={testSuites} onToggle={setTestSuites} setTestsData= {setTestsData} testsData={testsData}/>
          ) : (
            <DataCode />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
