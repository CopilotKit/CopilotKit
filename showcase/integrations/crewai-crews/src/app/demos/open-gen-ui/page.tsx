"use client";

/**
 * Open-Ended Generative UI — minimal setup.
 *
 * Enabling `openGenerativeUI` in the runtime (see
 * `src/app/api/copilotkit-ogui/route.ts`) streams agent-authored HTML +
 * CSS through the built-in `OpenGenerativeUIActivityRenderer`, mounted
 * inside a sandboxed iframe.
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

const VISUALIZATION_DESIGN_SKILL = `When generating UI with generateSandboxedUi, your goal is to produce a polished, intricate, EDUCATIONAL visualisation. Use inline SVG or canvas, CSS keyframe animations, clear labels and legends, and the semantic palette: indigo #6366f1 (accent), emerald #10b981 (success), amber #f59e0b (warning), rose #ef4444 (error), slate #64748b (neutral). Output initialHeight, 2-3 placeholderMessages, css, and html (single root container).`;

const minimalSuggestions = [
  {
    title: "3D axis visualization (model airplane)",
    message:
      "Visualize pitch, yaw, and roll using a 3D model airplane. Render a simple airplane silhouette (SVG or CSS-3D) at the origin, with three labelled axes. Animate the airplane cycling through each rotation in turn with a legend.",
  },
  {
    title: "How a neural network works",
    message:
      "Animate how a simple feed-forward neural network processes an input. Show 3 layers with connections whose thickness encodes weight magnitude. Animate activations pulsing forward input -> hidden -> output in a loop.",
  },
  {
    title: "Quicksort visualization",
    message:
      "Visualize quicksort on an array of ~10 bars. Highlight the pivot in amber, compared elements in indigo, swapped in emerald; fade sorted elements to slate. Auto-advance through the sort.",
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
