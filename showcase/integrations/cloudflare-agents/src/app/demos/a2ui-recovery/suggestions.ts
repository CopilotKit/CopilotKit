import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Two pills exercise the recovery loop deterministically via aimock fixtures
// (showcase/aimock/d6/cloudflare-agents/a2ui-recovery.json). Prompts are unique
// within the cloudflare-agents context so they don't collide with the
// declarative-gen-ui fixtures.
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
          "Lay out the Cloudflare revenue board and recover from a malformed first render.",
      },
      {
        title: "Show an unrecoverable failure",
        message:
          "Lay out a Cloudflare board that never passes validation so I can preview the fallback.",
      },
    ],
    available: "always",
  });
}
