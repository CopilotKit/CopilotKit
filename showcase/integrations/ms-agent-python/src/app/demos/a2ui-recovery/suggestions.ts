import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Two pills exercise the recovery loop deterministically via aimock fixtures
// (showcase/aimock/d6/ms-agent-python/a2ui-recovery.json).
// Prompts are UNIQUE to ms-agent-python — secondary `render_a2ui` LLM calls
// do not carry x-aimock-context, so shared LG/built-in wording would collide
// in the fleet-wide aimock matcher (see d5-a2ui-recovery.ts module docstring).
//   - "heal":    secondary design returns a valid 2-metric surface (after
//                optional invalid first attempts) -> painted.
//   - "exhaust": secondary design is invalid every attempt -> attempt cap
//                hit -> a2ui_recovery_exhausted -> "Couldn't generate the UI".
export function useA2uiRecoverySuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Recover a bad render",
        message:
          "Sketch the Vantage Q2 revenue board and recover if the first A2UI pass is malformed.",
      },
      {
        title: "Show an unrecoverable failure",
        message:
          "Sketch a Vantage board that always fails A2UI validation so I can preview the hard-fail fallback.",
      },
    ],
    available: "always",
  });
}
