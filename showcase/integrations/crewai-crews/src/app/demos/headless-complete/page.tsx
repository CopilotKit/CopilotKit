"use client";

/**
 * Headless UI: Complete — full headless surface in one demo.
 *
 * Mirror of `headless-simple` plus, layered in via focused hook modules,
 * every render surface CopilotKit exposes:
 *
 *   useToolRenderers       — useRenderTool (weather, stock) + useDefaultRenderTool
 *   useFrontendComponents  — useComponent (highlight_note frontend tool)
 *   useHeadlessSuggestions — useConfigureSuggestions (4 prompts)
 *   useAttachmentsConfig   — useAttachments (image + PDF, base64 inline)
 *
 * Plus, inside the chat shell:
 *
 *   useAgent / useCopilotKit          — read messages, dispatch runs
 *   useRenderToolCall                 — render tool-call cards inline
 *   useRenderActivityMessage          — MCP Apps activity (Excalidraw iframe)
 *   useSuggestions                    — render the configured suggestions
 *
 * The hook calls in `<HeadlessCompleteRoot />` form the demo's entire
 * surface, so a reader can see every capability at a glance before
 * diving into the chat UI.
 */

import React from "react";
import { CopilotKitProvider } from "@copilotkit/react-core";
import { Chat } from "./chat/chat";
import { useFrontendComponents } from "./hooks/use-frontend-components";
import { useHeadlessSuggestions } from "./hooks/use-headless-suggestions";
import { useToolRenderers } from "./hooks/use-tool-renderers";

const AGENT_ID = "headless-complete";

export default function HeadlessCompleteDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit-mcp-apps" agentId={AGENT_ID}>
      <HeadlessCompleteRoot />
    </CopilotKitProvider>
  );
}

function HeadlessCompleteRoot() {
  useToolRenderers();
  useFrontendComponents();
  useHeadlessSuggestions();

  return <Chat agentId={AGENT_ID} />;
}
