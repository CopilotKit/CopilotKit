/**
 * Regression test for sub-agent LLM-path header forwarding.
 *
 * The sub-agent `openaiClient()` in tools.ts must wire `fetch: forwardingFetch`
 * (mirroring model-factory.ts) so inbound `X-AIMock-Strict` / `x-test-id` /
 * `x-diag-*` headers — seeded into the AsyncLocalStorage scope by the strands
 * cvdiag middleware via `withForwardedHeaders` — flow onto the sub-agent's
 * outbound OpenAI request. Without it, those headers are DROPPED on the
 * sub-agent path while the main agent's model carries them, so a probe's strict
 * verification silently falls through on the delegated (research/writing/
 * critique) calls.
 *
 * RED (pre-fix): client built with `defaultHeaders` only, no `fetch` →
 * outbound request lacks `X-AIMock-Strict`.
 * GREEN (post-fix): `fetch: forwardingFetch` wired → header present.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withForwardedHeaders } from "./header-forwarding.js";
import { openaiClient } from "./tools.js";
import type { Request } from "express";

describe("sub-agent openaiClient header forwarding", () => {
  const origKey = process.env.OPENAI_API_KEY;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    // Spy on global fetch so the OpenAI client's forwardingFetch ultimately
    // calls into it; capture the outbound headers without hitting the network.
    fetchSpy = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (origKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = origKey;
  });

  /** Minimal Express-like request carrying the strict probe header. */
  function reqWith(headers: Record<string, string>): Request {
    return { headers } as unknown as Request;
  }

  it("forwards inbound X-AIMock-Strict onto the sub-agent outbound call", async () => {
    const client = openaiClient();

    await withForwardedHeaders(
      reqWith({ "x-aimock-strict": "1" }),
      async () => {
        await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
        });
      },
    );

    expect(fetchSpy).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("x-aimock-strict")).toBe("1");
  });
});
