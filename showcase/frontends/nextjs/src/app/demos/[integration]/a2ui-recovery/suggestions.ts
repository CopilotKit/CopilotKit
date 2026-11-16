import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
import type { A2uiRecoveryPrompts } from "./config";

/**
 * Registers the two recovery pills. Their messages come from the
 * integration's settings, because they are the keys of its aimock fixtures:
 * - "Recover a bad render": the first render is invalid, and the retry heals
 *   it into a valid surface.
 * - "Show an unrecoverable failure": every render is invalid, so the attempt
 *   cap is hit and the chat shows the failure state.
 */
export function useA2uiRecoverySuggestions(prompts: A2uiRecoveryPrompts) {
  useConfigureSuggestions({
    suggestions: [
      { title: "Recover a bad render", message: prompts.heal },
      { title: "Show an unrecoverable failure", message: prompts.exhaust },
    ],
    available: "always",
  });
}
