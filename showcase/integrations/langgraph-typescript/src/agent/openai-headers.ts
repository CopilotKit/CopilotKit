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
 *
 * CVDIAG instrumentation (diagnostic only — DOES NOT change forwarding
 * behavior): emits structured `CVDIAG` log lines at the configurable-read
 * boundary (is the x-aimock-context header present where this layer reads
 * forwarded headers off RunnableConfig.configurable?) and at the
 * outbound-llm boundary (the defaultHeaders set on the ChatOpenAI call).
 * The breadcrumb header `x-diag-hops` gets this layer's hop tag appended,
 * and the correlation headers (x-diag-run-id, x-diag-hops) ride along on
 * the outbound call the same way x-aimock-context already does. No new
 * forwarding source is introduced — headers still come ONLY from
 * config.configurable.copilotkit_forwarded_headers.
 */

import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import type { RunnableConfig } from "@langchain/core/runnables";

const CVDIAG_COMPONENT = "backend-langgraph-ts";
const CVDIAG_HOP_TAG = "backend-langgraph-ts";

/**
 * Emit a single CVDIAG log line in the shared cross-language convention.
 * Never logs full header values — only a 12-char prefix of x-aimock-context.
 */
function cvdiag(
  boundary: string,
  headers: Record<string, string>,
  status: "ok" | "miss" | "error",
  extra: { hop?: number | string; error?: string } = {},
): void {
  const slug = headers["x-aimock-context"];
  const headerPresent = typeof slug === "string" && slug.length > 0;
  const runId = headers["x-diag-run-id"] ?? "none";
  const testId = headers["x-test-id"] ?? "none";
  const prefix = headerPresent ? slug.slice(0, 12) : "";
  const hop = extra.hop ?? "-";
  const error = extra.error ?? "";
  console.log(
    `CVDIAG component=${CVDIAG_COMPONENT} boundary=${boundary} ` +
      `run_id=${runId} slug=${headerPresent ? slug : "MISSING"} ` +
      `header_present=${headerPresent} header_value_prefix=${prefix} ` +
      `hop=${hop} status=${status} test_id=${testId} error=${error}`,
  );
}

function extractForwardedHeaders(
  config?: RunnableConfig,
): Record<string, string> {
  const raw = (config?.configurable as Record<string, unknown> | undefined)
    ?.copilotkit_forwarded_headers;
  if (!raw || typeof raw !== "object") {
    // CVDIAG: the configurable channel had no forwarded-headers object at
    // all. This is the alarm we are hunting — surface it instead of the
    // previous silent `return {}`.
    cvdiag("configurable-read", {}, "miss", {
      error: "no-copilotkit_forwarded_headers-in-configurable",
    });
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  // CVDIAG: we found a forwarded-headers object; report whether the
  // x-aimock-context header actually rode along on this channel.
  const hasContext =
    typeof out["x-aimock-context"] === "string" &&
    out["x-aimock-context"].length > 0;
  cvdiag("configurable-read", out, hasContext ? "ok" : "miss", {
    error: hasContext ? "" : "x-aimock-context-absent-in-configurable",
  });
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

  // CVDIAG breadcrumb: append this layer's hop tag to x-diag-hops on the
  // OUTBOUND headers (comma-joined trail each layer extends). This rides
  // along ONLY when forwarded headers already carry the diag context — we
  // do not invent a new forwarding source.
  if (typeof merged["x-aimock-context"] === "string") {
    const existingHops = merged["x-diag-hops"];
    merged["x-diag-hops"] =
      typeof existingHops === "string" && existingHops.length > 0
        ? `${existingHops},${CVDIAG_HOP_TAG}`
        : CVDIAG_HOP_TAG;
  }

  // CVDIAG: outbound-llm boundary — what is actually about to be attached
  // as defaultHeaders on the ChatOpenAI HTTP call.
  const hop = (merged["x-diag-hops"] ?? "").split(",").filter(Boolean).length;
  const hasContext = typeof merged["x-aimock-context"] === "string";
  cvdiag("outbound-llm", merged, hasContext ? "ok" : "miss", {
    hop: hasContext ? hop : "-",
    error: hasContext ? "" : "x-aimock-context-absent-on-outbound",
  });

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
