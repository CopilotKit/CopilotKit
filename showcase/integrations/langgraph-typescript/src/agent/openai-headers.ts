/**
 * makeChatOpenAI — construct a ChatOpenAI that forwards inbound x-* headers
 * to the outbound OpenAI HTTP call.
 *
 * Why this exists: @ag-ui/langgraph@0.0.34 stuffs inbound x-* headers into
 * `config.configurable.copilotkit_forwarded_headers`, but @langchain/openai
 * does not look at that field. Without this helper, aimock never receives
 * the x-aimock-context header and every fixture match returns 404. This
 * helper is the TS analog of the Python copilotkit SDK's httpx-hook header
 * propagation in `copilotkit_lg_middleware.before_agent`.
 *
 * Apples-to-apples note: this is a minimal LGT backend fix. The harness,
 * d6 probe, conversation-runner, and shared frontend remain untouched.
 */

import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import type { RunnableConfig } from "@langchain/core/runnables";

function extractForwardedHeaders(
  config?: RunnableConfig,
): Record<string, string> {
  const raw = (config?.configurable as Record<string, unknown> | undefined)
    ?.copilotkit_forwarded_headers;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Drop-in replacement for `new ChatOpenAI({...})` inside a graph node.
 * Pass the node's `config: RunnableConfig` as the first argument; the rest
 * matches the ChatOpenAI constructor.
 */
export function makeChatOpenAI(
  config: RunnableConfig | undefined,
  opts: ChatOpenAIFields = {},
): ChatOpenAI {
  const forwarded = extractForwardedHeaders(config);
  const existing = opts.configuration?.defaultHeaders ?? {};
  const merged: Record<string, string> = {
    ...(existing as Record<string, string>),
    ...forwarded,
  };
  // Only attach `configuration` when we actually have headers to add, so we
  // don't perturb defaults for callers that never pass config.
  if (Object.keys(merged).length === 0) {
    return new ChatOpenAI(opts);
  }
  return new ChatOpenAI({
    ...opts,
    configuration: {
      ...(opts.configuration ?? {}),
      defaultHeaders: merged,
    },
  });
}
