"use client";

/**
 * Open-Ended Generative UI — minimal setup (Strands, Wave 2).
 *
 * Enabling `openGenerativeUI` in the runtime (see
 * `src/app/api/copilotkit-ogui/route.ts`) is all that's needed — the
 * runtime middleware streams agent-authored HTML + CSS to the built-in
 * `OpenGenerativeUIActivityRenderer`, which mounts it inside a sandboxed
 * iframe.
 *
 * This page customises the LLM's visual-authoring prompt via
 * `openGenerativeUI.designSkill` on the provider.
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

const VISUALIZATION_DESIGN_SKILL = `When generating UI with generateSandboxedUi, your goal is to produce a polished, intricate, EDUCATIONAL visualisation that teaches the concept the user asked about. Treat the output like a figure from a well-designed textbook or explorable-explanation — not a bare-bones demo.

Geometry + rendering:
- Use inline SVG (preferred) or <canvas> for geometric content — NEVER stack dozens of <div>s to draw shapes.
- Fit content within a ~600x400 content area with ~16-24px of edge padding. Use viewBox + preserveAspectRatio so it scales cleanly.
- For 3D-ish scenes, either use SVG with manual perspective math OR CSS 3D transforms.

Animation:
- Prefer CSS @keyframes + transitions over JS setInterval. Use animation-timing-function ease-in-out or cubic-bezier; 300-900ms per cycle; loop with animation-iteration-count: infinite where the concept is cyclical.
- When JS timing IS needed, use requestAnimationFrame, not setInterval.

Labels + legend + annotations:
- EVERY axis gets a label.
- EVERY colour-coded series gets a legend swatch with a short caption.
- Add short text callouts that explain what the viewer is watching.
- Include a 1-line title + 1-line subtitle at the top describing the concept.

Palette:
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

Interactivity:
- This minimal cell has NO host-side sandbox functions — the visualisation is self-running. Do NOT attempt fetch, XHR, localStorage, cookies, or Websandbox.connection.remote calls.

Output contract (in order):
- Emit initialHeight first (typically 480-560 for these visualisations).
- placeholderMessages: 2-3 short lines.
- css: complete and self-contained.
- html: ONE root container with the title + subtitle + SVG/canvas + legend.`;

const minimalSuggestions = [
  {
    title: "3D axis visualization (model airplane)",
    message:
      "Visualize pitch, yaw, and roll using a 3D model airplane. Render a simple airplane silhouette at the origin, with three labelled axes (X=pitch, Y=yaw, Z=roll). Animate the airplane cycling through each rotation in turn with a legend showing which axis is active.",
  },
  {
    title: "How a neural network works",
    message:
      "Animate how a simple feed-forward neural network processes an input. Show 3 layers (input 4 nodes, hidden 5 nodes, output 2 nodes) with connections whose thickness encodes weight magnitude. Animate activations pulsing forward from input -> hidden -> output in a loop, brightening each node as it fires.",
  },
  {
    title: "Quicksort visualization",
    message:
      "Visualize quicksort on an array of ~10 bars of varying heights. At each step highlight the pivot in amber, elements being compared in indigo, and swapped elements in emerald; fade sorted elements to slate. Auto-advance through the sort in a loop.",
  },
  {
    title: "Fourier: square wave from sines",
    message:
      "Visualize how a square wave is built from the sum of odd-harmonic sine waves. Show 3 rotating circles on the left (epicycles at frequencies 1, 3, 5 with amplitudes 1, 1/3, 1/5), the running sum traced as a point, and the resulting waveform scrolling to the right over time.",
  },
];

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
    suggestions: minimalSuggestions,
    available: "always",
  });

  return <CopilotChat agentId="open-gen-ui" className="flex-1 rounded-2xl" />;
}
