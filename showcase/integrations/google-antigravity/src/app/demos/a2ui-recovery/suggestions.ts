import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Two pills exercise the recovery loop deterministically via aimock fixtures
// (showcase/aimock/d6/google-antigravity/a2ui-recovery.json). Prompts are
// unique per integration slug so they don't collide with the declarative-gen-ui
// fixtures or with another framework's recovery fixtures.
//   - "heal":    the first inner render_a2ui attempt is structurally invalid
//                (the root references a missing child); the backend's
//                validate->retry loop regenerates with the errors appended ->
//                valid -> painted.
//   - "exhaust": inner render_a2ui is invalid on every attempt -> attempt cap
//                hit -> a2ui_recovery_exhausted -> tasteful `failed` state.
export function useA2uiRecoverySuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Recover a bad render",
        message:
          "Chart the Antigravity quarterly revenue board and repair a malformed first render.",
      },
      {
        title: "Show an unrecoverable failure",
        message:
          "Chart an Antigravity board that never passes validation so I can preview the fallback.",
      },
    ],
    available: "always",
  });
}
