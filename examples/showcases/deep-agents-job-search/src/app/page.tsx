"use client";

import { ChatPanel } from "@/components/ChatPanel";
import { LivePreviewPanel } from "@/components/LivePreviewPanel";

export default function Page() {
  return (
    <main className="min-h-screen flex flex-col bg-linear-to-b from-slate-50 via-white to-slate-50">
      <header className="border-b border-slate-200/80 bg-white/70 backdrop-blur supports-backdrop-filter:bg-white/60">
        <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
                Job Application Assistant
              </h1>
              <p className="mt-1 text-sm md:text-base text-slate-600">
              Find personalized job openings based on skills and preferences
              </p>
            </div>

            <div className="hidden md:flex items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                CopilotKit
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                Live
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl flex-1 min-h-0 px-4 py-4 md:px-6 md:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full min-h-0">
          <section className="lg:col-span-2 min-h-0">
            <ChatPanel />
          </section>

          <aside className="lg:col-span-1 min-h-0">
            <div className="lg:sticky lg:top-6">
              <LivePreviewPanel />
            </div>
          </aside>
        </div>
      </div>

      <footer className="border-t border-slate-200/80 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 md:px-6 text-xs text-slate-500">
          Tip: keep the preview open: tool calls + jobs will update as you chat.
        </div>
      </footer>
    </main>
  );
}