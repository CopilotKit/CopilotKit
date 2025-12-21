"use client";

import {
  CopilotKitProvider,
  CopilotPopup,
  defineToolCallRenderer,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkitnext/react";
import { z } from "zod";

export const dynamic = "force-dynamic";

export default function PopupDemoPage() {
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
      <PopupLayout />
    </CopilotKitProvider>
  );
}

function PopupLayout() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 pb-40">
        <section className="space-y-4">
          <span className="inline-flex items-center rounded-full bg-slate-900/10 px-3 py-1 text-xs font-medium text-slate-700">
            Overlay Chat Demo
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Copilot Popup Demo</h1>
          <p className="max-w-2xl text-slate-600">
            This page mounts the chat as a floating popup anchored to the bottom-right corner. The popup animates in and
            out, and leaves the rest of the interface interactive. Try clicking outside the popup or using the toggle
            button to open and close the assistant.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <article
              key={index}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h2 className="text-lg font-medium text-slate-900">In-Flow Task {index + 1}</h2>
              <p className="mt-2 text-sm text-slate-600">
                Use the popup assistant to draft updates, summarize status, or trigger custom tools without losing
                context.
              </p>
            </article>
          ))}
        </section>

        <section className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 shadow-inner">
          <h3 className="text-base font-semibold text-slate-900">How the popup behaves</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>• Appears with a bottom-right scale and translate animation.</li>
            <li>• Leaves the page scrollable and interactive—no backdrop overlay.</li>
            <li>• Supports closing when you click outside (enabled in this demo).</li>
            <li>• Reuses all chat slots, tools, and suggestion hooks from the core chat.</li>
          </ul>
        </section>
      </main>

      <PopupChat />
    </div>
  );
}

function PopupChat() {
  useConfigureSuggestions({
    instructions: "Suggest short summaries or next actions based on the dashboard content",
  });

  useFrontendTool({
    name: "notify",
    parameters: z.object({
      message: z.string(),
    }),
    handler: async ({ message }) => {
      alert(`Notification: ${message}`);
      return `Displayed notification: ${message}`;
    },
  });

  return <CopilotPopup defaultOpen={true} clickOutsideToClose={true} />;
}
