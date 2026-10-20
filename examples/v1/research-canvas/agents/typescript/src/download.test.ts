import type { RunnableConfig } from "@langchain/core/runnables";
import { expect, test, vi } from "vitest";
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

import { download_node, downloadResource, getResource } from "./download";

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

function setup() {
  vi.resetAllMocks();
  dependencyMocks.emitState.mockResolvedValue();
}

test("removes a failed first download and completes its progress", async () => {
  setup();
  const url = "https://example.com/download-failure";
  const state = createAgentState(url);
  dependencyMocks.fetchPublicText.mockRejectedValueOnce(
    new Error("Connection reset"),
  );

  const result = await download_node(state, {});
  expect(result.resources).toEqual([]);
  await expect(
    download_node({ ...state, ...result }, {}),
  ).resolves.toMatchObject({ resources: [] });
  expect(dependencyMocks.fetchPublicText).toHaveBeenCalledTimes(1);
  expect(result.logs).toEqual([
    {
      message: `Failed to download ${url}: Connection reset`,
      done: true,
    },
  ]);
  expect(getResource(url)).toBe("");
});

test("retries a failed download and exposes only the successful content", async () => {
  setup();
  const url = "https://example.com/download-retry";
  dependencyMocks.fetchPublicText
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValueOnce("<main>Downloaded article</main>");

  await expect(download_node(createAgentState(url), {})).resolves.toMatchObject(
    { resources: [] },
  );
  const retryState = createAgentState(url);
  await expect(download_node(retryState, {})).resolves.toEqual({
    logs: [{ message: `Downloading ${url}`, done: true }],
    resources: retryState.resources.map((resource) => ({
      ...resource,
      downloaded: true,
    })),
  });

  expect(dependencyMocks.fetchPublicText).toHaveBeenCalledTimes(2);
  expect(getResource(url)).toBe("Downloaded article");
});

test("treats empty downloaded text as cached", async () => {
  setup();
  const url = "https://example.com/empty-download";
  dependencyMocks.fetchPublicText.mockResolvedValue("<main></main>");

  await download_node(createAgentState(url), {});
  const secondResult = await download_node(createAgentState(url), {});

  expect(secondResult.logs).toEqual([]);
  expect(dependencyMocks.fetchPublicText).toHaveBeenCalledTimes(1);
  expect(getResource(url)).toBe("");
});

test("keeps previously downloaded evidence when an evicted resource cannot reload", async () => {
  setup();
  const state = createAgentState("https://example.com/evicted-evidence");
  dependencyMocks.fetchPublicText.mockResolvedValue(
    "<main>Retained evidence</main>",
  );
  const downloaded = await download_node(state, {});
  const nextTurn = { ...state, ...downloaded, logs: [] };
  for (let index = 0; index < 65; index++) {
    await downloadResource(`https://example.com/evict-${index}`);
  }
  expect(getResource(state.resources[0].url)).toBe("");
  dependencyMocks.fetchPublicText.mockRejectedValueOnce(new Error("Forbidden"));

  await expect(download_node(nextTurn, {})).rejects.toThrow(
    "Failed to download https://example.com/evicted-evidence: Forbidden",
  );

  expect(nextTurn.resources).toHaveLength(1);
  expect(nextTurn.resources[0].url).toBe(
    "https://example.com/evicted-evidence",
  );
});
