/** Model selection shared across the agent's tools and the adapter. */

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";

/**
 * Resolve the Claude model id from the environment. Prefers CLAUDE_MODEL, then
 * ANTHROPIC_MODEL, then the default. A dotted marketing name (e.g.
 * "claude-sonnet-4.5") is normalized to the API id ("claude-sonnet-4-5").
 */
export function resolveModel(): string {
  const model =
    process.env.CLAUDE_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    DEFAULT_CLAUDE_MODEL;
  return model.replace(/\./g, "-");
}
