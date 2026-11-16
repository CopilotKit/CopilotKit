/**
 * Suggestion prompts surfaced in the chat composer. Each suggestion exercises
 * the iframe <-> host bridge: it asks the agent for an interactive sandboxed
 * UI that calls one of the host-side sandbox functions (see
 * `sandbox-functions.ts`). Iframe-specific constraints (no <form>, no
 * type='submit', use addEventListener) live in the system prompt. Keep
 * suggestion titles and messages user-facing.
 *
 * Each `message` string doubles as a deterministic aimock fixture key. Keep
 * them short, distinctive, and aligned with the fixture entries under
 * `showcase/aimock/d6/<slug>/`, so each pill click produces a stable
 * `generateSandboxedUi` tool call (rather than getting absorbed by a generic
 * catch-all fixture).
 */
export const openGenUiSuggestions = [
  {
    title: "Calculator",
    message: "Calculator (calls evaluateExpression)",
  },
  {
    title: "Ping the host",
    message: "Ping the host (calls notifyHost)",
  },
  {
    title: "Inline expression evaluator",
    message: "Inline expression evaluator",
  },
];
