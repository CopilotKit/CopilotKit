"use client";

/**
 * Beautiful Chat (Claude Agent SDK Python port — simplified).
 *
 * A polished landing-style chat cell with brand theming, seeded suggestion
 * pills, and a small glanceable side panel of decorative charts/cards.
 *
 * The canonical langgraph-python version of this demo ships a much larger
 * surface (ExampleCanvas, GenerativeUIExamples, per-tool renderers wired
 * through an A2UI declarative-generative-ui catalog). That ecosystem
 * depends on streaming-structured-output primitives that the
 * claude-sdk-python integration does not currently expose to the
 * showcase, so this port ships the polished chat shell over the shared
 * Claude agent and documents the remaining canvas behavior as out-of-scope
 * (see the beautiful-chat A2UI catalog work in langgraph-python).
 *
 * Runtime: shared `/api/copilotkit` endpoint. Backend: the same default
 * Claude agent the agentic-chat cell uses. The cosmetic layer (suggestions,
 * theming, composer skin, decorative side panel) lives entirely on the
 * frontend.
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

const AGENT_ID = "beautiful-chat";

const BRAND_SUGGESTIONS = [
  {
    title: "Plan a 3-day Tokyo trip",
    message:
      "Plan a 3-day Tokyo trip for a solo traveler interested in food, art, and architecture. Keep it concise.",
  },
  {
    title: "Explain RAG like I'm 12",
    message:
      "Explain retrieval-augmented generation as if I were 12. Use a simple analogy.",
  },
  {
    title: "Draft a launch email",
    message:
      "Draft a short, upbeat launch email announcing a new AI-powered chat feature. 3 short paragraphs max.",
  },
];

export default function BeautifulChatPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_ID}>
      <div
        className="relative flex h-screen w-full overflow-hidden"
        style={{
          background:
            "radial-gradient(1200px 600px at 10% 10%, rgba(99,102,241,0.20), transparent 50%), radial-gradient(1000px 500px at 90% 90%, rgba(133,236,206,0.18), transparent 55%), linear-gradient(180deg, #FBFBFE 0%, #F4F4F8 100%)",
          fontFamily:
            "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_at_50%_0%,rgba(190,194,255,0.35),transparent_40%)]" />

        <div className="relative grid h-full w-full grid-cols-1 gap-6 px-4 py-8 lg:grid-cols-[1fr_360px] lg:px-8">
          {/* Chat pane */}
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4">
            <header className="space-y-1">
              <h1
                className="text-2xl font-semibold tracking-tight text-[#010507]"
                style={{ letterSpacing: "-0.02em" }}
              >
                Beautiful Chat
              </h1>
              <p className="text-sm text-[#3A3A46]">
                A polished conversational surface powered by your Claude Agent
                SDK backend. Ask a question, or pick a suggestion below.
              </p>
            </header>
            <div className="flex-1 overflow-hidden rounded-2xl border border-[#E5E5ED] bg-white/70 shadow-[0_1px_0_0_rgba(0,0,0,0.02),0_10px_40px_-10px_rgba(99,102,241,0.18)] backdrop-blur-sm">
              <Chat />
            </div>
          </div>

          {/* Decorative side panel — glanceable sample cards */}
          <aside className="hidden h-full flex-col gap-4 lg:flex">
            <SamplePanel />
          </aside>
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: BRAND_SUGGESTIONS,
    available: "always",
  });

  return <CopilotChat agentId={AGENT_ID} className="h-full rounded-2xl" />;
}

/**
 * Decorative read-only side panel — gives the cell a "showcase" feel
 * without depending on A2UI / declarative-gen-ui infrastructure. Pure
 * SVG, no runtime data, no agent wiring.
 */
function SamplePanel() {
  return (
    <>
      <div className="rounded-2xl border border-[#E5E5ED] bg-white/70 p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.02),0_10px_40px_-10px_rgba(99,102,241,0.18)] backdrop-blur-sm">
        <p className="text-xs uppercase tracking-wider text-[#7C7C8A]">
          This week
        </p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-[#010507]">
          1,284 chats
        </p>
        <p className="text-xs text-[#3A3A46]">+12.4% vs last week</p>
        <div className="mt-3">
          <Sparkline />
        </div>
      </div>

      <div className="rounded-2xl border border-[#E5E5ED] bg-white/70 p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.02),0_10px_40px_-10px_rgba(99,102,241,0.18)] backdrop-blur-sm">
        <p className="text-xs uppercase tracking-wider text-[#7C7C8A]">
          Top intents
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {[
            { label: "Plan a trip", pct: 42, color: "#6366F1" },
            { label: "Explain a concept", pct: 28, color: "#85ECCE" },
            { label: "Draft an email", pct: 18, color: "#FBBF24" },
            { label: "Other", pct: 12, color: "#C4C4D1" },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <span className="w-32 truncate text-xs text-[#3A3A46]">
                {row.label}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#F1F1F6]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${row.pct}%`, background: row.color }}
                />
              </div>
              <span className="w-8 text-right text-xs tabular-nums text-[#3A3A46]">
                {row.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[#E5E5ED] bg-gradient-to-br from-[#EEF0FF] to-[#E7FAF1] p-4 text-xs text-[#3A3A46] shadow-[0_1px_0_0_rgba(0,0,0,0.02),0_10px_40px_-10px_rgba(99,102,241,0.18)] backdrop-blur-sm">
        <p className="font-medium text-[#010507]">Tip</p>
        <p className="mt-1">
          The chat surface here is unmodified <code>CopilotChat</code>. The
          theme, suggestions, and side panel are pure frontend dressing — point
          this at any Claude Agent SDK backend.
        </p>
      </div>
    </>
  );
}

function Sparkline() {
  // Static decorative sparkline — no runtime data.
  const points = [12, 14, 13, 16, 18, 17, 22, 20, 24, 27, 26, 30];
  const width = 280;
  const height = 60;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const xStep = width / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * xStep;
      const y = height - ((p - min) / (max - min || 1)) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-14 w-full"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="bc-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366F1" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${path} L${width},${height} L0,${height} Z`}
        fill="url(#bc-grad)"
      />
      <path d={path} fill="none" stroke="#6366F1" strokeWidth="2" />
    </svg>
  );
}
