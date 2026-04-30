"use client";

/**
 * Beautiful Chat — simplified AG2 port.
 * --------------------------------------
 * The canonical langgraph-python `beautiful-chat` is a flagship cell that
 * combines THREE features on a single runtime: A2UI (dynamic + fixed),
 * Open Generative UI, and MCP Apps. For the AG2 port we ship the first
 * two together to keep the cell small and focused: the same dedicated
 * runtime turns on `openGenerativeUI` for the agent AND wires an A2UI
 * catalog with `injectA2UITool: false` (the backend agent owns
 * `generate_a2ui` explicitly — see `src/agents/beautiful_chat.py`). MCP
 * is left to its own dedicated cell at `/demos/mcp-apps`.
 *
 * The catalog and renderers are imported from the sibling
 * `declarative-gen-ui` cell — same registered components (Card,
 * StatusBadge, Metric, InfoRow, PrimaryButton, PieChart, BarChart) plus
 * the basic A2UI primitives. No duplicate copies; the catalog is the
 * single source of truth for branded A2UI rendering on AG2.
 *
 * Reference:
 * - showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/
 * - src/app/demos/declarative-gen-ui/   (catalog reused here)
 * - src/app/demos/open-gen-ui/          (OGUI pattern reused here)
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { myCatalog } from "../declarative-gen-ui/a2ui/catalog";

// @region[design-skill]
// Reused-and-trimmed from `/demos/open-gen-ui` — applies to every
// `generateSandboxedUi` call the agent makes inside Beautiful Chat.
const VISUALIZATION_DESIGN_SKILL = `When generating UI with generateSandboxedUi inside Beautiful Chat, your goal is a polished, intricate visualisation that reads like a textbook figure or branded explainer.

Geometry + rendering:
- Use inline SVG (preferred) or <canvas> for geometric content. Never stack <div>s to draw shapes.
- Fit content within ~600x400 with 16-24px edge padding. Use viewBox + preserveAspectRatio.

Animation:
- Prefer CSS @keyframes / transitions over setInterval. 300-900ms cycles. Loop cyclical concepts.
- Use requestAnimationFrame when JS timing is needed. Stagger related elements with animation-delay.

Labels + legend:
- Every axis labelled. Every colour-coded series gets a legend swatch.
- Short text callouts explaining each step. 1-line title + 1-line subtitle.

Palette:
- Accent: indigo #6366f1   Success: emerald #10b981   Warning: amber #f59e0b
- Error: rose #ef4444      Neutral: slate #64748b     Surface: white #ffffff   Bg: #f8fafc

Typography:
- system-ui, -apple-system, "Segoe UI", sans-serif.
- Title 16-18px / 600, subtitle 12-13px / 500 slate, axis labels 11-12px.

Containers:
- Outer card: white, 1px solid #e2e8f0, 10-12px border-radius, 20-24px padding.

Motion principles:
- Motion teaches. Every animated element corresponds to a step of the concept.

Output contract (in order):
- initialHeight (480-560 typical), placeholderMessages (2-3 short lines), css (complete), html (one root container with title + SVG + legend).`;
// @endregion[design-skill]

const SUGGESTIONS = [
  // A2UI suggestions — exercise the registered component catalog.
  {
    title: "KPI dashboard (A2UI)",
    message:
      "Show me a quick KPI dashboard with 3-4 metrics — revenue, signups, churn, NPS. Use the registered components.",
  },
  {
    title: "Pie chart — sales by region (A2UI)",
    message: "Show a pie chart of sales by region.",
  },
  {
    title: "Bar chart — quarterly revenue (A2UI)",
    message: "Render a bar chart of quarterly revenue.",
  },
  {
    title: "Status report (A2UI)",
    message:
      "Give me a status report on system health — API, database, and background workers.",
  },
  // OGUI suggestions — exercise generateSandboxedUi for free-form visuals.
  {
    title: "How a neural network works (Open Gen UI)",
    message:
      "Animate how a simple feed-forward neural network processes an input. Show 3 layers (4 → 5 → 2) with activation pulses flowing forward in a loop. Label each layer.",
  },
  {
    title: "Quicksort visualization (Open Gen UI)",
    message:
      "Visualize quicksort on ~10 bars of varying heights. Highlight the pivot in amber, compared elements in indigo, swaps in emerald. Auto-advance through the sort with a caption per step.",
  },
];

export default function BeautifulChatDemo() {
  return (
    // @region[provider-combined]
    // Combined runtime: A2UI catalog + Open Generative UI design skill,
    // both pointed at `/api/copilotkit-beautiful-chat` so the
    // `openGenerativeUI` flag is scoped to this cell only.
    <CopilotKit
      runtimeUrl="/api/copilotkit-beautiful-chat"
      agent="beautiful-chat"
      a2ui={{ catalog: myCatalog }}
      openGenerativeUI={{ designSkill: VISUALIZATION_DESIGN_SKILL }}
    >
      <div
        data-testid="demo-beautiful-chat"
        className="flex justify-center items-center h-screen w-full"
      >
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
    // @endregion[provider-combined]
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: SUGGESTIONS,
    available: "always",
  });

  return (
    <CopilotChat agentId="beautiful-chat" className="h-full rounded-2xl" />
  );
}
