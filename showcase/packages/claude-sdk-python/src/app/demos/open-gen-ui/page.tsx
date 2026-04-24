"use client";

/**
 * Open-Ended Generative UI — minimal setup.
 * -----------------------------------------
 * Enabling `openGenerativeUI` in the runtime (see
 * `src/app/api/copilotkit-ogui/route.ts`) is all that's needed — the
 * runtime middleware streams agent-authored HTML + CSS to the built-in
 * `OpenGenerativeUIActivityRenderer`, which mounts it inside a
 * sandboxed iframe. No custom sandbox functions, no custom tools — just
 * chat.
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
 */

import React from "react";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";

const VISUALIZATION_DESIGN_SKILL = `When generating UI with generateSandboxedUi, your goal is to produce a polished, intricate, EDUCATIONAL visualisation that teaches the concept the user asked about. Treat the output like a figure from a well-designed textbook or explorable-explanation — not a bare-bones demo.

Geometry + rendering:
- Use inline SVG (preferred) or <canvas> for geometric content — NEVER stack dozens of <div>s to draw shapes.
- Fit content within a ~600x400 content area with ~16-24px of edge padding. Use viewBox + preserveAspectRatio.
- For 3D-ish scenes, either use SVG with manual perspective math OR CSS 3D transforms.

Animation:
- Prefer CSS @keyframes + transitions over JS setInterval. 300-900ms per cycle; loop cyclical concepts with animation-iteration-count: infinite.
- When JS timing IS needed, use requestAnimationFrame, not setInterval.
- Stagger related elements with animation-delay.

Labels + legend + annotations:
- EVERY axis gets a label. EVERY colour-coded series gets a legend swatch.
- Add short text callouts that explain what the viewer is watching.
- Include a 1-line title + 1-line subtitle at the top.

Palette (use consistently):
- Accent / primary motion: indigo #6366f1
- Success / stable: emerald #10b981
- Warning / active: amber #f59e0b
- Error / destructive: rose #ef4444
- Neutral axes / gridlines: slate #64748b
- Surfaces: white #ffffff; subtle container bg #f8fafc; text #0f172a

Typography:
- system-ui, -apple-system, "Segoe UI", sans-serif.
- Title 16-18px / 600, subtitle 12-13px / 500, axis + legend 11-12px.

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

const minimalSuggestions = [
  {
    title: "3D axis visualization (model airplane)",
    message:
      "Visualize pitch, yaw, and roll using a 3D model airplane. Render a simple airplane silhouette (SVG or CSS-3D) at the origin, with three labelled axes. Animate the airplane cycling through each rotation in turn — rotate about X, pause, rotate about Y, pause, rotate about Z, pause — with a legend showing which axis is active.",
  },
  {
    title: "How a neural network works",
    message:
      'Animate how a simple feed-forward neural network processes an input. Show 3 layers (input 4 nodes, hidden 5 nodes, output 2 nodes) with connections whose thickness encodes weight magnitude. Animate activations pulsing forward in a loop. Use indigo for active signal, slate for quiescent.',
  },
  {
    title: "Quicksort visualization",
    message:
      'Visualize quicksort on an array of ~10 bars of varying heights. At each step highlight the pivot in amber, elements being compared in indigo, and swapped elements in emerald; fade sorted elements to slate.',
  },
];

export default function OpenGenUiDemo() {
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
}

function Chat() {
  useConfigureSuggestions({
    suggestions: minimalSuggestions,
    available: "always",
  });

  return <CopilotChat agentId="open-gen-ui" className="flex-1 rounded-2xl" />;
}
