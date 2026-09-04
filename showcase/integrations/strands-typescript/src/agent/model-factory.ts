/**
 * Shared model factory for the Strands TypeScript showcase agent.
 *
 * Mirrors the upstream AG-UI `aws-strands/typescript/examples/server/
 * model-factory.ts` shape: same `MODEL_PROVIDER` env-var contract and
 * provider defaults. The showcase routes everything through OpenAI chat
 * completions by default so tool-call ARGUMENTS stream incrementally — the
 * Responses adapter buffers `function_call_arguments.delta` and only emits
 * the complete toolUse at `…arguments.done`, which breaks the progressive
 * state-streaming demos (shared-state, gen-ui-agent).
 *
 * `OPENAI_BASE_URL` is honored so the agent can run behind the showcase
 * aimock proxy (record/replay) without code changes — when set, every
 * OpenAI call is routed there.
 *
 * Supported providers: `openai` (default), `anthropic`, `bedrock`.
 */

import type { Model } from "@strands-agents/sdk";
import { forwardingFetch } from "./header-forwarding.js";

/**
 * aimock keys its fixtures on the `x-aimock-context` header of the outbound
 * OpenAI request — it identifies which integration's fixtures to match. An
 * integration's context is constant (its slug), so we attach it statically as
 * a default header on the OpenAI client rather than threading the inbound
 * request header through the adapter. Harmless against real OpenAI (unknown
 * headers are ignored); override via the AIMOCK_CONTEXT env var if needed.
 */
export const AIMOCK_CONTEXT =
  process.env.AIMOCK_CONTEXT ?? "strands-typescript";

export interface CreateModelOptions {
  /**
   * Request reasoning/thinking content from the provider. Defaults to
   * `false`. Only enable for demos that render reasoning in the UI.
   */
  reasoning?: boolean;
  /**
   * Override the model id. Takes precedence over `MODEL_ID` so a demo that
   * needs a specific class of model (a reasoning model, say) is not silently
   * downgraded by the deployment-wide default.
   */
  modelId?: string;
  /**
   * OpenAI API mode. Defaults to `"chat"` for the showcase so tool-call
   * arguments stream incrementally. Pass `"responses"` to use the Responses
   * API.
   */
  openaiApi?: "chat" | "responses";
}

export async function createModel(
  options: CreateModelOptions = {},
): Promise<Model> {
  const provider = (process.env.MODEL_PROVIDER ?? "openai").toLowerCase();
  const reasoning = options.reasoning ?? false;

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required when MODEL_PROVIDER=openai. " +
          "Set it in your .env file or environment.",
      );
    }
    const { OpenAIModel } = await import("@strands-agents/sdk/models/openai");
    // OPENAI_BASE_URL routes through aimock during showcase record/replay.
    const baseURL = process.env.OPENAI_BASE_URL;
    return new OpenAIModel({
      apiKey,
      modelId: options.modelId ?? process.env.MODEL_ID ?? "gpt-4o",
      // Default to chat completions (incremental tool-arg streaming).
      api: options.openaiApi ?? "chat",
      // `summary: "detailed"` rather than `"auto"`: with `"auto"` the model
      // decides, and with tools in play it routinely skips the summary, which
      // leaves the frontend's reasoning slot unmounted.
      ...(reasoning
        ? { params: { reasoning: { effort: "medium", summary: "detailed" } } }
        : {}),
      clientConfig: {
        ...(baseURL ? { baseURL } : {}),
        // Identify this integration to aimock so it matches the right fixtures.
        defaultHeaders: { "x-aimock-context": AIMOCK_CONTEXT },
        // Per-request inbound x-* forwarding (incl. X-AIMock-Strict / x-test-id
        // / x-diag-*). The OpenAI client is built ONCE at startup, but
        // forwardingFetch reads an AsyncLocalStorage snapshot per outbound call
        // (seeded by the Express cvdiag/forwarding middleware around
        // agent.run()), so per-request headers flow correctly. It never
        // clobbers the static x-aimock-context above, and is byte-identical to
        // a plain fetch when no x-* are in scope (demo traffic unaffected).
        fetch: forwardingFetch,
      },
    });
  }

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required when MODEL_PROVIDER=anthropic.",
      );
    }
    const { AnthropicModel } =
      await import("@strands-agents/sdk/models/anthropic");
    return new AnthropicModel({
      apiKey,
      modelId: options.modelId ?? process.env.MODEL_ID ?? "claude-opus-4-8",
    });
  }

  if (provider === "bedrock") {
    const { BedrockModel } = await import("@strands-agents/sdk");
    return new BedrockModel({
      modelId:
        options.modelId ??
        process.env.MODEL_ID ??
        "global.anthropic.claude-opus-4-8",
      ...(reasoning
        ? {
            additionalRequestFields: {
              thinking: { type: "adaptive" },
            },
          }
        : {}),
    });
  }

  throw new Error(
    `Unknown MODEL_PROVIDER: ${provider}. Supported: openai, anthropic, bedrock`,
  );
}
