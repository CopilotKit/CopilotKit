"use client";

import React from "react";
import { DocsPromptActions } from "./docs-prompt-actions";

export interface CodingAgentSetupPromptProps {
  /** Short task-specific description of the prompt. */
  summary: string;
  /** Full prompt copied to the clipboard and revealed on demand. */
  prompt: string;
  /** Stable analytics identifier for the page that owns this prompt. */
  copySurface: string;
}

/** Setup prompts share copy, preview, app launch, and clipboard recovery. */
export function CodingAgentSetupPrompt({
  summary,
  prompt,
  copySurface,
}: CodingAgentSetupPromptProps): React.JSX.Element {
  return (
    <section
      aria-label={summary}
      className="not-prose my-6"
      data-docs-copy-surface={copySurface}
    >
      <DocsPromptActions
        surface={copySurface}
        createPrompt={() => ({ text: prompt })}
      />
    </section>
  );
}
