/**
 * Default threshold (in characters) for the assembled agent system prompt.
 *
 * We warn rather than truncate: an application legitimately shares large state
 * (a whole document, sheet or research report), and silently dropping it would
 * corrupt the conversation. Characters are not tokens, so this is a heuristic
 * signal, not a hard budget. The value is configurable via
 * `COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD`:
 *
 *  - `-1` disables the warning entirely.
 *  - `0` warns on any non-empty assembled prompt.
 */
export const DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD = 100_000;

/** Which prompt-assembly path we are measuring (used only to dedupe the warning). */
export type AgentContextAssembleVariant = "builtIn" | "tanstack";

/**
 * Module-level bookkeeping so each call site warns at most once **per process**.
 * This is intentional: a long-running server should surface the oversized-prompt
 * signal once rather than on every turn. It is only reset in tests via
 * `resetAgentContextWarnState`; in production it stays set for the lifetime of
 * the process.
 */
const warnedVariants = new Set<AgentContextAssembleVariant>();

/** Reads the (optional, environment-overridable) warning threshold. */
export function getAgentContextWarnThreshold(): number {
  const raw = process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;
  if (raw === undefined || raw === "") {
    return DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD;
  }
  // `parseInt` accepts a valid prefix and silently ignores trailing input
  // ("100abc" -> 100, "1.5" -> 1). Only accept a complete non-negative integer,
  // plus the documented `-1` disable sentinel; any other value falls back to the
  // default so a malformed env value cannot silently lower or disable warnings.
  const trimmed = raw.trim();
  if (trimmed === "-1") {
    return -1;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD;
}

/** Test-only: clears the per-variant "already warned" bookkeeping. */
export function resetAgentContextWarnState(): void {
  warnedVariants.clear();
}

/**
 * Warns (once per call site) when the assembled agent system prompt is large
 * enough to inflate token cost, without discarding any data.
 *
 * Callers pass the actual size of the prompt they assembled, so the measurement
 * can never drift from what is injected:
 *
 *  - `builtIn`: the exact `systemPrompt.length` (includes the developer prompt).
 *  - `tanstack`: the summed length of the `systemPrompts` entries (approximate —
 *    the provider adapter performs the final join, so entry separators are not
 *    counted and differ between adapters).
 */
export function warnIfAssembledAgentContextOversized(
  assembledSize: number,
  variant: AgentContextAssembleVariant,
): void {
  const threshold = getAgentContextWarnThreshold();
  if (threshold < 0) {
    return;
  }
  if (assembledSize <= threshold) {
    return;
  }
  if (warnedVariants.has(variant)) {
    return;
  }
  warnedVariants.add(variant);
  // eslint-disable-next-line no-console
  console.warn(
    "[CopilotKit] Assembled agent system prompt is large (" +
      `${assembledSize.toLocaleString()} characters). ` +
      "This goes into the prompt and can inflate token cost. " +
      "Consider trimming what you share, or raise " +
      "COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD if this is intentional.",
  );
}
