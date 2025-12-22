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
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">MCP Apps Demo</h1>
          <p className="max-w-2xl text-slate-600">
            This page demonstrates the MCP Apps Extension. The assistant has access to MCP tools
            that can render interactive UI components directly in the chat.
          </p>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-900">Available MCP Tools:</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li><code className="rounded bg-slate-100 px-1">create-ui-raw</code> - Renders a raw HTML UI with a custom message</li>
              <li><code className="rounded bg-slate-100 px-1">get-weather</code> - Returns weather data for a location</li>
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Note: Make sure the MCP server is running on port 3001 (cd mcp-apps &amp;&amp; npm start)
            </p>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <article
              key={index}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h2 className="text-lg font-medium text-slate-900">Demo Card {index + 1}</h2>
              <p className="mt-2 text-sm text-slate-600">
                Try asking the assistant to use MCP tools. The UI will render directly in the chat sidebar.
              </p>
            </article>
          ))}
        </section>
      </main>

      <CopilotSidebar defaultOpen={true} width="50%" />
    </div>
  );
}
