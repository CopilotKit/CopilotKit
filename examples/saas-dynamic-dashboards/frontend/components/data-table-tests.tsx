"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PRData, TestsData } from "@/app/Interfaces/interface"
import React, { useEffect, useState } from "react"
import { Button } from "./ui/button"
import { codeSnippets } from "@/public/snippets"
import { Checkbox } from "./ui/checkbox"
import { ActionRenderPropsWait } from "@copilotkit/react-core"
import { PlayCircle, Loader2, CheckCircle2, XCircle } from "lucide-react"
import { ChatGrid } from "./data-chat-grid"

interface DataTableProps {
  columns: {
    accessorKey: string
    header: string
  }[]
  data: TestsData[],
  onToggle: (testSuite: TestsData[]) => void,
  setTestsData: (testsData: TestsData[]) => void,
  testsData: TestsData[]
}

export function DataTable({ columns, data, onToggle, setTestsData, testsData }: DataTableProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [testSuite, setTestSuite] = useState<TestsData[]>(data || [])
  const [testSuiteToMove, setTestSuiteToMove] = useState<TestsData[]>([])
  const [testStatus, setTestStatus] = useState<{ [key: number]: 'idle' | 'running' | 'passed' | 'failed' }>({});
  const [testCaseStatus, setTestCaseStatus] = useState<{ [rowIndex: number]: string[] }>({});
  const [snippetsHandler, setSnippetsHandler] = useState<TestsData[]>([])
  // Get all possible keys from data (assuming all rows have same keys)
  const allKeys = data.length > 0 ? Object.keys(data[0]) : [];
  const mainKeys = columns.map(col => col.accessorKey);
  const extraKeys = allKeys.filter(key => !mainKeys.includes(key));

  useEffect(() => {
    setTestSuite(data)
    setTestStatus(prev => ({
      ...prev,
      ...Object.fromEntries(data.map((item, index) => [index, item.status]))
    }))
  }, [data])

  const handleRowClick = (rowIndex: number) => {
    setExpandedRow(expandedRow === rowIndex ? null : rowIndex);
  };

  // Handler for play icon
  const runTest = (rowIndex: number, row: TestsData) => {
    if (testStatus[rowIndex] === 'running') return;
    setTestStatus(prev => ({ ...prev, [rowIndex]: 'running' }));
    setTestCaseStatus(prev => ({
      ...prev,
      [rowIndex]: testSuite[rowIndex]?.testCases.map(() => 'running')
    }));
    setTimeout(() => {
      const isPassed = Math.random() > 0.5;
      setTestStatus(prev => ({ ...prev, [rowIndex]: isPassed ? 'passed' : 'failed' }));
      setTestCaseStatus(prev => ({
        ...prev,
        [rowIndex]: testSuite[rowIndex]?.testCases.map(() => isPassed ? 'passed' : 'failed')
      }));

      const suiteToMove = testSuite[rowIndex];
      console.log(suiteToMove, "suiteToMove", rowIndex);

      if (suiteToMove) {
        // onToggle([...testSuite.filter((_, idx) => idx !== rowIndex)])
        console.log(suiteToMove, "suiteToMove");
        suiteToMove.testCases.forEach(element => {
          element.status = isPassed ? 'passed' : 'failed'
        });
        suiteToMove.status = isPassed ? 'passed' : 'failed'
        console.log(testSuiteToMove, "testSuiteToMove");

        setTestSuiteToMove([...testSuiteToMove, {
          title: suiteToMove.title,
          status: suiteToMove.status,
          shortDescription: suiteToMove.shortDescription,
          testCases: suiteToMove.testCases,
          testId: suiteToMove.testId,
          prId: suiteToMove.prId,
          failedTestCases: suiteToMove.failedTestCases,
          passedTestCases: suiteToMove.passedTestCases,
          skippedTestCases: suiteToMove.skippedTestCases,
          totalTestCases: suiteToMove.totalTestCases,
          codeSnippet: suiteToMove.codeSnippet,
          executedBy: suiteToMove.executedBy,
          coverage: suiteToMove.coverage,
          createdAt: suiteToMove.createdAt,
          updatedAt: suiteToMove.updatedAt,
        }]);
      }
    }, 2000);
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead className="font-bold" key={column.accessorKey}>{column.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {testSuite.length == 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center text-gray-400 py-8">
                No test data available.
              </TableCell>
            </TableRow>
          ) : (
            testSuite.map((row, rowIndex) => (
              <React.Fragment key={rowIndex}>
                <TableRow
                  className="hover:bg-gray-50 transition"
                  onClick={() => handleRowClick(rowIndex)}
                  style={{ cursor: 'default' }}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.accessorKey}
                      className={
                        column.accessorKey === "status"
                          ? "w-[40px] text-center"
                          : column.accessorKey === "testName"
                            ? "min-w-[300px]"
                            : column.accessorKey === "assignedTo"
                              ? "w-[180px]"
                              : column.accessorKey === "prRef"
                                ? "w-[100px]"
                                : column.accessorKey === "testId"
                                  ? "w-[90px]"
                                  : ""
                      }
                    >
                      {column.accessorKey === "status" ? (
                        <div className="flex items-center justify-center">
                          {testStatus[rowIndex] === 'running' ? (
                            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                          ) : testStatus[rowIndex] === 'passed' ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          ) : testStatus[rowIndex] === 'failed' ? (
                            <XCircle className="w-5 h-5 text-red-600" />
                          ) : (
                            <PlayCircle
                              className="w-5 h-5 text-blue-600 hover:text-blue-700 cursor-pointer"
                              onClick={e => {
                                e.stopPropagation();
                                if (!Object.values(testStatus).some(status => (status === 'running'))) {
                                  runTest(rowIndex, row);
                                }
                              }}
                            />
                          )}
                        </div>
                      ) : (
                        String(row[column.accessorKey as keyof TestsData])
                      )}
                    </TableCell>
                  ))}
                </TableRow>
                {expandedRow === rowIndex && (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="!p-0 border-t-0"
                      style={{ background: 'none' }}
                    >
                      <div className="relative bg-gray-50 dark:bg-[#f5f7fa]/10 rounded-b-lg shadow-sm mx-2 my-2 p-6 border-2 border-dotted border-gray-300 dark:border-gray-600">
                        <div className="font-semibold mb-2 text-gray-800 dark:text-gray-100">Description:</div>
                        <div className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                          {row.shortDescription || "No description available."}
                        </div>
                        <div className="font-semibold mb-2 text-gray-800 dark:text-gray-100">Code Snippet:</div>
                        <pre className="bg-gray-100 dark:bg-[#181f2a] rounded p-3 mb-4 overflow-x-auto text-xs border border-gray-200 dark:border-gray-700">
                          {codeSnippets[Math.floor(Math.random() * codeSnippets.length)]}
                        </pre>
                        <div className="font-semibold mb-2 text-gray-800 dark:text-gray-100">Test Cases:</div>
                        <ul className="space-y-1">
                          {row.testCases.map((tc, idx) => (
                            <li key={tc.id} className="flex items-center gap-2">
                              <StatusBadge status={testCaseStatus[rowIndex]?.[idx] || tc.status} />
                              <span>{tc.name}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          )}
        </TableBody>
      </Table>
      <div className="flex justify-center my-4">
        <Button
          variant="outline"
          className="mt-4"
          disabled={Object.values(testStatus).length == 0 || Object.values(testStatus).some(status => (status === 'idle' || status === 'running'))}
          onClick={() => {
            onToggle([])
            setTestSuite([])
            setTestsData([...testsData, ...testSuiteToMove])
            setTestSuiteToMove([])
            setTestStatus({})
          }}
        >
          Move Completed Tests to Results
        </Button>
      </div>
    </div>
  )
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'in_progress':
      return 'bg-blue-100 text-blue-700';
    case 'passed':
      return 'bg-green-100 text-green-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    case 'skipped':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={`px-2 py-1 rounded-full text-xs font-medium text-center ${getStatusColor(status)}`}
    >
      {status.split("_").join(" ")}
    </Badge>
  )
}

