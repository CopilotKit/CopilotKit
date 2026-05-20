"use client";

/**
 * Beautiful Chat (Langroid port — simplified).
 *
 * A polished landing-style chat cell with brand theming, suggestion pills,
 * and an example app surface that swaps in a couple of demonstration
 * charts the user can ask the agent to talk about. The canonical
 * langgraph-python version of beautiful-chat ships a much larger surface
 * (full A2UI demonstration catalog, declarative-generative-UI catalog,
 * per-tool renderers wired through `injectA2UITool: false`, custom
 * theming + GenerativeUIExamples). This Langroid port mirrors the
 * simplified pattern shipped by `agno`, `llamaindex`, `strands`,
 * `claude-sdk-py`, etc.: it keeps the polished shell, suggestion pills,
 * and a couple of static charts on the side, and runs against the shared
 * `/api/copilotkit` endpoint with the unified Langroid chat agent.
 *
 * Runtime: shared `/api/copilotkit` endpoint (no dedicated runtime). The
 * Langroid backend is the same unified `agentic_chat` agent the
 * agentic-chat cell uses — the cosmetic layer (suggestions, theming,
 * composer skin, side canvas) lives entirely on the frontend.
 */

import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { BarChart } from "../byoc-json-render/charts/bar-chart";
import { PieChart } from "../byoc-json-render/charts/pie-chart";

const AGENT_ID = "agentic_chat";

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
  {
    title: "Summarize this dashboard",
    message:
      "Summarize the dashboard on the left. What stands out about the bar and pie charts?",
  },
];

const SAMPLE_BAR_DATA = [
  { label: "Mon", value: 32 },
  { label: "Tue", value: 48 },
  { label: "Wed", value: 51 },
  { label: "Thu", value: 44 },
  { label: "Fri", value: 67 },
  { label: "Sat", value: 38 },
  { label: "Sun", value: 29 },
];

const SAMPLE_PIE_DATA = [
  { label: "Chat", value: 42 },
  { label: "Tools", value: 28 },
  { label: "Gen UI", value: 18 },
  { label: "Other", value: 12 },
];

export default function BeautifulChatPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_ID}>
      <div
        className="relative flex h-screen w-full overflow-hidden"
        style={{
          background:
            "radial-gradient(1200px 600px at 10% 10%, rgba(99,102,241,0.20), transparent 50%), radial-gradient(1000px 500px at 90% 90%, rgba(133,236,206,0.18), transparent 55%), linear-gradient(180deg, #FBFBFE 0%, #F4F4F8 100%)",
        }}
      >
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_at_50%_0%,rgba(190,194,255,0.35),transparent_40%)]" />

        {/* App surface (left) */}
        <div className="relative hidden flex-1 flex-col gap-4 overflow-y-auto px-8 py-10 lg:flex">
          <header className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
              Beautiful chat
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#010507]">
              Polished Langroid surface
            </h1>
            <p className="max-w-xl text-sm text-[#3A3A46]">
              A flagship-style chat shell over the shared Langroid backend. Ask
              the assistant a question, pick a suggestion pill, or have it talk
              through the example dashboard.
            </p>
          </header>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <BarChart
              title="Weekly active sessions"
              description="Sessions per day across the demo workspace."
              data={SAMPLE_BAR_DATA}
            />
            <PieChart
              title="Surface mix"
              description="Where users are spending their time."
              data={SAMPLE_PIE_DATA}
            />
          </div>
        </div>

        {/* Chat (right) */}
        <div className="relative flex w-full max-w-xl flex-col gap-3 px-4 py-8 lg:px-6">
          <div className="flex-1 overflow-hidden rounded-2xl border border-[#E5E5ED] bg-white/70 shadow-[0_1px_0_0_rgba(0,0,0,0.02),0_10px_40px_-10px_rgba(99,102,241,0.18)] backdrop-blur-sm">
            <Chat />
          </div>
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
