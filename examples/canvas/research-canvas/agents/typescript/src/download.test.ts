import type { RunnableConfig } from "@langchain/core/runnables";
import { beforeEach, expect, test, vi } from "vitest";
import type { AgentState } from "./state";

const dependencyMocks = vi.hoisted(() => ({
  emitState: vi.fn<(config: RunnableConfig, state: unknown) => Promise<void>>(),
  fetchPublicText:
    vi.fn<(input: string, signal: AbortSignal) => Promise<string>>(),
}));

vi.mock("@copilotkit/sdk-js/langgraph", () => ({
  copilotkitEmitState: dependencyMocks.emitState,
}));

vi.mock("html-to-text", () => ({
  htmlToText: (html: string) => html.replace(/<[^>]+>/g, ""),
}));

vi.mock("./public-url-fetch", () => ({
  fetchPublicText: dependencyMocks.fetchPublicText,
}));

import { download_node, getResource } from "./download";

function createAgentState(url: string): AgentState {
  return {
    copilotkit: {
      actions: [],
      context: [],
      interceptedToolCalls: [],
      originalAIMessageId: "",
    },
    logs: [],
    messages: [],
    model: "openai",
    report: "",
    research_question: "",
    resources: [
      {
        content: "",
        description: "Test resource",
        title: "Test resource",
        url,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencyMocks.emitState.mockResolvedValue();
});

test("rejects a failed download without completing its progress", async () => {
  const url = "https://example.com/download-failure";
  const state = createAgentState(url);
  dependencyMocks.fetchPublicText.mockRejectedValueOnce(
    new Error("Connection reset"),
  );

  await expect(download_node(state, {})).rejects.toThrow(
    `Failed to download ${url}: Connection reset`,
  );
  expect(state.logs).toEqual([
    {
      message: `Failed to download ${url}: Connection reset`,
      done: false,
    },
  ]);
  expect(getResource(url)).toBe("");
});

test("retries a failed download and exposes only the successful content", async () => {
  const url = "https://example.com/download-retry";
  dependencyMocks.fetchPublicText
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValueOnce("<main>Downloaded article</main>");

  await expect(download_node(createAgentState(url), {})).rejects.toThrow(
    `Failed to download ${url}: Temporary failure`,
  );
  const retryState = createAgentState(url);
  await expect(download_node(retryState, {})).resolves.toEqual({
    logs: [{ message: `Downloading ${url}`, done: true }],
    resources: retryState.resources,
  });

  expect(dependencyMocks.fetchPublicText).toHaveBeenCalledTimes(2);
  expect(getResource(url)).toBe("Downloaded article");
});
