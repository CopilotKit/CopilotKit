"use client";

/**
 * Open-Ended Generative UI — minimal setup (Langroid).
 * ----------------------------------------------------
 * The simplest possible example. Enabling `openGenerativeUI` on the
 * runtime (see `src/app/api/copilotkit-ogui/route.ts`) is all that is
 * needed — the runtime middleware streams agent-authored HTML + CSS to
 * the built-in `OpenGenerativeUIActivityRenderer`, which mounts it
 * inside a sandboxed iframe.
 *
 * NOTE (Langroid parity): the canonical LangGraph variant uses
 * `CopilotKitMiddleware` server-side to merge the frontend-registered
 * `generateSandboxedUi` tool into the agent's tool list. Langroid does
 * not have an equivalent middleware system — this cell relies on the
 * AG-UI tool-discovery flow to surface `generateSandboxedUi` to the
 * Langroid agent at runtime. The Langroid system prompt instructs the
 * agent to call the frontend `generateSandboxedUi` tool when asked to
 * produce a UI.
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

// @region[visualization-design-skill]
// Replaces the default shadcn-flavoured design skill with guidance tuned
// for intricate, educational, self-running visualisations.
const VISUALIZATION_DESIGN_SKILL = `When generating UI with generateSandboxedUi, your goal is to produce a polished, intricate, EDUCATIONAL visualisation that teaches the concept the user asked about. Treat the output like a figure from a well-designed textbook or explorable-explanation — not a bare-bones demo.

Geometry + rendering:
- Use inline SVG (preferred) or <canvas> for geometric content — NEVER stack dozens of <div>s to draw shapes.
- Fit content within a ~600x400 content area with ~16-24px of edge padding. Use viewBox + preserveAspectRatio so it scales cleanly.

Animation:
- Prefer CSS @keyframes + transitions over JS setInterval. Use animation-timing-function ease-in-out or cubic-bezier; 300-900ms per cycle.

Labels + legend + annotations:
- EVERY axis gets a label. EVERY colour-coded series gets a legend swatch with a short caption.
- Add short text callouts that explain what the viewer is watching.
- Include a 1-line title + 1-line subtitle at the top describing the concept.

Palette (use these semantic colours consistently):
- Accent / primary motion: indigo #6366f1
- Success / stable / correct: emerald #10b981
- Warning / attention / active: amber #f59e0b
- Error / destructive / contrast: rose #ef4444
- Neutral axes, gridlines, secondary text: slate #64748b
- Surfaces: white #ffffff; subtle container bg #f8fafc; text #0f172a

Typography:
- system-ui, -apple-system, "Segoe UI", sans-serif.
- Title 16-18px / 600, subtitle 12-13px / 500 slate, axis + legend labels 11-12px.

Containers:
- Outer card: white background, 1px solid #e2e8f0 border, 10-12px border-radius, 20-24px padding.

Motion principles:
- Motion must teach. No decorative spinners or jitter for its own sake.

Interactivity:
- This minimal cell has NO host-side sandbox functions — the visualisation is self-running.

Output contract (in order):
- Emit initialHeight first (typically 480-560 for these visualisations).
- placeholderMessages: 2-3 short lines.
- css: complete and self-contained.
- html: ONE root container with the title + subtitle + SVG/canvas + legend.

Accessibility:
- Text contrast >= 4.5:1 against its background.`;
// @endregion[visualization-design-skill]

export default function OpenGenUiDemo() {
  // @region[minimal-provider-setup]
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-ogui"
      agent="open-gen-ui"
      openGenerativeUI={{ designSkill: VISUALIZATION_DESIGN_SKILL }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl flex flex-col p-3">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
  // @endregion[minimal-provider-setup]
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      // canonical e2e pill — see showcase/aimock/_canonical-catalog.json
      { title: "Open block", message: "render an open gen-ui element" },
    ],
    available: "always",
  });

  return <CopilotChat agentId="open-gen-ui" className="flex-1 rounded-2xl" />;
}
