/**
 * Header-forwarding shim for the built-in-agent integration.
 *
 * Why this exists: `@tanstack/ai-openai`'s `openaiText()` adapter
 * constructs its own OpenAI client and exposes no built-in hook for
 * per-request HTTP headers. The CopilotKit runtime does not thread
 * inbound headers down to the model adapter either. Without this shim,
 * outbound calls to aimock's `/v1/responses` endpoint carry no
 * `x-aimock-context` header, every fixture match returns 404, and the
 * D6 subset goes 0/6.
 *
 * The fix mirrors the Mastra precedent in
 * `integrations/mastra/src/mastra/_header_forwarding.ts`:
 *   - `withForwardedHeaders(req, fn)` snapshots inbound `x-*` headers off
 *     the incoming Request into an AsyncLocalStorage scope.
 *   - `forwardingFetch` reads the ALS-bound headers at outbound-call time
 *     and merges them into every request the OpenAI SDK makes.
 *
 * The route handler wraps each request in `withForwardedHeaders`; the
 * tanstack-factory constructs `openaiText(model, { fetch: forwardingFetch })`
 * once at module-scope and the custom fetch reads ALS dynamically per
 * outbound call.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const headersStorage = new AsyncLocalStorage<Record<string, string>>();

/** Extract the x-* headers off a Web Request / NextRequest. */
function extractXHeaders(req: { headers: Headers }): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-")) {
      out[lower] = value;
    }
  });
  return out;
}

/**
 * Run `fn` with an ALS-bound snapshot of inbound x-* headers. Any
 * outbound fetch made by the OpenAI client during `fn` execution will
 * see these headers and merge them into the request.
 */
export function withForwardedHeaders<T>(
  req: { headers: Headers },
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const headers = extractXHeaders(req);
  // CVDIAG (als-snapshot): record whether the inbound x-aimock-context
  // discriminator was present at the moment we capture the header
  // snapshot into ALS. Never log the full value — prefix only.
  const slug = headers["x-aimock-context"];
  const runId = headers["x-diag-run-id"];
  const hops = headers["x-diag-hops"];
  const hopCount = hops ? hops.split(",").filter(Boolean).length : 0;
  console.log(
    `CVDIAG component=route-built-in-agent boundary=als-snapshot ` +
      `run_id=${runId ?? "none"} slug=${slug ?? "MISSING"} ` +
      `header_present=${slug != null} ` +
      `header_value_prefix=${slug ? slug.slice(0, 12) : ""} ` +
      `hop=${hops ? hopCount : "-"} status=${slug ? "ok" : "miss"} ` +
      `test_id=${headers["x-test-id"] ?? "none"} error=`,
  );
  return headersStorage.run(headers, fn);
}

/** Return the ALS-bound headers (or an empty map if not in scope). */
function getForwardedHeaders(): Record<string, string> {
  return headersStorage.getStore() ?? {};
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (
    input &&
    typeof input === "object" &&
    "url" in input &&
    typeof input.url === "string"
  ) {
    return input.url;
  }
  return "";
}

function responseHeadersWithoutContentLength(headers: Headers): Headers {
  const next = new Headers(headers);
  next.delete("content-length");
  return next;
}

function sseFrameBoundary(value: string):
  | { index: number; separatorLength: number }
  | undefined {
  const lf = value.indexOf("\n\n");
  const crlf = value.indexOf("\r\n\r\n");

  if (lf === -1 && crlf === -1) return undefined;
  if (lf === -1) return { index: crlf, separatorLength: 4 };
  if (crlf === -1) return { index: lf, separatorLength: 2 };
  return lf < crlf
    ? { index: lf, separatorLength: 2 }
    : { index: crlf, separatorLength: 4 };
}

function normalizeFunctionCallItem(
  value: unknown,
  callIdsByItemId: Map<string, string>,
): void {
  if (!value || typeof value !== "object") return;

  const item = value as Record<string, unknown>;
  if (item.type !== "function_call") return;

  const itemId = typeof item.id === "string" ? item.id : undefined;
  const callId = typeof item.call_id === "string" ? item.call_id : undefined;
  if (!itemId || !callId) return;

  callIdsByItemId.set(itemId, callId);
  item.id = callId;
}

function normalizeResponsesEventIds(
  value: unknown,
  callIdsByItemId: Map<string, string>,
): unknown {
  if (!value || typeof value !== "object") return value;

  const event = value as Record<string, unknown>;

  normalizeFunctionCallItem(event.item, callIdsByItemId);

  if (typeof event.item_id === "string") {
    const callId = callIdsByItemId.get(event.item_id);
    if (callId) event.item_id = callId;
  }

  const response = event.response;
  if (response && typeof response === "object") {
    const output = (response as Record<string, unknown>).output;
    if (Array.isArray(output)) {
      output.forEach((item) => normalizeFunctionCallItem(item, callIdsByItemId));
    }
  }

  return value;
}

function normalizeResponsesSseFrame(
  frame: string,
  callIdsByItemId: Map<string, string>,
): string {
  if (!frame.includes("data:")) return frame;

  const lineEnding = frame.includes("\r\n") ? "\r\n" : "\n";
  const lines = frame.split(/\r?\n/);
  const dataLineIndexes: number[] = [];
  const dataLines: string[] = [];

  lines.forEach((line, index) => {
    if (!line.startsWith("data:")) return;
    dataLineIndexes.push(index);
    dataLines.push(line.slice(5).replace(/^ /, ""));
  });

  if (dataLines.length === 0) return frame;

  const data = dataLines.join("\n");
  if (data === "[DONE]") return frame;

  try {
    const parsed = JSON.parse(data);
    const normalized = normalizeResponsesEventIds(parsed, callIdsByItemId);
    const skip = new Set(dataLineIndexes.slice(1));
    return lines
      .map((line, index) =>
        index === dataLineIndexes[0]
          ? `data: ${JSON.stringify(normalized)}`
          : line,
      )
      .filter((_, index) => !skip.has(index))
      .join(lineEnding);
  } catch {
    return frame;
  }
}

function normalizeOpenAIResponsesFunctionCallIds(
  input: RequestInfo | URL,
  response: Response,
): Response {
  const url = inputUrl(input);
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !url.includes("/responses") ||
    !contentType.includes("text/event-stream") ||
    !response.body
  ) {
    return response;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const callIdsByItemId = new Map<string, string>();
  let buffered = "";

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const boundary = sseFrameBoundary(buffered);
        if (boundary) {
          const frame = buffered.slice(0, boundary.index);
          const separator = buffered.slice(
            boundary.index,
            boundary.index + boundary.separatorLength,
          );
          buffered = buffered.slice(
            boundary.index + boundary.separatorLength,
          );
          controller.enqueue(
            encoder.encode(
              `${normalizeResponsesSseFrame(frame, callIdsByItemId)}${separator}`,
            ),
          );
          return;
        }

        const { done, value } = await reader.read();
        if (done) {
          buffered += decoder.decode();
          if (buffered.length > 0) {
            controller.enqueue(
              encoder.encode(
                normalizeResponsesSseFrame(buffered, callIdsByItemId),
              ),
            );
            buffered = "";
          }
          controller.close();
          return;
        }

        buffered += decoder.decode(value, { stream: true });
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeadersWithoutContentLength(response.headers),
  });
}

function fetchWithResponsesNormalization(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, init).then((response) =>
    normalizeOpenAIResponsesFunctionCallIds(input, response),
  );
}

/**
 * fetch wrapper that injects ALS-bound x-* headers into every outbound
 * call. Pass as the `fetch` option to the OpenAI client config.
 */
export const forwardingFetch: typeof fetch = (input, init) => {
  const forwarded = getForwardedHeaders();
  if (Object.keys(forwarded).length === 0) {
    return fetchWithResponsesNormalization(input, init);
  }
  const merged = new Headers(init?.headers);
  for (const [k, v] of Object.entries(forwarded)) {
    // Don't clobber an explicit per-call header.
    if (!merged.has(k)) merged.set(k, v);
  }
  // GATING RULE: only deviate from the original control flow (append the
  // x-diag-hops breadcrumb, emit the per-outbound CVDIAG log) when a
  // diagnostic header is present (x-diag-run-id OR x-aimock-context). On
  // non-diagnostic traffic the outbound headers stay byte-identical and we
  // skip the noisy per-outbound log.
  const slug = forwarded["x-aimock-context"];
  const runId = forwarded["x-diag-run-id"];
  const diagnosticPresent = runId != null || slug != null;
  if (!diagnosticPresent) {
    return fetchWithResponsesNormalization(input, { ...init, headers: merged });
  }
  // CVDIAG (outbound-llm): append this layer's hop tag to the breadcrumb
  // and log header presence at the moment the outbound LLM request is
  // built. x-diag-run-id / x-diag-hops ride the same x-* forwarding path
  // as x-aimock-context above; we only mutate the hops breadcrumb here.
  const priorHops = merged.get("x-diag-hops") ?? forwarded["x-diag-hops"] ?? "";
  const nextHops = priorHops
    ? `${priorHops},backend-built-in-agent`
    : "backend-built-in-agent";
  merged.set("x-diag-hops", nextHops);
  const hopCount = nextHops.split(",").filter(Boolean).length;
  console.log(
    `CVDIAG component=backend-built-in-agent boundary=outbound-llm ` +
      `run_id=${runId ?? "none"} slug=${slug ?? "MISSING"} ` +
      `header_present=${slug != null} ` +
      `header_value_prefix=${slug ? slug.slice(0, 12) : ""} ` +
      `hop=${hopCount} status=${slug ? "ok" : "miss"} ` +
      `test_id=${forwarded["x-test-id"] ?? "none"} error=`,
  );
  return fetchWithResponsesNormalization(input, { ...init, headers: merged });
};
