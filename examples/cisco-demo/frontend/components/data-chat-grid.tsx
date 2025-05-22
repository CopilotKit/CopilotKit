import { useEffect, useState } from "react";
import { TestsData } from "@/app/Interfaces/interface";
import { TableHead, TableHeader, TableRow, TableCell, TableBody, Table } from "./ui/table";
import { Checkbox } from "./ui/checkbox";
import { codeSnippets } from "@/public/snippets"
import { Button } from "@/components/ui/button"
import React from "react";
import { Badge } from "./ui/badge";
import { getStatusColor } from "./data-table-results";

export function ChatGrid({ status, state, testSuite, setTestSuite, testCaseStatus, setTestCaseStatus }: { status: string, state: any,  testSuite: TestsData[], setTestSuite: (testSuite: TestsData[]) => void, testCaseStatus: any, setTestCaseStatus: (testCaseStatus: any) => void }) {
    const [newScriptsData, setNewScriptsData] = useState<TestsData[]>([])
    const [expandedRow, setExpandedRow] = useState<number | null>(null);
    const [selectedRows, setSelectedRows] = useState<number[]>([]);
    const [disabled, setDisabled] = useState<boolean>(false)

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
            setSelectedRows(selectedRows.filter(i => i !== index));
        }
    };

    const handleSelectedAction = () => {
        // Handle the action for selected rows
        debugger

        // if (respond) {
            console.log("Selected rows:", selectedRows);
            // onToggle([...testSuite, ...newScriptsData.filter((_, index) => selectedRows.includes(index))])
            setTestSuite([...testSuite, ...newScriptsData.filter((_, index) => selectedRows.includes(index))])
            setSelectedRows([])
            setDisabled(true)
            // respond("The selected test suites have been added successfully")
        // }
        // Add your custom logic here
    };

    useEffect(() => {
        // console.log(nodeName,status, "nodeNamenodeName")
        // if (status === "executing") {
        console.log(state?.testScripts?.testSuites,"sad",status)
        setNewScriptsData(state?.testScripts?.testSuites)
        // }
    }, [state, status])
    const handleRowClick = (rowIndex: number) => {
        setExpandedRow(expandedRow === rowIndex ? null : rowIndex);
    };
    return <>
        {newScriptsData && <div className="rounded-md border w-full min-w-[200px]">
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
                                className="hover:bg-gray-50 transition"
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
                            {(expandedRow === index && !disabled && status === "complete") && (
                                <TableRow>
                                    <TableCell colSpan={3} className="bg-gray-50 dark:bg-[#181f2a] p-0 border-t-0">
                                        <div className="p-4">
                                            <div className="font-semibold mb-2">Test Suite Description:</div>
                                            <div className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                                                {script.shortDescription || "No description available."}
                                            </div>
                                            <div className="font-semibold mb-2">Code Snippet:</div>
                                            <pre className="bg-gray-100 dark:bg-[#181f2a] rounded p-2 mb-4 overflow-x-auto text-xs">
                                                {codeSnippets[Math.floor(Math.random() * codeSnippets.length)]}
                                            </pre>
                                            <div className="font-semibold mb-2">Test Cases Details:</div>
                                            <ul className="space-y-4">
                                                {script.testCases.map((tc, idx) => (
                                                    <li key={tc.id} className="border rounded p-3 bg-white dark:bg-[#232b3b]">
                                                        <div className="mb-1 flex items-center gap-2">
                                                            <StatusBadge status={testCaseStatus[index]?.[idx] || tc.status} />
                                                            <span className="font-semibold">{tc.name}</span>
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
                <div className="p-4 border-t flex justify-between items-center bg-gray-50 dark:bg-[#181f2a]">
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                        {selectedRows.length} {selectedRows.length === 1 ? 'row' : 'rows'} selected
                    </div>
                    <Button
                        onClick={handleSelectedAction}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                        Add Selected Tests
                    </Button>
                </div>
            )}
        </div>}
    </>
}

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