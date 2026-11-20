import type { DocsScope } from "../scope";
import {
  LEARNING_SETUP_PROMPT,
  MEMORY_SETUP_PROMPT,
  RICH_THREADS_SETUP_PROMPT,
  WEBMCP_SETUP_PROMPT,
} from "./onboarding";
import { CodingAgentSetupPrompt } from "./prompt-actions";

// Feature guides' coding-agent prompts, with shell-docs' copy, surfaces and
// intents. CLI-backed ones (`onboardingIntent`) mint a run id per copy; the
// constant is the run-id-less text the Markdown output uses.

export function RichThreadsSetupPrompt({ scope }: { scope: DocsScope }) {
  return (
    <CodingAgentSetupPrompt
      scope={scope}
      feature="threads"
      onboardingIntent="add-rich-threads"
      summary="Use this pre-built prompt to finish Intelligence setup faster."
      prompt={RICH_THREADS_SETUP_PROMPT}
      copySurface="docs_rich_threads_setup_agent_prompt"
    />
  );
}

export function MemorySetupPrompt({ scope }: { scope: DocsScope }) {
  return (
    <CodingAgentSetupPrompt
      scope={scope}
      feature="memory"
      summary="Set up User Memories with your coding agent."
      prompt={MEMORY_SETUP_PROMPT}
      copySurface="docs_memory_setup_prompt"
    />
  );
}

export function LearningSetupPrompt({ scope }: { scope: DocsScope }) {
  return (
    <CodingAgentSetupPrompt
      scope={scope}
      feature="learning"
      onboardingIntent="add-learning"
      summary="Use this pre-built prompt to set up Automatic Learning faster."
      prompt={LEARNING_SETUP_PROMPT}
      copySurface="docs_learning_setup_prompt"
    />
  );
}

export function WebMCPSetupPrompt({ scope }: { scope: DocsScope }) {
  return (
    <CodingAgentSetupPrompt
      scope={scope}
      feature="webmcp"
      summary="Use this pre-built prompt to get WebMCP running faster."
      prompt={WEBMCP_SETUP_PROMPT}
      copySurface="docs_webmcp_setup_prompt"
    />
  );
}
