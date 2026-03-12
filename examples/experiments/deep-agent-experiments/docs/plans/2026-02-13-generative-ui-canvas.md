# Generative UI Canvas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the plain-text canvas with generative UI using two approaches on separate routes: `/use-frontend-tool` (Approach A) and `/use-agent` (Approach C).

**Architecture:** Move the current root page to `/use-frontend-tool` and create a duplicate at `/use-agent`. On `/use-frontend-tool`, register per-component-type frontend tools (`canvas_markdown`, `canvas_chart`, `canvas_table`, `canvas_code`) that build up a `ContentBlock[]` in canvas state. On `/use-agent`, use `useAgent` to subscribe to `agent.messages` and render tool calls as components directly from the message stream. Both pages share a common set of pre-built canvas block components and a shared `ReportCanvas` that renders `ContentBlock[]`. The chat sidebar stays text-only on both routes. Backend agent tools are updated to match the new tool names.

**Tech Stack:** React 19, TanStack Router (file-based routing), CopilotKit v2 hooks via `@copilotkit/react-core/v2`, Zod for tool schemas, Tailwind CSS, Python/LangGraph agent with CopilotKit middleware.

---

## Shared Types & Components

These are used by both route implementations.

### Task 1: Create shared content block types

**Files:**
- Create: `app/client/src/lib/canvas-types.ts`

**Step 1: Create the content block type definitions**

```ts
// app/client/src/lib/canvas-types.ts
export type MarkdownBlock = {
  id: string;
  type: "markdown";
  content: string;
};

export type ChartBlock = {
  id: string;
  type: "chart";
  title: string;
  chartType: "bar" | "line" | "pie";
  labels: string[];
  values: number[];
};

export type TableBlock = {
  id: string;
  type: "table";
  title: string;
  headers: string[];
  rows: string[][];
};

export type CodeBlock = {
  id: string;
  type: "code";
  language: string;
  code: string;
  filename?: string;
};

export type ContentBlock = MarkdownBlock | ChartBlock | TableBlock | CodeBlock;
```

**Step 2: Commit**

```bash
git add app/client/src/lib/canvas-types.ts
git commit -m "feat: add shared content block types for generative UI canvas"
```

---

### Task 2: Create pre-built canvas block components

**Files:**
- Create: `app/client/src/components/blocks/MarkdownBlockView.tsx`
- Create: `app/client/src/components/blocks/ChartBlockView.tsx`
- Create: `app/client/src/components/blocks/TableBlockView.tsx`
- Create: `app/client/src/components/blocks/CodeBlockView.tsx`
- Create: `app/client/src/components/blocks/index.ts`

These are simple, presentational React components. No CopilotKit dependencies.

**Step 1: Create the block components**

```tsx
// app/client/src/components/blocks/MarkdownBlockView.tsx
import type { MarkdownBlock } from "../../lib/canvas-types";

export function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  return (
    <div className="prose max-w-none">
      <pre className="whitespace-pre-wrap font-sans">{block.content}</pre>
    </div>
  );
}
```

```tsx
// app/client/src/components/blocks/ChartBlockView.tsx
import type { ChartBlock } from "../../lib/canvas-types";

export function ChartBlockView({ block }: { block: ChartBlock }) {
  const maxValue = Math.max(...block.values, 1);

  return (
    <div className="my-4 p-4 border border-gray-200 rounded-lg bg-white">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{block.title}</h3>
      {block.chartType === "bar" && (
        <div className="space-y-2">
          {block.labels.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 truncate">{label}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all"
                  style={{ width: `${(block.values[i] / maxValue) * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-600 w-12 text-right">{block.values[i]}</span>
            </div>
          ))}
        </div>
      )}
      {block.chartType !== "bar" && (
        <div className="text-sm text-gray-500 italic">
          {block.chartType} chart: {block.labels.join(", ")}
        </div>
      )}
    </div>
  );
}
```

```tsx
// app/client/src/components/blocks/TableBlockView.tsx
import type { TableBlock } from "../../lib/canvas-types";

export function TableBlockView({ block }: { block: TableBlock }) {
  return (
    <div className="my-4 overflow-x-auto">
      {block.title && (
        <h3 className="text-sm font-semibold text-gray-700 mb-2">{block.title}</h3>
      )}
      <table className="min-w-full border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            {block.headers.map((h) => (
              <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {block.rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-sm text-gray-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

```tsx
// app/client/src/components/blocks/CodeBlockView.tsx
import type { CodeBlock } from "../../lib/canvas-types";

export function CodeBlockView({ block }: { block: CodeBlock }) {
  return (
    <div className="my-4 rounded-lg overflow-hidden border border-gray-200">
      <div className="flex items-center justify-between bg-gray-800 px-4 py-2">
        <span className="text-xs text-gray-400">
          {block.filename ?? block.language}
        </span>
      </div>
      <pre className="p-4 bg-gray-900 text-gray-100 text-sm overflow-x-auto">
        <code>{block.code}</code>
      </pre>
    </div>
  );
}
```

```ts
// app/client/src/components/blocks/index.ts
export { MarkdownBlockView } from "./MarkdownBlockView";
export { ChartBlockView } from "./ChartBlockView";
export { TableBlockView } from "./TableBlockView";
export { CodeBlockView } from "./CodeBlockView";
```

**Step 2: Commit**

```bash
git add app/client/src/components/blocks/
git commit -m "feat: add pre-built canvas block components"
```

---

### Task 3: Create shared ReportCanvas component

**Files:**
- Create: `app/client/src/components/ReportCanvas.tsx`

This component takes `ContentBlock[]` and renders the appropriate component for each block. Used by both routes.

**Step 1: Create the canvas**

```tsx
// app/client/src/components/ReportCanvas.tsx
import type { ContentBlock } from "../lib/canvas-types";
import {
  MarkdownBlockView,
  ChartBlockView,
  TableBlockView,
  CodeBlockView,
} from "./blocks";

function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "markdown":
      return <MarkdownBlockView block={block} />;
    case "chart":
      return <ChartBlockView block={block} />;
    case "table":
      return <TableBlockView block={block} />;
    case "code":
      return <CodeBlockView block={block} />;
  }
}

export function ReportCanvas({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="h-full w-full p-8 bg-gray-50 overflow-auto border-l border-gray-200">
      <div className="max-w-3xl mx-auto bg-white shadow-xl p-10 min-h-[80vh] rounded-lg">
        {blocks.length === 0 ? (
          <p className="text-gray-400 italic">Waiting for agent...</p>
        ) : (
          blocks.map((block) => <BlockRenderer key={block.id} block={block} />)
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add app/client/src/components/ReportCanvas.tsx
git commit -m "feat: add shared ReportCanvas component"
```

---

## Route Restructuring

### Task 4: Move root page to `/use-frontend-tool` and create `/use-agent` duplicate

TanStack Router uses file-based routing. Creating `routes/use-frontend-tool.tsx` maps to `/use-frontend-tool`, and `routes/use-agent.tsx` maps to `/use-agent`.

**Files:**
- Modify: `app/client/src/routes/index.tsx` — replace with a landing page linking to both routes
- Create: `app/client/src/routes/use-frontend-tool.tsx` — copy of current index.tsx (will be modified in Task 5)
- Create: `app/client/src/routes/use-agent.tsx` — copy of current index.tsx (will be modified in Task 6)
- Modify: `app/client/src/routes/__root.tsx` — update nav with links to both routes

**Step 1: Create `/use-frontend-tool` route as copy of current index**

Copy the current `app/client/src/routes/index.tsx` to `app/client/src/routes/use-frontend-tool.tsx`. Change the route definition:

```tsx
// app/client/src/routes/use-frontend-tool.tsx
// Exact copy of current index.tsx with these changes:

import { useState, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorBoundary } from "react-error-boundary";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";

import "@copilotkit/react-ui/styles.css";

export const Route = createFileRoute("/use-frontend-tool")({
  component: UseFrontendToolPage,
});

const ReportCanvas = () => {
  const [reportContent, setReportContent] = useState<string>(
    "# New Report\n\nWaiting for agent...",
  );

  useCopilotAction({
    name: "update_report_canvas",
    description: "Updates the report content",
    parameters: [
      {
        name: "content",
        type: "string",
        description: "The full markdown content of the report",
        required: true,
      },
    ],
    handler: async ({ content }) => {
      setReportContent(content);
      return "Canvas updated successfully.";
    },
  });

  return (
    <div className="h-full w-full p-8 bg-gray-50 overflow-auto border-l border-gray-200">
      <div className="max-w-3xl mx-auto bg-white shadow-xl p-10 min-h-[80vh] rounded-lg prose">
        <pre className="whitespace-pre-wrap font-sans">{reportContent}</pre>
      </div>
    </div>
  );
};

function UseFrontendToolPage() {
  return (
    <ErrorBoundary fallback="something went wrong">
      <Suspense fallback="loading">
        <CopilotKit runtimeUrl="/api/copilot" agent="research_agent">
          <div className="relative flex h-full w-full overflow-hidden">
            <div className="flex-1 relative">
              <ReportCanvas />
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
```

**Step 2: Create `/use-agent` route as identical copy**

Copy the same file to `app/client/src/routes/use-agent.tsx`. Change only the route definition:

```tsx
export const Route = createFileRoute("/use-agent")({
  component: UseAgentPage,
});

// ... same content, rename function to UseAgentPage
```

**Step 3: Replace index.tsx with a landing page**

```tsx
// app/client/src/routes/index.tsx
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-50">
      <div className="max-w-lg mx-auto space-y-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          Deep Agent — Generative UI
        </h1>
        <p className="text-gray-600">
          Two approaches to rendering custom components in the canvas.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            to="/use-frontend-tool"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Approach A: useFrontendTool
          </Link>
          <Link
            to="/use-agent"
            className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Approach C: useAgent
          </Link>
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Update `__root.tsx` nav with links to both routes**

```tsx
// app/client/src/routes/__root.tsx
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex flex-col h-screen w-screen">
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200">
        <nav className="px-6 h-12 flex items-center gap-6">
          <Link to="/" className="text-sm font-medium text-gray-700 hover:text-gray-900">
            Home
          </Link>
          <Link to="/use-frontend-tool" className="text-sm font-medium text-gray-700 hover:text-gray-900">
            useFrontendTool
          </Link>
          <Link to="/use-agent" className="text-sm font-medium text-gray-700 hover:text-gray-900">
            useAgent
          </Link>
        </nav>
      </header>
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
```

**Step 5: Run the dev server to verify route generation**

Run: `cd /Volumes/Projects/CLIENTS/CopilotKit/deep-agent/app && bun run dev`
Expected: TanStack Router generates updated `routeTree.gen.ts` with three routes: `/`, `/use-frontend-tool`, `/use-agent`. All three pages render correctly.

**Step 6: Commit**

```bash
git add app/client/src/routes/ app/client/src/routeTree.gen.ts
git commit -m "feat: restructure routes — landing page, /use-frontend-tool, /use-agent"
```

---

## Approach A: `/use-frontend-tool` — Per-Component Frontend Tools

### Task 5: Implement generative UI on `/use-frontend-tool`

**Files:**
- Modify: `app/client/src/routes/use-frontend-tool.tsx`

Replace the current `useCopilotAction("update_report_canvas")` with multiple `useFrontendTool` calls, one per content block type. Each tool's handler appends a block to canvas state. Use the shared `ReportCanvas` component to render.

**Step 1: Rewrite the route**

```tsx
// app/client/src/routes/use-frontend-tool.tsx
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

  const appendBlock = useCallback((block: ContentBlock) => {
    setBlocks((prev) => [...prev, block]);
  }, []);

  const clearCanvas = useCallback(() => {
    setBlocks([]);
  }, []);

  useFrontendTool({
    name: "canvas_markdown",
    description: "Add a markdown text section to the report canvas.",
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
    description:
      "Add a chart to the report canvas. Supported chart types: bar, line, pie.",
    parameters: [
      { name: "title", type: "string", description: "Chart title", required: true },
      { name: "chartType", type: "string", description: "Chart type: bar, line, or pie", required: true },
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
    description: "Add a data table to the report canvas.",
    parameters: [
      { name: "title", type: "string", description: "Table title", required: true },
      { name: "headers", type: "string[]", description: "Column header strings", required: true },
      { name: "rows", type: "string[][]", description: "2D array of cell values", required: true },
    ],
    handler: async ({ title, headers, rows }) => {
      appendBlock({ id: nextBlockId(), type: "table", title, headers, rows });
      return "Table added.";
    },
  });

  useFrontendTool({
    name: "canvas_code",
    description: "Add a code block to the report canvas.",
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
    parameters: [],
    handler: async () => {
      clearCanvas();
      return "Canvas cleared.";
    },
  });

  return <ReportCanvas blocks={blocks} />;
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
                  initial:
                    "Hi! I'm your Deep Agent. What topic should we research today?",
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
```

**Step 2: Commit**

```bash
git add app/client/src/routes/use-frontend-tool.tsx
git commit -m "feat: implement Approach A — useFrontendTool generative UI canvas"
```

---

## Approach C: `/use-agent` — Messages-Based Rendering

### Task 6: Implement generative UI on `/use-agent`

**Files:**
- Modify: `app/client/src/routes/use-agent.tsx`

Use `useAgent` to subscribe to agent messages. The canvas iterates over `agent.messages`, rendering assistant text content as markdown blocks and tool calls as their corresponding component type. Uses `useRenderToolCall` to resolve tool call → component mapping.

**Important:** The v2 hooks are available via `@copilotkit/react-core/v2`. The v2 `CopilotKitProvider` replaces v1's `CopilotKit` component and uses `runtimeUrl` prop.

**Step 1: Rewrite the route**

```tsx
// app/client/src/routes/use-agent.tsx
import { useMemo, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorBoundary } from "react-error-boundary";
import {
  CopilotKitProvider,
  CopilotSidebar,
  useAgent,
  UseAgentUpdate,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import type { AssistantMessage, Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { z } from "zod";
import { ReportCanvas } from "../components/ReportCanvas";
import type { ContentBlock } from "../lib/canvas-types";

import "@copilotkit/react-core/v2/styles.css";

export const Route = createFileRoute("/use-agent")({
  component: UseAgentPage,
});

/**
 * Parse tool calls from agent messages into ContentBlocks.
 * For each assistant message with tool calls, we look up the corresponding
 * tool message (result) to extract the structured data.
 * For text-only assistant messages, we create markdown blocks.
 */
function messagesToBlocks(messages: Message[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let blockId = 0;

  for (const msg of messages) {
    if (msg.role === "assistant") {
      const assistantMsg = msg as AssistantMessage;

      // Render text content as markdown
      if (assistantMsg.content) {
        blocks.push({
          id: `msg-text-${blockId++}`,
          type: "markdown",
          content: assistantMsg.content,
        });
      }

      // Render tool calls as components
      if (assistantMsg.toolCalls) {
        for (const tc of assistantMsg.toolCalls) {
          const args = safeParseArgs(tc.function.arguments);
          const toolName = tc.function.name;

          if (toolName === "canvas_markdown" && args.content) {
            blocks.push({
              id: `tc-${tc.id}`,
              type: "markdown",
              content: args.content,
            });
          } else if (toolName === "canvas_chart" && args.title) {
            blocks.push({
              id: `tc-${tc.id}`,
              type: "chart",
              title: args.title,
              chartType: args.chartType ?? "bar",
              labels: args.labels ?? [],
              values: args.values ?? [],
            });
          } else if (toolName === "canvas_table" && args.title) {
            blocks.push({
              id: `tc-${tc.id}`,
              type: "table",
              title: args.title,
              headers: args.headers ?? [],
              rows: args.rows ?? [],
            });
          } else if (toolName === "canvas_code" && args.code) {
            blocks.push({
              id: `tc-${tc.id}`,
              type: "code",
              language: args.language ?? "text",
              code: args.code,
              filename: args.filename,
            });
          }
          // canvas_clear and search_web are skipped — they don't produce blocks
        }
      }
    }
  }

  // If the most recent canvas_clear call exists, only show blocks after it
  const lastClearIndex = findLastClearIndex(blocks, messages);
  return lastClearIndex >= 0 ? blocks.slice(lastClearIndex) : blocks;
}

function findLastClearIndex(blocks: ContentBlock[], messages: Message[]): number {
  // Find the last canvas_clear tool call in messages
  let lastClearTcId: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const am = msg as AssistantMessage;
      if (am.toolCalls) {
        for (const tc of am.toolCalls) {
          if (tc.function.name === "canvas_clear") {
            lastClearTcId = tc.id;
            break;
          }
        }
      }
    }
    if (lastClearTcId) break;
  }

  if (!lastClearTcId) return -1;

  // Find the block index right after the clear
  const clearBlockIdx = blocks.findIndex((b) => b.id === `tc-${lastClearTcId}`);
  return clearBlockIdx >= 0 ? clearBlockIdx + 1 : -1;
}

function safeParseArgs(argsStr: string): Record<string, any> {
  try {
    return JSON.parse(argsStr);
  } catch {
    return {};
  }
}

function AgentCanvas() {
  const { agent } = useAgent({
    updates: [UseAgentUpdate.OnMessagesChanged],
  });

  const blocks = useMemo(
    () => messagesToBlocks(agent.messages),
    [agent.messages],
  );

  return <ReportCanvas blocks={blocks} />;
}

function UseAgentPage() {
  return (
    <ErrorBoundary fallback="something went wrong">
      <Suspense fallback="loading">
        <CopilotKitProvider runtimeUrl="/api/copilot">
          <div className="relative flex h-full w-full overflow-hidden">
            <div className="flex-1 relative">
              <AgentCanvas />
              <CopilotSidebar
                agentId="research_agent"
                defaultOpen={true}
                labels={{
                  title: "Research Assistant",
                  initial:
                    "Hi! I'm your Deep Agent. What topic should we research today?",
                }}
              />
            </div>
          </div>
        </CopilotKitProvider>
      </Suspense>
    </ErrorBoundary>
  );
}
```

**Step 2: Commit**

```bash
git add app/client/src/routes/use-agent.tsx
git commit -m "feat: implement Approach C — useAgent messages-based generative UI canvas"
```

---

## Backend Agent Update

### Task 7: Update Python agent tools to match new frontend tool names

**Files:**
- Modify: `agent/agent.py`

The agent needs tools matching the frontend tool names (`canvas_markdown`, `canvas_chart`, `canvas_table`, `canvas_code`, `canvas_clear`) so the LLM can call them. These are **frontend tools** — the Python definitions are stubs that get intercepted by `CopilotKitMiddleware` and routed to the browser. Also update the system prompt.

**Step 1: Update agent.py**

```python
# agent/agent.py
from dotenv import load_dotenv
from deepagents import create_deep_agent
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from langgraph.checkpoint.memory import MemorySaver
from langchain.tools import tool

load_dotenv()

# Canvas tools — these are frontend tools intercepted by CopilotKitMiddleware.
# The Python stubs exist so the LLM sees them in its tool list.

@tool
def canvas_markdown(content: str):
    """Add a markdown text section to the report canvas. Use this for paragraphs, headings, lists, and any formatted text."""
    return "Markdown section added."

@tool
def canvas_chart(title: str, chartType: str, labels: list[str], values: list[float]):
    """Add a chart to the report canvas. chartType must be one of: bar, line, pie."""
    return "Chart added."

@tool
def canvas_table(title: str, headers: list[str], rows: list[list[str]]):
    """Add a data table to the report canvas."""
    return "Table added."

@tool
def canvas_code(language: str, code: str, filename: str = ""):
    """Add a code block to the report canvas."""
    return "Code block added."

@tool
def canvas_clear():
    """Clear the report canvas to start a fresh report."""
    return "Canvas cleared."

@tool
def search_web(query: str):
    """Searches the web for information."""
    return f"Results for {query}: [Mock Data] CopilotKit is a framework for building AI copilots..."

# Create the Deep Agent
agent = create_deep_agent(
    model="openai:gpt-5-mini",
    tools=[canvas_markdown, canvas_chart, canvas_table, canvas_code, canvas_clear, search_web],
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    system_prompt="""
    You are a research assistant that builds rich, visual reports.

    ALWAYS use the canvas tools to write your findings so the user can see them:
    - canvas_markdown: for text sections (headings, paragraphs, lists)
    - canvas_chart: for data visualizations (bar, line, pie charts)
    - canvas_table: for structured data comparisons
    - canvas_code: for code examples or technical snippets
    - canvas_clear: to start a fresh report

    Build the report incrementally — add sections one at a time as you research.
    Use charts and tables when presenting comparative or numerical data.
    Don't just chat; build the report using these tools.
    """
)

# Serve the Agent via AG-UI protocol
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="research_agent",
        description="A deep research agent that writes rich visual reports.",
        graph=agent
    ),
    "/",
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "agent:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
```

**Step 2: Commit**

```bash
git add agent/agent.py
git commit -m "feat: update agent with per-component canvas tools and rich report prompt"
```

---

## Verification

### Task 8: Smoke test both routes

**Step 1:** Start the Python agent: `cd agent && uv run python agent.py`

**Step 2:** Start the frontend: `cd app && bun run dev`

**Step 3:** Visit `http://localhost:3000/` — verify landing page with two links

**Step 4:** Visit `http://localhost:3000/use-frontend-tool` — send a message like "Research the history of TypeScript". Verify:
- Chat sidebar works
- Canvas populates with markdown, tables, or charts as the agent responds
- Multiple block types appear

**Step 5:** Visit `http://localhost:3000/use-agent` — send the same message. Verify:
- Chat sidebar works
- Canvas renders blocks derived from the agent's message stream
- Same block components render

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: generative UI canvas with two approaches — useFrontendTool and useAgent"
```
