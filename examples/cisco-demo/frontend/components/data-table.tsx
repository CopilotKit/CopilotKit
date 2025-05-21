"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PRData } from "@/app/Interfaces/interface"
import React, { useState } from "react"

interface DataTableProps {
  columns: {
    accessorKey: string
    header: string
  }[]
  data: PRData[]
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
          {data.map((row, rowIndex) => (
            <React.Fragment key={rowIndex}>
              <TableRow
                className="cursor-pointer hover:bg-gray-50 transition"
                onClick={() => handleRowClick(rowIndex)}
              >
                {columns.map((column) => (
                  <TableCell key={column.accessorKey} className="w-2">
                    {column.accessorKey === "status" ? (
                      <StatusBadge status={row[column.accessorKey]} />
                    ) : (
                      row[column.accessorKey as keyof PRData]
                    )}
                  </TableCell>
                ))}
              </TableRow>
              {expandedRow === rowIndex && extraKeys.length > 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length} className="bg-gray-50 dark:bg-[#181f2a] p-0 border-t-0">
                    <div
                      className={`overflow-hidden transition-all duration-300 ease-in-out ${expandedRow === rowIndex ? 'max-h-96 opacity-100 scale-y-100' : 'max-h-0 opacity-0 scale-y-95'}`}
                    >
                      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Branch:</span>
                          <span className="font-semibold">{row.branch}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Days in Status:</span>
                          <span className="font-semibold">{row.daysSinceStatusChange} days</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Created:</span>
                          <span className="font-semibold">{row.createdAt ? new Date(row.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Updated:</span>
                          <span className="font-semibold">{row.updatedAt ? new Date(row.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Reviewer:</span>
                          <span className="font-semibold">{row.assignedReviewer}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400 mr-1">Tester:</span>
                          <span className="font-semibold">{row.assignedTester}</span>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'in_review':
      return 'bg-blue-100 text-blue-700';
    case 'approved':
      return 'bg-green-100 text-green-700';
    case 'needs_revision':
      return 'bg-yellow-100 text-yellow-700';
    case 'merged':
      return 'bg-purple-100 text-purple-700';
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
