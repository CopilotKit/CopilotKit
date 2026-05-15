"use client";

/**
 * Beautiful Chat (Strands port — simplified).
 *
 * A polished landing-style chat cell with brand theming and seeded
 * suggestions. The canonical langgraph-python version ships a much larger
 * surface (ExampleCanvas, GenerativeUIExamples, per-tool renderers wired
 * through an A2UI demonstration catalog). That ecosystem depends on a
 * dedicated runtime combining `openGenerativeUI`, `a2ui`, and `mcpApps`
 * simultaneously, plus dozens of starter-level sub-components — see
 * PARITY_NOTES.md.
 *
 * This Strands variant ships the polished chat shell over the shared
 * Strands agent and documents the remaining canvas behavior as
 * out-of-scope. The pattern matches the spring-ai sibling
 * (`showcase/integrations/spring-ai/src/app/demos/beautiful-chat/page.tsx`).
 *
 * Runtime: shared `/api/copilotkit` endpoint. Backend: the main shared
 * Strands agent — same one the agentic-chat cell uses. The cosmetic layer
 * (suggestions, theming, composer skin) lives entirely on the frontend.
 */

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
    title: "Show me weather in Tokyo",
    message:
      "What's the weather like in Tokyo right now? Render a weather card.",
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
        className="relative flex h-screen w-full flex-col items-center justify-center overflow-hidden"
        style={{
          background:
            "radial-gradient(1200px 600px at 10% 10%, rgba(99,102,241,0.20), transparent 50%), radial-gradient(1000px 500px at 90% 90%, rgba(133,236,206,0.18), transparent 55%), linear-gradient(180deg, #FBFBFE 0%, #F4F4F8 100%)",
        }}
      >
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_at_50%_0%,rgba(190,194,255,0.35),transparent_40%)]" />
        <div className="relative flex h-full w-full max-w-3xl flex-col gap-4 px-4 py-8">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-[#010507]">
              Beautiful Chat
            </h1>
            <p className="text-sm text-[#3A3A46]">
              A polished conversational surface powered by your AWS Strands
              backend. Ask a question, or pick a suggestion below.
            </p>
          </header>
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
