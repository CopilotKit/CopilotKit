import type { AbstractAgent } from "@ag-ui/client";

/**
 * Coerce `"<field>": null` to `""` on the wire. Targeted on purpose: we only
 * touch fields where a `null` is known to come through from `@ag-ui/langgraph`
 * and would otherwise trip strict client-side validation.
 *
 * Matching the quoted key means an escaped occurrence inside a JSON string
 * (`\"parentMessageId\":null`, e.g. nested in a `rawEvent` payload) is left
 * alone — the backslash breaks the match.
 */
const NULLABLE_ID_FIELDS = /("(?:parentMessageId)"\s*:\s*)null/g;

/** Marks a transport we have already wrapped, so re-entry is a no-op. */
const SANITIZED = Symbol.for("copilotkit.channels.sanitizedTransport");

interface HttpTransport {
  url: string;
  fetch: (...args: Parameters<typeof fetch>) => Promise<Response>;
}

type SanitizedFetch = HttpTransport["fetch"] & { [SANITIZED]?: true };

/**
 * Rewrite SSE frames as they stream, coercing the known nullable-string fields.
 *
 * Buffering on the `\n\n` frame delimiter is what makes this safe: a `null`
 * split across two transport chunks is still matched, and every other byte —
 * comments, keep-alives, unrelated fields — is re-emitted verbatim.
 */
function coerceNullableIds(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const encoder = new TextEncoder();
  let buffered = "";

  const coerce = (frame: string): Uint8Array =>
    encoder.encode(frame.replace(NULLABLE_ID_FIELDS, '$1""'));

  return new TransformStream({
    transform(chunk, controller) {
      buffered += decoder.decode(chunk, { stream: true });
      const frames = buffered.split("\n\n");
      buffered = frames.pop() ?? "";
      for (const frame of frames) controller.enqueue(coerce(`${frame}\n\n`));
    },
    flush(controller) {
      buffered += decoder.decode();
      if (buffered) controller.enqueue(coerce(buffered));
    },
  });
}

/** Does this agent stream its events over HTTP, and therefore re-validate them? */
function hasHttpTransport(
  agent: AbstractAgent,
): agent is AbstractAgent & HttpTransport {
  const candidate = agent as Partial<HttpTransport>;
  return (
    typeof candidate.fetch === "function" && typeof candidate.url === "string"
  );
}

/**
 * Make an agent tolerate the AG-UI event streams real agents emit.
 *
 * `@ag-ui/langgraph` emits a `TOOL_CALL_START` whose `parentMessageId` is
 * `null` — notably the tool call that triggers an interrupt. The AG-UI schema
 * declares that field optional but never nullable, so `HttpAgent`'s transform
 * re-validates the streamed event, Zod rejects it ("Expected string, received
 * null"), and a single rejected event aborts the entire run. That breaks
 * LangGraph interrupts / human-in-the-loop on every Channel platform.
 *
 * The fix is applied at the transport rather than by replacing the event
 * transform, which keeps everything else the stock path does — protobuf
 * content-type negotiation, `AbortError` → `RUN_ERROR`, and strict validation
 * of every field except the coerced one. Agents that do not stream over HTTP
 * are returned untouched: nothing re-validates their events, so there is
 * nothing to coerce.
 *
 * Channels apply this by default; opt out with
 * `createChannel({ sanitizeAgentEvents: false })`. Remove it once
 * `@ag-ui/langgraph` stops emitting the null (CopilotKit OSS-691).
 */
export function sanitizeAgentEventStream<T extends AbstractAgent>(agent: T): T {
  if (!hasHttpTransport(agent)) return agent;

  const transport: SanitizedFetch = agent.fetch;
  if (transport[SANITIZED]) return agent;

  const sanitized: SanitizedFetch = async (input, init) => {
    const response = await transport(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !response.ok ||
      !response.body ||
      !contentType.includes("text/event-stream")
    )
      return response;

    return new Response(response.body.pipeThrough(coerceNullableIds()), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  sanitized[SANITIZED] = true;
  agent.fetch = sanitized;

  return agent;
}
