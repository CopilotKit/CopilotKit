/**
 * Default threshold (in characters) for the assembled agent context prompt.
 *
 * We warn rather than truncate: an application legitimately shares large state
 * (a whole document, sheet or research report), and silently dropping it would
 * corrupt the conversation. Characters are not tokens, so this is a heuristic
 * signal, not a hard budget. The value is configurable via
 * `COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD` (setting it to `-1` disables the
 * warning entirely).
 */
export const DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD = 100_000;

/** Which prompt-assembly path we are measuring, so the size matches exactly
 * what that path will inject (rather than a generic approximation). */
export type AgentContextAssembleVariant = "builtIn" | "tanstack";

/** Remembers which call-site variants already warned, so repeated agent turns
 * do not emit the same warning over and over (warn once per call site). */
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
 * Estimates the size (in characters) of the context block that will be
 * assembled into the system prompt, covering both `context` values and the
 * already-serialized `state`.
 *
 * Each prompt builder serializes `state` exactly once and passes the resulting
 * text here, so the measurement uses the same bytes the prompt contains and we
 * never invoke `state.toJSON()` a second time (which could be stateful). It
 * never mutates or drops the supplied data.
 */
export function computeAssembledAgentContextSize(
  context: readonly { description: string; value: string }[] | undefined,
  serializedState: string | undefined,
  variant: AgentContextAssembleVariant,
): number {
  let size = 0;
  const hasSerializedState = serializedState !== undefined;

  if (context) {
    if (variant === "builtIn") {
      // `agent/index.ts` only emits the header when context is non-empty, so an
      // empty array must not count it (otherwise the prompt would be overestimated).
      if (context.length > 0) {
        size += "\n## Context from the application\n".length;
      }
      for (const entry of context) {
        // Matches `parts.push(\`${description}:\n${value}\n\`)`.
        size += `${entry.description}:\n${entry.value}\n`.length;
      }
    } else {
      // `convertInputToTanStackAI` pushes each entry as a separate string in an
      // array that is later joined by `\n`; the last entry has no trailing `\n`.
      for (let i = 0; i < context.length; i++) {
        const entry = context[i]!;
        size += `${entry.description}:\n${entry.value}`.length;
        if (i < context.length - 1) {
          size += 1; // the `\n` joiner between systemPrompts entries
        }
      }
      // When both context and state are present, `systemPrompts` is joined by
      // `\n`, so there is one more separator between the final context entry and
      // the Application State block.
      if (hasSerializedState && context.length > 0) {
        size += 1;
      }
    }
  }

  if (hasSerializedState) {
    size +=
      variant === "builtIn"
        ? "\n## Application State\n".length +
          "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n"
            .length +
          "```json\n".length +
          serializedState!.length +
          "\n```\n".length
        : "Application State:\n".length +
          "```json\n".length +
          serializedState!.length +
          "\n```".length;
  }

  return size;
}

/**
 * Warns (once per call site) when the assembled context block is large enough
 * to inflate the system prompt, without discarding any data.
 */
export function warnIfAssembledAgentContextOversized(
  context: readonly { description: string; value: string }[] | undefined,
  serializedState: string | undefined,
  variant: AgentContextAssembleVariant,
): void {
  const threshold = getAgentContextWarnThreshold();
  if (threshold < 0) {
    return;
  }

  const size = computeAssembledAgentContextSize(
    context,
    serializedState,
    variant,
  );
  if (size > threshold) {
    if (warnedVariants.has(variant)) {
      return;
    }
    warnedVariants.add(variant);
    // eslint-disable-next-line no-console
    console.warn(
      "[CopilotKit] Assembled agent context is large (" +
        `${size.toLocaleString()} characters). ` +
        "This is injected verbatim into the system prompt and can inflate token cost. " +
        "Consider trimming what you share via context/state, or raise " +
        "COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD if this is intentional.",
    );
  }
}
