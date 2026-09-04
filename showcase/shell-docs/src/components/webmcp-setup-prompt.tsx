import React from "react";
import { CodingAgentSetupPrompt } from "@/components/coding-agent-setup-prompt";

export const WEBMCP_SETUP_PROMPT =
  "Set up WebMCP in this project using https://docs.copilotkit.ai/webmcp. First inspect the app and extend its existing CopilotKit setup if present; do not add a backend agent solely for WebMCP. If I haven’t specified a tool, ask what I want to expose. If I don’t have one in mind, add a small, read-only demo tool that fits the app. Finish by verifying that a compatible browser can discover and call it.";

export function WebMCPSetupPrompt(): React.JSX.Element {
  return (
    <CodingAgentSetupPrompt
      summary="Use this pre-built prompt to get WebMCP running faster."
      prompt={WEBMCP_SETUP_PROMPT}
      copySurface="docs_webmcp_setup_prompt"
    />
  );
}
