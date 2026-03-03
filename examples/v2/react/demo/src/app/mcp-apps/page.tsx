"use client";

import { CopilotKitProvider, CopilotSidebar } from "@copilotkitnext/react";

export const dynamic = "force-dynamic";

export default function MCPAppsDemoPage() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit-mcp" showDevConsole="auto">
      <AppLayout />
    </CopilotKitProvider>
  );
}

function AppLayout() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
        <section className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            MCP Apps Demo
          </h1>
          <p className="max-w-2xl text-slate-600">
            This page demonstrates the MCP Apps Extension. The assistant has
            access to MCP tools that can render interactive UI components
            directly in the chat.
          </p>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-900">
              Available MCP Tools (ext-apps):
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <code className="rounded bg-slate-100 px-1">get-time</code> -
                Current server time
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">
                  get-budget-data
                </code>{" "}
                - Interactive budget allocation
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">
                  get-cohort-data
                </code>{" "}
                - Cohort analysis heatmap
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">
                  get-customer-data
                </code>{" "}
                - Customer segmentation analysis
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">
                  get-scenario-data
                </code>{" "}
                - SaaS financial scenario modeling
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">
                  play-sheet-music
                </code>{" "}
                - Music notation rendering
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">
                  get-system-stats
                </code>{" "}
                - System monitoring dashboard
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">
                  show_threejs_scene
                </code>{" "}
                - 3D visualization (Three.js)
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">play_video</code> -
                Video player
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">
                  get-first-degree-links
                </code>{" "}
                - Wikipedia link explorer
              </li>
            </ul>
            <div className="mt-3 space-y-1 text-xs text-slate-500">
              <p className="font-medium">To run the MCP servers:</p>
              <pre className="rounded bg-slate-100 p-2 overflow-x-auto">
                {`git clone https://github.com/modelcontextprotocol/ext-apps
cd ext-apps
npm install
npm start`}
              </pre>
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <article
              key={index}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h2 className="text-lg font-medium text-slate-900">
                Demo Card {index + 1}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Try asking the assistant to use MCP tools. The UI will render
                directly in the chat sidebar.
              </p>
            </article>
          ))}
        </section>
      </main>

      <CopilotSidebar defaultOpen={true} width="50%" threadId="mcp-apps-003" />
    </div>
  );
}
