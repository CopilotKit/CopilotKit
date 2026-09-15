import React from "react";
import { CodingAgentSetupPrompt } from "@/components/coding-agent-setup-prompt";
import { RICH_THREADS_SETUP_PROMPT } from "@/lib/rich-threads-setup-prompt";

export { RICH_THREADS_SETUP_PROMPT } from "@/lib/rich-threads-setup-prompt";

/** Copies the Inspector recovery prompt from the Runtime endpoints guide. */
export function RichThreadsSetupPrompt(): React.JSX.Element {
  return (
    <CodingAgentSetupPrompt
      summary="Use this pre-built prompt to finish Intelligence setup faster."
      prompt={RICH_THREADS_SETUP_PROMPT}
      copySurface="docs_rich_threads_setup_agent_prompt"
    />
  );
}
