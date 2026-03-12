"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";

interface ToolCallProps {
  status: "complete" | "inProgress" | "executing";
  name?: string;
  args?: any;
  result?: any;
}

export default function MCPToolCall({
  status,
  name = "",
  args,
  result,
}: ToolCallProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  // Format content for display
  const format = (content: any): string => {
    if (!content) return "";
    const text =
      typeof content === "object"
        ? JSON.stringify(content, null, 2)
        : String(content);
    return text
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  };

  const getStatusIcon = () => {
    
    if (status === "complete") {
      console.log(result, "MCPToolCall Result");
      if (result && result.error) {
        const errorMessage = JSON.stringify(result.error);
        // window.alert(`Tool Call Error (${name || 'Unknown Tool'}):\n${errorMessage}`);
        console.log(errorMessage, "MCPToolCall Error");
        return (
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      }
      else {
        return (( result=="" ? false : JSON.parse(result?.content[0].text)?.error)) ? (
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      }
    }
    return (
      <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
    );
  };

  return (
    <div
      className="bg-white rounded-xl shadow-md overflow-hidden w-full transition-transform duration-200 hover:scale-[1.01] hover:shadow-lg border border-gray-200"
      style={{ maxWidth: 420 }}
    >
      <div
        className="p-2 flex items-center justify-between cursor-pointer group"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 group-hover:bg-gray-200 transition-colors">
            <span className="w-4 h-4 flex items-center justify-center">{getStatusIcon()}</span>
          </div>
          <span className="text-gray-900 text-xs truncate max-w-xs">
            {name || "MCP Tool Call"}
          </span>
        </div>
      </div>

      {/* {isOpen && (
        <div className="px-4 pb-4 text-gray-300 font-mono text-xs">
          {args && (
            <div className="mb-4">
              <div className="text-gray-400 mb-2">Parameters:</div>
              <pre className="whitespace-pre-wrap max-h-[200px] overflow-auto">
                {format(args)}
              </pre>
            </div>
          )}
 
          {status === "complete" && result && (
            <div>
              <div className="text-gray-400 mb-2">Result:</div>
              <pre className="whitespace-pre-wrap max-h-[200px] overflow-auto">
                {format(result)}
              </pre>
            </div>
          )}
        </div>
      )} */}
    </div>
  );
}