import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { beforeEach, expect, test, vi } from "vitest";
import { chat_node } from "./chat";
import { download_node } from "./download";
import { getCachedResource, getOrLoadResource } from "./resource-cache";
import type * as ResourceCacheModule from "./resource-cache";
import type { AgentState } from "./state";

const dependencies = vi.hoisted(() => ({
  fetchPublicText:
    vi.fn<(url: string, signal: AbortSignal) => Promise<string>>(),
  invoke:
    vi.fn<
      (messages: BaseMessage[], config: RunnableConfig) => Promise<AIMessage>
    >(),
}));

vi.mock("./public-url-fetch", () => ({
  fetchPublicText: dependencies.fetchPublicText,
}));

vi.mock("./model", () => ({
  getModel: () => ({ bindTools: () => ({ invoke: dependencies.invoke }) }),
}));

vi.mock("@copilotkit/sdk-js/langgraph", () => ({
  copilotkitCustomizeConfig: (config: RunnableConfig) => config,
  copilotkitEmitState: async () => {},
}));

vi.mock("./resource-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof ResourceCacheModule>();
  return {
    ...actual,
    ...actual.createResourceCache({ maxEntries: 1, maxBytes: 64 }),
  };
});

/** Creates a research state with resource metadata and no retained document body. */
function createState(url: string): AgentState {
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
    research_question: "What does the source say?",
    resources: [
      { url, title: "Source", description: "Research source", content: "" },
    ],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.invoke.mockResolvedValue(new AIMessage("Answer"));
});

test("chat reloads a document evicted after the download node", async () => {
  const url = "https://example.com/evicted-source";
  const state = createState(url);
  dependencies.fetchPublicText.mockResolvedValue(
    "<main>Source evidence</main>",
  );
  await download_node(state, {});
  await getOrLoadResource(
    "https://example.com/other-session",
    async () => "Other source",
  );
  expect(getCachedResource(url)).toBeUndefined();

  await chat_node(state, {});

  const prompt = dependencies.invoke.mock.calls[0][0][0].content;
  expect(prompt).toContain('"content":"Source evidence"');
  expect(dependencies.fetchPublicText).toHaveBeenCalledTimes(2);
  expect(state.resources[0].content).toBe("");
});

test("chat uses downloaded text that exceeds the cache byte limit", async () => {
  const url = "https://example.com/uncached-source";
  const state = createState(url);
  const content = "Evidence".repeat(9);
  dependencies.fetchPublicText.mockResolvedValue(`<main>${content}</main>`);
  await download_node(state, {});
  expect(getCachedResource(url)).toBeUndefined();

  await chat_node(state, {});

  const prompt = dependencies.invoke.mock.calls[0][0][0].content;
  expect(prompt).toContain(JSON.stringify(content));
  expect(getCachedResource(url)).toBeUndefined();
  expect(state.resources[0].content).toBe("");
});

test("chat rejects a failed reload instead of asking the model without evidence", async () => {
  const url = "https://example.com/reload-failure";
  const state = createState(url);
  dependencies.fetchPublicText.mockResolvedValueOnce(
    "<main>Source evidence</main>",
  );
  await download_node(state, {});
  await getOrLoadResource(
    "https://example.com/evict-before-failure",
    async () => "Other source",
  );
  expect(getCachedResource(url)).toBeUndefined();
  dependencies.fetchPublicText.mockRejectedValueOnce(
    new Error("Connection reset"),
  );

  await expect(chat_node(state, {})).rejects.toThrow("Connection reset");
  expect(dependencies.invoke).not.toHaveBeenCalled();
});

test.each(["", "ERROR"])(
  "chat preserves fetched content %j instead of trusting the supplied body",
  async (content) => {
    const url = `https://example.com/content-${content || "empty"}`;
    const state = createState(url);
    state.resources[0].content = "Untrusted browser body";
    dependencies.fetchPublicText.mockResolvedValue(`<main>${content}</main>`);
    await download_node(state, {});

    await chat_node(state, {});

    const prompt = dependencies.invoke.mock.calls[0][0][0].content;
    expect(prompt).toContain(`"content":${JSON.stringify(content)}`);
    expect(prompt).not.toContain("Untrusted browser body");
    expect(dependencies.fetchPublicText).toHaveBeenCalledTimes(1);
    expect(state.resources[0].content).toBe("Untrusted browser body");
  },
);
