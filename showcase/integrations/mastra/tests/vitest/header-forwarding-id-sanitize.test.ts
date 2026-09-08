import { describe, it, expect } from "vitest";
import {
  toOpenAiResponsesSafeId,
  sanitizeOutboundResponsesIds,
} from "@/mastra/_header_forwarding";

// OpenAI's Responses API rejects any input[].id containing a dash (its 400
// message misleadingly lists dashes as allowed). CopilotKit mints `msg-…` ids,
// which the AI SDK forwards into input[].id → every multi-turn run 400s
// (OSS-381). These helpers rewrite the id at the HTTP boundary.
describe("toOpenAiResponsesSafeId", () => {
  it("rewrites the real failing client id (dash → underscore)", () => {
    // The exact id observed 400-ing on staging.
    expect(toOpenAiResponsesSafeId("msg-92Y7BhMpWBhXt7dm")).toBe(
      "msg_92Y7BhMpWBhXt7dm",
    );
  });

  it("leaves OpenAI-issued ids (no dashes) unchanged — a no-op", () => {
    expect(toOpenAiResponsesSafeId("msg_03f181993e")).toBe("msg_03f181993e");
    expect(toOpenAiResponsesSafeId("rs_abc123DEF")).toBe("rs_abc123DEF");
  });

  it("maps every non-[A-Za-z0-9_] char to underscore", () => {
    expect(toOpenAiResponsesSafeId("a-b+c/d=e")).toBe("a_b_c_d_e");
  });

  it("is idempotent (already-safe id round-trips)", () => {
    const once = toOpenAiResponsesSafeId("msg-92Y7BhMpWBhXt7dm");
    expect(toOpenAiResponsesSafeId(once)).toBe(once);
  });
});

describe("sanitizeOutboundResponsesIds", () => {
  const responsesBody = (ids: (string | undefined)[]) =>
    JSON.stringify({
      model: "gpt-4o",
      input: ids.map((id, i) =>
        id === undefined
          ? { type: "message", role: "user", content: `m${i}` }
          : {
              type: "message",
              role: "assistant",
              id,
              content: [{ type: "output_text", text: `m${i}` }],
            },
      ),
    });

  it("rewrites out-of-charset input[].id in the request body", () => {
    const out = JSON.parse(
      sanitizeOutboundResponsesIds(
        responsesBody([undefined, "msg-92Y7BhMpWBhXt7dm", undefined]),
      ) as string,
    );
    expect(out.input[1].id).toBe("msg_92Y7BhMpWBhXt7dm");
    // untouched siblings preserved
    expect(out.input[0].content).toBe("m0");
    expect(out.input[2].content).toBe("m2");
  });

  it("returns the body byte-identical when no id needs rewriting (no-op)", () => {
    const clean = responsesBody([undefined, "msg_valid123", undefined]);
    expect(sanitizeOutboundResponsesIds(clean)).toBe(clean);
  });

  it("passes through non-JSON / undefined bodies untouched", () => {
    expect(sanitizeOutboundResponsesIds(undefined)).toBeUndefined();
    expect(sanitizeOutboundResponsesIds("not json")).toBe("not json");
  });

  it("ignores bodies without an input[] array (chat-completions unaffected)", () => {
    const chat = JSON.stringify({ messages: [{ id: "msg-x", role: "user" }] });
    expect(sanitizeOutboundResponsesIds(chat)).toBe(chat);
  });
});
