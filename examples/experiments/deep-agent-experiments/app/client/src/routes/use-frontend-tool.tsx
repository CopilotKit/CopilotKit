import { useState, useCallback, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorBoundary } from "react-error-boundary";
import { CopilotKit, useFrontendTool } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { ReportCanvas } from "../components/ReportCanvas";
import type { ContentBlock } from "../lib/canvas-types";

import "@copilotkit/react-ui/styles.css";

export const Route = createFileRoute("/use-frontend-tool")({
  component: UseFrontendToolPage,
});

let blockCounter = 0;
function nextBlockId() {
  return `block-${++blockCounter}`;
}

function CanvasWithTools() {
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [showCanvas, setShowCanvas] = useState(true);

  const appendBlock = useCallback((block: ContentBlock) => {
    setBlocks((prev) => [...prev, block]);
  }, []);

  const clearCanvas = useCallback(() => {
    setBlocks([]);
  }, []);

  const toolAvailable = showCanvas ? "enabled" : ("disabled" as const);

  useFrontendTool({
    name: "canvas_markdown",
    description: "Add a markdown text section to the report canvas.",
    available: toolAvailable,
    parameters: [
      { name: "content", type: "string", description: "Markdown text content", required: true },
    ],
    handler: async ({ content }) => {
      appendBlock({ id: nextBlockId(), type: "markdown", content });
      return "Markdown section added.";
    },
  });

  useFrontendTool({
    name: "canvas_chart",
    description: "Add a chart to the report canvas. Supported chart types: bar, line, pie.",
    available: toolAvailable,
    parameters: [
      { name: "title", type: "string", description: "Chart title", required: true },
      {
        name: "chartType",
        type: "string",
        description: "Chart type: bar, line, or pie",
        required: true,
      },
      { name: "labels", type: "string[]", description: "Array of label strings", required: true },
      { name: "values", type: "number[]", description: "Array of numeric values", required: true },
    ],
    handler: async ({ title, chartType, labels, values }) => {
      appendBlock({
        id: nextBlockId(),
        type: "chart",
        title,
        chartType: chartType as "bar" | "line" | "pie",
        labels,
        values,
      });
      return "Chart added.";
    },
  });

  useFrontendTool({
    name: "canvas_table",
    description:
      "Add a data table to the report canvas. rows is a JSON string encoding a 2D array of cell values.",
    available: toolAvailable,
    parameters: [
      { name: "title", type: "string", description: "Table title", required: true },
      { name: "headers", type: "string[]", description: "Column header strings", required: true },
      {
        name: "rows",
        type: "string",
        description: 'JSON-encoded 2D array of cell values, e.g. [["a","b"],["c","d"]]',
        required: true,
      },
    ],
    handler: async ({ title, headers, rows }) => {
      const parsedRows: string[][] = typeof rows === "string" ? JSON.parse(rows) : rows;
      appendBlock({ id: nextBlockId(), type: "table", title, headers, rows: parsedRows });
      return "Table added.";
    },
  });

  useFrontendTool({
    name: "canvas_code",
    description: "Add a code block to the report canvas.",
    available: toolAvailable,
    parameters: [
      { name: "language", type: "string", description: "Programming language", required: true },
      { name: "code", type: "string", description: "The code content", required: true },
      { name: "filename", type: "string", description: "Optional filename", required: false },
    ],
    handler: async ({ language, code, filename }) => {
      appendBlock({ id: nextBlockId(), type: "code", language, code, filename });
      return "Code block added.";
    },
  });

  useFrontendTool({
    name: "canvas_clear",
    description: "Clear all content from the report canvas to start fresh.",
    available: toolAvailable,
    parameters: [],
    handler: async () => {
      clearCanvas();
      return "Canvas cleared.";
    },
  });

  return (
    <>
      <button
        onClick={() => setShowCanvas((prev) => !prev)}
        className="absolute top-4 left-4 z-10 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
      >
        {showCanvas ? "Disable canvas tool" : "Enable canvas tool"}
      </button>
      {/* always show canvas, we just want to test the tool execution */}
      <ReportCanvas blocks={blocks} />
    </>
  );
}

function UseFrontendToolPage() {
  return (
    <ErrorBoundary fallback="something went wrong">
      <Suspense fallback="loading">
        <CopilotKit runtimeUrl="/api/copilot" agent="research_agent">
          <div className="relative flex h-full w-full overflow-hidden">
            <div className="flex-1 relative">
              <CanvasWithTools />
              <CopilotSidebar
                defaultOpen={true}
                labels={{
                  title: "Research Assistant",
                  initial: "Hi! I'm your Deep Agent. What topic should we research today?",
                }}
                clickOutsideToClose={false}
              />
            </div>
          </div>
        </CopilotKit>
      </Suspense>
    </ErrorBoundary>
  );
}
