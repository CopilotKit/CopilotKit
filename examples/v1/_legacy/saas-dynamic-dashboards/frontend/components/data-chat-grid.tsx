import { useEffect, useState } from "react";
import { TestsData } from "@/app/Interfaces/interface";
import {
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
  TableBody,
  Table,
} from "./ui/table";
import { Checkbox } from "./ui/checkbox";
import { codeSnippets } from "@/public/snippets";
import { Button } from "@/components/ui/button";
import React from "react";
import { Badge } from "./ui/badge";
import { getStatusColor } from "./data-table-results";

export function ChatGrid({
  status,
  state,
  testSuite,
  setTestSuite,
  testCaseStatus,
  setTestCaseStatus,
}: {
  status: string;
  state: any;
  testSuite: TestsData[];
  setTestSuite: (testSuite: TestsData[]) => void;
  testCaseStatus: any;
  setTestCaseStatus: (testCaseStatus: any) => void;
}) {
  const [newScriptsData, setNewScriptsData] = useState<TestsData[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [disabled, setDisabled] = useState<boolean>(false);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(newScriptsData?.map((_, index) => index) || []);
    } else {
      setSelectedRows([]);
    }
  };

  const handleRowSelect = (index: number, checked: boolean) => {
    if (checked) {
      setSelectedRows([...selectedRows, index]);
    } else {
      setSelectedRows(selectedRows.filter((i) => i !== index));
    }
  };

  const handleSelectedAction = () => {
    // Handle the action for selected rows
    debugger;

    // if (respond) {
    console.log("Selected rows:", selectedRows);
    // onToggle([...testSuite, ...newScriptsData.filter((_, index) => selectedRows.includes(index))])
    setTestSuite([
      ...testSuite,
      ...newScriptsData.filter((_, index) => selectedRows.includes(index)),
    ]);
    setSelectedRows([]);
    setDisabled(true);
    // respond("The selected test suites have been added successfully")
    // }
    // Add your custom logic here
  };

  useEffect(() => {
    // console.log(nodeName,status, "nodeNamenodeName")
    // if (status === "executing") {
    setNewScriptsData(state?.testScripts?.testSuites);
    // }
  }, [state, status]);
  const handleRowClick = (rowIndex: number) => {
    setExpandedRow(expandedRow === rowIndex ? null : rowIndex);
  };
  return (
    <>
      {newScriptsData && (
        <div className="w-full min-w-[200px] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    disabled={disabled}
                    className="rounded-md border-gray-300 dark:border-gray-600"
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Test Suite</TableHead>
                <TableHead>Test Cases</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {newScriptsData?.map((script, index) => (
                <React.Fragment key={index}>
                  <TableRow
                    className="transition hover:bg-gray-50"
                    onClick={() => handleRowClick(index)}
                  >
                    <TableCell className="w-[50px]">
                      <Checkbox
                        disabled={disabled}
                        className="rounded-md border-gray-300 dark:border-gray-600"
                        checked={selectedRows.includes(index)}
                        onCheckedChange={(checked) => {
                          handleRowSelect(index, checked as boolean);
                          event?.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                    <TableCell>{script?.title}</TableCell>
                    <TableCell>{script?.testCases?.length}</TableCell>
                  </TableRow>
                  {expandedRow === index &&
                    !disabled &&
                    status === "complete" && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="border-t-0 bg-gray-50 p-0 dark:bg-[#181f2a]"
                        >
                          <div className="p-4">
                            <div className="mb-2 font-semibold">
                              Test Suite Description:
                            </div>
                            <div className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                              {script.shortDescription ||
                                "No description available."}
                            </div>
                            <div className="mb-2 font-semibold">
                              Code Snippet:
                            </div>
                            <pre className="mb-4 overflow-x-auto rounded bg-gray-100 p-2 text-xs dark:bg-[#181f2a]">
                              {
                                codeSnippets[
                                  Math.floor(
                                    Math.random() * codeSnippets.length,
                                  )
                                ]
                              }
                            </pre>
                            <div className="mb-2 font-semibold">
                              Test Cases Details:
                            </div>
                            <ul className="space-y-4">
                              {script.testCases.map((tc, idx) => (
                                <li
                                  key={tc.id}
                                  className="rounded border bg-white p-3 dark:bg-[#232b3b]"
                                >
                                  <div className="mb-1 flex items-center gap-2">
                                    <StatusBadge
                                      status={
                                        testCaseStatus[index]?.[idx] ||
                                        tc.status
                                      }
                                    />
                                    <span className="font-semibold">
                                      {tc.name}
                                    </span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
          {selectedRows.length > 0 && (
            <div className="flex items-center justify-between border-t bg-gray-50 p-4 dark:bg-[#181f2a]">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {selectedRows.length}{" "}
                {selectedRows.length === 1 ? "row" : "rows"} selected
              </div>
              <Button
                onClick={handleSelectedAction}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                Add Selected Tests
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={`rounded-full px-2 py-1 text-center text-xs font-medium ${getStatusColor(status)}`}
    >
      {status.split("_").join(" ")}
    </Badge>
  );
}
