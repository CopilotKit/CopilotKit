import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Two pills exercise the recovery loop deterministically via aimock fixtures
// (showcase/aimock/d6/langgraph-fastapi/a2ui-recovery.json). Prompts are unique
// within the langgraph-fastapi context so they don't collide with the
// declarative-gen-ui (a2ui_dynamic) fixtures.
//   - "heal":    inner render_a2ui returns free-form/sloppy args (components &
//                data as JSON strings) -> middleware parse_and_fix heals them
//                into a valid surface in a single pass -> painted.
//   - "exhaust": inner render_a2ui is invalid on every attempt -> attempt cap
//                hit -> a2ui_recovery_exhausted -> tasteful `failed` state.
export function useA2uiRecoverySuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Recover a bad render",
        message:
          "Put together a quarterly metrics overview and repair a malformed first attempt.",
      },
      {
        title: "Show an unrecoverable failure",
        message:
          "Put together an overview whose every render is invalid so I can see the fallback.",
      },
    ],
    available: "always",
  });
}
