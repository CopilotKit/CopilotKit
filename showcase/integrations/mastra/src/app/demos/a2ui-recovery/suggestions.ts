import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Two pills exercise the recovery loop deterministically via aimock fixtures
// (showcase/aimock/d6/mastra/a2ui-recovery.json). Prompts are UNIQUE within the
// mastra context AND across frameworks (no substring overlap) so the context-less
// inner render_a2ui fixtures don't collide with google-adk's (load-order-first
// match — see the A2UI recovery memory).
//   - "heal":    inner render_a2ui attempt 1 is structurally invalid ->
//                validate->retry -> attempt 2 valid -> painted.
//   - "exhaust": inner render_a2ui invalid on every attempt -> attempt cap hit
//                -> a2ui_recovery_exhausted -> tasteful `failed` state.
export function useA2uiRecoverySuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Recover a bad render",
        message:
          "Draft the Vantage quarterly revenue tile and mend a botched opening attempt.",
      },
      {
        title: "Show an unrecoverable failure",
        message:
          "Draft a Vantage board that flunks every validation sweep so I can preview the fallback.",
      },
    ],
    available: "always",
  });
}
