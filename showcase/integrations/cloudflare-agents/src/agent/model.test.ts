import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forwardedHeaders,
  forwardingFetch,
  isForwardedHeader,
  openaiFor,
} from "./model";

const COMPLETION = {
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 0,
  model: "gpt-6-luna",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hi." },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

function inbound(headers: Record<string, string>): Request {
  return new Request("http://worker/agents/showcase/t-1", {
    method: "POST",
    headers,
  });
}

/** A fetch stub that answers with a chat completion and records requests. */
function recordingFetch() {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const stub = vi.fn<typeof fetch>(async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json(COMPLETION);
  });
  return { stub, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isForwardedHeader", () => {
  it("accepts the aimock, test-id and x-diag-* headers in any case", () => {
    for (const name of [
      "x-aimock-strict",
      "X-AIMock-Strict",
      "x-test-id",
      "x-aimock-context",
      "x-diag-run",
      "X-Diag-Probe",
    ]) {
      expect(isForwardedHeader(name), name).toBe(true);
    }
  });

  it("rejects every other header", () => {
    for (const name of [
      "authorization",
      "x-forwarded-for",
      "x-request-id",
      "cookie",
    ]) {
      expect(isForwardedHeader(name), name).toBe(false);
    }
  });
});

describe("forwardedHeaders", () => {
  it("keeps only the forwardable headers present on the request", () => {
    const headers = forwardedHeaders(
      inbound({
        "x-aimock-strict": "true",
        "x-test-id": "d6-cloudflare-agents-1",
        "x-diag-run": "7",
        authorization: "Bearer secret",
        "x-request-id": "r-1",
      }),
    );
    expect(Object.fromEntries(headers)).toEqual({
      "x-aimock-strict": "true",
      "x-test-id": "d6-cloudflare-agents-1",
      "x-diag-run": "7",
    });
  });

  it("is empty for a run without a request (a WebSocket run)", () => {
    expect([...forwardedHeaders(undefined).keys()]).toEqual([]);
  });
});

describe("forwardingFetch", () => {
  it("passes the request through untouched when there is nothing to forward", async () => {
    const { stub } = recordingFetch();
    const init = { method: "POST", headers: { a: "1" } };
    await forwardingFetch(new Headers(), stub)("http://model/v1", init);
    expect(stub).toHaveBeenCalledWith("http://model/v1", init);
  });

  it("adds the forwarded headers without replacing the provider's", async () => {
    const { stub, calls } = recordingFetch();
    const forwarded = new Headers({
      "x-test-id": "t-9",
      "x-aimock-context": "someone-else",
    });
    await forwardingFetch(forwarded, stub)("http://model/v1", {
      headers: { "x-aimock-context": "cloudflare-agents" },
    });
    expect(calls[0]!.headers.get("x-test-id")).toBe("t-9");
    expect(calls[0]!.headers.get("x-aimock-context")).toBe("cloudflare-agents");
  });
});

describe("openaiFor", () => {
  it("sends the integration's context and the run's forwarded headers on the model call", async () => {
    const { stub, calls } = recordingFetch();
    vi.stubGlobal("fetch", stub);
    const openai = openaiFor(
      { OPENAI_BASE_URL: "http://aimock.test/v1" },
      inbound({
        "x-aimock-strict": "true",
        "x-test-id": "d6-run-1",
        authorization: "Bearer x",
      }),
    );

    await generateText({ model: openai.chat("gpt-6-luna"), prompt: "hello" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://aimock.test/v1/chat/completions");
    expect(calls[0]!.headers.get("x-aimock-context")).toBe("cloudflare-agents");
    expect(calls[0]!.headers.get("x-aimock-strict")).toBe("true");
    expect(calls[0]!.headers.get("x-test-id")).toBe("d6-run-1");
    // The inbound Authorization is not the model's; the provider sends its own key.
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer sk-unset");
  });

  it("adds no probe headers to demo traffic", async () => {
    const { stub, calls } = recordingFetch();
    vi.stubGlobal("fetch", stub);
    const openai = openaiFor(
      { OPENAI_BASE_URL: "http://aimock.test/v1" },
      inbound({}),
    );

    await generateText({ model: openai.chat("gpt-6-luna"), prompt: "hello" });

    expect(calls[0]!.headers.has("x-aimock-strict")).toBe(false);
    expect(calls[0]!.headers.has("x-test-id")).toBe(false);
  });
});
