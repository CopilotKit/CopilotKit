import React from "react";
import { CodingAgentSetupPrompt } from "@/components/coding-agent-setup-prompt";
import { MEMORY_SETUP_PROMPT } from "@/lib/memory-setup-prompt";

export function MemorySetupPrompt(): React.JSX.Element {
  return (
    <CodingAgentSetupPrompt
      feature="memory"
      summary="Set up Memories with your coding agent."
      prompt={MEMORY_SETUP_PROMPT}
      copySurface="docs_memory_setup_prompt"
    />
  );
}
