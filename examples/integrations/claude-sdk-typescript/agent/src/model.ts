/** Model selection shared across the agent's tools and the adapter. */

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";

const AGENT_MODEL_SPEC = /^([A-Za-z0-9-]+)[:/](.+)$/;
let warnedAgentModel: string | undefined;

/**
 * The Claude model named by `COPILOTKIT_AGENT_MODEL=<provider>:<model>` (or
 * `<provider>/<model>`), or undefined when it is unset or unusable.
 *
 * The Claude Agent SDK runs only Anthropic models, so only the `anthropic`
 * provider is accepted; any other value is logged once and ignored.
 */
function agentModelFromEnv(): string | undefined {
  const value = process.env.COPILOTKIT_AGENT_MODEL?.trim();
  if (!value) return undefined;
  const match = AGENT_MODEL_SPEC.exec(value);
  if (match && match[1].toLowerCase() === "anthropic") return match[2];
  if (warnedAgentModel !== value) {
    warnedAgentModel = value;
    console.warn(
      `[model] COPILOTKIT_AGENT_MODEL="${value}" ignored: the Claude Agent SDK runs only anthropic:<model>; falling back to CLAUDE_MODEL / ANTHROPIC_MODEL / ${DEFAULT_CLAUDE_MODEL}.`,
    );
  }
  return undefined;
}

/**
 * Resolve the Claude model id from the environment. `COPILOTKIT_AGENT_MODEL`
 * (anthropic only) wins and overrides every model site in the agent; then
 * CLAUDE_MODEL, then ANTHROPIC_MODEL, then the default. A dotted marketing
 * name from any of them (e.g. "claude-sonnet-4.6") is normalized to the API
 * id ("claude-sonnet-4-6").
 */
export function resolveModel(): string {
  const model =
    agentModelFromEnv() ||
    process.env.CLAUDE_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    DEFAULT_CLAUDE_MODEL;
  return model.replace(/\./g, "-");
}
