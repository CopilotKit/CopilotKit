import { describe, it, expect, vi } from "vitest";
import {
  isOpenAIV5,
  getChatCompletionsForStreaming,
  retrieveThreadRun,
  submitToolOutputsStream,
} from "../utils";
import type OpenAI from "openai";

/**
 * Tests for OpenAI SDK v4/v5 compatibility layer.
 *
 * In v5, the `beta.chat` namespace was removed and promoted to `chat`.
 * In v5, methods with multiple path params switched to named params
 * (e.g. runs.retrieve(runId, { thread_id }) instead of runs.retrieve(threadId, runId)).
 */

function createMockV4Client() {
  const streamFn = vi.fn();
  return {
    client: {
      beta: {
        chat: {
          completions: { stream: streamFn },
        },
        threads: {
          create: vi.fn(),
          runs: {
            retrieve: vi.fn().mockResolvedValue({ id: "run_xyz" }),
            stream: vi.fn(),
            submitToolOutputsStream: vi.fn(),
          },
          messages: {
            create: vi.fn(),
          },
        },
      },
      chat: {
        completions: {
          stream: vi.fn(), // exists but should NOT be used for streaming in v4
        },
      },
    } as unknown as OpenAI,
    streamFn,
  };
}

function createMockV5Client() {
  const streamFn = vi.fn();
  return {
    client: {
      // v5: beta.chat is gone, only beta.threads remains
      beta: {
        threads: {
          create: vi.fn(),
          runs: {
            retrieve: vi.fn().mockResolvedValue({ id: "run_xyz" }),
            stream: vi.fn(),
            submitToolOutputsStream: vi.fn(),
          },
          messages: {
            create: vi.fn(),
          },
        },
      },
      chat: {
        completions: {
          stream: streamFn,
        },
      },
    } as unknown as OpenAI,
    streamFn,
  };
}

describe("isOpenAIV5", () => {
  it("returns false for a v4 client (beta.chat exists)", () => {
    const { client } = createMockV4Client();
    expect(isOpenAIV5(client)).toBe(false);
  });

  it("returns true for a v5 client (beta.chat does not exist)", () => {
    const { client } = createMockV5Client();
    expect(isOpenAIV5(client)).toBe(true);
  });

  it("returns true when beta is entirely missing", () => {
    const client = { chat: { completions: {} } } as unknown as OpenAI;
    expect(isOpenAIV5(client)).toBe(true);
  });
});

describe("getChatCompletionsForStreaming", () => {
  it("returns beta.chat.completions for a v4 client", () => {
    const { client } = createMockV4Client();
    const completions = getChatCompletionsForStreaming(client);
    // Should be the beta version, not the top-level one
    expect(completions).not.toBe(client.chat.completions);
  });

  it("returns chat.completions for a v5 client", () => {
    const { client } = createMockV5Client();
    const completions = getChatCompletionsForStreaming(client);
    expect(completions).toBe(client.chat.completions);
  });

  it("stream() on v4 calls beta.chat.completions.stream", () => {
    const { client, streamFn } = createMockV4Client();
    const completions = getChatCompletionsForStreaming(client);
    completions.stream({ model: "gpt-4o", messages: [] });
    expect(streamFn).toHaveBeenCalledWith({ model: "gpt-4o", messages: [] });
  });

  it("stream() on v5 calls chat.completions.stream", () => {
    const { client, streamFn } = createMockV5Client();
    const completions = getChatCompletionsForStreaming(client);
    completions.stream({ model: "gpt-4o", messages: [] });
    expect(streamFn).toHaveBeenCalledWith({ model: "gpt-4o", messages: [] });
  });
});

describe("retrieveThreadRun", () => {
  it("v4: calls retrieve with positional args (threadId, runId)", async () => {
    const { client } = createMockV4Client();
    const retrieveFn = client.beta.threads.runs.retrieve as ReturnType<
      typeof vi.fn
    >;

    await retrieveThreadRun(client, "thread_abc", "run_xyz");

    expect(retrieveFn).toHaveBeenCalledWith("thread_abc", "run_xyz");
  });

  it("v5: calls retrieve with named path params (runId, { thread_id })", async () => {
    const { client } = createMockV5Client();
    const retrieveFn = client.beta.threads.runs.retrieve as ReturnType<
      typeof vi.fn
    >;

    await retrieveThreadRun(client, "thread_abc", "run_xyz");

    expect(retrieveFn).toHaveBeenCalledWith("run_xyz", {
      thread_id: "thread_abc",
    });
  });
});

describe("submitToolOutputsStream", () => {
  it("v4: calls with positional args (threadId, runId, body)", () => {
    const { client } = createMockV4Client();
    const submitFn = client.beta.threads.runs
      .submitToolOutputsStream as ReturnType<typeof vi.fn>;
    const body = {
      tool_outputs: [{ tool_call_id: "tc_1", output: "result" }],
    };

    submitToolOutputsStream(client, "thread_abc", "run_xyz", body);

    expect(submitFn).toHaveBeenCalledWith("thread_abc", "run_xyz", body);
  });

  it("v5: calls with named path params (runId, { thread_id, ...body })", () => {
    const { client } = createMockV5Client();
    const submitFn = client.beta.threads.runs
      .submitToolOutputsStream as ReturnType<typeof vi.fn>;
    const body = {
      tool_outputs: [{ tool_call_id: "tc_1", output: "result" }],
    };

    submitToolOutputsStream(client, "thread_abc", "run_xyz", body);

    expect(submitFn).toHaveBeenCalledWith("run_xyz", {
      thread_id: "thread_abc",
      ...body,
    });
  });
});
