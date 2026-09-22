import React from "react";
import { CodingAgentSetupPrompt } from "@/components/coding-agent-setup-prompt";
import { LEARNING_SETUP_PROMPT } from "@/lib/learning-setup-prompt";

export { LEARNING_SETUP_PROMPT } from "@/lib/learning-setup-prompt";

/** Copies the task-specific coding-agent prompt from the Learning guide. */
export function LearningSetupPrompt(): React.JSX.Element {
  return (
    <CodingAgentSetupPrompt
      feature="learning"
      onboardingIntent="add-learning"
      summary="Use this pre-built prompt to set up Learning faster."
      prompt={LEARNING_SETUP_PROMPT}
      copySurface="docs_learning_setup_prompt"
    />
  );
}
