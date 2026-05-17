"use client";

/**
 * Homepage: Open Ended Gen UI — bare-minimum openGenerativeUI wiring.
 *
 * The Open Gen UI runtime (/api/copilotkit-ogui) streams agent-authored
 * HTML/CSS to the built-in OpenGenerativeUIActivityRenderer, which
 * mounts it in a sandboxed iframe. The frontend's job is just to point
 * at that runtime — no custom design skill, no extra layout, no
 * suggestions.
 *
 * Iframe target for the "Open Ended Gen UI" chip on the website
 * homepage dojo.
 */

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

export default function HomeOpenGenUiDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-ogui" agent="open-gen-ui">
      <CopilotChat agentId="open-gen-ui" />
    </CopilotKit>
  );
}
