/**
 * Scripted timeline for the homepage animated demo. Times are milliseconds
 * from the start of the loop. The driver in `AnimatedCopilotDemo.tsx` reads
 * this and applies entries in order.
 */

export type ScriptEntry =
  | { at: number; action: "type-input"; text: string }
  | { at: number; action: "submit-user-message" }
  | { at: number; action: "assistant-typing"; on: boolean }
  | { at: number; action: "assistant-message"; text: string }
  | { at: number; action: "tool-call"; name: string; args: Record<string, unknown> }
  | { at: number; action: "tool-result"; result: unknown }
  | { at: number; action: "page-effect"; color: string | null }
  | { at: number; action: "reset" };

export const SCRIPT: ReadonlyArray<ScriptEntry> = [
  { at: 800, action: "type-input", text: "Make the demo background sage green" },
  { at: 2400, action: "submit-user-message" },
  { at: 2600, action: "assistant-typing", on: true },
  { at: 3800, action: "assistant-typing", on: false },
  { at: 3800, action: "assistant-message", text: "Sure — applying the new background now." },
  { at: 4500, action: "tool-call", name: "setBackground", args: { color: "#a3b886" } },
  { at: 5000, action: "page-effect", color: "#a3b886" },
  { at: 5400, action: "tool-result", result: "ok" },
  { at: 6200, action: "assistant-message", text: "Done. Try asking me to render a card next." },
  { at: 11000, action: "page-effect", color: null },
  { at: 11500, action: "reset" },
];

export const SCRIPT_DURATION_MS = 12000;
