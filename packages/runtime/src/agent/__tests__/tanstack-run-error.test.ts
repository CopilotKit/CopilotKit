/**
 * A model call that fails ends the run with an error. TanStack AI reports
 * what the provider said on its RUN_ERROR: the code and the provider's error
 * body, and in `metadata.tanstack` the wait the provider asked for, its error
 * type and the request id. These run a real TanStack AI adapter against a
 * fetch that answers like OpenAI, so the chunk is the one `chat()` emits.
 */
import { describe, expect, it } from "vitest";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { BuiltInAgent } from "../index";
import { createDefaultInput } from "./agent-test-helpers";

/** The error the run ends with, or undefined when it completes. */
function runError(agent: BuiltInAgent): Promise<unknown> {
  return new Promise((resolve) => {
    agent.run(createDefaultInput()).subscribe({
      error: resolve,
      complete: () => resolve(undefined),
    });
  });
}

describe("a TanStack AI model call that fails", () => {
  it("ends the run with an error that keeps what the provider said", async () => {
    const body = {
      error: {
        message: "Rate limit reached for gpt-4o-mini",
        type: "requests",
        code: "rate_limit_exceeded",
        param: null,
      },
    };
    const agent = new BuiltInAgent({
      model: createOpenaiChat("gpt-4o-mini", "sk-test", {
        maxRetries: 0,
        fetch: async () =>
          new Response(JSON.stringify(body), {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "7",
              "x-request-id": "req_run_error",
            },
          }),
      }),
    });

    const error = await runError(agent);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: "429 Rate limit reached for gpt-4o-mini",
      code: "rate_limit_exceeded",
      rawEvent: body.error,
      retryAfterMs: 7000,
      errorType: "requests",
      requestId: "req_run_error",
    });
  });
});
