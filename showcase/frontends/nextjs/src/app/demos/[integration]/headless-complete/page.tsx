"use client";

/**
 * Headless UI: Complete. The full headless surface in one demo.
 *
 * Mirror of `headless-simple`, plus every render surface CopilotKit
 * exposes, each one added by a focused hook module:
 *
 *   useToolRenderers       - useRenderTool (weather, stock, chart) + useDefaultRenderTool
 *   useFrontendComponents  - useComponent (highlight_note frontend tool)
 *   useHeadlessSuggestions - useConfigureSuggestions (4 prompts)
 *   useAttachmentsConfig   - useAttachments (image + PDF, base64 inline)
 *
 * Plus, inside the chat shell:
 *
 *   useAgent / useCopilotKit - read messages, dispatch runs
 *   useRenderToolCall        - render tool-call cards inline
 *   useRenderActivityMessage - MCP Apps activity (Excalidraw iframe)
 *   useSuggestions           - render the configured suggestions
 *
 * The hook calls in `<HeadlessCompleteRoot />` form the demo's entire
 * surface, so a reader can see every capability at a glance before
 * diving into the chat UI.
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { Chat } from "./chat/chat";
import { useFrontendComponents } from "./hooks/use-frontend-components";
import { useHeadlessSuggestions } from "./hooks/use-headless-suggestions";
import { useToolRenderers } from "./hooks/use-tool-renderers";

const AGENT_ID = "headless-complete";

export default function HeadlessCompleteDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("headless-complete")}
      agent={AGENT_ID}
    >
      <HeadlessCompleteRoot />
    </CopilotKit>
  );
}

function HeadlessCompleteRoot() {
  useToolRenderers();
  useFrontendComponents();
  useHeadlessSuggestions();

  return <Chat agentId={AGENT_ID} />;
}
