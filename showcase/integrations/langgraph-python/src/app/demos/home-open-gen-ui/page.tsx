"use client";

/**
 * Homepage: Open Ended Gen UI — bare-minimum openGenerativeUI wiring,
 * styled in the experimental "lavender glass" design language.
 *
 * The Open Gen UI runtime (/api/copilotkit-ogui) streams agent-authored
 * HTML/CSS to the built-in OpenGenerativeUIActivityRenderer, which
 * mounts it in a sandboxed iframe. The agent's generated HTML keeps
 * its own styling — but the chat shell around it carries the
 * experimental theme.
 *
 * Iframe target for the "Open Ended Gen UI" chip on the homepage dojo.
 */

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

import "../_experimental-theme/theme.css";

export default function HomeOpenGenUiDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-ogui" agent="open-gen-ui" enableInspector={false}>
      <div className="hd-exp-scope h-screen w-screen overflow-hidden">
        <CopilotChat agentId="open-gen-ui" className="h-full" />
      </div>
    </CopilotKit>
  );
}
