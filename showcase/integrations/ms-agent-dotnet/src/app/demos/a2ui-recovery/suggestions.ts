import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Two pills exercise the recovery loop deterministically via aimock fixtures
// (showcase/aimock/d6/ms-agent-dotnet/a2ui-recovery.json). ms-agent-dotnet's
// RecoveryAgent (agent/RecoveryAgent.cs) reuses A2uiSecondaryToolCaller, so its
// inner render tool is `_design_a2ui_surface` (NOT render_a2ui). Prompts are
// GLOBALLY unique across every integration slug so the shared aimock matcher
// (which keys on userMessage, not context) never collides.
//   - "heal":    inner _design_a2ui_surface returns a structurally invalid
//                surface on attempt 1 (root references a missing child) ->
//                the validate->retry loop rejects it, retries, and attempt 2
//                is valid -> painted (>= 2 declarative-metric tiles).
//   - "exhaust": inner _design_a2ui_surface is invalid on every attempt ->
//                attempt cap hit -> a2ui_recovery_exhausted -> tasteful
//                `failed` state ("Couldn't generate the UI").
export function useA2uiRecoverySuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Recover a bad render",
        message:
          "Generate the Vantage .NET quarterly revenue board and self-heal a malformed first render.",
      },
      {
        title: "Show an unrecoverable failure",
        message:
          "Generate a .NET board that fails every validation pass so I can preview the recovery fallback.",
      },
    ],
    available: "always",
  });
}
