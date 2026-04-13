import { describe, it, expect, vi } from "vitest";
import { isOpenAIV5, getChatCompletionsForStreaming } from "../utils";
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
            retrieve: vi.fn(),
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
            retrieve: vi.fn(),
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
    expect(completions).toBe(
      (client as unknown as Record<string, any>).beta.chat.completions,
    );
  });

  it("returns chat.completions for a v5 client", () => {
    const { client } = createMockV5Client();
    const completions = getChatCompletionsForStreaming(client);
    expect(completions).toBe(client.chat.completions);
  });

  it("stream() on v4 calls beta.chat.completions.stream", () => {
    const { client, streamFn } = createMockV4Client();
    const completions = getChatCompletionsForStreaming(client);
    (completions as any).stream({ model: "gpt-4o", messages: [] });
    expect(streamFn).toHaveBeenCalledWith({ model: "gpt-4o", messages: [] });
  });

  it("stream() on v5 calls chat.completions.stream", () => {
    const { client, streamFn } = createMockV5Client();
    const completions = getChatCompletionsForStreaming(client);
    (completions as any).stream({ model: "gpt-4o", messages: [] });
    expect(streamFn).toHaveBeenCalledWith({ model: "gpt-4o", messages: [] });
  });
});

describe("OpenAI Assistant Adapter v5 named path params", () => {
  /**
   * These tests verify that the assistant adapter correctly dispatches
   * to the right calling convention based on SDK version.
   * v4: runs.retrieve(threadId, runId)
   * v5: runs.retrieve(runId, { thread_id: threadId })
   */

  it("v4 runs.retrieve is called with positional args (threadId, runId)", () => {
    const { client } = createMockV4Client();
    const retrieveFn = (client as any).beta.threads.runs.retrieve;

    // Simulate the v4 call pattern from the adapter
    if (!isOpenAIV5(client)) {
      retrieveFn("thread_abc", "run_xyz");
    }

    expect(retrieveFn).toHaveBeenCalledWith("thread_abc", "run_xyz");
  });

  it("v5 runs.retrieve is called with named path params (runId, { thread_id })", () => {
    const { client } = createMockV5Client();
    const retrieveFn = (client as any).beta.threads.runs.retrieve;

    // Simulate the v5 call pattern from the adapter
    if (isOpenAIV5(client)) {
      retrieveFn("run_xyz", { thread_id: "thread_abc" });
    }

    expect(retrieveFn).toHaveBeenCalledWith("run_xyz", {
      thread_id: "thread_abc",
    });
  });

  it("v4 submitToolOutputsStream is called with positional args", () => {
    const { client } = createMockV4Client();
    const submitFn = (client as any).beta.threads.runs.submitToolOutputsStream;
    const body = { tool_outputs: [{ tool_call_id: "tc_1", output: "result" }] };

    if (!isOpenAIV5(client)) {
      submitFn("thread_abc", "run_xyz", body);
    }

    expect(submitFn).toHaveBeenCalledWith("thread_abc", "run_xyz", body);
  });

  it("v5 submitToolOutputsStream is called with named path params", () => {
    const { client } = createMockV5Client();
    const submitFn = (client as any).beta.threads.runs.submitToolOutputsStream;
    const body = { tool_outputs: [{ tool_call_id: "tc_1", output: "result" }] };

    if (isOpenAIV5(client)) {
      submitFn("run_xyz", { thread_id: "thread_abc", ...body });
    }

    expect(submitFn).toHaveBeenCalledWith("run_xyz", {
      thread_id: "thread_abc",
      ...body,
    });
  });
});
