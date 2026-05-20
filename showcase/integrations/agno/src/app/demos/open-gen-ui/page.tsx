"use client";

/**
 * Open-Ended Generative UI — minimal setup (Agno).
 * -------------------------------------------------
 * Enabling `openGenerativeUI` in the runtime (see
 * `src/app/api/copilotkit-ogui/route.ts`) is all that's needed — the runtime
 * middleware streams agent-authored HTML + CSS to the built-in
 * `OpenGenerativeUIActivityRenderer`, which mounts it inside a sandboxed
 * iframe. No custom sandbox functions, no custom tools — just chat.
 *
 * This page customises the LLM's visual-authoring prompt via
 * `openGenerativeUI.designSkill` on the provider so the cell showcases rich
 * educational visualisations.
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

const VISUALIZATION_DESIGN_SKILL = `When generating UI with generateSandboxedUi, your goal is to produce a polished, intricate, EDUCATIONAL visualisation that teaches the concept the user asked about. Treat the output like a figure from a well-designed textbook or explorable-explanation — not a bare-bones demo.

Geometry + rendering:
- Use inline SVG (preferred) or <canvas> for geometric content — NEVER stack dozens of <div>s to draw shapes. SVG gives you crisp lines, labelled groups, and easy transforms.
- Fit content within a ~600x400 content area with ~16-24px of edge padding. Use viewBox + preserveAspectRatio so it scales cleanly.
- For 3D-ish scenes, either use SVG with manual perspective math OR CSS 3D transforms (transform-style: preserve-3d, perspective on the parent). Keep vanishing lines consistent.

Animation:
- Prefer CSS @keyframes + transitions over JS setInterval. Use animation-timing-function ease-in-out or cubic-bezier; 300-900ms per cycle; loop with animation-iteration-count: infinite where the concept is cyclical.
- When JS timing IS needed, use requestAnimationFrame, not setInterval.
- Stagger related elements with animation-delay so motion reads as layered, not monolithic.

Labels + legend + annotations:
- EVERY axis gets a label (e.g. "Pitch (X)", "Yaw (Y)", "Roll (Z)").
- EVERY colour-coded series gets a legend swatch with a short caption.
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
- Title 16-18px / 600, subtitle 12-13px / 500 slate, axis + legend labels 11-12px, callouts 11-13px.

Containers:
- Outer card: white background, 1px solid #e2e8f0 border, 10-12px border-radius, 20-24px padding.

Motion principles:
- Motion must teach. Every animated element should correspond to a step of the concept.

Interactivity:
- This minimal cell has NO host-side sandbox functions — the visualisation is self-running. Do NOT attempt fetch, XHR, localStorage, cookies, or Websandbox.connection.remote calls.

Output contract (in order):
- Emit initialHeight first (typically 480-560 for these visualisations).
- placeholderMessages: 2-3 short lines.
- css: complete and self-contained.
- html: ONE root container with the title + subtitle + SVG/canvas + legend.

Accessibility:
- Text contrast >= 4.5:1 against its background.
- Do not rely on colour alone to distinguish series.`;

const minimalSuggestions = [
  {
    title: "3D axis visualization (model airplane)",
    message:
      "Visualize pitch, yaw, and roll using a 3D model airplane. Render a simple airplane silhouette (SVG or CSS-3D) at the origin, with three labelled axes (X=pitch, Y=yaw, Z=roll). Animate the airplane cycling through each rotation in turn — rotate about X, pause, rotate about Y, pause, rotate about Z, pause — with a legend showing which axis is active.",
  },
  {
    title: "How a neural network works",
    message:
      "Animate how a simple feed-forward neural network processes an input. Show 3 layers (input 4 nodes, hidden 5 nodes, output 2 nodes) with connections whose thickness encodes weight magnitude. Animate activations pulsing forward from input -> hidden -> output in a loop, brightening each node as it fires. Label each layer.",
  },
  {
    title: "Quicksort visualization",
    message:
      "Visualize quicksort on an array of ~10 bars of varying heights. At each step highlight the pivot in amber, elements being compared in indigo, and swapped elements in emerald; fade sorted elements to slate. Auto-advance through the sort in a loop (~600ms per step) with a caption showing the current operation.",
  },
];

export default function OpenGenUiDemo() {
  // @region[minimal-provider-setup]
  // Minimal Open Generative UI frontend: the built-in activity renderer is
  // registered by CopilotKitProvider, so a plain <CopilotChat /> is enough —
  // no custom tool renderers, no activity-renderer registration.
  // We DO pass `openGenerativeUI.designSkill` to swap in visualisation-tuned
  // guidance in place of the default shadcn design skill.
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
    suggestions: minimalSuggestions,
    available: "always",
  });

  return <CopilotChat agentId="open-gen-ui" className="flex-1 rounded-2xl" />;
}
