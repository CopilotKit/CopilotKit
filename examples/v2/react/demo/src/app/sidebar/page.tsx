"use client";

import {
  CopilotKitProvider,
  CopilotSidebar,
  defineToolCallRenderer,
  useConfigureSuggestions,
  useFrontendTool,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export const dynamic = "force-dynamic";

export default function SidebarDemoPage() {
  const wildcardRenderer = defineToolCallRenderer({
    name: "*",
    render: ({ name, args, status }) => (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 shadow-sm">
        <strong className="block text-slate-900">Unknown Tool: {name}</strong>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-600">
          Status: {status}
          {args && "\nArguments: " + JSON.stringify(args, null, 2)}
        </pre>
      </div>
    ),
  });

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      renderToolCalls={[wildcardRenderer]}
      showDevConsole="auto"
    >
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
            Copilot Sidebar Demo
          </h1>
          <p className="max-w-2xl text-slate-600">
            This page shows the chat embedded as a right-aligned sidebar. Toggle
            the chat to see the main content reflow. The assistant can suggest
            actions and invoke custom tools just like the full-screen chat.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <article
              key={index}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h2 className="text-lg font-medium text-slate-900">
                Project Card {index + 1}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Placeholder content to demonstrate how the sidebar pushes layout
                elements without overlapping the page.
              </p>
            </article>
          ))}
        </section>
      </main>

      <SidebarChat />
    </div>
  );
}

function SidebarChat() {
  useConfigureSuggestions({
    instructions: "Suggest follow-up tasks based on the current page content",
    available: "always",
  });

  useFrontendTool({
    name: "toastNotification",
    parameters: z.object({
      message: z.string(),
    }),
    handler: async ({ message }) => {
      alert(`Notification: ${message}`);
      return `Displayed toast: ${message}`;
    },
  });

  // OSS-69 prototype: gen-ui tool that renders a real chart in chat AND in
  // the inspector via the host-portal bridge.
  useFrontendTool({
    name: "showChart",
    description:
      "Render a small bar chart. Use when the user asks to visualize data.",
    parameters: z.object({
      title: z.string(),
      bars: z
        .array(z.object({ label: z.string(), value: z.number() }))
        .min(1)
        .max(8),
    }),
    handler: async ({ title }) => `Rendered chart: ${title}`,
  });

  useRenderTool(
    {
      name: "showChart",
      parameters: z.object({
        title: z.string(),
        bars: z.array(z.object({ label: z.string(), value: z.number() })),
      }),
      render: ({ status, parameters }) => {
        if (status === "inProgress") {
          return (
            <div className="text-xs text-slate-500">Building chart…</div>
          );
        }
        return <BarChart title={parameters.title} bars={parameters.bars} />;
      },
    },
    [],
  );

  return <CopilotSidebar defaultOpen={true} width="50%" />;
}

function BarChart({
  title,
  bars,
}: {
  title: string;
  bars: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const width = 320;
  const height = 160;
  const barWidth = width / bars.length;
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "#334155",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <svg width={width} height={height} style={{ display: "block" }}>
        {bars.map((bar, i) => {
          const h = (bar.value / max) * (height - 24);
          const x = i * barWidth + 4;
          const y = height - h - 16;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth - 8}
                height={h}
                fill="#6366f1"
                rx={3}
              />
              <text
                x={x + (barWidth - 8) / 2}
                y={height - 4}
                fontSize={10}
                fill="#475569"
                textAnchor="middle"
              >
                {bar.label}
              </text>
              <text
                x={x + (barWidth - 8) / 2}
                y={y - 2}
                fontSize={10}
                fill="#1e293b"
                textAnchor="middle"
              >
                {bar.value}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
