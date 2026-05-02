/* baseline-types.ts — Types, constants, and validation for the Baseline tab */

/* ------------------------------------------------------------------ */
/*  Core types                                                         */
/* ------------------------------------------------------------------ */

export type BaselineStatus = "works" | "possible" | "impossible" | "unknown";

export type BaselineTag =
  | "all"
  | "cpk"
  | "agui"
  | "int"
  | "demo"
  | "docs"
  | "tests";

export interface BaselineCell {
  id: string;
  key: string;
  partner: string;
  feature: string;
  status: BaselineStatus;
  tags: BaselineTag[];
  updated_at: string;
  updated_by: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const STATUSES: readonly BaselineStatus[] = [
  "works",
  "possible",
  "impossible",
  "unknown",
] as const;

export const TAGS: readonly BaselineTag[] = [
  "all",
  "cpk",
  "agui",
  "int",
  "demo",
  "docs",
  "tests",
] as const;

export const INDIVIDUAL_TAGS: readonly BaselineTag[] = TAGS.filter(
  (t) => t !== "all",
);

/* ------------------------------------------------------------------ */
/*  Tag badge visual config                                            */
/* ------------------------------------------------------------------ */

export const TAG_BADGE_CONFIG: Record<
  BaselineTag,
  { label: string; title: string; color: string; bgColor: string }
> = {
  cpk: { label: "C", title: "Needs CopilotKit change", color: "#c084fc", bgColor: "rgba(168,85,247,0.2)" },
  agui: { label: "A", title: "Needs AG-UI change", color: "#93c5fd", bgColor: "rgba(96,165,250,0.2)" },
  int: { label: "I", title: "Needs integration change", color: "#fca5a5", bgColor: "rgba(248,113,113,0.2)" },
  demo: { label: "▶", title: "Needs a demo", color: "#6ee7b7", bgColor: "rgba(52,211,153,0.2)" },
  docs: { label: "D", title: "Needs docs", color: "#fcd34d", bgColor: "rgba(251,191,36,0.2)" },
  tests: { label: "T", title: "Needs tests", color: "#d4a76a", bgColor: "rgba(180,140,100,0.2)" },
  all: { label: "✱", title: "Needs everything", color: "#9ca3af", bgColor: "rgba(107,112,128,0.25)" },
};

/* ------------------------------------------------------------------ */
/*  Status visual config                                               */
/* ------------------------------------------------------------------ */

export const STATUS_CONFIG: Record<
  BaselineStatus,
  { emoji: string; title: string; color: string; bgColor: string }
> = {
  works: {
    emoji: "✅",
    title: "Works — no work needed",
    color: "var(--ok)",
    bgColor: "rgba(52,211,153,0.15)",
  },
  possible: {
    emoji: "🛠️",
    title: "Possible — needs work",
    color: "var(--amber)",
    bgColor: "rgba(251,191,36,0.12)",
  },
  impossible: {
    emoji: "❌",
    title: "Impossible — cannot be done",
    color: "var(--danger)",
    bgColor: "rgba(248,113,113,0.12)",
  },
  unknown: {
    emoji: "❓",
    title: "Unknown — needs investigation",
    color: "var(--unknown,#a78bfa)",
    bgColor: "rgba(167,139,250,0.12)",
  },
};

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Validates a BaselineCell's invariants:
 * - "possible" requires at least 1 tag
 * - "works", "impossible", and "unknown" require 0 tags
 */
export function validateCell(cell: BaselineCell): boolean {
  if (cell.status === "possible") {
    return cell.tags.length >= 1;
  }
  // works, impossible, unknown: must have no tags
  return cell.tags.length === 0;
}

/* ------------------------------------------------------------------ */
/*  Feature categories                                                 */
/* ------------------------------------------------------------------ */

/**
 * Feature display labels — matches Coverage tab's registry names exactly.
 * Keys are the Notion-derived slugs stored in PocketBase.
 */
export const FEATURE_LABELS: Record<string, string> = {
  "beautiful-chat": "Beautiful Chat",
  "pre-built-copilotchat": "Pre-Built CopilotChat",
  "pre-built-sidebar": "Pre-Built: Sidebar",
  "pre-built-popup": "Pre-Built: Popup",
  "chat-customization-slots": "Chat Customization (Slots)",
  "chat-customization-css": "Chat Customization (CSS)",
  "headless-chat-simple": "Headless Chat (Simple)",
  "headless-chat-complete": "Headless Chat (Complete)",
  "controlled-gen-ui-display": "Controlled Gen-UI (Display)",
  "in-chat-hitl-usehumanintheloop-ergonomic-api": "In-Chat HITL (useHumanInTheLoop — ergonomic API)",
  "in-chat-hitl-booking": "In-Chat HITL (Booking)",
  "in-chat-human-in-the-loop-original": "In-Chat Human in the Loop (Original)",
  "in-app-human-in-the-loop-frontend-tools-async-hitl": "In-App Human in the Loop (Frontend Tools + async HITL)",
  "in-chat-hitl-useinterrupt-low-level-primitive": "In-Chat HITL (useInterrupt — low-level primitive)",
  "declarative-generative-ui-a2ui-dynamic-schema": "Declarative Generative UI (A2UI — Dynamic Schema)",
  "declarative-generative-ui-a2ui-fixed-schema": "Declarative Generative UI (A2UI — Fixed Schema)",
  "mcp-apps": "MCP Apps",
  "fully-open-ended-generative-ui": "Fully Open-Ended Generative UI",
  "open-ended-gen-ui-advanced-with-frontend-function-calling": "Open-Ended Gen UI (Advanced: with frontend function calling)",
  "tool-rendering-default-catch-all": "Tool Rendering (Default Catch-all)",
  "tool-rendering-custom-catch-all": "Tool Rendering (Custom Catch-all)",
  "tool-rendering": "Tool Rendering",
  "reasoning": "Reasoning",
  "file-attachments": "File-attachments",
  "shared-state-read-write": "Shared State (Read + Write)",
  "agentic-generative-ui-in-chat-state-rendering": "Agentic Generative UI (In-Chat State Rendering)",
  "state-streaming": "State Streaming",
  "frontend-tools-in-app-actions": "Frontend Tools (In-app actions)",
  "frontend-tools-async": "Frontend Tools (Async)",
  "readonly-state-agent-context": "Readonly State (Agent Context)",
  "sub-agents": "Sub-Agents",
  "byoc-hashbrown": "BYOC Hashbrown",
  "byoc-json-render": "BYOC json-render",
};

/**
 * Feature categories — matches Coverage tab's category structure.
 * Order within each category matches Coverage's feature ordering.
 */
export const FEATURE_CATEGORIES: Record<string, string[]> = {
  "Chat & UI": [
    "beautiful-chat",
    "pre-built-copilotchat",
    "pre-built-sidebar",
    "pre-built-popup",
    "chat-customization-slots",
    "chat-customization-css",
    "headless-chat-simple",
    "headless-chat-complete",
  ],
  "Controlled Generative UI": [
    "controlled-gen-ui-display",
    "in-chat-hitl-usehumanintheloop-ergonomic-api",
    "in-chat-hitl-useinterrupt-low-level-primitive",
    "in-chat-hitl-booking",
    "in-chat-human-in-the-loop-original",
  ],
  "Declarative Generative UI": [
    "declarative-generative-ui-a2ui-dynamic-schema",
    "declarative-generative-ui-a2ui-fixed-schema",
  ],
  "Open-Ended Generative UI": [
    "mcp-apps",
    "fully-open-ended-generative-ui",
    "open-ended-gen-ui-advanced-with-frontend-function-calling",
  ],
  "Operational Generative UI": [
    "tool-rendering-default-catch-all",
    "tool-rendering-custom-catch-all",
    "tool-rendering",
    "reasoning",
    "agentic-generative-ui-in-chat-state-rendering",
  ],
  "Interactivity": [
    "frontend-tools-in-app-actions",
    "frontend-tools-async",
    "in-app-human-in-the-loop-frontend-tools-async-hitl",
  ],
  "Agent State": [
    "shared-state-read-write",
    "state-streaming",
    "readonly-state-agent-context",
    "file-attachments",
  ],
  "Multi-Agent": [
    "sub-agents",
  ],
  "BYOC": [
    "byoc-hashbrown",
    "byoc-json-render",
  ],
};

/* ------------------------------------------------------------------ */
/*  Partners                                                           */
/* ------------------------------------------------------------------ */

export const BASELINE_PARTNERS: readonly { name: string; slug: string }[] = [
  { name: "LangGraph (Python)", slug: "langgraph-python" },
  { name: "LangGraph (TypeScript)", slug: "langgraph-typescript" },
  { name: "LangGraph (FastAPI)", slug: "langgraph-fastapi" },
  { name: "Google ADK", slug: "google-adk" },
  { name: "MS Agent Framework (Python)", slug: "ms-agent-python" },
  { name: "MS Agent Framework (.NET)", slug: "ms-agent-dotnet" },
  { name: "Strands", slug: "strands" },
  { name: "Mastra", slug: "mastra" },
  { name: "CrewAI", slug: "crewai-crews" },
  { name: "PydanticAI", slug: "pydantic-ai" },
  { name: "Claude Agents SDK (Python)", slug: "claude-sdk-python" },
  { name: "Claude Agents SDK (TS)", slug: "claude-sdk-typescript" },
  { name: "Agno", slug: "agno" },
  { name: "AG2", slug: "ag2" },
  { name: "LlamaIndex", slug: "llamaindex" },
  { name: "Spring AI", slug: "spring-ai" },
  { name: "Langroid", slug: "langroid" },
  { name: "Built-in Agent", slug: "built-in-agent" },
  { name: "AWS FAST - LangGraph", slug: "aws-fast-langgraph" },
  { name: "AWS FAST - Strands", slug: "aws-fast-strands" },
  { name: "Deep Agents", slug: "deep-agents" },
  { name: "Oracle Open Agent Spec", slug: "oracle-open-agent-spec" },
  { name: "OpenAI Agents SDK", slug: "openai-agents-sdk" },
  { name: "n8n", slug: "n8n" },
  { name: "Cloudflare", slug: "cloudflare" },
];
