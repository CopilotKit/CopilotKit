import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Two pills exercise the recovery loop deterministically via aimock fixtures
// (showcase/aimock/d6/ms-agent-python/a2ui-recovery.json). Prompts are UNIQUE
// within the ms-agent-python context — distinct from both the langgraph-python
// recovery pills and the declarative-gen-ui (a2ui_dynamic) pills — so aimock's
// userMessage matcher disambiguates without needing the x-aimock-context header
// (a real browser does not send it).
//   - "heal":    inner render_a2ui returns a structurally-invalid first attempt
//                (root references a missing child) -> the validate->retry loop
//                rejects it, retries, and the second attempt paints.
//   - "exhaust": inner render_a2ui is invalid on every attempt -> attempt cap
//                hit -> a2ui_recovery_exhausted -> tasteful `failed` state.
export function useA2uiRecoverySuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Recover a bad render",
        message:
          "Draft the Q3 pipeline snapshot and auto-correct a malformed first render.",
      },
      {
        title: "Show an unrecoverable failure",
        message:
          "Generate a summary that fails every validation attempt so I can preview the fallback.",
      },
    ],
    available: "always",
  });
}
