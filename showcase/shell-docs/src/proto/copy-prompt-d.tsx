"use client";

import { PromptPill } from "@/components/docs-mdx/prompts/prompt-pill";
import { frameworkById, frontendById } from "./data";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";
import { frameworkHref } from "./routes";

/**
 * The home's "Copy prompt" pill: a setup prompt for a coding agent, scoped to
 * the reader's frontend and agent framework.
 */
export function CopyPromptD() {
  const { frontend } = useFrontend();
  const [framework] = useLastFramework();
  return (
    <PromptPill
      viewPrompt={false}
      createPrompt={() => {
        const fe = frontendById(frontend)?.name ?? "React";
        const fw = frameworkById(framework)?.name ?? "CopilotKit";
        const url = `${window.location.origin}${frameworkHref("d", framework, "quickstart")}`;
        return {
          text: `Add CopilotKit to this ${fe} project with ${fw}.\nFollow ${url} step by step, then run the app.`,
        };
      }}
    />
  );
}
