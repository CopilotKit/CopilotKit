/**
 * Centralized model selection for the finance runtime.
 *
 * Model identifiers use the CopilotKit / AI-SDK provider-prefixed form
 * ("openai/gpt-5.4-2026-03-05", "anthropic/claude-sonnet-4.5", ...). These are accepted
 * both by `BuiltInAgent` (via the `BuiltInAgentModel` union, which also allows
 * arbitrary `string & {}`) and by `resolveModel` from `@copilotkit/runtime/v2`.
 *
 * Both models default to vision-capable OpenAI `gpt-5.4-2026-03-05`:
 *   - the chat agent can reason over images forwarded by the client, and
 *   - the /api/receipt endpoint needs vision to read receipt photos.
 *
 * Provider API keys are read from the environment by the underlying AI SDK
 * (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY) — never hardcoded.
 */

/** Model backing the conversational finance assistant agent. */
export const AGENT_MODEL =
  process.env.AGENT_MODEL ?? "openai/gpt-5.4-2026-03-05";

/** Vision-capable model backing the /api/receipt parser. */
export const RECEIPT_MODEL =
  process.env.RECEIPT_MODEL ?? "openai/gpt-5.4-2026-03-05";
