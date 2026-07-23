"use client";

/**
 * Open-Ended Generative UI — minimal setup.
 *
 * Enabling `openGenerativeUI` in the runtime (see
 * `src/app/api/copilotkit-ogui/route.ts`) is all that's needed — the runtime
 * middleware streams agent-authored HTML + CSS to the built-in
 * `OpenGenerativeUIActivityRenderer`, which mounts it inside a sandboxed
 * iframe. No custom sandbox functions, no custom tools — just chat.
 */

import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";

const VISUALIZATION_DESIGN_SKILL = `When generating UI with generateSandboxedUi, your goal is to produce a polished, intricate, EDUCATIONAL visualisation that teaches the concept the user asked about. Treat the output like a figure from a well-designed textbook or explorable-explanation — not a bare-bones demo.

Geometry + rendering:
- Use inline SVG (preferred) or <canvas> for geometric content — NEVER stack dozens of <div>s to draw shapes.
- Fit content within a ~600x400 content area with ~16-24px of edge padding. Use viewBox + preserveAspectRatio so it scales cleanly.

Animation:
- Prefer CSS @keyframes + transitions over JS setInterval. Use animation-timing-function ease-in-out or cubic-bezier; 300-900ms per cycle.
- When JS timing IS needed, use requestAnimationFrame.

Labels + legend + annotations:
- EVERY axis gets a label. EVERY colour-coded series gets a legend swatch.
- Add short text callouts that explain what the viewer is watching.
- Include a 1-line title + 1-line subtitle at the top.

Palette: indigo #6366f1 (primary motion), emerald #10b981 (stable), amber #f59e0b (active), rose #ef4444 (contrast), slate #64748b (axes).

Typography: system-ui sans-serif. Title 16-18px/600. Axis labels 11-12px.

Output contract: Emit initialHeight first (480-560), then placeholderMessages (2-3 short lines), then css, then html with ONE root container.`;

export default function OpenGenUiDemo() {
  // @region[minimal-provider-setup]
  // Minimal Open Generative UI frontend: the built-in activity renderer is
  // registered by CopilotKitProvider, so a plain <CopilotChat /> is enough —
  // no custom tool renderers, no activity-renderer registration.
  // We DO pass `openGenerativeUI.designSkill` to swap in visualisation-tuned
  // guidance in place of the default shadcn design skill.
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-ogui"
      useSingleEndpoint
      openGenerativeUI={{ designSkill: VISUALIZATION_DESIGN_SKILL }}
    >
      <main className="p-8">
        <h1 className="text-2xl font-semibold mb-4">Open Generative UI</h1>
        <p className="text-sm opacity-70 mb-6">
          Try: &ldquo;Visualize how a neural network performs a forward
          pass.&rdquo; The agent authors HTML + CSS that mounts inside a
          sandboxed iframe inline in the chat.
        </p>
        <CopilotChat />
      </main>
    </CopilotKitProvider>
  );
  // @endregion[minimal-provider-setup]
}
