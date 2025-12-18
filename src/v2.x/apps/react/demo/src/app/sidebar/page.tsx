"use client";

import {
  CopilotKitProvider,
  CopilotSidebar,
  defineToolCallRenderer,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkitnext/react";
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
    <CopilotKitProvider runtimeUrl="/api/copilotkit" renderToolCalls={[wildcardRenderer]} showDevConsole="auto">
      <AppLayout />
    </CopilotKitProvider>
  );
}

function AppLayout() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
        <section className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Copilot Sidebar Demo</h1>
          <p className="max-w-2xl text-slate-600">
            This page shows the chat embedded as a right-aligned sidebar. Toggle the chat to see the main content
            reflow. The assistant can suggest actions and invoke custom tools just like the full-screen chat.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <article
              key={index}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h2 className="text-lg font-medium text-slate-900">Project Card {index + 1}</h2>
              <p className="mt-2 text-sm text-slate-600">
                Placeholder content to demonstrate how the sidebar pushes layout elements without overlapping the page.
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

  return <CopilotSidebar defaultOpen={true} width="50%" />;
}
