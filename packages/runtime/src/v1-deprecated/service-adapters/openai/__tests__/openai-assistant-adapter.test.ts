import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { OpenAIAssistantAdapter } from "../openai-assistant-adapter";
import type { OpenAIAssistantAdapterParams } from "../openai-assistant-adapter";
import { TextMessage } from "../../../graphql/types/converted";
import { MessageRole } from "../../../graphql/types/enums";
import type { CopilotRuntimeChatCompletionRequest } from "../../service-adapter";

function createMockClient() {
  const runsStream = vi.fn(() => ({
    // Emit the run id at once so `process()` can resolve it.
    on: (_event: string, listener: (event: unknown) => void) =>
      listener({ event: "thread.run.created", data: { id: "run_1" } }),
    off: vi.fn(),
  }));
  const client = {
    beta: {
      threads: {
        create: vi.fn().mockResolvedValue({ id: "thread_1" }),
        messages: { create: vi.fn().mockResolvedValue({}) },
        runs: { stream: runsStream },
      },
    },
  } as unknown as OpenAI;
  return { client, runsStream };
}

async function getToolTypes(
  params: Pick<
    OpenAIAssistantAdapterParams,
    "codeInterpreterEnabled" | "fileSearchEnabled"
  >,
): Promise<string[]> {
  const { client, runsStream } = createMockClient();
  const adapter = new OpenAIAssistantAdapter({
    openai: client,
    assistantId: "asst_1",
    ...params,
  });

  await adapter.process({
    messages: [
      new TextMessage({
        content: "You are helpful.",
        role: MessageRole.system,
      }),
      new TextMessage({ content: "Hi", role: MessageRole.user }),
    ],
    actions: [],
    eventSource: { stream: vi.fn() },
  } as unknown as CopilotRuntimeChatCompletionRequest);

  const [, body] = runsStream.mock.calls[0] as unknown as [
    string,
    { tools: { type: string }[] },
  ];
  return body.tools.map((tool) => tool.type);
}

describe("OpenAIAssistantAdapter tools", () => {
  it("enables code interpreter and file search by default", async () => {
    expect(await getToolTypes({})).toEqual(["code_interpreter", "file_search"]);
  });

  it("drops code interpreter when codeInterpreterEnabled is false", async () => {
    expect(await getToolTypes({ codeInterpreterEnabled: false })).toEqual([
      "file_search",
    ]);
  });

  it("drops file search when fileSearchEnabled is false", async () => {
    expect(await getToolTypes({ fileSearchEnabled: false })).toEqual([
      "code_interpreter",
    ]);
  });

  it("sends no tools when both flags are false", async () => {
    expect(
      await getToolTypes({
        codeInterpreterEnabled: false,
        fileSearchEnabled: false,
      }),
    ).toEqual([]);
  });
});
