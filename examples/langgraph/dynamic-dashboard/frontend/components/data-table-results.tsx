"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PRData, TestsData } from "@/app/Interfaces/interface"
import React, { useEffect, useState } from "react"
import { useCoAgent, useCoAgentStateRender } from "@copilotkit/react-core"
import { Checkbox } from "@/components/ui/checkbox"

interface DataTableProps {
  columns: {
    accessorKey: string
    header: string
  }[]
  data: TestsData[]
}

export function DataTable({ columns, data }: DataTableProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  // Get all possible keys from data (assuming all rows have same keys)
  const allKeys = data.length > 0 ? Object.keys(data[0]) : [];
  const mainKeys = columns.map(col => col.accessorKey);
  const extraKeys = allKeys.filter(key => !mainKeys.includes(key));

  
  const handleRowClick = (rowIndex: number) => {
    setExpandedRow(expandedRow === rowIndex ? null : rowIndex);
  };

  return (
    <div className="rounded-md border w-full min-w-[700px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]">
              <Checkbox 
                className="rounded-md border-gray-300 dark:border-gray-600"
                onCheckedChange={(checked) => {
                  // Handle select all logic here
                }}
              />
            </TableHead>
            <TableHead>Test Id</TableHead>
            <TableHead>Test Cases</TableHead>
            <TableHead>PR Ref</TableHead>
            <TableHead>Executed By</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center text-gray-400 py-8">
                No test data available.
              </TableCell>
            </TableRow>
          ) : (
            data.map((row, rowIndex) => (
              <React.Fragment key={rowIndex}>
                <TableRow
                  className="cursor-pointer hover:bg-gray-50 transition"
                  onClick={() => handleRowClick(rowIndex)}
                >
                  <TableCell className="w-[50px]">
                    <Checkbox 
                      className="rounded-md border-gray-300 dark:border-gray-600"
                      onCheckedChange={(checked) => {
                        // Handle individual checkbox logic here
                        event?.stopPropagation(); // Prevent row click when clicking checkbox
                      }}
                      onClick={(e) => e.stopPropagation()} // Prevent row click when clicking checkbox
                    />
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.accessorKey} className="w-2">
                      {column.accessorKey === "status" ? (
                        <StatusBadge status={row[column.accessorKey as keyof TestsData] as string} />
                      ) : column.accessorKey === "testCases" ? (
                        `${row.testCases.length} cases`
                      ) : (
                        String(row[column.accessorKey as keyof TestsData])
                      )}
                    </TableCell>
                  ))}
                </TableRow>
                {expandedRow === rowIndex && extraKeys.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="bg-gray-50 dark:bg-[#181f2a] p-0 border-t-0">
                      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Coverage:</span>
                          <span className="font-semibold">{row.coverage}%</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Created:</span>
                          <span className="font-semibold">{new Date(row.createdAt).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Updated:</span>
                          <span className="font-semibold">{new Date(row.updatedAt).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Test Cases:</span>
                          <span className="font-semibold">
                            {row.passedTestCases} Passed, {row.failedTestCases} Failed, {row.skippedTestCases} Skipped
                          </span>
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="font-semibold mb-2">Test Cases:</div>
                        <ul className="space-y-1">
                          {row.testCases.map(tc => (
                            <li key={tc.id} className="flex items-center gap-2">
                              <StatusBadge status={tc.status} />
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
    </div>
  )
}

export const getStatusColor = (status: string) => {
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
